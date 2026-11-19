/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Frontend Domain Engines, Validators, Parity & Mock Repository Tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  TABLE_SCHEMA_REGISTRY,
} from '../src/types/cleanSlate.js';
import { validateProfileSelfUpdate } from '../src/validators/domainValidators.js';

import { CATALYST_BUDGET_LIMITS } from '../src/frontend/contracts/cleanSlateModels.js';
import { CleanSlateRepositoryError } from '../src/frontend/contracts/repositories.js';
import {
  FORBIDDEN_PROFILE_SECURITY_FIELDS as FRONTEND_FORBIDDEN_FIELDS,
  validateBiometricsInput,
  validateCardioInput,
  validateMealLogInput,
  validateProfileSelfUpdateInput,
  validateWorkoutSetInput,
} from '../src/frontend/domain/validators.js';
import {
  cmToIn,
  computeAdaptivePeriodization,
  computeBiometricTargets,
  computeFoodSubstitution,
  computeIdempotentGrocerySync,
  groupMealLogsByDate,
  inToCm,
  kgToLbs,
  lbsToKg,
} from '../src/frontend/domain/nutritionEngine.js';
import {
  calculateAverageRir,
  calculateEffectiveTonnage,
  calculateEpley1RM,
  computeTrainingAnalytics,
  generateMesocycleProgram,
  generateRoutineDayAutoregulation,
  serializeWorkoutsToCsv,
} from '../src/frontend/domain/workoutEngine.js';
import { InMemoryCleanSlateRepository } from '../src/frontend/mocks/InMemoryCleanSlateRepository.js';

test('PARITY: Frontend contracts align 1:1 with frozen backend limits, schema tables & forbidden fields', () => {
  assert.equal(CATALYST_BUDGET_LIMITS.MAX_ITEM_BYTES, CATALYST_PLATFORM_LIMITS.MAX_ITEM_BYTES);
  assert.equal(
    CATALYST_BUDGET_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES,
    CATALYST_PLATFORM_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES
  );
  assert.equal(
    CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS,
    CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS
  );
  assert.equal(
    CATALYST_BUDGET_LIMITS.MAX_QUERY_READ_ITEMS,
    CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
  );

  assert.deepEqual(Object.keys(TABLE_SCHEMA_REGISTRY).sort(), [
    'AdminInvitations',
    'AuditLogs',
    'SystemControl',
    'UserData',
    'Users',
  ]);
  assert.equal(DIRECTORY_SEGMENTS.length, 4);

  // Every security key blocked by frontend must be blocked identically by backend validator
  for (const key of FRONTEND_FORBIDDEN_FIELDS) {
    assert.throws(() => validateProfileSelfUpdate({ [key]: 'tampered' }), /IMMUTABLE_SECURITY_FIELD|cannot be modified/);
    assert.throws(() => validateProfileSelfUpdateInput({ [key]: 'tampered' }));
  }
});

test('NUTRITION ENGINE: Unit conversions, Diophantine 4/4/9 parity & periodization (with optional Diet Break)', () => {
  assert.equal(lbsToKg(kgToLbs(80)), 80);
  assert.equal(Math.round(inToCm(cmToIn(180))), 180);

  const bio = computeBiometricTargets({
    weightKg: 78,
    heightCm: 179,
    age: 30,
    bodyFatPct: 14,
    palFactor: 1.55,
    targetDeltaKcal: -350,
    proteinPerKg: 2.2,
    fatPerKg: 0.8,
  });

  // Exact Diophantine 4/4/9 parity
  assert.equal(
    bio.targetProteinG * 4 + bio.targetCarbsG * 4 + bio.targetFatG * 9,
    bio.targetCalories
  );

  const withoutBreak = computeAdaptivePeriodization({
    goal: 'definicion',
    biometrics: bio,
    trainingDaysPerWeek: 4,
    isDeloadWeek: true,
    dietBreakSelected: false,
  });
  assert.equal(withoutBreak.dietBreakApplied, false);
  assert.equal(withoutBreak.proposedTargets.targetDeltaKcal, -350);

  const withBreak = computeAdaptivePeriodization({
    goal: 'definicion',
    biometrics: bio,
    trainingDaysPerWeek: 4,
    isDeloadWeek: true,
    dietBreakSelected: true,
  });
  assert.equal(withBreak.dietBreakApplied, true);
  assert.equal(withBreak.proposedTargets.targetDeltaKcal, 0);
});

