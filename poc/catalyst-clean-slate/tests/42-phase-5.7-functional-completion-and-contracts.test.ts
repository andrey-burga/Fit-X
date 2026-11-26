/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.7 — Test Suite 42:
 * Backend Functional Completion & Full API Contract Verification (53 Routes).
 *
 * Scope Classification: LOCAL_VERIFIED (Express loopback `127.0.0.1:0` +
 * CleanSlateInMemoryNoSQLAdapter + MockCatalystAuthRuntime).
 * Zero remote Catalyst operations.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { verifyReconciliationCompleteness } from '../src/provisioning/schemaReconciliationAudit.js';
import {
  CANONICAL_ROUTE_COUNT,
  ROUTE_CONTRACT_SPECS,
} from '../src/routes/routeContracts.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { KeyBuilders, type UserAccountItem } from '../src/types/cleanSlate.js';

const ORIGIN = 'https://app.vigorcore.lat';

function createRuntime(nowSec = 1_760_200_000) {
  const adapter = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const bundle = createVigorCoreProductionRuntimeFromEnv(
    {
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      CATALYST_PROJECT_KEY: 'proj_key_57_test',
      VIGOR_ENVIRONMENT: 'test',
      VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
      VIGORCORE_CATALYST_API_DOMAIN: 'http://127.0.0.1:19999',
      VIGORCORE_CATALYST_ACCOUNTS_URL: 'http://127.0.0.1:19998',
      CATALYST_ADMIN_CLIENT_ID: '1000.TEST_57',
      CATALYST_ADMIN_CLIENT_SECRET: 'secret_57_test',
      CATALYST_ADMIN_REFRESH_TOKEN: 'refresh_57_test',
      VIGOR_SESSION_HMAC_SECRET: ServerSessionTokenManager.generateStrongSecret(32),
      VIGOR_SESSION_ACTIVE_KID: 'k1',
      VIGOR_ALLOWED_ORIGINS: ORIGIN,
    },
    {
      allowInsecureLoopbackForTest: true,
      adapterOverride: adapter,
      authRuntimeOverride: authRuntime,
      nowSecProvider: () => nowSec,
      nowMsProvider: () => nowSec * 1000,
    }
  );
  return { adapter, authRuntime, bundle };
}

async function startServer(app: http.RequestListener) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async hit(
      method: string,
      path: string,
      opts: { cookie?: string; csrf?: string | null; body?: unknown; extraHeaders?: Record<string, string> } = {}
    ) {
      const headers: Record<string, string> = {
        Origin: ORIGIN,
        ...(opts.extraHeaders ?? {}),
      };
      if (opts.cookie) headers.Cookie = `${SIGNED_SESSION_COOKIE_NAME}=${opts.cookie}`;
      if (opts.csrf) headers['X-Vigor-CSRF'] = opts.csrf;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? (JSON.parse(text) as Record<string, any>) : {},
      };
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function extractCookie(headers: Headers): string {
  const raw = headers.get('set-cookie') ?? '';
  const m = raw.match(new RegExp(`${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`));
  assert.ok(m, `Expected ${SIGNED_SESSION_COOKIE_NAME} cookie in '${raw}'`);
  return m[1];
}

test('Phase 5.7 [LOCAL_VERIFIED / PASS-UNIT] Route & schema reconciliation locks 53 routes and promotes UserData.GSI_UserEntityDate & AdminInvitations.GSI_InviteEmailStatus', () => {
  assert.equal(CANONICAL_ROUTE_COUNT, 53);
  assert.equal(ROUTE_CONTRACT_SPECS.length, 53);

  const report = verifyReconciliationCompleteness();
  assert.equal(report.routeCount, 53);
  assert.equal(report.mappedCount, 53);
  assert.deepEqual(report.missingRouteIds, []);
  assert.deepEqual(report.extraRouteIds, []);
  assert.deepEqual(report.missingGsis, []);
});

