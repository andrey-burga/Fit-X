/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.2 — HTTP Adapters, Contract Parity & Local Express Integration Tests
 *
 * TEST SUITES INCLUDED HERE:
 * - SUITE A (PASS-UNIT / FETCH-MOCK): Verifies ROUTE_DEFINITIONS / CLEAN_SLATE_ENDPOINT_CATALOG /
 *   CLEAN_SLATE_UI_ENDPOINT_MAP 30/30 canonical parity, CatalystHttpTransport fail-closed CSRF,
 *   explicit `origin: 'client_synthetic' | 'http_server'` distinction, idempotent retries + AbortSignal,
 *   CatalystHttpAthleteRepository partial non-atomic multi-batch failure & idempotent recovery,
 *   501 explicit unsupported endpoint behavior, and canonical parameterized admin routes.
 * - SUITE B (PASS-MOCK / LOCAL EXPRESS LOOPBACK HTTP): Starts an ephemeral local Express server on
 *   `127.0.0.1:0` wrapping the real `CleanSlateApiDispatcher` and executes end-to-end HTTP requests
 *   through `CatalystHttpAthleteRepository` and `CatalystHttpAdminRepository` across onboarding,
 *   meals CRUD/range, multi-batch grocery sync + recovery, workout start/set/complete + terminal lock,
 *   cardio, notifications, recipes, meal plans, routines, canonical admin routes, and 404 legacy rejection.
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
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CleanSlateAuthGuard,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import {
  assertStrictCookieAttributes,
  HttpSecurityPolicy,
} from '../src/security/httpSecurityPolicy.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';

import {
  CLEAN_SLATE_UI_ENDPOINT_MAP,
  type GroceryItemRecord,
} from '../src/frontend/contracts/cleanSlateModels.js';
import {
  CleanSlateRepositoryError,
  PartialBatchSyncError,
} from '../src/frontend/contracts/repositories.js';
import {
  CatalystHttpAdminRepository,
  CatalystHttpAthleteRepository,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  ServerCsrfTokenProvider,
  type ICsrfTokenProvider,
} from '../src/frontend/adapters/index.js';

const ALLOWED_SLATE_ORIGIN = 'https://fit-x-bhnatsxl.onslate.com';

// ==================== SUITE A: RECONCILIATION & FETCH-MOCK CONTRACT TESTS ====================

test('CONTRACT RECONCILIATION: Single-source ROUTE_CONTRACT_SPECS, ROUTE_DEFINITIONS, CLEAN_SLATE_ENDPOINT_CATALOG, and UI map have 41/41 canonical parity', () => {
  assert.equal(ROUTE_CONTRACT_SPECS.length, 41);
  assert.equal(ROUTE_DEFINITIONS.length, 41);
  assert.equal(CLEAN_SLATE_ENDPOINT_CATALOG.length, 41);
  assert.equal(CLEAN_SLATE_UI_ENDPOINT_MAP.length, 41);

  const catalogKeys = CLEAN_SLATE_ENDPOINT_CATALOG.map(e => `${e.method} ${e.path}`);
  const defKeys = ROUTE_DEFINITIONS.map(e => `${e.method} ${e.path}`);
  const uiKeys = CLEAN_SLATE_UI_ENDPOINT_MAP.map(e => `${e.method} ${e.path}`);
  assert.deepEqual(defKeys, catalogKeys);
  assert.deepEqual(uiKeys, catalogKeys);

  const byStatus = {
    wired_match: CLEAN_SLATE_UI_ENDPOINT_MAP.filter(e => e.dispatcherStatus === 'wired_match'),
    wired_path_mismatch: CLEAN_SLATE_UI_ENDPOINT_MAP.filter(
      e => e.dispatcherStatus === 'wired_path_mismatch'
    ),
    service_ready_not_wired_in_dispatcher: CLEAN_SLATE_UI_ENDPOINT_MAP.filter(
      e => e.dispatcherStatus === 'service_ready_not_wired_in_dispatcher'
    ),
  };

  assert.equal(byStatus.wired_match.length, 41);
  assert.equal(byStatus.wired_path_mismatch.length, 0);
  assert.equal(byStatus.service_ready_not_wired_in_dispatcher.length, 0);
});

