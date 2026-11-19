/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Backend-Agnostic Repository Interfaces
 * Allows UI views and state to remain decoupled from Catalyst Advanced I/O HTTP calls
 * vs. local in-memory development mocks.
 */

import type {
  AccountStatus,
  AdminInvitationModel,
  AdminStatsModel,
  AuditLogModel,
  BiometricsPayload,
  CardioSessionRecord,
  ExecutedWorkoutRecord,
  GroceryItemRecord,
  MealLogRecord,
  MealPlanRecord,
  NotificationRecord,
  PreferencesPayload,
  RecipeRecord,
  UserAccountModel,
  UserRole,
  WorkoutRoutineRecord,
  WorkoutSetRecord,
} from './cleanSlateModels';

export type RepositoryErrorOrigin = 'client_synthetic' | 'http_server';

export interface RepositoryErrorOptions {
  origin?: RepositoryErrorOrigin;
  httpStatusReceived?: number;
}

export class CleanSlateRepositoryError extends Error {
  public readonly origin: RepositoryErrorOrigin;
  public readonly httpStatusReceived?: number;

  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    options: RepositoryErrorOptions = {}
  ) {
    super(message);
    this.name = 'CleanSlateRepositoryError';
    this.origin = options.origin ?? 'client_synthetic';
    this.httpStatusReceived = options.httpStatusReceived;
  }

  get isSyntheticClientError(): boolean {
    return this.origin === 'client_synthetic';
  }
}

export interface PartialBatchSyncDetail {
  syncId: string;
  totalBatches: number;
  completedBatches: number;
  failedBatchIndex: number;
  persistedCount: number;
  remainingItems: GroceryItemRecord[];
  cause: CleanSlateRepositoryError;
}

export class PartialBatchSyncError extends CleanSlateRepositoryError {
  public readonly atomic = false as const;
  public readonly syncId: string;
  public readonly totalBatches: number;
  public readonly completedBatches: number;
  public readonly failedBatchIndex: number;
  public readonly persistedCount: number;
  public readonly remainingItems: GroceryItemRecord[];

  constructor(detail: PartialBatchSyncDetail) {
    super(
      'PARTIAL_BATCH_SYNC_FAILED',
      `Sincronización parcial de compras (${detail.completedBatches}/${detail.totalBatches} lotes confirmados; ${detail.persistedCount} ítems persistidos; falló lote #${detail.failedBatchIndex + 1}: ${detail.cause.code}). La operación multi-lote no es atómica; reintenta resumeGrocerySyncBatch con remainingItems.`,
      detail.cause.statusCode,
      {
        origin: detail.cause.origin,
        httpStatusReceived: detail.cause.httpStatusReceived,
      }
    );
    this.name = 'PartialBatchSyncError';
    this.syncId = detail.syncId;
    this.totalBatches = detail.totalBatches;
    this.completedBatches = detail.completedBatches;
    this.failedBatchIndex = detail.failedBatchIndex;
    this.persistedCount = detail.persistedCount;
    this.remainingItems = detail.remainingItems;
  }
}

export type MockFaultMode = 'none' | 'network_error' | 'empty_workspace';

export interface CleanSlateWorkspaceSnapshot {
  isLocalDevMock: boolean;
  profile: UserAccountModel;
  biometrics: BiometricsPayload | null;
  preferences: PreferencesPayload | null;
  mealLogs: MealLogRecord[];
  recipes: RecipeRecord[];
  mealPlans: MealPlanRecord[];
  groceries: GroceryItemRecord[];
  workoutRoutines: WorkoutRoutineRecord[];
  executedWorkouts: ExecutedWorkoutRecord[];
  workoutSets: WorkoutSetRecord[];
  cardioSessions: CardioSessionRecord[];
  notifications: NotificationRecord[];
}

export interface OnboardingCompletionInput {
  displayName: string;
  goal: UserAccountModel['goal'];
  biometrics: BiometricsPayload;
  preferences: PreferencesPayload;
}

export interface IAthleteWorkspaceRepository {
  readonly modeLabel: string;
  readonly isLocalDevMock: boolean;

  hydrateWorkspace(actorUid: string): Promise<CleanSlateWorkspaceSnapshot>;
  updateOwnProfile(
    actorUid: string,
    patch: Record<string, unknown>
  ): Promise<UserAccountModel>;
  completeOnboarding(
    actorUid: string,
    input: OnboardingCompletionInput
  ): Promise<{ profile: UserAccountModel; biometrics: BiometricsPayload; preferences: PreferencesPayload }>;
  saveBiometrics(actorUid: string, payload: BiometricsPayload): Promise<BiometricsPayload>;
  savePreferences(actorUid: string, payload: PreferencesPayload): Promise<PreferencesPayload>;