test('Phase 5.7 [LOCAL_VERIFIED / PASS-LOOPBACK] Athlete CRUD completions, GSI date queries, 35-item grocery clearCompleted, single-active-workout 409, idempotent sets, warmup exclusion & server macro synthesis', async () => {
  const { adapter, authRuntime, bundle } = createRuntime();
  const srv = await startServer(bundle.app);

  try {
    // 1. Bootstrap Athlete A & Athlete B
    authRuntime.setCurrentUser({
      zuid: 'z_57_a',
      user_id: 'ath_57_a',
      email_id: 'atleta.a@vigorcore.lat',
      first_name: 'Carlos',
      last_name: 'Vega',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const bootA = await srv.hit('POST', '/api/v1/auth/session/bootstrap-profile', {
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    assert.equal(bootA.status, 200);
    const cookieA = extractCookie(bootA.headers);
    const csrfA = String(bootA.body.csrfToken);

    authRuntime.setCurrentUser({
      zuid: 'z_57_b',
      user_id: 'ath_57_b',
      email_id: 'atleta.b@vigorcore.lat',
      first_name: 'Ana',
      last_name: 'Soto',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const bootB = await srv.hit('POST', '/api/v1/auth/session/bootstrap-profile', {
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    assert.equal(bootB.status, 200);
    const cookieB = extractCookie(bootB.headers);
    const csrfB = String(bootB.body.csrfToken);
    authRuntime.setCurrentUser(null);

    // 2. Profile avatarUrl validation (HTTPS allowed, javascript: rejected 400)
    const badAvatar = await srv.hit('PATCH', '/api/v1/athlete/profile', {
      cookie: cookieA,
      csrf: csrfA,
      body: { avatarUrl: 'javascript:alert(1)' },
    });
    assert.equal(
      badAvatar.status,
      400,
      `Expected 400 for badAvatar, got ${badAvatar.status}: ${JSON.stringify(badAvatar.body)}`
    );

    const okProfile = await srv.hit('PATCH', '/api/v1/athlete/profile', {
      cookie: cookieA,
      csrf: csrfA,
      body: { avatarUrl: 'https://cdn.vigorcore.lat/avatars/carlos.png', location: 'Madrid' },
    });
    assert.equal(okProfile.status, 200);
    assert.equal(okProfile.body.profile.avatarUrl, 'https://cdn.vigorcore.lat/avatars/carlos.png');
    assert.equal(okProfile.body.profile.location, 'Madrid');

    // 3. Server-side Mifflin-St Jeor & Diophantine 4/4/9 macro synthesis on onboarding & biometrics PUT
    const onboarding = await srv.hit('POST', '/api/v1/athlete/onboarding/complete', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        name: 'Carlos Vega Pro',
        goal: 'recomposicion',
        biometrics: {
          weightKg: 80,
          heightCm: 180,
          age: 30,
          bodyFatPct: 14,
          palFactor: 1.55,
          targetDeltaKcal: -200,
          proteinPerKg: 2.0,
          fatPerKg: 0.9,
        },
        preferences: { weightUnit: 'kg', trainingDaysPerWeek: 4 },
      },
    });
    assert.equal(
      onboarding.status,
      200,
      `Expected 200 for onboarding, got ${onboarding.status}: ${JSON.stringify(onboarding.body)}`
    );
    assert.equal(onboarding.body.profile.displayName, 'Carlos Vega Pro');
    const obBio = onboarding.body.biometrics as Record<string, number>;
    assert.ok(obBio.bmr > 1500);
    assert.ok(obBio.tdee > obBio.bmr);
    assert.equal(
      obBio.targetProteinG * 4 + obBio.targetCarbsG * 4 + obBio.targetFatG * 9,
      obBio.targetCalories,
      'Synthesized onboarding macros must reconcile exactly under 4/4/9 energy rule'
    );

    const putBio = await srv.hit('PUT', '/api/v1/athlete/biometrics', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        weightKg: 82,
        heightCm: 180,
        age: 30,
        bodyFatPct: 14,
        palFactor: 1.6,
        targetDeltaKcal: 250,
      },
    });
    assert.equal(putBio.status, 200);
    const bioPayload = putBio.body.item.payload as Record<string, number>;
    assert.equal(
      bioPayload.targetProteinG * 4 + bioPayload.targetCarbsG * 4 + bioPayload.targetFatG * 9,
      bioPayload.targetCalories
    );

    // 4. Meal log canonical aliases (`title`, `calories`, `fats`)
    const mealAlias = await srv.hit('POST', '/api/v1/athlete/meals', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'meal_alias_1',
        dateTime: '2026-11-18T13:30',
        moment: 'almuerzo',
        title: 'Salmón con Arroz',
        calories: 640,
        protein: 44,
        carbs: 62,
        fats: 22,
      },
    });
    assert.equal(mealAlias.status, 201);
    assert.equal(mealAlias.body.item.payload.name, 'Salmón con Arroz');
    assert.equal(mealAlias.body.item.payload.kcal, 640);
    assert.equal(mealAlias.body.item.payload.fat, 22);

    // 5. Recipes PUT version increment + GET /recipes & Meal Plans PUT + GET /meal-plans
    await srv.hit('PUT', '/api/v1/athlete/recipes/rec_57_1', {
      cookie: cookieA,
      csrf: csrfA,
      body: { name: 'Bowl Proteico v1', ingredients: [{ foodId: 'pollo', grams: 200 }] },
    });
    const recV2 = await srv.hit('PUT', '/api/v1/athlete/recipes/rec_57_1', {
      cookie: cookieA,
      csrf: csrfA,
      body: { name: 'Bowl Proteico v2', ingredients: [{ foodId: 'pollo', grams: 250 }] },
    });
    assert.equal(recV2.status, 200);
    assert.equal(recV2.body.item.version, 2);

    const listRecipes = await srv.hit('GET', '/api/v1/athlete/recipes', { cookie: cookieA });
    assert.equal(listRecipes.status, 200);
    assert.equal(listRecipes.body.items.length, 1);
    assert.equal(listRecipes.body.items[0].payload.name, 'Bowl Proteico v2');

    await srv.hit('PUT', '/api/v1/athlete/meal-plans/2026-11-16', {
      cookie: cookieA,
      csrf: csrfA,
      body: { label: 'Semana 47', days: { monday: { dayLabel: 'Lunes' } } },
    });
    const listPlans = await srv.hit('GET', '/api/v1/athlete/meal-plans', { cookie: cookieA });
    assert.equal(listPlans.status, 200);
    assert.equal(listPlans.body.items.length, 1);

    // 6. Groceries: status `'completed'`, partial PATCH edit without losing status, GET filter, >25-item DELETE /completed
    const gBatch1 = Array.from({ length: 25 }, (_, i) => ({
      id: `g_57_${i}`,
      name: `Item ${i}`,
      quantity: 1 + i,
      status: i < 20 ? 'completed' : 'pending',
    }));
    const gBatch2 = Array.from({ length: 12 }, (_, i) => ({
      id: `g_57_${25 + i}`,
      name: `Item ${25 + i}`,
      quantity: 2,
      status: i < 10 ? 'bought' : 'in_pantry',
    }));
    assert.equal(
      (
        await srv.hit('PUT', '/api/v1/athlete/groceries/sync', {
          cookie: cookieA,
          csrf: csrfA,
          body: { items: gBatch1, replaceExisting: true },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await srv.hit('PUT', '/api/v1/athlete/groceries/sync', {
          cookie: cookieA,
          csrf: csrfA,
          body: { items: gBatch2, replaceExisting: false },
        })
      ).status,
      200
    );

    // Partial edit on g_57_0 (status is 'completed') updates name/quantity/notes without changing status
    const patchGroceryEdit = await srv.hit('PATCH', '/api/v1/athlete/groceries/g_57_0', {
      cookie: cookieA,
      csrf: csrfA,
      body: { name: 'Pechuga Orgánica', quantity: 1200, unit: 'g', notes: 'Corte limpio', isCustomized: true },
    });
    assert.equal(patchGroceryEdit.status, 200);
    assert.equal(patchGroceryEdit.body.grocery.status, 'completed');
    assert.equal(patchGroceryEdit.body.grocery.name, 'Pechuga Orgánica');
    assert.equal(patchGroceryEdit.body.grocery.quantity, 1200);
    assert.equal(patchGroceryEdit.body.grocery.isCustomized, true);

    const listCompletedGroceries = await srv.hit('GET', '/api/v1/athlete/groceries?status=completed', {
      cookie: cookieA,
    });
    assert.equal(listCompletedGroceries.status, 200);
    assert.equal(listCompletedGroceries.body.items.length, 20);

    // DELETE /api/v1/athlete/groceries/completed must remove all 30 completed/bought items across >=2 batches and KEEP the 7 pending/in_pantry items
    const clearCompleted = await srv.hit('DELETE', '/api/v1/athlete/groceries/completed', {
      cookie: cookieA,
      csrf: csrfA,
    });
    assert.equal(clearCompleted.status, 200);
    assert.equal(clearCompleted.body.deletedCount, 30);
    assert.equal(clearCompleted.body.batchCalls, 2);

    const remainingGroceries = await srv.hit('GET', '/api/v1/athlete/groceries', { cookie: cookieA });
    assert.equal(remainingGroceries.status, 200);
    assert.equal(remainingGroceries.body.items.length, 7);

    // 7. Workout Routines: PUT + auto-clear previous default + GET + DELETE
    await srv.hit('PUT', '/api/v1/athlete/routines/rt_57_1', {
      cookie: cookieA,
      csrf: csrfA,
      body: { name: 'Rutina A', isDefault: true, days: [] },
    });
    await srv.hit('PUT', '/api/v1/athlete/routines/rt_57_2', {
      cookie: cookieA,
      csrf: csrfA,
      body: { name: 'Rutina B', isDefault: true, days: [] },
    });
    const listRoutines = await srv.hit('GET', '/api/v1/athlete/routines', { cookie: cookieA });
    assert.equal(listRoutines.status, 200);
    assert.equal(listRoutines.body.items.length, 2);
    const rt1 = listRoutines.body.items.find((r: any) => r.entityId === 'rt_57_1');
    const rt2 = listRoutines.body.items.find((r: any) => r.entityId === 'rt_57_2');
    assert.equal(rt1.payload.isDefault, false);
    assert.equal(rt2.payload.isDefault, true);

    const delRt = await srv.hit('DELETE', '/api/v1/athlete/routines/rt_57_1', {
      cookie: cookieA,
      csrf: csrfA,
    });
    assert.equal(delRt.status, 200);
    assert.equal(
      (await srv.hit('GET', '/api/v1/athlete/routines', { cookie: cookieA })).body.items.length,
      1
    );

    // 8. Executed Workouts: single active session 409, offline set replay idempotency, warmup exclusion, detail & GSI date query
    const wkStart1 = await srv.hit('POST', '/api/v1/athlete/workouts/start', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'wk_57_1',
        startedAt: '2026-11-18T10:00:00.000Z',
        routineName: 'Upper/Lower',
        routineDayName: 'Upper A',
        exercisesSnapshot: [],
      },
    });
    assert.equal(wkStart1.status, 201);

    const wkConflict = await srv.hit('POST', '/api/v1/athlete/workouts/start', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'wk_57_2',
        startedAt: '2026-11-18T10:30:00.000Z',
        routineName: 'Upper/Lower',
        routineDayName: 'Upper B',
        exercisesSnapshot: [],
      },
    });
    assert.equal(wkConflict.status, 409);
    assert.equal(wkConflict.body.error, 'ACTIVE_WORKOUT_ALREADY_OPEN');

    // Warmup set has estimated1RM = 0 and is excluded from completion tonnage
    const warmupSet = await srv.hit('POST', '/api/v1/athlete/workouts/wk_57_1/sets', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'set_57_warm',
        exerciseId: 'ex_squat',
        exerciseName: 'Sentadilla',
        setNumber: 1,
        type: 'warmup',
        weightKg: 60,
        reps: 10,
        rir: 5,
      },
    });
    assert.equal(warmupSet.status, 201);
    assert.equal(warmupSet.body.item.payload.estimated1RM, 0);

    const effSet = await srv.hit('POST', '/api/v1/athlete/workouts/wk_57_1/sets', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'set_57_eff',
        exerciseId: 'ex_squat',
        exerciseName: 'Sentadilla',
        setNumber: 2,
        type: 'effective',
        weightKg: 120,
        reps: 5,
        rir: 2,
      },
    });
    assert.equal(effSet.status, 201);
    assert.equal(effSet.body.item.payload.estimated1RM, 140); // 120 * (1 + 5/30) = 140

    // Offline replay of identical setId succeeds idempotently with 201
    const effReplay = await srv.hit('POST', '/api/v1/athlete/workouts/wk_57_1/sets', {
      cookie: cookieA,
      csrf: csrfA,
      body: {
        id: 'set_57_eff',
        exerciseId: 'ex_squat',
        exerciseName: 'Sentadilla',
        setNumber: 2,
        type: 'effective',
        weightKg: 120,
        reps: 5,
        rir: 2,
      },
    });
    assert.equal(effReplay.status, 201);
    assert.equal(effReplay.body.item.entityId, 'set_57_eff');

    // Completing non-existent workout returns 404 WORKOUT_NOT_FOUND
    const missingComplete = await srv.hit('POST', '/api/v1/athlete/workouts/wk_missing/complete', {
      cookie: cookieA,
      csrf: csrfA,
      body: { finalStatus: 'completed', durationSeconds: 1800 },
    });
    assert.equal(missingComplete.status, 404);
    assert.equal(missingComplete.body.error, 'WORKOUT_NOT_FOUND');

    const wkComplete = await srv.hit('POST', '/api/v1/athlete/workouts/wk_57_1/complete', {
      cookie: cookieA,
      csrf: csrfA,
      body: { finalStatus: 'completed', durationSeconds: 2700, sessionRpe: 8 },
    });
    assert.equal(wkComplete.status, 200);
    // Warmup (60*10) MUST be excluded; only effective set (120*5 = 600) counted
    assert.equal(wkComplete.body.item.payload.totalTonnageKg, 600);
    assert.equal(wkComplete.body.item.payload.totalCompletedSets, 1);
    assert.equal(wkComplete.body.item.payload.totalReps, 5);
    assert.equal(wkComplete.body.item.payload.totalWarmupSets, 1);

    const wkListRange = await srv.hit(
      'GET',
      '/api/v1/athlete/workouts?startDate=2026-11-01&endDate=2026-11-30',
      { cookie: cookieA }
    );
    assert.equal(wkListRange.status, 200);
    assert.equal(wkListRange.body.items.length, 1);

    const wkDetail = await srv.hit('GET', '/api/v1/athlete/workouts/wk_57_1', { cookie: cookieA });
    assert.equal(wkDetail.status, 200);
    assert.equal(wkDetail.body.sets.length, 2);
    assert.equal(wkDetail.body.sets[0].id, 'set_57_warm');
    assert.equal(wkDetail.body.sets[1].id, 'set_57_eff');

    // Anti-IDOR: Athlete B gets 404 on Athlete A's workout detail & 0 items on lists
    const bWorkoutDetail = await srv.hit('GET', '/api/v1/athlete/workouts/wk_57_1', { cookie: cookieB });
    assert.equal(bWorkoutDetail.status, 404);
    const bMeals = await srv.hit('GET', '/api/v1/athlete/meals?startDate=2026-11-01&endDate=2026-11-30', {
      cookie: cookieB,
    });
    assert.equal(bMeals.status, 200);
    assert.equal(bMeals.body.items.length, 0);

    // 9. Cardio (`avgHr`/`maxHr` aliases + GSI date filter) & Notifications (GET + unreadOnly + DELETE)
    const cardioCreated = await srv.hit('POST', '/api/v1/athlete/cardio', {
      cookie: cookieA,
      csrf: csrfA,
      body: { id: 'cardio_57_1', date: '2026-11-18', title: 'HIIT Remo', durationMinutes: 25, avgHr: 158, maxHr: 179 },
    });
    assert.equal(cardioCreated.status, 201);
    assert.equal(cardioCreated.body.item.payload.avgHeartRate, 158);
    assert.equal(cardioCreated.body.item.payload.maxHeartRate, 179);

    const cardioRange = await srv.hit('GET', '/api/v1/athlete/cardio?startDate=2026-11-18&endDate=2026-11-18', {
      cookie: cookieA,
    });
    assert.equal(cardioRange.status, 200);
    assert.equal(cardioRange.body.items.length, 1);

    await srv.hit('POST', '/api/v1/athlete/notifications', {
      cookie: cookieA,
      csrf: csrfA,
      body: { id: 'notif_57_1', title: 'Unread', message: 'Pendiente', category: 'sistema' },
    });
    await srv.hit('POST', '/api/v1/athlete/notifications', {
      cookie: cookieA,
      csrf: csrfA,
      body: { id: 'notif_57_2', title: 'Read', message: 'Leída', category: 'sistema' },
    });
    await srv.hit('PATCH', '/api/v1/athlete/notifications/notif_57_2/read', {
      cookie: cookieA,
      csrf: csrfA,
      body: { read: true },
    });

    const unreadList = await srv.hit('GET', '/api/v1/athlete/notifications?unreadOnly=true', { cookie: cookieA });
    assert.equal(unreadList.status, 200);
    assert.equal(unreadList.body.items.length, 1);
    assert.equal(unreadList.body.items[0].entityId, 'notif_57_1');

    const delNotif = await srv.hit('DELETE', '/api/v1/athlete/notifications/notif_57_2', {
      cookie: cookieA,
      csrf: csrfA,
    });
    assert.equal(delNotif.status, 200);
    assert.equal(delNotif.body.deleted, true);

    // 10. Anti-IDOR check on Athlete B trying to access Athlete A's items (even if unused on adapter directly)
    assert.ok(
      await adapter.fetchItem('Users', { pk: KeyBuilders.userPk('ath_57_a') }),
      'Athlete A exists in Users table'
    );
    assert.equal(
      (await srv.hit('GET', '/api/v1/athlete/notifications', { cookie: cookieB })).body.items.length,
      0
    );
  } finally {
    await srv.close();
  }
});

