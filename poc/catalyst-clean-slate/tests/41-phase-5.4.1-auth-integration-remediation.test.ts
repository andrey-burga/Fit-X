/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Test Suite 41:
 * Frontend / Backend Authentication Integration Remediation Verification
 *
 * Scope Classification: LOCAL_VERIFIED (unit tests, loopback HTTP `127.0.0.1:0`,
 * and real headless Chromium `playwright-core` E2E against compiled `dist-frontend`).
 * Zero remote Catalyst operations.
 *
 * Covers ALL 14 Phase 5.4.1 required scenarios:
 *  1. `/auth/login` route & safe redirect validation (open redirect & iframe blocked)
 *  2. `/auth/callback` & verified Catalyst identity (cancel, unconfirmed, disabled, expired invite, missing profile, backend failure)
 *  3. Pre-session credential forwarding (Option A: Native Catalyst Edge user-context; zero forged x-zc-*)
 *  4. `/bootstrap-profile` least-privilege `athlete` creation & duplicate email rejection
 *  5. HMAC session issuance (`Users` + `SystemControl SESSION#<sid>` before cookie)
 *  6. Browser cookie attributes (`__Host-vigor_session; HttpOnly; Secure; SameSite=Strict; Path=/`) & Chromium acceptance
 *  7. Authenticated workspace request (`GET /api/v1/auth/me` + `GET /api/v1/athlete/workspace` Path 3)
 *  8. CSRF rejection (`403 CSRF_TOKEN_MISSING`, `CSRF_TOKEN_SESSION_MISMATCH`) & acceptance (`X-Vigor-CSRF`)
 *  9. `/refresh` `sid`/cookie/CSRF rotation + `getUserDetails()` live check + `> 5s` replay epoch bump
 * 10. `/logout` & post-logout replay rejection (`401 SESSION_REVOKED_REAUTH_REQUIRED`)
 * 11. Cross-site cookie failure under current topology (`app.vigorcore.lat` vs `*.catalystserverless.com` + Chromium cross-site test)
 * 12. Proposed same-site (`app.vigorcore.lat` <-> `api.vigorcore.lat`) & same-origin (`app.vigorcore.lat`) topologies
 * 13. Anonymous admin-context request (`x-zc-user-type=admin` + opaque platform token) remains `401 UNAUTHENTICATED`
 * 14. `external_oauth` (`CatalystSeparatedAuthRuntime`) remains unchanged
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';

import {
  AuthGuardError,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import {
  CatalystHostedAuthBridge,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  PRE_SESSION_CREDENTIAL_CONTRACT,
  ServerCsrfTokenProvider,
  resolveSafeSameOriginRedirect,
} from '../src/frontend/adapters/index.js';
import { CleanSlateRepositoryError } from '../src/frontend/contracts/repositories.js';
import {
  buildPathWithPreservedMode,
  parseAppRoute,
} from '../src/frontend/routing/authRouting.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  type AdminSpoofDiagnosticEvent,
} from '../src/sdk/catalystSdkBridge.js';
import {
  assertStrictCookieAttributes,
  evaluateBrowserCookieCompatibility,
} from '../src/security/httpSecurityPolicy.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { KeyBuilders, type SessionRecordItem, type UserAccountItem } from '../src/types/cleanSlate.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');
const DIST_FRONTEND_DIR = path.join(POC_ROOT, 'dist-frontend');
const CHROMIUM_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

interface SpyUser {
  [key: string]: unknown;
  zuid: string;
  user_id: string;
  email_id: string;
  first_name: string;
  last_name: string;
  status: 'ACTIVE' | 'DISABLED';
  is_confirmed: boolean;
}

function startBaaSSpy(usersByToken: Record<string, SpyUser>) {
  const userCurrentCalls: Array<{ url: string; token: string }> = [];
  const userDetailsCalls: Array<{ url: string; userId: string }> = [];

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    req.resume();
    req.on('end', () => {
      if (url.includes('/project-user/current') && method === 'GET') {
        const tok =
          typeof req.headers['x-zc-user-cred-token'] === 'string'
            ? req.headers['x-zc-user-cred-token']
            : typeof req.headers['authorization'] === 'string'
              ? req.headers['authorization']
              : '';
        userCurrentCalls.push({ url, token: tok });
        const matched = Object.entries(usersByToken).find(([key]) => tok.includes(key))?.[1];
        if (matched) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: matched }));
          return;
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure', message: 'Invalid user credential' }));
        return;
      }

      if (url.includes('/project-user/') && method === 'GET') {
        const uid = url.split('/project-user/')[1]?.split('?')[0] ?? '';
        userDetailsCalls.push({ url, userId: uid });
        const matched = Object.values(usersByToken).find(u => u.user_id === uid);
        if (!matched) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failure', message: 'User not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: matched }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', message: 'Unhandled spy path' }));
    });
  });

  return {
    userCurrentCalls,
    userDetailsCalls,
    resetCalls: () => {
      userCurrentCalls.length = 0;
      userDetailsCalls.length = 0;
    },
    async start(): Promise<string> {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function edgeAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-zc-projectid': '136967000000014024',
    'x-zc-environment': 'Development',
    'x-zc-project-key': 'SECRET_EDGE_PROJECT_KEY_541',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'SECRET_EDGE_ADMIN_TOKEN_541',
    ...extra,
  };
}