  logMeal(actorUid: string, meal: Omit<MealLogRecord, 'id'> & { id?: string }): Promise<MealLogRecord>;
  deleteMeal(actorUid: string, mealId: string): Promise<void>;

  saveRecipe(actorUid: string, recipe: RecipeRecord): Promise<RecipeRecord>;
  deleteRecipe(actorUid: string, recipeId: string): Promise<void>;

  saveMealPlan(actorUid: string, plan: MealPlanRecord): Promise<MealPlanRecord>;

  syncGroceries(
    actorUid: string,
    items: GroceryItemRecord[]
  ): Promise<{ groceries: GroceryItemRecord[]; batchCalls: number }>;
  toggleGroceryStatus(actorUid: string, groceryId: string): Promise<GroceryItemRecord>;
  addManualGrocery(actorUid: string, item: Omit<GroceryItemRecord, 'id'>): Promise<GroceryItemRecord>;
  deleteGrocery(actorUid: string, groceryId: string): Promise<void>;

  saveWorkoutRoutine(actorUid: string, routine: WorkoutRoutineRecord): Promise<WorkoutRoutineRecord>;
  setDefaultRoutine(actorUid: string, routineId: string): Promise<WorkoutRoutineRecord[]>;

  startExecutedWorkout(
    actorUid: string,
    input: {
      routineId?: string;
      routineName: string;
      routineDayId?: string;
      routineDayName: string;
      exercisesSnapshot: ExecutedWorkoutRecord['exercisesSnapshot'];
    }
  ): Promise<ExecutedWorkoutRecord>;

  logWorkoutSet(
    actorUid: string,
    input: Omit<WorkoutSetRecord, 'id' | 'estimated1RM' | 'completedAt'> & { id?: string }
  ): Promise<WorkoutSetRecord>;

  completeExecutedWorkout(
    actorUid: string,
    workoutId: string,
    finalStatus: 'completed' | 'abandoned',
    summary: { durationSeconds: number; sessionRpe?: number; notes?: string }
  ): Promise<ExecutedWorkoutRecord>;

  addCardioSession(
    actorUid: string,
    session: Omit<CardioSessionRecord, 'id'>
  ): Promise<CardioSessionRecord>;
  deleteCardioSession(actorUid: string, cardioId: string): Promise<void>;

  createNotification(
    actorUid: string,
    notification: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>
  ): Promise<NotificationRecord>;
  markNotificationRead(actorUid: string, notificationId: string, read?: boolean): Promise<NotificationRecord>;
  markAllNotificationsRead(actorUid: string): Promise<NotificationRecord[]>;
}

export interface AdminDirectoryFilter {
  searchQuery?: string;
  role?: UserRole | 'all';
  accountStatus?: AccountStatus | 'all';
}

export interface IAdminGovernanceRepository {
  listUsers(actorUid: string, filter?: AdminDirectoryFilter): Promise<UserAccountModel[]>;
  getStats(actorUid: string): Promise<AdminStatsModel>;
  getUserDetail(
    actorUid: string,
    targetUid: string
  ): Promise<{ user: UserAccountModel; recentLogs: AuditLogModel[] }>;
  listInvitations(actorUid: string): Promise<AdminInvitationModel[]>;
  createInvitation(
    actorUid: string,
    targetEmail: string,
    targetRole: 'athlete' | 'admin'
  ): Promise<AdminInvitationModel>;
  revokeInvitation(actorUid: string, inviteId: string, reason?: string): Promise<AdminInvitationModel>;
  redeemInvitationPreview(
    callerUid: string,
    inviteId: string,
    rawToken: string
  ): Promise<{ assignedRole: UserRole; roleVersion: number }>;
  setUserStatus(
    actorUid: string,
    targetUid: string,
    newStatus: AccountStatus,
    reason?: string
  ): Promise<UserAccountModel>;
  setUserRole(
    actorUid: string,
    targetUid: string,
    newRole: UserRole,
    reason?: string
  ): Promise<UserAccountModel>;
  requestPasswordReset(actorUid: string, targetUid: string): Promise<{ emailSentTo: string }>;
  listAuditLogs(
    actorUid: string,
    filter?: { action?: string; targetUid?: string; month?: string }
  ): Promise<AuditLogModel[]>;
}
