/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — Full 41-Route Parity, RBAC, Bound CSRF, Anti-IDOR & State Conflict Matrix Tests
 *
 * SCOPE CLASSIFICATION:
 * - [PASS-UNIT] Route table compilation, single source of truth parity, parameter sanitization.
 * - [PASS-MOCK / LOOPBACK HTTP] Exercises ALL 41 cataloged routes + CORS OPTIONS preflight against
 *   real `CleanSlateApiDispatcher` mounted in Express on `127.0.0.1:0` with in-memory NoSQL +
 *   mock Catalyst Auth runtime (`MockCatalystAuthRuntime`).
 * - Superadmin automated mutations remain blocked by default (`403`) until live Catalyst NoSQL
 *   integration (`PASS-INTEGRATION`) verifies conditional update atomicity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import {
  CLEAN_SLATE_ENDPOINT_CATALOG,
  CleanSlateApiDispatcher,
  ROUTE_DEFINITIONS,
  type ApiEndpointDefinition,
} from '../src/routes/apiRouterSchema.js';
import {
  OPTIONS_PREFLIGHT_CONTRACT,
  ROUTE_CONTRACT_SPECS,
} from '../src/routes/routeContracts.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CleanSlateAuthGuard,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { HttpSecurityPolicy } from '../src/security/httpSecurityPolicy.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';

const SLATE_ORIGIN = 'https://fit-x-bhnatsxl.onslate.com';

function createSuiteFixture(initialNowSec = 1_760_200_000, strictCsrfHeader = false) {
  let nowSec = initialNowSec;
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const sessionManager = new ServerSessionTokenManager({
    activeSecret: ServerSessionTokenManager.generateStrongSecret(),
    activeKeyId: 'k1',
    environment: 'test',
    nowSecProvider: () => nowSec,
  });
  const authGuard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);
  const httpPolicy = new HttpSecurityPolicy({
    allowedOrigins: [SLATE_ORIGIN],
    requireCsrfHeaderOnMutations: strictCsrfHeader,
    enforceSignedCsrfTokens: strictCsrfHeader,
  });
  const dispatcher = new CleanSlateApiDispatcher(authGuard, athleteService, adminService, httpPolicy);

  return {
    db,
    authRuntime,
    authGuard,
    athleteService,
    adminService,
    dispatcher,
    advanceTime: (sec: number) => {
      nowSec += sec;
    },
  };
}