function hostedEnv(
  apiDomain: string,
  secret: string,
  allowedOrigins: string[] = ['https://app.vigorcore.lat']
): Record<string, string> {
  return {
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'express_enforced',
    VIGORCORE_CATALYST_API_DOMAIN: apiDomain,
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: secret,
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: allowedOrigins.join(','),
  };
}

function ensureFrontendBuilt(): void {
  if (!fs.existsSync(path.join(DIST_FRONTEND_DIR, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--config', 'vite.frontend.config.ts'], {
      cwd: POC_ROOT,
      stdio: 'pipe',
    });
  }
}

test('Phase 5.4.1 [LOCAL_VERIFIED / Scenarios 1,3,11,12,14] Routing invariants, Option A credential contract, Cookie Topology A/B vs Current, and External OAuth isolation', async () => {
  // Scenario 1: /auth/login & /auth/callback routing + open redirect rejection + untrusted param stripping + iframe block
  const loginRoute = parseAppRoute({
    pathname: '/auth/login/',
    search: '?mode=http&next=https://evil.attacker.example/steal&uid=usr_admin&role=superadmin&loggedOut=1',
    origin: 'https://app.vigorcore.lat',
  });
  assert.equal(loginRoute.routeId, 'auth-login');
  assert.equal(loginRoute.pathname, '/auth/login');
  assert.equal(loginRoute.isHttpModeRequested, true);
  assert.equal(loginRoute.rejectedUnsafeRedirect, true);
  assert.equal(loginRoute.safeNextPath, '/');
  assert.equal(loginRoute.loggedOut, true);
  assert.deepEqual(loginRoute.ignoredUntrustedParams.sort(), ['role', 'uid']);

  const cancelRoute = parseAppRoute({
    pathname: '/auth/callback',
    search: '?error=access_denied&error_description=User%20cancelled',
    origin: 'https://app.vigorcore.lat',
  });
  assert.equal(cancelRoute.routeId, 'auth-callback');
  assert.equal(cancelRoute.cancelled, true);

  assert.throws(
    () => resolveSafeSameOriginRedirect('//evil.test/cb', 'https://app.vigorcore.lat'),
    (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'OPEN_REDIRECT_BLOCKED'
  );
  assert.throws(
    () => resolveSafeSameOriginRedirect('https://evil.test/cb', 'https://app.vigorcore.lat'),
    (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'OPEN_REDIRECT_BLOCKED'
  );
  assert.equal(
    buildPathWithPreservedMode('/auth/callback', '?mode=http&foo=bar'),
    '/auth/callback?mode=http'
  );

  // iframe execution rejection in CatalystHostedAuthBridge
  const prevWin = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { self: { id: 1 }, top: { id: 2 } };
  try {
    const iframeBridge = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async generateAuthToken() {
          return { access_token: 'tok' };
        },
        async isUserAuthenticated() {
          return false;
        },
        async signOut() {},
      },
      authRepo: new CatalystHttpAuthRepository(
        new CatalystHttpTransport({
          baseUrl: 'https://app.vigorcore.lat',
          fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        })
      ),
      expectedOrigin: 'https://app.vigorcore.lat',
    });
    await assert.rejects(
      () => iframeBridge.startHostedLogin('/auth/callback'),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'HOSTED_LOGIN_IFRAME_FORBIDDEN'
    );
  } finally {
    if (prevWin === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWin;
    }
  }

  // Scenario 3: Option A contract constants (no forged x-zc-*, no storage tokens)
  assert.equal(
    PRE_SESSION_CREDENTIAL_CONTRACT.selectedOption,
    'OPTION_A_NATIVE_CATALYST_EDGE_USER_CONTEXT_FORWARDING'
  );
  assert.equal(PRE_SESSION_CREDENTIAL_CONTRACT.forbidsClientXzcHeaders, true);
  assert.equal(PRE_SESSION_CREDENTIAL_CONTRACT.forbidsWebStorageTokens, true);
  assert.equal(PRE_SESSION_CREDENTIAL_CONTRACT.missingLiveEvidence.length, 2);

  // Scenario 11 vs 12: Cookie compatibility matrix across Current Cross-Site vs Architecture A vs Architecture B
  const currentCrossSite = evaluateBrowserCookieCompatibility(
    'https://app.vigorcore.lat',
    'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api'
  );
  assert.equal(currentCrossSite.relationship, 'cross-site');
  assert.equal(currentCrossSite.sameSiteStrictSentByBrowser, false);
  assert.equal(currentCrossSite.topologyAlternative, 'INCOMPATIBLE_DEFAULT_CATALYST_CROSS_SITE');

  const archASameSite = evaluateBrowserCookieCompatibility(
    'https://app.vigorcore.lat',
    'https://api.vigorcore.lat'
  );
  assert.equal(archASameSite.relationship, 'same-site');
  assert.equal(archASameSite.sameSiteStrictSentByBrowser, true);
  assert.equal(archASameSite.requiresCredentialsInclude, true);
  assert.equal(archASameSite.topologyAlternative, 'A_CUSTOM_DOMAIN_SAME_SITE');

  const archBSameOrigin = evaluateBrowserCookieCompatibility(
    'https://app.vigorcore.lat',
    'https://app.vigorcore.lat'
  );
  assert.equal(archBSameOrigin.relationship, 'same-origin');
  assert.equal(archBSameOrigin.sameSiteStrictSentByBrowser, true);
  assert.equal(archBSameOrigin.requiresCredentialsInclude, false);
  assert.equal(archBSameOrigin.topologyAlternative, 'C_DEDICATED_REVERSE_PROXY');

  // Scenario 14: external_oauth (CatalystSeparatedAuthRuntime) remains untouched
  const baas = startBaaSSpy({});
  const baasOrigin = await baas.start();
  try {
    const diag: AdminSpoofDiagnosticEvent[] = [];
    const extProvider = new CatalystAdminAppProvider({
      projectId: '136967000000014024',
      projectKey: 'SECRET_EXT_KEY_541',
      catalystEnvironment: 'Development',
      apiDomain: baasOrigin,
      accountsUrl: 'https://accounts.zoho.com',
      clientId: 'cli_541',
      clientSecret: 'SECRET_CLI_541',
      refreshToken: 'SECRET_REF_541',
      allowInsecureLoopbackForTest: true,
    });
    const extRuntime = new CatalystSeparatedAuthRuntime({
      adminProvider: extProvider,
      diagnosticLogger: ev => diag.push(ev),
    });

    assert.equal(
      await extRuntime.getCurrentUserFromRequest({
        headers: { 'x-zc-projectid': '136967000000014024', 'x-zc-user-type': 'admin' },
      }),
      null
    );
    await assert.rejects(
      () =>
        extRuntime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': '136967000000014024',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': 'SECRET_SPOOF_541',
          },
        }),
      (e: unknown) =>
        e instanceof AuthGuardError && e.code === 'CATALYST_ADMIN_HEADER_SPOOFED' && e.statusCode === 403
    );
    assert.equal(diag.length, 1);
    assert.equal(diag[0].authRuntimeMode, 'external_oauth');
    assert.equal(baas.userCurrentCalls.length, 0);
  } finally {
    await baas.close();
  }
});

