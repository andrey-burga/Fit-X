/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.0 — Test Suite 16:
 * Real Express Advanced I/O HTTP Loopback Tests (`127.0.0.1:0`), 41-Route Parity,
 * Session Lifecycle (`__Host-vigor_session`, 12h/24h, <=15m Catalyst Revalidation, Bound CSRF),
 * Catalyst Prefix Normalization, Secret Redaction & Non-Applied Candidate Domain/Gateway Configs
 *
 * NOTE ON VERIFICATION SCOPE:
 * - Zero external network calls. All HTTP traffic runs strictly on `127.0.0.1:0`.
 * - Tagged `[PASS-LOOPBACK]` or `[PASS-UNIT]`. Live Zoho Catalyst (`INT-01..INT-08`) stays pending.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MockCatalystAuthRuntime, ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  buildAlternativeAConfig,
  buildAlternativeBConfig,
  getRequiredServerEnvSpecs,
} from '../src/provisioning/domainGatewayConfigs.js';
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';
import {
  createVigorCoreProductionRuntimeFromEnv,
  normalizeCatalystPath,
  type RedactedRequestLogEntry,
} from '../src/server/advancedIoApp.js';
import { catalystAdvancedIoEntry, resetAdvancedIoRuntimeForTests } from '../src/server/catalystEntry.js';

function createBaseEnv(hmacSecret: string) {
  return {
    CATALYST_PROJECT_ID: 'proj_loopback_500',
    CATALYST_PROJECT_KEY: 'proj_key_loopback_secret',
    CATALYST_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'test',
    CATALYST_API_DOMAIN: 'http://127.0.0.1:19999',
    CATALYST_ACCOUNTS_URL: 'http://127.0.0.1:19998',
    CATALYST_ADMIN_CLIENT_ID: '1000.TEST_CLIENT',
    CATALYST_ADMIN_CLIENT_SECRET: 'client_secret_must_never_leak',
    CATALYST_ADMIN_REFRESH_TOKEN: 'refresh_token_must_never_leak',
    VIGOR_SESSION_HMAC_SECRET: hmacSecret,
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://fit-x-bhnatsxl.onslate.com,https://app.vigorcore.lat',
  };
}

function extractCookieValue(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  const firstPart = setCookieHeader.split(';')[0];
  const eq = firstPart.indexOf('=');
  assert.ok(eq > 0);
  return firstPart.slice(eq + 1);
}

test('Phase 5.0 [PASS-UNIT] Path normalization strips Catalyst /server/<fn> prefix and rejects traversal', () => {
  assert.equal(normalizeCatalystPath('/api/v1/auth/me'), '/api/v1/auth/me');
  assert.equal(normalizeCatalystPath('/server/vigor_api/api/v1/auth/me'), '/api/v1/auth/me');
  assert.equal(normalizeCatalystPath('/server/vigor_api/health'), '/health');
  assert.equal(normalizeCatalystPath('/server/vigor_api/'), '/');

  assert.throws(() => normalizeCatalystPath('/api/v1/../admin/users'), /INVALID_REQUEST_PATH|prohibited/i);
  assert.throws(() => normalizeCatalystPath('/api/v1/%2e%2e/admin/users'), /prohibited/i);
  assert.throws(() => normalizeCatalystPath('/api/v1/foo\\bar'), /prohibited/i);
});

