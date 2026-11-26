/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 38:
 * Live Authentication 403 Forensic Diagnostic Candidate (`phase-5.3-403-forensic-diag-v2`),
 * Deterministic `userCredentialTokenClass` Classification, Cookie Allowlist SDK Audit,
 * Secret-Free Diagnostic Telemetry Verification, 8-Scenario Auth Regression + Zero BaaS/NoSQL Hits,
 * and Independent Portable Diagnostic ZIP Reproducibility & Extracted Runtime Verification.
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
  PHASE_5_8_CANDIDATE_ZIP_NAME,
  parseZipEntries,
} from '../scripts/build-vigor-api-portable-package.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  VIGORCORE_DIAGNOSTIC_BUILD_ID,
  classifyUserCredentialTokenHeader,
  extractCatalystUserCredentialsFromHeaders,
  extractSanitizedCatalystUserCookieWithDetails,
  type AdminSpoofDiagnosticEvent,
  type UserCredentialTokenClass,
} from '../src/sdk/catalystSdkBridge.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { KeyBuilders, type SessionRecordItem, type UserAccountItem } from '../src/types/cleanSlate.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');

const ORIGINAL_CANDIDATE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-reconciled-portable.zip');
const ORIGINAL_CANDIDATE_SHA256 = 'd268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319';

const DIAGNOSTIC_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-forensic-diagnostic-portable.zip');
const DIAGNOSTIC_MANIFEST_PATH = path.join(
  ARTIFACTS_DIR,
  'vigor_api-auth-forensic-diagnostic-portable.manifest.json'
);
const EXPECTED_DIAGNOSTIC_ENTRY_COUNT = 905;
const EXPECTED_DIAGNOSTIC_UNCOMPRESSED_BYTES = 3_767_630;
const EXPECTED_DIAGNOSTIC_SIZE_BYTES = 1_280_918;
const EXPECTED_DIAGNOSTIC_SHA256 = 'c9ade1264bc340560d1b503544162df50d78cf41949ecb37642a416caf8b2839';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildHostedEnv(apiDomain = 'https://127.0.0.1:1', secret?: string): Record<string, string> {
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
    'x-zc-project-key': 'SUPER_SECRET_PROJECT_KEY_DO_NOT_LOG',
    'x-zc-admin-cred-type': 'token',
    'x-zc-admin-cred-token': 'SUPER_SECRET_ADMIN_CRED_TOKEN_DO_NOT_LOG',
    ...extra,
  };
}

