/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Browser-Safe Domain Validators
 * Strictly mirrors `src/validators/domainValidators.ts` bounds, forbidden security keys,
 * 350 KB Catalyst payload budget, and ExecutedWorkout terminal immutability.
 */

import { CATALYST_BUDGET_LIMITS } from '../contracts/cleanSlateModels';
import { CleanSlateRepositoryError } from '../contracts/repositories';

function isNonEmptyString(val: unknown, maxLen = 500): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function isFiniteNumber(val: unknown, min: number, max: number): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max;
}

export function estimateUtf8Bytes(payload: unknown): number {
  const serialized = JSON.stringify(payload) ?? '';
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(serialized).length;
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertPayloadSizeBudget(payload: unknown): { bytes: number; withinBudget: boolean } {
  const bytes = estimateUtf8Bytes(payload);
  if (bytes > CATALYST_BUDGET_LIMITS.MAX_ITEM_BYTES) {
    throw new CleanSlateRepositoryError(
      'CATALYST_400KB_LIMIT_EXCEEDED',
      `El documento (${bytes} bytes) supera el límite físico de 400 KB de Catalyst NoSQL.`,
      413
    );
  }
  if (bytes > CATALYST_BUDGET_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES) {
    throw new CleanSlateRepositoryError(
      'PAYLOAD_BUDGET_EXCEEDED',
      `El documento (${bytes} bytes) excede el presupuesto seguro de 350 KB. Divide o archiva semanas anteriores.`,
      413
    );
  }
  return { bytes, withinBudget: true };
}

export const FORBIDDEN_PROFILE_SECURITY_FIELDS = [
  'role',
  'roleVersion',
  'sessionEpoch',
  'accountStatus',
  'uid',
  'pk',
  'sk',
  'email',
  'normalizedEmail',
  'emailVerified',
  'suspendedAt',
  'suspendedBy',
] as const;

export function validateProfileSelfUpdateInput(payload: Record<string, unknown>): void {
  for (const key of FORBIDDEN_PROFILE_SECURITY_FIELDS) {
    if (key in payload) {
      throw new CleanSlateRepositoryError(
        'IMMUTABLE_SECURITY_FIELD',
        `El campo '${key}' es inmutable desde el perfil del cliente y solo puede gestionarse vía backend autorizado.`,
        403
      );
    }
  }
  if (payload.displayName !== undefined && !isNonEmptyString(payload.displayName, 120)) {
    throw new CleanSlateRepositoryError(
      'INVALID_PROFILE',
      'El nombre visible es obligatorio (máx. 120 caracteres).',
      400
    );
  }
  if (payload.onboardingStep !== undefined && !isFiniteNumber(payload.onboardingStep, 1, 6)) {
    throw new CleanSlateRepositoryError(
      'INVALID_PROFILE',
      'El paso de onboarding debe estar entre 1 y 6.',
      400
    );
  }
}

export function validateBiometricsInput(payload: Record<string, unknown>): void {
  if (!isFiniteNumber(payload.weightKg, 20, 350)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'El peso corporal debe estar entre 20 y 350 kg.', 400);
  }
  if (!isFiniteNumber(payload.heightCm, 90, 260)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'La estatura debe estar entre 90 y 260 cm.', 400);
  }
  if (!isFiniteNumber(payload.age, 12, 120)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'La edad debe estar entre 12 y 120 años.', 400);
  }
  if (!isFiniteNumber(payload.bodyFatPct, 2, 70)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'El % de grasa corporal debe estar entre 2% y 70%.', 400);
  }
  if (!isFiniteNumber(payload.palFactor, 1.0, 2.5)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'El factor PAL debe estar entre 1.0 y 2.5.', 400);
  }
  if (payload.targetDeltaKcal !== undefined && !isFiniteNumber(payload.targetDeltaKcal, -2000, 2000)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'El delta calórico debe estar entre -2000 y +2000 kcal.', 400);
  }
  if (payload.proteinPerKg !== undefined && !isFiniteNumber(payload.proteinPerKg, 0.5, 4.5)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'La proteína por kg debe estar entre 0.5 y 4.5 g/kg.', 400);
  }
  if (payload.fatPerKg !== undefined && !isFiniteNumber(payload.fatPerKg, 0.3, 3.0)) {
    throw new CleanSlateRepositoryError('INVALID_BIOMETRICS', 'La grasa por kg debe estar entre 0.3 y 3.0 g/kg.', 400);
  }
}

export function validateMealLogInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.dateTime, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(payload.dateTime))) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_LOG', 'La fecha y hora deben cumplir el formato YYYY-MM-DDTHH:mm.', 400);
  }
  if (!isNonEmptyString(payload.name, 200)) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_LOG', 'El nombre de la comida es obligatorio.', 400);
  }
  if (!isFiniteNumber(payload.kcal, 0, 10000)) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_LOG', 'Las calorías deben estar entre 0 y 10,000 kcal.', 400);
  }
  if (!isFiniteNumber(payload.protein, 0, 1000) || !isFiniteNumber(payload.carbs, 0, 1500) || !isFiniteNumber(payload.fat, 0, 1000)) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_LOG', 'Los macronutrientes están fuera de los límites permitidos.', 400);
  }
}