test('NUTRITION ENGINE: Food substitutions, idempotent grocery sync (<=25 batches) & non-NULL daily compliance', () => {
  const sub = computeFoodSubstitution('usda-pechuga-pollo', 150, 'usda-atun-agua', 'isoprotein');
  assert.ok(sub);
  assert.ok(Math.abs(sub.deltaProtein) <= 2, 'Isoprotein substitution should closely match protein');

  const dates = ['2026-11-10', '2026-11-11'];
  const grouped = groupMealLogsByDate(
    [
      {
        id: 'm1',
        dateTime: '2026-11-10T08:30',
        moment: 'desayuno',
        name: 'Avena',
        description: 'Avena',
        portion: '1',
        kcal: 500,
        protein: 35,
        carbs: 60,
        fat: 12,
        source: 'Manual',
      },
    ],
    dates
  );
  assert.equal(grouped[0].status, 'logged');
  assert.equal(grouped[0].calories, 500);
  // Unlogged day MUST stay null (non-NULL bias avoided)
  assert.equal(grouped[1].status, 'unlogged');
  assert.equal(grouped[1].calories, null);

  const sync = computeIdempotentGrocerySync(
    [
      {
        id: 'g_manual',
        name: 'Sal marina',
        quantity: 1,
        unit: 'frasco',
        department: 'grasas',
        status: 'pending',
        origin: 'manual',
      },
      {
        id: 'g_bought',
        name: 'Pechuga de Pollo (cruda)',
        quantity: 300,
        unit: 'g',
        department: 'carnes',
        status: 'bought',
        origin: 'plan',
        planKey: 'usda-pechuga-pollo__crudo',
      },
    ],
    {
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      label: 'Semana test',
      days: {
        '2026-11-09': {
          date: '2026-11-09',
          dayLabel: 'Lun',
          meals: {
            almuerzo: {
              recipeId: 'r1',
              recipeName: 'Pollo',
              calories: 400,
              protein: 45,
              carbs: 30,
              fat: 8,
              servings: 1,
            },
          },
        },
      },
      updatedAt: new Date().toISOString(),
    },
    [
      {
        id: 'r1',
        name: 'Pollo',
        suggestedMoment: 'almuerzo',
        servings: 1,
        prepTimeMinutes: 15,
        ingredients: [
          { foodId: 'usda-pechuga-pollo', foodName: 'Pollo', grams: 180, calories: 216, protein: 40.5, carbs: 0, fat: 4.7 },
          { foodId: 'usda-arroz-basmati', foodName: 'Arroz', grams: 80, calories: 285, protein: 6, carbs: 62.6, fat: 0.7 },
        ],
        totalNutrients: { calories: 501, protein: 46.5, carbs: 62.6, fat: 5.4 },
        updatedAt: new Date().toISOString(),
      },
    ]
  );

  assert.equal(sync.preservedManualCount, 1);
  assert.equal(sync.preservedBoughtCount, 1);
  assert.equal(sync.addedCount, 1);
  assert.equal(sync.estimatedBatchCalls, 1);
});