test('Phase 5.0 [PASS-LOOPBACK] Real Express HTTP loopback tests lifecycle, CORS/CSRF, 41 routes, and secret redaction', async () => {
  let nowSec = 1_760_000_000;
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const logs: RedactedRequestLogEntry[] = [];

  authRuntime.setCurrentUser({
    zuid: 'z_loop_1',
    user_id: 'u_loop_1',
    email_id: 'athlete@vigorcore.lat',
    status: 'ACTIVE',
    is_confirmed: true,
    first_name: 'Leo',
    last_name: 'Vigor',
  });

  const bundle = createVigorCoreProductionRuntimeFromEnv(createBaseEnv(hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    authRuntimeOverride: authRuntime,
    nowSecProvider: () => nowSec,
    nowMsProvider: () => nowSec * 1000,
    logger: entry => logs.push(entry),
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = 'https://app.vigorcore.lat';

  try {
    // 1. Health check via direct & Catalyst /server/vigor_api prefix
    const healthRes = await fetch(`${baseUrl}/server/vigor_api/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = (await healthRes.json()) as any;
    assert.equal(healthBody.routeCount, 41);
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('cache-control'), 'no-store');

    // 2. Traversal blocked cleanly over raw HTTP wire (bypassing WHATWG fetch client dot-segment normalization)
    const travRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'GET',
          path: '/server/vigor_api/api/v1/%2e%2e/admin/users',
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(travRes.status, 400);
    assert.equal(travRes.body.error, 'INVALID_REQUEST_PATH');

    // 3. CORS OPTIONS preflight: allowed vs rejected
    const optAllowed = await fetch(`${baseUrl}/api/v1/athlete/meals`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://fit-x-bhnatsxl.onslate.com' },
    });
    assert.equal(optAllowed.status, 204);
    assert.equal(optAllowed.headers.get('access-control-allow-origin'), 'https://fit-x-bhnatsxl.onslate.com');
    assert.equal(optAllowed.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(
      optAllowed.headers.get('access-control-allow-headers'),
      'Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With'
    );

    const optDenied = await fetch(`${baseUrl}/api/v1/athlete/meals`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example.com' },
    });
    assert.equal(optDenied.status, 403);
    assert.equal(optDenied.headers.get('access-control-allow-origin'), null);

    // 4. Bootstrap profile + mint __Host-vigor_session & CSRF over /server/vigor_api prefix
    const bootRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'fetch',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(bootRes.status, 200);
    const setCookieHdr = bootRes.headers.get('set-cookie');
    assert.ok(setCookieHdr?.includes('__Host-vigor_session='));
    assert.ok(setCookieHdr?.includes('HttpOnly'));
    assert.ok(setCookieHdr?.includes('Secure'));
    assert.ok(setCookieHdr?.includes('SameSite=Strict'));
    assert.ok(setCookieHdr?.includes('Path=/'));
    assert.equal(setCookieHdr?.includes('Domain='), false);

    const sessionCookieVal = extractCookieValue(setCookieHdr);
    const bootJson = (await bootRes.json()) as any;
    let csrfToken: string = bootJson.csrfToken;
    assert.ok(csrfToken);

    // 5. Cookie-only mutation requires valid X-Vigor-CSRF (rejects missing & cross-site)
    const missingCsrf = await fetch(`${baseUrl}/api/v1/athlete/meals`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        Cookie: `__Host-vigor_session=${sessionCookieVal}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateTime: '2026-10-15T12:00:00.000Z',
        name: 'Chicken Bowl',
        kcal: 620,
        protein: 52,
        carbs: 65,
        fat: 14,
      }),
    });
    assert.equal(missingCsrf.status, 403);

    // Valid mutation succeeds WITHOUT sending Catalyst user headers
    const mealRes = await fetch(`${baseUrl}/api/v1/athlete/meals`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-CSRF': csrfToken,
        Cookie: `__Host-vigor_session=${sessionCookieVal}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'meal_http_1',
        dateTime: '2026-10-15T12:00:00.000Z',
        name: 'Chicken Bowl',
        kcal: 620,
        protein: 52,
        carbs: 65,
        fat: 14,
      }),
    });
    assert.equal(mealRes.status, 201);

    // 6. Advance clock 16 min -> triggers Catalyst getUserDetails check. BaaS outage fails closed 503!
    nowSec += 16 * 60;
    authRuntime.setDetailsError(`Simulated outage leaking ${hmacSecret} and client_secret_must_never_leak`);
    const revalOutage = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        Origin: origin,
        Cookie: `__Host-vigor_session=${sessionCookieVal}`,
      },
    });
    assert.equal(revalOutage.status, 503);
    const outageText = await revalOutage.text();
    assert.equal(outageText.includes(hmacSecret), false);
    assert.equal(outageText.includes('client_secret_must_never_leak'), false);
    assert.equal(revalOutage.headers.get('set-cookie'), null); // Cookie preserved on transient 503 outage

    // Clear outage -> refresh rotates sid & csrfToken
    authRuntime.setDetailsError(null);
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/session/refresh`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-CSRF': csrfToken,
        Cookie: `__Host-vigor_session=${sessionCookieVal}`,
      },
    });
    assert.equal(refreshRes.status, 200);
    const rotatedCookieVal = extractCookieValue(refreshRes.headers.get('set-cookie'));
    const rotatedJson = (await refreshRes.json()) as any;
    const rotatedCsrf: string = rotatedJson.csrfToken;
    assert.notEqual(rotatedCookieVal, sessionCookieVal);
    assert.notEqual(rotatedCsrf, csrfToken);

    // Replay old session after 5s grace triggers 401 SESSION_REPLAY_DETECTED + global epoch bump
    nowSec += 10;
    const replayRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        Origin: origin,
        Cookie: `__Host-vigor_session=${sessionCookieVal}`,
      },
    });
    assert.equal(replayRes.status, 401);
    assert.equal(((await replayRes.json()) as any).error, 'SESSION_REPLAY_DETECTED');

    // Rotated session ALSO invalidated now because epoch bumped globally!
    const postReplayRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        Origin: origin,
        Cookie: `__Host-vigor_session=${rotatedCookieVal}`,
      },
    });
    assert.equal(postReplayRes.status, 401);

    // Fresh exchange + logout during BaaS outage succeeds with Max-Age=0
    const exch2 = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'fetch',
      },
    });
    assert.equal(exch2.status, 200);
    const cookie2 = extractCookieValue(exch2.headers.get('set-cookie'));
    const csrf2 = ((await exch2.json()) as any).csrfToken;

    authRuntime.setDetailsError('Catalyst down');
    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/session/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-CSRF': csrf2,
        Cookie: `__Host-vigor_session=${cookie2}`,
      },
    });
    assert.equal(logoutRes.status, 200);
    assert.ok(logoutRes.headers.get('set-cookie')?.includes('Max-Age=0'));
    authRuntime.setDetailsError(null);

    // 7. Admin routes: athlete receives 403; audit superadmin password-reset still blocked by INT-08
    const exch3 = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'fetch',
      },
    });
    const cookie3 = extractCookieValue(exch3.headers.get('set-cookie'));
    const csrf3 = ((await exch3.json()) as any).csrfToken;

    const adminListByAthlete = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { Origin: origin, Cookie: `__Host-vigor_session=${cookie3}` },
    });
    assert.equal(adminListByAthlete.status, 403);

    // 8. Complete 41-route Express parity verification: NO route returns 501 NOT_IMPLEMENTED
    for (const spec of ROUTE_CONTRACT_SPECS) {
      const concretePath = spec.path
        .replace(':workoutId', 'wk_probe')
        .replace(':recipeId', 'rec_probe')
        .replace(':weekStart', '2026-10-12')
        .replace(':routineId', 'rt_probe')
        .replace(':inviteId', 'inv_probe')
        .replace(':uid', 'u_loop_1')
        .replace(':mealId', 'meal_probe')
        .replace(':groceryId', 'gr_probe')
        .replace(':cardioId', 'cd_probe')
        .replace(':notificationId', 'nt_probe');

      const queryStr = spec.id === 'athlete.meals.list' ? '?startDate=2026-10-01&endDate=2026-10-31' : '';
      const res = await fetch(`${baseUrl}${concretePath}${queryStr}`, {
        method: spec.method,
        headers: {
          Origin: origin,
          'Sec-Fetch-Site': 'same-site',
          ...(spec.requiresCsrf
            ? {
                'X-Vigor-CSRF': csrf3,
                'X-Vigor-Requested-With': 'fetch',
                'Content-Type': 'application/json',
              }
            : {}),
          Cookie: `__Host-vigor_session=${cookie3}`,
        },
        ...(spec.method === 'POST' || spec.method === 'PUT' || spec.method === 'PATCH'
          ? { body: JSON.stringify({}) }
          : {}),
      });
      assert.notEqual(res.status, 501, `Route ${spec.method} ${spec.path} unexpectedly returned 501`);
    }

    // Ensure logs never record secrets
    const allLogsStr = JSON.stringify(logs);
    assert.equal(allLogsStr.includes(hmacSecret), false);
    assert.equal(allLogsStr.includes('client_secret_must_never_leak'), false);
    assert.equal(allLogsStr.includes('__Host-vigor_session='), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.0 [PASS-LOOPBACK] Lazy catalystEntry fails closed with 503 without env secrets on demand', async () => {
  resetAdvancedIoRuntimeForTests();
  const prevSecret = process.env.VIGOR_SESSION_HMAC_SECRET;
  delete process.env.VIGOR_SESSION_HMAC_SECRET;

  const entryServer = http.createServer(catalystAdvancedIoEntry);
  await new Promise<void>(resolve => entryServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (entryServer.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'SERVER_CONFIGURATION_UNAVAILABLE');
  } finally {
    if (prevSecret !== undefined) process.env.VIGOR_SESSION_HMAC_SECRET = prevSecret;
    resetAdvancedIoRuntimeForTests();
    await new Promise<void>(resolve => entryServer.close(() => resolve()));
  }
});

