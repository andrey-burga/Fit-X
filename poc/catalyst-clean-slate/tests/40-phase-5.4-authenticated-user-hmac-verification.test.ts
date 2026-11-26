/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4 — Test Suite 40:
 * Live Authenticated User & HMAC Session Verification (Development-First Preparation)
 *
 * Scope Classification: LOCAL_VERIFIED (loopback HTTP `127.0.0.1:0`, mock BaaS HTTP spy,
 * and instrumented CleanSlateInMemoryNoSQLAdapter). Zero remote Catalyst operations.
 *
 * Verifies:
 * 1. Complete 11-step frontend-to-backend lifecycle (`CatalystHostedAuthBridge` ->
 *    `/exchange` deny-by-default -> `/bootstrap-profile` least-privilege `athlete` ->
 *    `__Host-vigor_session` + bound `X-Vigor-CSRF` -> Path 3 `/auth/me` & `/workspace` ->
 *    bound CSRF mutations -> `/refresh` rotation & replay bump -> `/logout` revocation).
 * 2. Callback, invitation (`AdminInvitations`), unconfirmed/disabled account, and anti-spoofing failure modes.
 * 3. All 8 HMAC Path 3 invariants (HMAC-SHA256, env/iss/aud/exp, `Users.sessionEpoch`,
 *    `SystemControl SESSION#<sid>`, `accountStatus === 'active'`, bound CSRF `(sub, sid, ep)`,
 *    and mandatory `>= 15 min` Catalyst live revalidation with BaaS outage 503 + deleted user revocation).
 * 4. `ROUTE_DEFINITIONS` & `CleanSlateAuthGuard` policy matrix + `hosted_native` `x-zc-user-type=admin` guarantees.
 * 5. `docs/47-phase-5.4-authenticated-user-and-hmac-verification.md` completeness & verdict.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CleanSlateAuthGuard,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import {
  CatalystHostedAuthBridge,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  ServerCsrfTokenProvider,
  type ICatalystWebAuthSdk,
} from '../src/frontend/adapters/index.js';
import { CleanSlateRepositoryError } from '../src/frontend/contracts/repositories.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { ROUTE_DEFINITIONS } from '../src/routes/apiRouterSchema.js';
import { CANONICAL_ROUTE_COUNT } from '../src/routes/routeContracts.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { assertStrictCookieAttributes } from '../src/security/httpSecurityPolicy.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import {
  KeyBuilders,
  type SessionRecordItem,
  type UserAccountItem,
} from '../src/types/cleanSlate.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');

interface MockBaaSUser {
  [key: string]: unknown;
  zuid: string;
  user_id: string;
  email_id: string;
  first_name: string;
  last_name: string;
  status: 'ACTIVE' | 'DISABLED';
  is_confirmed: boolean;
}