test('WORKOUT ENGINE: Warmup exclusion, Epley 1RM, ACWR sufficiency, autoregulation & mesocycle', () => {
  assert.equal(calculateEpley1RM(100, 1), 100);
  assert.equal(calculateEpley1RM(100, 5), 116.7);

  const sampleSets = [
    {
      id: 's_warm',
      executedWorkoutId: 'w1',
      exerciseId: 'barbell_bench_press',
      exerciseName: 'Press Banca',
      muscleGroup: 'pecho' as const,
      setNumber: 1,
      type: 'warmup' as const,
      weightKg: 60,
      reps: 10,
      rir: 5,
      completed: true,
      estimated1RM: 80,
      completedAt: '2026-11-10T10:00:00.000Z',
    },
    {
      id: 's_eff',
      executedWorkoutId: 'w1',
      exerciseId: 'barbell_bench_press',
      exerciseName: 'Press Banca',
      muscleGroup: 'pecho' as const,
      setNumber: 2,
      type: 'effective' as const,
      weightKg: 90,
      reps: 8,
      rir: 2,
      completed: true,
      estimated1RM: 114,
      completedAt: '2026-11-10T10:05:00.000Z',
    },
  ];

  // Warmup (60*10=600) must NOT count toward effective tonnage (only 90*8=720)
  assert.equal(calculateEffectiveTonnage(sampleSets), 720);
  assert.equal(calculateAverageRir(sampleSets), 2);

  // Short history (<21d) marks ACWR uncalculable
  const shortAnalytics = computeTrainingAnalytics(
    [
      {
        id: 'w1',
        routineName: 'R',
        routineDayName: 'D1',
        status: 'completed',
        startedAt: '2026-11-10T09:50:00.000Z',
        completedAt: '2026-11-10T10:40:00.000Z',
        durationSeconds: 3000,
        totalTonnageKg: 720,
        totalCompletedSets: 1,
        totalReps: 8,
        averageRir: 2,
        exercisesSnapshot: [],
      },
    ],
    sampleSets,
    '12w',
    new Date('2026-11-12T12:00:00.000Z').getTime()
  );
  assert.equal(shortAnalytics.acwr.isCalculable, false);
  assert.equal(shortAnalytics.totalWarmupSetsExcluded, 1);
  assert.equal(shortAnalytics.exerciseSummaries[0].bestWeightKg, 90);

  const meso = generateMesocycleProgram({
    name: 'Meso 6S',
    goal: 'hipertrofia',
    experience: 'intermedio',
    daysPerWeek: 4,
    durationWeeks: 6,
    availableEquipment: ['barra', 'mancuerna'],
    includeDeloadWeek: true,
  });
  assert.equal(meso.mesocycleConfig?.weeks.length, 6);
  assert.equal(meso.mesocycleConfig?.weeks[5].isDeload, true);

  const csv = serializeWorkoutsToCsv([], sampleSets);
  assert.ok(csv.includes('1RM_Epley'));
  assert.ok(csv.includes('Press Banca'));

  const auto = generateRoutineDayAutoregulation(
    meso.days[0],
    [
      {
        id: 'w1',
        routineName: 'Meso',
        routineDayName: 'Torso',
        status: 'completed',
        startedAt: '2026-11-10T09:50:00.000Z',
        durationSeconds: 3000,
        totalTonnageKg: 720,
        totalCompletedSets: 1,
        totalReps: 8,
        averageRir: 2,
        exercisesSnapshot: [],
      },
    ],
    sampleSets
  );
  assert.equal(auto[0].action, 'increase_load');
});