export function validateGroceryInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new CleanSlateRepositoryError('INVALID_GROCERY', 'El nombre del artículo es obligatorio.', 400);
  }
  if (payload.quantity !== undefined && !isFiniteNumber(payload.quantity, 0, 100000)) {
    throw new CleanSlateRepositoryError('INVALID_GROCERY', 'La cantidad debe ser un número finito >= 0.', 400);
  }
  if (payload.status !== undefined && !['pending', 'bought', 'in_pantry'].includes(String(payload.status))) {
    throw new CleanSlateRepositoryError('INVALID_GROCERY', 'Estado de compra inválido.', 400);
  }
}

export function validateRecipeInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new CleanSlateRepositoryError('INVALID_RECIPE', 'El nombre de la receta es obligatorio.', 400);
  }
  if (!Array.isArray(payload.ingredients) || payload.ingredients.length === 0) {
    throw new CleanSlateRepositoryError('INVALID_RECIPE', 'La receta debe incluir al menos un ingrediente.', 400);
  }
  assertPayloadSizeBudget(payload);
}

export function validateMealPlanInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.weekStart, 20) || !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.weekStart))) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_PLAN', 'weekStart debe cumplir YYYY-MM-DD.', 400);
  }
  if (typeof payload.days !== 'object' || payload.days === null) {
    throw new CleanSlateRepositoryError('INVALID_MEAL_PLAN', 'El mapa de días del plan es obligatorio.', 400);
  }
  assertPayloadSizeBudget(payload);
}

export function validateWorkoutRoutineInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.name, 200)) {
    throw new CleanSlateRepositoryError('INVALID_ROUTINE', 'El nombre de la rutina es obligatorio.', 400);
  }
  assertPayloadSizeBudget(payload);
}

export function assertExecutedWorkoutMutable(status: string): void {
  if (status !== 'in_progress') {
    throw new CleanSlateRepositoryError(
      'WORKOUT_TERMINAL_IMMUTABLE',
      `La sesión en estado terminal '${status}' es inmutable y no acepta modificaciones ni nuevas series.`,
      409
    );
  }
}

export function validateWorkoutSetInput(
  payload: Record<string, unknown>,
  parentStatus: string | null
): void {
  if (!isNonEmptyString(payload.executedWorkoutId, 120)) {
    throw new CleanSlateRepositoryError('MISSING_PARENT_WORKOUT', 'executedWorkoutId es obligatorio.', 400);
  }
  if (parentStatus === null) {
    throw new CleanSlateRepositoryError(
      'PARENT_WORKOUT_NOT_FOUND',
      `La sesión padre '${String(payload.executedWorkoutId)}' no existe en la partición del atleta.`,
      409
    );
  }
  if (parentStatus !== 'in_progress') {
    throw new CleanSlateRepositoryError(
      'PARENT_WORKOUT_NOT_ACTIVE',
      `No se pueden registrar series cuando la sesión padre tiene estado '${parentStatus}'.`,
      409
    );
  }
  if (!isNonEmptyString(payload.exerciseId, 120) || !isNonEmptyString(payload.exerciseName, 200)) {
    throw new CleanSlateRepositoryError('INVALID_WORKOUT_SET', 'El ejercicio es obligatorio.', 400);
  }
  if (!isFiniteNumber(payload.weightKg, 0, 1000)) {
    throw new CleanSlateRepositoryError('INVALID_WORKOUT_SET', 'El peso debe estar entre 0 y 1,000 kg.', 400);
  }
  if (!isFiniteNumber(payload.reps, 0, 1000)) {
    throw new CleanSlateRepositoryError('INVALID_WORKOUT_SET', 'Las repeticiones deben estar entre 0 y 1,000.', 400);
  }
  if (!isFiniteNumber(payload.rir, 0, 10)) {
    throw new CleanSlateRepositoryError('INVALID_WORKOUT_SET', 'El RIR debe estar entre 0 y 10.', 400);
  }
}

export function validateCardioInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.date, 25)) {
    throw new CleanSlateRepositoryError('INVALID_CARDIO', 'La fecha de cardio es obligatoria.', 400);
  }
  if (!isNonEmptyString(payload.title, 200)) {
    throw new CleanSlateRepositoryError('INVALID_CARDIO', 'El título de la sesión cardio es obligatorio.', 400);
  }
  if (!isFiniteNumber(payload.durationMinutes, 1, 600)) {
    throw new CleanSlateRepositoryError('INVALID_CARDIO', 'La duración debe estar entre 1 y 600 minutos.', 400);
  }
  if (payload.avgHeartRate !== undefined && !isFiniteNumber(payload.avgHeartRate, 35, 240)) {
    throw new CleanSlateRepositoryError('INVALID_CARDIO', 'La FC promedio debe estar entre 35 y 240 bpm.', 400);
  }
}

export function validateNotificationInput(payload: Record<string, unknown>): void {
  if (!isNonEmptyString(payload.title, 200) || !isNonEmptyString(payload.message, 1000)) {
    throw new CleanSlateRepositoryError('INVALID_NOTIFICATION', 'Título y mensaje son obligatorios.', 400);
  }
}
