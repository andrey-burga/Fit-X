/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 32:
 * Final Environment Variable Audit, Startup/Health Behavior, and HMAC Secret Encoding Rules.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeAndValidateHmacSecret,
  ServerSessionTokenManager,
} from '../src/auth/cleanSlateAuthGuard.js';
import { runCatalystConfigPreflight } from '../src/provisioning/catalystConfigPreflight.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { catalystAdvancedIoEntry, resetAdvancedIoRuntimeForTests } from '../src/server/catalystEntry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function buildValidDevelopmentEnv(): Record<string, string> {
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

function invokeEntryHealth(envOverrides: Record<string, string | undefined>): {
  statusCode: number;
  body: Record<string, unknown>;
} {
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
  for (const k of managedKeys) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  resetAdvancedIoRuntimeForTests();
  try {
    let statusCode = 0;
    let bodyText = '';
    const mockReq = { headers: {}, method: 'GET', url: '/health' };
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk?: string) {
        statusCode = mockRes.statusCode;
        bodyText = String(chunk || '');
      },
    };
    catalystAdvancedIoEntry(mockReq as never, mockRes as never);
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

test('Phase 5.3 [PASS-LOCAL] All 10 Development env vars pass preflight without NODE_ENV or CATALYST_ENVIRONMENT', () => {
  const env = buildValidDevelopmentEnv();
  const report = runCatalystConfigPreflight(env, {
    scope: 'full_server_runtime',
    authMode: 'hosted_native',
    expectedProjectId: '136967000000014024',
    expectedRegion: 'us',
  });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.networkCallsExecuted, 0);
  assert.equal(report.writeOperationsExecuted, 0);
  assert.equal(report.failures.length, 0);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(env.VIGOR_SESSION_HMAC_SECRET), false);
});

test('Phase 5.3 [PASS-LOCAL] Startup fail-closed behavior (503 SERVER_CONFIGURATION_UNAVAILABLE) for missing or invalid critical vars', () => {
  const valid = buildValidDevelopmentEnv();

  // Missing VIGORCORE_DEPLOYMENT_ENVIRONMENT -> 503
  const missingDeployEnv = { ...valid };
  delete missingDeployEnv.VIGORCORE_DEPLOYMENT_ENVIRONMENT;
  const r1 = invokeEntryHealth(missingDeployEnv);
  assert.equal(r1.statusCode, 503);
  assert.equal(r1.body.error, 'SERVER_CONFIGURATION_UNAVAILABLE');
  assert.match(String(r1.body.message), /INVALID_DEPLOYMENT_ENVIRONMENT/);

  // Reserved CATALYST_ENVIRONMENT instead of VIGORCORE_DEPLOYMENT_ENVIRONMENT -> 503
  const reservedEnv = { ...missingDeployEnv, CATALYST_ENVIRONMENT: 'Development' };
  const r2 = invokeEntryHealth(reservedEnv);
  assert.equal(r2.statusCode, 503);
  assert.match(String(r2.body.message), /RESERVED_CATALYST_ENV_VAR/);

  // Missing VIGORCORE_CATALYST_PROJECT_ID -> 503
  const missingProj = { ...valid };
  delete missingProj.VIGORCORE_CATALYST_PROJECT_ID;
  const r3 = invokeEntryHealth(missingProj);
  assert.equal(r3.statusCode, 503);
  assert.match(String(r3.body.message), /MISSING_CATALYST_ADMIN_CONFIG/);

  // Missing VIGOR_CATALYST_AUTH_MODE falls back to external_oauth -> fails 503 lacking CATALYST_PROJECT_KEY
  const missingAuthMode = { ...valid };
  delete missingAuthMode.VIGOR_CATALYST_AUTH_MODE;
  const r4 = invokeEntryHealth(missingAuthMode);
  assert.equal(r4.statusCode, 503);
  assert.match(String(r4.body.message), /CATALYST_PROJECT_KEY/);

  // Missing VIGOR_SESSION_HMAC_SECRET -> 503
  const missingSecret = { ...valid };
  delete missingSecret.VIGOR_SESSION_HMAC_SECRET;
  const r5 = invokeEntryHealth(missingSecret);
  assert.equal(r5.statusCode, 503);
  assert.match(String(r5.body.message), /MISSING_SESSION_HMAC_SECRET/);

  // NODE_ENV=production without VIGOR_ENVIRONMENT triggers ENVIRONMENT_SEPARATION_VIOLATION -> 503
  const nodeEnvHazard: Record<string, string | undefined> = { ...valid, NODE_ENV: 'production' };
  delete nodeEnvHazard.VIGOR_ENVIRONMENT;
  const r6 = invokeEntryHealth(nodeEnvHazard);
  assert.equal(r6.statusCode, 503);
  assert.match(String(r6.body.message), /ENVIRONMENT_SEPARATION_VIOLATION/);
});

test('Phase 5.3 [PASS-LOCAL] Omitting VIGOR_ALLOWED_ORIGINS falls back to onslate.com and rejects app.vigorcore.lat', () => {
  const envWithoutOrigins = buildValidDevelopmentEnv();
  delete envWithoutOrigins.VIGOR_ALLOWED_ORIGINS;
  const bundleFallback = createVigorCoreProductionRuntimeFromEnv(envWithoutOrigins);
  assert.equal(bundleFallback.httpPolicy.isOriginAllowed('https://app.vigorcore.lat'), false);
  assert.equal(bundleFallback.httpPolicy.isOriginAllowed('https://fit-x-bhnatsxl.onslate.com'), true);

  const envWithOrigins = buildValidDevelopmentEnv();
  const bundleExplicit = createVigorCoreProductionRuntimeFromEnv(envWithOrigins);
  assert.equal(bundleExplicit.httpPolicy.isOriginAllowed('https://app.vigorcore.lat'), true);
});

