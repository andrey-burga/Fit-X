/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 35:
 * Catalyst Admin Header Provenance Regression Audit (`403 CATALYST_ADMIN_HEADER_SPOOFED`).
 *
 * Verifies exact middleware ordering, header propagation boundaries, fail-closed
 * behavior on `x-zc-user-type=admin`, zero NoSQL execution, zero raw token leakage,
 * and completeness of `docs/42-phase-5.3-admin-header-provenance-investigation.md`.
 *
 * Zero remote Catalyst requests. Zero database writes. All HTTP probes run on `127.0.0.1:0`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');

function buildHostedNativeDevEnv(): Record<string, string> {
  return {
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'platform_managed',
    VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: ServerSessionTokenManager.generateStrongSecret(32),
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };
}

test('Phase 5.3 [PASS-LOOPBACK] Reconciled provenance path: anonymous edge x-zc-user-type=admin resolves null -> 401 UNAUTHENTICATED (0 NoSQL hits), while contradictory user-cred + x-zc-user-type=admin fails 403 CATALYST_ADMIN_HEADER_SPOOFED', async () => {
  const secretEdgeAdminToken = 'edge_admin_token_must_never_leak_in_403_output';
  const secretEdgeProjKey = 'edge_project_key_must_never_leak_in_403_output';

  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedNativeDevEnv());

  let nosqlAccessCount = 0;
  const origGetNoSQL = bundle.hostedRuntime!.getActiveRequestNoSQLClient.bind(bundle.hostedRuntime);
  bundle.hostedRuntime!.getActiveRequestNoSQLClient = () => {
    nosqlAccessCount++;
    return origGetNoSQL();
  };

  // Spy on hostedRuntime.runWithRequestContext & getCurrentUserFromRequest to assert exact ordering
  const executionOrder: string[] = [];
  const origRunWithCtx = bundle.hostedRuntime!.runWithRequestContext.bind(bundle.hostedRuntime);
  bundle.hostedRuntime!.runWithRequestContext = (hdrs, fn) => {
    executionOrder.push('1:runWithRequestContext(admin-scope ZCAuth.init)');
    return origRunWithCtx(hdrs, fn);
  };
  const origGetCurrentUser = bundle.hostedRuntime!.getCurrentUserFromRequest.bind(bundle.hostedRuntime);
  bundle.hostedRuntime!.getCurrentUserFromRequest = async req => {
    executionOrder.push('2:getCurrentUserFromRequest');
    assert.equal(req.headers?.['x-zc-user-type'], 'admin');
    return origGetCurrentUser(req);
  };

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Observed anonymous live edge payload: admin context headers + x-zc-user-type=admin, NO user token/cookie -> 401 UNAUTHENTICATED
    const anonRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Development',
        'x-zc-project-key': secretEdgeProjKey,
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': secretEdgeAdminToken,
        'x-zc-user-type': 'admin',
      },
    });

    assert.equal(anonRes.status, 401);
    const anonText = await anonRes.text();
    const anonBody = JSON.parse(anonText) as Record<string, unknown>;
    assert.equal(anonBody.success, false);
    assert.equal(anonBody.error, 'UNAUTHENTICATED');
    assert.equal(anonText.includes(secretEdgeAdminToken), false);
    assert.equal(anonText.includes(secretEdgeProjKey), false);
    assert.equal(nosqlAccessCount, 0, 'Must abort before any NoSQL initialization or access');
    assert.deepEqual(executionOrder, [
      '1:runWithRequestContext(admin-scope ZCAuth.init)',
      '2:getCurrentUserFromRequest',
    ]);

    // 2. Contradictory x-zc-user-type=admin + genuine user token -> 403 CATALYST_ADMIN_HEADER_SPOOFED
    const spoofRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Development',
        'x-zc-project-key': secretEdgeProjKey,
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': secretEdgeAdminToken,
        'x-zc-user-type': 'admin',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'spoofed_combo_user_token',
      },
    });
    assert.equal(spoofRes.status, 403);
    const spoofText = await spoofRes.text();
    const spoofBody = JSON.parse(spoofText) as Record<string, unknown>;
    assert.equal(spoofBody.success, false);
    assert.equal(spoofBody.error, 'CATALYST_ADMIN_HEADER_SPOOFED');
    assert.equal(
      spoofBody.message,
      'Incoming x-zc-user-type=admin is strictly prohibited on user authentication endpoints.'
    );
    assert.equal(spoofText.includes(secretEdgeAdminToken), false);
    assert.equal(spoofText.includes(secretEdgeProjKey), false);
    assert.equal(nosqlAccessCount, 0);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-LOOPBACK] Express normalizeIncomingHeaders does NOT invent x-zc-user-type when browser sends only generic cookies', async () => {
  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedNativeDevEnv());
  const seenHeaders: Array<Record<string, string | undefined> | undefined> = [];

  const origGetCurrentUser = bundle.hostedRuntime!.getCurrentUserFromRequest.bind(bundle.hostedRuntime);
  bundle.hostedRuntime!.getCurrentUserFromRequest = async req => {
    seenHeaders.push({ ...(req.headers ?? {}) });
    return origGetCurrentUser(req);
  };

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Admin edge headers present + arbitrary Zoho-like cookies, NO x-zc-user-type -> 401 UNAUTHENTICATED (NOT 403)
    const resNoUserType = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        cookie: 'ZD_CSRF_TOKEN=dummy_csrf; _zcsr_tmp=dummy_zoho_cookie',
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Development',
        'x-zc-project-key': 'edge_project_key_sample',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'edge_admin_token_sample',
      },
    });
    assert.equal(resNoUserType.status, 401);
    const body401 = (await resNoUserType.json()) as Record<string, unknown>;
    assert.equal(body401.error, 'UNAUTHENTICATED');
    assert.equal(seenHeaders.length, 1);
    assert.equal(seenHeaders[0]?.['x-zc-user-type'], undefined);

    // 2. Missing x-zc-admin-cred-* -> 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE before dispatcher
    const resNoEdgeAdmin = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'sec-fetch-site': 'none',
        cookie: 'ZD_CSRF_TOKEN=dummy_csrf',
      },
    });
    assert.equal(resNoEdgeAdmin.status, 503);
    const body503 = (await resNoEdgeAdmin.json()) as Record<string, unknown>;
    assert.equal(body503.error, 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-UNIT] docs/42 captures exact provenance audit, header layers, A-vs-B design, security invariants, and status', () => {
  const docPath = path.join(POC_ROOT, 'docs', '42-phase-5.3-admin-header-provenance-investigation.md');
  assert.equal(fs.existsSync(docPath), true);
  const md = fs.readFileSync(docPath, 'utf8');

  for (const token of [
    'PHASE_5_3_ADMIN_HEADER_PROVENANCE_UNDER_INVESTIGATION',
    'CATALYST_ADMIN_HEADER_SPOOFED',
    'getCurrentUserFromRequest',
    'assertNoIdentitySpoofing',
    'buildHostedAdminAppFromHeaders',
    'normalizeIncomingHeaders',
    'req.rawHeaders',
    'x-zc-admin-cred-type',
    'x-zc-admin-cred-token',
    'x-zc-project-key',
    'x-zc-projectid',
    'x-zc-environment',
    'x-zc-user-type',
    '401 UNAUTHENTICATED',
    '503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
    '136967000000014024',
    '136967000000074001',
  ]) {
    assert.ok(md.includes(token), `docs/42 missing required token: ${token}`);
  }
});
