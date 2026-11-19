/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.2 — Hardened Catalyst HTTP Athlete Repository Adapter
 *
 * Strictly bound ONLY to the verified canonical routes in `CLEAN_SLATE_ENDPOINT_CATALOG`.
 * - Runs client-side domain validators before transmitting payloads.
 * - Chunks grocery sync strictly <= 25 items per `PUT /api/v1/athlete/groceries/sync` call.
 * - Reports partial multi-batch failures honestly via `PartialBatchSyncError` (`atomic: false`)
 *   and supports idempotent recovery via `resumeGrocerySyncBatch` without duplicate records.
 * - Never invents unverified `/api/v1/*` routes and never falls back silently to mock data.
 */

import {
  CATALYST_BUDGET_LIMITS,
  type BiometricsPayload,
  type CardioSessionRecord,
  type ExecutedWorkoutRecord,
  type GroceryItemRecord,
  type MealLogRecord,
  type MealPlanRecord,
  type NotificationRecord,
  type PreferencesPayload,
  type RecipeRecord,
  type UserAccountModel,
  type WorkoutRoutineRecord,
  type WorkoutSetRecord,
} from '../contracts/cleanSlateModels';
import {
  CleanSlateRepositoryError,
  PartialBatchSyncError,
  type CleanSlateWorkspaceSnapshot,
  type IAthleteWorkspaceRepository,
  type OnboardingCompletionInput,
} from '../contracts/repositories';
import {
  validateBiometricsInput,
  validateCardioInput,
  validateGroceryInput,
  validateMealLogInput,
  validateMealPlanInput,
  validateNotificationInput,
  validateProfileSelfUpdateInput,
  validateRecipeInput,
  validateWorkoutRoutineInput,
  validateWorkoutSetInput,
} from '../domain/validators';
import { CatalystHttpTransport, type HttpTransportConfig } from './httpTransport';

function unwrapItemList<T>(rawList: unknown): T[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(entry => {
    if (entry && typeof entry === 'object' && 'payload' in entry && typeof (entry as any).payload === 'object') {
      const e = entry as { entityId?: string; id?: string; payload: Record<string, unknown> };
      return {
        ...(e.payload as unknown as T),
        id: (e.payload as { id?: string }).id ?? e.id ?? e.entityId,
      } as T;
    }
    return entry as T;
  });
}

function unwrapSinglePayload<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== 'object') return null;
  if ('payload' in raw && typeof (raw as any).payload === 'object' && (raw as any).payload !== null) {
    const e = raw as { entityId?: string; id?: string; payload: Record<string, unknown> };
    const fallbackId =
      e.payload.id ??
      e.id ??
      (e.entityId && e.entityId !== 'current' && e.entityId !== 'settings' ? e.entityId : undefined);
    return (fallbackId !== undefined ? { ...e.payload, id: fallbackId } : e.payload) as unknown as T;
  }
  return raw as T;
}

function assertSafeIdentifier(id: string, fieldName: string): string {
  const safe = id.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(safe) || safe === '.' || safe.includes('..') || safe.includes('#')) {
    throw new CleanSlateRepositoryError(
      'INVALID_PATH_PARAMETER',
      `El identificador '${fieldName}' contiene caracteres no permitidos o longitud inválida.`,
      400,
      { origin: 'client_synthetic' }
    );
  }
  return safe;
}

export class CatalystHttpAthleteRepository implements IAthleteWorkspaceRepository {
  readonly modeLabel = 'Adaptador HTTP Clean-Slate (contrato Catalyst Advanced I/O — paridad 41 rutas)';
  readonly isLocalDevMock = false;

  private readonly transport: CatalystHttpTransport;

  constructor(configOrTransport: HttpTransportConfig | CatalystHttpTransport) {
    this.transport =
      configOrTransport instanceof CatalystHttpTransport
        ? configOrTransport
        : new CatalystHttpTransport(configOrTransport);
  }