test('Phase 5.3 [PASS-LOCAL] HMAC secret encoding: canonical Base64URL, >=32 bytes, >=16 distinct bytes, no trimming, no prefixes', () => {
  // PowerShell 5.1 ToBase64String -> TrimEnd('=') -> Replace('+','-') -> Replace('/','_') equivalence
  for (let i = 0; i < 25; i++) {
    const raw = crypto.randomBytes(32);
    const psEquivalent = raw
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    assert.equal(psEquivalent.length, 43);
    assert.match(psEquivalent, /^[A-Za-z0-9_-]+$/);
    const decoded = decodeAndValidateHmacSecret(psEquivalent, 'VIGOR_SESSION_HMAC_SECRET');
    assert.equal(decoded.length, 32);
    assert.equal(Buffer.compare(decoded, raw), 0);
  }

  // Runtime fromEnvironment does NOT trim leading/trailing whitespace or newlines
  const valid = buildValidDevelopmentEnv();
  assert.throws(
    () => ServerSessionTokenManager.fromEnvironment({ ...valid, VIGOR_SESSION_HMAC_SECRET: `${valid.VIGOR_SESSION_HMAC_SECRET}\n` }),
    /SESSION_SECRET_MALFORMED/,
  );
  assert.throws(
    () => ServerSessionTokenManager.fromEnvironment({ ...valid, VIGOR_SESSION_HMAC_SECRET: ` ${valid.VIGOR_SESSION_HMAC_SECRET}` }),
    /SESSION_SECRET_MALFORMED/,
  );

  // Rejects padding '=', standard '+'/'/', prefixes, <32 decoded bytes, and low entropy
  assert.throws(() => decodeAndValidateHmacSecret(`${valid.VIGOR_SESSION_HMAC_SECRET}=`), /SESSION_SECRET_MALFORMED/);
  assert.throws(() => decodeAndValidateHmacSecret(`base64url:${valid.VIGOR_SESSION_HMAC_SECRET}`), /SESSION_SECRET_MALFORMED/);
  assert.throws(() => decodeAndValidateHmacSecret('AbCdEfGhIjKlMnOpQrStUvWxYz012345'), /SESSION_SECRET_INSUFFICIENT_BYTES/);
  assert.throws(
    () => decodeAndValidateHmacSecret(Buffer.alloc(32, 0x41).toString('base64url')),
    /SESSION_SECRET_LOW_ENTROPY/,
  );

  // Same key signs and verifies session + CSRF with active kid=k1 (no external registry required)
  const mgr = ServerSessionTokenManager.fromEnvironment(valid);
  const { token, claims } = mgr.issueTokenWithClaims('user-123', 1);
  assert.equal(claims.kid, 'k1');
  assert.equal(claims.env, 'development');
  const verified = mgr.verifyToken(token, 'user-123');
  assert.equal(verified.sid, claims.sid);
  const csrf = mgr.issueCsrfToken('user-123', claims.sid, 1, claims.exp);
  const verifiedCsrf = mgr.verifyCsrfToken(csrf, { userId: 'user-123', sessionId: claims.sid, sessionEpoch: 1 });
  assert.equal(verifiedCsrf.kid, 'k1');
});

test('Phase 5.3 [PASS-STATIC] Docs 37 & 39 contain complete env audit, safe PS 5.1 command, sequence, and target status', () => {
  const doc37 = fs.readFileSync(path.join(POC_ROOT, 'docs', '37-phase-5.3-final-deployment-package.md'), 'utf8');
  const doc39 = fs.readFileSync(path.join(POC_ROOT, 'docs', '39-phase-5.3-environment-configuration-checklist.md'), 'utf8');

  const expectedVars = [
    'VIGORCORE_DEPLOYMENT_ENVIRONMENT',
    'VIGOR_ENVIRONMENT',
    'VIGORCORE_CATALYST_PROJECT_ID',
    'VIGOR_CATALYST_AUTH_MODE',
    'VIGOR_CORS_MODE',
    'VIGORCORE_CATALYST_API_DOMAIN',
    'VIGORCORE_CATALYST_ACCOUNTS_URL',
    'VIGOR_SESSION_HMAC_SECRET',
    'VIGOR_SESSION_ACTIVE_KID',
    'VIGOR_ALLOWED_ORIGINS',
  ];
  for (const v of expectedVars) {
    assert.ok(doc37.includes(v), `Doc 37 missing ${v}`);
    assert.ok(doc39.includes(v), `Doc 39 missing ${v}`);
  }

  for (const doc of [doc37, doc39]) {
    assert.ok(doc.includes('PHASE_5_3_ENVIRONMENT_VARIABLE_NAMES_RECONCILED_NOT_DEPLOYED'));
    assert.ok(doc.includes('vigor_api-vars-reconciled-portable.zip'));
    assert.ok(doc.includes('Set-Clipboard -Value'));
    assert.ok(doc.includes('136967000000014024'));
    assert.ok(doc.includes('136967000000074001'));
  }
});
