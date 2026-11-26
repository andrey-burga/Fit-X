/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 33:
 * Catalyst Console Reserved Environment Variable Names Reconciliation
 * (`VIGORCORE_CATALYST_PROJECT_ID`, `VIGORCORE_CATALYST_API_DOMAIN`, `VIGORCORE_CATALYST_ACCOUNTS_URL`).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { runCatalystConfigPreflight } from '../src/provisioning/catalystConfigPreflight.js';
import {
  CatalystAdminAppProvider,
  HostedNativeCatalystAuthRuntime,
  resolveCatalystAccountsUrlFromEnv,
  resolveCatalystApiDomainFromEnv,
  resolveCatalystProjectIdFromEnv,
} from '../src/sdk/catalystSdkBridge.js';
import { CANONICAL_ROUTE_COUNT } from '../src/routes/routeContracts.js';
import { catalystAdvancedIoEntry, resetAdvancedIoRuntimeForTests } from '../src/server/catalystEntry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function buildValidDevelopmentEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
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
    ...overrides,
  };
}

function invokeEntry(
  method: string,
  url: string,
  headers: Record<string, string>,
  envOverrides: Record<string, string | undefined>,
): { statusCode: number; body: Record<string, unknown> } {
  const prevEnv = { ...process.env };
  const managedKeys = [
    'VIGORCORE_DEPLOYMENT_ENVIRONMENT',
    'CATALYST_ENVIRONMENT',
    'VIGOR_ENVIRONMENT',
    'NODE_ENV',
    'VIGORCORE_CATALYST_PROJECT_ID',
    'CATALYST_PROJECT_ID',
    'VIGOR_CATALYST_AUTH_MODE',
    'VIGOR_CORS_MODE',
    'VIGORCORE_CATALYST_API_DOMAIN',
    'CATALYST_API_DOMAIN',
    'VIGORCORE_CATALYST_ACCOUNTS_URL',
    'CATALYST_ACCOUNTS_URL',
    'VIGOR_SESSION_HMAC_SECRET',
    'VIGOR_SESSION_ACTIVE_KID',
    'VIGOR_ALLOWED_ORIGINS',
    'CATALYST_PROJECT_KEY',
  ];
  for (const k of managedKeys) delete process.env[k];
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  resetAdvancedIoRuntimeForTests();
  try {
    let statusCode = 0;
    let bodyText = '';
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk?: string) {
        statusCode = mockRes.statusCode;
        bodyText = String(chunk || '');
      },
    };
    catalystAdvancedIoEntry({ headers, method, url } as never, mockRes as never);
    return {
      statusCode,
      body: bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {},
    };
  } finally {
    resetAdvancedIoRuntimeForTests();
    for (const k of managedKeys) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
  }
}

test('Phase 5.3 [PASS-LOCAL] Valid non-reserved VIGORCORE_CATALYST_* variables pass preflight, runtime, and GET /health (200)', async () => {
  const env = buildValidDevelopmentEnv();
  const preflight = runCatalystConfigPreflight(env, {
    scope: 'full_server_runtime',
    authMode: 'hosted_native',
    expectedProjectId: '136967000000014024',
    expectedRegion: 'us',
  });
  assert.equal(preflight.verdict, 'PASS');
  assert.deepEqual(preflight.failures, []);

  assert.equal(resolveCatalystProjectIdFromEnv(env), '136967000000014024');
  assert.equal(resolveCatalystApiDomainFromEnv(env), 'https://api.catalyst.zoho.com');
  assert.equal(resolveCatalystAccountsUrlFromEnv(env), 'https://accounts.zoho.com');

  const prevEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetAdvancedIoRuntimeForTests();
  const srv = http.createServer(catalystAdvancedIoEntry);
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()));
  const port = (srv.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.success, true);
    assert.equal(body.status, 'ok');
    assert.equal(body.routeCount, CANONICAL_ROUTE_COUNT);
  } finally {
    resetAdvancedIoRuntimeForTests();
    for (const k of Object.keys(env)) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-LOCAL] Missing VIGORCORE_CATALYST_PROJECT_ID fails closed 503 without falling back to unpinned or client-controlled IDs', async () => {
  const missingProjEnv = buildValidDevelopmentEnv({ VIGORCORE_CATALYST_PROJECT_ID: undefined });
  const r = invokeEntry('GET', '/health', { 'x-zc-projectid': '136967000000014024' }, missingProjEnv);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.error, 'SERVER_CONFIGURATION_UNAVAILABLE');
  assert.match(String(r.body.message), /MISSING_CATALYST_ADMIN_CONFIG/);
  assert.match(String(r.body.message), /VIGORCORE_CATALYST_PROJECT_ID/);

  // Preflight also fails closed
  const preflight = runCatalystConfigPreflight(missingProjEnv, { scope: 'full_server_runtime', authMode: 'hosted_native' });
  assert.equal(preflight.verdict, 'FAIL');
  assert.ok(preflight.failures.some(f => f.key === 'VIGORCORE_CATALYST_PROJECT_ID' && f.code === 'MISSING_CATALYST_PROJECT_ID'));
});

