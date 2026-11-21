/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.1.1 — Test Suite 18:
 * Zoho Support Nov 17, 2026 Reconciliation, Hosted Native `ZCAuth.init`,
 * API Gateway 41-Route Rewrite & Auth Matrix, `platform_managed` CORS + CSRF,
 * and `getAdminStats` Cursor Pagination (> 400 users across USER_SEG#0..3).
 *
 * STRICT VERIFICATION HONESTY:
 * - Zero remote Catalyst requests, zero remote tables/users/deployments, zero secrets.
 * - Tests assert `[PASS-UNIT]`, `[PASS-SDK-CONTRACT]`, or `[PASS-LOOPBACK]` locally only.
 * - Live Catalyst edge header overwrite, Gateway NO_AUTHENTICATION `x-zc-admin-cred-token`
 *   injection, `Origin`/`Referer`/`Sec-Fetch-Site` passthrough, Chromium preflight OPTIONS,
 *   and Safari WebKit cookies remain `PENDING-LIVE-VERIFICATION`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { runCatalystConfigPreflight } from '../src/provisioning/catalystConfigPreflight.js';
import {
  buildAlternativeBConfig,
  buildApiGatewayGlobalImpactAudit,
  buildCorsOptionsMatrix,
  getRequiredServerEnvSpecs,
  verifyGatewayAuthMatrixCompleteness,
  verifyGatewayRewriteCoverage,
} from '../src/provisioning/domainGatewayConfigs.js';
import {
  HOSTED_VS_EXTERNAL_AUTH_ADR,
  HostedNativeCatalystAuthRuntime,
} from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import {
  KeyBuilders,
  type AuthoritativeActor,
  type UserAccountItem,
} from '../src/types/cleanSlate.js';
import { runVerifierCli } from '../scripts/verify-clean-slate-provisioning.js';

function startFakeCatalystLoopbackBaaS() {
  const receivedCalls: Array<{
    method: string;
    url: string;
    adminToken: string | undefined;
    userToken: string | undefined;
    userType: string | undefined;
    projectHeader: string | undefined;
  }> = [];

  const usersStore = new Map<string, Record<string, { S?: string; N?: string; BOOL?: boolean; M?: any; L?: any }>>();
  const userDataStore = new Map<string, Record<string, any>>();
  const sysControlStore = new Map<string, Record<string, any>>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = req.url || '/';
      const method = (req.method || 'GET').toUpperCase();
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const parsedBody = rawBody ? JSON.parse(rawBody) : {};

      const authHeader = typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined;
      const adminToken = typeof req.headers['x-zc-admin-cred-token'] === 'string'
        ? req.headers['x-zc-admin-cred-token']
        : authHeader;
      const userToken = typeof req.headers['x-zc-user-cred-token'] === 'string'
        ? req.headers['x-zc-user-cred-token']
        : authHeader;
      const userType = typeof req.headers['x-zc-user-type'] === 'string'
        ? req.headers['x-zc-user-type']
        : undefined;
      const projectHeader = typeof req.headers.project_id === 'string'
        ? req.headers.project_id
        : undefined;

      receivedCalls.push({
        method,
        url,
        adminToken,
        userToken,
        userType,
        projectHeader,
      });

      // Catalyst UserManagement.getCurrentUser() endpoint in user scope
      if (url.includes('/project-user/current') && method === 'GET') {
        const expectedAuth = userToken || '';
        if (!expectedAuth.includes('user_tok_hosted_1')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failure', message: 'Invalid user token' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              zuid: '99110022',
              user_id: 'cat_hosted_uid_1',
              email_id: 'Hosted.Athlete@VigorCore.lat',
              status: 'ACTIVE',
              is_confirmed: true,
              first_name: 'Hosted',
              last_name: 'Athlete',
            },
          })
        );
        return;
      }

      // NoSQL Fetch Item
      const fetchMatch = url.match(/\/nosqltable\/([^/]+)\/item\/fetch$/);
      if (fetchMatch && method === 'POST') {
        const table = fetchMatch[1];
        const keys: Array<Record<string, { S?: string }>> = parsedBody.keys || [];
        const get = keys.map(k => {
          const pk = k.pk?.S || '';
          const sk = k.sk?.S || '';
          const store =
            table === 'Users'
              ? usersStore
              : table === 'SystemControl'
                ? sysControlStore
                : userDataStore;
          const mapKey = sk ? `${pk}|${sk}` : pk;
          const item = store.get(mapKey);
          return item ? { status: 'Success', item } : { status: 'CriteriaMismatch' };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: { size: get.length, start_key: {}, get } }));
        return;
      }

      // NoSQL Query Index / Table (supports Users GSI_Email & UserData pk queries)
      const queryMatch = url.match(/\/nosqltable\/([^/]+)(?:\/index\/([^/]+))?\/item\/query$/);
      if (queryMatch && method === 'POST') {
        const table = queryMatch[1];
        const indexName = queryMatch[2];
        const get: Array<{ status: string; item: any }> = [];

        if (table === 'Users' && indexName === 'GSI_Email') {
          const targetEmail = parsedBody.key_condition?.attribute_value?.S;
          for (const item of usersStore.values()) {
            if (item.normalizedEmail?.S === targetEmail) {
              get.push({ status: 'Success', item });
            }
          }
        } else if (table === 'UserData') {
          const targetPk = parsedBody.key_condition?.attribute_value?.S;
          for (const item of userDataStore.values()) {
            if (item.pk?.S === targetPk) {
              get.push({ status: 'Success', item });
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: { size: get.length, start_key: {}, get } }));
        return;
      }

      // NoSQL Insert Item (@zcatalyst/nosql sends array [{ item, condition }] and reads data.create)
      const insertMatch = url.match(/\/nosqltable\/([^/]+)\/item$/);
      if (insertMatch && method === 'POST') {
        const table = insertMatch[1];
        const rows: any[] = Array.isArray(parsedBody) ? parsedBody : parsedBody.items || [parsedBody];
        const store =
          table === 'Users'
            ? usersStore
            : table === 'SystemControl'
              ? sysControlStore
              : userDataStore;
        const create = rows.map(entry => {
          const it = entry?.item || entry || {};
          const pk = it.pk?.S || '';
          const sk = it.sk?.S || '';
          const mapKey = sk ? `${pk}|${sk}` : pk;
          store.set(mapKey, it);
          return { status: 'Success', item: it };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: { size: create.length, start_key: {}, create },
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', message: `Unhandled loopback path: ${method} ${url}` }));
    });
  });

  return {
    receivedCalls,
    server,
    async listen(): Promise<string> {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      return `http://127.0.0.1:${port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

test('Phase 5.1.1 [PASS-UNIT] AdminGovernanceService.getAdminStats paginates past 100 users per GSI_Directory shard (>465 users)', async () => {
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  const dummyAuthRuntime: any = {
    getCurrentUserFromRequest: async () => null,
    getUserDetails: async () => null,
    updateUserStatus: async () => true,
    sendPasswordReset: async () => undefined,
  };
  const adminSvc = new AdminGovernanceService(adapter, dummyAuthRuntime, () => Date.now());

  const totalUsers = 465; // Guarantees >110 users per shard across USER_SEG#0..3
  let expectedActive = 0;
  let expectedSuspended = 0;
  let expectedSuperadmins = 0;
  let expectedAdmins = 0;

  for (let i = 0; i < totalUsers; i += 1) {
    const uid = `u_stats_${String(i).padStart(4, '0')}`;
    const role: UserAccountItem['role'] =
      i < 3 ? 'superadmin' : i < 18 ? 'admin' : 'athlete';
    const accountStatus: UserAccountItem['accountStatus'] =
      i % 7 === 0 ? 'suspended' : 'active';
    const seg = KeyBuilders.directorySegment(uid);

    if (accountStatus === 'active') expectedActive += 1;
    else expectedSuspended += 1;
    if (role === 'superadmin') expectedSuperadmins += 1;
    if (role === 'admin') expectedAdmins += 1;

    await adapter.insertItem('Users', {
      pk: KeyBuilders.userPk(uid),
      uid,
      email: `${uid}@vigorcore.lat`,
      normalizedEmail: `${uid}@vigorcore.lat`,
      displayName: `Athlete ${i}`,
      role,
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus,
      emailVerified: true,
      authProvider: 'catalyst',
      directorySegment: seg,
      onboardingCompleted: true,
      onboardingStep: 6,
      createdAt: new Date(1763400000000 + i * 1000).toISOString(),
      updatedAt: new Date(1763400000000 + i * 1000).toISOString(),
      lastSignInAt: new Date(1763400000000 + i * 1000).toISOString(),
    });
  }

  await adapter.insertItem('SystemControl', {
    pk: KeyBuilders.superadminCountPk(),
    activeSuperadminCount: expectedSuperadmins,
    version: 1,
    updatedAt: new Date().toISOString(),
  });

  const adminActor: AuthoritativeActor = {
    catalystUserId: 'u_stats_0000',
    email: 'u_stats_0000@vigorcore.lat',
    normalizedEmail: 'u_stats_0000@vigorcore.lat',
    displayName: 'Athlete 0',
    role: 'superadmin',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    isConfirmed: true,
  };

  const stats = await adminSvc.getAdminStats(adminActor);
  assert.equal(stats.totalUsers, totalUsers);
  assert.equal(stats.activeUsers, expectedActive);
  assert.equal(stats.suspendedUsers, expectedSuspended);
  assert.equal(stats.superadmins, expectedSuperadmins);
  assert.equal(stats.admins, expectedAdmins);
});

test('Phase 5.1.1 [PASS-UNIT] AdminGovernanceService.getAdminStats fails closed on stalled cursor pagination (504)', async () => {
  const stallingAdapter: any = {
    queryIndex: async () => ({
      items: [
        {
          pk: 'USER#dup_1',
          uid: 'dup_1',
          role: 'athlete',
          accountStatus: 'active',
        },
      ],
      nextStartKey: 'STUCK_CURSOR_TOKEN',
    }),
    queryTable: async () => ({ items: [] }),
  };
  const dummyAuthRuntime: any = {
    getCurrentUserFromRequest: async () => null,
    getUserDetails: async () => null,
    updateUserStatus: async () => true,
    sendPasswordReset: async () => undefined,
  };
  const adminActor: AuthoritativeActor = {
    catalystUserId: 'u_stats_admin',
    email: 'admin@vigorcore.lat',
    normalizedEmail: 'admin@vigorcore.lat',
    displayName: 'Admin',
    role: 'admin',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    isConfirmed: true,
  };
  const adminSvc = new AdminGovernanceService(stallingAdapter, dummyAuthRuntime);
  await assert.rejects(
    () => adminSvc.getAdminStats(adminActor),
    (err: any) => err?.statusCode === 504 && err?.code === 'DIRECTORY_PAGINATION_STALLED'
  );
});

test('Phase 5.1.1 [PASS-LOOPBACK] HostedNativeCatalystAuthRuntime + Express runs via ZCAuth.init without external OAuth secrets & enforces isolation', async () => {
  const baas = startFakeCatalystLoopbackBaaS();
  const baasOrigin = await baas.listen();
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);

  // Deliberately omit CATALYST_PROJECT_KEY and ALL CATALYST_ADMIN_* OAuth env variables
  const runtime = createVigorCoreProductionRuntimeFromEnv(
    {
      VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
      VIGOR_CORS_MODE: 'platform_managed',
      CATALYST_PROJECT_ID: 'proj_hosted_511',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: baasOrigin,
      CATALYST_ACCOUNTS_URL: baasOrigin,
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_SESSION_ACTIVE_KID: 'k1',
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    },
    { allowInsecureLoopbackForTest: true }
  );

  assert.equal(runtime.catalystAuthMode, 'hosted_native');
  assert.equal(runtime.corsMode, 'platform_managed');
  assert.equal(runtime.adminProvider, undefined);
  assert.ok(runtime.hostedRuntime instanceof HostedNativeCatalystAuthRuntime);
  assert.equal(HOSTED_VS_EXTERNAL_AUTH_ADR.externalSecretsEliminatedInHostedMode.length, 3);

  const expressServer = http.createServer(runtime.app);
  await new Promise<void>(resolve => expressServer.listen(0, '127.0.0.1', resolve));
  const port = (expressServer.address() as { port: number }).port;
  const apiUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. /health remains accessible without edge credential headers
    const healthRes = await fetch(`${apiUrl}/health`);
    assert.equal(healthRes.status, 200);

    // 2. Missing x-zc-admin-cred-token fails closed 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE
    const missingCtxRes = await fetch(`${apiUrl}/api/v1/auth/me`);
    assert.equal(missingCtxRes.status, 503);
    const missingCtxBody = (await missingCtxRes.json()) as any;
    assert.equal(missingCtxBody.error, 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE');

    // 3. Mismatched x-zc-projectid fails closed 403 PROJECT_CONTEXT_MISMATCH
    const mismatchRes = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: {
        'x-zc-projectid': 'proj_attacker_999',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_edge_tok_1',
        'x-zc-project-key': 'edge_proj_key_511',
      },
    });
    assert.equal(mismatchRes.status, 403);
    assert.equal(((await mismatchRes.json()) as any).error, 'PROJECT_CONTEXT_MISMATCH');

    // 4. Spoofed x-zc-user-type: admin on bootstrap-profile fails closed 403 CATALYST_ADMIN_HEADER_SPOOFED
    const spoofRes = await fetch(`${apiUrl}/server/vigor_api/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        'x-zc-projectid': 'proj_hosted_511',
        'x-zc-project-key': 'edge_proj_key_511',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_edge_tok_1',
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'user_tok_hosted_1',
      },
      body: JSON.stringify({ displayName: 'Spoofed User' }),
    });
    assert.equal(spoofRes.status, 403);
    assert.equal(((await spoofRes.json()) as any).error, 'CATALYST_ADMIN_HEADER_SPOOFED');

    // 5. Real bootstrap-profile through API Gateway rewritten path `/server/vigor_api/api/v1/...`
    //    Even if client injects forged `zc-api-domain`, runtime pins configured CATALYST_API_DOMAIN.
    const bootstrapRes = await fetch(`${apiUrl}/server/vigor_api/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json',
        'zc-api-domain': 'https://evil-baas.attacker.example',
        'x-zc-projectid': 'proj_hosted_511',
        'x-zc-project-key': 'edge_proj_key_511',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_edge_tok_alpha',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'user_tok_hosted_1',
      },
      body: JSON.stringify({ displayName: 'Hosted Native Athlete' }),
    });
    assert.equal(bootstrapRes.status, 200);
    // platform_managed CORS emits Vary: Origin and ZERO Access-Control-Allow-Origin duplicates
    assert.equal(bootstrapRes.headers.get('access-control-allow-origin'), null);
    assert.equal(bootstrapRes.headers.get('vary'), 'Origin');

    const setCookie = bootstrapRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.startsWith('__Host-vigor_session='));
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('Secure'));
    assert.ok(setCookie.includes('SameSite=Strict'));
    assert.ok(setCookie.includes('Path=/'));

    const cookiePair = setCookie.split(';')[0];
    const bootstrapBody = (await bootstrapRes.json()) as any;
    assert.equal(bootstrapBody.success, true);
    assert.equal(bootstrapBody.actor.catalystUserId, 'cat_hosted_uid_1');
    assert.ok(typeof bootstrapBody.csrfToken === 'string' && bootstrapBody.csrfToken.length > 10);

    // 6. Authenticated meal creation via HMAC session + bound CSRF in hosted_native mode
    const mealRes = await fetch(`${apiUrl}/server/vigor_api/api/v1/athlete/meals`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-CSRF': bootstrapBody.csrfToken,
        'Content-Type': 'application/json',
        Cookie: cookiePair,
        'x-zc-projectid': 'proj_hosted_511',
        'x-zc-project-key': 'edge_proj_key_511',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_edge_tok_beta',
      },
      body: JSON.stringify({
        dateTime: '2026-11-17T12:30:00Z',
        name: 'Hosted Native Bowl',
        kcal: 540,
        protein: 44,
        carbs: 52,
        fat: 14,
      }),
    });
    assert.equal(mealRes.status, 201);

    // Confirm BaaS calls received pinned project key and expected per-request tokens
    const nosqlCalls = baas.receivedCalls.filter(c => c.url.includes('/nosqltable/'));
    assert.ok(nosqlCalls.length >= 4);
    assert.ok(nosqlCalls.every(c => c.projectHeader === 'edge_proj_key_511'));
    assert.ok(nosqlCalls.some(c => c.adminToken?.includes('adm_edge_tok_alpha')));
    assert.ok(nosqlCalls.some(c => c.adminToken?.includes('adm_edge_tok_beta')));

    // 7. Concurrent AsyncLocalStorage isolation across simultaneous hosted requests
    await Promise.all([
      runtime.hostedRuntime!.runWithRequestContext(
        {
          'x-zc-projectid': 'proj_hosted_511',
          'x-zc-project-key': 'edge_proj_key_511',
          'x-zc-admin-cred-type': 'token',
          'x-zc-admin-cred-token': 'concurrent_tok_A',
        },
        async () => {
          await new Promise(r => setTimeout(r, 15));
          const appA = runtime.hostedRuntime!.getActiveRequestAdminApp();
          assert.deepEqual(await appA.credential.getToken(), { access_token: 'concurrent_tok_A' });
        }
      ),
      runtime.hostedRuntime!.runWithRequestContext(
        {
          'x-zc-projectid': 'proj_hosted_511',
          'x-zc-project-key': 'edge_proj_key_511',
          'x-zc-admin-cred-type': 'token',
          'x-zc-admin-cred-token': 'concurrent_tok_B',
        },
        async () => {
          await new Promise(r => setTimeout(r, 5));
          const appB = runtime.hostedRuntime!.getActiveRequestAdminApp();
          assert.deepEqual(await appB.credential.getToken(), { access_token: 'concurrent_tok_B' });
        }
      ),
    ]);
  } finally {
    await new Promise<void>(resolve => expressServer.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.1.1 [PASS-LOOPBACK] VIGOR_CORS_MODE=platform_managed suppresses duplicate CORS headers while keeping fail-closed Origin + CSRF checks', async () => {
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  const runtime = createVigorCoreProductionRuntimeFromEnv(
    {
      VIGOR_CATALYST_AUTH_MODE: 'external_oauth',
      VIGOR_CORS_MODE: 'platform_managed',
      CATALYST_PROJECT_ID: 'proj_cors_511',
      CATALYST_PROJECT_KEY: 'projkey_cors_511',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: 'http://127.0.0.1:9999',
      CATALYST_ACCOUNTS_URL: 'http://127.0.0.1:9998',
      CATALYST_ADMIN_CLIENT_ID: '1000.CORSCLIENT',
      CATALYST_ADMIN_CLIENT_SECRET: 'secret_cors_511',
      CATALYST_ADMIN_REFRESH_TOKEN: '1000.refresh_cors_511',
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    },
    {
      allowInsecureLoopbackForTest: true,
      adapterOverride: adapter,
    }
  );

  const server = http.createServer(runtime.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const apiUrl = `http://127.0.0.1:${port}`;

  try {
    // Trusted Origin preflight returns 204 with Vary: Origin and ZERO Access-Control-Allow-* duplicates
    const okPreflight = await fetch(`${apiUrl}/api/v1/athlete/meals`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Vigor-CSRF',
      },
    });
    assert.equal(okPreflight.status, 204);
    assert.equal(okPreflight.headers.get('access-control-allow-origin'), null);
    assert.equal(okPreflight.headers.get('access-control-allow-credentials'), null);
    assert.equal(okPreflight.headers.get('vary'), 'Origin');

    // Untrusted Origin preflight still FAILS CLOSED 403
    const badPreflight = await fetch(`${apiUrl}/api/v1/athlete/meals`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil-cors.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(badPreflight.status, 403);
    assert.equal(((await badPreflight.json()) as any).error, 'CORS_ORIGIN_REJECTED');

    // Cross-site Fetch Metadata still FAILS CLOSED even in platform_managed mode
    const crossSitePost = await fetch(`${apiUrl}/api/v1/athlete/meals`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(crossSitePost.status, 403);
    assert.equal(((await crossSitePost.json()) as any).error, 'CSRF_CROSS_SITE_REJECTED');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.1.1 [PASS-UNIT] API Gateway 41-route rewrite coverage, 41-route auth matrix, CORS/OPTIONS matrix, and Global Impact Audit are complete & non-applied', () => {
  const rewriteReport = verifyGatewayRewriteCoverage('vigor_api');
  assert.equal(rewriteReport.totalRoutes, 41);
  assert.equal(rewriteReport.passedRoutes, 41);
  assert.equal(rewriteReport.allMatched, true);

  const authCompleteness = verifyGatewayAuthMatrixCompleteness();
  assert.equal(authCompleteness.totalContractRoutes, 41);
  assert.equal(authCompleteness.totalMatrixRoutes, 41);
  assert.deepEqual(authCompleteness.missingRouteIds, []);
  assert.deepEqual(authCompleteness.extraRouteIds, []);
  assert.equal(authCompleteness.allRoutesCovered, true);
  assert.equal(authCompleteness.zeroOAuthExecuteForced, true);

  const altB = buildAlternativeBConfig();
  assert.equal(altB.applied, false);
  assert.equal(altB.selectedByZohoSupportDecision, true);
  assert.equal(altB.frontendOrigin, 'https://app.vigorcore.lat');
  assert.equal(altB.apiOrigin, 'https://api.vigorcore.lat');
  assert.equal(altB.domainMapping.webClientHostingRequired, false);
  assert.equal(altB.domainMapping.dnsRecordType, 'CNAME');
  assert.equal(altB.authorizedDomainsCors.supportsWithoutIframe, true);
  assert.equal(altB.perRouteAuthMatrix.length, 41);

  const bootstrapEntry = altB.perRouteAuthMatrix.find(r => r.routeId === 'auth.session.bootstrapProfile');
  const exchangeEntry = altB.perRouteAuthMatrix.find(r => r.routeId === 'auth.session.exchange');
  const refreshEntry = altB.perRouteAuthMatrix.find(r => r.routeId === 'auth.session.refresh');
  const meEntry = altB.perRouteAuthMatrix.find(r => r.routeId === 'auth.me');
  assert.equal(bootstrapEntry?.recommendedGatewayAuth, 'CATALYST_USERS_AUTHENTICATION');
  assert.equal(exchangeEntry?.recommendedGatewayAuth, 'CATALYST_USERS_AUTHENTICATION');
  assert.equal(refreshEntry?.recommendedGatewayAuth, 'NO_AUTHENTICATION');
  assert.equal(meEntry?.recommendedGatewayAuth, 'NO_AUTHENTICATION');

  const corsMatrix = buildCorsOptionsMatrix('https://app.vigorcore.lat');
  assert.equal(corsMatrix.wildcardAllowed, false);
  assert.equal(corsMatrix.iframeEmbeddingRequired, false);
  assert.equal(corsMatrix.entries.length, 6);
  for (const row of corsMatrix.entries) {
    assert.equal(row.credentialsMode, 'include');
    assert.equal(row.liveBrowserStatus, 'PENDING-LIVE-VERIFICATION');
    assert.equal(row.expressEnforcedResponseHeaders['Access-Control-Allow-Origin'], 'https://app.vigorcore.lat');
    assert.equal(row.platformManagedExpressResponseHeaders['Access-Control-Allow-Origin'], undefined);
    assert.equal(row.platformManagedExpressResponseHeaders.Vary, 'Origin');
  }

  const impactAudit = buildApiGatewayGlobalImpactAudit();
  assert.equal(impactAudit.applied, false);
  assert.ok(impactAudit.inventoryChecklist.length >= 4);
  assert.ok(impactAudit.equivalenceRules.length >= 3);
  assert.ok(impactAudit.orderedTransitionSteps.length >= 5);
  assert.equal(impactAudit.rollbackPlan.command, 'catalyst apig:disable');

  const envSpecs = getRequiredServerEnvSpecs();
  const refreshSpec = envSpecs.find(s => s.name === 'CATALYST_ADMIN_REFRESH_TOKEN');
  assert.equal(refreshSpec?.requiredInExternalOAuth, true);
  assert.equal(refreshSpec?.requiredInHostedNative, false);
});

