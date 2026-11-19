/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Server-Side Domain Validators (Replaces firestore.rules)
 *
 * In Zoho Catalyst Clean-Slate, the browser NEVER connects directly to Catalyst NoSQL.
 * Every validation rule from `firestore.rules` (lines 1-358) is enforced authoritatively
 * in the Advanced I/O Function layer before any NoSQL write occurs.
 */

import { assertCatalystItemSize } from '../nosql/cleanSlateEngine.js';

export class DomainValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409 | 413 = 400
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function validateSafeIdentifier(val: unknown, fieldName: string): string {
  if (typeof val !== 'string') {
    throw new DomainValidationError('INVALID_PATH_PARAMETER', `${fieldName} must be a non-empty string.`, 400);
  }
  const trimmed = val.trim();
  if (!SAFE_IDENTIFIER_RE.test(trimmed) || trimmed === '.' || trimmed.includes('..') || trimmed.includes('#')) {
    throw new DomainValidationError(
      'INVALID_PATH_PARAMETER',
      `Identifier '${fieldName}' contains invalid characters or exceeds 128 chars.`,
      400
    );
  }
  return trimmed;
}

function isNonEmptyString(val: unknown, maxLen = 500): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function isFiniteNumber(val: unknown, min: number, max: number): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

/**
 * Prevents privilege escalation via self profile update.
 * `role`, `roleVersion`, `accountStatus`, `validAfterSec`, `uid`, `email`, `normalizedEmail`
 * are strictly immutable from athlete endpoints.
 */
export function validateProfileSelfUpdate(payload: Record<string, unknown>): void {
  const forbiddenKeys = [
    'role',
    'roleVersion',
    'sessionEpoch',
    'accountStatus',
    'validAfterSec',
    'uid',
    'pk',
    'sk',
    'email',
    'normalizedEmail',
    'emailVerified',
    'suspendedAt',
    'suspendedBy',
  ];
  for (const k of forbiddenKeys) {
    if (k in payload) {
      throw new DomainValidationError(
        'IMMUTABLE_SECURITY_FIELD',
        `Field '${k}' cannot be modified by client profile update.`,
        403
      );
    }
  }
  if (payload.name !== undefined && !isNonEmptyString(payload.name, 120)) {
    throw new DomainValidationError('INVALID_PROFILE', 'name must be a non-empty string (<=120 chars).');
  }
  if (payload.displayName !== undefined && !isNonEmptyString(payload.displayName, 120)) {
    throw new DomainValidationError('INVALID_PROFILE', 'displayName must be a non-empty string (<=120 chars).');
  }
  if (payload.onboardingStep !== undefined && !isFiniteNumber(payload.onboardingStep, 1, 6)) {
    throw new DomainValidationError('INVALID_PROFILE', 'onboardingStep must be between 1 and 6.');
  }
}

export function validateBiometricsPayload(payload: Record<string, unknown>): void {
  if (!isFiniteNumber(payload.weightKg, 20, 350)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'weightKg must be in [20, 350].');
  }
  if (!isFiniteNumber(payload.heightCm, 90, 260)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'heightCm must be in [90, 260].');
  }
  if (!isFiniteNumber(payload.age, 12, 120)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'age must be in [12, 120].');
  }
  if (!isFiniteNumber(payload.bodyFatPct, 2, 70)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'bodyFatPct must be in [2, 70].');
  }
  if (!isFiniteNumber(payload.palFactor, 1.0, 2.5)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'palFactor must be in [1.0, 2.5].');
  }
  if (payload.targetDeltaKcal !== undefined && !isFiniteNumber(payload.targetDeltaKcal, -2000, 2000)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'targetDeltaKcal must be in [-2000, 2000].');
  }
  if (payload.proteinPerKg !== undefined && !isFiniteNumber(payload.proteinPerKg, 0.5, 4.5)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'proteinPerKg must be in [0.5, 4.5].');
  }
  if (payload.fatPerKg !== undefined && !isFiniteNumber(payload.fatPerKg, 0.3, 3.0)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'fatPerKg must be in [0.3, 3.0].');
  }
}

export function validatePreferencesPayload(payload: Record<string, unknown>): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new DomainValidationError('INVALID_PREFERENCES', 'preferences payload must be an object.');
  }
  assertPayloadSizeBudget(payload);
}