  async hydrateWorkspace(_actorUid: string): Promise<CleanSlateWorkspaceSnapshot> {
    const res = await this.transport.request<{ workspace?: Record<string, unknown> }>({
      method: 'GET',
      path: '/api/v1/athlete/workspace',
    });

    const raw = (res.data?.workspace ?? res.data) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || !raw.profile) {
      throw new CleanSlateRepositoryError(
        'INVALID_WORKSPACE_PAYLOAD',
        'La respuesta de GET /api/v1/athlete/workspace no incluye el perfil obligatorio del atleta.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    return {
      isLocalDevMock: false,
      profile: raw.profile as UserAccountModel,
      biometrics: unwrapSinglePayload<BiometricsPayload>(raw.biometrics),
      preferences: unwrapSinglePayload<PreferencesPayload>(raw.preferences),
      mealLogs: unwrapItemList<MealLogRecord>(raw.mealLogs),
      recipes: unwrapItemList<RecipeRecord>(raw.recipes),
      mealPlans: unwrapItemList<MealPlanRecord>(raw.mealPlans),
      groceries: unwrapItemList<GroceryItemRecord>(raw.groceries),
      workoutRoutines: unwrapItemList<WorkoutRoutineRecord>(raw.workoutRoutines),
      executedWorkouts: unwrapItemList<ExecutedWorkoutRecord>(raw.executedWorkouts),
      workoutSets: unwrapItemList<WorkoutSetRecord>(raw.workoutSets),
      cardioSessions: unwrapItemList<CardioSessionRecord>(raw.cardioSessions),
      notifications: unwrapItemList<NotificationRecord>(raw.notifications),
    };
  }

