/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.2, Stage 2 — Test Suite 22:
 * Validates the Hosted Login + Modelo B exchange bridge (`CatalystHostedAuthBridge`),
 * open-redirect rejection, RAM-only ephemeral token lifecycle (zero browser storage),
 * real loopback Express integration (`bootstrapProfile` -> `__Host-vigor_session` + `X-Vigor-CSRF`
 * -> `getMe` -> `refreshSession` -> `logoutAll`), controlled `AdminInvitations` onboarding with
 * Public Signup disabled, anti-admin-header-spoofing (`403 CATALYST_ADMIN_HEADER_SPOOFED`),
 * and complete documentation parity in `docs/30-phase-5.2-stage-2-native-auth-runbook.md`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { HostedNativeCatalystAuthRuntime } from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import {
  CatalystHostedAuthBridge,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  resolveSafeSameOriginRedirect,
  ServerCsrfTokenProvider,
  type ICatalystWebAuthSdk,
} from '../src/frontend/adapters/index.js';
import { CleanSlateRepositoryError } from '../src/frontend/contracts/repositories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function createLoopbackEnv(hmacSecret: string) {
  return {
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    CATALYST_PROJECT_KEY: 'proj_key_loopback_stage2_test',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_API_DOMAIN: 'http://127.0.0.1:19999',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'http://127.0.0.1:19998',
    CATALYST_ADMIN_CLIENT_ID: '1000.TEST_CLIENT',
    CATALYST_ADMIN_CLIENT_SECRET: 'client_secret_must_never_leak',
    CATALYST_ADMIN_REFRESH_TOKEN: 'refresh_token_must_never_leak',
    VIGOR_SESSION_HMAC_SECRET: hmacSecret,
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };
}

class LoopbackCookieJarFetch {
  private readonly cookies = new Map<string, string>();
  public readonly capturedRequests: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
  }> = [];

  constructor(private readonly origin = 'https://app.vigorcore.lat') {}

  fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers ?? {});
    headers.set('Origin', this.origin);
    headers.set('Sec-Fetch-Site', 'same-site');
    if (this.cookies.size > 0) {
      const cookieHeader = Array.from(this.cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      headers.set('Cookie', cookieHeader);
    }

    const headerRecord: Record<string, string> = {};
    headers.forEach((v, k) => {
      headerRecord[k.toLowerCase()] = v;
    });
    this.capturedRequests.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: headerRecord,
    });

    const response = await globalThis.fetch(url, {
      ...init,
      headers,
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const firstPart = setCookie.split(';')[0] ?? '';
      const eq = firstPart.indexOf('=');
      if (eq > 0) {
        const name = firstPart.slice(0, eq).trim();
        const val = firstPart.slice(eq + 1).trim();
        if (val === '' || setCookie.includes('Max-Age=0')) {
          this.cookies.delete(name);
        } else {
          this.cookies.set(name, val);
        }
      }
    }

    return response;
  };

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

test('Phase 5.2 Stage 2 [PASS-UNIT] resolveSafeSameOriginRedirect enforces same-origin callbacks and blocks open redirects', () => {
  const origin = 'https://app.vigorcore.lat';
  assert.equal(resolveSafeSameOriginRedirect(undefined, origin), '/auth/callback');
  assert.equal(
    resolveSafeSameOriginRedirect('/auth/callback?step=1', origin),
    '/auth/callback?step=1'
  );
  assert.equal(
    resolveSafeSameOriginRedirect('https://app.vigorcore.lat/auth/callback#done', origin),
    '/auth/callback#done'
  );

  for (const evil of [
    'https://evil.example/phish',
    'http://app.vigorcore.lat/auth/callback',
    '//evil.example/callback',
    'javascript:alert(1)',
    '/auth/callback\r\nX-Inject: 1',
    '',
  ]) {
    assert.throws(
      () => resolveSafeSameOriginRedirect(evil, origin),
      err => err instanceof CleanSlateRepositoryError
    );
  }
});