test('Phase 5.0 [PASS-UNIT] Candidate non-applied Alternative A/B configs & env specs contain zero secrets', () => {
  const altA = buildAlternativeAConfig();
  const altB = buildAlternativeBConfig();
  assert.equal(altA.applied, false);
  assert.equal(altB.applied, false);
  assert.equal(altA.cookieTopology, 'same-site');
  assert.equal(altB.gatewayConfig.authEnabledAtGateway, false);
  assert.ok(altB.caveats.some(c => c.includes('catalyst apig:enable')));

  const envSpecs = getRequiredServerEnvSpecs();
  assert.ok(envSpecs.some(s => s.name === 'CATALYST_ADMIN_REFRESH_TOKEN' && s.secret));
  assert.ok(envSpecs.some(s => s.name === 'VIGOR_SESSION_HMAC_SECRET' && s.secret));

  const candDir = fileURLToPath(new URL('../config/candidates', import.meta.url));
  for (const fname of [
    'alternative-a-advanced-io.security-rules.json',
    'alternative-b-api-gateway.routes.json',
    'catalyst-function.template.json',
  ]) {
    const raw = fs.readFileSync(path.join(candDir, fname), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed._meta.status, 'CANDIDATE_NOT_APPLIED');
    assert.equal(/1000\.[A-Za-z0-9]{10,}/.test(raw), false);
  }
});
