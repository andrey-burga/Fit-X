/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.1 Athlete Data Service
 *
 * Updated for Phase 4.0.1 Audit:
 * - Uses PK-only key `{ pk }` for `Users` (removed redundant `PROFILE` sort key).
 * - Uses `queryTable` with cursor pagination (`startKey`, max 100 items per page) to
 *   stay strictly inside Catalyst NoSQL's 100-item read cap and Advanced I/O 30s timeout.
 * - Covers all 11 athlete subcollections (including cardioSessions and notifications).
 */

import {
  CATALYST_PLATFORM_LIMITS,
  KeyBuilders,
  type AuthoritativeActor,
  type UserAccountItem,
  type UserDataEntityType,
  type UserDataItem,
} from '../types/cleanSlate.js';
import type { ICleanSlateNoSQLAdapter } from '../nosql/cleanSlateEngine.js';
import {
  assertExecutedWorkoutMutable,
  DomainValidationError,
  validateBiometricsPayload,
  validateCardioPayload,
  validateExecutedWorkoutCreate,
  validateGroceryPayload,
  validateGroceryStatusPatch,
  validateMealLogPayload,
  validateMealPlanPayload,
  validateNotificationPayload,
  validateNotificationReadPatch,
  validateOnboardingPayload,
  validatePreferencesPayload,
  validateProfileSelfUpdate,
  validateRecipePayload,
  validateSafeIdentifier,
  validateWorkoutRoutinePayload,
  validateWorkoutSetPayload,
} from '../validators/domainValidators.js';

export interface HydratedDashboardSnapshot {
  profile: UserAccountItem;
  biometrics: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
  groceries: UserDataItem[];
  mealLogs: UserDataItem[];
  recipes: UserDataItem[];
  mealPlans: UserDataItem[];
  workoutRoutines: UserDataItem[];
  executedWorkouts: UserDataItem[];
  workoutSets: UserDataItem[];
  cardioSessions: UserDataItem[];
  notifications: UserDataItem[];
  hasMorePages: boolean;
  nextCursor?: string;
}

export class AthleteDataService {
  constructor(private db: ICleanSlateNoSQLAdapter) {}