test('Phase 5.7 [LOCAL_VERIFIED / PASS-LOOPBACK] Admin GET /invitations (global AuditLogs hydration + GSI_InviteEmailStatus filter), directory pre-slice search/sort, & enriched stats', async () => {
  const { adapter, authRuntime, bundle } = createRuntime(1_760_200_000);
  const srv = await startServer(bundle.app);

  try {
    // Seed 3 athletes + 1 admin
    const seedUser = async (uid: string, zuid: string, email: string, first: string, confirmed: boolean) => {
      authRuntime.setCurrentUser({
        zuid,
        user_id: uid,
        email_id: email,
        first_name: first,
        last_name: 'Test',
        status: 'ACTIVE',
        is_confirmed: confirmed,
      });
      const res = await srv.hit('POST', '/api/v1/auth/session/bootstrap-profile', {
        extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
        body: {},
      });
      assert.equal(res.status, 200);
      return { cookie: extractCookie(res.headers), csrf: String(res.body.csrfToken) };
    };

    const admSession = await seedUser('adm_57', 'z_adm_57', 'adm57@vigorcore.lat', 'Laura', true);
    const athSession = await seedUser('ath_57_1', 'z_ath_57_1', 'zoe@vigorcore.lat', 'Zoe', true);
    await seedUser('ath_57_2', 'z_ath_57_2', 'abraham@vigorcore.lat', 'Abraham', true);
    await adapter.updateItem<UserAccountItem>(
      'Users',
      { pk: KeyBuilders.userPk('ath_57_2') },
      { emailVerified: false }
    );

    // Elevate adm_57 server-side and mint fresh session
    await adapter.updateItem<UserAccountItem>('Users', { pk: KeyBuilders.userPk('adm_57') }, { role: 'admin', roleVersion: 2 });
    authRuntime.setCurrentUser({
      zuid: 'z_adm_57',
      user_id: 'adm_57',
      email_id: 'adm57@vigorcore.lat',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const admExch = await srv.hit('POST', '/api/v1/auth/session/exchange', {
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    const admCookie = extractCookie(admExch.headers);
    const admCsrf = String(admExch.body.csrfToken);
    authRuntime.setCurrentUser(null);

    // Athlete 403 on GET /api/v1/admin/invitations
    const deniedAthlete = await srv.hit('GET', '/api/v1/admin/invitations', {
      cookie: athSession.cookie,
    });
    assert.equal(deniedAthlete.status, 403);

    // Create 2 invitations & revoke 1
    const inv1 = await srv.hit('POST', '/api/v1/admin/invitations', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { targetEmail: 'coach.uno@vigorcore.lat', targetRole: 'athlete' },
    });
    assert.equal(inv1.status, 201);

    const inv2 = await srv.hit('POST', '/api/v1/admin/invitations', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { targetEmail: 'coach.dos@vigorcore.lat', targetRole: 'athlete' },
    });
    assert.equal(inv2.status, 201);

    await srv.hit('POST', `/api/v1/admin/invitations/${inv2.body.inviteId}/revoke`, {
      cookie: admCookie,
      csrf: admCsrf,
      body: { reason: 'Prueba filtro status' },
    });

    // Global GET /invitations (hydrated from AuditLogs.GSI_GlobalChronology) returns both + zero tokenHash leaks
    const allInv = await srv.hit('GET', '/api/v1/admin/invitations', { cookie: admCookie });
    assert.equal(allInv.status, 200);
    assert.equal(allInv.body.items.length, 2);
    for (const item of allInv.body.items) {
      assert.equal(item.tokenHash, undefined, 'tokenHash must never be exposed in invitation list');
    }

    // Filtered by status=pending
    const pendingInv = await srv.hit('GET', '/api/v1/admin/invitations?status=pending', { cookie: admCookie });
    assert.equal(pendingInv.status, 200);
    assert.equal(pendingInv.body.items.length, 1);
    assert.equal(pendingInv.body.items[0].inviteId, inv1.body.inviteId);

    // Filtered by email -> uses AdminInvitations.GSI_InviteEmailStatus
    const byEmailInv = await srv.hit('GET', '/api/v1/admin/invitations?email=coach.dos@vigorcore.lat', {
      cookie: admCookie,
    });
    assert.equal(byEmailInv.status, 200);
    assert.equal(byEmailInv.body.items.length, 1);
    assert.equal(byEmailInv.body.queryStrategy, 'GSI_InviteEmailStatus');
    assert.equal(byEmailInv.body.items[0].status, 'revoked');

    // Directory filter: searchQuery + emailVerified + sortBy=displayName
    const unverifiedRes = await srv.hit('GET', '/api/v1/admin/users?emailVerified=false&searchQuery=abraham', {
      cookie: admCookie,
    });
    assert.equal(unverifiedRes.status, 200);
    assert.equal(unverifiedRes.body.items.length, 1);
    assert.equal(unverifiedRes.body.items[0].uid, 'ath_57_2');

    const sortedRes = await srv.hit('GET', '/api/v1/admin/users?role=athlete&sortBy=displayName&sortOrder=asc', {
      cookie: admCookie,
    });
    assert.equal(sortedRes.status, 200);
    assert.equal(sortedRes.body.items.length, 2);
    assert.equal(sortedRes.body.items[0].uid, 'ath_57_2'); // Abraham before Zoe

    // Enriched getStats
    const statsRes = await srv.hit('GET', '/api/v1/admin/stats', { cookie: admCookie });
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.body.stats.totalUsers, 3);
    assert.equal(statsRes.body.stats.pendingInvitations, 1);
    assert.equal(statsRes.body.stats.pendingVerificationUsers, 1);
    assert.equal(statsRes.body.stats.recentSignups30d, 3);

    void admSession;
  } finally {
    await srv.close();
  }
});