function startLoopbackBaaSSpy() {
  const userCurrentCalls: Array<{ url: string; method: string }> = [];
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = (req.method || 'GET').toUpperCase();
    req.resume();
    req.on('end', () => {
      if (url.includes('/project-user/current')) {
        userCurrentCalls.push({ url, method });
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', message: 'No active BaaS session' }));
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

function instrumentNoSqlAdapter() {
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  let totalNoSqlOps = 0;

  const origFetch = adapter.fetchItem.bind(adapter);
  const origInsert = adapter.insertItem.bind(adapter);
  const origUpdate = adapter.updateItem.bind(adapter);
  const origDelete = adapter.deleteItem.bind(adapter);
  const origQuery = adapter.queryTable.bind(adapter);

  adapter.fetchItem = (async (...args: Parameters<typeof origFetch>) => {
    totalNoSqlOps++;
    return origFetch(...args);
  }) as typeof adapter.fetchItem;

  adapter.insertItem = (async (...args: Parameters<typeof origInsert>) => {
    totalNoSqlOps++;
    return origInsert(...args);
  }) as typeof adapter.insertItem;

  adapter.updateItem = (async (...args: Parameters<typeof origUpdate>) => {
    totalNoSqlOps++;
    return origUpdate(...args);
  }) as typeof adapter.updateItem;

  adapter.deleteItem = (async (...args: Parameters<typeof origDelete>) => {
    totalNoSqlOps++;
    return origDelete(...args);
  }) as typeof adapter.deleteItem;

  adapter.queryTable = (async (...args: Parameters<typeof origQuery>) => {
    totalNoSqlOps++;
    return origQuery(...args);
  }) as typeof adapter.queryTable;

  return {
    adapter,
    getTotalOps: () => totalNoSqlOps,
    resetOps: () => {
      totalNoSqlOps = 0;
    },
    seedDirectly: origInsert,
  };
}

test('Phase 5.3 [PASS-UNIT] classifyUserCredentialTokenHeader deterministically classifies all 9 non-secret categories', () => {
  const cases: Array<[string | undefined, UserCredentialTokenClass]> = [
    [undefined, 'absent'],
    ['', 'empty'],
    ['   \t  ', 'whitespace_only'],
    ['null', 'literal_null'],
    [' NULL ', 'literal_null'],
    ['undefined', 'literal_undefined'],
    [' Undefined ', 'literal_undefined'],
    ['false', 'literal_false'],
    ['FALSE', 'literal_false'],
    ['0', 'literal_zero'],
    [' 0 ', 'literal_zero'],
    ['opaque_edge_token_xyz_123', 'nonempty_opaque'],
    ['bad\rtoken', 'malformed_control_characters'],
    ['\n', 'malformed_control_characters'],
    ['abc\0def', 'malformed_control_characters'],
  ];

  for (const [rawVal, expectedClass] of cases) {
    assert.equal(classifyUserCredentialTokenHeader(rawVal), expectedClass);
    // Repeated invocation is strictly deterministic
    assert.equal(classifyUserCredentialTokenHeader(rawVal), expectedClass);
  }
});

test('Phase 5.3 [PASS-UNIT] Cookie allowlist audit enforces SDK-supported rules, rejects zccpn & bare ZD_CSRF_TOKEN, and tracks matched rules cleanly', () => {
  const jwtRes = extractSanitizedCatalystUserCookieWithDetails('JWT_AUTH=secret_jwt_val');
  assert.equal(jwtRes.sanitizedZcCookie, 'JWT_AUTH=secret_jwt_val');
  assert.deepEqual(jwtRes.recognizedCookieNames, ['JWT_AUTH']);
  assert.deepEqual(jwtRes.matchedCookieRules, ['exact:JWT_AUTH']);

  const userCredRes = extractSanitizedCatalystUserCookieWithDetails('user_cred=secret_uc_val');
  assert.equal(userCredRes.sanitizedZcCookie, 'user_cred=secret_uc_val');
  assert.deepEqual(userCredRes.recognizedCookieNames, ['user_cred']);
  assert.deepEqual(userCredRes.matchedCookieRules, ['exact:user_cred']);

  const iamAdtRes = extractSanitizedCatalystUserCookieWithDetails(
    '_iamadt_us=secret_iamadt; ZD_CSRF_TOKEN=secret_zd_csrf; _zcsr_tmp=ignore_me'
  );
  assert.equal(iamAdtRes.sanitizedZcCookie, '_iamadt_us=secret_iamadt; ZD_CSRF_TOKEN=secret_zd_csrf');
  assert.deepEqual(iamAdtRes.recognizedCookieNames, ['_iamadt_us', 'ZD_CSRF_TOKEN']);
  assert.deepEqual(iamAdtRes.matchedCookieRules, ['regex:^_?iam[ab]dt', 'csrf_paired:ZD_CSRF_TOKEN']);

  const iamBdtRes = extractSanitizedCatalystUserCookieWithDetails('_iambdt_eu=secret_iambdt');
  assert.equal(iamBdtRes.sanitizedZcCookie, '_iambdt_eu=secret_iambdt');
  assert.deepEqual(iamBdtRes.recognizedCookieNames, ['_iambdt_eu']);
  assert.deepEqual(iamBdtRes.matchedCookieRules, ['regex:^_?iam[ab]dt']);

  const portalRes = extractSanitizedCatalystUserCookieWithDetails('_zohoportal_session=secret_portal');
  assert.equal(portalRes.sanitizedZcCookie, '_zohoportal_session=secret_portal');
  assert.deepEqual(portalRes.recognizedCookieNames, ['_zohoportal_session']);
  assert.deepEqual(portalRes.matchedCookieRules, ['regex:^_?zohoportal_']);

  // Unsupported assumption `zccpn` (0 refs in `@zcatalyst/*`) and bare `ZD_CSRF_TOKEN` MUST NOT trigger user credential detection
  const zccpnRes = extractSanitizedCatalystUserCookieWithDetails('zccpn=legacy_unverified_val');
  assert.equal(zccpnRes.sanitizedZcCookie, undefined);
  assert.deepEqual(zccpnRes.recognizedCookieNames, []);
  assert.deepEqual(zccpnRes.matchedCookieRules, []);

  const bareCsrfRes = extractSanitizedCatalystUserCookieWithDetails('ZD_CSRF_TOKEN=bare_val');
  assert.equal(bareCsrfRes.sanitizedZcCookie, undefined);
  assert.deepEqual(bareCsrfRes.recognizedCookieNames, []);
  assert.deepEqual(bareCsrfRes.matchedCookieRules, []);

  // Raw `Authorization: Bearer` header does NOT populate `x-zc-user-cred-token`
  const headerExtract = extractCatalystUserCredentialsFromHeaders({
    authorization: 'Bearer UNRELATED_BEARER_TOKEN_123',
    'x-zc-admin-cred-token': 'ADMIN_ONLY_TOKEN',
  });
  assert.equal(headerExtract.hasUserCredToken, false);
  assert.equal(headerExtract.userCredentialTokenClass, 'absent');
  assert.equal(headerExtract.hasZcCookie, false);
  assert.equal(headerExtract.hasSanitizedZcCookieCredential, false);
  assert.equal(headerExtract.hasUserCredential, false);
});

test('Phase 5.3 [PASS-LOOPBACK] Full forensic diagnostic & 8-scenario security regression (hosted_native + external_oauth, zero BaaS & NoSQL leaks)', async () => {
  const baasSpy = startLoopbackBaaSSpy();
  const baasOrigin = await baasSpy.start();
  const dbProbe = instrumentNoSqlAdapter();
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSec * 1000).toISOString();
  const diagEvents: AdminSpoofDiagnosticEvent[] = [];

  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedEnv(baasOrigin, hmacSecret), {
    allowInsecureLoopbackForTest: true,
    adapterOverride: dbProbe.adapter,
    nowSecProvider: () => nowSec,
    diagnosticLogger: entry => diagEvents.push(entry),
  });

  // Seed active athlete user + session for Path 3 HMAC & CSRF scenarios
  const athleteId = 'u_diag_athlete_38';
  const athleteUser: UserAccountItem = {
    pk: KeyBuilders.userPk(athleteId),
    uid: athleteId,
    email: 'athlete38@vigorcore.lat',
    normalizedEmail: 'athlete38@vigorcore.lat',
    displayName: 'Athlete Diag 38',
    role: 'athlete',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: KeyBuilders.directorySegment(athleteId),
    onboardingCompleted: true,
    onboardingStep: 4,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSignInAt: nowIso,
  };
  await dbProbe.seedDirectly('Users', athleteUser);

  const issuedSession = bundle.sessionTokens.issueTokenWithClaims(athleteId, 1, 12 * 3600);
  const issuedCsrf = bundle.sessionTokens.issueCsrfToken(
    athleteId,
    issuedSession.claims.sid,
    1,
    issuedSession.claims.exp
  );
  const sessionRec: SessionRecordItem = {
    pk: KeyBuilders.sessionPk(issuedSession.claims.sid),
    sid: issuedSession.claims.sid,
    ownerUserId: athleteId,
    sessionEpoch: 1,
    issuedAt: nowIso,
    issuedAtEpochSec: issuedSession.claims.iat,
    initialAuthAtEpochSec: issuedSession.claims.iat,
    expiresAt: new Date(issuedSession.claims.exp * 1000).toISOString(),
    expiresAtEpochSec: issuedSession.claims.exp,
    absoluteExpiresAtEpochSec: issuedSession.claims.iat + 24 * 3600,
    lastCatalystCheckAtEpochSec: nowSec,
    status: 'active',
    ttlEpochSec: issuedSession.claims.iat + 48 * 3600,
  };
  await dbProbe.seedDirectly('SystemControl', sessionRec);

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const assertZeroLeaks = (ev: AdminSpoofDiagnosticEvent, forbiddenSubstrings: string[]) => {
    const serialized = JSON.stringify(ev);
    assert.deepEqual(
      Object.keys(ev).sort(),
      [
        'authRuntimeMode',
        'buildId',
        'event',
        'hasSanitizedZcCookieCredential',
        'hasUserCredential',
        'hasXZcCookie',
        'hasXZcUserCredToken',
        'matchedCookieRules',
        'method',
        'recognizedCookieNames',
        'route',
        'userCredentialTokenClass',
        'xZcUserTypeIsAdmin',
      ].sort()
    );
    for (const secretStr of forbiddenSubstrings) {
      assert.equal(
        serialized.includes(secretStr),
        false,
        `Diagnostic log leaked sensitive substring: ${secretStr}`
      );
    }
  };

  try {
    // Scenario 1: Admin context marker without user credentials -> 401 UNAUTHENTICATED, 0 NoSQL, 0 BaaS, 0 diagnostic events
    dbProbe.resetOps();
    for (const emptyOrMissing of [
      undefined,
      '',
      '   ',
    ]) {
      const hdrs = edgeAdminHeaders({
        'x-zc-user-type': 'admin',
        ...(emptyOrMissing !== undefined ? { 'x-zc-user-cred-token': emptyOrMissing } : {}),
      });
      const r1 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
        headers: { 'sec-fetch-site': 'none', ...hdrs },
      });
      assert.equal(r1.status, 401);
      assert.equal(((await r1.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    }
    assert.equal(dbProbe.getTotalOps(), 0);
    assert.equal(baasSpy.userCurrentCalls.length, 0);
    assert.equal(diagEvents.length, 0);

    // Scenario 2 & 3 (reconciled hosted_native): Every sentinel + nonempty opaque token alongside x-zc-user-type=admin returns 401 UNAUTHENTICATED with 0 NoSQL, 0 BaaS, 0 spoof diag events
    const tokenExpectations: Array<[string, UserCredentialTokenClass]> = [
      ['null', 'literal_null'],
      ['undefined', 'literal_undefined'],
      ['false', 'literal_false'],
      ['0', 'literal_zero'],
      ['VALID_OPAQUE_USER_TOK_MUST_NOT_LEAK_38', 'nonempty_opaque'],
    ];

    for (const [tokVal, expectedClass] of tokenExpectations) {
      assert.equal(classifyUserCredentialTokenHeader(tokVal), expectedClass);
      const rTok = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
        headers: {
          'sec-fetch-site': 'none',
          Authorization: 'Bearer HEADER_AUTH_MUST_NOT_LEAK_38',
          ...edgeAdminHeaders({
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-type': 'token',
            'x-zc-user-cred-token': tokVal,
          }),
        },
      });
      assert.equal(rTok.status, 401);
      assert.equal(((await rTok.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    }
    assert.equal(dbProbe.getTotalOps(), 0);
    assert.equal(baasSpy.userCurrentCalls.length, 0);
    assert.equal(diagEvents.length, 0);

    // Scenario 4 (reconciled hosted_native): Admin context marker + cookie extraction remains deterministic & hosted_native returns 401 UNAUTHENTICATED (0 BaaS, 0 NoSQL)
    const allowlistCookieCases: Array<{
      cookieHeader: string;
      expectedNames: string[];
      expectedRules: string[];
      extraTokenHeader?: string;
    }> = [
      {
        cookieHeader: 'JWT_AUTH=SECRET_JWT_COOKIE_VAL_38',
        expectedNames: ['JWT_AUTH'],
        expectedRules: ['exact:JWT_AUTH'],
      },
      {
        cookieHeader: 'user_cred=SECRET_USER_CRED_VAL_38',
        expectedNames: ['user_cred'],
        expectedRules: ['exact:user_cred'],
        extraTokenHeader: '',
      },
      {
        cookieHeader: '_iamadt_us=SECRET_IAMADT_VAL_38; ZD_CSRF_TOKEN=SECRET_ZD_CSRF_VAL_38',
        expectedNames: ['_iamadt_us', 'ZD_CSRF_TOKEN'],
        expectedRules: ['regex:^_?iam[ab]dt', 'csrf_paired:ZD_CSRF_TOKEN'],
        extraTokenHeader: '',
      },
      {
        cookieHeader: '_iambdt_in=SECRET_IAMBDT_VAL_38',
        expectedNames: ['_iambdt_in'],
        expectedRules: ['regex:^_?iam[ab]dt'],
      },
      {
        cookieHeader: '_zohoportal_ctx=SECRET_PORTAL_VAL_38',
        expectedNames: ['_zohoportal_ctx'],
        expectedRules: ['regex:^_?zohoportal_'],
      },
    ];

    for (const c of allowlistCookieCases) {
      const parsedCookie = extractSanitizedCatalystUserCookieWithDetails(c.cookieHeader);
      assert.deepEqual(parsedCookie.recognizedCookieNames, c.expectedNames);
      assert.deepEqual(parsedCookie.matchedCookieRules, c.expectedRules);

      const r4 = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
        headers: edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-cookie': c.cookieHeader,
          ...(c.extraTokenHeader !== undefined ? { 'x-zc-user-cred-token': c.extraTokenHeader } : {}),
        }),
      });
      assert.equal(r4.status, 401);
      assert.equal(((await r4.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    }

    // Unsupported cookie names (`zccpn`, bare `ZD_CSRF_TOKEN`, Zoho Console cookies) -> 401 UNAUTHENTICATED, 0 spoof logs, 0 BaaS, 0 NoSQL
    const beforeUnsupported: number = diagEvents.length;
    const r4Unsupported = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: edgeAdminHeaders({
        'x-zc-user-type': 'admin',
        'x-zc-cookie': 'zccpn=legacy_tok; ZD_CSRF_TOKEN=bare_csrf_tok; _zcsr_tmp=console_tok; JSESSIONID=js_1; zalb_1=lb',
      }),
    });
    assert.equal(r4Unsupported.status, 401);
    assert.equal(((await r4Unsupported.json()) as { error?: string }).error, 'UNAUTHENTICATED');
    assert.equal(diagEvents.length, beforeUnsupported);
    assert.equal(dbProbe.getTotalOps(), 0);
    assert.equal(baasSpy.userCurrentCalls.length, 0);

    // Scenario 6 & 7: HMAC-only session (`__Host-vigor_session`) + platform admin context + CSRF isolation + ZERO BaaS calls
    const r6Workspace = await fetch(`${baseUrl}/api/v1/athlete/workspace`, {
      headers: {
        cookie: `__Host-vigor_session=${issuedSession.token}; _zcsr_tmp=console_tok`,
        ...edgeAdminHeaders({
          'x-zc-user-type': 'admin',
          'x-zc-cookie': `__Host-vigor_session=${issuedSession.token}; _zcsr_tmp=console_tok`,
        }),
      },
    });
    assert.equal(r6Workspace.status, 200);
    assert.equal(diagEvents.length, beforeUnsupported);
    assert.equal(baasSpy.userCurrentCalls.length, 0);

    // Missing CSRF fails closed (`403 CSRF_TOKEN_MISSING`)
    const r7MissingCsrf = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-origin',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${issuedSession.token}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ displayName: 'Missing Csrf 38' }),
    });
    assert.equal(r7MissingCsrf.status, 403);
    assert.equal(((await r7MissingCsrf.json()) as { error?: string }).error, 'CSRF_TOKEN_MISSING');

    // Valid CSRF succeeds (`200 OK`) with 0 BaaS calls
    const r7ValidMutation = await fetch(`${baseUrl}/api/v1/athlete/profile`, {
      method: 'PATCH',
      headers: {
        Origin: 'https://app.vigorcore.lat',
        'Sec-Fetch-Site': 'same-origin',
        'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        'X-Vigor-CSRF': issuedCsrf,
        'Content-Type': 'application/json',
        cookie: `__Host-vigor_session=${issuedSession.token}`,
        ...edgeAdminHeaders({ 'x-zc-user-type': 'admin' }),
      },
      body: JSON.stringify({ displayName: 'Updated Diag 38' }),
    });
    assert.equal(r7ValidMutation.status, 200);
    assert.equal(baasSpy.userCurrentCalls.length, 0);

    // Scenario 8: external_oauth runtime emits exact 1 safe event with userCredentialTokenClass & zero secret leaks
    const sepDiagEvents: AdminSpoofDiagnosticEvent[] = [];
    const sepAdminProvider = new CatalystAdminAppProvider({
      projectId: '136967000000014024',
      projectKey: 'SUPER_SECRET_PROJECT_KEY_EXT_38',
      catalystEnvironment: 'Development',
      apiDomain: baasOrigin,
      accountsUrl: 'https://accounts.zoho.com',
      clientId: 'cli_id_38',
      clientSecret: 'cli_sec_SECRET_38',
      refreshToken: 'ref_tok_SECRET_38',
      allowInsecureLoopbackForTest: true,
    });
    const sepRuntime = new CatalystSeparatedAuthRuntime({
      adminProvider: sepAdminProvider,
      diagnosticLogger: entry => sepDiagEvents.push(entry),
    });

    await assert.rejects(
      () =>
        sepRuntime.getCurrentUserFromRequest({
          method: 'GET',
          route: '/api/v1/athlete/workspace',
          headers: {
            'x-zc-projectid': '136967000000014024',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': 'EXT_USER_TOK_SECRET_38',
          },
        }),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === 'CATALYST_ADMIN_HEADER_SPOOFED'
    );
    assert.equal(sepDiagEvents.length, 1);
    assert.equal(sepDiagEvents[0].authRuntimeMode, 'external_oauth');
    assert.equal(sepDiagEvents[0].userCredentialTokenClass, 'nonempty_opaque');
    assert.equal(sepDiagEvents[0].hasSanitizedZcCookieCredential, false);
    assertZeroLeaks(sepDiagEvents[0], [
      'EXT_USER_TOK_SECRET_38',
      'SUPER_SECRET_PROJECT_KEY_EXT_38',
      'cli_sec_SECRET_38',
      'ref_tok_SECRET_38',
    ]);

    // Direct header map with raw whitespace-only token + cookie preserves 'whitespace_only' classification deterministically
    await assert.rejects(
      () =>
        sepRuntime.getCurrentUserFromRequest({
          method: 'GET',
          route: '/api/v1/athlete/workspace',
          headers: {
            'x-zc-projectid': '136967000000014024',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': '   ',
            'x-zc-cookie': 'JWT_AUTH=WS_TEST_COOKIE_SECRET_38',
          },
        }),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === 'CATALYST_ADMIN_HEADER_SPOOFED'
    );
    assert.equal(sepDiagEvents.length, 2);
    assert.equal(sepDiagEvents[1].userCredentialTokenClass, 'whitespace_only');
    assert.equal(sepDiagEvents[1].hasSanitizedZcCookieCredential, true);
    assertZeroLeaks(sepDiagEvents[1], ['WS_TEST_COOKIE_SECRET_38']);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await baasSpy.close();
  }
});