test('HTTP TRANSPORT: Fail-closed CSRF on mutations, explicit baseUrl, /api/v1 scope, credentials:include, and 204/bad-JSON handling', async () => {
  // 1. Missing baseUrl MUST throw synchronously (client_synthetic)
  assert.throws(
    () =>
      new CatalystHttpTransport({
        baseUrl: '   ',
        fetchImpl: (async () => new Response()) as typeof fetch,
      }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'MISSING_BASE_URL' &&
      err.origin === 'client_synthetic' &&
      err.isSyntheticClientError === true
  );

  let fetchCalls = 0;
  const transportNoCsrf = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });

  // GET works without csrfProvider
  await transportNoCsrf.request({ method: 'GET', path: '/api/v1/auth/me' });
  assert.equal(fetchCalls, 1);

  // All mutating methods MUST fail closed with 403 CSRF_TOKEN_MISSING BEFORE fetchImpl
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    await assert.rejects(
      () => transportNoCsrf.request({ method, path: '/api/v1/athlete/meals', body: {} }),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.code === 'CSRF_TOKEN_MISSING' &&
        err.statusCode === 403 &&
        err.origin === 'client_synthetic' &&
        err.isSyntheticClientError === true
    );
  }
  assert.equal(fetchCalls, 1);

  // Empty or whitespace CSRF token MUST also fail closed before fetchImpl
  const blankCsrfTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    csrfProvider: { getCsrfToken: () => '   ' },
    fetchImpl: (async () => {
      fetchCalls++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  await assert.rejects(
    () => blankCsrfTransport.request({ method: 'POST', path: '/api/v1/athlete/meals', body: {} }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'CSRF_TOKEN_MISSING' &&
      err.origin === 'client_synthetic'
  );
  assert.equal(fetchCalls, 1);

  const captured: Array<{ url: string; init: RequestInit }> = [];
  const csrfProvider: ICsrfTokenProvider = {
    getCsrfToken: () => 'csrf_tok_abc123',
  };

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, init: init ?? {} });
    if (url.includes('/empty204')) {
      return new Response(null, { status: 204 });
    }
    if (url.includes('/badjson')) {
      return new Response('<html>502 Bad Gateway</html>', { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const transport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test/',
    fetchImpl: mockFetch,
    csrfProvider,
  });

  await assert.rejects(
    () => transport.request({ method: 'GET', path: '/other/endpoint' }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'INVALID_CONTRACT_PATH' &&
      err.origin === 'client_synthetic'
  );

  // GET MUST send credentials: 'include' and MUST NOT send X-Vigor-CSRF
  await transport.request({
    method: 'GET',
    path: '/api/v1/auth/me',
    query: { active: true, blank: '' },
  });
  assert.equal(captured[0].url, 'https://api.example.test/api/v1/auth/me?active=true');
  assert.equal(captured[0].init.credentials, 'include');
  assert.equal((captured[0].init.headers as Record<string, string>)['X-Vigor-CSRF'], undefined);

  // POST MUST inject X-Vigor-CSRF and Content-Type: application/json
  await transport.request({
    method: 'POST',
    path: '/api/v1/athlete/meals',
    body: { name: 'Avena' },
  });
  assert.equal((captured[1].init.headers as Record<string, string>)['X-Vigor-CSRF'], 'csrf_tok_abc123');
  assert.equal((captured[1].init.headers as Record<string, string>)['Content-Type'], 'application/json');

  // 204 empty response -> data: null without JSON parse error
  const emptyRes = await transport.request({ method: 'POST', path: '/api/v1/empty204' });
  assert.equal(emptyRes.status, 204);
  assert.equal(emptyRes.data, null);

  // Malformed 200 HTML -> 502 INVALID_JSON_RESPONSE marked client_synthetic with httpStatusReceived 200
  await assert.rejects(
    () => transport.request({ method: 'GET', path: '/api/v1/badjson' }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'INVALID_JSON_RESPONSE' &&
      err.statusCode === 502 &&
      err.origin === 'client_synthetic' &&
      err.httpStatusReceived === 200
  );

  // ServerCsrfTokenProvider + preSessionExchange lifecycle without client-side token generation
  const serverCsrfStore = new ServerCsrfTokenProvider();
  assert.equal(serverCsrfStore.hasToken(), false);
  const preSessionTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    csrfProvider: serverCsrfStore,
    fetchImpl: (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/session/exchange')) {
        assert.equal(
          (init?.headers as Record<string, string>)['X-Vigor-Requested-With'],
          'VigorCore-CleanSlate'
        );
        return new Response(
          JSON.stringify({
            success: true,
            actor: { catalystUserId: 'u_1' },
            sid: 'sid_1',
            csrfToken: 'srv_csrf_1',
            expiresAtEpochSec: 2000,
            absoluteExpiresAtEpochSec: 3000,
          }),
          { status: 200, headers: { 'X-Vigor-CSRF-Token': 'srv_csrf_1' } }
        );
      }
      if (url.endsWith('/api/v1/auth/session/logout')) {
        assert.equal((init?.headers as Record<string, string>)['X-Vigor-CSRF'], 'srv_csrf_1');
        return new Response(JSON.stringify({ success: true, loggedOut: true, revokedSid: 'sid_1' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch,
  });

  // preSessionExchange forbidden on arbitrary mutating endpoints before fetch
  await assert.rejects(
    () =>
      preSessionTransport.request({
        method: 'POST',
        path: '/api/v1/athlete/meals',
        preSessionExchange: true,
        body: {},
      }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'PRE_SESSION_EXCHANGE_NOT_ALLOWED' &&
      err.origin === 'client_synthetic'
  );

  const authRepo = new CatalystHttpAuthRepository(preSessionTransport, serverCsrfStore);
  const exch = await authRepo.exchangeSession();
  assert.equal(exch.csrfToken, 'srv_csrf_1');
  assert.equal(serverCsrfStore.getCsrfToken(), 'srv_csrf_1');
  await authRepo.logout();
  assert.equal(serverCsrfStore.hasToken(), false);
});

test('HTTP TRANSPORT ERRORS & RETRIES: Distinguishes http_server vs client_synthetic, retries ONLY idempotent safe requests, and honors AbortSignal', async () => {
  const statusCodes = [400, 401, 403, 404, 409, 413, 429, 500, 503];

  for (const status of statusCodes) {
    const transport = new CatalystHttpTransport({
      baseUrl: 'https://api.example.test',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: `ERR_${status}`,
            message: `Error controlado ${status}`,
          }),
          { status, headers: { 'content-type': 'application/json' } }
        )) as typeof fetch,
    });

    await assert.rejects(
      () => transport.request({ method: 'GET', path: '/api/v1/athlete/workspace' }),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.code === `ERR_${status}` &&
        err.statusCode === status &&
        err.origin === 'http_server' &&
        err.isSyntheticClientError === false &&
        err.httpStatusReceived === status &&
        err.message === `Error controlado ${status}`
    );
  }

  // Idempotent GET retries transient 503 -> succeeds on 3rd attempt
  let getAttempts = 0;
  const retryTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    retryDelayMs: 5,
    csrfProvider: { getCsrfToken: () => 'csrf_retry' },
    fetchImpl: (async (_url, init) => {
      getAttempts++;
      if (init?.method === 'GET' && getAttempts < 3) {
        return new Response(JSON.stringify({ error: 'TEMP_503' }), { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  const okAfterRetry = await retryTransport.request({ method: 'GET', path: '/api/v1/athlete/workspace' });
  assert.equal(okAfterRetry.status, 200);
  assert.equal(getAttempts, 3);

  // Non-idempotent POST WITHOUT idempotent:true MUST NOT retry on 503
  let postAttempts = 0;
  const postNoRetryTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    retryDelayMs: 5,
    csrfProvider: { getCsrfToken: () => 'csrf_retry' },
    fetchImpl: (async () => {
      postAttempts++;
      return new Response(JSON.stringify({ error: 'DOWN' }), { status: 503 });
    }) as typeof fetch,
  });
  await assert.rejects(
    () => postNoRetryTransport.request({ method: 'POST', path: '/api/v1/athlete/meals', body: { name: 'x' } }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError && err.origin === 'http_server' && err.statusCode === 503
  );
  assert.equal(postAttempts, 1);

  // Non-retryable 400 on GET MUST NOT retry even when maxRetries > 0
  let badReqAttempts = 0;
  const noRetryOn400 = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    retryDelayMs: 5,
    fetchImpl: (async () => {
      badReqAttempts++;
      return new Response(JSON.stringify({ error: 'BAD_PARAM' }), { status: 400 });
    }) as typeof fetch,
  });
  await assert.rejects(
    () => noRetryOn400.request({ method: 'GET', path: '/api/v1/athlete/meals' }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'BAD_PARAM'
  );
  assert.equal(badReqAttempts, 1);

  // Network exception -> client_synthetic
  const netTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch,
  });
  await assert.rejects(
    () => netTransport.request({ method: 'GET', path: '/api/v1/athlete/workspace' }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'NETWORK_ERROR' &&
      err.statusCode === 503 &&
      err.origin === 'client_synthetic'
  );

  // AbortSignal cancellation (before execution AND during backoff)
  const abortController = new AbortController();
  let abortedFetchCalls = 0;
  const abortTransport = new CatalystHttpTransport({
    baseUrl: 'https://api.example.test',
    maxRetries: 2,
    retryDelayMs: 100,
    fetchImpl: (async () => {
      abortedFetchCalls++;
      return new Response('{}', { status: 503 });
    }) as typeof fetch,
  });
  abortController.abort();
  await assert.rejects(
    () =>
      abortTransport.request({
        method: 'GET',
        path: '/api/v1/athlete/workspace',
        signal: abortController.signal,
      }),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'REQUEST_ABORTED' &&
      err.statusCode === 408 &&
      err.origin === 'client_synthetic'
  );
  assert.equal(abortedFetchCalls, 0);
});

test('ATHLETE HTTP REPO: Validators, <=25 grocery batch chunking, PartialBatchSyncError, queryMealsByDateRange, and all 11 newly wired operations', async () => {
  const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let failSecondGroceryBatch = false;

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const parsedBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method, url, body: parsedBody });

    if (url.endsWith('/api/v1/athlete/groceries/sync')) {
      if (failSecondGroceryBatch && parsedBody?.batchIndex === 1) {
        return new Response(
          JSON.stringify({ success: false, error: 'BATCH_TRANSIENT_FAILURE', message: 'Lote 2 caído' }),
          { status: 503 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          inserted: (parsedBody?.items as unknown[]).length,
          batchCalls: 1,
          replaceExisting: Boolean(parsedBody?.replaceExisting),
          atomicBatch: true,
        }),
        { status: 200 }
      );
    }
    if (url.includes('/api/v1/athlete/meals?')) {
      return new Response(
        JSON.stringify({
          success: true,
          items: [
            {
              entityId: 'm1',
              payload: {
                id: 'm1',
                dateTime: '2026-11-15T08:00',
                moment: 'desayuno',
                name: 'Huevos revueltos',
                description: 'Catálogo local',
                portion: '150 g',
                kcal: 240,
                protein: 18,
                carbs: 2,
                fat: 17,
                source: 'Manual',
              },
            },
          ],
          nextStartKey: 'cursor_2',
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/api/v1/athlete/profile')) {
      return new Response(
        JSON.stringify({
          success: true,
          profile: {
            uid: 'u1',
            email: 'a@test.co',
            normalizedEmail: 'a@test.co',
            displayName: 'Camilo Actualizado',
            role: 'athlete',
            roleVersion: 1,
            sessionEpoch: 1,
            accountStatus: 'active',
            emailVerified: true,
            authProvider: 'catalyst',
            directorySegment: 'USER_SEG#0',
            onboardingCompleted: true,
            onboardingStep: 6,
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-15T00:00:00Z',
            lastSignInAt: '2026-11-15T00:00:00Z',
          },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/api/v1/athlete/biometrics')) {
      return new Response(JSON.stringify({ success: true, biometrics: parsedBody }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/preferences')) {
      return new Response(JSON.stringify({ success: true, preferences: parsedBody }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/groceries') && method === 'POST') {
      return new Response(
        JSON.stringify({ success: true, grocery: { ...parsedBody, id: 'gr_man_1', origin: 'manual' } }),
        { status: 201 }
      );
    }
    if (url.endsWith('/api/v1/athlete/groceries/g1') && method === 'PATCH') {
      return new Response(
        JSON.stringify({
          success: true,
          grocery: { id: 'g1', name: 'Sal', quantity: 1, unit: 'kg', department: 'grasas', status: 'bought', origin: 'manual' },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/api/v1/athlete/routines/rt1/default')) {
      return new Response(JSON.stringify({ success: true, routines: [{ id: 'rt1', isDefault: true }] }), {
        status: 200,
      });
    }
    if (url.endsWith('/api/v1/athlete/notifications/n1/read')) {
      return new Response(
        JSON.stringify({
          success: true,
          notification: { id: 'n1', title: 'Aviso', message: 'Ok', category: 'sistema', severity: 'info', read: true, createdAt: '2026-11-15T00:00:00Z' },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/api/v1/athlete/notifications/read-all')) {
      return new Response(
        JSON.stringify({
          success: true,
          notifications: [{ id: 'n1', read: true }],
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ success: true, deleted: true }), { status: 200 });
  }) as typeof fetch;

  const repo = new CatalystHttpAthleteRepository({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchMock,
    csrfProvider: { getCsrfToken: () => 'csrf_athlete_1' },
  });

  // 1. Client-side immutable security field guard stops request BEFORE fetch
  await assert.rejects(
    () => repo.updateOwnProfile('u1', { role: 'superadmin' }),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'IMMUTABLE_SECURITY_FIELD'
  );
  assert.equal(requests.length, 0);

  // 2. Valid updateOwnProfile hits PATCH /api/v1/athlete/profile
  const prof = await repo.updateOwnProfile('u1', { displayName: 'Camilo Actualizado' });
  assert.equal(prof.displayName, 'Camilo Actualizado');

  // 3. Multi-batch sync (30 items -> 2 batches: 25 + 5), non-atomic disclosure
  const items30: GroceryItemRecord[] = Array.from({ length: 30 }, (_, idx) => ({
    id: `g_${idx + 1}`,
    name: `Alimento ${idx + 1}`,
    quantity: 100,
    unit: 'g',
    department: 'verduras',
    status: 'pending',
    origin: 'plan',
  }));
  const syncRes = await repo.syncGroceries('u1', items30);
  assert.equal(syncRes.batchCalls, 2);
  assert.equal(syncRes.atomic, false);

  // 3b. Partial batch failure throws PartialBatchSyncError with remainingItems (atomic: false)
  failSecondGroceryBatch = true;
  await assert.rejects(
    () => repo.syncGroceries('u1', items30),
    (err: unknown) =>
      err instanceof PartialBatchSyncError &&
      err.code === 'PARTIAL_BATCH_SYNC_FAILED' &&
      err.atomic === false &&
      err.completedBatches === 1 &&
      err.totalBatches === 2 &&
      err.failedBatchIndex === 1 &&
      err.persistedCount === 25 &&
      err.remainingItems.length === 5 &&
      err.origin === 'http_server'
  );
  failSecondGroceryBatch = false;

  // 4. queryMealsByDateRange unwraps UserData item envelope
  const mealsPage = await repo.queryMealsByDateRange('2026-11-01', '2026-11-30', { limit: 20 });
  assert.equal(mealsPage.items.length, 1);
  assert.equal(mealsPage.items[0].name, 'Huevos revueltos');
  assert.equal(mealsPage.nextStartKey, 'cursor_2');

  // 5. All 11 newly reconciled UI methods hit canonical HTTP endpoints cleanly + sanitize IDs client-side
  await assert.rejects(
    () => repo.deleteMeal('u1', 'bad#id'),
    (err: unknown) => err instanceof CleanSlateRepositoryError && err.code === 'INVALID_PATH_PARAMETER'
  );

  const bioSaved = await repo.saveBiometrics('u1', {
    weightKg: 75,
    heightCm: 175,
    bodyFatPct: 14,
    age: 28,
    palFactor: 1.55,
    targetDeltaKcal: 200,
    proteinPerKg: 2,
    fatPerKg: 0.9,
    bmr: 1700,
    tdee: 2635,
    targetCalories: 2835,
    targetProteinG: 150,
    targetFatG: 68,
    targetCarbsG: 406,
  });
  assert.equal(bioSaved.weightKg, 75);

  const prefSaved = await repo.savePreferences('u1', {
    weightUnit: 'kg',
    heightUnit: 'cm',
    timezone: 'UTC',
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    trainingExperience: 'intermedio',
    availableEquipment: ['barra'],
    trainingGoal: 'hipertrofia',
    muscleFocus: ['pecho'],
    mealsPerDay: 4,
    dietaryPreference: 'omnivoro',
    onboardingStep: 6,
    onboardingCompleted: true,
    notificationPreferences: {
      mealReminders: true,
      workoutAlerts: true,
      groceryAlerts: true,
      systemUpdates: true,
    },
  });
  assert.equal(prefSaved.mealsPerDay, 4);

  await repo.deleteMeal('u1', 'm1');
  await repo.deleteRecipe('u1', 'r1');
  const createdG = await repo.addManualGrocery('u1', {
    name: 'Sal',
    quantity: 1,
    unit: 'kg',
    department: 'grasas',
    status: 'pending',
    origin: 'manual',
  });
  assert.equal(createdG.id, 'gr_man_1');
  const toggledG = await repo.toggleGroceryStatus('u1', 'g1');
  assert.equal(toggledG.status, 'bought');
  await repo.deleteGrocery('u1', 'g1');
  const routines = await repo.setDefaultRoutine('u1', 'rt1');
  assert.equal(routines[0].isDefault, true);
  await repo.deleteCardioSession('u1', 'c1');
  const nRead = await repo.markNotificationRead('u1', 'n1', true);
  assert.equal(nRead.read, true);
  const allRead = await repo.markAllNotificationsRead('u1');
  assert.equal(allRead[0].read, true);
});

test('ADMIN HTTP REPO: Targets exclusively canonical parameterized paths and requires CSRF on mutations', async () => {
  const urlsHit: string[] = [];
  const fetchMock = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urlsHit.push(url);
    return new Response(
      JSON.stringify({
        success: true,
        users: [],
        stats: { totalUsers: 2, activeUsers: 2, suspendedUsers: 0, superadmins: 1, admins: 1 },
        user: { uid: 'u_target', email: 't@v.co', accountStatus: 'suspended' },
        recentLogs: [],
        logs: [],
        assignedRole: 'athlete',
        roleVersion: 2,
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const canonicalAdmin = new CatalystHttpAdminRepository({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchMock,
    csrfProvider: { getCsrfToken: () => 'csrf_admin_test' },
  });

  await canonicalAdmin.revokeInvitation('admin_1', 'inv_123', 'No usado');
  await canonicalAdmin.setUserStatus('admin_1', 'usr_99', 'suspended', 'Abuso');
  await canonicalAdmin.setUserRole('admin_1', 'usr_99', 'admin', 'Ascenso');
  await canonicalAdmin.requestPasswordReset('admin_1', 'usr_99');

  assert.equal(urlsHit[0], 'https://api.example.test/api/v1/admin/invitations/inv_123/revoke');
  assert.equal(urlsHit[1], 'https://api.example.test/api/v1/admin/users/usr_99/status');
  assert.equal(urlsHit[2], 'https://api.example.test/api/v1/admin/users/usr_99/role');
  assert.equal(urlsHit[3], 'https://api.example.test/api/v1/admin/users/usr_99/password-reset');

  await assert.rejects(
    () => canonicalAdmin.listInvitations('admin_1'),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError &&
      err.code === 'UNSUPPORTED_CONTRACT_ENDPOINT' &&
      err.statusCode === 501 &&
      err.origin === 'client_synthetic'
  );
});

// ==================== SUITE B: REAL LOCAL EXPRESS + CleanSlateApiDispatcher LOOPBACK HTTP ====================

function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!rawCookieHeader) return cookies;
  for (const part of rawCookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) cookies[k] = decodeURIComponent(v);
  }
  return cookies;
}

test('LOCAL EXPRESS LOOPBACK HTTP: Full Athlete & Admin repositories + ServerCsrfTokenProvider end-to-end against real CleanSlateApiDispatcher (41-route parity)', async () => {
  const nowSec = 1_760_100_000;
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const sessionManager = new ServerSessionTokenManager({
    activeSecret: ServerSessionTokenManager.generateStrongSecret(),
    activeKeyId: 'k1',
    environment: 'test',
    nowSecProvider: () => nowSec,
  });
  const guard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);
  const httpPolicy = new HttpSecurityPolicy({
    allowedOrigins: [ALLOWED_SLATE_ORIGIN],
    enforceSignedCsrfTokens: true,
  });
  const dispatcher = new CleanSlateApiDispatcher(guard, athleteService, adminService, httpPolicy);

  let failNextGrocerySyncSecondBatch = false;

  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.use(async (req, res) => {
    if (
      failNextGrocerySyncSecondBatch &&
      req.method === 'PUT' &&
      req.path === '/api/v1/athlete/groceries/sync' &&
      req.body?.batchIndex === 1
    ) {
      failNextGrocerySyncSecondBatch = false;
      res.status(503).json({
        success: false,
        error: 'INJECTED_BATCH_2_TIMEOUT',
        message: 'Fallo inyectado en lote 2 para probar recuperación parcial',
      });
      return;
    }

    const flatHeaders: Record<string, string | undefined> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      flatHeaders[key] = Array.isArray(val) ? val[0] : val;
    }
    const endpointRes = await dispatcher.dispatch(
      req.method.toUpperCase() as ApiEndpointDefinition['method'] | 'OPTIONS',
      req.path,
      {
        headers: flatHeaders,
        cookies: parseCookieHeader(flatHeaders.cookie),
        query: req.query as Record<string, unknown>,
        body: req.body,
      }
    );

    if (endpointRes.headers) {
      for (const [hk, hv] of Object.entries(endpointRes.headers)) {
        res.setHeader(hk, hv);
      }
    }
    if (endpointRes.status === 204) {
      res.status(204).end();
      return;
    }
    res.status(endpointRes.status).json(endpointRes.body);
  });

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    let activeCookie: string | null = null;
    const sessionFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', ALLOWED_SLATE_ORIGIN);
      headers.set('Sec-Fetch-Site', 'same-site');
      if (activeCookie) {
        headers.set('Cookie', `${SIGNED_SESSION_COOKIE_NAME}=${encodeURIComponent(activeCookie)}`);
      }
      const res = await fetch(input, { ...init, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        if (setCookie.includes('Max-Age=0')) {
          activeCookie = null;
        } else {
          const m = setCookie.match(new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`));
          if (m) activeCookie = decodeURIComponent(m[1]);
        }
      }
      return res;
    };

    // 1. Real CORS Preflight check over HTTP
    const preflightRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_SLATE_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(preflightRes.status, 204);
    assert.equal(preflightRes.headers.get('access-control-allow-origin'), ALLOWED_SLATE_ORIGIN);

    const csrfStore = new ServerCsrfTokenProvider();
    const transport = new CatalystHttpTransport({
      baseUrl,
      fetchImpl: sessionFetch,
      csrfProvider: csrfStore,
    });
    const authRepoHttp = new CatalystHttpAuthRepository(transport, csrfStore);
    const athleteRepo = new CatalystHttpAthleteRepository(transport);
    const adminRepoHttp = new CatalystHttpAdminRepository(transport);

    // 2. Unauthenticated -> 401 UNAUTHENTICATED (http_server)
    await assert.rejects(
      () => athleteRepo.hydrateWorkspace('cat_ath_loop_1'),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.statusCode === 401 &&
        err.code === 'UNAUTHENTICATED' &&
        err.origin === 'http_server'
    );

    // 3. Bootstrap athlete -> receives __Host-vigor_session cookie AND server-issued bound csrfToken
    authRuntime.setCurrentUser({
      zuid: 'z_ath_loop',
      user_id: 'cat_ath_loop_1',
      email_id: 'atleta.loop@vigorcore.test',
      first_name: 'Camilo',
      last_name: 'Loopback',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    const bootOut = await authRepoHttp.bootstrapProfile('Camilo Loopback');
    assert.ok(bootOut.sid);
    assert.ok(bootOut.csrfToken);
    assert.equal(csrfStore.getCsrfToken(), bootOut.csrfToken);

    // Cookie-only request (clearing Catalyst current user to prove cookie-only HMAC session works!)
    authRuntime.setCurrentUser(null);

    // Hydrate CSRF after simulated page reload via GET /auth/me
    csrfStore.clear();
    const meHydrated = await authRepoHttp.getMe();
    assert.ok(meHydrated.csrfToken);
    assert.equal(csrfStore.getCsrfToken(), meHydrated.csrfToken);

    // 4. Exercise Athlete repository endpoints (30 original + 11 newly reconciled) over HTTP
    const onboarded = await athleteRepo.completeOnboarding('cat_ath_loop_1', {
      displayName: 'Camilo Pro HTTP',
      goal: 'hipertrofia',
      biometrics: {
        weightKg: 80,
        heightCm: 178,
        bodyFatPct: 12,
        age: 27,
        palFactor: 1.55,
        targetDeltaKcal: 250,
        proteinPerKg: 2.0,
        fatPerKg: 0.9,
        bmr: 1790,
        tdee: 2775,
        targetCalories: 3025,
        targetProteinG: 160,
        targetFatG: 72,
        targetCarbsG: 434,
      },
      preferences: {
        weightUnit: 'kg',
        heightUnit: 'cm',
        timezone: 'America/Bogota',
        trainingDaysPerWeek: 4,
        sessionDurationMinutes: 60,
        trainingExperience: 'intermedio',
        availableEquipment: ['barra', 'mancuerna'],
        trainingGoal: 'hipertrofia',
        muscleFocus: ['pecho', 'espalda'],
        mealsPerDay: 4,
        dietaryPreference: 'omnivoro',
        onboardingStep: 6,
        onboardingCompleted: true,
        notificationPreferences: {
          mealReminders: true,
          workoutAlerts: true,
          groceryAlerts: true,
          systemUpdates: true,
        },
      },
    });
    assert.equal(onboarded.profile.onboardingCompleted, true);
    assert.equal(onboarded.profile.displayName, 'Camilo Pro HTTP');

    const savedBio = await athleteRepo.saveBiometrics('cat_ath_loop_1', {
      weightKg: 81,
      heightCm: 178,
      bodyFatPct: 12.5,
      age: 27,
      palFactor: 1.55,
      targetDeltaKcal: 250,
      proteinPerKg: 2.0,
      fatPerKg: 0.9,
      bmr: 1800,
      tdee: 2790,
      targetCalories: 3040,
      targetProteinG: 162,
      targetFatG: 73,
      targetCarbsG: 434,
    });
    assert.equal(savedBio.weightKg, 81);

    const savedPref = await athleteRepo.savePreferences('cat_ath_loop_1', {
      weightUnit: 'kg',
      heightUnit: 'cm',
      timezone: 'America/Bogota',
      trainingDaysPerWeek: 5,
      sessionDurationMinutes: 65,
      trainingExperience: 'intermedio',
      availableEquipment: ['barra', 'mancuerna', 'polea'],
      trainingGoal: 'hipertrofia',
      muscleFocus: ['pecho', 'espalda'],
      mealsPerDay: 5,
      dietaryPreference: 'omnivoro',
      onboardingStep: 6,
      onboardingCompleted: true,
      notificationPreferences: {
        mealReminders: true,
        workoutAlerts: true,
        groceryAlerts: true,
        systemUpdates: true,
      },
    });
    assert.equal(savedPref.mealsPerDay, 5);

    const mealCreated = await athleteRepo.logMeal('cat_ath_loop_1', {
      id: 'meal_http_1',
      dateTime: '2026-11-15T08:30',
      moment: 'desayuno',
      name: 'Tortilla proteica',
      description: 'Claras + avena',
      portion: '220 g',
      kcal: 420,
      protein: 38,
      carbs: 42,
      fat: 10,
      source: 'Manual',
    });
    assert.equal(mealCreated.id, 'meal_http_1');

    const mealsQueried = await athleteRepo.queryMealsByDateRange('2026-11-15', '2026-11-15');
    assert.equal(mealsQueried.items.length, 1);
    assert.equal(mealsQueried.items[0].name, 'Tortilla proteica');
    await athleteRepo.deleteMeal('cat_ath_loop_1', 'meal_http_1');

    // Multi-batch partial failure + idempotent recovery + individual manual CRUD
    const groceries30: GroceryItemRecord[] = Array.from({ length: 30 }, (_, i) => ({
      id: `gr_${String(i + 1).padStart(2, '0')}`,
      name: `Item ${i + 1}`,
      quantity: 100,
      unit: 'g',
      department: 'verduras',
      status: 'pending',
      origin: 'plan',
    }));
    failNextGrocerySyncSecondBatch = true;
    let partialErr: PartialBatchSyncError | null = null;
    try {
      await athleteRepo.syncGroceries('cat_ath_loop_1', groceries30);
    } catch (err) {
      partialErr = err as PartialBatchSyncError;
    }
    assert.ok(partialErr instanceof PartialBatchSyncError);
    assert.equal(partialErr.persistedCount, 25);
    assert.equal(partialErr.remainingItems.length, 5);

    const resumed = await athleteRepo.resumeGrocerySyncBatch(
      'cat_ath_loop_1',
      partialErr.remainingItems,
      partialErr.syncId
    );
    assert.equal(resumed.batchCalls, 1);

    const manualGrocery = await athleteRepo.addManualGrocery('cat_ath_loop_1', {
      name: 'Creatina Monohidrato',
      quantity: 300,
      unit: 'g',
      department: 'carbohidratos',
      status: 'pending',
      origin: 'manual',
    });
    const toggledManual = await athleteRepo.toggleGroceryStatus('cat_ath_loop_1', manualGrocery.id);
    assert.equal(toggledManual.status, 'bought');
    await athleteRepo.deleteGrocery('cat_ath_loop_1', manualGrocery.id);

    const snapAfterSync = await athleteRepo.hydrateWorkspace('cat_ath_loop_1');
    assert.equal(snapAfterSync.groceries.length, 30);

    // Workouts lifecycle: start -> logSet -> complete -> verify immutable terminal lock
    const wkStarted = await athleteRepo.startExecutedWorkout('cat_ath_loop_1', {
      routineId: 'rt_1',
      routineName: 'Upper / Lower',
      routineDayId: 'd1',
      routineDayName: 'Upper A',
      exercisesSnapshot: [
        {
          exerciseId: 'ex_bench',
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
    assert.equal(wkStarted.status, 'in_progress');
    assert.ok(wkStarted.id);

    const setLogged = await athleteRepo.logWorkoutSet('cat_ath_loop_1', {
      executedWorkoutId: wkStarted.id,
      exerciseId: 'ex_bench',
      exerciseName: 'Press Banca',
      muscleGroup: 'pecho',
      setNumber: 1,
      type: 'effective',
      weightKg: 80,
      reps: 8,
      rir: 2,
      completed: true,
    });
    assert.ok(setLogged.estimated1RM > 80);

    const wkCompleted = await athleteRepo.completeExecutedWorkout(
      'cat_ath_loop_1',
      wkStarted.id,
      'completed',
      { durationSeconds: 2700, sessionRpe: 8, notes: 'Sólido' }
    );
    assert.equal(wkCompleted.status, 'completed');

    // Terminal workout MUST reject new sets (409 PARENT_WORKOUT_NOT_ACTIVE)
    await assert.rejects(
      () =>
        athleteRepo.logWorkoutSet('cat_ath_loop_1', {
          executedWorkoutId: wkStarted.id,
          exerciseId: 'ex_bench',
          exerciseName: 'Press Banca',
          muscleGroup: 'pecho',
          setNumber: 2,
          type: 'effective',
          weightKg: 80,
          reps: 8,
          rir: 2,
          completed: true,
        }),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.statusCode === 409 &&
        err.code === 'PARENT_WORKOUT_NOT_ACTIVE'
    );

    const cardioCreated = await athleteRepo.addCardioSession('cat_ath_loop_1', {
      date: '2026-11-15',
      title: 'Zona 2 Bicicleta',
      protocolType: 'zone2',
      durationMinutes: 40,
      avgHeartRate: 138,
      caloriesBurned: 340,
    });
    assert.equal(cardioCreated.title, 'Zona 2 Bicicleta');
    await athleteRepo.deleteCardioSession('cat_ath_loop_1', cardioCreated.id);

    const notifCreated = await athleteRepo.createNotification('cat_ath_loop_1', {
      title: 'Objetivo semanal',
      message: 'Completaste tu sesión Upper A',
      category: 'entrenamiento',
      severity: 'success',
    });
    assert.equal(notifCreated.read, false);
    const notifMarked = await athleteRepo.markNotificationRead('cat_ath_loop_1', notifCreated.id, true);
    assert.equal(notifMarked.read, true);
    const notifUnreadAgain = await athleteRepo.markNotificationRead('cat_ath_loop_1', notifCreated.id, false);
    assert.equal(notifUnreadAgain.read, false);
    const allMarked = await athleteRepo.markAllNotificationsRead('cat_ath_loop_1');
    assert.ok(allMarked.every(n => n.read));

    const savedRecipe = await athleteRepo.saveRecipe('cat_ath_loop_1', {
      id: 'rec_1',
      name: 'Bowl de Pollo',
      suggestedMoment: 'almuerzo',
      servings: 1,
      prepTimeMinutes: 15,
      ingredients: [
        {
          foodId: 'f_pollo',
          foodName: 'Pechuga',
          grams: 180,
          calories: 290,
          protein: 52,
          carbs: 0,
          fat: 6,
        },
      ],
      totalNutrients: { calories: 290, protein: 52, carbs: 0, fat: 6 },
      updatedAt: '2026-11-15T12:00:00Z',
    });
    assert.equal(savedRecipe.id, 'rec_1');
    await athleteRepo.deleteRecipe('cat_ath_loop_1', 'rec_1');

    const savedPlan = await athleteRepo.saveMealPlan('cat_ath_loop_1', {
      weekStart: '2026-11-10',
      weekEnd: '2026-11-16',
      label: 'Semana 46',
      days: {},
      updatedAt: '2026-11-15T12:00:00Z',
    });
    assert.equal(savedPlan.weekStart, '2026-11-10');

    const savedRoutine = await athleteRepo.saveWorkoutRoutine('cat_ath_loop_1', {
      id: 'rt_1',
      name: 'Upper / Lower Clean',
      description: '4 días',
      goal: 'hipertrofia',
      frequencyDays: 4,
      isDefault: false,
      days: [],
      updatedAt: '2026-11-15T12:00:00Z',
    });
    assert.equal(savedRoutine.id, 'rt_1');
    const routinesDefaulted = await athleteRepo.setDefaultRoutine('cat_ath_loop_1', 'rt_1');
    assert.equal(routinesDefaulted.find(r => r.id === 'rt_1')?.isDefault, true);

    // Refresh session -> rotates sid & csrfToken cleanly
    const rotated = await authRepoHttp.refreshSession();
    assert.notEqual(rotated.sid, bootOut.sid);
    assert.notEqual(rotated.csrfToken, bootOut.csrfToken);

    // 5. Athlete calling Admin repository -> 403 PERMISSION_DENIED
    await assert.rejects(
      () => adminRepoHttp.listUsers('cat_ath_loop_1'),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.statusCode === 403 &&
        err.code === 'PERMISSION_DENIED'
    );

    // 6. Legacy flat Admin paths MUST return 404 ROUTE_NOT_FOUND
    for (const legacyPath of [
      '/api/v1/admin/invitations/revoke',
      '/api/v1/admin/users/set-status',
      '/api/v1/admin/users/set-role',
      '/api/v1/admin/users/password-reset',
    ]) {
      const legacyRes = await sessionFetch(`${baseUrl}${legacyPath}`, {
        method: 'POST',
        headers: {
          'X-Vigor-CSRF': csrfStore.getCsrfToken() ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(legacyRes.status, 404, `Expected 404 on legacy path ${legacyPath}`);
      const legacyJson = (await legacyRes.json()) as { error?: string };
      assert.equal(legacyJson.error, 'ROUTE_NOT_FOUND');
    }

    // Logout athlete session clears cookie & CSRF store
    const logoutOut = await authRepoHttp.logout();
    assert.equal(logoutOut.loggedOut, true);
    assert.equal(csrfStore.hasToken(), false);

    // 7. Admin canonical routes + query filters end-to-end
    authRuntime.setCurrentUser({
      zuid: 'z_adm_loop',
      user_id: 'cat_adm_loop_1',
      email_id: 'laura.admin@vigorcore.test',
      first_name: 'Laura',
      last_name: 'Admin',
      status: 'ACTIVE',
      is_confirmed: true,
    });
    await authRepoHttp.bootstrapProfile('Laura Admin');
    await db.updateItem('Users', { pk: 'USER#cat_adm_loop_1' }, { role: 'admin', roleVersion: 2 });
    await authRepoHttp.exchangeSession();

    const onlyAthletes = await adminRepoHttp.listUsers('cat_adm_loop_1', {
      role: 'athlete',
      searchQuery: 'Camilo',
    });
    assert.equal(onlyAthletes.length, 1);
    assert.equal(onlyAthletes[0].uid, 'cat_ath_loop_1');

    const createdInv = await adminRepoHttp.createInvitation(
      'cat_adm_loop_1',
      'invitado.loop@vigorcore.test',
      'athlete'
    );
    const revokedInv = await adminRepoHttp.revokeInvitation(
      'cat_adm_loop_1',
      createdInv.inviteId,
      'Prueba canonical HTTP'
    );
    assert.equal(revokedInv.status, 'revoked');

    const resetRes = await adminRepoHttp.requestPasswordReset('cat_adm_loop_1', 'cat_ath_loop_1');
    assert.equal(resetRes.emailSentTo, 'atleta.loop@vigorcore.test');

    const filteredLogs = await adminRepoHttp.listAuditLogs('cat_adm_loop_1', {
      targetUid: 'cat_ath_loop_1',
      action: 'password_reset_requested',
    });
    assert.equal(filteredLogs.length, 1);

    // Superadmin lock preserved over canonical /api/v1/admin/users/:uid/role
    await db.updateItem('Users', { pk: 'USER#cat_adm_loop_1' }, { role: 'superadmin', roleVersion: 3 });
    await authRepoHttp.exchangeSession();

    await assert.rejects(
      () => adminRepoHttp.setUserRole('cat_adm_loop_1', 'cat_ath_loop_1', 'superadmin', 'Bloqueo 4.0.2'),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.statusCode === 403 &&
        err.code === 'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED'
    );

    // Non-superadmin promotion athlete <-> admin succeeds over canonical route
    const promotedAdmin = await adminRepoHttp.setUserRole(
      'cat_adm_loop_1',
      'cat_ath_loop_1',
      'admin',
      'Promoción verificada'
    );
    assert.equal(promotedAdmin.role, 'admin');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