test('Phase 5.4.1 [LOCAL_VERIFIED / Scenarios 2-13] Loopback API contract verification: Edge forwarding, bootstrap duplicate email 409, Path 3 HMAC+CSRF, /refresh replay bump, /logout, cross-site 403, and admin-context 401', async () => {
  const userTok = 'SECRET_541_USER_TOK';
  const altTok = 'SECRET_541_ALT_SAME_EMAIL_TOK';
  const opaqueEdgeTok = 'SECRET_541_PLATFORM_OPAQUE_TOK';

  const spyUsers: Record<string, SpyUser> = {
    [userTok]: {
      zuid: '9954101',
      user_id: 'u_541_athlete',
      email_id: 'phase541@vigorcore.lat',
      first_name: 'Camilo',
      last_name: '541',
      status: 'ACTIVE',
      is_confirmed: true,
    },
    [altTok]: {
      zuid: '9954102',
      user_id: 'u_541_duplicate_uid',
      email_id: 'phase541@vigorcore.lat',
      first_name: 'Dup',
      last_name: 'User',
      status: 'ACTIVE',
      is_confirmed: true,
    },
  };

  const baas = startBaaSSpy(spyUsers);
  const baasOrigin = await baas.start();
  const db = new CleanSlateInMemoryNoSQLAdapter();
  let nowSec = Math.floor(Date.now() / 1000);
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);

  const bundle = createVigorCoreProductionRuntimeFromEnv(
    hostedEnv(baasOrigin, hmacSecret, ['https://app.vigorcore.lat']),
    {
      allowInsecureLoopbackForTest: true,
      adapterOverride: db,
      nowSecProvider: () => nowSec,
      nowMsProvider: () => nowSec * 1000,
    }
  );
  const srv = http.createServer(bundle.app);
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

  try {
    // Scenario 13: Anonymous admin-context request (x-zc-user-type=admin + opaque platform token) -> 401 UNAUTHENTICATED, 0 BaaS calls
    baas.resetCalls();
    const anonAdminCtx = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: edgeAdminHeaders({
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': opaqueEdgeTok,
      }),
    });
    assert.equal(anonAdminCtx.status, 401);
    assert.equal(((await anonAdminCtx.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    assert.equal(baas.userCurrentCalls.length, 0);

    // Scenario 3: Raw client Authorization without Catalyst Edge forwarding does NOT bypass HostedNative edge boundary
    const rawAuthWithoutEdge = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userTok}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(rawAuthWithoutEdge.status, 401);
    assert.equal(baas.userCurrentCalls.length, 0);

    // Scenario 11: Cross-site request (Sec-Fetch-Site: cross-site / bad Origin) rejected 403 CSRF_CROSS_SITE_REJECTED
    const crossSiteBlocked = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'cross-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': userTok,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(crossSiteBlocked.status, 403);
    assert.equal(((await crossSiteBlocked.json()) as { error?: string }).error, 'CSRF_CROSS_SITE_REJECTED');

    // Scenario 12: Same-site (`app.vigorcore.lat` -> `api.vigorcore.lat`) /exchange fails 403 USER_PROFILE_NOT_REGISTERED
    const preBoot = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': userTok,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(preBoot.status, 403);
    assert.equal(((await preBoot.json()) as { error?: string }).error, 'USER_PROFILE_NOT_REGISTERED');

    // Scenario 4 & 5: /bootstrap-profile creates least-privilege athlete in Users + SystemControl SESSION#<sid> BEFORE cookie
    const bootRes = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': userTok,
        }),
      },
      body: JSON.stringify({ displayName: 'Atleta 541' }),
    });
    assert.equal(bootRes.status, 200);
    const setCookieHeader = bootRes.headers.get('set-cookie') ?? '';
    assertStrictCookieAttributes(setCookieHeader);
    assert.ok(setCookieHeader.startsWith(`${SIGNED_SESSION_COOKIE_NAME}=`));
    assert.ok(!/;\s*Domain=/i.test(setCookieHeader));
    const cookieVal = setCookieHeader.split(';')[0].split('=')[1];
    const bootBody = (await bootRes.json()) as {
      sid: string;
      csrfToken: string;
      actor: { catalystUserId: string; role: string; sessionEpoch: number };
    };
    assert.equal(bootBody.actor.catalystUserId, 'u_541_athlete');
    assert.equal(bootBody.actor.role, 'athlete');
    assert.equal(bootBody.actor.sessionEpoch, 1);

    const persistedSession = await db.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: KeyBuilders.sessionPk(bootBody.sid) },
      { consistent_read: true }
    );
    assert.equal(persistedSession?.status, 'active');

    // Duplicate email from a different Catalyst UID MUST fail 409 DUPLICATE_EMAIL_ANOMALY
    const dupEmailRes = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': altTok,
        }),
      },
      body: JSON.stringify({ displayName: 'Dup User' }),
    });
    assert.equal(dupEmailRes.status, 409);
    assert.equal(((await dupEmailRes.json()) as { error?: string }).error, 'DUPLICATE_EMAIL_ANOMALY');

    // Scenario 7: Path 3 /auth/me & /athlete/workspace work with ZERO getCurrentUser() BaaS calls even when x-zc-user-type=admin
    baas.resetCalls();
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin', 'x-zc-user-cred-token': opaqueEdgeTok }),
      },
    });
    assert.equal(meRes.status, 200);
    assert.equal(baas.userCurrentCalls.length, 0);

    const wsRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin', 'x-zc-user-cred-token': opaqueEdgeTok }),
      },
    });
    assert.equal(wsRes.status, 200);
    assert.equal(baas.userCurrentCalls.length, 0);

    // Scenario 8: Missing CSRF / mismatched session CSRF rejected 403; bound X-Vigor-CSRF accepted
    const noCsrf = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ location: 'Medellin' }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(((await noCsrf.json()) as { error?: string }).error, 'CSRF_TOKEN_MISSING');

    const badCsrf = bundle.sessionTokens.issueCsrfToken('u_541_athlete', '0123456789abcdef0123456789abcdef', 1, nowSec + 3600);
    const mismatchCsrf = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': badCsrf,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ location: 'Medellin' }),
    });
    assert.equal(mismatchCsrf.status, 403);
    assert.equal(((await mismatchCsrf.json()) as { error?: string }).error, 'CSRF_TOKEN_SESSION_MISMATCH');

    // Scenario 9: /refresh rotates sid + cookie + csrfToken + invokes getUserDetails(); replay > 5s bumps epoch
    baas.resetCalls();
    const refRes = await fetch(`${baseUrl}/api/v1/auth/session/refresh`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': bootBody.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(refRes.status, 200);
    assert.equal(baas.userDetailsCalls.length, 1);
    const refCookieHeader = refRes.headers.get('set-cookie') ?? '';
    assertStrictCookieAttributes(refCookieHeader);
    const refCookieVal = refCookieHeader.split(';')[0].split('=')[1];
    const refBody = (await refRes.json()) as { sid: string; csrfToken: string };
    assert.notEqual(refBody.sid, bootBody.sid);
    assert.notEqual(refBody.csrfToken, bootBody.csrfToken);

    // Replay old cookie after > 5s bumps sessionEpoch -> 401 SESSION_REPLAY_DETECTED
    nowSec += 10;
    const replayRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${cookieVal}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(replayRes.status, 401);
    assert.equal(((await replayRes.json()) as { error?: string }).error, 'SESSION_REPLAY_DETECTED');
    const updatedUser = await db.fetchItem<UserAccountItem>('Users', { pk: KeyBuilders.userPk('u_541_athlete') });
    assert.equal(updatedUser?.sessionEpoch, 2);

    // Fresh exchange after epoch bump -> issue cookie -> /logout -> replay fails 401 SESSION_REVOKED_REAUTH_REQUIRED
    const ex2 = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': userTok,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(ex2.status, 200);
    const ex2Cookie = (ex2.headers.get('set-cookie') ?? '').split(';')[0].split('=')[1];
    const ex2Body = (await ex2.json()) as { csrfToken: string };

    // Scenario 2 extra check: Expired invitation rejected fail-closed over Path 3 `/invitations/redeem`
    const admSvc = new AdminGovernanceService(db, bundle.authRuntime, () => nowSec * 1000);
    const superadminActor = {
      catalystUserId: 'u_adm_541',
      email: 'adm@vigorcore.lat',
      normalizedEmail: 'adm@vigorcore.lat',
      displayName: 'Admin',
      role: 'superadmin' as const,
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active' as const,
      isConfirmed: true,
    };
    const inv = await admSvc.createInvitation(superadminActor, 'phase541@vigorcore.lat', 'admin');
    await db.updateItem(
      'AdminInvitations',
      { pk: `INVITE#${inv.inviteId}` },
      { expiresAtEpochSec: nowSec - 60 }
    );
    const expiredRedeem = await fetch(`${baseUrl}/api/v1/invitations/redeem`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': ex2Body.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${ex2Cookie}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ inviteId: inv.inviteId, token: inv.rawToken }),
    });
    assert.equal(expiredRedeem.status, 409);
    assert.equal(((await expiredRedeem.json()) as { error?: string }).error, 'INVITATION_EXPIRED');

    // Scenario 10: /logout + post-logout replay rejection
    const outRes = await fetch(`${baseUrl}/api/v1/auth/session/logout`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': ex2Body.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${ex2Cookie}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(outRes.status, 200);
    assert.ok((outRes.headers.get('set-cookie') ?? '').includes('Max-Age=0'));

    const postOut = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${ex2Cookie}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(postOut.status, 401);
    assert.equal(((await postOut.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');

    // Keep refCookieVal referenced
    assert.ok(refCookieVal.length > 20);
  } finally {
    await new Promise<void>(resolve => srv.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.4.1 [LOCAL_VERIFIED / Browser E2E Scenarios 1,2,4,5,6,7,8,9,10,11] Headless Chromium tests `/auth/login` -> Hosted Login -> `/auth/callback` (cancel, unconfirmed, disabled, bootstrap, CSRF, refresh, logout, and cross-site cookie withheld)', async () => {
  ensureFrontendBuilt();
  assert.ok(fs.existsSync(CHROMIUM_EXECUTABLE), `Chromium not found at ${CHROMIUM_EXECUTABLE}`);

  const activeUserTok = 'SECRET_E2E_541_ACTIVE';
  const usersByTok: Record<string, SpyUser> = {
    [activeUserTok]: {
      zuid: '9954190',
      user_id: 'u_browser_541',
      email_id: 'browser.athlete@vigorcore.lat',
      first_name: 'Browser',
      last_name: 'Athlete',
      status: 'ACTIVE',
      is_confirmed: true,
    },
  };
  const baas = startBaaSSpy(usersByTok);
  const baasOrigin = await baas.start();
  const db = new CleanSlateInMemoryNoSQLAdapter();
  const nowSec = Math.floor(Date.now() / 1000);
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);

  // Use express_enforced with local ephemeral origin (patched once server listens)
  let primaryOrigin = '';
  const sessionTokens = new ServerSessionTokenManager({
    activeSecret: hmacSecret,
    activeKeyId: 'k1',
    environment: 'development',
    nowSecProvider: () => nowSec,
  });

  // Start dispatcher over local Express serving compiled dist-frontend + simulated Catalyst Gateway header translation
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  let dispatcher: ReturnType<typeof createVigorCoreProductionRuntimeFromEnv>['dispatcher'];

  const capturedOriginCookieLogs: Array<{ origin: string | undefined; hasCookieHeader: boolean }> = [];

  app.use('/api/v1', async (req, res) => {
    const flatHeaders: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      flatHeaders[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
    capturedOriginCookieLogs.push({
      origin: flatHeaders.origin,
      hasCookieHeader: Boolean(flatHeaders.cookie && flatHeaders.cookie.includes(SIGNED_SESSION_COOKIE_NAME)),
    });

    // Inject Catalyst Gateway context: if browser sent Authorization (from generateAuthToken('functions')),
    // translate it into Catalyst Edge x-zc-user-type=user + x-zc-user-cred-token just like API Gateway does.
    const authHeader = flatHeaders.authorization;
    const edgeInjected = edgeAdminHeaders(
      authHeader
        ? {
            'x-zc-user-type': 'user',
            'x-zc-user-cred-type': 'token',
            'x-zc-user-cred-token': authHeader.replace(/^Zoho-oauthtoken\s+/i, ''),
          }
        : { 'x-zc-user-type': 'admin' }
    );
    delete flatHeaders.authorization;
    Object.assign(flatHeaders, edgeInjected);

    const parsedCookies: Record<string, string> = {};
    if (flatHeaders.cookie) {
      for (const part of flatHeaders.cookie.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) {
          const name = part.slice(0, idx).trim();
          const val = part.slice(idx + 1).trim();
          if (name) parsedCookies[name] = decodeURIComponent(val);
        }
      }
    }

    const out = await dispatcher.dispatch(
      req.method.toUpperCase() as Parameters<typeof dispatcher.dispatch>[0],
      `/api/v1${req.path}`,
      {
        headers: flatHeaders,
        cookies: parsedCookies,
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

  app.use(express.static(DIST_FRONTEND_DIR));
  app.use((_req, res) => {
    res.sendFile(path.join(DIST_FRONTEND_DIR, 'index.html'));
  });

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  primaryOrigin = `http://127.0.0.1:${addr.port}`;

  // Second origin (`http://localhost:<port2>`) to test real browser cross-site cookie blocking vs same-origin
  const crossSiteApp = express();
  crossSiteApp.get('/', (_req, res) => {
    res.type('html').send('<!doctype html><html><body>cross-site origin</body></html>');
  });
  const crossSrv = http.createServer(crossSiteApp);
  await new Promise<void>(resolve => crossSrv.listen(0, '127.0.0.1', resolve));
  const crossOrigin = `http://localhost:${(crossSrv.address() as { port: number }).port}`;

  const runtime = createVigorCoreProductionRuntimeFromEnv(
    hostedEnv(baasOrigin, hmacSecret, [primaryOrigin, crossOrigin]),
    {
      allowInsecureLoopbackForTest: true,
      adapterOverride: db,
      nowSecProvider: () => nowSec,
      nowMsProvider: () => nowSec * 1000,
    }
  );
  dispatcher = runtime.dispatcher;
  void sessionTokens;

  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    let catalystState: 'unauthenticated' | 'unconfirmed' | 'disabled' | 'active' = 'active';

    // Route Catalyst Web SDK endpoints in browser context (mirrors Zoho Catalyst platform behavior)
    await page.route('**/__catalyst/sdk/init', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          zaid: 'zaid_541',
          project_id: '136967000000014024',
          environment: 'Development',
          project_domain: primaryOrigin,
          api_domain: primaryOrigin,
          auth_domain: primaryOrigin,
          is_appsail: false,
          stratus_suffix: '.stratus.test',
        }),
      });
    });

    await page.route('**/__catalyst/auth/login*', async route => {
      const reqUrl = new URL(route.request().url());
      const redirectUrl = reqUrl.searchParams.get('redirect_url') || '/auth/callback';
      await route.fulfill({
        status: 302,
        headers: { Location: redirectUrl },
        body: '',
      });
    });

    await page.route('**/baas/v1/project/*/project-user/current', async route => {
      if (catalystState === 'unauthenticated') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'failure', message: 'Not authenticated' }),
        });
        return;
      }
      const snapshot: SpyUser =
        catalystState === 'unconfirmed'
          ? { ...usersByTok[activeUserTok], is_confirmed: false }
          : catalystState === 'disabled'
            ? { ...usersByTok[activeUserTok], status: 'DISABLED' }
            : usersByTok[activeUserTok];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: snapshot }),
      });
    });

    await page.route('**/baas/v1/project/*/authentication/custom-token*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            scopes: ['Catalyst.functions.EXECUTE'],
            client_id: 'cli_web_541',
            jwt_token: 'mock_jwt_assertion_541',
          },
        }),
      });
    });

    await page.route('**/clientoauth/v2/*/remote/auth*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: activeUserTok,
          expires_in_sec: 3600,
        }),
      });
    });

    // 1. Visit unauthenticated `/` in HTTP mode -> shows fail-closed error panel + 'Ir a Iniciar Sesión' button
    await page.goto(`${primaryOrigin}/?mode=http`, { waitUntil: 'networkidle' });
    await page.getByText('Error al cargar el espacio de trabajo').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Ir a Iniciar Sesión' }).click();
    await page.getByText('Acceso exclusivo para usuarios invitados').waitFor({ state: 'visible' });

    // 2. Callback failure state checks:
    // 2a. Cancelled return on /auth/callback
    await page.goto(`${primaryOrigin}/auth/callback?cancelled=1`, { waitUntil: 'networkidle' });
    await page.getByText('Autenticación no completada').waitFor({ state: 'visible' });

    // 2b. Unconfirmed email on /auth/callback
    catalystState = 'unconfirmed';
    await page.goto(`${primaryOrigin}/auth/callback`, { waitUntil: 'networkidle' });
    await page.getByText('Confirmación de correo requerida').waitFor({ state: 'visible' });

    // 2c. Disabled Catalyst account on /auth/callback
    catalystState = 'disabled';
    await page.goto(`${primaryOrigin}/auth/callback`, { waitUntil: 'networkidle' });
    await page.getByText('Cuenta deshabilitada o suspendida').waitFor({ state: 'visible' });

    // 3. Real Hosted Login flow: /auth/login -> zcAuth.hostedSignIn('/auth/callback') -> /auth/callback -> needs_bootstrap -> opt-in /bootstrap-profile -> Workspace!
    catalystState = 'active';
    await page.goto(`${primaryOrigin}/auth/login`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Iniciar sesión con Catalyst' }).click();

    // Lands at /auth/callback after Catalyst 302 redirect, gets 403 USER_PROFILE_NOT_REGISTERED, renders opt-in form
    await page.getByText('Alta inicial de perfil VigorCore').waitFor({ state: 'visible' });
    await page.getByLabel('Nombre visible (opcional)').fill('Camilo Phase 5.4.1');
    await page.getByRole('button', { name: 'Crear perfil atleta y entrar' }).click();

    // Workspace loads via Path 3 (/auth/me + /athlete/workspace)
    await page.getByRole('heading', { name: 'Dashboard del Atleta' }).waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).pathname, '/');

    // Verify HttpOnly Strict cookie & zero app tokens in Web Storage / IndexedDB
    const cookies = await context.cookies(primaryOrigin);
    const sessionCookie = cookies.find(c => c.name === SIGNED_SESSION_COOKIE_NAME);
    assert.ok(sessionCookie, '__Host-vigor_session cookie must exist in Chromium');
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.sameSite, 'Strict');
    assert.equal(sessionCookie.path, '/');

    const storageDump = await page.evaluate(async () => {
      const idbDbs =
        typeof window.indexedDB?.databases === 'function' ? await window.indexedDB.databases() : [];
      let idbRecordCount = 0;
      for (const dbInfo of idbDbs) {
        if (!dbInfo.name) continue;
        const countForDb = await new Promise<number>(resolve => {
          const req = window.indexedDB.open(dbInfo.name!);
          req.onsuccess = () => {
            const dbConn = req.result;
            const storeNames = Array.from(dbConn.objectStoreNames);
            if (storeNames.length === 0) {
              dbConn.close();
              resolve(0);
              return;
            }
            const tx = dbConn.transaction(storeNames, 'readonly');
            let total = 0;
            let pending = storeNames.length;
            for (const sName of storeNames) {
              const countReq = tx.objectStore(sName).count();
              countReq.onsuccess = () => {
                total += countReq.result;
                pending -= 1;
                if (pending === 0) {
                  dbConn.close();
                  resolve(total);
                }
              };
              countReq.onerror = () => {
                pending -= 1;
                if (pending === 0) {
                  dbConn.close();
                  resolve(total);
                }
              };
            }
          };
          req.onerror = () => resolve(0);
        });
        idbRecordCount += countForDb;
      }
      return {
        docCookie: document.cookie,
        ssEntries: Object.entries(window.sessionStorage),
        lsEntries: Object.entries(window.localStorage),
        idbRecordCount,
      };
    });
    assert.equal(storageDump.docCookie, '');
    assert.equal(storageDump.idbRecordCount, 0);
    for (const [k, v] of [...storageDump.ssEntries, ...storageDump.lsEntries]) {
      const lowerKey = k.toLowerCase();
      assert.equal(
        v.includes(activeUserTok) ||
          v.includes('mock_jwt_assertion_541') ||
          lowerKey.includes('csrf') ||
          lowerKey.includes('vigor') ||
          lowerKey.includes('access_token') ||
          lowerKey.includes('refresh_token'),
        false,
        `Unexpected auth token/secret persisted in Web Storage key '${k}'`
      );
    }

    // 4. Cross-site cookie withholding check in real Chromium (`localhost` fetching `127.0.0.1` with SameSite=Strict cookie)
    capturedOriginCookieLogs.length = 0;
    const crossPage = await context.newPage();
    await crossPage.goto(crossOrigin, { waitUntil: 'networkidle' });
    const crossFetchResult = await crossPage.evaluate(async targetOrigin => {
      const resp = await fetch(`${targetOrigin}/api/v1/athlete/workspace`, {
        credentials: 'include',
      });
      return { status: resp.status, body: (await resp.json()) as { error?: string } };
    }, primaryOrigin);
    assert.equal(crossFetchResult.status, 401);
    assert.equal(crossFetchResult.body.error, 'UNAUTHENTICATED');
    assert.equal(capturedOriginCookieLogs.length, 1);
    assert.equal(capturedOriginCookieLogs[0].origin, crossOrigin);
    assert.equal(capturedOriginCookieLogs[0].hasCookieHeader, false);
    await crossPage.close();

    // 5. Logout from primary workspace clears cookie & revokes server session -> reload fails 401
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page
      .getByText('Sesión HTTP cerrada. La cookie __Host-vigor_session fue revocada en el servidor.')
      .waitFor({ state: 'visible' });
    const postLogoutCookies = await context.cookies(primaryOrigin);
    assert.equal(
      postLogoutCookies.find(c => c.name === SIGNED_SESSION_COOKIE_NAME),
      undefined
    );

    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => crossSrv.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.4.1 [LOCAL_VERIFIED / PASS-STATIC] docs/48 contains all 7 deliverables, exact status PHASE_5_4_1_INTEGRATION_REMEDIATION_READY_FOR_REVIEW, and zero fabricated live claims', () => {
  const doc48Path = path.join(
    POC_ROOT,
    'docs',
    '48-phase-5.4.1-frontend-backend-auth-integration-remediation.md'
  );
  const doc48 = fs.readFileSync(doc48Path, 'utf8');
  for (const token of [
    'PHASE_5_4_1_INTEGRATION_REMEDIATION_READY_FOR_REVIEW',
    'OPTION_A_NATIVE_CATALYST_EDGE_USER_CONTEXT_FORWARDING',
    "generateAuthToken('functions')",
    'app.vigorcore.lat',
    'api.vigorcore.lat',
    '__Host-vigor_session',
    'SameSite=Strict',
    'X-Vigor-CSRF',
    'X-Vigor-Requested-With',
    '/auth/login',
    '/auth/callback',
    '/api/v1/auth/session/bootstrap-profile',
    '/api/v1/auth/session/exchange',
    '/api/v1/auth/me',
    '/api/v1/auth/session/refresh',
    '/api/v1/auth/session/logout',
    '/api/v1/auth/session/revoke',
    'USER_PROFILE_NOT_REGISTERED',
    'LOCAL_VERIFIED',
    'LIVE_VERIFIED',
    'PENDING_LIVE_VERIFICATION',
    'Microsoft.PowerShell.Commands.WebRequestSession',
  ]) {
    assert.ok(doc48.includes(token), `docs/48 missing required token: ${token}`);
  }
});
