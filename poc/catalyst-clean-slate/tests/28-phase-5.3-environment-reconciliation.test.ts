/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 28:
 * Environment Reconciliation & Reserved Keyword Mitigation (`VIGORCORE_DEPLOYMENT_ENVIRONMENT`),
 * Fail-Closed Validation, Project & Environment Context Checks, and AsyncLocalStorage Isolation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HostedNativeCatalystAuthRuntime,
  resolveDeploymentEnvironmentFromEnv,
} from '../src/sdk/catalystSdkBridge.js';
import { runCatalystConfigPreflight } from '../src/provisioning/catalystConfigPreflight.js';

test('Phase 5.3 [PASS-UNIT] resolveDeploymentEnvironmentFromEnv detects valid Development & Production correctly', () => {
  assert.equal(
    resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development' }),
    'Development'
  );
  assert.equal(
    resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Production' }),
    'Production'
  );
});

test('Phase 5.3 [PASS-UNIT] resolveDeploymentEnvironmentFromEnv fails closed on missing variable, placeholders, and invalid values', () => {
  assert.throws(
    () => resolveDeploymentEnvironmentFromEnv({}),
    /INVALID_DEPLOYMENT_ENVIRONMENT/
  );
  assert.throws(
    () => resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: '' }),
    /INVALID_DEPLOYMENT_ENVIRONMENT/
  );
  assert.throws(
    () => resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Staging' }),
    /INVALID_DEPLOYMENT_ENVIRONMENT/
  );
  assert.throws(
    () => resolveDeploymentEnvironmentFromEnv({ VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'YOUR_ENVIRONMENT' }),
    /INVALID_DEPLOYMENT_ENVIRONMENT/
  );
});

test('Phase 5.3 [PASS-UNIT] resolveDeploymentEnvironmentFromEnv fails closed on reserved CATALYST_ENVIRONMENT keyword usage or conflict', () => {
  assert.throws(
    () => resolveDeploymentEnvironmentFromEnv({ CATALYST_ENVIRONMENT: 'Development' }),
    /RESERVED_CATALYST_ENV_VAR/
  );
  assert.throws(
    () =>
      resolveDeploymentEnvironmentFromEnv({
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        CATALYST_ENVIRONMENT: 'Production',
      }),
    /ENVIRONMENT_SEPARATION_VIOLATION/
  );
});

test('Phase 5.3 [PASS-UNIT] HostedNativeCatalystAuthRuntime enforces project and environment context checks', async () => {
  const runtime = HostedNativeCatalystAuthRuntime.fromEnvironment({
    CATALYST_PROJECT_ID: '136967000000014024',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
  });

  // 1. Wrong project ID in request header -> 403 PROJECT_CONTEXT_MISMATCH
  let caught1: any;
  try {
    await runtime.runWithRequestContext(
      {
        'x-zc-projectid': 'proj_attacker_999',
        'x-zc-environment': 'Development',
        'x-zc-project-key': 'k_1',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'tok_1',
      },
      async () => {}
    );
  } catch (err) {
    caught1 = err;
  }
  assert.ok(caught1);
  assert.equal(caught1.statusCode, 403);
  assert.equal(caught1.code, 'PROJECT_CONTEXT_MISMATCH');

  // 2. Wrong environment in request header -> 403 PROJECT_CONTEXT_MISMATCH
  let caught2: any;
  try {
    await runtime.runWithRequestContext(
      {
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Production',
        'x-zc-project-key': 'k_1',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'tok_1',
      },
      async () => {}
    );
  } catch (err) {
    caught2 = err;
  }
  assert.ok(caught2);
  assert.equal(caught2.statusCode, 403);
  assert.equal(caught2.code, 'PROJECT_CONTEXT_MISMATCH');
});

test('Phase 5.3 [PASS-UNIT] Config preflight requires VIGORCORE_DEPLOYMENT_ENVIRONMENT and rejects reserved CATALYST_ENVIRONMENT', () => {
  const preflightMissing = runCatalystConfigPreflight({
    CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_ENVIRONMENT: 'development',
    CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: '1234567890123456789012345678901234567890123',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  });
  assert.equal(preflightMissing.verdict, 'FAIL');
  assert.ok(preflightMissing.failures.some(f => f.code === 'INVALID_DEPLOYMENT_ENVIRONMENT'));

  const preflightReserved = runCatalystConfigPreflight({
    CATALYST_PROJECT_ID: '136967000000014024',
    CATALYST_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: '1234567890123456789012345678901234567890123',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  });
  assert.equal(preflightReserved.verdict, 'FAIL');
  assert.ok(preflightReserved.failures.some(f => f.code === 'RESERVED_CATALYST_ENV_VAR'));
});
