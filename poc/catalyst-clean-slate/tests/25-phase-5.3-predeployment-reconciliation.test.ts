/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 25:
 * Pre-Deployment Technical Reconciliation Verification (`docs/33` & `docs/32`):
 * - Concurrent request isolation (`HostedNativeCatalystAuthRuntime` + `AsyncLocalStorage` + `new ZCAuth()`)
 * - 100% Admin-scope `@zcatalyst/nosql@1.0.0` transport across all 5 `createTableProviders()`
 * - Fail-closed absent/invalid context and initialization errors (`503`/`403`)
 * - Sessionless access, RBAC denial, anti-IDOR, admin protection & blocked superadmin atomicity (`hosted_native`)
 * - Real Node.js ESM import check on compiled `dist/server/catalystEntry.js` & staging packaging audit
 * - Documentary completeness for `docs/33-phase-5.3-predeployment-reconciliation.md` & `docs/32`
 *
 * NOTE: Zero remote Zoho Catalyst API calls. Remote checks remain `PENDING_LIVE_VERIFICATION`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NoSQL, NoSQLTable } from '@zcatalyst/nosql';
import {
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
} from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { createTableProviders } from '../src/nosql/providers/index.js';
import { PHASE_5_2_STAGE_1_DEV_INVENTORY } from '../src/provisioning/phase52Stage1Inventory.js';
import {
  PHASE_5_3_EXCLUDED_DEV_DEPENDENCIES,
  PHASE_5_3_RUNTIME_DEPENDENCIES,
} from '../src/provisioning/phase53VigorApiManifest.js';
import {
  HostedNativeCatalystAuthRuntime,
  redactSecretsFromString,
} from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import {
  catalystAdvancedIoEntry,
  resetAdvancedIoRuntimeForTests,
} from '../src/server/catalystEntry.js';
import { KeyBuilders, type UserAccountItem } from '../src/types/cleanSlate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function extractCookieValue(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  const firstPart = setCookieHeader.split(';')[0];
  const eq = firstPart.indexOf('=');
  assert.ok(eq > 0);
  return firstPart.slice(eq + 1);
}