test('Phase 5.3 [PASS-LOCAL] Separate forensic diagnostic ZIP is reproducible, preserves original candidate untouched, and executes instrumentation on Node 22', async () => {
  // 1. Original authorized candidate MUST remain untouched and byte-identical
  assert.equal(fs.existsSync(ORIGINAL_CANDIDATE_ZIP_PATH), true);
  assert.equal(sha256File(ORIGINAL_CANDIDATE_ZIP_PATH), ORIGINAL_CANDIDATE_SHA256);

  // 2. Diagnostic candidate ZIP & manifest exist and pass CRC/hygiene/diff
  assert.equal(fs.existsSync(DIAGNOSTIC_ZIP_PATH), true);
  assert.equal(fs.existsSync(DIAGNOSTIC_MANIFEST_PATH), true);
  assert.equal(fs.statSync(DIAGNOSTIC_ZIP_PATH).size, EXPECTED_DIAGNOSTIC_SIZE_BYTES);
  assert.equal(sha256File(DIAGNOSTIC_ZIP_PATH), EXPECTED_DIAGNOSTIC_SHA256);
  execSync(`unzip -tq ${JSON.stringify(DIAGNOSTIC_ZIP_PATH)}`, { stdio: 'ignore' });

  const entries = parseZipEntries(DIAGNOSTIC_ZIP_PATH);
  assert.equal(entries.length, EXPECTED_DIAGNOSTIC_ENTRY_COUNT);

  const diagManifest = extractCanonicalContentManifest(DIAGNOSTIC_ZIP_PATH);
  const diskManifest = JSON.parse(fs.readFileSync(DIAGNOSTIC_MANIFEST_PATH, 'utf8'));
  assert.deepEqual(diagManifest, diskManifest);
  assert.equal(
    diagManifest.reduce((s, e) => s + e.uncompressedSize, 0),
    EXPECTED_DIAGNOSTIC_UNCOMPRESSED_BYTES
  );

  // Phase 5.3 diagnostic ZIP remains frozen; current compiled POC_ROOT/dist/*.js must match Phase 5.8 candidate archive
  const currentCandidateZipPath = path.join(ARTIFACTS_DIR, PHASE_5_8_CANDIDATE_ZIP_NAME);
  assert.equal(fs.existsSync(currentCandidateZipPath), true, 'Missing Phase 5.8 candidate archive');
  const currentCandidateDist = extractCanonicalContentManifest(currentCandidateZipPath).filter(m =>
    m.path.startsWith('dist/')
  );
  assert.equal(currentCandidateDist.length, 16);
  for (const item of currentCandidateDist) {
    const localJs = fs.readFileSync(path.join(POC_ROOT, item.path), 'utf8').replace(/\r\n/g, '\n');
    const localSha = crypto.createHash('sha256').update(localJs, 'utf8').digest('hex');
    assert.equal(item.sha256, localSha, `Compiled dist mismatch vs Phase 5.8 candidate for ${item.path}`);
  }

  // Exact delta vs untouched original authorized candidate ZIP
  const origManifest = extractCanonicalContentManifest(ORIGINAL_CANDIDATE_ZIP_PATH);
  const diff = compareContentManifests(origManifest, diagManifest);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.unexpected, []);
  assert.deepEqual(
    diff.changed.map(c => c.path).sort(),
    [
      'dist/sdk/catalystSdkBridge.js',
      'dist/server/advancedIoApp.js',
    ]
  );

  // 3. Independent double-build SHA-256 reproducibility check on the frozen diagnostic staging contents
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-diag-repro-'));
  try {
    const extStageDir = path.join(tmpDir, 'stage');
    fs.mkdirSync(extStageDir, { recursive: true });
    execSync(`unzip -oq ${JSON.stringify(DIAGNOSTIC_ZIP_PATH)} -d ${JSON.stringify(extStageDir)}`, { stdio: 'ignore' });
    const b1 = createDeterministicPortableZip(extStageDir, path.join(tmpDir, 'diag-a.zip'));
    const b2 = createDeterministicPortableZip(extStageDir, path.join(tmpDir, 'diag-b.zip'));
    assert.equal(b1.sha256, EXPECTED_DIAGNOSTIC_SHA256);
    assert.equal(b2.sha256, b1.sha256);
    assert.equal(b1.zipSizeBytes, EXPECTED_DIAGNOSTIC_SIZE_BYTES);
    assert.equal(b2.zipSizeBytes, EXPECTED_DIAGNOSTIC_SIZE_BYTES);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4. Extract new diagnostic ZIP & verify compiled runtime contains VIGORCORE_DIAGNOSTIC_BUILD_ID and emits exact safe JSON on Node 22 HTTP
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-diag-exec-'));
  const prevEnv = { ...process.env };
  const prevWarn = console.warn;
  const capturedWarns: string[] = [];
  let srv: http.Server | undefined;

  try {
    execSync(`unzip -oq ${JSON.stringify(DIAGNOSTIC_ZIP_PATH)} -d ${JSON.stringify(extDir)}`, { stdio: 'ignore' });
    const compiledBridge = fs.readFileSync(path.join(extDir, 'dist', 'sdk', 'catalystSdkBridge.js'), 'utf8');
    assert.ok(compiledBridge.includes(VIGORCORE_DIAGNOSTIC_BUILD_ID));
    assert.ok(compiledBridge.includes('userCredentialTokenClass'));
    assert.ok(compiledBridge.includes('hasSanitizedZcCookieCredential'));

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

    console.warn = (...args: unknown[]) => {
      capturedWarns.push(args.map(a => String(a)).join(' '));
    };

    srv = http.createServer(mod.default);
    await new Promise<void>(resolve => srv!.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const edgeCtx = {
      'x-zc-projectid': '136967000000014024',
      'x-zc-environment': 'Development',
      'x-zc-project-key': 'proj_key_extracted_secret',
      'x-zc-admin-cred-type': 'token',
      'x-zc-admin-cred-token': 'adm_tok_extracted_secret',
      'x-zc-user-type': 'admin',
    };

    const rAnon = await fetch(`${base}/server/vigor_api/api/v1/athlete/workspace`, { headers: edgeCtx });
    assert.equal(rAnon.status, 401);
    assert.equal(capturedWarns.length, 0);

    const rSentinelNull = await fetch(`${base}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        ...edgeCtx,
        'x-zc-user-cred-token': 'null',
      },
    });
    assert.equal(rSentinelNull.status, 403);
    assert.equal(((await rSentinelNull.json()) as { error?: string }).error, 'CATALYST_ADMIN_HEADER_SPOOFED');
    assert.equal(capturedWarns.length, 1);

    const parsedDiag = JSON.parse(capturedWarns[0]) as AdminSpoofDiagnosticEvent;
    assert.equal(parsedDiag.event, 'CATALYST_ADMIN_HEADER_SPOOFED_DIAGNOSTIC');
    assert.equal(parsedDiag.buildId, VIGORCORE_DIAGNOSTIC_BUILD_ID);
    assert.equal(parsedDiag.userCredentialTokenClass, 'literal_null');
    assert.equal(parsedDiag.hasXZcUserCredToken, true);
    assert.equal(parsedDiag.hasUserCredential, true);
    assert.equal(capturedWarns[0].includes('proj_key_extracted_secret'), false);
    assert.equal(capturedWarns[0].includes('adm_tok_extracted_secret'), false);
  } finally {
    console.warn = prevWarn;
    if (srv) await new Promise<void>(resolve => srv!.close(() => resolve()));
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(extDir, { recursive: true, force: true });
  }
});

test('Phase 5.3 [PASS-STATIC] docs/45 documents diagnostic candidate build, userCredentialTokenClass, synthetic log examples, and final status', () => {
  const doc45 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '45-phase-5.3-live-403-forensic-diagnostic.md'),
    'utf8'
  );
  assert.ok(doc45.includes(VIGORCORE_DIAGNOSTIC_BUILD_ID));
  assert.ok(doc45.includes('userCredentialTokenClass'));
  assert.ok(doc45.includes('vigor_api-auth-forensic-diagnostic-portable.zip'));
  assert.ok(doc45.includes(EXPECTED_DIAGNOSTIC_SHA256));
  assert.ok(doc45.includes(ORIGINAL_CANDIDATE_SHA256));
  assert.ok(doc45.includes('FORENSIC_DIAGNOSTIC_CANDIDATE_READY_PENDING_EXPLICIT_OPERATOR_AUTHORIZATION'));
});