test('Phase 5.1.1 [PASS-UNIT] Preflight validator supports hosted_native without external OAuth secrets while CLI rejects --live hosted_native fail-closed', async () => {
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);

  // hosted_native preflight passes with ZERO CATALYST_ADMIN_* and ZERO CATALYST_PROJECT_KEY
  const hostedReport = runCatalystConfigPreflight(
    {
      VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
      VIGOR_CORS_MODE: 'platform_managed',
      CATALYST_PROJECT_ID: 'proj_hosted_511',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    },
    { scope: 'full_server_runtime' }
  );

  assert.equal(hostedReport.verdict, 'PASS');
  assert.equal(hostedReport.runtimeAuthMode, 'hosted_native');
  assert.equal(hostedReport.corsMode, 'platform_managed');
  assert.equal(hostedReport.authModeDetected, 'hosted_native');
  assert.equal(hostedReport.networkCallsExecuted, 0);
  assert.equal(hostedReport.writeOperationsExecuted, 0);
  assert.ok(hostedReport.checks.some(c => c.code === 'OK_HOSTED_NATIVE_NO_EXTERNAL_OAUTH'));

  // external_oauth preflight STILL rejects missing CATALYST_PROJECT_KEY and CATALYST_ADMIN_*
  const externalMissingReport = runCatalystConfigPreflight(
    {
      VIGOR_CATALYST_AUTH_MODE: 'external_oauth',
      CATALYST_PROJECT_ID: 'proj_hosted_511',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    },
    { scope: 'full_server_runtime' }
  );
  assert.equal(externalMissingReport.verdict, 'FAIL');
  assert.ok(externalMissingReport.failures.some(f => f.code === 'MISSING_CATALYST_PROJECT_KEY'));
  assert.ok(externalMissingReport.failures.some(f => f.code === 'MISSING_CATALYST_ADMIN_REFRESH_TOKEN'));

  // CLI --preflight --auth-mode hosted_native succeeds locally without external OAuth secrets
  const cliHostedPreflight = await runVerifierCli(
    ['--preflight', '--full-runtime', '--auth-mode', 'hosted_native', '--expected-project', 'proj_hosted_511'],
    {
      VIGOR_CORS_MODE: 'platform_managed',
      CATALYST_PROJECT_ID: 'proj_hosted_511',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    }
  );
  assert.equal(cliHostedPreflight.verdict, 'PASS');

  // CLI --live --confirm-readonly MUST fail closed if --auth-mode hosted_native
  await assert.rejects(
    () =>
      runVerifierCli(
        ['--live', '--confirm-readonly', '--auth-mode', 'hosted_native'],
        {
          CATALYST_PROJECT_ID: 'proj_hosted_511',
          VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
          VIGOR_ENVIRONMENT: 'development',
          CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
          CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
        }
      ),
    /HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO/
  );
});