test('Phase 5.2 Stage 2 [PASS-UNIT] CatalystHostedAuthBridge enforces iFrame Disabled and /auth/login initiator vs /auth/callback separation', async () => {
  const { NATIVE_HOSTED_AUTH_PROFILE } = await import('../src/frontend/adapters/index.js');
  assert.deepEqual(NATIVE_HOSTED_AUTH_PROFILE, {
    authMode: 'hosted_login',
    publicSignup: 'disabled',
    socialLogin: 'disabled',
    thirdPartyAuth: 'unconfigured',
    customUserValidation: 'disabled',
    cors: 'enabled',
    iframe: 'disabled',
    initiatorPath: '/auth/login',
    callbackPath: '/auth/callback',
  });

  const csrfStore = new ServerCsrfTokenProvider();
  const dummyAuthRepo = new CatalystHttpAuthRepository(
    new CatalystHttpTransport({
      baseUrl: 'https://api.example.test',
      csrfProvider: csrfStore,
      fetchImpl: (async () => new Response('{}', { status: 401 })) as typeof fetch,
    }),
    csrfStore
  );
  const bridge = new CatalystHostedAuthBridge({
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
    authRepo: dummyAuthRepo,
    expectedOrigin: 'https://app.vigorcore.lat',
  });

  await assert.rejects(
    () => bridge.startHostedLogin('/auth/login'),
    (err: unknown) =>
      err instanceof CleanSlateRepositoryError && err.code === 'INVALID_HOSTED_CALLBACK_PATH'
  );

  // Simulate framed execution (iFrame: Disabled must reject fail-closed)
  const prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { self: {}, top: {} };
  try {
    await assert.rejects(
      () => bridge.startHostedLogin('/auth/callback'),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError &&
        err.code === 'HOSTED_LOGIN_IFRAME_FORBIDDEN' &&
        err.statusCode === 403
    );
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }
});

