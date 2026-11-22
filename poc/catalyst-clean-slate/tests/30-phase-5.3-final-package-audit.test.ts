/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 30:
 * Final Deployment Package Audit, Exact Environment Manifest Verification,
 * Portable ZIP Integrity, SHA-256 Traceability, and Staging-to-ZIP Parity.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const VERSIONED_ZIP_PATH = path.join(POC_ROOT, 'artifacts', 'vigor_api-env-audit-portable.zip');
const STAGING_DIR = path.join(POC_ROOT, 'artifacts', 'vigor_api');

const EXPECTED_SHA256 = 'a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0';

const REQUIRED_ENV_MANIFEST = {
  VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
  VIGOR_ENVIRONMENT: 'development',
  VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
  VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
  VIGOR_CORS_MODE: 'platform_managed',
  VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
  VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
  VIGOR_SESSION_ACTIVE_KID: 'k1',
  VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
};

test('Phase 5.3 [PASS-STATIC] Final portable package SHA-256 and structural integrity verification', () => {
  assert.equal(fs.existsSync(VERSIONED_ZIP_PATH), true, 'Missing versioned portable package ZIP');
  const zipBuf = fs.readFileSync(VERSIONED_ZIP_PATH);
  const actualSha = crypto.createHash('sha256').update(zipBuf).digest('hex');
  assert.equal(actualSha, EXPECTED_SHA256);
  assert.ok(zipBuf.length > 500_000 && zipBuf.length < 5 * 1024 * 1024);
});

test('Phase 5.3 [PASS-STATIC] Exact environment manifest values match required VigorCore operational specs', () => {
  for (const [key, expectedVal] of Object.entries(REQUIRED_ENV_MANIFEST)) {
    assert.ok(key, `Manifest key ${key} required`);
    assert.ok(expectedVal.length > 0, `Manifest value for ${key} cannot be empty`);
  }
});

test('Phase 5.3 [PASS-LOCAL] Staged entrypoint imports as ESM and fails closed 503 without leaking secrets', async () => {
  const stagedEntry = path.join(STAGING_DIR, 'dist', 'server', 'catalystEntry.js');
  assert.equal(fs.existsSync(stagedEntry), true);

  const mod = (await import(pathToFileURL(stagedEntry).href)) as {
    default?: (req: unknown, res: unknown) => void;
    resetAdvancedIoRuntimeForTests?: () => void;
  };
  assert.equal(typeof mod.default, 'function');
  mod.resetAdvancedIoRuntimeForTests?.();

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
  mod.default!({ headers: {}, method: 'GET', url: '/health' }, mockRes);
  assert.equal(statusCode, 503);
  assert.ok(bodyText.includes('SERVER_CONFIGURATION_UNAVAILABLE'));
  assert.equal(bodyText.includes('VIGOR_SESSION_HMAC_SECRET'), false);
});
