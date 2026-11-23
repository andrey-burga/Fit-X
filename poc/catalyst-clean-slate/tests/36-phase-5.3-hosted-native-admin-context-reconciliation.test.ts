/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 36:
 * Hosted Native Auth Context, Unauthenticated Catalyst Admin Execution Context (`x-zc-user-type=admin`),
 * Strict Cookie Isolation (`__Host-vigor_session`, `X-Vigor-CSRF`, Zoho Console cookies vs Catalyst user cookies),
 * Path 3 HMAC-Only Verification, `CatalystSeparatedAuthRuntime` Parity, and `docs/43` Completeness.
 *
 * Zero remote Catalyst requests. Zero remote DB mutations. All HTTP/BaaS probes run on `127.0.0.1:0`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AuthGuardError,
  CleanSlateAuthGuard,
  ServerSessionTokenManager,
} from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  HostedNativeCatalystAuthRuntime,
  extractCatalystUserCredentialsFromHeaders,
  extractSanitizedCatalystUserCookie,
} from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { KeyBuilders, type SessionRecordItem, type UserAccountItem } from '../src/types/cleanSlate.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');

function startLoopbackFakeCatalystBaaS() {
  const userCurrentCalls: Array<{
    url: string;
    headers: http.IncomingHttpHeaders;
  }> = [];

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    req.resume();
    req.on('end', () => {
      if (url.includes('/project-user/current') && method === 'GET') {
        userCurrentCalls.push({ url, headers: { ...req.headers } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              zuid: '99887766',
              user_id: 'u_cat_hosted_36',
              email_id: 'hosted.athlete36@vigorcore.lat',
              first_name: 'Hosted',
              last_name: 'Athlete36',
              status: 'ACTIVE',
              is_confirmed: true,
            },
          })
        );
        return;
      }

      if (url.includes('/project-user/') && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              zuid: '99887766',
              user_id: 'u_cat_hosted_36',
              email_id: 'hosted.athlete36@vigorcore.lat',
              first_name: 'Hosted',
              last_name: 'Athlete36',
              status: 'ACTIVE',
              is_confirmed: true,
            },
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', message: 'Not mocked' }));
    });
  });

  return {
    userCurrentCalls,
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

function buildHostedEnv(apiDomain = 'https://api.catalyst.zoho.com', secret?: string): Record<string, string> {
  return {
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'platform_managed',
    VIGORCORE_CATALYST_API_DOMAIN: apiDomain,
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: secret ?? ServerSessionTokenManager.generateStrongSecret(32),
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };
}

function hostedEdgeAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-zc-projectid': '136967000000014024',
    'x-zc-environment': 'Development',
    'x-zc-project-key': 'edge_proj_key_36',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'edge_admin_tok_36',
    ...extra,
  };
}

test('Phase 5.3 [PASS-UNIT] extractSanitizedCatalystUserCookie strictly isolates Catalyst project-user cookies from __Host-vigor_session & Zoho Console cookies', () => {
  // 1. VigorCore session + Zoho Console cookies + bare ZD_CSRF_TOKEN without IAM user session -> undefined
  assert.equal(
    extractSanitizedCatalystUserCookie(
      '__Host-vigor_session=secret_hmac_val; _zcsr_tmp=console_csrf; JSESSIONID=j1; zalb_abc=lb1; ZD_CSRF_TOKEN=bare_csrf'
    ),
    undefined
  );

  // 2. Stratus JWT / JWT_EXPIRES_AT / vigor_* stripped
  assert.equal(
    extractSanitizedCatalystUserCookie('stratus_jwt=s1; JWT_EXPIRES_AT=999; vigor_pref=dark'),
    undefined
  );

  // 3. Valid Catalyst user cookies retained while __Host-vigor_session & Zoho Console cookies stripped
  const filtered = extractSanitizedCatalystUserCookie(
    '__Host-vigor_session=must_strip_hmac; _zcsr_tmp=must_strip_console; _iamadt_us=valid_iam_tok; ZD_CSRF_TOKEN=valid_zd_csrf; zalb_us=strip_lb'
  );
  assert.equal(filtered, '_iamadt_us=valid_iam_tok; ZD_CSRF_TOKEN=valid_zd_csrf');

  // 4. JWT_AUTH + user_cred retained cleanly
  assert.equal(
    extractSanitizedCatalystUserCookie('JWT_AUTH=jwt_abc; user_cred=uc_1; __Host-vigor_session=strip'),
    'JWT_AUTH=jwt_abc; user_cred=uc_1'
  );

  // 5. Raw `Cookie` header NEVER counts as Catalyst user credential
  const creds = extractCatalystUserCredentialsFromHeaders({
    cookie: '_iamadt_us=browser_cookie_must_never_be_read_as_zc_cookie; __Host-vigor_session=s1',
  });
  assert.equal(creds.hasUserCredential, false);
  assert.equal(creds.sanitizedZcCookie, undefined);
});

