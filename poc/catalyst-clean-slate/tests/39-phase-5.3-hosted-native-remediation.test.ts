/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 39:
 * Forensic Finding & Hosted-Native Admin Context Remediation Verification (`vigor_api`),
 * All 10 Prompt Security/Regression Scenarios (SDK call counts + exact NoSQL table ops),
 * Reproducible Deployment Candidate (`vigor_api-hosted-admin-remediated-portable.zip`),
 * Byte-Identical Preservation of Prior Candidates, Extracted Node 22 Runtime Execution,
 * and `docs/46` Forensic Report Completeness.
 *
 * Strictly local (`127.0.0.1:0` only). Zero remote Catalyst operations.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildReproduciblePortablePackage,
  compareContentManifests,
  createDeterministicPortableZip,
  extractCanonicalContentManifest,
  PHASE_5_9_CANDIDATE_ZIP_NAME,
  parseZipEntries,
} from '../scripts/build-vigor-api-portable-package.js';
import { AuthGuardError, ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  type AdminSpoofDiagnosticEvent,
} from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { KeyBuilders, type SessionRecordItem, type UserAccountItem } from '../src/types/cleanSlate.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');

const ORIGINAL_CANDIDATE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-reconciled-portable.zip');
const ORIGINAL_CANDIDATE_SHA256 = 'd268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319';

const DIAGNOSTIC_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-forensic-diagnostic-portable.zip');
const DIAGNOSTIC_SHA256 = 'c9ade1264bc340560d1b503544162df50d78cf41949ecb37642a416caf8b2839';

const REMEDIATED_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-hosted-admin-remediated-portable.zip');
const REMEDIATED_MANIFEST_PATH = path.join(
  ARTIFACTS_DIR,
  'vigor_api-hosted-admin-remediated-portable.manifest.json'
);
const EXPECTED_REMEDIATED_ENTRY_COUNT = 905;
const EXPECTED_REMEDIATED_UNCOMPRESSED_BYTES = 3_768_912;
const EXPECTED_REMEDIATED_SIZE_BYTES = 1_281_449;
const EXPECTED_REMEDIATED_SHA256 = '6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildHostedEnv(apiDomain: string, secret?: string): Record<string, string> {
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

function edgeAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-zc-projectid': '136967000000014024',
    'x-zc-environment': 'Development',
    'x-zc-project-key': 'SECRET_EDGE_PROJECT_KEY_39',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'SECRET_EDGE_ADMIN_TOKEN_39',
    ...extra,
  };
}