function extractCookie(headers?: Record<string, string>): string {
  const raw = headers?.['Set-Cookie'] ?? '';
  const m = raw.match(new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`));
  assert.ok(m, `Expected __Host-vigor_session cookie, got '${raw}'`);
  return m[1];
}

test('[PASS-UNIT] Single source of truth: 53 unique routes, OPTIONS contract, strict param validation & 404 legacy flat routes', async () => {
  assert.equal(ROUTE_CONTRACT_SPECS.length, 53);
  assert.equal(ROUTE_DEFINITIONS.length, 53);
  assert.equal(CLEAN_SLATE_ENDPOINT_CATALOG.length, 53);
  assert.equal(OPTIONS_PREFLIGHT_CONTRACT.method, 'OPTIONS');

  const seen = new Set<string>();
  for (const def of ROUTE_DEFINITIONS) {
    const key = `${def.method} ${def.path}`;
    assert.ok(!seen.has(key), `Duplicate route detected: ${key}`);
    seen.add(key);
    assert.equal(typeof def.handler, 'function');
  }

  const { dispatcher, authRuntime } = createSuiteFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_p',
    user_id: 'cat_param_1',
    email_id: 'param@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': 'tok_1' },
  });
  const cookie = extractCookie(boot.headers);

  // Legacy flat admin routes MUST return 404 ROUTE_NOT_FOUND
  for (const flatPath of [
    '/api/v1/admin/invitations/revoke',
    '/api/v1/admin/users/set-status',
    '/api/v1/admin/users/set-role',
    '/api/v1/admin/users/password-reset',
  ]) {
    const res = await dispatcher.dispatch('POST', flatPath, {
      headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': 'tok_1' },
      cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
      body: {},
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'ROUTE_NOT_FOUND');
  }

  // Malicious/invalid path parameters MUST fail with 400 INVALID_PATH_PARAMETER
  for (const badPath of [
    '/api/v1/athlete/recipes/..',
    '/api/v1/athlete/recipes/bad%23id',
    '/api/v1/athlete/recipes/a..b',
    '/api/v1/athlete/recipes/%E0%A4%A',
    '/api/v1/admin/users/bad%23uid',
  ]) {
    const method = badPath.includes('/admin/') ? 'GET' : 'PUT';
    const res = await dispatcher.dispatch(method, badPath, {
      headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': 'tok_1' },
      cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
      body: {},
    });
    assert.equal(res.status, 400, `Expected 400 on malformed param path ${badPath}`);
    assert.equal(res.body.error, 'INVALID_PATH_PARAMETER');
  }
});

test('[PASS-MOCK / LOOPBACK] Full 41-route parity matrix: Auth, RBAC, Bound CSRF, Anti-IDOR, State Conflicts & Session 24h Ceiling', async () => {
  const { db, authRuntime, dispatcher, advanceTime } = createSuiteFixture(1_760_200_000, true);

  // Mount real Express loopback server
  const app = express();
  app.use(express.json({ limit: '600kb' }));
  app.use(async (req, res) => {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v[0] : v;
    }
    const cookies: Record<string, string> = {};
    if (headers.cookie) {
      for (const pair of headers.cookie.split(';')) {
        const i = pair.indexOf('=');
        if (i > 0) cookies[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
      }
    }
    const out = await dispatcher.dispatch(
      req.method.toUpperCase() as ApiEndpointDefinition['method'] | 'OPTIONS',
      req.path,
      {
        headers,
        cookies,
        query: req.query as Record<string, unknown>,
        body: req.body,
      }
    );
    if (out.headers) {
      for (const [hk, hv] of Object.entries(out.headers)) {
        res.setHeader(hk, hv);
      }
    }
    if (out.status === 204) {
      res.status(204).end();
      return;
    }
    res.status(out.status).json(out.body);
  });

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const hit = async (
    method: string,
    routePath: string,
    opts: {
      cookie?: string;
      body?: unknown;
      csrf?: string | null;
      origin?: string | null;
      extraHeaders?: Record<string, string>;
    } = {}
  ) => {
    const headers: Record<string, string> = {
      ...(opts.extraHeaders ?? {}),
    };
    if (opts.origin !== null) {
      headers.Origin = opts.origin ?? SLATE_ORIGIN;
      headers['Sec-Fetch-Site'] = 'same-site';
    }
    if (opts.csrf !== null && method !== 'GET' && method !== 'OPTIONS') {
      headers['X-Vigor-CSRF'] = opts.csrf ?? 'csrf_matrix_tok';
    }
    if (opts.cookie) {
      headers.Cookie = `${SIGNED_SESSION_COOKIE_NAME}=${encodeURIComponent(opts.cookie)}`;
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${routePath}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { status: res.status, headers: res.headers, body: json };
  };

  try {
    const exercisedRoutes = new Set<string>();
    const markRoute = (method: string, canonicalPath: string) => {
      exercisedRoutes.add(`${method} ${canonicalPath}`);
    };

    // 0. OPTIONS CORS preflight -> 204
    const preflight = await hit('OPTIONS', '/api/v1/athlete/meals');
    assert.equal(preflight.status, 204);

    // 1. Strict CSRF enforcement on mutating call missing X-Vigor-CSRF -> 403 CSRF_TOKEN_MISSING
    const missingCsrf = await hit('POST', '/api/v1/auth/session/bootstrap-profile', { csrf: null });
    assert.equal(missingCsrf.status, 403);
    assert.equal(missingCsrf.body.error, 'CSRF_TOKEN_MISSING');

    // 2. Unauthenticated check across ALL 53 cataloged routes -> 401 UNAUTHENTICATED
    for (const route of ROUTE_CONTRACT_SPECS) {
      const concrete = route.path
        .replace(':workoutId', 'wk_none')
        .replace(':recipeId', 'rec_none')
        .replace(':mealId', 'meal_none')
        .replace(':groceryId', 'gr_none')
        .replace(':cardioId', 'cardio_none')
        .replace(':notificationId', 'notif_none')
        .replace(':weekStart', '2026-11-10')
        .replace(':routineId', 'rt_none')
        .replace(':inviteId', 'inv_none')
        .replace(':uid', 'u_none');
      const r = await hit(route.method, concrete, {
        body: route.method === 'GET' ? undefined : {},
        extraHeaders:
          route.csrfPolicy === 'pre_session_catalyst_exchange'
            ? { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' }
            : undefined,
      });
      assert.equal(r.status, 401, `Expected 401 unauthenticated on ${route.method} ${route.path}`);
      assert.equal(r.body.error, 'UNAUTHENTICATED');
    }

    // 3. Bootstrap Athlete 1 -> POST /api/v1/auth/session/bootstrap-profile
    authRuntime.setCurrentUser({
      zuid: 'z_ath1',
      user_id: 'ath_m_1',
      email_id: 'ath1@vigorcore.test',
      first_name: 'Atleta',
      last_name: 'Uno',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const bootAth1 = await hit('POST', '/api/v1/auth/session/bootstrap-profile', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    assert.equal(bootAth1.status, 200);
    markRoute('POST', '/api/v1/auth/session/bootstrap-profile');
    const athCookie1 = (bootAth1.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const athCsrf1 = String(bootAth1.body.csrfToken);
    assert.ok(athCsrf1);
    assert.equal(bootAth1.headers.get('x-vigor-csrf-token'), athCsrf1);

    // 4. Exchange -> POST /api/v1/auth/session/exchange
    const exchAth1 = await hit('POST', '/api/v1/auth/session/exchange', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    assert.equal(exchAth1.status, 200);
    markRoute('POST', '/api/v1/auth/session/exchange');
    const athCookieExch = (exchAth1.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const athCsrfExch = String(exchAth1.body.csrfToken);
    assert.ok(athCsrfExch);

    // 5. Refresh -> POST /api/v1/auth/session/refresh + verify 24h absolute max lifetime enforcement
    advanceTime(10 * 3600); // +10h
    const refAth1 = await hit('POST', '/api/v1/auth/session/refresh', {
      cookie: athCookieExch,
      csrf: athCsrfExch,
      body: {},
    });
    assert.equal(refAth1.status, 200);
    markRoute('POST', '/api/v1/auth/session/refresh');
    const athCookieRotated = (refAth1.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const athCsrfRotated = String(refAth1.body.csrfToken);
    assert.notEqual(athCsrfRotated, athCsrfExch);

    // 6. Auth Me -> GET /api/v1/auth/me (returns bound csrfToken)
    const meRes = await hit('GET', '/api/v1/auth/me', { cookie: athCookieRotated });
    assert.equal(meRes.status, 200);
    assert.ok(meRes.body.csrfToken);
    markRoute('GET', '/api/v1/auth/me');

    // 7. Workspace -> GET /api/v1/athlete/workspace
    const wsRes = await hit('GET', '/api/v1/athlete/workspace?maxPages=2', { cookie: athCookieRotated });
    assert.equal(wsRes.status, 200);
    markRoute('GET', '/api/v1/athlete/workspace');

    // 8. Profile Patch + Immutable Field Check -> PATCH /api/v1/athlete/profile
    const badPatch = await hit('PATCH', '/api/v1/athlete/profile', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { role: 'superadmin' },
    });
    assert.equal(badPatch.status, 403);
    assert.equal(badPatch.body.error, 'IDENTITY_SPOOFING_REJECTED');

    const okPatch = await hit('PATCH', '/api/v1/athlete/profile', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { displayName: 'Atleta Matrix', location: 'Bogotá' },
    });
    assert.equal(okPatch.status, 200);
    markRoute('PATCH', '/api/v1/athlete/profile');

    // 9. Onboarding Complete -> POST /api/v1/athlete/onboarding/complete
    const badOnb = await hit('POST', '/api/v1/athlete/onboarding/complete', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { displayName: 'X', goal: 'hipertrofia', biometrics: { weightKg: 5 }, preferences: {} },
    });
    assert.equal(badOnb.status, 400);

    const okOnb = await hit('POST', '/api/v1/athlete/onboarding/complete', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        displayName: 'Atleta Matrix',
        goal: 'hipertrofia',
        biometrics: {
          weightKg: 76,
          heightCm: 175,
          age: 26,
          bodyFatPct: 13,
          palFactor: 1.55,
          bmr: 1720,
          tdee: 2666,
          targetCalories: 2900,
          targetProteinG: 155,
          targetFatG: 70,
          targetCarbsG: 412,
        },
        preferences: { weightUnit: 'kg', heightUnit: 'cm', mealsPerDay: 4 },
      },
    });
    assert.equal(okOnb.status, 200);
    markRoute('POST', '/api/v1/athlete/onboarding/complete');

    // 9b. Biometrics PUT + Preferences PUT
    const okBio = await hit('PUT', '/api/v1/athlete/biometrics', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        weightKg: 77,
        heightCm: 175,
        age: 26,
        bodyFatPct: 12.8,
        palFactor: 1.55,
        bmr: 1730,
        tdee: 2682,
        targetCalories: 2920,
        targetProteinG: 156,
        targetFatG: 70,
        targetCarbsG: 416,
      },
    });
    assert.equal(okBio.status, 200);
    markRoute('PUT', '/api/v1/athlete/biometrics');

    const okPref = await hit('PUT', '/api/v1/athlete/preferences', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { weightUnit: 'kg', heightUnit: 'cm', mealsPerDay: 4 },
    });
    assert.equal(okPref.status, 200);
    markRoute('PUT', '/api/v1/athlete/preferences');

    // 10. Meals Create -> POST /api/v1/athlete/meals
    const badMeal = await hit('POST', '/api/v1/athlete/meals', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { dateTime: 'bad', name: 'M', kcal: 100, protein: 10, carbs: 10, fat: 2 },
    });
    assert.equal(badMeal.status, 400);

    const okMeal = await hit('POST', '/api/v1/athlete/meals', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        id: 'meal_m_1',
        dateTime: '2026-11-15T08:00',
        moment: 'desayuno',
        name: 'Avena Proteica',
        kcal: 450,
        protein: 32,
        carbs: 55,
        fat: 10,
      },
    });
    assert.equal(okMeal.status, 201);
    markRoute('POST', '/api/v1/athlete/meals');

    // 11. Meals List + Delete -> GET & DELETE /api/v1/athlete/meals/:mealId
    const badMealsQuery = await hit('GET', '/api/v1/athlete/meals?startDate=2026-11-20&endDate=2026-11-10', {
      cookie: athCookieRotated,
    });
    assert.equal(badMealsQuery.status, 400);

    const okMealsList = await hit('GET', '/api/v1/athlete/meals?startDate=2026-11-01&endDate=2026-11-30&limit=20', {
      cookie: athCookieRotated,
    });
    assert.equal(okMealsList.status, 200);
    assert.equal((okMealsList.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/meals');

    const okDelMeal = await hit('DELETE', '/api/v1/athlete/meals/meal_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelMeal.status, 200);
    assert.equal(okDelMeal.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/meals/:mealId');

    // 12. Groceries Sync + Create + PatchStatus + Delete
    const tooManyGroceries = Array.from({ length: 26 }, (_, i) => ({
      id: `g_${i}`,
      name: `Item ${i}`,
      quantity: 1,
    }));
    const overBatch = await hit('PUT', '/api/v1/athlete/groceries/sync', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { items: tooManyGroceries, replaceExisting: true },
    });
    assert.equal(overBatch.status, 400);
    assert.equal(overBatch.body.error, 'BATCH_LIMIT_EXCEEDED');

    const okBatch = await hit('PUT', '/api/v1/athlete/groceries/sync', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        items: [{ id: 'g_1', name: 'Pechuga de Pollo', quantity: 500, status: 'pending' }],
        replaceExisting: true,
        batchIndex: 0,
        totalBatches: 1,
      },
    });
    assert.equal(okBatch.status, 200);
    markRoute('PUT', '/api/v1/athlete/groceries/sync');

    const okManualGrocery = await hit('POST', '/api/v1/athlete/groceries', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { id: 'g_man_1', name: 'Sal Marina', quantity: 1, unit: 'kg', department: 'grasas' },
    });
    assert.equal(okManualGrocery.status, 201);
    markRoute('POST', '/api/v1/athlete/groceries');

    const okPatchGrocery = await hit('PATCH', '/api/v1/athlete/groceries/g_man_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {},
    });
    assert.equal(okPatchGrocery.status, 200);
    assert.equal((okPatchGrocery.body.grocery as { status: string }).status, 'bought');
    markRoute('PATCH', '/api/v1/athlete/groceries/:groceryId');

    const okDelGrocery = await hit('DELETE', '/api/v1/athlete/groceries/g_man_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelGrocery.status, 200);
    assert.equal(okDelGrocery.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/groceries/:groceryId');

    const okListGroceries = await hit('GET', '/api/v1/athlete/groceries', {
      cookie: athCookieRotated,
    });
    assert.equal(okListGroceries.status, 200);
    markRoute('GET', '/api/v1/athlete/groceries');

    const okClearGroceries = await hit('DELETE', '/api/v1/athlete/groceries/completed', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okClearGroceries.status, 200);
    markRoute('DELETE', '/api/v1/athlete/groceries/completed');

    // 13-15. Workouts lifecycle: start -> sets -> complete -> terminal lock + mismatch checks
    const startWk = await hit('POST', '/api/v1/athlete/workouts/start', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        id: 'wk_m_1',
        startedAt: '2026-11-15T10:00:00.000Z',
        routineName: 'Push Pull Legs',
        routineDayName: 'Push A',
        exercisesSnapshot: [],
      },
    });
    assert.equal(startWk.status, 201);
    markRoute('POST', '/api/v1/athlete/workouts/start');

    // Duplicate workout ID -> 409 WORKOUT_ALREADY_EXISTS
    const dupWk = await hit('POST', '/api/v1/athlete/workouts/start', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        id: 'wk_m_1',
        startedAt: '2026-11-15T10:00:00.000Z',
        routineName: 'Push Pull Legs',
        routineDayName: 'Push A',
        exercisesSnapshot: [],
      },
    });
    assert.equal(dupWk.status, 409);
    assert.equal(dupWk.body.error, 'WORKOUT_ALREADY_EXISTS');

    // Mismatched body.executedWorkoutId vs :workoutId -> 400 WORKOUT_ID_MISMATCH
    const mismatchSet = await hit('POST', '/api/v1/athlete/workouts/wk_m_1/sets', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        executedWorkoutId: 'wk_other',
        exerciseId: 'ex1',
        exerciseName: 'Bench',
        weightKg: 80,
        reps: 8,
        rir: 2,
      },
    });
    assert.equal(mismatchSet.status, 400);
    assert.equal(mismatchSet.body.error, 'WORKOUT_ID_MISMATCH');

    const okSet = await hit('POST', '/api/v1/athlete/workouts/wk_m_1/sets', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {
        id: 'set_m_1',
        exerciseId: 'ex1',
        exerciseName: 'Press Banca',
        weightKg: 80,
        reps: 8,
        rir: 2,
      },
    });
    assert.equal(okSet.status, 201);
    markRoute('POST', '/api/v1/athlete/workouts/:workoutId/sets');

    const okComplete = await hit('POST', '/api/v1/athlete/workouts/wk_m_1/complete', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { finalStatus: 'completed', durationSeconds: 2400, sessionRpe: 8 },
    });
    assert.equal(okComplete.status, 200);
    markRoute('POST', '/api/v1/athlete/workouts/:workoutId/complete');

    const okListWorkouts = await hit('GET', '/api/v1/athlete/workouts?status=completed', {
      cookie: athCookieRotated,
    });
    assert.equal(okListWorkouts.status, 200);
    assert.equal((okListWorkouts.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/workouts');

    const okWorkoutDetail = await hit('GET', '/api/v1/athlete/workouts/wk_m_1', {
      cookie: athCookieRotated,
    });
    assert.equal(okWorkoutDetail.status, 200);
    assert.equal((okWorkoutDetail.body.sets as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/workouts/:workoutId');

    // Replay complete -> 409 WORKOUT_TERMINAL_IMMUTABLE
    const replayComplete = await hit('POST', '/api/v1/athlete/workouts/wk_m_1/complete', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { finalStatus: 'abandoned', durationSeconds: 2400 },
    });
    assert.equal(replayComplete.status, 409);
    assert.equal(replayComplete.body.error, 'WORKOUT_TERMINAL_IMMUTABLE');

    // 16. Cardio -> POST + DELETE /api/v1/athlete/cardio/:cardioId
    const okCardio = await hit('POST', '/api/v1/athlete/cardio', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { id: 'cardio_m_1', date: '2026-11-15', title: 'Run Zona 2', durationMinutes: 35, avgHeartRate: 142 },
    });
    assert.equal(okCardio.status, 201);
    markRoute('POST', '/api/v1/athlete/cardio');

    const okCardioList = await hit('GET', '/api/v1/athlete/cardio', {
      cookie: athCookieRotated,
    });
    assert.equal(okCardioList.status, 200);
    assert.equal((okCardioList.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/cardio');

    const okDelCardio = await hit('DELETE', '/api/v1/athlete/cardio/cardio_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelCardio.status, 200);
    assert.equal(okDelCardio.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/cardio/:cardioId');

    // 17. Notifications -> POST + GET + PATCH read + POST read-all + DELETE
    const okNotif = await hit('POST', '/api/v1/athlete/notifications', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { id: 'notif_m_1', title: 'Aviso', message: 'Sesión guardada', category: 'entrenamiento' },
    });
    assert.equal(okNotif.status, 201);
    markRoute('POST', '/api/v1/athlete/notifications');

    const okListNotif = await hit('GET', '/api/v1/athlete/notifications?unreadOnly=true', {
      cookie: athCookieRotated,
    });
    assert.equal(okListNotif.status, 200);
    assert.equal((okListNotif.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/notifications');

    const okMarkRead = await hit('PATCH', '/api/v1/athlete/notifications/notif_m_1/read', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { read: true },
    });
    assert.equal(okMarkRead.status, 200);
    markRoute('PATCH', '/api/v1/athlete/notifications/:notificationId/read');

    const okReadAll = await hit('POST', '/api/v1/athlete/notifications/read-all', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {},
    });
    assert.equal(okReadAll.status, 200);
    markRoute('POST', '/api/v1/athlete/notifications/read-all');

    const okDelNotif = await hit('DELETE', '/api/v1/athlete/notifications/notif_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelNotif.status, 200);
    assert.equal(okDelNotif.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/notifications/:notificationId');

    // 18. Recipes PUT + GET + DELETE
    const mismatchRecipe = await hit('PUT', '/api/v1/athlete/recipes/rec_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { id: 'rec_other', name: 'Receta', ingredients: [] },
    });
    assert.equal(mismatchRecipe.status, 400);
    assert.equal(mismatchRecipe.body.error, 'RESOURCE_ID_MISMATCH');

    const oversizedRecipe = await hit('PUT', '/api/v1/athlete/recipes/rec_big', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { id: 'rec_big', name: 'Big', ingredients: ['x'.repeat(360 * 1024)] },
    });
    assert.equal(oversizedRecipe.status, 413);

    const okRecipe = await hit('PUT', '/api/v1/athlete/recipes/rec_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { name: 'Batido Verde', ingredients: [{ foodId: 'f1', grams: 100 }] },
    });
    assert.equal(okRecipe.status, 200);
    markRoute('PUT', '/api/v1/athlete/recipes/:recipeId');

    const okListRecipes = await hit('GET', '/api/v1/athlete/recipes', {
      cookie: athCookieRotated,
    });
    assert.equal(okListRecipes.status, 200);
    assert.equal((okListRecipes.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/recipes');

    const okDelRecipe = await hit('DELETE', '/api/v1/athlete/recipes/rec_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelRecipe.status, 200);
    assert.equal(okDelRecipe.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/recipes/:recipeId');

    // 19. Meal Plans PUT + GET
    const okPlan = await hit('PUT', '/api/v1/athlete/meal-plans/2026-11-09', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { days: {}, label: 'Semana 46' },
    });
    assert.equal(okPlan.status, 200);
    markRoute('PUT', '/api/v1/athlete/meal-plans/:weekStart');

    const okListPlans = await hit('GET', '/api/v1/athlete/meal-plans', {
      cookie: athCookieRotated,
    });
    assert.equal(okListPlans.status, 200);
    assert.equal((okListPlans.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/meal-plans');

    // 20. Routines PUT + GET + POST default + DELETE
    const okRoutine = await hit('PUT', '/api/v1/athlete/routines/rt_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { name: 'Torso / Pierna 4d', days: [] },
    });
    assert.equal(okRoutine.status, 200);
    markRoute('PUT', '/api/v1/athlete/routines/:routineId');

    const okListRoutines = await hit('GET', '/api/v1/athlete/routines', {
      cookie: athCookieRotated,
    });
    assert.equal(okListRoutines.status, 200);
    assert.equal((okListRoutines.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/athlete/routines');

    const okDefaultRoutine = await hit('POST', '/api/v1/athlete/routines/rt_m_1/default', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: {},
    });
    assert.equal(okDefaultRoutine.status, 200);
    markRoute('POST', '/api/v1/athlete/routines/:routineId/default');

    const okDelRoutine = await hit('DELETE', '/api/v1/athlete/routines/rt_m_1', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
    });
    assert.equal(okDelRoutine.status, 200);
    assert.equal(okDelRoutine.body.deleted, true);
    markRoute('DELETE', '/api/v1/athlete/routines/:routineId');

    // Verify Athlete RBAC rejection across ALL 10 Admin/Superadmin routes -> 403 PERMISSION_DENIED
    const adminRoutesForAthlete: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/v1/admin/users' },
      { method: 'GET', path: '/api/v1/admin/stats' },
      { method: 'GET', path: '/api/v1/admin/users/ath_m_1' },
      { method: 'GET', path: '/api/v1/admin/invitations' },
      { method: 'POST', path: '/api/v1/admin/invitations', body: { targetEmail: 'x@y.z', targetRole: 'athlete' } },
      { method: 'POST', path: '/api/v1/admin/invitations/inv_1/revoke', body: {} },
      { method: 'POST', path: '/api/v1/admin/users/ath_m_1/status', body: { newStatus: 'suspended' } },
      { method: 'POST', path: '/api/v1/admin/users/ath_m_1/role', body: { newRole: 'admin' } },
      { method: 'POST', path: '/api/v1/admin/users/ath_m_1/password-reset', body: {} },
      { method: 'GET', path: '/api/v1/admin/audit-logs' },
    ];
    for (const ar of adminRoutesForAthlete) {
      const denied = await hit(ar.method, ar.path, {
        cookie: athCookieRotated,
        csrf: athCsrfRotated,
        body: ar.body,
      });
      assert.equal(denied.status, 403, `Expected 403 for athlete calling ${ar.method} ${ar.path}`);
      assert.equal(denied.body.error, 'PERMISSION_DENIED');
    }

    // 21. Auth Session Revoke -> POST /api/v1/auth/session/revoke (individual)
    const crossRevoke = await hit('POST', '/api/v1/auth/session/revoke', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { scope: 'all', targetUid: 'other_user' },
    });
    assert.equal(crossRevoke.status, 403);
    assert.equal(crossRevoke.body.error, 'INSUFFICIENT_PRIVILEGES');

    const revokeOwnFirst = await hit('POST', '/api/v1/auth/session/revoke', {
      cookie: athCookieRotated,
      csrf: athCsrfRotated,
      body: { scope: 'individual' },
    });
    assert.equal(revokeOwnFirst.status, 200);
    markRoute('POST', '/api/v1/auth/session/revoke');

    // Revoked session replay MUST return 401
    const replayRevoked = await hit('GET', '/api/v1/athlete/workspace', { cookie: athCookieRotated });
    assert.equal(replayRevoked.status, 401);

    // 22. Auth Session Logout -> POST /api/v1/auth/session/logout (using still-active athCookie1 + athCsrf1)
    const logoutRes = await hit('POST', '/api/v1/auth/session/logout', {
      cookie: athCookie1,
      csrf: athCsrf1,
      body: {},
    });
    assert.equal(logoutRes.status, 200);
    assert.ok((logoutRes.headers.get('set-cookie') ?? '').includes('Max-Age=0'));
    markRoute('POST', '/api/v1/auth/session/logout');

    // Enforce 24h absolute max lifetime across repeated refreshes (verified numerically via EpochSec)!
    const freshExch = await hit('POST', '/api/v1/auth/session/exchange', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    assert.equal(freshExch.status, 200);
    const freshInitialExp = Number(freshExch.body.expiresAtEpochSec);
    assert.ok(Number.isFinite(freshInitialExp) && freshInitialExp > 0);
    const freshAbsoluteCeiling = Number(freshExch.body.absoluteExpiresAtEpochSec);
    assert.equal(freshAbsoluteCeiling, freshInitialExp + 12 * 3600);
    const freshCookie0 = (freshExch.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const freshCsrf0 = String(freshExch.body.csrfToken);

    // Role/accountStatus query parameters on non-admin routes MUST still fail with 403 IDENTITY_SPOOFING_REJECTED
    const spoofWorkspaceRole = await hit('GET', '/api/v1/athlete/workspace?role=admin', {
      cookie: freshCookie0,
    });
    assert.equal(spoofWorkspaceRole.status, 403);
    assert.equal(spoofWorkspaceRole.body.error, 'IDENTITY_SPOOFING_REJECTED');

    const spoofWorkspaceStatus = await hit('GET', '/api/v1/athlete/workspace?accountStatus=active', {
      cookie: freshCookie0,
    });
    assert.equal(spoofWorkspaceStatus.status, 403);
    assert.equal(spoofWorkspaceStatus.body.error, 'IDENTITY_SPOOFING_REJECTED');

    // +10h -> refresh #1 extends exp to +22h
    advanceTime(10 * 3600);
    const freshRef1Res = await hit('POST', '/api/v1/auth/session/refresh', {
      cookie: freshCookie0,
      csrf: freshCsrf0,
      body: {},
    });
    assert.equal(freshRef1Res.status, 200);
    const freshCookie1 = (freshRef1Res.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const freshCsrf1 = String(freshRef1Res.body.csrfToken);

    // +10h (total +20h) -> refresh #2 MUST clamp expiresAtEpochSec to initial + 24h ceiling (not +32h)
    advanceTime(10 * 3600);
    const freshRef2Res = await hit('POST', '/api/v1/auth/session/refresh', {
      cookie: freshCookie1,
      csrf: freshCsrf1,
      body: {},
    });
    assert.equal(freshRef2Res.status, 200);
    assert.equal(Number(freshRef2Res.body.expiresAtEpochSec), freshAbsoluteCeiling);
    const freshCookie2 = (freshRef2Res.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const freshCsrf2 = String(freshRef2Res.body.csrfToken);

    // +4h + 1s (past 24h absolute ceiling) -> refresh #3 MUST fail 401
    advanceTime(4 * 3600 + 1);
    const expired24h = await hit('POST', '/api/v1/auth/session/refresh', {
      cookie: freshCookie2,
      csrf: freshCsrf2,
      body: {},
    });
    assert.equal(expired24h.status, 401);
    assert.ok(
      ['INVALID_SIGNED_SESSION', 'SESSION_MAX_LIFETIME_REACHED'].includes(
        String(expired24h.body.error)
      )
    );

    // ==================== ADMIN & SUPERADMIN MATRIX ====================
    authRuntime.setCurrentUser({
      zuid: 'z_adm_m',
      user_id: 'adm_m_1',
      email_id: 'admin@vigorcore.test',
      first_name: 'Admin',
      last_name: 'Matrix',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    await hit('POST', '/api/v1/auth/session/bootstrap-profile', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    await db.updateItem('Users', { pk: 'USER#adm_m_1' }, { role: 'admin', roleVersion: 2 });
    const exchAdm = await hit('POST', '/api/v1/auth/session/exchange', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    const admCookie = (exchAdm.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const admCsrf = String(exchAdm.body.csrfToken);

    // 23. GET /api/v1/admin/users (with filters)
    const listUsers = await hit('GET', '/api/v1/admin/users?role=athlete&accountStatus=active&limit=10', {
      cookie: admCookie,
    });
    assert.equal(listUsers.status, 200);
    assert.equal((listUsers.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/admin/users');

    // 24. GET /api/v1/admin/stats
    const statsRes = await hit('GET', '/api/v1/admin/stats', { cookie: admCookie });
    assert.equal(statsRes.status, 200);
    markRoute('GET', '/api/v1/admin/stats');

    // 25. GET /api/v1/admin/users/:uid
    const detailRes = await hit('GET', '/api/v1/admin/users/ath_m_1', { cookie: admCookie });
    assert.equal(detailRes.status, 200);
    markRoute('GET', '/api/v1/admin/users/:uid');

    // 26. POST /api/v1/admin/invitations (admin cannot invite admin; can invite athlete)
    const escInvite = await hit('POST', '/api/v1/admin/invitations', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { targetEmail: 'newadmin@vigorcore.test', targetRole: 'admin' },
    });
    assert.equal(escInvite.status, 403);
    assert.equal(escInvite.body.error, 'PRIVILEGE_ESCALATION_BLOCKED');

    const okInv1 = await hit('POST', '/api/v1/admin/invitations', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { targetEmail: 'ath2@vigorcore.test', targetRole: 'athlete' },
    });
    assert.equal(okInv1.status, 201);
    markRoute('POST', '/api/v1/admin/invitations');

    // Create a 2nd invitation to revoke -> POST /api/v1/admin/invitations/:inviteId/revoke
    const okInv2 = await hit('POST', '/api/v1/admin/invitations', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { targetEmail: 'revoke@vigorcore.test', targetRole: 'athlete' },
    });
    const revMismatch = await hit('POST', `/api/v1/admin/invitations/${okInv2.body.inviteId}/revoke`, {
      cookie: admCookie,
      csrf: admCsrf,
      body: { inviteId: 'other_inv' },
    });
    assert.equal(revMismatch.status, 400);
    assert.equal(revMismatch.body.error, 'PARAM_BODY_MISMATCH');

    const okRevokeInv = await hit('POST', `/api/v1/admin/invitations/${okInv2.body.inviteId}/revoke`, {
      cookie: admCookie,
      csrf: admCsrf,
      body: { reason: 'Cancelada en matriz' },
    });
    assert.equal(okRevokeInv.status, 200);
    markRoute('POST', '/api/v1/admin/invitations/:inviteId/revoke');

    const okListInvites = await hit('GET', '/api/v1/admin/invitations', { cookie: admCookie });
    assert.equal(okListInvites.status, 200);
    assert.ok((okListInvites.body.items as unknown[]).length >= 2);
    markRoute('GET', '/api/v1/admin/invitations');

    // 27. POST /api/v1/invitations/redeem (second athlete redeems okInv1)
    authRuntime.setCurrentUser({
      zuid: 'z_ath2',
      user_id: 'ath_m_2',
      email_id: 'ath2@vigorcore.test',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const bootAth2 = await hit('POST', '/api/v1/auth/session/bootstrap-profile', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    const athCookie2 = (bootAth2.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const athCsrf2 = String(bootAth2.body.csrfToken);

    const badRedeem = await hit('POST', '/api/v1/invitations/redeem', {
      cookie: athCookie2,
      csrf: athCsrf2,
      body: { inviteId: okInv1.body.inviteId, token: 'wrong_token' },
    });
    assert.equal(badRedeem.status, 403);
    assert.equal(badRedeem.body.error, 'INVITATION_TOKEN_INVALID');

    const okRedeem = await hit('POST', '/api/v1/invitations/redeem', {
      cookie: athCookie2,
      csrf: athCsrf2,
      body: { inviteId: okInv1.body.inviteId, token: okInv1.body.rawToken },
    });
    assert.equal(okRedeem.status, 200);
    markRoute('POST', '/api/v1/invitations/redeem');

    // Replay redeemed invitation -> 409 INVITATION_UNAVAILABLE
    const replayRedeem = await hit('POST', '/api/v1/invitations/redeem', {
      cookie: athCookie2,
      csrf: athCsrf2,
      body: { inviteId: okInv1.body.inviteId, token: okInv1.body.rawToken },
    });
    assert.equal(replayRedeem.status, 409);

    // 28. POST /api/v1/admin/users/:uid/status (self-suspension blocked -> 403; suspend ath_m_2 -> 200)
    authRuntime.setCurrentUser({
      zuid: 'z_adm_m',
      user_id: 'adm_m_1',
      email_id: 'admin@vigorcore.test',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const selfSuspend = await hit('POST', '/api/v1/admin/users/adm_m_1/status', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { newStatus: 'suspended' },
    });
    assert.equal(selfSuspend.status, 403);
    assert.equal(selfSuspend.body.error, 'SELF_SUSPENSION_BLOCKED');

    const okStatus = await hit('POST', '/api/v1/admin/users/ath_m_2/status', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { newStatus: 'suspended', reason: 'Matriz QA' },
    });
    assert.equal(okStatus.status, 200);
    markRoute('POST', '/api/v1/admin/users/:uid/status');

    // Admin CANNOT call setRole -> 403 PERMISSION_DENIED
    const adminSetRole = await hit('POST', '/api/v1/admin/users/ath_m_1/role', {
      cookie: admCookie,
      csrf: admCsrf,
      body: { newRole: 'admin' },
    });
    assert.equal(adminSetRole.status, 403);
    assert.equal(adminSetRole.body.error, 'PERMISSION_DENIED');

    // 29. POST /api/v1/admin/users/:uid/password-reset
    const okReset = await hit('POST', '/api/v1/admin/users/ath_m_1/password-reset', {
      cookie: admCookie,
      csrf: admCsrf,
      body: {},
    });
    assert.equal(okReset.status, 200);
    assert.equal(okReset.body.emailSentTo, 'ath1@vigorcore.test');
    markRoute('POST', '/api/v1/admin/users/:uid/password-reset');

    // 30. GET /api/v1/admin/audit-logs (with targetUid + action filters)
    const okAudit = await hit('GET', '/api/v1/admin/audit-logs?targetUid=ath_m_1&action=password_reset_requested&limit=10', {
      cookie: admCookie,
    });
    assert.equal(okAudit.status, 200);
    assert.equal((okAudit.body.items as unknown[]).length, 1);
    markRoute('GET', '/api/v1/admin/audit-logs');

    // 31. Superadmin role mutation -> POST /api/v1/admin/users/:uid/role
    await db.updateItem('Users', { pk: 'USER#adm_m_1' }, { role: 'superadmin', roleVersion: 3 });
    const exchSuper = await hit('POST', '/api/v1/auth/session/exchange', {
      csrf: null,
      extraHeaders: { 'X-Vigor-Requested-With': 'VigorCore-CleanSlate' },
      body: {},
    });
    const superCookie = (exchSuper.headers.get('set-cookie') ?? '').match(
      new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`)
    )![1];
    const superCsrf = String(exchSuper.body.csrfToken);

    // Superadmin promotion to superadmin MUST stay blocked by default -> 403
    const blockedSuper = await hit('POST', '/api/v1/admin/users/ath_m_1/role', {
      cookie: superCookie,
      csrf: superCsrf,
      body: { newRole: 'superadmin' },
    });
    assert.equal(blockedSuper.status, 403);
    assert.equal(blockedSuper.body.error, 'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED');

    // Athlete -> Admin by superadmin succeeds -> 200
    const okSetRole = await hit('POST', '/api/v1/admin/users/ath_m_1/role', {
      cookie: superCookie,
      csrf: superCsrf,
      body: { newRole: 'admin', idempotencyKey: 'idem_role_1', reason: 'Matriz OK' },
    });
    assert.equal(okSetRole.status, 200);
    assert.equal((okSetRole.body.user as { role: string }).role, 'admin');
    markRoute('POST', '/api/v1/admin/users/:uid/role');

    // FINAL ASSERTION: ALL 53 cataloged routes were exercised with passing canonical verification!
    assert.equal(exercisedRoutes.size, 53, `Expected 53 exercised routes, got ${exercisedRoutes.size}`);
    for (const spec of ROUTE_CONTRACT_SPECS) {
      assert.ok(
        exercisedRoutes.has(`${spec.method} ${spec.path}`),
        `Route missing from full 53-route matrix run: ${spec.method} ${spec.path}`
      );
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