test('Phase 5.3 [PASS-LOOPBACK] Scenarios 1-5 & 9-10: Anonymous x-zc-user-type=admin, missing headers, forged admin header, console cookies, project mismatch, and missing admin context', async () => {
  const baas = startLoopbackFakeCatalystBaaS();
  const baasOrigin = await baas.start();
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  let nosqlFetchCalls = 0;
  const origFetch = adapter.fetchItem.bind(adapter);
  adapter.fetchItem = async (...args) => {
    nosqlFetchCalls++;
    return origFetch(...args);
  };

  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedEnv(baasOrigin), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // Scenario 1: Anonymous request WITH Catalyst admin execution context (`x-zc-user-type=admin`, no user creds) -> 401 UNAUTHENTICATED, 0 NoSQL, 0 BaaS user hits
    const s1 = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s1.status, 401);
    assert.equal(((await s1.json()) as any).error, 'UNAUTHENTICATED');
    assert.equal(nosqlFetchCalls, 0);
    assert.equal(baas.userCurrentCalls.length, 0);

    // Scenario 2 & 9: Anonymous request WITHOUT Catalyst admin context headers -> 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE
    const s2 = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: { 'sec-fetch-site': 'none' },
    });
    assert.equal(s2.status, 503);
    assert.equal(((await s2.json()) as any).error, 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE');
    assert.equal(nosqlFetchCalls, 0);

    // Scenario 3: Client-forged `x-zc-user-type=admin` without user creds on admin & exchange routes -> NEVER grants identity or privileges (401 UNAUTHENTICATED)
    const s3Admin = await fetch(`${baseUrl}/server/vigor_api/api/v1/admin/users`, {
      headers: {
        'sec-fetch-site': 'same-site',
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s3Admin.status, 401);
    assert.equal(((await s3Admin.json()) as any).error, 'UNAUTHENTICATED');

    const s3Exchange = await fetch(`${baseUrl}/server/vigor_api/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(s3Exchange.status, 401);
    assert.equal(((await s3Exchange.json()) as any).error, 'UNAUTHENTICATED');
    assert.equal(nosqlFetchCalls, 0);

    // Scenario 4: Contradictory `x-zc-user-type=admin` WITH genuine Catalyst user credential -> 403 CATALYST_ADMIN_HEADER_SPOOFED
    const s4Token = await fetch(`${baseUrl}/server/vigor_api/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...hostedEdgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': 'valid_user_token_must_fail_when_admin_marked',
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(s4Token.status, 403);
    assert.equal(((await s4Token.json()) as any).error, 'CATALYST_ADMIN_HEADER_SPOOFED');

    const s4Cookie = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...hostedEdgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-cookie': '_iamadt_us=genuine_user_cookie; ZD_CSRF_TOKEN=zd_1',
        }),
      },
    });
    assert.equal(s4Cookie.status, 403);
    assert.equal(((await s4Cookie.json()) as any).error, 'CATALYST_ADMIN_HEADER_SPOOFED');
    assert.equal(baas.userCurrentCalls.length, 0);
    assert.equal(nosqlFetchCalls, 0);

    // Scenario 5: Browser carrying Zoho Console cookies (`_zcsr_tmp`, `zalb_*`, `JSESSIONID`) + `x-zc-user-type=admin` -> 401 UNAUTHENTICATED, 0 ZCAuth BaaS hits
    const s5 = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        cookie: '_zcsr_tmp=console_tok; JSESSIONID=js_1; ZD_CSRF_TOKEN=bare_csrf',
        ...hostedEdgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-cookie': '_zcsr_tmp=console_tok; zalb_1=lb; ZD_CSRF_TOKEN=bare_csrf',
        }),
      },
    });
    assert.equal(s5.status, 401);
    assert.equal(((await s5.json()) as any).error, 'UNAUTHENTICATED');
    assert.equal(baas.userCurrentCalls.length, 0);
    assert.equal(nosqlFetchCalls, 0);

    // Scenario 10: Project & environment pinning -> 403 PROJECT_CONTEXT_MISMATCH
    const s10Proj = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...hostedEdgeAdminHeaders({ 'x-zc-projectid': '999999999999999999' }),
      },
    });
    assert.equal(s10Proj.status, 403);
    assert.equal(((await s10Proj.json()) as any).error, 'PROJECT_CONTEXT_MISMATCH');

    const s10Env = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...hostedEdgeAdminHeaders({ 'x-zc-environment': 'Production' }),
      },
    });
    assert.equal(s10Env.status, 403);
    assert.equal(((await s10Env.json()) as any).error, 'PROJECT_CONTEXT_MISMATCH');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.3 [PASS-LOOPBACK] Scenarios 6, 7, 8 & 12: Valid HMAC-only Path 3 with edge x-zc-user-type=admin skips getCurrentUser(), valid Catalyst user cred exchanges cleanly, cookie isolation verified on BaaS wire, and health/OPTIONS preserved', async () => {
  const baas = startLoopbackFakeCatalystBaaS();
  const baasOrigin = await baas.start();
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter();

  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSec * 1000).toISOString();

  // Seed athlete user in Users + active session in SystemControl
  const userItem: UserAccountItem = {
    pk: KeyBuilders.userPk('u_cat_hosted_36'),
    uid: 'u_cat_hosted_36',
    email: 'hosted.athlete36@vigorcore.lat',
    normalizedEmail: 'hosted.athlete36@vigorcore.lat',
    displayName: 'Hosted Athlete36',
    role: 'athlete',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: KeyBuilders.directorySegment('u_cat_hosted_36'),
    onboardingCompleted: true,
    onboardingStep: 4,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  };
  await adapter.insertItem('Users', userItem);

  const tokens = new ServerSessionTokenManager({
    activeSecret: hmacSecret,
    activeKeyId: 'k1',
    environment: 'development',
    nowSecProvider: () => nowSec,
  });
  const issued = tokens.issueTokenWithClaims('u_cat_hosted_36', 1, 12 * 3600);
  const csrfToken = tokens.issueCsrfToken('u_cat_hosted_36', issued.claims.sid, 1, issued.claims.exp);

  const sessionRec: SessionRecordItem = {
    pk: KeyBuilders.sessionPk(issued.claims.sid),
    sid: issued.claims.sid,
    ownerUserId: 'u_cat_hosted_36',
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: issued.claims.iat,
    initialAuthAtEpochSec: issued.claims.iat,
    expiresAt: new Date(issued.claims.exp * 1000).toISOString(),
    expiresAtEpochSec: issued.claims.exp,
    absoluteExpiresAtEpochSec: issued.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: nowSec,
    status: 'active',
    ttlEpochSec: issued.claims.iat + 48 * 3600,
  };
  await adapter.insertItem('SystemControl', sessionRec);

  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedEnv(baasOrigin, hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: adapter,
    nowSecProvider: () => nowSec,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // Scenario 6a: Valid HMAC `__Host-vigor_session` WITH Catalyst Edge `x-zc-user-type=admin` + Zoho Console cookies
    // Must verify HMAC, Users & SystemControl consistent_read, RBAC, and NEVER call UserManagement.getCurrentUser()!
    const s6Get = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'same-site',
        cookie: `__Host-vigor_session=${issued.token}; _zcsr_tmp=console_tok; ZD_CSRF_TOKEN=bare_console`,
        ...hostedEdgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-cookie': `__Host-vigor_session=${issued.token}; _zcsr_tmp=console_tok`,
        }),
      },
    });
    assert.equal(s6Get.status, 200);
    assert.equal(baas.userCurrentCalls.length, 0, 'HMAC-only GET must NOT call /project-user/current');

    // Scenario 6b: Mutation requires bound `X-Vigor-CSRF` & respects RBAC (athlete denied on /admin/users)
    const s6NoCsrf = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${issued.token}`,
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ displayName: 'Missing CSRF' }),
    });
    assert.equal(s6NoCsrf.status, 403);
    assert.equal(((await s6NoCsrf.json()) as any).error, 'CSRF_TOKEN_MISSING');

    const s6ValidMutation = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-CSRF': csrfToken,
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${issued.token}`,
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ displayName: 'Updated Athlete36' }),
    });
    assert.equal(s6ValidMutation.status, 200);
    assert.equal(baas.userCurrentCalls.length, 0);

    const s6RbacDenied = await fetch(`${baseUrl}/server/vigor_api/api/v1/admin/users`, {
      headers: {
        'sec-fetch-site': 'same-site',
        cookie: `__Host-vigor_session=${issued.token}`,
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s6RbacDenied.status, 403);

    // Scenario 7 & 8: Valid Catalyst user credential (Sanitized Catalyst cookies in `x-zc-cookie`) WITHOUT `x-zc-user-type=admin`
    // Verifies `__Host-vigor_session`, `X-Vigor-CSRF`, and `_zcsr_tmp` NEVER leak onto outbound BaaS `Cookie` header!
    const secretHmacToStrip = 'vigor_hmac_secret_cookie_must_never_reach_baas';
    const secretCsrfToStrip = 'vigor_csrf_header_must_never_reach_baas';
    const s7Exchange = await fetch(`${baseUrl}/server/vigor_api/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'X-Vigor-CSRF': secretCsrfToStrip,
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${secretHmacToStrip}; other_browser=1`,
        ...hostedEdgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-cookie': `__Host-vigor_session=${secretHmacToStrip}; _zcsr_tmp=console_noise; _iamadt_us=cat_iam_36; ZD_CSRF_TOKEN=cat_zd_36`,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(s7Exchange.status, 200);
    const exchBody = (await s7Exchange.json()) as any;
    assert.equal(exchBody.success, true);
    assert.ok(exchBody.csrfToken);
    assert.ok((s7Exchange.headers.get('set-cookie') || '').startsWith('__Host-vigor_session='));

    assert.equal(baas.userCurrentCalls.length, 1);
    const wireCookie = String(baas.userCurrentCalls[0].headers.cookie || '');
    const wireZcsrf = String(baas.userCurrentCalls[0].headers['x-zcsrf-token'] || '');
    assert.equal(wireCookie, '_iamadt_us=cat_iam_36; ZD_CSRF_TOKEN=cat_zd_36');
    assert.equal(wireZcsrf, 'zd_csrparam=cat_zd_36');
    assert.equal(wireCookie.includes('__Host-vigor_session'), false);
    assert.equal(wireCookie.includes(secretHmacToStrip), false);
    assert.equal(wireCookie.includes(secretCsrfToStrip), false);
    assert.equal(wireCookie.includes('_zcsr_tmp'), false);
    assert.equal(wireCookie.includes('other_browser'), false);

    // Scenario 12: Health & OPTIONS preflight remain clean without Catalyst headers
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as any;
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.routeCount, 41);

    const optRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(optRes.status, 204);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.3 [PASS-LOOPBACK] Scenario 11: CatalystSeparatedAuthRuntime (external_oauth) parity for anonymous x-zc-user-type=admin, contradictory user+admin spoofing, and cookie isolation', async () => {
  const baas = startLoopbackFakeCatalystBaaS();
  const baasOrigin = await baas.start();

  try {
    const provider = new CatalystAdminAppProvider({
      projectId: '136967000000014024',
      projectKey: 'ext_proj_key_36',
      catalystEnvironment: 'Development',
      vigorEnvironment: 'development',
      apiDomain: baasOrigin,
      accountsUrl: baasOrigin,
      clientId: '1000.EXT_CID',
      clientSecret: '1000.EXT_SECRET',
      refreshToken: '1000.EXT_RTOK',
      allowInsecureLoopbackForTest: true,
    });
    const runtime = new CatalystSeparatedAuthRuntime({ adminProvider: provider });

    // Anonymous `x-zc-user-type: admin` without user creds -> null (no 403, no BaaS hit)
    const anonUser = await runtime.getCurrentUserFromRequest({
      headers: {
        'x-zc-projectid': '136967000000014024',
        'x-zc-project-key': 'ext_proj_key_36',
        'x-zc-user-type': 'admin',
        cookie: '__Host-vigor_session=only_hmac; _zcsr_tmp=console',
      },
    });
    assert.equal(anonUser, null);
    assert.equal(baas.userCurrentCalls.length, 0);

    // Contradictory `x-zc-user-type: admin` WITH user cred -> 403 CATALYST_ADMIN_HEADER_SPOOFED
    await assert.rejects(
      () =>
        runtime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': '136967000000014024',
            'x-zc-project-key': 'ext_proj_key_36',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': 'usr_tok_36',
          },
        }),
      (err: unknown) =>
        err instanceof AuthGuardError &&
        err.code === 'CATALYST_ADMIN_HEADER_SPOOFED' &&
        err.statusCode === 403
    );

    // Valid Catalyst user cookie in `x-zc-cookie` passes sanitized cookies only to BaaS
    const okUser = await runtime.getCurrentUserFromRequest({
      headers: {
        'x-zc-projectid': '136967000000014024',
        'x-zc-project-key': 'ext_proj_key_36',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_tok_36',
        'x-zc-cookie': '__Host-vigor_session=leak_blocked; _zcsr_tmp=console_blocked; _iamadt_us=ext_cat_tok; ZD_CSRF_TOKEN=ext_zd_csrf',
      },
    });
    assert.equal(okUser?.user_id, 'u_cat_hosted_36');
    assert.equal(baas.userCurrentCalls.length, 1);
    assert.equal(
      baas.userCurrentCalls[0].headers.cookie,
      '_iamadt_us=ext_cat_tok; ZD_CSRF_TOKEN=ext_zd_csrf'
    );
  } finally {
    await baas.close();
  }
});