function startConfigurableBaaSSpy(usersByUserToken: Record<string, { user_id: string; email_id: string; zuid: string }>) {
  const userCurrentCalls: Array<{ url: string; userTypeHeader?: string; userTokenHeader?: string }> = [];
  const userDetailsCalls: Array<{ url: string }> = [];

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    req.resume();
    req.on('end', () => {
      if (url.includes('/project-user/current') && method === 'GET') {
        const userTok = typeof req.headers['x-zc-user-cred-token'] === 'string'
          ? req.headers['x-zc-user-cred-token']
          : typeof req.headers['authorization'] === 'string'
          ? req.headers['authorization']
          : '';
        const xUser = typeof req.headers['x-catalyst-user'] === 'string'
          ? req.headers['x-catalyst-user']
          : undefined;
        userCurrentCalls.push({ url, userTypeHeader: xUser, userTokenHeader: userTok });

        const matched = Object.entries(usersByUserToken).find(([tok]) => userTok.includes(tok))?.[1];
        if (matched) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'success',
              data: {
                zuid: matched.zuid,
                user_id: matched.user_id,
                email_id: matched.email_id,
                first_name: 'Verified',
                last_name: 'Athlete39',
                status: 'ACTIVE',
                is_confirmed: true,
              },
            })
          );
          return;
        }

        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure', message: 'Invalid user session' }));
        return;
      }

      if (url.includes('/project-user/') && method === 'GET') {
        userDetailsCalls.push({ url });
        const matched = Object.values(usersByUserToken)[0];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              zuid: matched?.zuid ?? '1001',
              user_id: matched?.user_id ?? 'u_real_user_39',
              email_id: matched?.email_id ?? 'athlete39@vigorcore.lat',
              first_name: 'Verified',
              last_name: 'Athlete39',
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
    userDetailsCalls,
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

function instrumentPerTableNoSql() {
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  const tableCounts: Record<string, { fetch: number; insert: number; update: number; delete: number; query: number }> = {};

  const record = (table: string, op: 'fetch' | 'insert' | 'update' | 'delete' | 'query') => {
    if (!tableCounts[table]) {
      tableCounts[table] = { fetch: 0, insert: 0, update: 0, delete: 0, query: 0 };
    }
    tableCounts[table][op]++;
  };

  const origFetch = adapter.fetchItem.bind(adapter);
  const origInsert = adapter.insertItem.bind(adapter);
  const origUpdate = adapter.updateItem.bind(adapter);
  const origDelete = adapter.deleteItem.bind(adapter);
  const origQuery = adapter.queryTable.bind(adapter);

  adapter.fetchItem = (async (table: Parameters<typeof origFetch>[0], ...rest) => {
    record(table, 'fetch');
    return origFetch(table, ...rest);
  }) as typeof adapter.fetchItem;

  adapter.insertItem = (async (table: Parameters<typeof origInsert>[0], ...rest) => {
    record(table, 'insert');
    return origInsert(table, ...rest);
  }) as typeof adapter.insertItem;

  adapter.updateItem = (async (table: Parameters<typeof origUpdate>[0], ...rest) => {
    record(table, 'update');
    return origUpdate(table, ...rest);
  }) as typeof adapter.updateItem;

  adapter.deleteItem = (async (table: Parameters<typeof origDelete>[0], ...rest) => {
    record(table, 'delete');
    return origDelete(table, ...rest);
  }) as typeof adapter.deleteItem;

  adapter.queryTable = (async (table: Parameters<typeof origQuery>[0], ...rest) => {
    record(table, 'query');
    return origQuery(table, ...rest);
  }) as typeof adapter.queryTable;

  return {
    adapter,
    seedDirectly: origInsert,
    getTableCounts: () => tableCounts,
    getTotalOps: () =>
      Object.values(tableCounts).reduce(
        (sum, c) => sum + c.fetch + c.insert + c.update + c.delete + c.query,
        0
      ),
    resetCounts: () => {
      for (const k of Object.keys(tableCounts)) delete tableCounts[k];
    },
  };
}

test('Phase 5.3 [PASS-LOOPBACK] All 10 Hosted-Native & External-OAuth remediation scenarios verify SDK call counts, NoSQL table ops, security invariants, and zero credential leaks', async () => {
  const realUserId = 'u_real_athlete_39';
  const realUserToken = 'SECRET_CATALYST_ENDUSER_TOKEN_39';
  const platformOpaqueToken = 'SECRET_CATALYST_PLATFORM_OPAQUE_TOKEN_39';

  const baas = startConfigurableBaaSSpy({
    [realUserToken]: {
      user_id: realUserId,
      email_id: 'athlete39@vigorcore.lat',
      zuid: '99393939',
    },
  });
  const baasOrigin = await baas.start();
  const dbProbe = instrumentPerTableNoSql();

  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  let mutableNowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(mutableNowSec * 1000).toISOString();

  const hostedLogs: string[] = [];
  const origWarn = console.warn;

  const userItem: UserAccountItem = {
    pk: KeyBuilders.userPk(realUserId),
    uid: realUserId,
    email: 'athlete39@vigorcore.lat',
    normalizedEmail: 'athlete39@vigorcore.lat',
    displayName: 'Athlete Remediation 39',
    role: 'athlete',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: KeyBuilders.directorySegment(realUserId),
    onboardingCompleted: true,
    onboardingStep: 4,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  };
  await dbProbe.seedDirectly('Users', userItem);

  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedEnv(baasOrigin, hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: dbProbe.adapter,
    nowSecProvider: () => mutableNowSec,
  });

  const activeIssued = bundle.sessionTokens.issueTokenWithClaims(realUserId, 1, 12 * 3600);
  const activeCsrf = bundle.sessionTokens.issueCsrfToken(
    realUserId,
    activeIssued.claims.sid,
    1,
    activeIssued.claims.exp
  );
  const activeSessionRec: SessionRecordItem = {
    pk: KeyBuilders.sessionPk(activeIssued.claims.sid),
    sid: activeIssued.claims.sid,
    ownerUserId: realUserId,
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: activeIssued.claims.iat,
    initialAuthAtEpochSec: activeIssued.claims.iat,
    expiresAt: new Date(activeIssued.claims.exp * 1000).toISOString(),
    expiresAtEpochSec: activeIssued.claims.exp,
    absoluteExpiresAtEpochSec: activeIssued.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: mutableNowSec,
    status: 'active',
    ttlEpochSec: activeIssued.claims.iat + 48 * 3600,
  };
  await dbProbe.seedDirectly('SystemControl', activeSessionRec);

  const revokedIssued = bundle.sessionTokens.issueTokenWithClaims(realUserId, 1, 12 * 3600);
  await dbProbe.seedDirectly('SystemControl', {
    pk: KeyBuilders.sessionPk(revokedIssued.claims.sid),
    sid: revokedIssued.claims.sid,
    ownerUserId: realUserId,
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: revokedIssued.claims.iat,
    initialAuthAtEpochSec: revokedIssued.claims.iat,
    expiresAt: new Date(revokedIssued.claims.exp * 1000).toISOString(),
    expiresAtEpochSec: revokedIssued.claims.exp,
    absoluteExpiresAtEpochSec: revokedIssued.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: mutableNowSec,
    status: 'revoked',
    revokedAt: nowIso,
    revocationReason: 'manual_logout',
    ttlEpochSec: revokedIssued.claims.iat + 48 * 3600,
  });

  const expiredIssued = bundle.sessionTokens.issueTokenWithClaims(realUserId, 1, 12 * 3600);
  await dbProbe.seedDirectly('SystemControl', {
    pk: KeyBuilders.sessionPk(expiredIssued.claims.sid),
    sid: expiredIssued.claims.sid,
    ownerUserId: realUserId,
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: expiredIssued.claims.iat,
    initialAuthAtEpochSec: expiredIssued.claims.iat,
    expiresAt: new Date((mutableNowSec - 10) * 1000).toISOString(),
    expiresAtEpochSec: mutableNowSec - 10,
    absoluteExpiresAtEpochSec: expiredIssued.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: mutableNowSec,
    status: 'active',
    ttlEpochSec: expiredIssued.claims.iat + 48 * 3600,
  });

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  console.warn = (...args: unknown[]) => {
    hostedLogs.push(args.map(String).join(' '));
  };

  try {
    // Scenario 1: Hosted-native anonymous request WITH platform admin context AND nonempty opaque platform token
    dbProbe.resetCounts();
    baas.resetCalls();
    const s1 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
    });
    const s1Text = await s1.text();
    assert.equal(s1.status, 401);
    assert.equal((JSON.parse(s1Text) as { error?: string }).error, 'UNAUTHENTICATED');
    assert.equal(baas.userCurrentCalls.length, 0, 'Must NEVER call UserManagement.getCurrentUser()');
    assert.equal(dbProbe.getTotalOps(), 0, 'Must perform ZERO NoSQL operations');

    // Scenario 2: Hosted-native anonymous request WITH platform admin context and NO user token
    dbProbe.resetCounts();
    baas.resetCalls();
    const s2 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    const s2Text = await s2.text();
    assert.equal(s2.status, 401);
    assert.equal((JSON.parse(s2Text) as { error?: string }).error, 'UNAUTHENTICATED');
    assert.equal(baas.userCurrentCalls.length, 0);
    assert.equal(dbProbe.getTotalOps(), 0);

    // Scenario 3: Actual authenticated Catalyst project end-user (x-zc-user-type: 'user' or omitted + valid user token)
    dbProbe.resetCounts();
    baas.resetCalls();
    const s3 = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'user',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': realUserToken,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(s3.status, 200);
    const s3Body = (await s3.json()) as { success?: boolean; actor?: { catalystUserId?: string } };
    assert.equal(s3Body.success, true);
    assert.equal(s3Body.actor?.catalystUserId, realUserId);
    assert.equal(baas.userCurrentCalls.length, 1, 'Authenticated Catalyst user MUST verify via BaaS user scope');
    assert.equal(dbProbe.getTableCounts().Users?.fetch, 1);
    assert.equal(dbProbe.getTableCounts().SystemControl?.insert, 1);

    // Scenario 4: Admin execution marker MUST NOT grant user identity OR admin privileges
    dbProbe.resetCounts();
    baas.resetCalls();
    const s4AdminUsers = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: edgeAdminHeaders({
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': platformOpaqueToken,
      }),
    });
    assert.equal(s4AdminUsers.status, 401);
    assert.equal(((await s4AdminUsers.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    const s4Exchange = await fetch(`${baseUrl}/api/v1/auth/session/exchange`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
      body: JSON.stringify({}),
    });
    assert.equal(s4Exchange.status, 401);
    assert.equal(((await s4Exchange.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    assert.equal(baas.userCurrentCalls.length, 0);
    assert.equal(dbProbe.getTotalOps(), 0);

    // Scenario 5: Valid __Host-vigor_session HMAC + x-zc-user-type=admin + opaque platform token -> 200 OK, ZERO BaaS calls, consistent_read Users & SystemControl
    dbProbe.resetCounts();
    baas.resetCalls();
    const s5 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${activeIssued.token}`,
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
    });
    assert.equal(s5.status, 200);
    assert.equal(baas.userCurrentCalls.length, 0, 'HMAC Path 3 MUST NOT call UserManagement.getCurrentUser()');
    // 1 consistent_read in CleanSlateAuthGuard.authenticate() + 1 workspace lookup in route handler
    assert.equal(dbProbe.getTableCounts().Users?.fetch, 2);
    assert.equal(dbProbe.getTableCounts().SystemControl?.fetch, 1);

    // Scenario 6: Forged or tampered __Host-vigor_session + x-zc-user-type=admin + opaque platform token -> 401 INVALID_SIGNED_SESSION, 0 BaaS, 0 NoSQL
    dbProbe.resetCounts();
    baas.resetCalls();
    const tamperedToken = `${activeIssued.token.slice(0, -4)}AAAA`;
    const s6 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${tamperedToken}`,
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-type': 'token',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
    });
    assert.equal(s6.status, 401);
    assert.equal(((await s6.json()) as { error?: string }).error, 'INVALID_SIGNED_SESSION');
    assert.equal(baas.userCurrentCalls.length, 0);
    assert.equal(dbProbe.getTotalOps(), 0);

    // Scenario 7: Valid HMAC + revoked/expired/stale sessionEpoch + CSRF + athlete RBAC denial
    const s7Revoked = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${revokedIssued.token}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s7Revoked.status, 401);
    assert.equal(((await s7Revoked.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');

    const s7Expired = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${expiredIssued.token}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s7Expired.status, 401);
    assert.equal(((await s7Expired.json()) as { error?: string }).error, 'INVALID_SIGNED_SESSION');

    const staleEpochIssued = bundle.sessionTokens.issueTokenWithClaims(realUserId, 1, 12 * 3600);
    await dbProbe.seedDirectly('SystemControl', {
      pk: KeyBuilders.sessionPk(staleEpochIssued.claims.sid),
      sid: staleEpochIssued.claims.sid,
      ownerUserId: realUserId,
      sessionEpoch: 1,
      issuedAt: nowIso,
      issuedAtEpochSec: staleEpochIssued.claims.iat,
      initialAuthAtEpochSec: staleEpochIssued.claims.iat,
      expiresAt: new Date(staleEpochIssued.claims.exp * 1000).toISOString(),
      expiresAtEpochSec: staleEpochIssued.claims.exp,
      absoluteExpiresAtEpochSec: staleEpochIssued.claims.iat + 24 * 3600,
      lastCatalystCheckAtEpochSec: mutableNowSec,
      status: 'active',
      ttlEpochSec: staleEpochIssued.claims.iat + 48 * 3600,
    });
    await dbProbe.adapter.updateItem('Users', { pk: KeyBuilders.userPk(realUserId) }, { sessionEpoch: 2 });

    const s7StaleEpoch = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${staleEpochIssued.token}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
    });
    assert.equal(s7StaleEpoch.status, 401);
    assert.equal(((await s7StaleEpoch.json()) as { error?: string }).error, 'SESSION_REVOKED_REAUTH_REQUIRED');

    // Restore user sessionEpoch=1 for CSRF + RBAC verification
    await dbProbe.adapter.updateItem('Users', { pk: KeyBuilders.userPk(realUserId) }, { sessionEpoch: 1 });

    const s7MissingCsrf = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${activeIssued.token}`,
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
      body: JSON.stringify({ displayName: 'Blocked Without CSRF' }),
    });
    assert.equal(s7MissingCsrf.status, 403);
    assert.equal(((await s7MissingCsrf.json()) as { error?: string }).error, 'CSRF_TOKEN_MISSING');

    const s7RbacDenied = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: {
        cookie: `__Host-vigor_session=${activeIssued.token}`,
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
    });
    assert.equal(s7RbacDenied.status, 403);

    // Scenario 8: Unauthenticated requests trigger ZERO NoSQL operations across reads and mutations
    dbProbe.resetCounts();
    const s8Bootstrap = await fetch(`${baseUrl}/api/v1/auth/session/bootstrap-profile`, {
      method: 'POST',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
      body: JSON.stringify({ displayName: 'Anon Bootstrap' }),
    });
    assert.equal(s8Bootstrap.status, 401);
    assert.equal(((await s8Bootstrap.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    const s8Mutation = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-site',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-user-cred-token': platformOpaqueToken,
        }),
      },
      body: JSON.stringify({ displayName: 'Anon Mutation' }),
    });
    assert.ok(s8Mutation.status === 401 || s8Mutation.status === 403);
    assert.equal(dbProbe.getTotalOps(), 0);

    // Scenario 9: Zero secret/credential leakage in response bodies or logs
    const combinedOutput = [s1Text, s2Text, ...hostedLogs].join('\n');
    for (const secret of [
      platformOpaqueToken,
      realUserToken,
      'SECRET_EDGE_ADMIN_TOKEN_39',
      'SECRET_EDGE_PROJECT_KEY_39',
      hmacSecret,
    ]) {
      assert.equal(combinedOutput.includes(secret), false, `Credential leaked in output/logs: ${secret}`);
    }

    // Scenario 10: External-OAuth (`CatalystSeparatedAuthRuntime`) retains exact separated rules
    const sepDiagEvents: AdminSpoofDiagnosticEvent[] = [];
    const sepProvider = new CatalystAdminAppProvider({
      projectId: '136967000000014024',
      projectKey: 'SECRET_EXT_PROJ_KEY_39',
      catalystEnvironment: 'Development',
      apiDomain: baasOrigin,
      accountsUrl: 'https://accounts.zoho.com',
      clientId: 'cli_39',
      clientSecret: 'SECRET_CLI_39',
      refreshToken: 'SECRET_REF_39',
      allowInsecureLoopbackForTest: true,
    });
    const sepRuntime = new CatalystSeparatedAuthRuntime({
      adminProvider: sepProvider,
      diagnosticLogger: entry => sepDiagEvents.push(entry),
    });

    baas.resetCalls();
    assert.equal(
      await sepRuntime.getCurrentUserFromRequest({
        headers: {
          'x-zc-projectid': '136967000000014024',
          'x-zc-user-type': 'admin',
        },
      }),
      null
    );
    assert.equal(baas.userCurrentCalls.length, 0);

    await assert.rejects(
      () =>
        sepRuntime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': '136967000000014024',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': 'SECRET_EXT_SPOOF_TOK_39',
          },
        }),
      (err: unknown) =>
        err instanceof AuthGuardError &&
        err.code === 'CATALYST_ADMIN_HEADER_SPOOFED' &&
        err.statusCode === 403
    );
    assert.equal(sepDiagEvents.length, 1);
    assert.equal(sepDiagEvents[0].authRuntimeMode, 'external_oauth');
    assert.equal(baas.userCurrentCalls.length, 0);
  } finally {
    console.warn = origWarn;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baas.close();
  }
});

test('Phase 5.3 [PASS-LOCAL] Remediated deployment candidate ZIP is reproducible, preserves both prior ZIPs untouched, has 1-file delta vs diagnostic ZIP, and executes on Node 22', async () => {
  // 1. Both previous candidates MUST remain untouched and byte-identical
  assert.equal(fs.existsSync(ORIGINAL_CANDIDATE_ZIP_PATH), true);
  assert.equal(sha256File(ORIGINAL_CANDIDATE_ZIP_PATH), ORIGINAL_CANDIDATE_SHA256);
  assert.equal(fs.existsSync(DIAGNOSTIC_ZIP_PATH), true);
  assert.equal(sha256File(DIAGNOSTIC_ZIP_PATH), DIAGNOSTIC_SHA256);

  // 2. Remediated ZIP & manifest exist and pass CRC / manifest / SHA / diff checks
  assert.equal(fs.existsSync(REMEDIATED_ZIP_PATH), true);
  assert.equal(fs.existsSync(REMEDIATED_MANIFEST_PATH), true);
  assert.equal(fs.statSync(REMEDIATED_ZIP_PATH).size, EXPECTED_REMEDIATED_SIZE_BYTES);
  assert.equal(sha256File(REMEDIATED_ZIP_PATH), EXPECTED_REMEDIATED_SHA256);
  execSync(`unzip -tq ${JSON.stringify(REMEDIATED_ZIP_PATH)}`, { stdio: 'ignore' });

  const entries = parseZipEntries(REMEDIATED_ZIP_PATH);
  assert.equal(entries.length, EXPECTED_REMEDIATED_ENTRY_COUNT);

  const remManifest = extractCanonicalContentManifest(REMEDIATED_ZIP_PATH);
  const diskManifest = JSON.parse(fs.readFileSync(REMEDIATED_MANIFEST_PATH, 'utf8'));
  assert.deepEqual(remManifest, diskManifest);
  assert.equal(
    remManifest.reduce((s, e) => s + e.uncompressedSize, 0),
    EXPECTED_REMEDIATED_UNCOMPRESSED_BYTES
  );

  // Exact 1-file compiled delta vs diagnostic candidate ZIP
  const diagManifest = extractCanonicalContentManifest(DIAGNOSTIC_ZIP_PATH);
  const diff = compareContentManifests(diagManifest, remManifest);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.unexpected, []);
  assert.deepEqual(
    diff.changed.map(c => c.path),
    ['dist/sdk/catalystSdkBridge.js']
  );

  // Phase 5.3 remediated ZIP remains frozen; current compiled POC_ROOT/dist/*.js must match Phase 5.9 candidate archive
  const currentCandidateZipPath = path.join(ARTIFACTS_DIR, PHASE_5_9_CANDIDATE_ZIP_NAME);
  assert.equal(fs.existsSync(currentCandidateZipPath), true, 'Missing Phase 5.9 candidate archive');
  const currentCandidateDist = extractCanonicalContentManifest(currentCandidateZipPath).filter(m =>
    m.path.startsWith('dist/')
  );
  assert.equal(currentCandidateDist.length, 16);
  for (const item of currentCandidateDist) {
    const localJs = fs.readFileSync(path.join(POC_ROOT, item.path), 'utf8').replace(/\r\n/g, '\n');
    const localSha = crypto.createHash('sha256').update(localJs, 'utf8').digest('hex');
    assert.equal(item.sha256, localSha, `Compiled dist mismatch vs Phase 5.9 candidate for ${item.path}`);
  }

  // 3. Reproducibility check: frozen Phase 5.3 remediated staging re-packs deterministically AND live builder double-builds match Phase 5.9 candidate
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-remed-repro-'));
  try {
    const extStageDir = path.join(tmpDir, 'frozen-stage');
    fs.mkdirSync(extStageDir, { recursive: true });
    execSync(`unzip -oq ${JSON.stringify(REMEDIATED_ZIP_PATH)} -d ${JSON.stringify(extStageDir)}`, { stdio: 'ignore' });
    const frozen1 = createDeterministicPortableZip(extStageDir, path.join(tmpDir, 'remed-a.zip'));
    const frozen2 = createDeterministicPortableZip(extStageDir, path.join(tmpDir, 'remed-b.zip'));
    assert.equal(frozen1.sha256, EXPECTED_REMEDIATED_SHA256);
    assert.equal(frozen2.sha256, frozen1.sha256);

    const b1 = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'cand-a.zip'),
      skipCompile: true,
      quiet: true,
    });
    const b2 = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'cand-b.zip'),
      skipCompile: true,
      quiet: true,
    });
    assert.equal(b1.sha256, sha256File(currentCandidateZipPath));
    assert.equal(b2.sha256, b1.sha256);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4. Extract remediated ZIP and verify Node 22 loopback execution returns 401 (never 403) when x-zc-user-type=admin + opaque platform token
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-remed-exec-'));
  const prevEnv = { ...process.env };
  let srv: http.Server | undefined;

  try {
    execSync(`unzip -oq ${JSON.stringify(REMEDIATED_ZIP_PATH)} -d ${JSON.stringify(extDir)}`, { stdio: 'ignore' });
    const entryPath = path.join(extDir, 'dist', 'server', 'catalystEntry.js');
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      default: http.RequestListener;
      resetAdvancedIoRuntimeForTests: () => void;
    };

    process.env.VIGORCORE_DEPLOYMENT_ENVIRONMENT = 'Development';
    process.env.VIGOR_ENVIRONMENT = 'development';
    process.env.VIGORCORE_CATALYST_PROJECT_ID = '136967000000014024';
    process.env.VIGOR_CATALYST_AUTH_MODE = 'hosted_native';
    process.env.VIGOR_CORS_MODE = 'platform_managed';
    process.env.VIGORCORE_CATALYST_API_DOMAIN = 'https://api.catalyst.zoho.com';
    process.env.VIGORCORE_CATALYST_ACCOUNTS_URL = 'https://accounts.zoho.com';
    process.env.VIGOR_SESSION_HMAC_SECRET = crypto.randomBytes(32).toString('base64url');
    process.env.VIGOR_SESSION_ACTIVE_KID = 'k1';
    process.env.VIGOR_ALLOWED_ORIGINS = 'https://app.vigorcore.lat';
    mod.resetAdvancedIoRuntimeForTests();

    srv = http.createServer(mod.default);
    await new Promise<void>(resolve => srv!.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const anonOpaqueRes = await fetch(`${base}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Development',
        'x-zc-project-key': 'extracted_proj_key',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'extracted_adm_tok',
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'opaque_catalyst_platform_token',
      },
    });
    assert.equal(anonOpaqueRes.status, 401);
    assert.equal(((await anonOpaqueRes.json()) as { error?: string }).error, 'UNAUTHENTICATED');
  } finally {
    if (srv) await new Promise<void>(resolve => srv!.close(() => resolve()));
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(extDir, { recursive: true, force: true });
  }
});

test('Phase 5.3 [PASS-STATIC] docs/46 documents SDK contract evidence, Edge trust boundary, Access Log gap honesty, artifact traceability, and final status', () => {
  const doc46 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '46-phase-5.3-hosted-native-admin-context-remediation.md'),
    'utf8'
  );
  for (const token of [
    'HOSTED_NATIVE_ADMIN_CONTEXT_REMEDIATION_READY_FOR_REVIEW',
    '@zcatalyst/auth-admin',
    'credential.js',
    'x-zc-user-type',
    'x-zc-user-cred-token',
    '136967000000014007',
    'vigor_api-hosted-admin-remediated-portable.zip',
    EXPECTED_REMEDIATED_SHA256,
    DIAGNOSTIC_SHA256,
    ORIGINAL_CANDIDATE_SHA256,
  ]) {
    assert.ok(doc46.includes(token), `docs/46 missing token: ${token}`);
  }
});