export function validateOnboardingPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.displayName, 120)) {
    throw new DomainValidationError('INVALID_ONBOARDING', 'displayName is required (<=120 chars).');
  }
  if (!isNonEmptyString(payload.goal, 80)) {
    throw new DomainValidationError('INVALID_ONBOARDING', 'goal is required (<=80 chars).');
  }
  if (typeof payload.biometrics !== 'object' || payload.biometrics === null || Array.isArray(payload.biometrics)) {
    throw new DomainValidationError('INVALID_BIOMETRICS', 'biometrics object is required.');
  }
  if (typeof payload.preferences !== 'object' || payload.preferences === null || Array.isArray(payload.preferences)) {
    throw new DomainValidationError('INVALID_PREFERENCES', 'preferences object is required.');
  }
  validateBiometricsPayload(payload.biometrics as Record<string, unknown>);
  validatePreferencesPayload(payload.preferences as Record<string, unknown>);
}

export function validateGroceryPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new DomainValidationError('INVALID_GROCERY', 'Grocery item name is required.');
  }
  if (payload.quantity !== undefined && !isFiniteNumber(payload.quantity, 0, 100000)) {
    throw new DomainValidationError('INVALID_GROCERY', 'Grocery quantity must be >= 0.');
  }
  if (payload.status !== undefined && !['pending', 'bought', 'in_pantry'].includes(String(payload.status))) {
    throw new DomainValidationError('INVALID_GROCERY', 'Invalid grocery status.');
  }
}

export function validateGroceryStatusPatch(payload: Record<string, unknown>): void {
  if (payload.status !== undefined && !['pending', 'bought', 'in_pantry'].includes(String(payload.status))) {
    throw new DomainValidationError(
      'INVALID_GROCERY',
      "Grocery status must be 'pending', 'bought', or 'in_pantry'.",
      400
    );
  }
}

export function validateMealLogPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.dateTime, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(payload.dateTime)) {
    throw new DomainValidationError('INVALID_MEAL_LOG', 'dateTime must match YYYY-MM-DDTHH:mm format.');
  }
  if (!isNonEmptyString(payload.name, 200)) {
    throw new DomainValidationError('INVALID_MEAL_LOG', 'Meal name is required.');
  }
  if (!isFiniteNumber(payload.kcal, 0, 10000)) {
    throw new DomainValidationError('INVALID_MEAL_LOG', 'kcal must be in [0, 10000].');
  }
  if (!isFiniteNumber(payload.protein, 0, 1000) || !isFiniteNumber(payload.carbs, 0, 1500) || !isFiniteNumber(payload.fat, 0, 1000)) {
    throw new DomainValidationError('INVALID_MEAL_LOG', 'Macronutrients out of valid bounds.');
  }
}

export function validateCardioPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.date, 25)) {
    throw new DomainValidationError('INVALID_CARDIO', 'Cardio date is required.');
  }
  if (!isFiniteNumber(payload.durationMinutes, 1, 600)) {
    throw new DomainValidationError('INVALID_CARDIO', 'durationMinutes must be in [1, 600].');
  }
  if (payload.avgHeartRate !== undefined && !isFiniteNumber(payload.avgHeartRate, 35, 240)) {
    throw new DomainValidationError('INVALID_CARDIO', 'avgHeartRate must be in [35, 240].');
  }
}

export function validateNotificationPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.title, 200) || !isNonEmptyString(payload.message, 1000)) {
    throw new DomainValidationError('INVALID_NOTIFICATION', 'Notification title and message are required.');
  }
}

export function validateNotificationReadPatch(payload: Record<string, unknown>): void {
  if (payload.read !== undefined && typeof payload.read !== 'boolean') {
    throw new DomainValidationError('INVALID_NOTIFICATION', 'read must be a boolean.', 400);
  }
}

export function validateRecipePayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new DomainValidationError('INVALID_RECIPE', 'Recipe name is required.');
  }
  if (!Array.isArray(payload.ingredients)) {
    throw new DomainValidationError('INVALID_RECIPE', 'Recipe ingredients must be an array.');
  }
  assertPayloadSizeBudget(payload);
}

export function validateMealPlanPayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.weekStart, 20) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.weekStart)) {
    throw new DomainValidationError('INVALID_MEAL_PLAN', 'weekStart must match YYYY-MM-DD.');
  }
  if (typeof payload.days !== 'object' || payload.days === null) {
    throw new DomainValidationError('INVALID_MEAL_PLAN', 'mealPlan days map is required.');
  }
  assertPayloadSizeBudget(payload);
}