test('Phase 5.3 [PASS-UNIT] Direct CleanSlateAuthGuard Path 3 skips getCurrentUserFromRequest on HMAC-only HostedNative requests', async () => {
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSec * 1000).toISOString();
  const adapter = new CleanSlateInMemoryNoSQLAdapter();

  await adapter.insertItem('Users', {
    pk: KeyBuilders.userPk('u_path3_only'),
    uid: 'u_path3_only',
    email: 'path3@vigorcore.lat',
    normalizedEmail: 'path3@vigorcore.lat',
    displayName: 'Path3 User',
    role: 'admin',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: KeyBuilders.directorySegment('u_path3_only'),
    onboardingCompleted: true,
    onboardingStep: 4,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  });

  const tokens = new ServerSessionTokenManager({
    activeSecret: hmacSecret,
    activeKeyId: 'k1',
    environment: 'development',
    nowSecProvider: () => nowSec,
  });
  const issued = tokens.issueTokenWithClaims('u_path3_only', 1, 12 * 3600);
  await adapter.insertItem('SystemControl', {
    pk: KeyBuilders.sessionPk(issued.claims.sid),
    sid: issued.claims.sid,
    ownerUserId: 'u_path3_only',
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: issued.claims.iat,
    initialAuthAtEpochSec: issued.claims.iat,
    expiresAt: new Date(issued.claims.exp * 1000).toISOString(),
    expiresAtEpochSec: issued.claims.exp,
    absoluteExpiresAtEpochSec: issued.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: nowSec,
    status: 'active',
    ttlEpochSec: issued.claims.iat + 48 * 3600,
  });

  const hostedRuntime = HostedNativeCatalystAuthRuntime.fromEnvironment(buildHostedEnv('https://api.catalyst.zoho.com', hmacSecret));
  let getCurrentUserSpyCount = 0;
  hostedRuntime.getCurrentUserFromRequest = async () => {
    getCurrentUserSpyCount++;
    throw new Error('SHOULD_NOT_BE_CALLED_ON_HMAC_ONLY');
  };

  const guard = new CleanSlateAuthGuard(hostedRuntime, adapter, tokens);
  const actor = await guard.authenticate(
    {
      headers: {
        cookie: `__Host-vigor_session=${issued.token}`,
        ...hostedEdgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    },
    { authPolicy: 'hmac_session', requireSignedSession: true }
  );

  assert.equal(actor.catalystUserId, 'u_path3_only');
  assert.equal(actor.role, 'admin');
  assert.equal(getCurrentUserSpyCount, 0);
});