test('Phase 5.2 Stage 2 [PASS-LOOPBACK] Hosted Login + generateAuthToken("functions") + Modelo B session lifecycle over real Express server', async () => {
  let nowSec = 1_760_100_000;
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();

  authRuntime.setCurrentUser({
    zuid: 'z_stage2_1',
    user_id: 'u_stage2_1',
    email_id: 'atleta.stage2@vigorcore.lat',
    status: 'ACTIVE',
    is_confirmed: true,
    first_name: 'Camila',
    last_name: 'Rojas',
  });

  const bundle = createVigorCoreProductionRuntimeFromEnv(createLoopbackEnv(hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    authRuntimeOverride: authRuntime,
    nowSecProvider: () => nowSec,
    nowMsProvider: () => nowSec * 1000,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const cookieJarFetch = new LoopbackCookieJarFetch('https://app.vigorcore.lat');
    const csrfStore = new ServerCsrfTokenProvider();
    const transport = new CatalystHttpTransport({
      baseUrl,
      csrfProvider: csrfStore,
      fetchImpl: cookieJarFetch.fetchImpl,
    });
    const authRepo = new CatalystHttpAuthRepository(transport, csrfStore);

    const hostedRedirects: string[] = [];
    const signOutRedirects: string[] = [];
    let generateTokenCalls = 0;

    const mockWebSdk: ICatalystWebAuthSdk = {
      async init() {},
      async hostedSignIn(redirectUrl?: string) {
        hostedRedirects.push(redirectUrl ?? '/');
      },
      async isUserAuthenticated() {
        return {
          user_id: 'u_stage2_1',
          email_id: 'atleta.stage2@vigorcore.lat',
          status: 'ACTIVE',
          is_confirmed: true,
        };
      },
      async generateAuthToken(feature: 'functions') {
        assert.equal(feature, 'functions');
        generateTokenCalls++;
        return { access_token: 'ephemeral_functions_tok_1h_ram_only', expires_in_sec: 3600 };
      },
      async signOut(redirectUrl?: string) {
        signOutRedirects.push(redirectUrl ?? '/');
      },
    };

    const bridge = new CatalystHostedAuthBridge({
      sdk: mockWebSdk,
      authRepo,
      expectedOrigin: 'https://app.vigorcore.lat',
      authorizationFormat: 'raw',
    });

    // 1. Hosted login delegates cleanly without iframe DOM mutation
    const callbackPath = await bridge.startHostedLogin('/auth/callback');
    assert.equal(callbackPath, '/auth/callback');
    assert.deepEqual(hostedRedirects, ['/auth/callback']);

    // 2. Pre-session bootstrap uses ephemeral generateAuthToken('functions') + X-Vigor-Requested-With
    const session = await bridge.establishVigorSession({
      mode: 'bootstrap',
      displayName: 'Camila Rojas',
    });
    assert.equal(generateTokenCalls, 1);
    assert.equal(session.actor.role, 'athlete');
    assert.ok(session.sid);
    assert.ok(csrfStore.hasToken());
    assert.ok(cookieJarFetch.getCookie(SIGNED_SESSION_COOKIE_NAME));

    const bootstrapReq = cookieJarFetch.capturedRequests.find(r =>
      r.url.endsWith('/api/v1/auth/session/bootstrap-profile')
    );
    assert.ok(bootstrapReq);
    assert.equal(bootstrapReq.headers['x-vigor-requested-with'], 'VigorCore-CleanSlate');
    assert.equal(bootstrapReq.headers.authorization, 'ephemeral_functions_tok_1h_ram_only');

    // 3. Post-exchange GET /me & POST /refresh operate solely on __Host-vigor_session + X-Vigor-CSRF (no Authorization)
    const me = await authRepo.getMe();
    assert.equal(me.actor.catalystUserId, 'u_stage2_1');
    const meReq = cookieJarFetch.capturedRequests.find(r => r.url.endsWith('/api/v1/auth/me'));
    assert.ok(meReq);
    assert.equal(meReq.headers.authorization, undefined);

    nowSec += 60;
    const rotated = await authRepo.refreshSession();
    assert.notEqual(rotated.sid, session.sid);
    assert.notEqual(rotated.csrfToken, session.csrfToken);

    const refreshReq = cookieJarFetch.capturedRequests.find(r =>
      r.url.endsWith('/api/v1/auth/session/refresh')
    );
    assert.ok(refreshReq);
    assert.equal(refreshReq.headers.authorization, undefined);
    assert.equal(refreshReq.headers['x-vigor-csrf'], session.csrfToken);

    // 4. Logout revokes backend SESSION#<sid>, clears CSRF & cookie, and invokes sdk.signOut('/auth/login')
    const logoutRedirect = await bridge.logoutAll('/auth/login');
    assert.equal(logoutRedirect, '/auth/login');
    assert.deepEqual(signOutRedirects, ['/auth/login']);
    assert.equal(csrfStore.hasToken(), false);
    assert.equal(cookieJarFetch.getCookie(SIGNED_SESSION_COOKIE_NAME), undefined);

    // 5. After logout, signed-session routes (/athlete/workspace) fail closed 401 immediately;
    //    clearing origin Catalyst session also causes /auth/me to fail closed 401.
    await assert.rejects(
      () => transport.request({ method: 'GET', path: '/api/v1/athlete/workspace' }),
      (err: unknown) => err instanceof CleanSlateRepositoryError && err.statusCode === 401
    );
    authRuntime.setCurrentUser(null);
    await assert.rejects(
      () => authRepo.getMe(),
      (err: unknown) => err instanceof CleanSlateRepositoryError && err.statusCode === 401
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.2 Stage 2 [PASS-LOOPBACK] Public Signup disabled onboarding: unconfirmed blocked, AdminInvitations atomic redeem upgrades role, superadmin route absent', async () => {
  const nowSec = 1_760_200_000;
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();

  const bundle = createVigorCoreProductionRuntimeFromEnv(createLoopbackEnv(hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    authRuntimeOverride: authRuntime,
    nowSecProvider: () => nowSec,
    nowMsProvider: () => nowSec * 1000,
  });

  // Bootstrap founder account in Users first, then run offline CLI superadmin promotion
  authRuntime.setCurrentUser({
    zuid: 'z_super_2',
    user_id: 'u_super_stage2',
    email_id: 'founder@vigorcore.lat',
    status: 'ACTIVE',
    is_confirmed: true,
    first_name: 'Founder',
    last_name: 'Vigor',
  });
  await bundle.authGuard.bootstrapAuthenticatedProfile({ body: { displayName: 'Founder Vigor' } });

  const offlineSeed = await bundle.adminService.executeOfflineAdminBootstrap({
    offlineCliAuthorized: true,
    targetCatalystUserId: 'u_super_stage2',
    operatorTicketId: 'CHG-STAGE2-001',
    operatorEmail: 'founder@vigorcore.lat',
  });
  assert.equal(offlineSeed.bootstrapped, true);
  assert.equal(offlineSeed.user.role, 'superadmin');

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Verify no public superadmin bootstrap route exists (GET returns 404; unauthenticated POST fails CSRF 403 before routing)
    const superGetRes = await fetch(`${baseUrl}/api/v1/bootstrap-superadmin`, {
      method: 'GET',
      headers: { Origin: 'https://app.vigorcore.lat' },
    });
    assert.equal(superGetRes.status, 404);
    const superPostRes = await fetch(`${baseUrl}/api/v1/bootstrap-superadmin`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(superPostRes.status, 403);

    // 2. Superadmin signs in via Hosted Login bridge & issues an admin invitation
    authRuntime.setCurrentUser({
      zuid: 'z_super_2',
      user_id: 'u_super_stage2',
      email_id: 'founder@vigorcore.lat',
      status: 'ACTIVE',
      is_confirmed: true,
    });

    const superJar = new LoopbackCookieJarFetch('https://app.vigorcore.lat');
    const superCsrf = new ServerCsrfTokenProvider();
    const superAuthRepo = new CatalystHttpAuthRepository(
      new CatalystHttpTransport({
        baseUrl,
        csrfProvider: superCsrf,
        fetchImpl: superJar.fetchImpl,
      }),
      superCsrf
    );
    const superBridge = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async isUserAuthenticated() {
          return {
            user_id: 'u_super_stage2',
            email_id: 'founder@vigorcore.lat',
            status: 'ACTIVE',
            is_confirmed: true,
          };
        },
        async generateAuthToken() {
          return { access_token: 'super_ephemeral_tok', expires_in_sec: 3600 };
        },
        async signOut() {},
      },
      authRepo: superAuthRepo,
      expectedOrigin: 'https://app.vigorcore.lat',
    });
    const superSess = await superBridge.establishVigorSession({ mode: 'exchange' });
    assert.equal(superSess.actor.role, 'superadmin');

    const createInviteRes = await superJar.fetchImpl(`${baseUrl}/api/v1/admin/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': superCsrf.getCsrfToken() ?? '',
      },
      body: JSON.stringify({
        targetEmail: 'coach.invited@vigorcore.lat',
        targetRole: 'admin',
      }),
    });
    assert.equal(createInviteRes.status, 201);
    const inviteJson = (await createInviteRes.json()) as {
      inviteId: string;
      rawToken: string;
    };
    assert.ok(inviteJson.inviteId);
    assert.ok(inviteJson.rawToken);

    // Verify stored AdminInvitations row contains hash only, NEVER plaintext token
    const storedInvite = await adapter.fetchItem('AdminInvitations', {
      pk: `INVITE#${inviteJson.inviteId}`,
    });
    assert.ok(storedInvite);
    assert.equal(storedInvite.status, 'pending');
    assert.equal(
      storedInvite.tokenHash,
      crypto.createHash('sha256').update(inviteJson.rawToken, 'utf8').digest('hex')
    );

    // 3. Unconfirmed user is rejected fail-closed BEFORE calling backend
    const unconfirmedBridge = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async isUserAuthenticated() {
          return {
            user_id: 'u_unconf',
            email_id: 'unconf@vigorcore.lat',
            status: 'ACTIVE',
            is_confirmed: false,
          };
        },
        async generateAuthToken() {
          throw new Error('Should not be called when unconfirmed');
        },
        async signOut() {},
      },
      authRepo: superAuthRepo,
      expectedOrigin: 'https://app.vigorcore.lat',
    });
    await assert.rejects(
      () => unconfirmedBridge.establishVigorSession({ mode: 'bootstrap' }),
      (err: unknown) =>
        err instanceof CleanSlateRepositoryError && err.code === 'EMAIL_VERIFICATION_REQUIRED'
    );

    // 4. Invited user (pre-confirmed) bootstraps as athlete, then redeems invitation -> becomes admin
    authRuntime.setCurrentUser({
      zuid: 'z_coach_1',
      user_id: 'u_coach_1',
      email_id: 'coach.invited@vigorcore.lat',
      status: 'ACTIVE',
      is_confirmed: true,
    });

    const coachJar = new LoopbackCookieJarFetch('https://app.vigorcore.lat');
    const coachCsrf = new ServerCsrfTokenProvider();
    const coachAuthRepo = new CatalystHttpAuthRepository(
      new CatalystHttpTransport({
        baseUrl,
        csrfProvider: coachCsrf,
        fetchImpl: coachJar.fetchImpl,
      }),
      coachCsrf
    );
    const coachBridge = new CatalystHostedAuthBridge({
      sdk: {
        async init() {},
        async hostedSignIn() {},
        async isUserAuthenticated() {
          return {
            user_id: 'u_coach_1',
            email_id: 'coach.invited@vigorcore.lat',
            status: 'ACTIVE',
            is_confirmed: true,
          };
        },
        async generateAuthToken() {
          return { access_token: 'coach_ephemeral_tok', expires_in_sec: 3600 };
        },
        async signOut() {},
      },
      authRepo: coachAuthRepo,
      expectedOrigin: 'https://app.vigorcore.lat',
    });

    const coachSess = await coachBridge.establishVigorSession({
      mode: 'bootstrap',
      displayName: 'Coach Invited',
    });
    assert.equal(coachSess.actor.role, 'athlete');

    const redeemRes = await coachJar.fetchImpl(`${baseUrl}/api/v1/invitations/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': coachCsrf.getCsrfToken() ?? '',
      },
      body: JSON.stringify({
        inviteId: inviteJson.inviteId,
        token: inviteJson.rawToken,
      }),
    });
    assert.equal(redeemRes.status, 200);
    const redeemBody = (await redeemRes.json()) as {
      assignedRole: string;
      roleVersion: number;
    };
    assert.equal(redeemBody.assignedRole, 'admin');
    assert.equal(redeemBody.roleVersion, 2);

    const redeemedRow = await adapter.fetchItem('AdminInvitations', {
      pk: `INVITE#${inviteJson.inviteId}`,
    });
    assert.equal(redeemedRow?.status, 'redeemed');

    // 5. Anti-spoofing: real HostedNativeCatalystAuthRuntime rejects x-zc-user-type: admin with 403 CATALYST_ADMIN_HEADER_SPOOFED
    const hostedRuntime = HostedNativeCatalystAuthRuntime.fromEnvironment(
      {
        ...createLoopbackEnv(hmacSecret),
        VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
      },
      { allowInsecureLoopbackForTest: true }
    );
    await hostedRuntime.runWithRequestContext(
      {
        'x-zc-projectid': '136967000000014024',
        'x-zc-project-key': 'proj_key_loopback_stage2_test',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_edge_tok_stage2',
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'user_tok_spoof',
      },
      async () => {
        await assert.rejects(
          () =>
            hostedRuntime.getCurrentUserFromRequest({
              headers: {
                'x-zc-projectid': '136967000000014024',
                'x-zc-project-key': 'proj_key_loopback_stage2_test',
                'x-zc-admin-cred-type': 'token',
                'x-zc-admin-cred-token': 'adm_edge_tok_stage2',
                'x-zc-user-type': 'admin',
                'x-zc-user-cred-type': 'token',
                'x-zc-user-cred-token': 'user_tok_spoof',
              },
            }),
          (err: unknown) =>
            err instanceof Error &&
            'code' in err &&
            (err as { code: string; statusCode?: number }).code === 'CATALYST_ADMIN_HEADER_SPOOFED' &&
            (err as { statusCode?: number }).statusCode === 403
        );
      }
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.2 Stage 2 [PASS-STATIC] docs/30 runbook & CatalystHostedAuthBridge meet all Stage 2 audit, safety and verdict constraints', () => {
  const docs30Path = path.join(POC_ROOT, 'docs', '30-phase-5.2-stage-2-native-auth-runbook.md');
  assert.equal(fs.existsSync(docs30Path), true, 'Missing docs/30-phase-5.2-stage-2-native-auth-runbook.md');
  const docs30 = fs.readFileSync(docs30Path, 'utf8');

  const requiredMarkers = [
    'Project-Rainfall',
    '136967000000014024',
    'Development',
    'Production',
    'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED',
    'PHASE_5_2_STAGE_2_RUNBOOK_READY_NOT_EXECUTED',
    'RUNBOOK_RECONCILED_READY_FOR_DEVELOPMENT_EXECUTION',
    'Native Catalyst Authentication',
    'Third-party Authentication',
    'Social Login',
    'Hosted Login',
    'Embedded Login',
    'React 19',
    'React Router',
    'BrowserRouter',
    'Vite',
    'https://app.vigorcore.lat',
    'https://app.vigorcore.lat/auth/callback',
    'https://app.vigorcore.lat/auth/login',
    '/__catalyst/auth/login',
    'redirect_url',
    "generateAuthToken('functions')",
    '__Host-vigor_session',
    'SameSite=Strict',
    'X-Vigor-CSRF',
    'Sec-Fetch-Site',
    'RBAC',
    'Public Signup',
    'AdminInvitations',
    'Alternativa A',
    'Alternativa B',
    'UserManagementAdmin.registerUser',
    'first_name',
    'Authentication → Users',
    'PENDING_LIVE_VERIFICATION',
    'hosted_native',
    'external_oauth',
    'STOP',
  ];

  for (const marker of requiredMarkers) {
    assert.ok(docs30.includes(marker), `docs/30 missing mandatory Stage 2 marker '${marker}'`);
  }

  // Ensure legacy hyphenated PENDING-LIVE-VERIFICATION is normalized to PENDING_LIVE_VERIFICATION in docs/30
  assert.equal(
    docs30.includes('PENDING-LIVE-VERIFICATION'),
    false,
    'docs/30 must use PENDING_LIVE_VERIFICATION consistently'
  );

  const bridgeSrc = fs.readFileSync(
    path.join(POC_ROOT, 'src/frontend/adapters/CatalystHostedAuthBridge.ts'),
    'utf8'
  );
  for (const forbiddenStorage of [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'iam_iframe',
    'signInWithEmailAndPassword',
  ]) {
    assert.equal(
      bridgeSrc.includes(forbiddenStorage),
      false,
      `CatalystHostedAuthBridge.ts must NOT reference '${forbiddenStorage}'`
    );
  }
});