test('Phase 5.3 [PASS-LOOPBACK] Concurrent requests via HostedNativeCatalystAuthRuntime + AsyncLocalStorage never cross-contaminate Admin apps or NoSQL tokens', async () => {
  const capturedBaasAuthHeaders: Array<{ path: string; auth: string; envHeader: string }> = [];

  const baasSpy = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      capturedBaasAuthHeaders.push({
        path: req.url || '',
        auth: String(req.headers.authorization || ''),
        envHeader: String(req.headers['x-zc-environment'] || req.headers['x-catalyst-environment'] || ''),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'success',
          data: {
            size: 1,
            start_key: {},
            get: [{ status: 'CriteriaMismatch' }],
          },
        })
      );
    });
  });

  await new Promise<void>(resolve => baasSpy.listen(0, '127.0.0.1', () => resolve()));
  const spyPort = (baasSpy.address() as { port: number }).port;
  const baasOrigin = `http://127.0.0.1:${spyPort}`;

  const hostedRuntime = HostedNativeCatalystAuthRuntime.fromEnvironment(
    {
      CATALYST_PROJECT_ID: '136967000000014024',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: baasOrigin,
      CATALYST_ACCOUNTS_URL: baasOrigin,
    },
    { allowInsecureLoopbackForTest: true }
  );

  const providers = createTableProviders(() => hostedRuntime.getActiveRequestNoSQLClient());

  const makeEdgeHeaders = (adminToken: string, userToken: string) => ({
    'x-zc-projectid': '136967000000014024',
    'x-zc-project-key': 'edge_key_14024',
    'x-zc-environment': 'Development',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': adminToken,
    'x-zc-user-cred-type': 'token',
    'x-zc-user-cred-token': userToken,
  });

  try {
    const [resultA, resultB] = await Promise.all([
      hostedRuntime.runWithRequestContext(makeEdgeHeaders('adm_req_alpha_tok', 'usr_alpha'), async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        const appA = hostedRuntime.getActiveRequestAdminApp();
        const probeReqA: Record<string, any> = { headers: {} };
        await appA.authenticateRequest(probeReqA);
        await providers.users.fetchUserByUid('u_alpha_1');
        await providers.systemControl.fetchSession('sid_alpha_1');
        return {
          authHeader: (probeReqA.headers.Authorization ?? probeReqA.headers.authorization) as string,
        };
      }),
      hostedRuntime.runWithRequestContext(makeEdgeHeaders('adm_req_beta_tok', 'usr_beta'), async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        const appB = hostedRuntime.getActiveRequestAdminApp();
        const probeReqB: Record<string, any> = { headers: {} };
        await appB.authenticateRequest(probeReqB);
        await providers.userData.fetchEntity('u_beta_1', 'PROFILE');
        await providers.adminInvitations.fetchInvitation('inv_beta_1');
        await providers.auditLogs.fetchByKey({ pk: 'AUDIT#2026-11', sk: '2026-11-20T00:00:00.000Z#ev1' });
        return {
          authHeader: (probeReqB.headers.Authorization ?? probeReqB.headers.authorization) as string,
        };
      }),
    ]);

    assert.equal(resultA.authHeader, 'Zoho-oauthtoken adm_req_alpha_tok');
    assert.equal(resultB.authHeader, 'Zoho-oauthtoken adm_req_beta_tok');

    // All 5 providers hit Catalyst NoSQL strictly using each request's isolated Admin token (never usr_alpha/usr_beta)
    assert.equal(capturedBaasAuthHeaders.length, 5);
    const pathsSeen = capturedBaasAuthHeaders.map(c => c.path);
    for (const tableName of ['Users', 'UserData', 'AdminInvitations', 'AuditLogs', 'SystemControl']) {
      assert.ok(
        pathsSeen.some(p => p.includes(`/nosqltable/${tableName}/item/fetch`)),
        `Expected NoSQL fetch call targeting table ${tableName}`
      );
    }
    for (const call of capturedBaasAuthHeaders) {
      assert.ok(
        call.path.includes('/project/136967000000014024/nosqltable/'),
        `Expected project-scoped BaaS URL path, got ${call.path}`
      );
      assert.ok(
        call.auth === 'Zoho-oauthtoken adm_req_alpha_tok' ||
          call.auth === 'Zoho-oauthtoken adm_req_beta_tok',
        `Unexpected authorization token used by NoSQL provider: ${call.auth}`
      );
      assert.equal(call.auth.includes('usr_'), false);
    }
  } finally {
    await new Promise<void>(resolve => baasSpy.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-UNIT] Fail-closed handling for absent/invalid AsyncLocalStorage context and environment initialization errors', async () => {
  const hostedRuntime = HostedNativeCatalystAuthRuntime.fromEnvironment({
    CATALYST_PROJECT_ID: '136967000000014024',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
  });

  // 1. Outside AsyncLocalStorage request lifecycle -> 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE
  assert.throws(
    () => hostedRuntime.getActiveRequestAdminApp(),
    (err: any) => err?.statusCode === 503 && err?.code === 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE'
  );
  assert.throws(
    () => hostedRuntime.getActiveRequestNoSQLClient(),
    (err: any) => err?.statusCode === 503 && err?.code === 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE'
  );

  // 2. Mismatched environment header -> 403 PROJECT_CONTEXT_MISMATCH
  assert.throws(
    () =>
      hostedRuntime.runWithRequestContext(
        {
          'x-zc-projectid': '136967000000014024',
          'x-zc-environment': 'Production',
          'x-zc-project-key': 'k_1',
          'x-zc-admin-cred-type': 'token',
          'x-zc-admin-cred-token': 'adm_tok_1',
        },
        async () => {}
      ),
    (err: any) => err?.statusCode === 403 && err?.code === 'PROJECT_CONTEXT_MISMATCH'
  );

  // 3. Cross-environment init failure (production VigorCore vs Development Catalyst)
  assert.throws(
    () =>
      HostedNativeCatalystAuthRuntime.fromEnvironment({
        CATALYST_PROJECT_ID: '136967000000014024',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'production',
      }),
    /ENVIRONMENT_SEPARATION_VIOLATION/
  );

  // 4. Lazy catalystEntry fails closed 503 SERVER_CONFIGURATION_UNAVAILABLE without leaking secrets
  resetAdvancedIoRuntimeForTests();
  const prevSecret = process.env.VIGOR_SESSION_HMAC_SECRET;
  const prevAuthMode = process.env.VIGOR_CATALYST_AUTH_MODE;
  const prevProj = process.env.CATALYST_PROJECT_ID;
  delete process.env.VIGOR_SESSION_HMAC_SECRET;
  process.env.VIGOR_CATALYST_AUTH_MODE = 'hosted_native';
  process.env.CATALYST_PROJECT_ID = '136967000000014024';

  const srv = http.createServer(catalystAdvancedIoEntry);
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
  const port = (srv.address() as { port: number }).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/athlete/workspace`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'SERVER_CONFIGURATION_UNAVAILABLE');
    assert.equal(body.success, false);
  } finally {
    if (prevSecret === undefined) delete process.env.VIGOR_SESSION_HMAC_SECRET;
    else process.env.VIGOR_SESSION_HMAC_SECRET = prevSecret;
    if (prevAuthMode === undefined) delete process.env.VIGOR_CATALYST_AUTH_MODE;
    else process.env.VIGOR_CATALYST_AUTH_MODE = prevAuthMode;
    if (prevProj === undefined) delete process.env.CATALYST_PROJECT_ID;
    else process.env.CATALYST_PROJECT_ID = prevProj;
    resetAdvancedIoRuntimeForTests();
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-LOOPBACK] Admin NoSQL scope never substitutes sessionless/RBAC/anti-IDOR/superadmin-atomicity locks in hosted_native mode', async () => {
  const nowSec = 1_765_000_000;
  const nowIso = new Date(nowSec * 1000).toISOString();
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const adapter = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const mockAuth = new MockCatalystAuthRuntime();

  const runtime = createVigorCoreProductionRuntimeFromEnv(
    {
      VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
      VIGOR_CORS_MODE: 'platform_managed',
      CATALYST_PROJECT_ID: '136967000000014024',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: hmacSecret,
      VIGOR_SESSION_ACTIVE_KID: 'k1',
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    },
    {
      allowInsecureLoopbackForTest: true,
      adapterOverride: adapter,
      authRuntimeOverride: mockAuth,
      nowSecProvider: () => nowSec,
      nowMsProvider: () => nowSec * 1000,
    }
  );

  // Confirm liveAtomicityVerifiedForSuperadminMutations defaults to false (superadmin mutations locked)
  assert.equal((runtime.adminService as any).allowSuperadminMutations, false);

  // Seed athlete, admin, and superadmin in Users + active sessions via exchange
  const seedUser = async (
    uid: string,
    email: string,
    role: UserAccountItem['role']
  ): Promise<{ cookie: string; csrf: string }> => {
    await adapter.insertItem('Users', {
      pk: KeyBuilders.userPk(uid),
      uid,
      email,
      normalizedEmail: email.toLowerCase(),
      displayName: `${role} User`,
      role,
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      directorySegment: 'USER_SEG#0',
      onboardingCompleted: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    });
    mockAuth.seedUserDetails({
      zuid: `z_${uid}`,
      user_id: uid,
      email_id: email,
      status: 'ACTIVE',
      is_confirmed: true,
      first_name: role,
      last_name: 'Tester',
    });
    mockAuth.setCurrentUser({
      zuid: `z_${uid}`,
      user_id: uid,
      email_id: email,
      status: 'ACTIVE',
      is_confirmed: true,
      first_name: role,
      last_name: 'Tester',
    });

    const hostedEdgeHeaders = {
      'x-zc-projectid': '136967000000014024',
      'x-zc-environment': 'Development',
      'x-zc-project-key': 'edge_key_14024',
      'x-zc-admin-cred-type': 'token',
      'x-zc-admin-cred-token': 'adm_edge_loopback_tok',
      'x-zc-user-cred-type': 'token',
      'x-zc-user-cred-token': `usr_tok_${uid}`,
    };
    const issued = await runtime.hostedRuntime!.runWithRequestContext(hostedEdgeHeaders, async () => {
      const actor = await runtime.authGuard.authenticate({ headers: hostedEdgeHeaders });
      return runtime.authGuard.issueSignedSession(actor);
    });
    return {
      cookie: extractCookieValue(issued.setCookieHeader),
      csrf: issued.csrfToken,
    };
  };

  const athleteAuth = await seedUser('u_ath_53', 'athlete53@vigorcore.lat', 'athlete');
  const adminAuth = await seedUser('u_adm_53', 'admin53@vigorcore.lat', 'admin');
  const superAuth = await seedUser('u_sup_53', 'super53@vigorcore.lat', 'superadmin');
  mockAuth.setCurrentUser(null);

  await adapter.insertItem('Users', {
    pk: KeyBuilders.userPk('u_sup2_53'),
    uid: 'u_sup2_53',
    email: 'super2_53@vigorcore.lat',
    normalizedEmail: 'super2_53@vigorcore.lat',
    displayName: 'Second Superadmin',
    role: 'superadmin',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    directorySegment: 'USER_SEG#1',
    onboardingCompleted: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  });

  // Seed a meal under another athlete u_other_53 to prove anti-IDOR partition isolation
  await adapter.insertItem('UserData', {
    pk: KeyBuilders.userPk('u_other_53'),
    sk: 'MEAL#2026-11-20T09:00:00.000Z#m_other',
    entityType: 'MEAL',
    entityDateKey: 'MEAL#2026-11-20',
    payload: { id: 'm_other', name: 'Other Athlete Meal', kcal: 999 },
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const server = http.createServer(runtime.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = 'https://app.vigorcore.lat';

  const platformHeaders = {
    Origin: origin,
    'Sec-Fetch-Site': 'same-site',
    'x-zc-projectid': '136967000000014024',
    'x-zc-environment': 'Development',
    'x-zc-project-key': 'edge_key_14024',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'adm_edge_loopback_tok',
  };

  try {
    // 1. Sessionless access EVEN WITH valid x-zc-admin-cred-token -> 401/403 (Admin NoSQL scope NEVER grants access)
    const noSessionWorkspace = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: platformHeaders,
    });
    assert.equal(noSessionWorkspace.status, 401);

    const noSessionAdmin = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: platformHeaders,
    });
    assert.equal(noSessionAdmin.status, 401);

    // 2. Missing RBAC: athlete calling admin routes -> 403 PERMISSION_DENIED
    const athleteOnAdminList = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: { ...platformHeaders, Cookie: `__Host-vigor_session=${athleteAuth.cookie}` },
    });
    assert.equal(athleteOnAdminList.status, 403);
    assert.equal(((await athleteOnAdminList.json()) as any).error, 'PERMISSION_DENIED');

    const athleteOnRoleChange = await fetch(`${baseUrl}/api/v1/admin/users/u_adm_53/role`, {
      method: 'POST',
      headers: {
        ...platformHeaders,
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': athleteAuth.csrf,
        Cookie: `__Host-vigor_session=${athleteAuth.cookie}`,
      },
      body: JSON.stringify({ newRole: 'admin' }),
    });
    assert.equal(athleteOnRoleChange.status, 403);
    assert.equal(((await athleteOnRoleChange.json()) as any).error, 'PERMISSION_DENIED');

    // 3. Admin RBAC escalation boundaries: admin cannot invite admin, cannot setRole, cannot suspend superadmin
    const adminInviteAdmin = await fetch(`${baseUrl}/api/v1/admin/invitations`, {
      method: 'POST',
      headers: {
        ...platformHeaders,
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': adminAuth.csrf,
        Cookie: `__Host-vigor_session=${adminAuth.cookie}`,
      },
      body: JSON.stringify({ targetEmail: 'newadmin@vigorcore.lat', targetRole: 'admin' }),
    });
    assert.equal(adminInviteAdmin.status, 403);
    assert.equal(((await adminInviteAdmin.json()) as any).error, 'PRIVILEGE_ESCALATION_BLOCKED');

    const adminSuspendSuper = await fetch(`${baseUrl}/api/v1/admin/users/u_sup_53/status`, {
      method: 'POST',
      headers: {
        ...platformHeaders,
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': adminAuth.csrf,
        Cookie: `__Host-vigor_session=${adminAuth.cookie}`,
      },
      body: JSON.stringify({ newStatus: 'suspended', reason: 'escalation test' }),
    });
    assert.equal(adminSuspendSuper.status, 403);
    assert.equal(((await adminSuspendSuper.json()) as any).error, 'SUPERADMIN_TARGET_PROTECTED');

    // 4. Anti-IDOR: athlete spoofing targetUid/uid/role -> 403 IDENTITY_SPOOFING_REJECTED; meals list only sees caller partition
    const idorAttempt = await fetch(`${baseUrl}/api/v1/athlete/meals?targetUid=u_other_53&startDate=2026-11-01&endDate=2026-11-30`, {
      headers: { ...platformHeaders, Cookie: `__Host-vigor_session=${athleteAuth.cookie}` },
    });
    assert.equal(idorAttempt.status, 403);
    assert.equal(((await idorAttempt.json()) as any).error, 'IDENTITY_SPOOFING_REJECTED');

    const athleteOwnMeals = await fetch(`${baseUrl}/api/v1/athlete/meals?startDate=2026-11-01&endDate=2026-11-30`, {
      headers: { ...platformHeaders, Cookie: `__Host-vigor_session=${athleteAuth.cookie}` },
    });
    assert.equal(athleteOwnMeals.status, 200);
    const ownMealsJson = (await athleteOwnMeals.json()) as any;
    assert.equal(Array.isArray(ownMealsJson.items), true);
    assert.equal(ownMealsJson.items.length, 0); // u_other_53 meal is never visible

    // 5. Superadmin Atomicity Lock: even authenticated superadmin is blocked from superadmin role/status mutations
    const superPromoteToSuper = await fetch(`${baseUrl}/api/v1/admin/users/u_adm_53/role`, {
      method: 'POST',
      headers: {
        ...platformHeaders,
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': superAuth.csrf,
        Cookie: `__Host-vigor_session=${superAuth.cookie}`,
      },
      body: JSON.stringify({ newRole: 'superadmin', idempotencyKey: 'idem_super_53_1' }),
    });
    assert.equal(superPromoteToSuper.status, 403);
    assert.equal(
      ((await superPromoteToSuper.json()) as any).error,
      'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED'
    );

    const superSuspendSuper = await fetch(`${baseUrl}/api/v1/admin/users/u_sup2_53/status`, {
      method: 'POST',
      headers: {
        ...platformHeaders,
        'Content-Type': 'application/json',
        'X-Vigor-CSRF': superAuth.csrf,
        Cookie: `__Host-vigor_session=${superAuth.cookie}`,
      },
      body: JSON.stringify({ newStatus: 'suspended', reason: 'atomicity lock verification' }),
    });
    assert.equal(superSuspendSuper.status, 403);
    assert.equal(
      ((await superSuspendSuper.json()) as any).error,
      'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED'
    );

    // Superadmin bootstrap endpoint must remain non-existent in HTTP router
    const bootstrapGet = await fetch(`${baseUrl}/api/v1/bootstrap-superadmin`, {
      headers: { ...platformHeaders, Cookie: `__Host-vigor_session=${superAuth.cookie}` },
    });
    assert.equal(bootstrapGet.status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-UNIT] Installed @zcatalyst/nosql@1.0.0 supports Table ID & Name with Admin scope; dist ESM entrypoint & staging packaging audited', async () => {
  // 1. Verify @zcatalyst/nosql@1.0.0 package & Admin credential usage
  const nosqlPkgPath = path.join(POC_ROOT, 'node_modules', '@zcatalyst', 'nosql', 'package.json');
  const nosqlPkg = JSON.parse(fs.readFileSync(nosqlPkgPath, 'utf8'));
  assert.equal(nosqlPkg.version, '1.0.0');

  const nosqlIndexJs = fs.readFileSync(
    path.join(POC_ROOT, 'node_modules', '@zcatalyst', 'nosql', 'dist-es', 'index.js'),
    'utf8'
  );
  const nosqlTableJs = fs.readFileSync(
    path.join(POC_ROOT, 'node_modules', '@zcatalyst', 'nosql', 'dist-es', 'table.js'),
    'utf8'
  );
  assert.ok(nosqlIndexJs.includes('CREDENTIAL_USER.admin'));
  assert.ok(nosqlTableJs.includes('CREDENTIAL_USER.admin'));

  // Instantiate NoSQL against a minimal dummy CatalystApp config and confirm both table name & Table ID work synchronously
  const nosql = new NoSQL({
    config: {
      projectId: '136967000000014024',
      projectKey: 'dummy_key',
      environment: 'Development',
      apiDomain: 'https://api.catalyst.zoho.com',
      authPortalDomain: 'https://accounts.zoho.com',
    },
    credential: { authenticateRequest: async () => {} },
    authenticateRequest: async () => {},
  } as any);
  assert.ok(nosql.table('Users') instanceof NoSQLTable);
  assert.ok(nosql.table('136967000000065001') instanceof NoSQLTable);

  // 2. Audit poc/catalyst-clean-slate/package.json & package-lock.json packaging realities
  const pocPkg = JSON.parse(fs.readFileSync(path.join(POC_ROOT, 'package.json'), 'utf8'));
  assert.equal(pocPkg.type, 'module');
  assert.equal(pocPkg.main, undefined, 'Root POC package.json currently omits main (documented in AUD-53-01)');
  const lockPath = path.join(POC_ROOT, 'package-lock.json');
  assert.equal(fs.existsSync(lockPath), true, 'Root POC contains package-lock.json');
  const pocLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(pocLock.name, 'vigorcore-catalyst-clean-slate');
  assert.ok(pocLock.packages?.['']?.devDependencies, 'Root lockfile includes devDependencies so staging bundle installs prod deps cleanly');
  assert.deepEqual(Object.keys(pocPkg.dependencies).sort(), [...PHASE_5_3_RUNTIME_DEPENDENCIES].sort());
  assert.deepEqual(Object.keys(pocPkg.devDependencies).sort(), [...PHASE_5_3_EXCLUDED_DEV_DEPENDENCIES].sort());

  // 3. Real dynamic ESM import of compiled dist/server/catalystEntry.js in Node 22+
  const distEntryPath = path.join(POC_ROOT, 'dist', 'server', 'catalystEntry.js');
  assert.equal(
    fs.existsSync(distEntryPath),
    true,
    'Expected compiled dist/server/catalystEntry.js (run npm run build:server)'
  );

  const imported = await import(pathToFileURL(distEntryPath).href);
  assert.equal(typeof imported.default, 'function');
  assert.equal(typeof imported.catalystAdvancedIoEntry, 'function');
  assert.equal(imported.default, imported.catalystAdvancedIoEntry);
  assert.equal(imported.default.length, 2, 'Advanced I/O handler expects (req, res)');

  // Verify zero secret leakage in built dist files
  const distEntrySource = fs.readFileSync(distEntryPath, 'utf8');
  assert.equal(/1000\.[A-Za-z0-9]{10,}/.test(distEntrySource), false);
  assert.equal(redactSecretsFromString(distEntrySource), distEntrySource);
});

test('Phase 5.3 [PASS-STATIC] docs/33 & docs/32 satisfy pre-deployment reconciliation checklist and PS 5.1 safety', () => {
  const doc33Path = path.join(POC_ROOT, 'docs', '33-phase-5.3-predeployment-reconciliation.md');
  const doc32Path = path.join(POC_ROOT, 'docs', '32-phase-5.3-vigor-api-implementation-runbook.md');
  assert.equal(fs.existsSync(doc33Path), true, 'Missing docs/33-phase-5.3-predeployment-reconciliation.md');
  assert.equal(fs.existsSync(doc32Path), true, 'Missing docs/32-phase-5.3-vigor-api-implementation-runbook.md');

  const doc33 = fs.readFileSync(doc33Path, 'utf8');
  const doc32 = fs.readFileSync(doc32Path, 'utf8');

  const requiredMarkers33 = [
    'Project-Rainfall',
    '136967000000014024',
    'PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED',
    'PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED',
    'PENDING_LIVE_VERIFICATION',
    'BLOCKED_PENDING_ZOHO_CLARIFICATION',
    'hostedRuntime.getActiveRequestNoSQLClient()',
    'createTableProviders()',
    'AsyncLocalStorage',
    'ZCAuth',
    '@zcatalyst/nosql@1.0.0',
    'package-lock.json',
    'dist/server/catalystEntry.js',
    'Function URL',
    'SameSite=Strict',
    '__Host-vigor_session',
    'X-Vigor-CSRF',
    'liveAtomicityVerifiedForSuperadminMutations',
    'SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED',
    'executeOfflineAdminBootstrap',
    'admin.users.setRole',
    'admin.users.setStatus',
  ];

  for (const marker of requiredMarkers33) {
    assert.ok(doc33.includes(marker), `docs/33 missing required marker: ${marker}`);
  }

  for (const table of PHASE_5_2_STAGE_1_DEV_INVENTORY.tables) {
    assert.ok(doc33.includes(table.tableName), `docs/33 missing table name: ${table.tableName}`);
    assert.ok(doc33.includes(table.tableId), `docs/33 missing Table ID: ${table.tableId}`);
  }

  assert.ok(
    doc32.includes('PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED'),
    'docs/32 must cross-reference PHASE_5_3_PREDEPLOYMENT_RECONCILIATION_READY_NOT_EXECUTED'
  );
  assert.ok(
    doc32.includes('docs/33-phase-5.3-predeployment-reconciliation.md'),
    'docs/32 must reference docs/33-phase-5.3-predeployment-reconciliation.md'
  );

  for (const docContent of [doc32, doc33]) {
    const psBlocks = [...docContent.matchAll(/```powershell\r?\n([\s\S]*?)```/g)].map(m => m[1]);
    for (const block of psBlocks) {
      assert.equal(block.includes('&&'), false, 'PowerShell 5.1 block must NOT contain &&');
      assert.equal(block.includes('||'), false, 'PowerShell 5.1 block must NOT contain ||');
    }
  }
});