  private async findExecutedWorkoutById(
    pk: string,
    workoutId: string,
    startedAtHint?: string
  ): Promise<UserDataItem | null> {
    if (startedAtHint && startedAtHint.trim()) {
      const sk = KeyBuilders.executedWorkoutSk(startedAtHint.trim(), workoutId);
      const exact = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
      if (exact) return exact;
    }
    let cursor: string | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'WORKOUT#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      const match = page.items.find(item => item.entityId === workoutId);
      if (match) return match;
      cursor = page.nextStartKey;
    } while (cursor);
    return null;
  }

  /**
   * Hydrates athlete workspace using paginated `queryTable` (<= 100 items per page)
   * to respect Catalyst NoSQL read limits and Advanced I/O 30s budget.
   */
  async hydrateAthleteWorkspace(
    actor: AuthoritativeActor,
    options: { cursor?: string; maxPages?: number } = {}
  ): Promise<HydratedDashboardSnapshot> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const profile = await this.db.fetchItem<UserAccountItem>('Users', { pk }, { consistent_read: true });

    if (!profile) {
      throw new DomainValidationError('PROFILE_NOT_FOUND', 'User profile not found.', 400);
    }

    const collected: UserDataItem[] = [];
    let cursor = options.cursor;
    const maxPages = Math.min(Math.max(1, options.maxPages ?? 5), 10);
    let pagesFetched = 0;

    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      collected.push(...page.items);
      cursor = page.nextStartKey;
      pagesFetched++;
    } while (cursor && pagesFetched < maxPages);

    const byType = (type: UserDataEntityType) => collected.filter(i => i.entityType === type);

    return {
      profile,
      biometrics: byType('BIOMETRICS')[0]?.payload ?? null,
      preferences: byType('PREFERENCES')[0]?.payload ?? null,
      groceries: byType('GROCERY'),
      mealLogs: byType('MEAL_LOG'),
      recipes: byType('RECIPE'),
      mealPlans: byType('MEAL_PLAN'),
      workoutRoutines: byType('WORKOUT_ROUTINE'),
      executedWorkouts: byType('EXECUTED_WORKOUT'),
      workoutSets: byType('WORKOUT_SET'),
      cardioSessions: byType('CARDIO_SESSION'),
      notifications: byType('NOTIFICATION'),
      hasMorePages: Boolean(cursor),
      nextCursor: cursor,
    };
  }

  async updateOwnProfile(
    actor: AuthoritativeActor,
    patch: Record<string, unknown>
  ): Promise<UserAccountItem> {
    validateProfileSelfUpdate(patch);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();

    const safeUpdates: Partial<UserAccountItem> = { updatedAt: nowIso };
    if (patch.displayName !== undefined) safeUpdates.displayName = String(patch.displayName).trim();
    if (patch.location !== undefined) safeUpdates.location = String(patch.location);
    if (patch.goal !== undefined) safeUpdates.goal = String(patch.goal);
    if (patch.profileLabel !== undefined) {
      const label = String(patch.profileLabel);
      if (label === 'Atleta Pro' || label === 'Coach' || label === 'Nutricionista') {
        safeUpdates.profileLabel = label;
      }
    }
    if (typeof patch.onboardingStep === 'number') safeUpdates.onboardingStep = patch.onboardingStep;

    const res = await this.db.updateItem<UserAccountItem>(
      'Users',
      { pk },
      safeUpdates,
      { type: 'attribute_exists', attr: 'pk' }
    );
    if (!res.updated || !res.item) {
      throw new DomainValidationError('PROFILE_UPDATE_FAILED', 'Profile does not exist.', 400);
    }
    return res.item;
  }

  async completeOnboarding(
    actor: AuthoritativeActor,
    input: {
      displayName: string;
      goal: string;
      biometrics: Record<string, unknown>;
      preferences: Record<string, unknown>;
    }
  ): Promise<{
    completed: boolean;
    profile?: UserAccountItem;
    biometrics: Record<string, unknown>;
    preferences: Record<string, unknown>;
  }> {
    validateOnboardingPayload(input as unknown as Record<string, unknown>);
    validateBiometricsPayload(input.biometrics);
    validatePreferencesPayload(input.preferences);

    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();

    const bioItem: UserDataItem = {
      pk,
      sk: KeyBuilders.biometricsSk(),
      uid: actor.catalystUserId,
      entityType: 'BIOMETRICS',
      entityId: 'current',
      entityDateKey: `BIOMETRICS#${nowIso}#current`,
      payload: input.biometrics,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    const prefPayload = { ...input.preferences, onboardingCompleted: true };
    const prefItem: UserDataItem = {
      pk,
      sk: KeyBuilders.preferencesSk(),
      uid: actor.catalystUserId,
      entityType: 'PREFERENCES',
      entityId: 'settings',
      entityDateKey: `PREFERENCES#${nowIso}#settings`,
      payload: prefPayload,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    await this.db.insertBatch('UserData', [bioItem, prefItem]);

    const userUpd = await this.db.updateItem<UserAccountItem>(
      'Users',
      { pk },
      {
        displayName: input.displayName.trim(),
        goal: input.goal,
        onboardingCompleted: true,
        onboardingStep: 6,
        updatedAt: nowIso,
      },
      { type: 'attribute_exists', attr: 'pk' }
    );
    if (!userUpd.updated || !userUpd.item) {
      throw new DomainValidationError('PROFILE_NOT_FOUND', 'User profile not found for onboarding completion.', 400);
    }

    return {
      completed: true,
      profile: userUpd.item,
      biometrics: bioItem.payload,
      preferences: prefPayload,
    };
  }

  async logMeal(
    actor: AuthoritativeActor,
    mealLogId: string,
    payload: Record<string, unknown>
  ): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(mealLogId, 'mealLogId');
    validateMealLogPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const dateTimeIso = String(payload.dateTime);

    const normalizedPayload = { ...payload, id: safeId };
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.mealSk(dateTimeIso, safeId),
      uid: actor.catalystUserId,
      entityType: 'MEAL_LOG',
      entityId: safeId,
      entityDateKey: `MEAL_LOG#${dateTimeIso}#${safeId}`,
      payload: normalizedPayload,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    await this.db.insertItem('UserData', item);
    return item;
  }

  async queryMealsByDateRange(
    actor: AuthoritativeActor,
    startDateIso: string,
    endDateIso: string,
    limit = 50,
    startKey?: string
  ) {
    if (!startDateIso || !endDateIso || startDateIso > endDateIso) {
      throw new DomainValidationError(
        'INVALID_MEAL_QUERY',
        'Valid startDate and endDate (startDate <= endDate) are required.',
        400
      );
    }
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyBetween: [`MEAL#${startDateIso}`, `MEAL#${endDateIso}\uffff`],
      limit: safeLimit,
      startKey,
      consistent_read: true,
    });
  }

  /**
   * Synchronizes grocery items in Catalyst <=25 item batches.
   * - `replaceExisting === true` (default / batch 0): replaces caller's entire GROCERY# partition slice.
   * - `replaceExisting === false` (continuation batch 1..N or targeted retry): replaces ONLY the keys
   *   present in `groceries` so retries never duplicate items and never wipe previously committed batches.
   * - NOTE: Multi-batch sync (`batchCalls > 1`) is NON-ATOMIC across Catalyst API calls.
   */
  async syncMealPlanToGroceries(
    actor: AuthoritativeActor,
    groceries: Array<{ id: string; payload: Record<string, unknown> }>,
    options: { replaceExisting?: boolean } = {}
  ): Promise<{ inserted: number; batchCalls: number; replaceExisting: boolean; atomicBatch: boolean }> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const replaceExisting = options.replaceExisting !== false;

    const items: UserDataItem[] = groceries.map(g => {
      const safeId = validateSafeIdentifier(g.id, 'grocery.id');
      validateGroceryPayload(g.payload);
      return {
        pk,
        sk: KeyBuilders.grocerySk(safeId),
        uid: actor.catalystUserId,
        entityType: 'GROCERY',
        entityId: safeId,
        entityDateKey: `GROCERY#${nowIso}#${safeId}`,
        payload: { ...g.payload, id: safeId },
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      };
    });

    if (replaceExisting) {
      const existing: UserDataItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.db.queryTable<UserDataItem>('UserData', {
          partitionKeyValue: pk,
          sortKeyPrefix: 'GROCERY#',
          limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
          startKey: cursor,
          consistent_read: true,
        });
        existing.push(...page.items);
        cursor = page.nextStartKey;
      } while (cursor);

      if (existing.length > 0) {
        await this.db.deleteBatch(
          'UserData',
          existing.map(e => ({ pk: e.pk, sk: e.sk }))
        );
      }
    } else if (items.length > 0) {
      // Idempotent chunk retry: remove any prior items with the same deterministic GROCERY#<id> keys
      await this.db.deleteBatch(
        'UserData',
        items.map(i => ({ pk: i.pk, sk: i.sk }))
      );
    }

    if (items.length === 0) {
      return { inserted: 0, batchCalls: 0, replaceExisting, atomicBatch: true };
    }

    const res = await this.db.insertBatch('UserData', items);
    return {
      inserted: res.count,
      batchCalls: res.batchCalls,
      replaceExisting,
      atomicBatch: res.batchCalls <= 1 && replaceExisting,
    };
  }

  async startExecutedWorkout(
    actor: AuthoritativeActor,
    workoutId: string,
    payload: Record<string, unknown>
  ): Promise<UserDataItem> {
    const safeWorkoutId = validateSafeIdentifier(workoutId, 'workoutId');
    const normalizedInput: Record<string, unknown> = {
      ...payload,
      status: payload.status ?? 'in_progress',
    };
    if (normalizedInput.status !== 'in_progress') {
      throw new DomainValidationError(
        'INVALID_WORKOUT_STATUS',
        `New executedWorkout must start with status 'in_progress', got '${String(normalizedInput.status)}'.`,
        400
      );
    }
    validateExecutedWorkoutCreate(normalizedInput);

    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const startedAt = String(normalizedInput.startedAt);
    const sk = KeyBuilders.executedWorkoutSk(startedAt, safeWorkoutId);

    // Explicit existence check (Blocker 1 lesson: Catalyst insertItems ignores conditions on absent items)
    const existing = await this.findExecutedWorkoutById(pk, safeWorkoutId, startedAt);
    if (existing) {
      throw new DomainValidationError('WORKOUT_ALREADY_EXISTS', `Workout '${safeWorkoutId}' already exists.`, 409);
    }

    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'EXECUTED_WORKOUT',
      entityId: safeWorkoutId,
      entityDateKey: `EXECUTED_WORKOUT#${startedAt}#${safeWorkoutId}`,
      payload: {
        durationSeconds: 0,
        totalTonnageKg: 0,
        totalCompletedSets: 0,
        totalReps: 0,
        averageRir: null,
        ...normalizedInput,
        id: safeWorkoutId,
        status: 'in_progress',
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    await this.db.insertItem('UserData', item);
    return item;
  }

  async logWorkoutSet(
    actor: AuthoritativeActor,
    sessionId: string,
    workoutStartedAt: string | undefined,
    payload: Record<string, unknown>
  ): Promise<UserDataItem> {
    const safeSetId = validateSafeIdentifier(sessionId, 'setId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const executedWorkoutId = validateSafeIdentifier(payload.executedWorkoutId, 'executedWorkoutId');

    const parent = await this.findExecutedWorkoutById(pk, executedWorkoutId, workoutStartedAt);
    const parentStatus = parent ? String(parent.payload.status || '') : null;

    validateWorkoutSetPayload(payload, parentStatus);

    const weightKg = Number(payload.weightKg);
    const reps = Number(payload.reps);
    const estimated1RM =
      typeof payload.estimated1RM === 'number' && Number.isFinite(payload.estimated1RM)
        ? payload.estimated1RM
        : Math.round(weightKg * (1 + reps / 30) * 10) / 10;

    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.workoutSetSk(executedWorkoutId, safeSetId),
      uid: actor.catalystUserId,
      entityType: 'WORKOUT_SET',
      entityId: safeSetId,
      entityDateKey: `WORKOUT_SET#${nowIso}#${safeSetId}`,
      payload: {
        ...payload,
        id: safeSetId,
        executedWorkoutId,
        estimated1RM,
        completedAt: typeof payload.completedAt === 'string' && payload.completedAt ? payload.completedAt : nowIso,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };

    await this.db.insertItem('UserData', item);
    return item;
  }

  async completeExecutedWorkout(
    actor: AuthoritativeActor,
    workoutId: string,
    startedAt: string | undefined,
    finalStatus: 'completed' | 'abandoned',
    summaryPatch: Record<string, unknown> = {}
  ): Promise<UserDataItem> {
    const safeWorkoutId = validateSafeIdentifier(workoutId, 'workoutId');
    if (finalStatus !== 'completed' && finalStatus !== 'abandoned') {
      throw new DomainValidationError(
        'INVALID_WORKOUT_STATUS',
        `finalStatus must be 'completed' or 'abandoned'.`,
        400
      );
    }

    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const existing = await this.findExecutedWorkoutById(pk, safeWorkoutId, startedAt);

    if (!existing) {
      throw new DomainValidationError('WORKOUT_NOT_FOUND', 'ExecutedWorkout not found.', 400);
    }
    assertExecutedWorkoutMutable(String(existing.payload.status || ''));

    const nowIso = new Date().toISOString();
    const nextPayload = {
      ...existing.payload,
      ...summaryPatch,
      id: safeWorkoutId,
      status: finalStatus,
      completedAt: nowIso,
    };

    const res = await this.db.updateItem<UserDataItem>(
      'UserData',
      { pk, sk: existing.sk },
      {
        payload: nextPayload,
        updatedAt: nowIso,
        version: existing.version + 1,
      },
      { type: 'equals', attr: 'version', value: existing.version }
    );

    const updateStatus = res.response.update?.[0]?.status ?? res.status;
    if (res.httpStatus !== 200 || updateStatus !== 'Success' || !res.updated || !res.item) {
      throw new DomainValidationError(
        'WORKOUT_CONCURRENCY_CONFLICT',
        `Workout update rejected by Catalyst (${updateStatus}).`,
        409
      );
    }
    return res.item;
  }

  async addCardioSession(actor: AuthoritativeActor, cardioId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(cardioId, 'cardioId');
    validateCardioPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const dateIso = String(payload.date);
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.cardioSk(dateIso, safeId),
      uid: actor.catalystUserId,
      entityType: 'CARDIO_SESSION',
      entityId: safeId,
      entityDateKey: `CARDIO_SESSION#${dateIso}#${safeId}`,
      payload: { ...payload, id: safeId },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async createNotification(actor: AuthoritativeActor, notificationId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(notificationId, 'notificationId');
    validateNotificationPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.notificationSk(nowIso, safeId),
      uid: actor.catalystUserId,
      entityType: 'NOTIFICATION',
      entityId: safeId,
      entityDateKey: `NOTIFICATION#${nowIso}#${safeId}`,
      payload: { ...payload, id: safeId, read: Boolean(payload.read ?? false), createdAt: nowIso },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async saveRecipe(actor: AuthoritativeActor, recipeId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(recipeId, 'recipeId');
    validateRecipePayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.recipeSk(safeId),
      uid: actor.catalystUserId,
      entityType: 'RECIPE',
      entityId: safeId,
      entityDateKey: `RECIPE#${nowIso}#${safeId}`,
      payload: { ...payload, id: safeId, updatedAt: nowIso },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async saveMealPlan(actor: AuthoritativeActor, weekStart: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeWeekStart = validateSafeIdentifier(weekStart, 'weekStart');
    validateMealPlanPayload({ ...payload, weekStart: safeWeekStart });
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.mealPlanSk(safeWeekStart),
      uid: actor.catalystUserId,
      entityType: 'MEAL_PLAN',
      entityId: safeWeekStart,
      entityDateKey: `MEAL_PLAN#${safeWeekStart}#${safeWeekStart}`,
      payload: { ...payload, weekStart: safeWeekStart, updatedAt: nowIso },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async saveWorkoutRoutine(actor: AuthoritativeActor, routineId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(routineId, 'routineId');
    validateWorkoutRoutinePayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.routineSk(safeId),
      uid: actor.catalystUserId,
      entityType: 'WORKOUT_ROUTINE',
      entityId: safeId,
      entityDateKey: `WORKOUT_ROUTINE#${nowIso}#${safeId}`,
      payload: { ...payload, id: safeId, updatedAt: nowIso },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async saveBiometrics(actor: AuthoritativeActor, payload: Record<string, unknown>): Promise<UserDataItem> {
    validateBiometricsPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.biometricsSk();
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'BIOMETRICS',
      entityId: 'current',
      entityDateKey: `BIOMETRICS#${nowIso}#current`,
      payload: { ...payload },
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async savePreferences(actor: AuthoritativeActor, payload: Record<string, unknown>): Promise<UserDataItem> {
    validatePreferencesPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.preferencesSk();
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'PREFERENCES',
      entityId: 'settings',
      entityDateKey: `PREFERENCES#${nowIso}#settings`,
      payload: { ...payload },
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async deleteMeal(actor: AuthoritativeActor, mealId: string): Promise<{ deleted: boolean; mealId: string }> {
    const safeId = validateSafeIdentifier(mealId, 'mealId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    let cursor: string | undefined;
    let found: UserDataItem | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'MEAL#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      found = page.items.find(item => item.entityId === safeId);
      if (found) break;
      cursor = page.nextStartKey;
    } while (cursor);

    if (!found) {
      return { deleted: false, mealId: safeId };
    }
    const res = await this.db.deleteItem('UserData', { pk, sk: found.sk });
    return { deleted: res.deleted, mealId: safeId };
  }

  async deleteRecipe(actor: AuthoritativeActor, recipeId: string): Promise<{ deleted: boolean; recipeId: string }> {
    const safeId = validateSafeIdentifier(recipeId, 'recipeId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const res = await this.db.deleteItem('UserData', { pk, sk: KeyBuilders.recipeSk(safeId) });
    return { deleted: res.deleted, recipeId: safeId };
  }

  async addManualGrocery(
    actor: AuthoritativeActor,
    groceryId: string,
    payload: Record<string, unknown>
  ): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(groceryId, 'groceryId');
    validateGroceryPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.grocerySk(safeId);
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    if (existing) {
      throw new DomainValidationError('GROCERY_ALREADY_EXISTS', `Grocery item '${safeId}' already exists.`, 409);
    }
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'GROCERY',
      entityId: safeId,
      entityDateKey: `GROCERY#${nowIso}#${safeId}`,
      payload: {
        status: 'pending',
        ...payload,
        id: safeId,
        origin: 'manual',
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async toggleGroceryStatus(
    actor: AuthoritativeActor,
    groceryId: string,
    patch: Record<string, unknown> = {}
  ): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(groceryId, 'groceryId');
    validateGroceryStatusPatch(patch);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.grocerySk(safeId);
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    if (!existing) {
      throw new DomainValidationError('GROCERY_NOT_FOUND', `Grocery item '${safeId}' not found.`, 404);
    }
    const currentStatus = String(existing.payload.status || 'pending');
    const nextStatus =
      patch.status !== undefined
        ? String(patch.status)
        : currentStatus === 'bought'
          ? 'pending'
          : 'bought';
    const nowIso = new Date().toISOString();
    const nextPayload = { ...existing.payload, id: safeId, status: nextStatus };
    const res = await this.db.updateItem<UserDataItem>(
      'UserData',
      { pk, sk },
      { payload: nextPayload, updatedAt: nowIso, version: existing.version + 1 },
      { type: 'equals', attr: 'version', value: existing.version }
    );
    const updateStatus = res.response.update?.[0]?.status ?? res.status;
    if (res.httpStatus !== 200 || updateStatus !== 'Success' || !res.updated || !res.item) {
      throw new DomainValidationError('GROCERY_CONCURRENCY_CONFLICT', 'Concurrent update conflict on grocery item.', 409);
    }
    return res.item;
  }

  async deleteGrocery(actor: AuthoritativeActor, groceryId: string): Promise<{ deleted: boolean; groceryId: string }> {
    const safeId = validateSafeIdentifier(groceryId, 'groceryId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const res = await this.db.deleteItem('UserData', { pk, sk: KeyBuilders.grocerySk(safeId) });
    return { deleted: res.deleted, groceryId: safeId };
  }

  async setDefaultRoutine(actor: AuthoritativeActor, routineId: string): Promise<Array<Record<string, unknown>>> {
    const safeId = validateSafeIdentifier(routineId, 'routineId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const allRoutines: UserDataItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'ROUTINE#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      allRoutines.push(...page.items);
      cursor = page.nextStartKey;
    } while (cursor);

    if (!allRoutines.some(r => r.entityId === safeId)) {
      throw new DomainValidationError('ROUTINE_NOT_FOUND', `Routine '${safeId}' not found.`, 404);
    }

    const nowIso = new Date().toISOString();
    const updatedItems: UserDataItem[] = allRoutines.map(item => ({
      ...item,
      payload: {
        ...item.payload,
        id: item.entityId,
        isDefault: item.entityId === safeId,
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
      version: item.version + 1,
    }));

    const changedItems = updatedItems.filter((next, idx) => {
      const prev = allRoutines[idx];
      return Boolean(prev.payload.isDefault) !== Boolean(next.payload.isDefault);
    });
    if (changedItems.length > 0) {
      await this.db.deleteBatch('UserData', changedItems.map(i => ({ pk: i.pk, sk: i.sk })));
      await this.db.insertBatch('UserData', changedItems);
    }

    return updatedItems.map(i => i.payload);
  }

  async deleteCardioSession(actor: AuthoritativeActor, cardioId: string): Promise<{ deleted: boolean; cardioId: string }> {
    const safeId = validateSafeIdentifier(cardioId, 'cardioId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    let cursor: string | undefined;
    let found: UserDataItem | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'CARDIO#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      found = page.items.find(item => item.entityId === safeId);
      if (found) break;
      cursor = page.nextStartKey;
    } while (cursor);

    if (!found) {
      return { deleted: false, cardioId: safeId };
    }
    const res = await this.db.deleteItem('UserData', { pk, sk: found.sk });
    return { deleted: res.deleted, cardioId: safeId };
  }

  async markNotificationRead(
    actor: AuthoritativeActor,
    notificationId: string,
    patch: Record<string, unknown> = {}
  ): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(notificationId, 'notificationId');
    validateNotificationReadPatch(patch);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    let cursor: string | undefined;
    let existing: UserDataItem | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'NOTIF#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      existing = page.items.find(item => item.entityId === safeId);
      if (existing) break;
      cursor = page.nextStartKey;
    } while (cursor);

    if (!existing) {
      throw new DomainValidationError('NOTIFICATION_NOT_FOUND', `Notification '${safeId}' not found.`, 404);
    }

    const nextRead = patch.read !== undefined ? Boolean(patch.read) : true;
    const nowIso = new Date().toISOString();
    const nextPayload = { ...existing.payload, id: safeId, read: nextRead };
    const res = await this.db.updateItem<UserDataItem>(
      'UserData',
      { pk, sk: existing.sk },
      { payload: nextPayload, updatedAt: nowIso, version: existing.version + 1 },
      { type: 'equals', attr: 'version', value: existing.version }
    );
    const updateStatus = res.response.update?.[0]?.status ?? res.status;
    if (res.httpStatus !== 200 || updateStatus !== 'Success' || !res.updated || !res.item) {
      throw new DomainValidationError('NOTIFICATION_CONCURRENCY_CONFLICT', 'Concurrent update conflict on notification.', 409);
    }
    return res.item;
  }

  async markAllNotificationsRead(actor: AuthoritativeActor): Promise<{
    notifications: Array<Record<string, unknown>>;
    updatedCount: number;
    batchCalls: number;
    atomicBatch: boolean;
  }> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const allNotifications: UserDataItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix: 'NOTIF#',
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      allNotifications.push(...page.items);
      cursor = page.nextStartKey;
    } while (cursor);

    const nowIso = new Date().toISOString();
    const unread = allNotifications.filter(n => !Boolean(n.payload.read));
    if (unread.length === 0) {
      return {
        notifications: allNotifications.map(n => n.payload),
        updatedCount: 0,
        batchCalls: 0,
        atomicBatch: true,
      };
    }

    const updatedItems: UserDataItem[] = unread.map(item => ({
      ...item,
      payload: { ...item.payload, id: item.entityId, read: true },
      updatedAt: nowIso,
      version: item.version + 1,
    }));

    await this.db.deleteBatch('UserData', updatedItems.map(i => ({ pk: i.pk, sk: i.sk })));
    const ins = await this.db.insertBatch('UserData', updatedItems);
    const updatedMap = new Map(updatedItems.map(i => [i.entityId, i.payload]));

    return {
      notifications: allNotifications.map(n => updatedMap.get(n.entityId) ?? n.payload),
      updatedCount: unread.length,
      batchCalls: ins.batchCalls,
      atomicBatch: ins.batchCalls <= 1,
    };
  }
}