test('VALIDATORS & MOCK REPO: Enforces bounds, security fields, 350KB ceiling, workout immutability & RBAC', async () => {
  const repo = new InMemoryCleanSlateRepository({ delayMs: 0 });

  // 1. Immutable security fields blocked on profile update
  await assert.rejects(
    () => repo.updateOwnProfile('usr_athlete_01', { role: 'superadmin' }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'IMMUTABLE_SECURITY_FIELD'
  );

  // 2. Domain bounds
  assert.throws(
    () => validateBiometricsInput({ weightKg: 10, heightCm: 175, age: 25, bodyFatPct: 12, palFactor: 1.5 }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'INVALID_BIOMETRICS'
  );
  assert.throws(
    () => validateMealLogInput({ dateTime: 'bad-date', name: 'Test', kcal: 100, protein: 10, carbs: 10, fat: 2 }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'INVALID_MEAL_LOG'
  );
  assert.throws(
    () => validateCardioInput({ date: '2026-11-10', title: 'Run', durationMinutes: 0 }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'INVALID_CARDIO'
  );

  // 3. 350 KB ceiling enforcement
  const hugeInstructions = 'A'.repeat(360 * 1024);
  await assert.rejects(
    () =>
      repo.saveRecipe('usr_athlete_01', {
        id: 'rec_huge',
        name: 'Huge Recipe',
        suggestedMoment: 'cena',
        servings: 1,
        prepTimeMinutes: 10,
        ingredients: [
          { foodId: 'usda-pechuga-pollo', foodName: 'Pollo', grams: 150, calories: 180, protein: 33, carbs: 0, fat: 3.9 },
        ],
        totalNutrients: { calories: 180, protein: 33, carbs: 0, fat: 3.9 },
        instructions: hugeInstructions,
        updatedAt: new Date().toISOString(),
      }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'PAYLOAD_BUDGET_EXCEEDED'
  );

  // 4. Workout lifecycle & terminal immutability
  const started = await repo.startExecutedWorkout('usr_athlete_01', {
    routineName: 'Rutina Test',
    routineDayName: 'Torso Test',
    exercisesSnapshot: [
      {
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Press Banca',
        muscleGroup: 'pecho',
        equipment: 'barra',
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetRir: 2,
        targetWeightKg: 80,
        plannedSets: 3,
      },
    ],
  });

  // Cannot start a second active session concurrently
  await assert.rejects(
    () =>
      repo.startExecutedWorkout('usr_athlete_01', {
        routineName: 'Otra',
        routineDayName: 'Pierna',
        exercisesSnapshot: [],
      }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'ACTIVE_WORKOUT_ALREADY_OPEN'
  );

  await repo.logWorkoutSet('usr_athlete_01', {
    executedWorkoutId: started.id,
    exerciseId: 'barbell_bench_press',
    exerciseName: 'Press Banca',
    muscleGroup: 'pecho',
    setNumber: 1,
    type: 'effective',
    weightKg: 80,
    reps: 8,
    rir: 2,
    completed: true,
  });

  const closed = await repo.completeExecutedWorkout('usr_athlete_01', started.id, 'completed', {
    durationSeconds: 2400,
    sessionRpe: 8,
  });
  assert.equal(closed.status, 'completed');

  // Cannot log set on completed parent
  await assert.rejects(
    () =>
      repo.logWorkoutSet('usr_athlete_01', {
        executedWorkoutId: started.id,
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Press Banca',
        muscleGroup: 'pecho',
        setNumber: 2,
        type: 'effective',
        weightKg: 80,
        reps: 8,
        rir: 2,
        completed: true,
      }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'PARENT_WORKOUT_NOT_ACTIVE'
  );

  // Cannot re-close terminal workout
  await assert.rejects(
    () => repo.completeExecutedWorkout('usr_athlete_01', started.id, 'abandoned', { durationSeconds: 600 }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'WORKOUT_TERMINAL_IMMUTABLE'
  );

  assert.throws(
    () => validateWorkoutSetInput({ executedWorkoutId: 'w_x' }, 'completed'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'PARENT_WORKOUT_NOT_ACTIVE'
  );

  // 5. Admin RBAC & safety locks
  await assert.rejects(
    () => repo.listUsers('usr_athlete_01'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'PERMISSION_DENIED'
  );
  await assert.rejects(
    () => repo.createInvitation('usr_admin_01', 'otro@vigorcore.local', 'admin'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'PRIVILEGE_ESCALATION_BLOCKED'
  );
  await assert.rejects(
    () => repo.setUserStatus('usr_admin_01', 'usr_admin_01', 'suspended'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'SELF_SUSPENSION_BLOCKED'
  );
  await assert.rejects(
    () => repo.setUserRole('usr_superadmin_01', 'usr_athlete_01', 'superadmin'),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED'
  );

  // 6. Invite creation + redemption lifecycle
  const createdInv = await repo.createInvitation('usr_superadmin_01', 'coach2@vigorcore.local', 'admin');
  assert.equal(createdInv.status, 'pending');
  const redeemed = await repo.redeemInvitationPreview(
    'usr_athlete_01',
    createdInv.inviteId,
    createdInv.rawTokenPreview!
  );
  assert.equal(redeemed.assignedRole, 'admin');

  // 7. Fault simulation modes
  repo.setFaultMode('empty_workspace');
  const emptySnap = await repo.hydrateWorkspace('usr_athlete_01');
  assert.equal(emptySnap.biometrics, null);
  assert.equal(emptySnap.mealLogs.length, 0);

  repo.setFaultMode('network_error');
  await assert.rejects(
    () => repo.hydrateWorkspace('usr_athlete_01'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'MOCK_SIMULATED_NETWORK_ERROR'
  );
});