test('Phase 5.3 [PASS-LOCAL] x-zc-projectid mismatch fails closed 403 PROJECT_CONTEXT_MISMATCH and never selects project dynamically', async () => {
  const env = buildValidDevelopmentEnv();
  const runtime = HostedNativeCatalystAuthRuntime.fromEnvironment(env);

  let caught: any;
  try {
    await runtime.runWithRequestContext(
      {
        'x-zc-projectid': '999999999999999999',
        'x-zc-environment': 'Development',
        'x-zc-project-key': 'edge_key_test',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'adm_tok_test',
      },
      async () => {},
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.equal(caught.statusCode, 403);
  assert.equal(caught.code, 'PROJECT_CONTEXT_MISMATCH');

  // Server pin stays fixed and never reads project selection from client/request headers
  assert.equal(runtime.getConfig().projectId, '136967000000014024');
});

test('Phase 5.3 [PASS-LOCAL] Invalid or insecure API/Accounts URLs fail closed while omitted runtime defaults pin US SDK origins safely', () => {
  // Invalid / insecure URL rejection
  assert.throws(
    () =>
      HostedNativeCatalystAuthRuntime.fromEnvironment(
        buildValidDevelopmentEnv({ VIGORCORE_CATALYST_API_DOMAIN: 'http://api.catalyst.zoho.com' }),
      ),
    /INSECURE_CATALYST_URL/,
  );
  assert.throws(
    () =>
      HostedNativeCatalystAuthRuntime.fromEnvironment(
        buildValidDevelopmentEnv({ VIGORCORE_CATALYST_ACCOUNTS_URL: 'not-a-valid-url' }),
      ),
    /INVALID_CATALYST_URL/,
  );

  // Region mismatch caught in preflight
  const regionMismatch = runCatalystConfigPreflight(
    buildValidDevelopmentEnv({
      VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.eu',
      VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    }),
    { scope: 'full_server_runtime', authMode: 'hosted_native' },
  );
  assert.equal(regionMismatch.verdict, 'FAIL');
  assert.ok(regionMismatch.failures.some(f => f.code === 'REGION_ACCOUNTS_MISMATCH'));

  // Safe US SDK default fallback in runtime if omitted explicitly
  const omittedUrlsEnv = buildValidDevelopmentEnv({
    VIGORCORE_CATALYST_API_DOMAIN: undefined,
    VIGORCORE_CATALYST_ACCOUNTS_URL: undefined,
  });
  assert.equal(resolveCatalystApiDomainFromEnv(omittedUrlsEnv), undefined);
  assert.equal(resolveCatalystAccountsUrlFromEnv(omittedUrlsEnv), undefined);
  const rt = HostedNativeCatalystAuthRuntime.fromEnvironment(omittedUrlsEnv);
  assert.equal(rt.getConfig().apiDomain, 'https://api.catalyst.zoho.com');
  assert.equal(rt.getConfig().accountsUrl, 'https://accounts.zoho.com');
});

test('Phase 5.3 [PASS-LOCAL] Reserved legacy CATALYST_* keys fail closed (RESERVED_CATALYST_ENV_VAR / conflict)', () => {
  for (const [legacyKey, canonicalKey, sampleVal] of [
    ['CATALYST_PROJECT_ID', 'VIGORCORE_CATALYST_PROJECT_ID', '136967000000014024'],
    ['CATALYST_API_DOMAIN', 'VIGORCORE_CATALYST_API_DOMAIN', 'https://api.catalyst.zoho.com'],
    ['CATALYST_ACCOUNTS_URL', 'VIGORCORE_CATALYST_ACCOUNTS_URL', 'https://accounts.zoho.com'],
  ] as const) {
    // Legacy key alone without canonical key -> fail closed in runtime & preflight
    const onlyLegacy = buildValidDevelopmentEnv({
      [canonicalKey]: undefined,
      [legacyKey]: sampleVal,
    });
    const healthRes = invokeEntry('GET', '/health', {}, onlyLegacy);
    if (legacyKey === 'CATALYST_PROJECT_ID') {
      assert.equal(healthRes.statusCode, 503);
      assert.match(String(healthRes.body.message), /RESERVED_CATALYST_ENV_VAR/);
    } else {
      assert.throws(() => HostedNativeCatalystAuthRuntime.fromEnvironment(onlyLegacy), /RESERVED_CATALYST_ENV_VAR/);
    }

    const preflightRes = runCatalystConfigPreflight(onlyLegacy, { scope: 'full_server_runtime', authMode: 'hosted_native' });
    assert.equal(preflightRes.verdict, 'FAIL');
    assert.ok(preflightRes.failures.some(f => f.key === legacyKey && f.code === 'RESERVED_CATALYST_ENV_VAR'));

    // Legacy key alongside canonical key with conflicting value -> rejected
    const conflicting = buildValidDevelopmentEnv({
      [legacyKey]: legacyKey === 'CATALYST_PROJECT_ID' ? '999999999999999999' : 'https://api.catalyst.zoho.eu',
    });
    assert.throws(
      () => HostedNativeCatalystAuthRuntime.fromEnvironment(conflicting),
      /PROJECT_CONFIGURATION_CONFLICT|ENVIRONMENT_CONFIGURATION_CONFLICT/,
    );
  }
});

test('Phase 5.3 [PASS-LOCAL] Cross-environment Production/Development isolation remains strictly enforced', async () => {
  assert.throws(
    () =>
      HostedNativeCatalystAuthRuntime.fromEnvironment(
        buildValidDevelopmentEnv({
          VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
          VIGOR_ENVIRONMENT: 'production',
        }),
      ),
    /ENVIRONMENT_SEPARATION_VIOLATION/,
  );

  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
        CATALYST_PROJECT_KEY: 'proj_key_valid_test',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Production',
        VIGOR_ENVIRONMENT: 'development',
        CATALYST_ADMIN_CLIENT_ID: '1000.TEST',
        CATALYST_ADMIN_CLIENT_SECRET: 'real_secret_val',
        CATALYST_ADMIN_REFRESH_TOKEN: '1000.refresh',
      }),
    /ENVIRONMENT_SEPARATION_VIOLATION/,
  );
});

