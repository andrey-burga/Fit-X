/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — In-Memory Mock Implementation of Clean-Slate Repositories
 *
 * IMPORTANT:
 * - Strictly non-persistent in-memory development mock (`isLocalDevMock = true`).
 * - Simulates loading delays, empty states, and repository errors cleanly.
 * - Enforces all frozen Clean-Slate domain & RBAC constraints locally without issuing real
 *   cookies, tokens, or remote Catalyst/Firebase requests.
 */

import {
  CATALYST_BUDGET_LIMITS,
  type AccountStatus,
  type AdminInvitationModel,
  type AdminStatsModel,
  type AuditLogModel,
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
  type UserRole,
  type WorkoutRoutineRecord,
  type WorkoutSetRecord,
} from '../contracts/cleanSlateModels';
import {
  CleanSlateRepositoryError,
  type AdminDirectoryFilter,
  type CleanSlateWorkspaceSnapshot,
  type IAdminGovernanceRepository,
  type IAthleteWorkspaceRepository,
  type MockFaultMode,
  type OnboardingCompletionInput,
} from '../contracts/repositories';
import {
  assertExecutedWorkoutMutable,
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
import { calculateAverageRir, calculateEffectiveSetsCount, calculateEffectiveTonnage, calculateEpley1RM } from '../domain/workoutEngine';
import { createInitialMockDatabase, type MockDatabaseState } from './seedData';

export interface MockRepositoryOptions {
  delayMs?: number;
  faultMode?: MockFaultMode;
  allowSuperadminMutationsForTest?: boolean;
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

export class InMemoryCleanSlateRepository
  implements IAthleteWorkspaceRepository, IAdminGovernanceRepository
{
  readonly modeLabel = 'Datos locales en memoria (Mock de desarrollo — sin conexión a Catalyst)';
  readonly isLocalDevMock = true;

  private db: MockDatabaseState;
  private delayMs: number;
  private faultMode: MockFaultMode;
  private allowSuperadminMutations: boolean;

  constructor(options: MockRepositoryOptions = {}) {
    this.db = createInitialMockDatabase();
    this.delayMs = options.delayMs ?? 0;
    this.faultMode = options.faultMode ?? 'none';
    this.allowSuperadminMutations = Boolean(options.allowSuperadminMutationsForTest);
  }

  setDelayMs(ms: number): void {
    this.delayMs = Math.max(0, ms);
  }

  setFaultMode(mode: MockFaultMode): void {
    this.faultMode = mode;
  }

  getFaultMode(): MockFaultMode {
    return this.faultMode;
  }

  resetSeed(): void {
    this.db = createInitialMockDatabase();
    this.faultMode = 'none';
  }

  private async simulateLatencyAndFaults(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }
    if (this.faultMode === 'network_error') {
      throw new CleanSlateRepositoryError(
        'MOCK_SIMULATED_NETWORK_ERROR',
        'Error simulado de conectividad con el backend (modo de prueba de resiliencia UI).',
        503
      );
    }
  }

  private requireUser(uid: string): UserAccountModel {
    const user = this.db.users.find(u => u.uid === uid);
    if (!user) {
      throw new CleanSlateRepositoryError('USER_NOT_FOUND', `Usuario '${uid}' no existe en mock local.`, 404);
    }
    return user;
  }

  private assertAdminRole(actorUid: string, allowedRoles: UserRole[] = ['admin', 'superadmin']): UserAccountModel {
    const actor = this.requireUser(actorUid);
    if (actor.accountStatus !== 'active') {
      throw new CleanSlateRepositoryError('ACCOUNT_SUSPENDED', 'Tu cuenta está suspendida.', 403);
    }
    if (!allowedRoles.includes(actor.role)) {
      throw new CleanSlateRepositoryError(
        'PERMISSION_DENIED',
        `El rol '${actor.role}' no tiene autorización para esta acción administrativa.`,
        403
      );
    }
    return actor;
  }

  private appendAuditLog(entry: Omit<AuditLogModel, 'eventId' | 'timestamp'>): void {
    const item: AuditLogModel = {
      eventId: `aud_mock_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.db.auditLogs.unshift(item);
  }

  async hydrateWorkspace(actorUid: string): Promise<CleanSlateWorkspaceSnapshot> {
    await this.simulateLatencyAndFaults();
    const profile = this.requireUser(actorUid);

    if (this.faultMode === 'empty_workspace') {
      return deepClone({
        isLocalDevMock: true,
        profile,
        biometrics: null,
        preferences: null,
        mealLogs: [],
        recipes: [],
        mealPlans: [],
        groceries: [],
        workoutRoutines: [],
        executedWorkouts: [],
        workoutSets: [],
        cardioSessions: [],
        notifications: [],
      });
    }

    return deepClone({
      isLocalDevMock: true,
      profile,
      biometrics: this.db.biometricsByUid[actorUid] ?? null,
      preferences: this.db.preferencesByUid[actorUid] ?? null,
      mealLogs: this.db.mealLogsByUid[actorUid] ?? [],
      recipes: this.db.recipesByUid[actorUid] ?? [],
      mealPlans: this.db.mealPlansByUid[actorUid] ?? [],
      groceries: this.db.groceriesByUid[actorUid] ?? [],
      workoutRoutines: this.db.routinesByUid[actorUid] ?? [],
      executedWorkouts: this.db.executedWorkoutsByUid[actorUid] ?? [],
      workoutSets: this.db.workoutSetsByUid[actorUid] ?? [],
      cardioSessions: this.db.cardioByUid[actorUid] ?? [],
      notifications: this.db.notificationsByUid[actorUid] ?? [],
    });
  }

  async updateOwnProfile(actorUid: string, patch: Record<string, unknown>): Promise<UserAccountModel> {
    await this.simulateLatencyAndFaults();
    validateProfileSelfUpdateInput(patch);
    const user = this.requireUser(actorUid);
    if (patch.displayName !== undefined) user.displayName = String(patch.displayName).trim();
    if (patch.location !== undefined) user.location = String(patch.location).trim();
    if (patch.goal !== undefined) user.goal = String(patch.goal) as UserAccountModel['goal'];
    if (patch.profileLabel !== undefined) {
      const label = String(patch.profileLabel);
      if (label === 'Atleta Pro' || label === 'Coach' || label === 'Nutricionista') {
        user.profileLabel = label;
      }
    }
    user.updatedAt = new Date().toISOString();
    return deepClone(user);
  }

  async completeOnboarding(
    actorUid: string,
    input: OnboardingCompletionInput
  ): Promise<{ profile: UserAccountModel; biometrics: BiometricsPayload; preferences: PreferencesPayload }> {
    await this.simulateLatencyAndFaults();
    validateBiometricsInput(input.biometrics as unknown as Record<string, unknown>);
    const user = this.requireUser(actorUid);
    user.displayName = input.displayName.trim() || user.displayName;
    user.goal = input.goal;
    user.onboardingCompleted = true;
    user.onboardingStep = 6;
    user.updatedAt = new Date().toISOString();

    const bio = deepClone(input.biometrics);
    const pref = deepClone({ ...input.preferences, onboardingCompleted: true, onboardingStep: 6 });
    this.db.biometricsByUid[actorUid] = bio;
    this.db.preferencesByUid[actorUid] = pref;

    return {
      profile: deepClone(user),
      biometrics: deepClone(bio),
      preferences: deepClone(pref),
    };
  }

  async saveBiometrics(actorUid: string, payload: BiometricsPayload): Promise<BiometricsPayload> {
    await this.simulateLatencyAndFaults();
    validateBiometricsInput(payload as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    this.db.biometricsByUid[actorUid] = deepClone(payload);
    return deepClone(payload);
  }

  async savePreferences(actorUid: string, payload: PreferencesPayload): Promise<PreferencesPayload> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    this.db.preferencesByUid[actorUid] = deepClone(payload);
    return deepClone(payload);
  }

  async logMeal(actorUid: string, meal: Omit<MealLogRecord, 'id'> & { id?: string }): Promise<MealLogRecord> {
    await this.simulateLatencyAndFaults();
    validateMealLogInput(meal as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    const created: MealLogRecord = {
      ...deepClone(meal),
      id: meal.id || `meal_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    };
    const list = this.db.mealLogsByUid[actorUid] ?? [];
    list.unshift(created);
    this.db.mealLogsByUid[actorUid] = list;
    return deepClone(created);
  }

  async deleteMeal(actorUid: string, mealId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    this.db.mealLogsByUid[actorUid] = (this.db.mealLogsByUid[actorUid] ?? []).filter(m => m.id !== mealId);
  }

  async listRecipes(
    actorUid: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: RecipeRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const items = deepClone(this.db.recipesByUid[actorUid] ?? []).slice(0, options.limit ?? 100);
    return { items };
  }

  async saveRecipe(actorUid: string, recipe: RecipeRecord): Promise<RecipeRecord> {
    await this.simulateLatencyAndFaults();
    validateRecipeInput(recipe as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    const saved: RecipeRecord = { ...deepClone(recipe), updatedAt: new Date().toISOString() };
    const list = this.db.recipesByUid[actorUid] ?? [];
    const idx = list.findIndex(r => r.id === saved.id);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    this.db.recipesByUid[actorUid] = list;
    return deepClone(saved);
  }

  async deleteRecipe(actorUid: string, recipeId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    this.db.recipesByUid[actorUid] = (this.db.recipesByUid[actorUid] ?? []).filter(r => r.id !== recipeId);
  }

  async listMealPlans(
    actorUid: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: MealPlanRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const items = deepClone(this.db.mealPlansByUid[actorUid] ?? []).slice(0, options.limit ?? 100);
    return { items };
  }

  async saveMealPlan(actorUid: string, plan: MealPlanRecord): Promise<MealPlanRecord> {
    await this.simulateLatencyAndFaults();
    validateMealPlanInput(plan as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    const saved = { ...deepClone(plan), updatedAt: new Date().toISOString() };
    const list = this.db.mealPlansByUid[actorUid] ?? [];
    const idx = list.findIndex(p => p.weekStart === saved.weekStart);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    this.db.mealPlansByUid[actorUid] = list;
    return deepClone(saved);
  }

  async listGroceries(
    actorUid: string,
    options: { status?: string; limit?: number; startKey?: string } = {}
  ): Promise<{ items: GroceryItemRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    let items = deepClone(this.db.groceriesByUid[actorUid] ?? []);
    if (options.status) items = items.filter(g => g.status === options.status);
    return { items: items.slice(0, options.limit ?? 100) };
  }

  async syncGroceries(
    actorUid: string,
    items: GroceryItemRecord[]
  ): Promise<{ groceries: GroceryItemRecord[]; batchCalls: number }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    for (const item of items) {
      validateGroceryInput(item as unknown as Record<string, unknown>);
    }
    this.db.groceriesByUid[actorUid] = deepClone(items);
    const batchCalls = Math.max(1, Math.ceil(items.length / CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS));
    return { groceries: deepClone(items), batchCalls };
  }

  async toggleGroceryStatus(
    actorUid: string,
    groceryId: string,
    patch: Partial<
      Pick<
        GroceryItemRecord,
        'status' | 'name' | 'quantity' | 'calculatedQuantity' | 'unit' | 'department' | 'notes' | 'isCustomized'
      >
    > = {}
  ): Promise<GroceryItemRecord> {
    await this.simulateLatencyAndFaults();
    const list = this.db.groceriesByUid[actorUid] ?? [];
    const item = list.find(g => g.id === groceryId);
    if (!item) {
      throw new CleanSlateRepositoryError('GROCERY_NOT_FOUND', 'Artículo no encontrado.', 404);
    }
    const hasCustomPatch = Object.keys(patch).some(k => k !== 'status' && patch[k as keyof typeof patch] !== undefined);
    if (patch.status !== undefined) {
      item.status = patch.status;
    } else if (!hasCustomPatch) {
      item.status = item.status === 'bought' || item.status === 'completed' ? 'pending' : 'bought';
    }
    if (patch.name !== undefined) item.name = patch.name;
    if (patch.quantity !== undefined) item.quantity = patch.quantity;
    if (patch.calculatedQuantity !== undefined) item.calculatedQuantity = patch.calculatedQuantity;
    if (patch.unit !== undefined) item.unit = patch.unit;
    if (patch.department !== undefined) item.department = patch.department;
    if (patch.notes !== undefined) item.notes = patch.notes;
    if (patch.isCustomized !== undefined) item.isCustomized = patch.isCustomized;
    return deepClone(item);
  }

  async addManualGrocery(actorUid: string, item: Omit<GroceryItemRecord, 'id'>): Promise<GroceryItemRecord> {
    await this.simulateLatencyAndFaults();
    validateGroceryInput(item as unknown as Record<string, unknown>);
    const created: GroceryItemRecord = {
      ...deepClone(item),
      id: `groc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      origin: 'manual',
    };
    const list = this.db.groceriesByUid[actorUid] ?? [];
    list.push(created);
    this.db.groceriesByUid[actorUid] = list;
    return deepClone(created);
  }

  async deleteGrocery(actorUid: string, groceryId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.db.groceriesByUid[actorUid] = (this.db.groceriesByUid[actorUid] ?? []).filter(g => g.id !== groceryId);
  }

  async clearCompletedGroceries(actorUid: string): Promise<{ deletedCount: number; batchCalls: number }> {
    await this.simulateLatencyAndFaults();
    const list = this.db.groceriesByUid[actorUid] ?? [];
    const remaining = list.filter(g => g.status !== 'bought' && g.status !== 'completed');
    const deletedCount = list.length - remaining.length;
    this.db.groceriesByUid[actorUid] = remaining;
    return {
      deletedCount,
      batchCalls: Math.ceil(deletedCount / CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS),
    };
  }

  async listWorkoutRoutines(
    actorUid: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: WorkoutRoutineRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    return { items: deepClone(this.db.routinesByUid[actorUid] ?? []).slice(0, options.limit ?? 100) };
  }

  async saveWorkoutRoutine(actorUid: string, routine: WorkoutRoutineRecord): Promise<WorkoutRoutineRecord> {
    await this.simulateLatencyAndFaults();
    validateWorkoutRoutineInput(routine as unknown as Record<string, unknown>);
    const saved = { ...deepClone(routine), updatedAt: new Date().toISOString() };
    const list = this.db.routinesByUid[actorUid] ?? [];
    if (saved.isDefault) {
      list.forEach(r => {
        r.isDefault = false;
      });
    }
    const idx = list.findIndex(r => r.id === saved.id);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    this.db.routinesByUid[actorUid] = list;
    return deepClone(saved);
  }

  async deleteWorkoutRoutine(actorUid: string, routineId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    this.db.routinesByUid[actorUid] = (this.db.routinesByUid[actorUid] ?? []).filter(r => r.id !== routineId);
  }

  async setDefaultRoutine(actorUid: string, routineId: string): Promise<WorkoutRoutineRecord[]> {
    await this.simulateLatencyAndFaults();
    const list = this.db.routinesByUid[actorUid] ?? [];
    list.forEach(r => {
      r.isDefault = r.id === routineId;
    });
    return deepClone(list);
  }

  async listExecutedWorkouts(
    actorUid: string,
    options: {
      startDate?: string;
      endDate?: string;
      status?: 'in_progress' | 'completed' | 'abandoned';
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<{ items: ExecutedWorkoutRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    let list = deepClone(this.db.executedWorkoutsByUid[actorUid] ?? []);
    if (options.startDate) list = list.filter(w => w.startedAt >= options.startDate!);
    if (options.endDate) list = list.filter(w => w.startedAt <= `${options.endDate!}T23:59:59.999Z`);
    if (options.status) list = list.filter(w => w.status === options.status);
    return { items: list.slice(0, options.limit ?? 50) };
  }

  async getExecutedWorkoutDetail(
    actorUid: string,
    workoutId: string
  ): Promise<{ workout: ExecutedWorkoutRecord; sets: WorkoutSetRecord[] }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const workout = (this.db.executedWorkoutsByUid[actorUid] ?? []).find(w => w.id === workoutId);
    if (!workout) {
      throw new CleanSlateRepositoryError('WORKOUT_NOT_FOUND', 'Sesión no encontrada.', 404);
    }
    const sets = (this.db.workoutSetsByUid[actorUid] ?? []).filter(s => s.executedWorkoutId === workoutId);
    return { workout: deepClone(workout), sets: deepClone(sets) };
  }

  async startExecutedWorkout(
    actorUid: string,
    input: {
      routineId?: string;
      routineName: string;
      routineDayId?: string;
      routineDayName: string;
      exercisesSnapshot: ExecutedWorkoutRecord['exercisesSnapshot'];
    }
  ): Promise<ExecutedWorkoutRecord> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const list = this.db.executedWorkoutsByUid[actorUid] ?? [];
    const existingActive = list.find(w => w.status === 'in_progress');
    if (existingActive) {
      throw new CleanSlateRepositoryError(
        'ACTIVE_WORKOUT_ALREADY_OPEN',
        `Ya tienes una sesión activa ('${existingActive.routineDayName}'). Complétala o abandónala antes de iniciar otra.`,
        409
      );
    }

    const created: ExecutedWorkoutRecord = {
      id: `wk_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      routineId: input.routineId,
      routineName: input.routineName,
      routineDayId: input.routineDayId,
      routineDayName: input.routineDayName,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      totalTonnageKg: 0,
      totalCompletedSets: 0,
      totalReps: 0,
      averageRir: null,
      exercisesSnapshot: deepClone(input.exercisesSnapshot),
    };
    list.unshift(created);
    this.db.executedWorkoutsByUid[actorUid] = list;
    return deepClone(created);
  }

  async logWorkoutSet(
    actorUid: string,
    input: Omit<WorkoutSetRecord, 'id' | 'estimated1RM' | 'completedAt'> & { id?: string }
  ): Promise<WorkoutSetRecord> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const workouts = this.db.executedWorkoutsByUid[actorUid] ?? [];
    const parent = workouts.find(w => w.id === input.executedWorkoutId) ?? null;

    validateWorkoutSetInput(input as unknown as Record<string, unknown>, parent ? parent.status : null);

    const created: WorkoutSetRecord = {
      ...deepClone(input),
      id: input.id || `set_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      estimated1RM: calculateEpley1RM(input.weightKg, input.reps),
      completedAt: new Date().toISOString(),
    };

    const sets = this.db.workoutSetsByUid[actorUid] ?? [];
    sets.push(created);
    this.db.workoutSetsByUid[actorUid] = sets;

    if (parent) {
      const parentSets = sets.filter(s => s.executedWorkoutId === parent.id);
      parent.totalTonnageKg = calculateEffectiveTonnage(parentSets);
      parent.totalCompletedSets = calculateEffectiveSetsCount(parentSets);
      parent.totalReps = parentSets.filter(s => s.type !== 'warmup' && s.completed).reduce((a, s) => a + s.reps, 0);
      parent.averageRir = calculateAverageRir(parentSets);
    }

    return deepClone(created);
  }

  async completeExecutedWorkout(
    actorUid: string,
    workoutId: string,
    finalStatus: 'completed' | 'abandoned',
    summary: { durationSeconds: number; sessionRpe?: number; notes?: string }
  ): Promise<ExecutedWorkoutRecord> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    const workouts = this.db.executedWorkoutsByUid[actorUid] ?? [];
    const workout = workouts.find(w => w.id === workoutId);
    if (!workout) {
      throw new CleanSlateRepositoryError('WORKOUT_NOT_FOUND', 'Sesión no encontrada.', 404);
    }
    assertExecutedWorkoutMutable(workout.status);

    const parentSets = (this.db.workoutSetsByUid[actorUid] ?? []).filter(s => s.executedWorkoutId === workout.id);
    workout.status = finalStatus;
    workout.completedAt = new Date().toISOString();
    workout.durationSeconds = Math.max(60, summary.durationSeconds);
    workout.sessionRpe = summary.sessionRpe;
    workout.notes = summary.notes;
    workout.totalTonnageKg = calculateEffectiveTonnage(parentSets);
    workout.totalCompletedSets = calculateEffectiveSetsCount(parentSets);
    workout.totalReps = parentSets.filter(s => s.type !== 'warmup' && s.completed).reduce((a, s) => a + s.reps, 0);
    workout.averageRir = calculateAverageRir(parentSets);

    return deepClone(workout);
  }

  async listCardioSessions(
    actorUid: string,
    options: { startDate?: string; endDate?: string; limit?: number; startKey?: string } = {}
  ): Promise<{ items: CardioSessionRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    let list = deepClone(this.db.cardioByUid[actorUid] ?? []);
    if (options.startDate) list = list.filter(c => c.date >= options.startDate!);
    if (options.endDate) list = list.filter(c => c.date <= options.endDate!);
    return { items: list.slice(0, options.limit ?? 50) };
  }

  async addCardioSession(
    actorUid: string,
    session: Omit<CardioSessionRecord, 'id'>
  ): Promise<CardioSessionRecord> {
    await this.simulateLatencyAndFaults();
    validateCardioInput(session as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    const created: CardioSessionRecord = {
      ...deepClone(session),
      id: `cardio_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    };
    const list = this.db.cardioByUid[actorUid] ?? [];
    list.unshift(created);
    this.db.cardioByUid[actorUid] = list;
    return deepClone(created);
  }

  async deleteCardioSession(actorUid: string, cardioId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.db.cardioByUid[actorUid] = (this.db.cardioByUid[actorUid] ?? []).filter(c => c.id !== cardioId);
  }

  async listNotifications(
    actorUid: string,
    options: { unreadOnly?: boolean; limit?: number; startKey?: string } = {}
  ): Promise<{ items: NotificationRecord[]; nextStartKey?: string }> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    let list = deepClone(this.db.notificationsByUid[actorUid] ?? []);
    if (options.unreadOnly) list = list.filter(n => !n.read);
    return { items: list.slice(0, options.limit ?? 50) };
  }

  async createNotification(
    actorUid: string,
    notification: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>
  ): Promise<NotificationRecord> {
    await this.simulateLatencyAndFaults();
    validateNotificationInput(notification as unknown as Record<string, unknown>);
    this.requireUser(actorUid);
    const created: NotificationRecord = {
      ...deepClone(notification),
      id: `notif_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const list = this.db.notificationsByUid[actorUid] ?? [];
    list.unshift(created);
    this.db.notificationsByUid[actorUid] = list;
    return deepClone(created);
  }

  async markNotificationRead(
    actorUid: string,
    notificationId: string,
    read = true
  ): Promise<NotificationRecord> {
    await this.simulateLatencyAndFaults();
    const list = this.db.notificationsByUid[actorUid] ?? [];
    const item = list.find(n => n.id === notificationId);
    if (!item) {
      throw new CleanSlateRepositoryError('NOTIFICATION_NOT_FOUND', 'Notificación no encontrada.', 404);
    }
    item.read = read;
    return deepClone(item);
  }

  async markAllNotificationsRead(actorUid: string): Promise<NotificationRecord[]> {
    await this.simulateLatencyAndFaults();
    const list = this.db.notificationsByUid[actorUid] ?? [];
    list.forEach(n => {
      n.read = true;
    });
    return deepClone(list);
  }

  async deleteNotification(actorUid: string, notificationId: string): Promise<void> {
    await this.simulateLatencyAndFaults();
    this.requireUser(actorUid);
    this.db.notificationsByUid[actorUid] = (this.db.notificationsByUid[actorUid] ?? []).filter(
      n => n.id !== notificationId
    );
  }

  // ==================== ADMIN GOVERNANCE MOCK CONTRACTS ====================

  async listUsers(actorUid: string, filter: AdminDirectoryFilter = {}): Promise<UserAccountModel[]> {
    await this.simulateLatencyAndFaults();
    this.assertAdminRole(actorUid);
    const q = (filter.searchQuery || '').toLowerCase().trim();
    return deepClone(
      this.db.users.filter(u => {
        if (filter.role && filter.role !== 'all' && u.role !== filter.role) return false;
        if (filter.accountStatus && filter.accountStatus !== 'all' && u.accountStatus !== filter.accountStatus) return false;
        if (filter.emailVerified !== undefined && filter.emailVerified !== 'all' && u.emailVerified !== filter.emailVerified) {
          return false;
        }
        if (q && !u.displayName.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !u.uid.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
    );
  }

  async getStats(actorUid: string): Promise<AdminStatsModel> {
    await this.simulateLatencyAndFaults();
    this.assertAdminRole(actorUid);
    const cutoff30d = Date.now() - 30 * 24 * 3600 * 1000;
    return {
      totalUsers: this.db.users.length,
      activeUsers: this.db.users.filter(u => u.accountStatus === 'active').length,
      suspendedUsers: this.db.users.filter(u => u.accountStatus === 'suspended').length,
      superadmins: this.db.users.filter(u => u.role === 'superadmin').length,
      admins: this.db.users.filter(u => u.role === 'admin').length,
      pendingInvitations: this.db.invitations.filter(i => i.status === 'pending').length,
      pendingVerificationUsers: this.db.users.filter(u => !u.emailVerified).length,
      recentSignups30d: this.db.users.filter(u => new Date(u.createdAt).getTime() >= cutoff30d).length,
    };
  }

  async getUserDetail(
    actorUid: string,
    targetUid: string
  ): Promise<{ user: UserAccountModel; recentLogs: AuditLogModel[] }> {
    await this.simulateLatencyAndFaults();
    this.assertAdminRole(actorUid);
    const user = this.requireUser(targetUid);
    const recentLogs = this.db.auditLogs.filter(l => l.targetUid === targetUid).slice(0, 20);
    return { user: deepClone(user), recentLogs: deepClone(recentLogs) };
  }

  async listInvitations(
    actorUid: string,
    filter: {
      email?: string;
      status?: AdminInvitationModel['status'] | 'all';
      limit?: number;
      startKey?: string;
    } = {}
  ): Promise<AdminInvitationModel[]> {
    await this.simulateLatencyAndFaults();
    this.assertAdminRole(actorUid);
    const emailFilter = (filter.email || '').trim().toLowerCase();
    return deepClone(
      this.db.invitations
        .filter(inv => {
          if (emailFilter && inv.emailNormalized !== emailFilter) return false;
          if (filter.status && filter.status !== 'all' && inv.status !== filter.status) return false;
          return true;
        })
        .slice(0, filter.limit ?? 50)
    );
  }

  async createInvitation(
    actorUid: string,
    targetEmail: string,
    targetRole: 'athlete' | 'admin'
  ): Promise<AdminInvitationModel> {
    await this.simulateLatencyAndFaults();
    const actor = this.assertAdminRole(actorUid);
    if (actor.role === 'admin' && targetRole !== 'athlete') {
      throw new CleanSlateRepositoryError(
        'PRIVILEGE_ESCALATION_BLOCKED',
        'Un Admin solo puede invitar atletas. Solo un Superadmin puede invitar administradores.',
        403
      );
    }
    const emailNormalized = targetEmail.toLowerCase().trim();
    if (!emailNormalized || !emailNormalized.includes('@')) {
      throw new CleanSlateRepositoryError('INVALID_EMAIL', 'Introduce un correo electrónico válido.', 400);
    }
    const now = Date.now();
    const created: AdminInvitationModel = {
      inviteId: `inv_mock_${now}_${Math.random().toString(16).slice(2, 6)}`,
      emailNormalized,
      targetRole,
      status: 'pending',
      rawTokenPreview: `tok_mock_${Math.random().toString(36).slice(2, 12)}`,
      createdBy: actor.uid,
      createdByEmail: actor.email,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    };
    this.db.invitations.unshift(created);
    this.appendAuditLog({
      action: 'invitation_created',
      actorUid: actor.uid,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: emailNormalized,
      targetEmail: emailNormalized,
      reason: `Invitación generada para rol ${targetRole}`,
    });
    return deepClone(created);
  }

  async revokeInvitation(actorUid: string, inviteId: string, reason?: string): Promise<AdminInvitationModel> {
    await this.simulateLatencyAndFaults();
    const actor = this.assertAdminRole(actorUid);
    const invite = this.db.invitations.find(i => i.inviteId === inviteId);
    if (!invite || invite.status !== 'pending') {
      throw new CleanSlateRepositoryError(
        'INVITATION_REVOKE_FAILED',
        'Solo se pueden revocar invitaciones en estado pending.',
        409
      );
    }
    invite.status = 'revoked';
    invite.revokedBy = actor.uid;
    invite.revokedAt = new Date().toISOString();
    invite.revokeReason = reason || 'Revocación administrativa';
    this.appendAuditLog({
      action: 'invitation_revoked',
      actorUid: actor.uid,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: invite.emailNormalized,
      targetEmail: invite.emailNormalized,
      reason: invite.revokeReason,
    });
    return deepClone(invite);
  }

  async redeemInvitationPreview(
    callerUid: string,
    inviteId: string,
    rawToken: string
  ): Promise<{ assignedRole: UserRole; roleVersion: number }> {
    await this.simulateLatencyAndFaults();
    const caller = this.requireUser(callerUid);
    const invite = this.db.invitations.find(i => i.inviteId === inviteId);
    if (!invite || invite.status !== 'pending') {
      throw new CleanSlateRepositoryError('INVITATION_UNAVAILABLE', 'La invitación no está disponible.', 409);
    }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      invite.status = 'expired';
      throw new CleanSlateRepositoryError('INVITATION_EXPIRED', 'La invitación ha expirado.', 409);
    }
    if (!rawToken || rawToken !== invite.rawTokenPreview) {
      throw new CleanSlateRepositoryError('INVITATION_TOKEN_INVALID', 'El token secreto de invitación es inválido.', 403);
    }

    const assignedRole: UserRole = caller.role === 'superadmin' ? 'superadmin' : invite.targetRole;
    caller.role = assignedRole;
    caller.roleVersion += 1;
    caller.updatedAt = new Date().toISOString();

    invite.status = 'redeemed';
    invite.redeemedBy = caller.uid;
    invite.redeemedAt = caller.updatedAt;

    this.appendAuditLog({
      action: 'invitation_redeemed',
      actorUid: caller.uid,
      actorRole: assignedRole,
      actorEmail: caller.email,
      targetUid: caller.uid,
      targetEmail: caller.email,
      reason: `Canje de invitación ${invite.inviteId} (preview local)`,
    });

    return { assignedRole, roleVersion: caller.roleVersion };
  }

  async setUserStatus(
    actorUid: string,
    targetUid: string,
    newStatus: AccountStatus,
    reason?: string
  ): Promise<UserAccountModel> {
    await this.simulateLatencyAndFaults();
    const actor = this.assertAdminRole(actorUid);
    if (actor.uid === targetUid) {
      throw new CleanSlateRepositoryError(
        'SELF_SUSPENSION_BLOCKED',
        'Un administrador no puede suspender ni reactivar su propia cuenta.',
        403
      );
    }
    const target = this.requireUser(targetUid);
    if (target.role === 'superadmin') {
      throw new CleanSlateRepositoryError(
        'SUPERADMIN_TARGET_PROTECTED',
        'Las mutaciones automáticas sobre un Superadmin están bloqueadas hasta PASS-INTEGRATION.',
        403
      );
    }
    const previousStatus = target.accountStatus;
    target.accountStatus = newStatus;
    target.sessionEpoch += 1;
    target.roleVersion += 1;
    target.suspendedAt = newStatus === 'suspended' ? new Date().toISOString() : undefined;
    target.suspensionReason = newStatus === 'suspended' ? reason : undefined;
    target.updatedAt = new Date().toISOString();

    this.appendAuditLog({
      action: newStatus === 'suspended' ? 'account_suspended' : 'account_reactivated',
      actorUid: actor.uid,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: target.uid,
      targetEmail: target.email,
      reason,
      changes: { before: { status: previousStatus }, after: { status: newStatus } },
    });

    return deepClone(target);
  }

  async setUserRole(
    actorUid: string,
    targetUid: string,
    newRole: UserRole,
    reason?: string
  ): Promise<UserAccountModel> {
    await this.simulateLatencyAndFaults();
    const actor = this.assertAdminRole(actorUid, ['superadmin']);
    const target = this.requireUser(targetUid);
    const involvesSuperadmin = target.role === 'superadmin' || newRole === 'superadmin';
    if (involvesSuperadmin && !this.allowSuperadminMutations) {
      throw new CleanSlateRepositoryError(
        'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED',
        'Los cambios de rol que involucran superadmin están bloqueados por defecto hasta verificar atomicidad remota (PASS-INTEGRATION).',
        403
      );
    }
    const previousRole = target.role;
    target.role = newRole;
    target.roleVersion += 1;
    target.sessionEpoch += 1;
    target.updatedAt = new Date().toISOString();

    this.appendAuditLog({
      action: 'role_changed',
      actorUid: actor.uid,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: target.uid,
      targetEmail: target.email,
      reason,
      changes: { before: { role: previousRole }, after: { role: newRole } },
    });

    return deepClone(target);
  }

  async requestPasswordReset(actorUid: string, targetUid: string): Promise<{ emailSentTo: string }> {
    await this.simulateLatencyAndFaults();
    const actor = this.assertAdminRole(actorUid);
    const target = this.requireUser(targetUid);
    this.appendAuditLog({
      action: 'password_reset_requested',
      actorUid: actor.uid,
      actorRole: actor.role,
      actorEmail: actor.email,
      targetUid: target.uid,
      targetEmail: target.email,
      reason: 'Solicitud administrativa (simulada en mock local)',
    });
    return { emailSentTo: target.email };
  }

  async listAuditLogs(
    actorUid: string,
    filter: { action?: string; targetUid?: string; month?: string } = {}
  ): Promise<AuditLogModel[]> {
    await this.simulateLatencyAndFaults();
    this.assertAdminRole(actorUid);
    return deepClone(
      this.db.auditLogs.filter(log => {
        if (filter.action && filter.action !== 'all' && log.action !== filter.action) return false;
        if (filter.targetUid && log.targetUid !== filter.targetUid) return false;
        if (filter.month && !log.timestamp.startsWith(filter.month)) return false;
        return true;
      })
    );
  }
}
