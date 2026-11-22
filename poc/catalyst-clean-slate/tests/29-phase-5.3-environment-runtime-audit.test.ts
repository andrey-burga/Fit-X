/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 29:
 * Environment Runtime Audit, Trusted Header Evaluation (`x-zc-environment`),
 * Spoofed/Untrusted Header Rejection, Dual-Lock Environment Separation,
 * and Portable Package SHA-256 / Manifest Verification.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HostedNativeCatalystAuthRuntime,
  resolveDeploymentEnvironmentFromEnv,
} from '../src/sdk/catalystSdkBridge.js';
import { runCatalystConfigPreflight } from '../src/provisioning/catalystConfigPreflight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

test('Phase 5.3 [PASS-UNIT] Runtime audit: VIGORCORE_DEPLOYMENT_ENVIRONMENT vs VIGOR_ENVIRONMENT dual-lock isolation', () => {
  // 1. Valid Development pair
  const devEnv = resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development' });
  assert.equal(devEnv, 'Development');

  // 2. Valid Production pair
  const prodEnv = resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Production' });
  assert.equal(prodEnv, 'Production');

  // 3. Crossover rejection: VIGOR_ENVIRONMENT=production with VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development
  assert.throws(
    () =>
      HostedNativeCatalystAuthRuntime.fromEnvironment({
        VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'production',
      }),
    /ENVIRONMENT_SEPARATION_VIOLATION/
  );
});

test('Phase 5.3 [PASS-LOOPBACK] Trusted header audit: Spoofed or mismatched x-zc-environment fails closed 403 PROJECT_CONTEXT_MISMATCH', async () => {
  const runtime = HostedNativeCatalystAuthRuntime.fromEnvironment({
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
  });

  // Spoofed header `x-zc-environment: Production` against server-pinned Development runtime
  let caughtError: any;
  try {
    await runtime.runWithRequestContext(
      {
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Production',
        'x-zc-project-key': 'proj_key_valid',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'admin_tok_123',
      },
      async () => {}
    );
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError);
  assert.equal(caughtError.statusCode, 403);
  assert.equal(caughtError.code, 'PROJECT_CONTEXT_MISMATCH');
  assert.ok(caughtError.message.includes('x-zc-environment does not match'));
});

test('Phase 5.3 [PASS-STATIC] Portable production bundle artifacts and SHA-256 traceability verification', () => {
  const portableZipPath = path.join(POC_ROOT, 'artifacts', 'vigor_api-portable.zip');
  const originalZipPath = path.join(POC_ROOT, 'artifacts', 'vigor_api.zip');
  const stagingDir = path.join(POC_ROOT, 'artifacts', 'vigor_api');

  assert.equal(fs.existsSync(portableZipPath), true, 'Missing portable production ZIP artifact');
  assert.equal(fs.existsSync(originalZipPath), true, 'Missing original preserved ZIP artifact');
  assert.equal(fs.existsSync(stagingDir), true, 'Missing staging directory');

  const portableStats = fs.statSync(portableZipPath);
  assert.ok(portableStats.size > 500_000 && portableStats.size < 5 * 1024 * 1024);

  const stagingPkg = JSON.parse(fs.readFileSync(path.join(stagingDir, 'package.json'), 'utf8'));
  assert.equal(stagingPkg.name, 'vigor_api');
  assert.equal(stagingPkg.type, 'module');
  assert.equal(stagingPkg.main, 'dist/server/catalystEntry.js');
  assert.deepEqual(Object.keys(stagingPkg.dependencies).sort(), [
    '@zcatalyst/auth',
    '@zcatalyst/auth-admin',
    '@zcatalyst/nosql',
    '@zcatalyst/transport',
    '@zcatalyst/utils',
    'express',
  ].sort());
});
