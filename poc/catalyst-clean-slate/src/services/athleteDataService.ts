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
import type { ICleanSlateNoSQLAdapter, QueryPageResult } from '../nosql/cleanSlateEngine.js';
import {
  assertExecutedWorkoutMutable,
  DomainValidationError,
  normalizeMealLogInput,
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
  validateWorkoutCompleteSummary,
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

function clampQueryLimit(limit?: number): number {
  const raw = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : 50;
  return Math.min(Math.max(1, raw), CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS);
}

function normalizeAndEnrichBiometrics(payload: Record<string, unknown>): Record<string, unknown> {
  const weightKg = Number(payload.weightKg);
  const heightCm = Number(payload.heightCm);
  const age = Number(payload.age);
  const palFactor = Number(payload.palFactor);
  const targetDeltaKcal =
    typeof payload.targetDeltaKcal === 'number' && Number.isFinite(payload.targetDeltaKcal)
      ? payload.targetDeltaKcal
      : 0;
  const proteinPerKg =
    typeof payload.proteinPerKg === 'number' && Number.isFinite(payload.proteinPerKg)
      ? payload.proteinPerKg
      : 2.0;
  const fatPerKg =
    typeof payload.fatPerKg === 'number' && Number.isFinite(payload.fatPerKg)
      ? payload.fatPerKg
      : 0.9;

  const bmr =
    typeof payload.bmr === 'number' && Number.isFinite(payload.bmr)
      ? payload.bmr
      : Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
  const tdee =
    typeof payload.tdee === 'number' && Number.isFinite(payload.tdee)
      ? payload.tdee
      : Math.round(bmr * palFactor);

  const hasExplicitMacros =
    typeof payload.targetCalories === 'number' &&
    Number.isFinite(payload.targetCalories) &&
    typeof payload.targetProteinG === 'number' &&
    Number.isFinite(payload.targetProteinG) &&
    typeof payload.targetFatG === 'number' &&
    Number.isFinite(payload.targetFatG) &&
    typeof payload.targetCarbsG === 'number' &&
    Number.isFinite(payload.targetCarbsG);

  if (hasExplicitMacros) {
    return {
      ...payload,
      targetDeltaKcal,
      proteinPerKg,
      fatPerKg,
      bmr,
      tdee,
    };
  }

  const targetCalories =
    typeof payload.targetCalories === 'number' && Number.isFinite(payload.targetCalories)
      ? Math.round(payload.targetCalories)
      : Math.max(1200, Math.round(tdee + targetDeltaKcal));
  const targetProteinG = Math.max(0, Math.round(weightKg * proteinPerKg));
  let targetFatG = Math.max(0, Math.round(weightKg * fatPerKg));

  // Diophantine reconciliation: align (targetCalories - targetFatG * 9 - targetProteinG * 4) to multiple of 4
  const residual = targetCalories - targetProteinG * 4 - targetFatG * 9;
  const mod4 = ((residual % 4) + 4) % 4;
  if (mod4 !== 0) {
    // Because 9 ≡ 1 (mod 4), subtracting `mod4` from targetFatG leaves remainder ≡ 0 (mod 4)
    const adjustFat = targetFatG >= mod4 ? -mod4 : 4 - mod4;
    targetFatG = Math.max(0, targetFatG + adjustFat);
  }
  const targetCarbsG = Math.max(0, Math.floor((targetCalories - targetProteinG * 4 - targetFatG * 9) / 4));
  const reconciledCalories = targetProteinG * 4 + targetCarbsG * 4 + targetFatG * 9;

  return {
    ...payload,
    targetDeltaKcal,
    proteinPerKg,
    fatPerKg,
    bmr,
    tdee,
    targetCalories: reconciledCalories,
    targetProteinG,
    targetFatG,
    targetCarbsG,
  };
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

  private async queryAllBySortPrefix(pk: string, sortKeyPrefix: string): Promise<UserDataItem[]> {
    const collected: UserDataItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.db.queryTable<UserDataItem>('UserData', {
        partitionKeyValue: pk,
        sortKeyPrefix,
        limit: CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        startKey: cursor,
        consistent_read: true,
      });
      collected.push(...page.items);
      cursor = page.nextStartKey;
    } while (cursor);
    return collected;
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
    const resolvedDisplayName = patch.displayName ?? patch.name;
    if (resolvedDisplayName !== undefined) safeUpdates.displayName = String(resolvedDisplayName).trim();
    if (patch.avatarUrl !== undefined) safeUpdates.avatarUrl = String(patch.avatarUrl).trim();
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
    const resolvedDisplayName = String(input.displayName ?? (input as any).name ?? '').trim();
    validateOnboardingPayload({
      ...input,
      displayName: resolvedDisplayName,
    } as unknown as Record<string, unknown>);
    validateBiometricsPayload(input.biometrics);
    validatePreferencesPayload(input.preferences);

    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const enrichedBiometrics = normalizeAndEnrichBiometrics(input.biometrics);

    const bioItem: UserDataItem = {
      pk,
      sk: KeyBuilders.biometricsSk(),
      uid: actor.catalystUserId,
      entityType: 'BIOMETRICS',
      entityId: 'current',
      entityDateKey: `BIOMETRICS#${nowIso}#current`,
      payload: enrichedBiometrics,
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
        displayName: resolvedDisplayName,
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
    const normalized = normalizeMealLogInput(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const nowIso = new Date().toISOString();
    const dateTimeIso = String(payload.dateTime);

    const normalizedPayload: Record<string, unknown> = {
      ...payload,
      id: safeId,
      name: String(normalized.name).trim(),
      kcal: Number(normalized.kcal),
      protein: Number(normalized.protein),
      carbs: Number(normalized.carbs),
      fat: Number(normalized.fat),
    };
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
    const safeLimit = clampQueryLimit(limit);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyBetween: [`MEAL#${startDateIso}`, `MEAL#${endDateIso}\uffff`],
      limit: safeLimit,
      startKey,
      consistent_read: true,
    });
  }

  async listGroceries(
    actor: AuthoritativeActor,
    options: { status?: string; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const safeLimit = clampQueryLimit(options.limit);
    if (options.status) {
      const all = await this.queryAllBySortPrefix(pk, 'GROCERY#');
      const filtered = all.filter(item => String(item.payload.status || 'pending') === options.status);
      const offset = options.startKey ? Number(Buffer.from(options.startKey, 'base64url').toString('utf8')) : 0;
      const items = filtered.slice(offset, offset + safeLimit);
      const nextStartKey =
        offset + safeLimit < filtered.length
          ? Buffer.from(String(offset + safeLimit), 'utf8').toString('base64url')
          : undefined;
      return { items, nextStartKey };
    }
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'GROCERY#',
      limit: safeLimit,
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async clearCompletedGroceries(actor: AuthoritativeActor): Promise<{
    deletedCount: number;
    batchCalls: number;
    atomicBatch: boolean;
  }> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const all = await this.queryAllBySortPrefix(pk, 'GROCERY#');
    const completed = all.filter(item => {
      const st = String(item.payload.status || 'pending');
      return st === 'bought' || st === 'completed';
    });
    if (completed.length === 0) {
      return { deletedCount: 0, batchCalls: 0, atomicBatch: true };
    }
    const res = await this.db.deleteBatch(
      'UserData',
      completed.map(item => ({ pk: item.pk, sk: item.sk }))
    );
    return {
      deletedCount: res.count,
      batchCalls: res.batchCalls,
      atomicBatch: res.batchCalls <= 1,
    };
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
      const existing = await this.queryAllBySortPrefix(pk, 'GROCERY#');
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

  async listExecutedWorkouts(
    actor: AuthoritativeActor,
    options: {
      status?: 'in_progress' | 'completed' | 'abandoned';
      startDate?: string;
      endDate?: string;
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const safeLimit = clampQueryLimit(options.limit);

    if (options.startDate || options.endDate) {
      if (!options.startDate || !options.endDate || options.startDate > options.endDate) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Both startDate and endDate (startDate <= endDate) are required for date range queries.',
          400
        );
      }
      const page = await this.db.queryIndex<UserDataItem>('UserData', {
        indexName: 'GSI_UserEntityDate',
        partitionKeyValue: pk,
        sortKeyBetween: [
          `EXECUTED_WORKOUT#${options.startDate}`,
          `EXECUTED_WORKOUT#${options.endDate}\uffff`,
        ],
        scanDescending: true,
        limit: safeLimit,
        startKey: options.startKey,
      });
      if (options.status) {
        return {
          items: page.items.filter(item => item.payload.status === options.status),
          nextStartKey: page.nextStartKey,
        };
      }
      return page;
    }

    if (options.status) {
      const all = await this.queryAllBySortPrefix(pk, 'WORKOUT#');
      const filtered = all
        .filter(item => item.payload.status === options.status)
        .sort((a, b) => String(b.payload.startedAt || b.createdAt).localeCompare(String(a.payload.startedAt || a.createdAt)));
      const offset = options.startKey ? Number(Buffer.from(options.startKey, 'base64url').toString('utf8')) : 0;
      const items = filtered.slice(offset, offset + safeLimit);
      const nextStartKey =
        offset + safeLimit < filtered.length
          ? Buffer.from(String(offset + safeLimit), 'utf8').toString('base64url')
          : undefined;
      return { items, nextStartKey };
    }

    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'WORKOUT#',
      scanDescending: true,
      limit: safeLimit,
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async getExecutedWorkoutDetail(
    actor: AuthoritativeActor,
    workoutId: string
  ): Promise<{ workout: Record<string, unknown>; sets: Array<Record<string, unknown>>; item: UserDataItem }> {
    const safeWorkoutId = validateSafeIdentifier(workoutId, 'workoutId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const workoutItem = await this.findExecutedWorkoutById(pk, safeWorkoutId);
    if (!workoutItem) {
      throw new DomainValidationError('WORKOUT_NOT_FOUND', 'ExecutedWorkout not found.', 404);
    }
    const sets = await this.queryAllBySortPrefix(pk, `SET#${safeWorkoutId}#`);
    sets.sort((a, b) => {
      const setNumA = Number(a.payload.setNumber ?? 0);
      const setNumB = Number(b.payload.setNumber ?? 0);
      if (setNumA !== setNumB) return setNumA - setNumB;
      return String(a.payload.completedAt || a.createdAt).localeCompare(String(b.payload.completedAt || b.createdAt));
    });
    return {
      workout: workoutItem.payload,
      sets: sets.map(s => s.payload),
      item: workoutItem,
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

    // Single active session invariant (mirrors frontend domain policy)
    const allWorkouts = await this.queryAllBySortPrefix(pk, 'WORKOUT#');
    const otherActive = allWorkouts.find(w => w.payload.status === 'in_progress');
    if (otherActive) {
      throw new DomainValidationError(
        'ACTIVE_WORKOUT_ALREADY_OPEN',
        `Another workout '${otherActive.entityId}' is currently in_progress. Complete or abandon it before starting another.`,
        409
      );
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
    const setSk = KeyBuilders.workoutSetSk(executedWorkoutId, safeSetId);

    // Idempotent offline sync replay guard for deterministic client set IDs
    const existingSet = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk: setSk }, { consistent_read: true });
    if (existingSet) {
      return existingSet;
    }

    const parent = await this.findExecutedWorkoutById(pk, executedWorkoutId, workoutStartedAt);
    const parentStatus = parent ? String(parent.payload.status || '') : null;

    validateWorkoutSetPayload(payload, parentStatus);

    const weightKg = Number(payload.weightKg);
    const reps = Number(payload.reps);
    const setType = typeof payload.type === 'string' && payload.type ? payload.type : 'effective';
    const completed = payload.completed !== false;
    const computed1RM =
      setType === 'warmup'
        ? 0
        : reps === 1
          ? weightKg
          : Math.round(weightKg * (1 + reps / 30) * 10) / 10;

    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk: setSk,
      uid: actor.catalystUserId,
      entityType: 'WORKOUT_SET',
      entityId: safeSetId,
      entityDateKey: `WORKOUT_SET#${nowIso}#${safeSetId}`,
      payload: {
        ...payload,
        id: safeSetId,
        executedWorkoutId,
        type: setType,
        completed,
        estimated1RM: computed1RM,
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
    validateWorkoutCompleteSummary(summaryPatch);

    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const existing = await this.findExecutedWorkoutById(pk, safeWorkoutId, startedAt);

    if (!existing) {
      throw new DomainValidationError('WORKOUT_NOT_FOUND', 'ExecutedWorkout not found.', 404);
    }
    assertExecutedWorkoutMutable(String(existing.payload.status || ''));

    // Authoritative server-side summary aggregation strictly excluding warmup sets
    const persistedSets = await this.queryAllBySortPrefix(pk, `SET#${safeWorkoutId}#`);
    const workingSets = persistedSets.filter(s => s.payload.completed !== false && s.payload.type !== 'warmup');
    const warmupSets = persistedSets.filter(s => s.payload.type === 'warmup');

    const totalTonnageKg = workingSets.reduce(
      (sum, s) => sum + Math.round(Number(s.payload.weightKg || 0) * Number(s.payload.reps || 0)),
      0
    );
    const totalCompletedSets = workingSets.length;
    const totalReps = workingSets.reduce((sum, s) => sum + Number(s.payload.reps || 0), 0);
    const averageRir =
      workingSets.length > 0
        ? Math.round((workingSets.reduce((sum, s) => sum + Number(s.payload.rir || 0), 0) / workingSets.length) * 10) / 10
        : null;

    const nowIso = new Date().toISOString();
    const nextPayload = {
      ...existing.payload,
      ...summaryPatch,
      id: safeWorkoutId,
      status: finalStatus,
      completedAt: nowIso,
      totalTonnageKg,
      totalCompletedSets,
      totalReps,
      averageRir,
      totalWarmupSets: warmupSets.length,
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

  async listCardioSessions(
    actor: AuthoritativeActor,
    options: { startDate?: string; endDate?: string; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const safeLimit = clampQueryLimit(options.limit);

    if (options.startDate || options.endDate) {
      if (!options.startDate || !options.endDate || options.startDate > options.endDate) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Both startDate and endDate (startDate <= endDate) are required for date range queries.',
          400
        );
      }
      return this.db.queryIndex<UserDataItem>('UserData', {
        indexName: 'GSI_UserEntityDate',
        partitionKeyValue: pk,
        sortKeyBetween: [
          `CARDIO_SESSION#${options.startDate}`,
          `CARDIO_SESSION#${options.endDate}\uffff`,
        ],
        scanDescending: true,
        limit: safeLimit,
        startKey: options.startKey,
      });
    }

    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'CARDIO#',
      scanDescending: true,
      limit: safeLimit,
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async addCardioSession(actor: AuthoritativeActor, cardioId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(cardioId, 'cardioId');
    validateCardioPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const dateIso = String(payload.date);
    const nowIso = new Date().toISOString();
    const avgHeartRate = payload.avgHeartRate ?? payload.avgHr;
    const maxHeartRate = payload.maxHeartRate ?? payload.maxHr;

    const normalizedPayload: Record<string, unknown> = {
      ...payload,
      id: safeId,
      ...(avgHeartRate !== undefined ? { avgHeartRate: Number(avgHeartRate) } : {}),
      ...(maxHeartRate !== undefined ? { maxHeartRate: Number(maxHeartRate) } : {}),
    };

    const item: UserDataItem = {
      pk,
      sk: KeyBuilders.cardioSk(dateIso, safeId),
      uid: actor.catalystUserId,
      entityType: 'CARDIO_SESSION',
      entityId: safeId,
      entityDateKey: `CARDIO_SESSION#${dateIso}#${safeId}`,
      payload: normalizedPayload,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async listNotifications(
    actor: AuthoritativeActor,
    options: { unreadOnly?: boolean; startDate?: string; endDate?: string; limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const safeLimit = clampQueryLimit(options.limit);

    if (options.startDate || options.endDate) {
      if (!options.startDate || !options.endDate || options.startDate > options.endDate) {
        throw new DomainValidationError(
          'INVALID_QUERY_PARAMETER',
          'Both startDate and endDate (startDate <= endDate) are required for date range queries.',
          400
        );
      }
      const page = await this.db.queryIndex<UserDataItem>('UserData', {
        indexName: 'GSI_UserEntityDate',
        partitionKeyValue: pk,
        sortKeyBetween: [
          `NOTIFICATION#${options.startDate}`,
          `NOTIFICATION#${options.endDate}\uffff`,
        ],
        scanDescending: true,
        limit: safeLimit,
        startKey: options.startKey,
      });
      if (options.unreadOnly) {
        return {
          items: page.items.filter(n => !Boolean(n.payload.read)),
          nextStartKey: page.nextStartKey,
        };
      }
      return page;
    }

    if (options.unreadOnly) {
      const all = await this.queryAllBySortPrefix(pk, 'NOTIF#');
      const filtered = all
        .filter(n => !Boolean(n.payload.read))
        .sort((a, b) => b.sk.localeCompare(a.sk));
      const offset = options.startKey ? Number(Buffer.from(options.startKey, 'base64url').toString('utf8')) : 0;
      const items = filtered.slice(offset, offset + safeLimit);
      const nextStartKey =
        offset + safeLimit < filtered.length
          ? Buffer.from(String(offset + safeLimit), 'utf8').toString('base64url')
          : undefined;
      return { items, nextStartKey };
    }

    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'NOTIF#',
      scanDescending: true,
      limit: safeLimit,
      startKey: options.startKey,
      consistent_read: true,
    });
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

  async deleteNotification(
    actor: AuthoritativeActor,
    notificationId: string
  ): Promise<{ deleted: boolean; notificationId: string }> {
    const safeId = validateSafeIdentifier(notificationId, 'notificationId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const all = await this.queryAllBySortPrefix(pk, 'NOTIF#');
    const found = all.find(item => item.entityId === safeId);
    if (!found) {
      return { deleted: false, notificationId: safeId };
    }
    const res = await this.db.deleteItem('UserData', { pk, sk: found.sk });
    return { deleted: res.deleted, notificationId: safeId };
  }

  async listRecipes(
    actor: AuthoritativeActor,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'RECIPE#',
      limit: clampQueryLimit(options.limit),
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async saveRecipe(actor: AuthoritativeActor, recipeId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(recipeId, 'recipeId');
    validateRecipePayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.recipeSk(safeId);
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'RECIPE',
      entityId: safeId,
      entityDateKey: `RECIPE#${nowIso}#${safeId}`,
      payload: { ...payload, id: safeId, updatedAt: nowIso },
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async listMealPlans(
    actor: AuthoritativeActor,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'PLAN#',
      scanDescending: true,
      limit: clampQueryLimit(options.limit),
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async saveMealPlan(actor: AuthoritativeActor, weekStart: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeWeekStart = validateSafeIdentifier(weekStart, 'weekStart');
    validateMealPlanPayload({ ...payload, weekStart: safeWeekStart });
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.mealPlanSk(safeWeekStart);
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'MEAL_PLAN',
      entityId: safeWeekStart,
      entityDateKey: `MEAL_PLAN#${safeWeekStart}#${safeWeekStart}`,
      payload: { ...payload, weekStart: safeWeekStart, updatedAt: nowIso },
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async listWorkoutRoutines(
    actor: AuthoritativeActor,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<QueryPageResult<UserDataItem>> {
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    return this.db.queryTable<UserDataItem>('UserData', {
      partitionKeyValue: pk,
      sortKeyPrefix: 'ROUTINE#',
      limit: clampQueryLimit(options.limit),
      startKey: options.startKey,
      consistent_read: true,
    });
  }

  async saveWorkoutRoutine(actor: AuthoritativeActor, routineId: string, payload: Record<string, unknown>): Promise<UserDataItem> {
    const safeId = validateSafeIdentifier(routineId, 'routineId');
    validateWorkoutRoutinePayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.routineSk(safeId);
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();

    if (payload.isDefault === true) {
      const otherRoutines = (await this.queryAllBySortPrefix(pk, 'ROUTINE#')).filter(
        r => r.entityId !== safeId && Boolean(r.payload.isDefault)
      );
      if (otherRoutines.length > 0) {
        const cleared = otherRoutines.map(r => ({
          ...r,
          payload: { ...r.payload, id: r.entityId, isDefault: false, updatedAt: nowIso },
          updatedAt: nowIso,
          version: r.version + 1,
        }));
        await this.db.deleteBatch('UserData', cleared.map(i => ({ pk: i.pk, sk: i.sk })));
        await this.db.insertBatch('UserData', cleared);
      }
    }

    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'WORKOUT_ROUTINE',
      entityId: safeId,
      entityDateKey: `WORKOUT_ROUTINE#${nowIso}#${safeId}`,
      payload: { ...payload, id: safeId, updatedAt: nowIso },
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      version: (existing?.version ?? 0) + 1,
    };
    await this.db.insertItem('UserData', item);
    return item;
  }

  async deleteWorkoutRoutine(
    actor: AuthoritativeActor,
    routineId: string
  ): Promise<{ deleted: boolean; routineId: string }> {
    const safeId = validateSafeIdentifier(routineId, 'routineId');
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const res = await this.db.deleteItem('UserData', { pk, sk: KeyBuilders.routineSk(safeId) });
    return { deleted: res.deleted, routineId: safeId };
  }

  async saveBiometrics(actor: AuthoritativeActor, payload: Record<string, unknown>): Promise<UserDataItem> {
    validateBiometricsPayload(payload);
    const pk = KeyBuilders.userPk(actor.catalystUserId);
    const sk = KeyBuilders.biometricsSk();
    const existing = await this.db.fetchItem<UserDataItem>('UserData', { pk, sk }, { consistent_read: true });
    const nowIso = new Date().toISOString();
    const enrichedPayload = normalizeAndEnrichBiometrics(payload);
    const item: UserDataItem = {
      pk,
      sk,
      uid: actor.catalystUserId,
      entityType: 'BIOMETRICS',
      entityId: 'current',
      entityDateKey: `BIOMETRICS#${nowIso}#current`,
      payload: enrichedPayload,
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
    const all = await this.queryAllBySortPrefix(pk, 'MEAL#');
    const found = all.find(item => item.entityId === safeId);

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

    const editFieldKeys = ['name', 'quantity', 'unit', 'department', 'notes', 'isCustomized', 'calculatedQuantity'] as const;
    const hasEditFields = editFieldKeys.some(k => patch[k] !== undefined);
    const currentStatus = String(existing.payload.status || 'pending');
    const nextStatus =
      patch.status !== undefined
        ? String(patch.status)
        : hasEditFields
          ? currentStatus
          : currentStatus === 'bought'
            ? 'pending'
            : 'bought';

    const nowIso = new Date().toISOString();
    const nextPayload: Record<string, unknown> = {
      ...existing.payload,
      ...(patch.name !== undefined ? { name: String(patch.name).trim() } : {}),
      ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
      ...(patch.calculatedQuantity !== undefined ? { calculatedQuantity: patch.calculatedQuantity } : {}),
      ...(patch.unit !== undefined ? { unit: String(patch.unit).trim() } : {}),
      ...(patch.department !== undefined ? { department: String(patch.department).trim() } : {}),
      ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
      ...(patch.isCustomized !== undefined ? { isCustomized: Boolean(patch.isCustomized) } : {}),
      id: safeId,
      status: nextStatus,
    };

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
    const allRoutines = await this.queryAllBySortPrefix(pk, 'ROUTINE#');

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
    const all = await this.queryAllBySortPrefix(pk, 'CARDIO#');
    const found = all.find(item => item.entityId === safeId);

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
    const all = await this.queryAllBySortPrefix(pk, 'NOTIF#');
    const existing = all.find(item => item.entityId === safeId);

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
    const allNotifications = await this.queryAllBySortPrefix(pk, 'NOTIF#');

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
