/**
 * Classification: PASS-UNIT / PASS-MOCK
 * Covers domain invariants (all 11 areas), >25 bulk batching, and >350KB/400KB size guards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { CleanSlateAuthGuard, MockCatalystAuthRuntime } from '../src/auth/cleanSlateAuthGuard.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { DomainValidationError } from '../src/validators/domainValidators.js';

async function setupAthlete() {
  const db = new CleanSlateInMemoryNoSQLAdapter(() => 1_760_000_000);
  const auth = new MockCatalystAuthRuntime();
  auth.setCurrentUser({
    zuid: 'z_ath_1',
    user_id: 'cat_ath_1',
    email_id: 'athlete1@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const guard = new CleanSlateAuthGuard(auth, db);
  const actor = await guard.bootstrapAuthenticatedProfile({});
  const service = new AthleteDataService(db);
  return { db, actor, service };
}

test('[PASS-MOCK] completeOnboarding, cardioSessions, notifications, mealLogs, recipes, mealPlans & routines populate UserData', async () => {
  const { actor, service } = await setupAthlete();

  await service.completeOnboarding(actor, {
    displayName: 'Carlos M.',
    goal: 'ganancia_muscular',
    biometrics: { weightKg: 76, heightCm: 178, age: 28, bodyFatPct: 14, palFactor: 1.55 },
    preferences: { weightUnit: 'kg', mealsPerDay: 4 },
  });
  await service.logMeal(actor, 'm_1', { dateTime: '2026-11-13T08:00', name: 'Avena', kcal: 420, protein: 30, carbs: 50, fat: 8 });
  await service.addCardioSession(actor, 'c_1', { date: '2026-11-13', durationMinutes: 35, avgHeartRate: 138 });
  await service.createNotification(actor, 'n_1', { title: 'Meta', message: 'Buen progreso' });
  await service.saveRecipe(actor, 'r_1', { name: 'Pollo y arroz', ingredients: ['pollo', 'arroz'] });
  await service.saveMealPlan(actor, '2026-11-09', { days: { monday: [] } });
  await service.saveWorkoutRoutine(actor, 'rt_1', { name: 'Upper Lower 4D' });

  const ws = await service.hydrateAthleteWorkspace(actor);
  assert.equal(ws.profile.onboardingCompleted, true);
  assert.equal(ws.biometrics?.weightKg, 76);
  assert.equal(ws.mealLogs.length, 1);
  assert.equal(ws.cardioSessions.length, 1);
  assert.equal(ws.notifications.length, 1);
  assert.equal(ws.recipes.length, 1);
  assert.equal(ws.mealPlans.length, 1);
  assert.equal(ws.workoutRoutines.length, 1);
});

test('[PASS-MOCK] workoutSessions enforces parent executedWorkout active invariant & terminal immutability', async () => {
  const { actor, service } = await setupAthlete();
  const startedAt = '2026-11-13T10:00:00.000Z';

  await assert.rejects(
    () =>
      service.logWorkoutSet(actor, 'set_orphan', startedAt, {
        executedWorkoutId: 'wk_missing',
        exerciseId: 'ex_1',
        exerciseName: 'Squat',
        weightKg: 120,
        reps: 5,
        rir: 2,
      }),
    (err: any) => err instanceof DomainValidationError && err.code === 'PARENT_WORKOUT_NOT_FOUND'
  );

  await service.startExecutedWorkout(actor, 'wk_01', {
    startedAt,
    status: 'in_progress',
    exercisesSnapshot: [{ id: 'ex_1', name: 'Squat' }],
  });

  await assert.rejects(
    () => service.startExecutedWorkout(actor, 'wk_01', { startedAt, status: 'in_progress', exercisesSnapshot: [] }),
    (err: any) => err instanceof DomainValidationError && err.code === 'WORKOUT_ALREADY_EXISTS'
  );

  await service.logWorkoutSet(actor, 'set_01', startedAt, {
    executedWorkoutId: 'wk_01',
    exerciseId: 'ex_1',
    exerciseName: 'Squat',
    weightKg: 120,
    reps: 5,
    rir: 2,
  });

  await service.completeExecutedWorkout(actor, 'wk_01', startedAt, 'completed');

  await assert.rejects(
    () =>
      service.logWorkoutSet(actor, 'set_02', startedAt, {
        executedWorkoutId: 'wk_01',
        exerciseId: 'ex_1',
        exerciseName: 'Squat',
        weightKg: 125,
        reps: 5,
        rir: 1,
      }),
    (err: any) => err instanceof DomainValidationError && err.code === 'PARENT_WORKOUT_NOT_ACTIVE'
  );
});

test('[PASS-MOCK] Bulk operation >25 items chunks cleanly into batches of <=25 items', async () => {
  const { actor, service } = await setupAthlete();
  const groceries = Array.from({ length: 60 }, (_, idx) => ({
    id: `g_${idx + 1}`,
    payload: { name: `Ingrediente ${idx + 1}`, quantity: 2, status: 'pending' },
  }));

  const res = await service.syncMealPlanToGroceries(actor, groceries);
  assert.equal(res.inserted, 60);
  assert.equal(res.batchCalls, 3);
});

test('[PASS-MOCK] Routines / items exceeding 350KB soft budget or 400KB Catalyst hard cap are rejected', async () => {
  const { actor, service } = await setupAthlete();
  const huge360kb = 'A'.repeat(360 * 1024);

  await assert.rejects(
    () => service.saveWorkoutRoutine(actor, 'rt_huge', { name: 'Massive Meso', weeksBlob: huge360kb }),
    (err: any) => err instanceof DomainValidationError && (err.code === 'PAYLOAD_BUDGET_EXCEEDED' || err.code === 'CATALYST_400KB_LIMIT_EXCEEDED')
  );
});