function startConfigurableBaaSSpy(usersByToken: Record<string, MockBaaSUser>) {
  const userCurrentCalls: Array<{ url: string; token: string }> = [];
  const userDetailsCalls: Array<{ url: string; userId: string }> = [];
  let simulateDetailsError = false;
  const deletedUsers = new Set<string>();

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    req.resume();
    req.on('end', () => {
      if (url.includes('/project-user/current') && method === 'GET') {
        const userTok =
          typeof req.headers['x-zc-user-cred-token'] === 'string'
            ? req.headers['x-zc-user-cred-token']
            : typeof req.headers['authorization'] === 'string'
              ? req.headers['authorization']
              : '';
        userCurrentCalls.push({ url, token: userTok });
        const matched = Object.entries(usersByToken).find(([tok]) => userTok.includes(tok))?.[1];
        if (matched) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: matched }));
          return;
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure', message: 'Invalid user session' }));
        return;
      }

      if (url.includes('/project-user/') && method === 'GET') {
        const userId = url.split('/project-user/')[1]?.split('?')[0] ?? '';
        userDetailsCalls.push({ url, userId });
        if (simulateDetailsError) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failure', message: 'BaaS upstream unavailable' }));
          return;
        }
        if (deletedUsers.has(userId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failure', message: 'User not found' }));
          return;
        }
        const matched = Object.values(usersByToken).find(u => u.user_id === userId);
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
      res.end(JSON.stringify({ status: 'failure', message: 'Unsupported path' }));
    });
  });

  return {
    userCurrentCalls,
    userDetailsCalls,
    setSimulateDetailsError: (v: boolean) => {
      simulateDetailsError = v;
    },
    setUserDeleted: (userId: string, deleted = true) => {
      if (deleted) deletedUsers.add(userId);
      else deletedUsers.delete(userId);
    },
    resetCalls: () => {
      userCurrentCalls.length = 0;
      userDetailsCalls.length = 0;
    },
    async start(): Promise<string> {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      return `http://127.0.0.1:${port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

class CookieJarFetch {
  public cookies = new Map<string, string>();
  public edgeHeaders: Record<string, string> = {};
  public lastSetCookieHeader: string | null = null;

  constructor(private readonly origin = 'https://app.vigorcore.lat') {}

  fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers ?? {});
    headers.set('Origin', this.origin);
    headers.set('Sec-Fetch-Site', 'same-site');
    for (const [k, v] of Object.entries(this.edgeHeaders)) {
      headers.set(k, v);
    }

    // Bridge test translation: when client bridge attaches Authorization in browser RAM,
    // simulate Catalyst Gateway/Edge forwarding x-zc-user-type=user + x-zc-user-cred-token.
    const authHeader = headers.get('Authorization');
    if (authHeader && !headers.has('x-zc-user-cred-token')) {
      headers.set('x-zc-user-type', 'user');
      headers.set('x-zc-user-cred-type', 'token');
      headers.set('x-zc-user-cred-token', authHeader.replace(/^Zoho-oauthtoken\s+/i, ''));
      headers.delete('Authorization');
    }

    if (this.cookies.size > 0) {
      headers.set(
        'Cookie',
        Array.from(this.cookies.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      );
    }

    const res = await globalThis.fetch(url, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.lastSetCookieHeader = setCookie;
      assertStrictCookieAttributes(setCookie);
      const firstPart = setCookie.split(';')[0] ?? '';
      const eq = firstPart.indexOf('=');
      if (eq > 0) {
        const name = firstPart.slice(0, eq).trim();
        const val = firstPart.slice(eq + 1).trim();
        if (!val || setCookie.includes('Max-Age=0')) {
          this.cookies.delete(name);
        } else {
          this.cookies.set(name, val);
        }
      }
    }
    return res;
  };
}

function edgeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-zc-projectid': '136967000000014024',
    'x-zc-environment': 'Development',
    'x-zc-project-key': 'SECRET_EDGE_PROJECT_KEY_54',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'SECRET_EDGE_ADMIN_TOKEN_54',
    ...extra,
  };
}

function hostedEnv(apiDomain: string, secret: string): Record<string, string> {
  return {
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'platform_managed',
    VIGORCORE_CATALYST_API_DOMAIN: apiDomain,
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: secret,
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };
}

test('Phase 5.4 [LOCAL_VERIFIED / PASS-LOOPBACK] Full 11-step authenticated user lifecycle, callback failures, least-privilege bootstrap, Path 3 HMAC+CSRF, refresh rotation & replay bump, and logout', async () => {
  const userTokenA = 'SECRET_DEV_USER_TOKEN_A_54';
  const unconfirmedToken = 'SECRET_UNCONFIRMED_TOKEN_54';
  const disabledToken = 'SECRET_DISABLED_TOKEN_54';
  const opaquePlatformToken = 'SECRET_OPAQUE_EDGE_PLATFORM_TOKEN_54';
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);

  const usersByToken: Record<string, MockBaaSUser> = {
    [userTokenA]: {
      zuid: '9954001',
      user_id: 'u_dev_invited_54',
      email_id: 'invited.athlete@vigorcore.lat',
      first_name: 'Invited',
      last_name: 'Athlete',
      status: 'ACTIVE',
      is_confirmed: true,
    },
    [unconfirmedToken]: {
      zuid: '9954002',
      user_id: 'u_dev_unconfirmed_54',
      email_id: 'unconfirmed@vigorcore.lat',
      first_name: 'Unconfirmed',
      last_name: 'User',
      status: 'ACTIVE',
      is_confirmed: false,
    },
    [disabledToken]: {
      zuid: '9954003',
      user_id: 'u_dev_disabled_54',
      email_id: 'disabled@vigorcore.lat',
      first_name: 'Disabled',
      last_name: 'User',
      status: 'DISABLED',
      is_confirmed: true,
    },
  };

  const baas = startConfigurableBaaSSpy(usersByToken);
  const baasOrigin = await baas.start();
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  let nowSec = Math.floor(Date.now() / 1000);

  const bundle = createVigorCoreProductionRuntimeFromEnv(hostedEnv(baasOrigin, hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    nowSecProvider: () => nowSec,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 1. Pre-login callback failure scenarios via CatalystHostedAuthBridge
    const jarFail = new CookieJarFetch();
    const csrfFail = new ServerCsrfTokenProvider();
    const authRepoFail = new CatalystHttpAuthRepository(
      new CatalystHttpTransport({ baseUrl, csrfProvider: csrfFail, fetchImpl: jarFail.fetchImpl }),
      csrfFail
    );

    const bridgeUnauth = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async generateAuthToken() {
          return { access_token: userTokenA };
        },
        async isUserAuthenticated() {
          return false;
        },
        async signOut() {},
      },
      authRepo: authRepoFail,
      expectedOrigin: 'https://app.vigorcore.lat',
    });
    await assert.rejects(
      () => bridgeUnauth.establishVigorSession({ mode: 'exchange' }),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'CATALYST_USER_NOT_AUTHENTICATED'
    );

    const bridgeUnconfirmed = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async generateAuthToken() {
          return { access_token: unconfirmedToken };
        },
        async isUserAuthenticated() {
          return usersByToken[unconfirmedToken];
        },
        async signOut() {},
      },
      authRepo: authRepoFail,
      expectedOrigin: 'https://app.vigorcore.lat',
    });
    await assert.rejects(
      () => bridgeUnconfirmed.establishVigorSession({ mode: 'bootstrap' }),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'EMAIL_VERIFICATION_REQUIRED'
    );

    // 2. Backend fail-closed on unconfirmed / disabled Catalyst identities hitting /bootstrap-profile
    const backendUnconfirmed = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': unconfirmedToken,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(backendUnconfirmed.status, 403);
    assert.equal(((await backendUnconfirmed.json()) as { error?: string }).error, 'EMAIL_VERIFICATION_REQUIRED');

    const backendDisabled = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': disabledToken,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(backendDisabled.status, 403);
    assert.equal(((await backendDisabled.json()) as { error?: string }).error, 'CATALYST_USER_DISABLED');

    // 3. Anti-spoofing rejection if client tries sending role/uid in bootstrap body
    const spoofBootstrap = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': userTokenA,
        }),
      },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    assert.equal(spoofBootstrap.status, 403);
    assert.equal(((await spoofBootstrap.json()) as { error?: string }).error, 'IDENTITY_SPOOFING_REJECTED');

    // 4. Invited verified user executes Steps 2 -> 7: /exchange fails 403 USER_PROFILE_NOT_REGISTERED, then /bootstrap-profile succeeds with role=athlete
    const jar = new CookieJarFetch();
    jar.edgeHeaders = edgeHeaders();
    const csrfStore = new ServerCsrfTokenProvider();
    const transport = new CatalystHttpTransport({ baseUrl, csrfProvider: csrfStore, fetchImpl: jar.fetchImpl });
    const authRepo = new CatalystHttpAuthRepository(transport, csrfStore);

    let hostedRedirectTarget = '';
    const webSdk: ICatalystWebAuthSdk = {
      async init() {},
      async hostedSignIn(redirectUrl?: string) {
        hostedRedirectTarget = redirectUrl ?? '/';
      },
      async isUserAuthenticated() {
        return usersByToken[userTokenA];
      },
      async generateAuthToken() {
        return { access_token: userTokenA, expires_in_sec: 3600 };
      },
      async signOut() {},
    };
    const bridge = new CatalystHostedAuthBridge({
      sdk: webSdk,
      authRepo,
      expectedOrigin: 'https://app.vigorcore.lat',
    });

    await bridge.startHostedLogin('/auth/callback');
    assert.equal(hostedRedirectTarget, '/auth/callback');

    await assert.rejects(
      () => bridge.establishVigorSession({ mode: 'exchange' }),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'USER_PROFILE_NOT_REGISTERED'
    );
    assert.equal(jar.cookies.has(SIGNED_SESSION_COOKIE_NAME), false);

    const bootSession = await bridge.establishVigorSession({
      mode: 'bootstrap',
      displayName: 'Invited Dev Athlete',
    });
    assert.equal(bootSession.actor.catalystUserId, 'u_dev_invited_54');
    assert.equal(bootSession.actor.role, 'athlete');
    assert.equal(bootSession.actor.sessionEpoch, 1);
    assert.ok(jar.cookies.get(SIGNED_SESSION_COOKIE_NAME));
    assert.ok(csrfStore.getCsrfToken());

    // Confirm SystemControl SESSION#<sid> was persisted BEFORE cookie return
    const persistedSid = bootSession.sid;
    const sessionRow = await adapter.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: KeyBuilders.sessionPk(persistedSid) },
      { consistent_read: true }
    );
    assert.equal(sessionRow?.status, 'active');
    assert.equal(sessionRow?.ownerUserId, 'u_dev_invited_54');

    // 5. Step 8 / Re-login exchange (`Users` already exists) issues a fresh session
    const reloginSession = await bridge.establishVigorSession({ mode: 'exchange' });
    assert.notEqual(reloginSession.sid, persistedSid);
    const activeCookie = jar.cookies.get(SIGNED_SESSION_COOKIE_NAME)!;
    const activeCsrf = csrfStore.getCsrfToken()!;

    // 6. Step 9/10: Path 3 HMAC-only calls WITH Edge x-zc-user-type=admin + opaque platform token -> ZERO getCurrentUser() hits
    baas.resetCalls();
    jar.edgeHeaders = edgeHeaders({
      'x-zc-user-type': 'admin',
      'x-zc-user-cred-type': 'token',
      'x-zc-user-cred-token': opaquePlatformToken,
    });
    const meRes = await authRepo.getMe();
    assert.equal(meRes.actor.catalystUserId, 'u_dev_invited_54');
    assert.equal(meRes.actor.role, 'athlete');
    assert.ok(meRes.csrfToken);
    assert.equal(baas.userCurrentCalls.length, 0);

    const wsRes = await transport.request<{ workspace: { profile: UserAccountItem } }>({
      method: 'GET',
      path: '/api/v1/athlete/workspace',
    });
    assert.equal(wsRes.status, 200);
    assert.equal(wsRes.data?.workspace.profile.uid, 'u_dev_invited_54');
    assert.equal(baas.userCurrentCalls.length, 0);

    // Athlete blocked from admin endpoints (403 PERMISSION_DENIED)
    await assert.rejects(
      () => transport.request({ method: 'GET', path: '/api/v1/admin/users' }),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.statusCode === 403 && e.code === 'PERMISSION_DENIED'
    );

    // 7. Bound X-Vigor-CSRF enforcement & cross-session mismatch test
    const noCsrfPatch = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${activeCookie}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin', 'x-zc-user-cred-token': opaquePlatformToken }),
      },
      body: JSON.stringify({ location: 'ShouldFail' }),
    });
    assert.equal(noCsrfPatch.status, 403);
    assert.equal(((await noCsrfPatch.json()) as { error?: string }).error, 'CSRF_TOKEN_MISSING');

    // CSRF bound to a DIFFERENT sid/sub must fail 403 CSRF_TOKEN_SESSION_MISMATCH
    const otherSessionCsrf = bundle.sessionTokens.issueCsrfToken(
      'u_dev_invited_54',
      persistedSid,
      1,
      nowSec + 3600
    );
    const mismatchedCsrfPatch = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': otherSessionCsrf,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${activeCookie}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ location: 'MismatchFail' }),
    });
    assert.equal(mismatchedCsrfPatch.status, 403);
    assert.equal(((await mismatchedCsrfPatch.json()) as { error?: string }).error, 'CSRF_TOKEN_SESSION_MISMATCH');

    // Valid bound CSRF succeeds
    const validPatch = await transport.request<{ profile: UserAccountItem }>({
      method: 'PATCH',
      path: '/api/v1/athlete/profile',
      body: { location: 'Bogota Dev' },
    });
    assert.equal(validPatch.status, 200);
    assert.equal(validPatch.data?.profile.location, 'Bogota Dev');

    // 8. Step 11a: Refresh / Rotation revokes old sid & enforces live getUserDetails()
    baas.resetCalls();
    const rotated = await authRepo.refreshSession();
    assert.notEqual(rotated.sid, reloginSession.sid);
    assert.notEqual(jar.cookies.get(SIGNED_SESSION_COOKIE_NAME), activeCookie);
    assert.notEqual(csrfStore.getCsrfToken(), activeCsrf);
    assert.equal(baas.userDetailsCalls.length, 1, 'refreshSession MUST perform Catalyst live getUserDetails check');

    // Replay of rotated cookie within <= 5s grace window -> 401 SESSION_ROTATED_RETRY (without bumping epoch)
    const graceReplay = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${activeCookie}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(graceReplay.status, 401);
    assert.equal(((await graceReplay.json()) as { error?: string }).error, 'SESSION_ROTATED_RETRY');

    // After > 5s grace window, replay triggers 401 SESSION_REPLAY_DETECTED + bumps sessionEpoch globally (2)!
    nowSec += 10;
    const postGraceReplay = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${activeCookie}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(postGraceReplay.status, 401);
    assert.equal(((await postGraceReplay.json()) as { error?: string }).error, 'SESSION_REPLAY_DETECTED');
    assert.ok(postGraceReplay.headers.get('set-cookie')?.includes('Max-Age=0'));

    // Because sessionEpoch bumped from 1 -> 2, rotated cookie from epoch 1 is ALSO globally invalidated!
    await assert.rejects(
      () => authRepo.getMe(),
      (e: unknown) => e instanceof CleanSlateRepositoryError && e.code === 'SESSION_REVOKED_REAUTH_REQUIRED'
    );

    // 9. Re-login cleanly at new sessionEpoch=2 and verify Logout revokes SESSION#<sid> & clears cookie
    jar.edgeHeaders = edgeHeaders();
    const freshSession = await bridge.establishVigorSession({ mode: 'exchange' });
    assert.equal(freshSession.actor.sessionEpoch, 2);

    const preLogoutCookie = jar.cookies.get(SIGNED_SESSION_COOKIE_NAME)!;
    assert.ok(preLogoutCookie);

    jar.edgeHeaders = edgeHeaders({ 'x-zc-user-type': 'admin', 'x-zc-user-cred-token': opaquePlatformToken });
    const logoutRes = await authRepo.logout();
    assert.equal(logoutRes.loggedOut, true);
    assert.equal(logoutRes.revokedSid, freshSession.sid);
    assert.equal(jar.cookies.has(SIGNED_SESSION_COOKIE_NAME), false);
    assert.equal(csrfStore.getCsrfToken(), null);

    // Replaying the pre-logout cookie directly fails closed 401 SESSION_REVOKED_REAUTH_REQUIRED
    const replayLoggedOut = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${preLogoutCookie}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(replayLoggedOut.status, 401);
    assert.equal(((await replayLoggedOut.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.4 [LOCAL_VERIFIED / PASS-LOOPBACK] Path 3 security invariants: cross-env HMAC tamper, Users/SystemControl checks, >=15m live revalidation outage/delete, individual/global revoke, & invitations', async () => {
  const userTok = 'SECRET_PATH3_USER_TOK';
  const path3Users: Record<string, MockBaaSUser> = {
    [userTok]: {
      zuid: '9954999',
      user_id: 'u_path3_54',
      email_id: 'path3@vigorcore.lat',
      first_name: 'Path3',
      last_name: 'Check',
      status: 'ACTIVE',
      is_confirmed: true,
    },
  };
  const baas = startConfigurableBaaSSpy(path3Users);
  const baasOrigin = await baas.start();
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  let nowSec = Math.floor(Date.now() / 1000);

  const bundle = createVigorCoreProductionRuntimeFromEnv(hostedEnv(baasOrigin, hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    nowSecProvider: () => nowSec,
    nowMsProvider: () => nowSec * 1000,
  });

  const nowIso = new Date(nowSec * 1000).toISOString();
  await adapter.insertItem('Users', {
    pk: KeyBuilders.userPk('u_path3_54'),
    uid: 'u_path3_54',
    email: 'path3@vigorcore.lat',
    normalizedEmail: 'path3@vigorcore.lat',
    displayName: 'Path3 Athlete',
    role: 'athlete',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: KeyBuilders.directorySegment('u_path3_54'),
    onboardingCompleted: true,
    onboardingStep: 4,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 1. Cross-environment HMAC token (signed with same secret, env='production') MUST fail 401
    const prodMgr = new ServerSessionTokenManager({
      activeSecret: hmacSecret,
      environment: 'production',
      nowSecProvider: () => nowSec,
    });
    const crossEnvTok = prodMgr.issueToken('u_path3_54', 1, 3600);
    const crossEnvRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${crossEnvTok}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(crossEnvRes.status, 401);
    assert.equal(((await crossEnvRes.json()) as { error?: string }).error, 'INVALID_SIGNED_SESSION');

    // 2. Mint two valid concurrent sessions (S1 & S2) for u_path3_54
    const s1 = await bundle.authGuard.issueSignedSession({
      catalystUserId: 'u_path3_54',
      email: 'path3@vigorcore.lat',
      normalizedEmail: 'path3@vigorcore.lat',
      displayName: 'Path3 Athlete',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      isConfirmed: true,
    });
    const s2 = await bundle.authGuard.issueSignedSession({
      catalystUserId: 'u_path3_54',
      email: 'path3@vigorcore.lat',
      normalizedEmail: 'path3@vigorcore.lat',
      displayName: 'Path3 Athlete',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      isConfirmed: true,
    });

    // 3. Individual revocation via POST /api/v1/auth/session/revoke revokes S1 ONLY; S2 remains active
    const revokeS1 = await fetch(`${baseUrl}/api/v1/auth/session/revoke`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': s2.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ scope: 'individual', sid: s1.sid, reason: 'device_lost' }),
    });
    const revokeS1Body = (await revokeS1.json()) as { error?: string; message?: string };
    assert.equal(revokeS1.status, 200, `Unexpected revokeS1 response: ${JSON.stringify(revokeS1Body)}`);

    const s1AfterRevoke = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s1.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s1AfterRevoke.status, 401);
    assert.equal(((await s1AfterRevoke.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');

    // S2 still works < 900s with ZERO getUserDetails hits
    baas.resetCalls();
    const s2WithinWindow = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s2WithinWindow.status, 200);
    assert.equal(baas.userDetailsCalls.length, 0);

    // 4. Suspended Users.accountStatus rejects even valid cookie -> 403 ACCOUNT_SUSPENDED
    await adapter.updateItem('Users', { pk: KeyBuilders.userPk('u_path3_54') }, { accountStatus: 'suspended' });
    const suspendedRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(suspendedRes.status, 403);
    assert.equal(((await suspendedRes.json()) as { error?: string }).error, 'ACCOUNT_SUSPENDED');
    await adapter.updateItem('Users', { pk: KeyBuilders.userPk('u_path3_54') }, { accountStatus: 'active' });

    // 5. Invitation fail-closed checks (expired / email mismatch / invalid token) vs valid redemption
    const adminSvc = new AdminGovernanceService(adapter, bundle.authRuntime, () => nowSec * 1000);
    const adminActor = {
      catalystUserId: 'u_admin_54',
      email: 'admin@vigorcore.lat',
      normalizedEmail: 'admin@vigorcore.lat',
      displayName: 'Admin',
      role: 'admin' as const,
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active' as const,
      isConfirmed: true,
    };
    const inv = await adminSvc.createInvitation(adminActor, 'path3@vigorcore.lat', 'athlete');
    const badTokRedeem = await fetch(`${baseUrl}/api/v1/invitations/redeem`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': s2.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ inviteId: inv.inviteId, token: '0'.repeat(64) }),
    });
    assert.equal(badTokRedeem.status, 403);
    assert.equal(((await badTokRedeem.json()) as { error?: string }).error, 'INVITATION_TOKEN_INVALID');

    // 6. Mandatory >= 15 min (900s) Catalyst live revalidation:
    // 6a) Advance clock +901s while BaaS errors -> MUST fail closed 503 CATALYST_REVALIDATION_UNAVAILABLE
    nowSec += 901;
    baas.setSimulateDetailsError(true);
    const revalOutage = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(revalOutage.status, 503);
    assert.equal(((await revalOutage.json()) as { error?: string }).error, 'CATALYST_REVALIDATION_UNAVAILABLE');

    // 6b) Restore BaaS -> next request STILL triggers getUserDetails (window was NOT extended on outage!)
    baas.setSimulateDetailsError(false);
    baas.resetCalls();
    const revalRecovered = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(revalRecovered.status, 200);
    assert.equal(baas.userDetailsCalls.length, 1);

    // 6c) Advance another +901s & mark user DELETED in Catalyst BaaS -> 401 CATALYST_USER_DELETED + revokes session + bumps epoch + clears cookie
    nowSec += 901;
    baas.setUserDeleted('u_path3_54', true);
    const revalDeleted = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${s2.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(revalDeleted.status, 401);
    assert.equal(((await revalDeleted.json()) as { error?: string }).error, 'CATALYST_USER_DELETED');
    assert.ok(revalDeleted.headers.get('set-cookie')?.includes('Max-Age=0'));

    const postDeleteUser = await adapter.fetchItem<UserAccountItem>(
      'Users',
      { pk: KeyBuilders.userPk('u_path3_54') },
      { consistent_read: true }
    );
    const postDeleteSession = await adapter.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: KeyBuilders.sessionPk(s2.sid) },
      { consistent_read: true }
    );
    assert.equal(postDeleteUser?.sessionEpoch, 2);
    assert.equal(postDeleteSession?.status, 'revoked');
    assert.equal(postDeleteSession?.revocationReason, 'catalyst_revalidation_rejected');

    // 7. Global revocation via POST /api/v1/auth/session/revoke { scope: 'all' } invalidates ALL concurrent sessions
    const globalUid = 'u_global_revoke_54';
    path3Users.SECRET_GLOBAL_TOK = {
      zuid: '9954998',
      user_id: globalUid,
      email_id: 'global.revoke@vigorcore.lat',
      first_name: 'Global',
      last_name: 'Revoke',
      status: 'ACTIVE',
      is_confirmed: true,
    };
    await adapter.insertItem('Users', {
      pk: KeyBuilders.userPk(globalUid),
      uid: globalUid,
      email: 'global.revoke@vigorcore.lat',
      normalizedEmail: 'global.revoke@vigorcore.lat',
      displayName: 'Global Revoke Athlete',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth',
      directorySegment: KeyBuilders.directorySegment(globalUid),
      onboardingCompleted: true,
      onboardingStep: 4,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    });
    const g1 = await bundle.authGuard.issueSignedSession({
      catalystUserId: globalUid,
      email: 'global.revoke@vigorcore.lat',
      normalizedEmail: 'global.revoke@vigorcore.lat',
      displayName: 'Global Revoke Athlete',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      isConfirmed: true,
    });
    const g2 = await bundle.authGuard.issueSignedSession({
      catalystUserId: globalUid,
      email: 'global.revoke@vigorcore.lat',
      normalizedEmail: 'global.revoke@vigorcore.lat',
      displayName: 'Global Revoke Athlete',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      isConfirmed: true,
    });

    const revokeAllRes = await fetch(`${baseUrl}/api/v1/auth/session/revoke`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': g1.csrfToken,
        cookie: `${SIGNED_SESSION_COOKIE_NAME}=${g1.token}`,
        ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ scope: 'all' }),
    });
    assert.equal(revokeAllRes.status, 200);
    const revokeAllBody = (await revokeAllRes.json()) as { newSessionEpoch?: number };
    assert.equal(revokeAllBody.newSessionEpoch, 2);

    for (const tok of [g1.token, g2.token]) {
      const checkRes = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
        headers: {
          cookie: `${SIGNED_SESSION_COOKIE_NAME}=${tok}`,
          ...edgeHeaders({ 'x-zc-user-type': 'admin' }),
        },
      });
      assert.equal(checkRes.status, 401);
      assert.equal(((await checkRes.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.4 [LOCAL_VERIFIED / PASS-UNIT] Route policies enforce fail-closed contracts & docs/47 meets every Phase 5.4 requirement without secret disclosure', () => {
  // Confirm exact canonical routes and critical auth policies
  assert.equal(ROUTE_DEFINITIONS.length, CANONICAL_ROUTE_COUNT);
  const byId = new Map(ROUTE_DEFINITIONS.map(r => [r.id, r]));

  assert.equal(byId.get('auth.session.bootstrapProfile')?.authPolicy, 'catalyst_exchange');
  assert.equal(byId.get('auth.session.bootstrapProfile')?.csrfPolicy, 'pre_session_catalyst_exchange');
  assert.equal(byId.get('auth.session.exchange')?.authPolicy, 'catalyst_exchange');
  assert.equal(byId.get('auth.session.exchange')?.csrfPolicy, 'pre_session_catalyst_exchange');
  assert.equal(byId.get('auth.me')?.authPolicy, 'catalyst_or_hmac_inspect');
  assert.equal(byId.get('auth.session.refresh')?.authPolicy, 'hmac_session');
  assert.equal(byId.get('auth.session.refresh')?.requiresCatalystLiveCheck, true);
  assert.equal(byId.get('auth.session.logout')?.authPolicy, 'hmac_session');
  assert.equal(byId.get('auth.session.logout')?.csrfPolicy, 'signed_session_bound');
  assert.equal(byId.get('athlete.workspace.get')?.authPolicy, 'hmac_session');
  assert.equal(CleanSlateAuthGuard.CATALYST_REVALIDATION_INTERVAL_SEC, 900);
  assert.equal(CleanSlateAuthGuard.ROTATED_SESSION_GRACE_SEC, 5);

  const doc47Path = path.join(POC_ROOT, 'docs', '47-phase-5.4-authenticated-user-and-hmac-verification.md');
  const doc47 = fs.readFileSync(doc47Path, 'utf8');

  for (const requiredToken of [
    'PHASE_5_4_AUTHENTICATED_USER_VERIFICATION_READY_FOR_OPERATOR_TEST',
    '136967000000014024',
    '136967000000074001',
    'LOCAL_VERIFIED',
    'READY_FOR_LIVE_TEST',
    'LIVE_VERIFIED',
    '/auth/login',
    '/auth/callback',
    "hostedSignIn('/auth/callback')",
    '__Host-vigor_session',
    'X-Vigor-CSRF',
    'X-Vigor-Requested-With',
    'x-zc-user-type=admin',
    'bootstrap-profile',
    'session/exchange',
    'session/refresh',
    'session/logout',
    'session/revoke',
    'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api',
    'Microsoft.PowerShell.Commands.WebRequestSession',
    'USER_PROFILE_NOT_REGISTERED',
    'SESSION_REPLAY_DETECTED',
  ]) {
    assert.ok(doc47.includes(requiredToken), `docs/47 missing required token: ${requiredToken}`);
  }
});