test('Phase 5.3 [PASS-STATIC] Source code contains zero unintended runtime fallback reads of reserved CATALYST_* keys and docs/ZIP are reconciled', () => {
  const srcFiles = [
    path.join(POC_ROOT, 'src', 'sdk', 'catalystSdkBridge.ts'),
    path.join(POC_ROOT, 'src', 'provisioning', 'catalystConfigPreflight.ts'),
    path.join(POC_ROOT, 'src', 'provisioning', 'domainGatewayConfigs.ts'),
    path.join(POC_ROOT, 'src', 'server', 'advancedIoApp.ts'),
    path.join(POC_ROOT, 'src', 'server', 'catalystEntry.ts'),
  ];

  for (const file of srcFiles) {
    const text = fs.readFileSync(file, 'utf8');
    // Must never compute runtime config with fallback `|| envMap.CATALYST_PROJECT_ID` etc.
    assert.equal(/\?\?\s*(envMap|process\.env)\.CATALYST_(PROJECT_ID|API_DOMAIN|ACCOUNTS_URL)/g.test(text), false, `Fallback read found in ${file}`);
    assert.equal(/\|\|\s*(envMap|process\.env)\.CATALYST_(PROJECT_ID|API_DOMAIN|ACCOUNTS_URL)/g.test(text), false, `Fallback read found in ${file}`);
  }

  const doc36 = fs.readFileSync(path.join(POC_ROOT, 'docs', '36-phase-5.3-environment-reconciliation.md'), 'utf8');
  const doc37 = fs.readFileSync(path.join(POC_ROOT, 'docs', '37-phase-5.3-final-deployment-package.md'), 'utf8');
  const doc39 = fs.readFileSync(path.join(POC_ROOT, 'docs', '39-phase-5.3-environment-configuration-checklist.md'), 'utf8');
  const doc40 = fs.readFileSync(path.join(POC_ROOT, 'docs', '40-phase-5.3-reserved-env-vars-reconciliation.md'), 'utf8');

  const zipPath = path.join(POC_ROOT, 'artifacts', 'vigor_api-vars-reconciled-portable.zip');
  assert.equal(fs.existsSync(zipPath), true);
  const actualSha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  assert.equal(actualSha, 'cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc');

  for (const doc of [doc36, doc37, doc39, doc40]) {
    assert.ok(doc.includes('VIGORCORE_CATALYST_PROJECT_ID'));
    assert.ok(doc.includes('VIGORCORE_CATALYST_API_DOMAIN'));
    assert.ok(doc.includes('VIGORCORE_CATALYST_ACCOUNTS_URL'));
    assert.ok(doc.includes('PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED'));
  }
});