export function validateWorkoutRoutinePayload(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new DomainValidationError('INVALID_ROUTINE', 'Routine name is required.');
  }
  assertPayloadSizeBudget(payload);
}

/**
 * Mirrors firestore.rules `isValidExecutedWorkout`:
 * - Status must be 'in_progress' | 'completed' | 'abandoned'.
 * - Terminal states ('completed' or 'abandoned') are immutable once persisted.
 */
export function validateExecutedWorkoutCreate(payload: Record<string, unknown>): void {
  const status = String(payload.status || '');
  if (!['in_progress', 'completed', 'abandoned'].includes(status)) {
    throw new DomainValidationError('INVALID_WORKOUT_STATUS', `Invalid executedWorkout status '${status}'.`);
  }
  if (!isNonEmptyString(payload.startedAt, 40)) {
    throw new DomainValidationError('INVALID_WORKOUT', 'startedAt ISO timestamp is required.');
  }
  if (!Array.isArray(payload.exercisesSnapshot)) {
    throw new DomainValidationError('INVALID_WORKOUT', 'exercisesSnapshot must be an array.');
  }
  assertPayloadSizeBudget(payload);
}

export function assertExecutedWorkoutMutable(existingStatus: string): void {
  if (existingStatus !== 'in_progress') {
    throw new DomainValidationError(
      'WORKOUT_TERMINAL_IMMUTABLE',
      `ExecutedWorkout in terminal state '${existingStatus}' cannot be modified or accept new sets.`,
      409
    );
  }
}

/**
 * Mirrors firestore.rules `isValidWorkoutSession` + `isLinkedWorkoutActive`:
 * Every workout set MUST link to an existing `executedWorkoutId` owned by the same user
 * whose status is currently `'in_progress'`.
 */
export function validateWorkoutSetPayload(
  payload: Record<string, unknown>,
  parentExecutedWorkoutStatus: string | null
): void {
  if (!isNonEmptyString(payload.executedWorkoutId, 120)) {
    throw new DomainValidationError('MISSING_PARENT_WORKOUT', 'executedWorkoutId is mandatory for workout sets.');
  }
  if (parentExecutedWorkoutStatus === null) {
    throw new DomainValidationError(
      'PARENT_WORKOUT_NOT_FOUND',
      `Linked executedWorkout '${payload.executedWorkoutId}' does not exist in user partition.`,
      409
    );
  }
  if (parentExecutedWorkoutStatus !== 'in_progress') {
    throw new DomainValidationError(
      'PARENT_WORKOUT_NOT_ACTIVE',
      `Cannot mutate sets when linked executedWorkout has status '${parentExecutedWorkoutStatus}'.`,
      409
    );
  }
  if (!isNonEmptyString(payload.exerciseId, 120) || !isNonEmptyString(payload.exerciseName, 200)) {
    throw new DomainValidationError('INVALID_WORKOUT_SET', 'exerciseId and exerciseName are required.');
  }
  if (!isFiniteNumber(payload.weightKg, 0, 1000)) {
    throw new DomainValidationError('INVALID_WORKOUT_SET', 'weightKg must be in [0, 1000].');
  }
  if (!isFiniteNumber(payload.reps, 0, 1000)) {
    throw new DomainValidationError('INVALID_WORKOUT_SET', 'reps must be in [0, 1000].');
  }
  if (!isFiniteNumber(payload.rir, 0, 10)) {
    throw new DomainValidationError('INVALID_WORKOUT_SET', 'rir must be in [0, 10].');
  }
}

export function assertPayloadSizeBudget(payload: unknown): void {
  try {
    const check = assertCatalystItemSize(payload);
    if (!check.withinBudget) {
      throw new DomainValidationError(
        'PAYLOAD_BUDGET_EXCEEDED',
        `Payload (${check.bytes} bytes) exceeds safe 350 KB soft ceiling (Catalyst NoSQL hard cap is 400 KB). Split document or archive older weeks.`,
        413
      );
    }
  } catch (err) {
    if (err instanceof DomainValidationError) throw err;
    throw new DomainValidationError(
      'CATALYST_400KB_LIMIT_EXCEEDED',
      err instanceof Error ? err.message : 'Item exceeds Catalyst 400 KB limit.',
      413
    );
  }
}