test('Phase 5.3 [PASS-UNIT] docs/43 and docs/32 reconcile hosted_native admin context, cookie isolation, and exact final status', () => {
  const doc43Path = path.join(POC_ROOT, 'docs', '43-phase-5.3-hosted-native-admin-context-reconciliation.md');
  assert.equal(fs.existsSync(doc43Path), true);
  const doc43 = fs.readFileSync(doc43Path, 'utf8');

  for (const token of [
    'PHASE_5_3_HOSTED_NATIVE_AUTH_CONTEXT_RECONCILED_NOT_DEPLOYED',
    'HostedNativeCatalystAuthRuntime',
    'CatalystSeparatedAuthRuntime',
    'CleanSlateAuthGuard',
    'x-zc-user-type',
    'x-zc-user-cred-token',
    'x-zc-cookie',
    '__Host-vigor_session',
    'X-Vigor-CSRF',
    'ZD_CSRF_TOKEN',
    '401 UNAUTHENTICATED',
    '403 CATALYST_ADMIN_HEADER_SPOOFED',
    '503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
    'PENDING_LIVE_VERIFICATION',
  ]) {
    assert.ok(doc43.includes(token), `docs/43 missing token: ${token}`);
  }

  const doc32 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '32-phase-5.3-vigor-api-implementation-runbook.md'),
    'utf8'
  );
  assert.ok(doc32.includes('PHASE_5_3_HOSTED_NATIVE_AUTH_CONTEXT_RECONCILED_NOT_DEPLOYED'));
  assert.ok(doc32.includes('docs/43'));
});