  async updateOwnProfile(_actorUid: string, patch: Record<string, unknown>): Promise<UserAccountModel> {
    validateProfileSelfUpdateInput(patch);
    const res = await this.transport.request<{ profile: UserAccountModel }>({
      method: 'PATCH',
      path: '/api/v1/athlete/profile',
      body: patch,
    });
    if (!res.data?.profile) {
      throw new CleanSlateRepositoryError(
        'INVALID_PROFILE_RESPONSE',
        'PATCH /api/v1/athlete/profile no devolvió el perfil actualizado.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return res.data.profile;
  }

  async completeOnboarding(
    _actorUid: string,
    input: OnboardingCompletionInput
  ): Promise<{ profile: UserAccountModel; biometrics: BiometricsPayload; preferences: PreferencesPayload }> {
    validateBiometricsInput(input.biometrics as unknown as Record<string, unknown>);
    const res = await this.transport.request<{
      completed?: boolean;
      profile?: UserAccountModel;
      biometrics?: BiometricsPayload;
      preferences?: PreferencesPayload;
    }>({
      method: 'POST',
      path: '/api/v1/athlete/onboarding/complete',
      body: input,
    });

    if (!res.data?.profile) {
      throw new CleanSlateRepositoryError(
        'INVALID_ONBOARDING_RESPONSE',
        'POST /api/v1/athlete/onboarding/complete no devolvió el perfil actualizado.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    return {
      profile: res.data.profile,
      biometrics: res.data.biometrics ?? input.biometrics,
      preferences: res.data.preferences ?? { ...input.preferences, onboardingCompleted: true },
    };
  }

  async queryMealsByDateRange(
    startDateIso: string,
    endDateIso: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: MealLogRecord[]; nextStartKey?: string }> {
    const res = await this.transport.request<{ items?: unknown[]; nextStartKey?: string }>({
      method: 'GET',
      path: '/api/v1/athlete/meals',
      query: {
        startDate: startDateIso,
        endDate: endDateIso,
        limit: Math.min(CATALYST_BUDGET_LIMITS.MAX_QUERY_READ_ITEMS, options.limit ?? 50),
        startKey: options.startKey,
      },
    });
    return {
      items: unwrapItemList<MealLogRecord>(res.data?.items),
      nextStartKey: res.data?.nextStartKey,
    };
  }

  async logMeal(
    _actorUid: string,
    meal: Omit<MealLogRecord, 'id'> & { id?: string }
  ): Promise<MealLogRecord> {
    validateMealLogInput(meal as unknown as Record<string, unknown>);
    if (meal.id !== undefined) {
      assertSafeIdentifier(meal.id, 'meal.id');
    }
    const res = await this.transport.request<{ item?: unknown; meal?: MealLogRecord }>({
      method: 'POST',
      path: '/api/v1/athlete/meals',
      body: meal,
    });
    const unwrapped = res.data?.meal ?? unwrapSinglePayload<MealLogRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_MEAL_RESPONSE',
        'POST /api/v1/athlete/meals no devolvió el registro creado.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async saveRecipe(_actorUid: string, recipe: RecipeRecord): Promise<RecipeRecord> {
    validateRecipeInput(recipe as unknown as Record<string, unknown>);
    const recipeId = assertSafeIdentifier(recipe.id, 'recipeId');
    const res = await this.transport.request<{ item?: unknown; recipe?: RecipeRecord }>({
      method: 'PUT',
      path: `/api/v1/athlete/recipes/${encodeURIComponent(recipeId)}`,
      body: recipe,
    });
    return res.data?.recipe ?? unwrapSinglePayload<RecipeRecord>(res.data?.item) ?? recipe;
  }

  async saveMealPlan(_actorUid: string, plan: MealPlanRecord): Promise<MealPlanRecord> {
    validateMealPlanInput(plan as unknown as Record<string, unknown>);
    const weekStart = assertSafeIdentifier(plan.weekStart, 'weekStart');
    const res = await this.transport.request<{ item?: unknown; mealPlan?: MealPlanRecord }>({
      method: 'PUT',
      path: `/api/v1/athlete/meal-plans/${encodeURIComponent(weekStart)}`,
      body: plan,
    });
    return res.data?.mealPlan ?? unwrapSinglePayload<MealPlanRecord>(res.data?.item) ?? plan;
  }

  /**
   * Synchronizes grocery items in Catalyst <=25 item batches.
   * Multi-batch synchronization is EXPLICITLY non-atomic across HTTP calls:
   * - If batch 0 succeeds and a later batch fails, throws `PartialBatchSyncError` with
   *   `persistedCount`, `completedBatches`, and `remainingItems` so callers can retry
   *   idempotently via `resumeGrocerySyncBatch` without erasing committed batches or duplicating items.
   */
  async syncGroceries(
    _actorUid: string,
    items: GroceryItemRecord[],
    options: { replaceExisting?: boolean; syncId?: string } = {}
  ): Promise<{ groceries: GroceryItemRecord[]; batchCalls: number; atomic: boolean }> {
    for (const item of items) {
      assertSafeIdentifier(item.id, 'grocery.id');
      validateGroceryInput(item as unknown as Record<string, unknown>);
    }

    const syncId =
      options.syncId ?? `sync_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const maxBatch = CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS;
    const chunks: GroceryItemRecord[][] = [];
    for (let i = 0; i < items.length; i += maxBatch) {
      chunks.push(items.slice(i, i + maxBatch));
    }
    if (chunks.length === 0) {
      chunks.push([]);
    }

    const replaceFirstBatch = options.replaceExisting !== false;
    let completedBatches = 0;
    let persistedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        await this.transport.request({
          method: 'PUT',
          path: '/api/v1/athlete/groceries/sync',
          idempotent: true,
          body: {
            items: chunk,
            replaceExisting: i === 0 ? replaceFirstBatch : false,
            batchIndex: i,
            totalBatches: chunks.length,
            syncId,
          },
        });
        completedBatches++;
        persistedCount += chunk.length;
      } catch (err) {
        const cause =
          err instanceof CleanSlateRepositoryError
            ? err
            : new CleanSlateRepositoryError(
                'NETWORK_ERROR',
                err instanceof Error ? err.message : 'Fallo en lote de compras',
                503,
                { origin: 'client_synthetic' }
              );
        if (completedBatches > 0) {
          throw new PartialBatchSyncError({
            syncId,
            totalBatches: chunks.length,
            completedBatches,
            failedBatchIndex: i,
            persistedCount,
            remainingItems: chunks.slice(i).flat(),
            cause,
          });
        }
        throw cause;
      }
    }

    return {
      groceries: items,
      batchCalls: completedBatches,
      atomic: completedBatches <= 1 && replaceFirstBatch,
    };
  }

  /**
   * Resumes a failed multi-batch grocery sync without wiping previously committed batches.
   * Uses `replaceExisting: false` so chunks are idempotently rewritten by `GROCERY#<id>`.
   */
  async resumeGrocerySyncBatch(
    actorUid: string,
    remainingItems: GroceryItemRecord[],
    syncId: string
  ): Promise<{ groceries: GroceryItemRecord[]; batchCalls: number; atomic: boolean }> {
    return this.syncGroceries(actorUid, remainingItems, {
      replaceExisting: false,
      syncId,
    });
  }

  async saveWorkoutRoutine(
    _actorUid: string,
    routine: WorkoutRoutineRecord
  ): Promise<WorkoutRoutineRecord> {
    validateWorkoutRoutineInput(routine as unknown as Record<string, unknown>);
    const routineId = assertSafeIdentifier(routine.id, 'routineId');
    const res = await this.transport.request<{ item?: unknown; routine?: WorkoutRoutineRecord }>({
      method: 'PUT',
      path: `/api/v1/athlete/routines/${encodeURIComponent(routineId)}`,
      body: routine,
    });
    return res.data?.routine ?? unwrapSinglePayload<WorkoutRoutineRecord>(res.data?.item) ?? routine;
  }

  async startExecutedWorkout(
    _actorUid: string,
    input: {
      id?: string;
      routineId?: string;
      routineName: string;
      routineDayId?: string;
      routineDayName: string;
      exercisesSnapshot: ExecutedWorkoutRecord['exercisesSnapshot'];
      startedAt?: string;
    }
  ): Promise<ExecutedWorkoutRecord> {
    if (input.id !== undefined) {
      assertSafeIdentifier(input.id, 'workout.id');
    }
    const startedAt = input.startedAt ?? new Date().toISOString();
    const res = await this.transport.request<{ item?: unknown; workout?: ExecutedWorkoutRecord }>({
      method: 'POST',
      path: '/api/v1/athlete/workouts/start',
      body: { ...input, status: 'in_progress', startedAt },
    });
    const unwrapped = res.data?.workout ?? unwrapSinglePayload<ExecutedWorkoutRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_WORKOUT_RESPONSE',
        'POST /api/v1/athlete/workouts/start no devolvió la sesión iniciada.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async logWorkoutSet(
    _actorUid: string,
    input: Omit<WorkoutSetRecord, 'id' | 'estimated1RM' | 'completedAt'> & {
      id?: string;
      workoutStartedAt?: string;
    }
  ): Promise<WorkoutSetRecord> {
    const workoutId = assertSafeIdentifier(input.executedWorkoutId, 'executedWorkoutId');
    validateWorkoutSetInput(input as unknown as Record<string, unknown>, 'in_progress');
    const res = await this.transport.request<{ item?: unknown; set?: WorkoutSetRecord }>({
      method: 'POST',
      path: `/api/v1/athlete/workouts/${encodeURIComponent(workoutId)}/sets`,
      body: { ...input, executedWorkoutId: workoutId },
    });
    const unwrapped = res.data?.set ?? unwrapSinglePayload<WorkoutSetRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_WORKOUT_SET_RESPONSE',
        'POST /api/v1/athlete/workouts/:workoutId/sets no devolvió la serie registrada.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async completeExecutedWorkout(
    _actorUid: string,
    workoutId: string,
    finalStatus: 'completed' | 'abandoned',
    summary: { durationSeconds: number; sessionRpe?: number; notes?: string; startedAt?: string }
  ): Promise<ExecutedWorkoutRecord> {
    const safeId = assertSafeIdentifier(workoutId, 'workoutId');
    const res = await this.transport.request<{ item?: unknown; workout?: ExecutedWorkoutRecord }>({
      method: 'POST',
      path: `/api/v1/athlete/workouts/${encodeURIComponent(safeId)}/complete`,
      body: { finalStatus, ...summary },
    });
    const unwrapped = res.data?.workout ?? unwrapSinglePayload<ExecutedWorkoutRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_WORKOUT_COMPLETE_RESPONSE',
        'POST /api/v1/athlete/workouts/:workoutId/complete no devolvió el estado final.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async addCardioSession(
    _actorUid: string,
    session: Omit<CardioSessionRecord, 'id'> & { id?: string }
  ): Promise<CardioSessionRecord> {
    validateCardioInput(session as unknown as Record<string, unknown>);
    if (session.id !== undefined) {
      assertSafeIdentifier(session.id, 'cardio.id');
    }
    const res = await this.transport.request<{ item?: unknown; cardio?: CardioSessionRecord }>({
      method: 'POST',
      path: '/api/v1/athlete/cardio',
      body: session,
    });
    const unwrapped = res.data?.cardio ?? unwrapSinglePayload<CardioSessionRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_CARDIO_RESPONSE',
        'POST /api/v1/athlete/cardio no devolvió la sesión creada.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async createNotification(
    _actorUid: string,
    notification: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'> & { id?: string }
  ): Promise<NotificationRecord> {
    validateNotificationInput(notification as unknown as Record<string, unknown>);
    if (notification.id !== undefined) {
      assertSafeIdentifier(notification.id, 'notification.id');
    }
    const res = await this.transport.request<{ item?: unknown; notification?: NotificationRecord }>({
      method: 'POST',
      path: '/api/v1/athlete/notifications',
      body: notification,
    });
    const unwrapped =
      res.data?.notification ?? unwrapSinglePayload<NotificationRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_NOTIFICATION_RESPONSE',
        'POST /api/v1/athlete/notifications no devolvió la notificación creada.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  // ==================== PHASE 4.2.3: 11 RECONCILED ATHLETE ENDPOINTS ====================

  async saveBiometrics(_actorUid: string, payload: BiometricsPayload): Promise<BiometricsPayload> {
    validateBiometricsInput(payload as unknown as Record<string, unknown>);
    const res = await this.transport.request<{ item?: unknown; biometrics?: BiometricsPayload }>({
      method: 'PUT',
      path: '/api/v1/athlete/biometrics',
      body: payload,
    });
    return res.data?.biometrics ?? unwrapSinglePayload<BiometricsPayload>(res.data?.item) ?? payload;
  }

  async savePreferences(_actorUid: string, payload: PreferencesPayload): Promise<PreferencesPayload> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CleanSlateRepositoryError(
        'INVALID_PREFERENCES',
        'El objeto de preferencias es inválido.',
        400,
        { origin: 'client_synthetic' }
      );
    }
    const res = await this.transport.request<{ item?: unknown; preferences?: PreferencesPayload }>({
      method: 'PUT',
      path: '/api/v1/athlete/preferences',
      body: payload,
    });
    return res.data?.preferences ?? unwrapSinglePayload<PreferencesPayload>(res.data?.item) ?? payload;
  }

  async deleteMeal(_actorUid: string, mealId: string): Promise<void> {
    const safeId = assertSafeIdentifier(mealId, 'mealId');
    await this.transport.request<{ deleted?: boolean }>({
      method: 'DELETE',
      path: `/api/v1/athlete/meals/${encodeURIComponent(safeId)}`,
    });
  }

  async deleteRecipe(_actorUid: string, recipeId: string): Promise<void> {
    const safeId = assertSafeIdentifier(recipeId, 'recipeId');
    await this.transport.request<{ deleted?: boolean }>({
      method: 'DELETE',
      path: `/api/v1/athlete/recipes/${encodeURIComponent(safeId)}`,
    });
  }

  async toggleGroceryStatus(_actorUid: string, groceryId: string): Promise<GroceryItemRecord> {
    const safeId = assertSafeIdentifier(groceryId, 'groceryId');
    const res = await this.transport.request<{ item?: unknown; grocery?: GroceryItemRecord }>({
      method: 'PATCH',
      path: `/api/v1/athlete/groceries/${encodeURIComponent(safeId)}`,
      body: {},
    });
    const unwrapped = res.data?.grocery ?? unwrapSinglePayload<GroceryItemRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_GROCERY_RESPONSE',
        'PATCH /api/v1/athlete/groceries/:groceryId no devolvió el artículo actualizado.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async addManualGrocery(
    _actorUid: string,
    item: Omit<GroceryItemRecord, 'id'> & { id?: string }
  ): Promise<GroceryItemRecord> {
    validateGroceryInput(item as unknown as Record<string, unknown>);
    if (item.id !== undefined) {
      assertSafeIdentifier(item.id, 'grocery.id');
    }
    const res = await this.transport.request<{ item?: unknown; grocery?: GroceryItemRecord }>({
      method: 'POST',
      path: '/api/v1/athlete/groceries',
      body: item,
    });
    const unwrapped = res.data?.grocery ?? unwrapSinglePayload<GroceryItemRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_GROCERY_RESPONSE',
        'POST /api/v1/athlete/groceries no devolvió el artículo creado.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async deleteGrocery(_actorUid: string, groceryId: string): Promise<void> {
    const safeId = assertSafeIdentifier(groceryId, 'groceryId');
    await this.transport.request<{ deleted?: boolean }>({
      method: 'DELETE',
      path: `/api/v1/athlete/groceries/${encodeURIComponent(safeId)}`,
    });
  }

  async setDefaultRoutine(_actorUid: string, routineId: string): Promise<WorkoutRoutineRecord[]> {
    const safeId = assertSafeIdentifier(routineId, 'routineId');
    const res = await this.transport.request<{ routines?: unknown[] }>({
      method: 'POST',
      path: `/api/v1/athlete/routines/${encodeURIComponent(safeId)}/default`,
      body: {},
    });
    return unwrapItemList<WorkoutRoutineRecord>(res.data?.routines);
  }

  async deleteCardioSession(_actorUid: string, cardioId: string): Promise<void> {
    const safeId = assertSafeIdentifier(cardioId, 'cardioId');
    await this.transport.request<{ deleted?: boolean }>({
      method: 'DELETE',
      path: `/api/v1/athlete/cardio/${encodeURIComponent(safeId)}`,
    });
  }

  async markNotificationRead(
    _actorUid: string,
    notificationId: string,
    read = true
  ): Promise<NotificationRecord> {
    const safeId = assertSafeIdentifier(notificationId, 'notificationId');
    const res = await this.transport.request<{ item?: unknown; notification?: NotificationRecord }>({
      method: 'PATCH',
      path: `/api/v1/athlete/notifications/${encodeURIComponent(safeId)}/read`,
      body: { read },
    });
    const unwrapped =
      res.data?.notification ?? unwrapSinglePayload<NotificationRecord>(res.data?.item);
    if (!unwrapped) {
      throw new CleanSlateRepositoryError(
        'INVALID_NOTIFICATION_RESPONSE',
        'PATCH /api/v1/athlete/notifications/:notificationId/read no devolvió la notificación actualizada.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    return unwrapped;
  }

  async markAllNotificationsRead(_actorUid: string): Promise<NotificationRecord[]> {
    const res = await this.transport.request<{ notifications?: unknown[] }>({
      method: 'POST',
      path: '/api/v1/athlete/notifications/read-all',
      body: {},
    });
    return unwrapItemList<NotificationRecord>(res.data?.notifications);
  }
}
