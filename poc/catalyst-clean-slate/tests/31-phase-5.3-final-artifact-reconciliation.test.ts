/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 31:
 * Final Deployment Artifact SHA-256 Reconciliation & Reproducibility Verification.
 *
 * Covers:
 *  1. Two consecutive builds yield byte-for-byte identical ZIP size and SHA-256.
 *  2. Canonical sorted content manifest matches prior audit ZIP (0 missing, 0 unexpected, 0 diffs).
 *  3. Strict deterministic ZIP metadata: code-point sorted paths, '/', DOS 1980-01-01, no symlinks/OS junk.
 *  4. Production package.json (6 runtime deps, zero devDeps/secrets) & catalyst-config.json (node22).
 *  5. Linux `unzip -tq` + `unzip -oq` extraction compatibility and Node 22 ESM entrypoint import (503).
 *  6. All prior artifacts preserved intact; documentation updated with final verdict.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildReproduciblePortablePackage,
  compareCodePoint,
  compareContentManifests,
  extractCanonicalContentManifest,
  FIXED_DOS_MDATE,
  FIXED_DOS_MTIME,
  parseZipEntries,
  RUNTIME_PACKAGES,
} from '../scripts/build-vigor-api-portable-package.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');

const VARS_RECONCILED_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-vars-reconciled-portable.zip');
const REPRODUCIBLE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-reproducible-portable.zip');
const ENV_AUDIT_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-env-audit-portable.zip');
const PORTABLE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-portable.zip');
const ORIGINAL_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api.zip');

const EXPECTED_VARS_RECONCILED_SHA256 = 'cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc';
const EXPECTED_REPRODUCIBLE_SHA256 = '31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb';
const EXPECTED_ENV_AUDIT_SHA256 = 'a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0';
const EXPECTED_PORTABLE_SHA256 = 'd009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8';
const EXPECTED_ORIGINAL_SHA256 = 'd0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readZipFileUtf8(zipPath: string, entryName: string): string {
  const buf = fs.readFileSync(zipPath);
  const parsed = parseZipEntries(zipPath).find(e => e.name === entryName);
  assert.ok(parsed, `Missing expected ZIP entry: ${entryName}`);
  const lfhNLen = buf.readUInt16LE(parsed.lfhOffset + 26);
  const lfhELen = buf.readUInt16LE(parsed.lfhOffset + 28);
  const start = parsed.lfhOffset + 30 + lfhNLen + lfhELen;
  const comp = buf.subarray(start, start + parsed.compSize);
  const plain = parsed.method === 0 ? comp : zlib.inflateRawSync(comp);
  return plain.toString('utf8');
}

test('Phase 5.3 [PASS-LOCAL] Two consecutive reproducible builds produce identical size and SHA-256 without overwriting prior ZIPs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-repro-test-'));
  try {
    const zipA = path.join(tmpDir, 'build-a.zip');
    const zipB = path.join(tmpDir, 'build-b.zip');

    const resA = buildReproduciblePortablePackage({ outputZipPath: zipA, skipCompile: true, quiet: true });
    const resB = buildReproduciblePortablePackage({ outputZipPath: zipB, skipCompile: true, quiet: true });

    assert.equal(resA.zipSizeBytes, resB.zipSizeBytes);
    assert.equal(resA.sha256, resB.sha256);
    assert.equal(resA.entryCount, 905);
    assert.ok(resA.totalUncompressedBytes >= 3_754_947);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.equal(sha256File(VARS_RECONCILED_ZIP_PATH), EXPECTED_VARS_RECONCILED_SHA256);
  assert.equal(sha256File(REPRODUCIBLE_ZIP_PATH), EXPECTED_REPRODUCIBLE_SHA256);
  assert.equal(sha256File(ENV_AUDIT_ZIP_PATH), EXPECTED_ENV_AUDIT_SHA256);
  assert.equal(sha256File(PORTABLE_ZIP_PATH), EXPECTED_PORTABLE_SHA256);
  assert.equal(sha256File(ORIGINAL_ZIP_PATH), EXPECTED_ORIGINAL_SHA256);
});

test('Phase 5.3 [PASS-LOCAL] Canonical sorted content manifest matches prior audit artifact and isolates reserved-var delta to catalystSdkBridge.js', () => {
  const priorAuditManifest = extractCanonicalContentManifest(ENV_AUDIT_ZIP_PATH);
  const priorReproManifest = extractCanonicalContentManifest(REPRODUCIBLE_ZIP_PATH);
  const historicDiff = compareContentManifests(priorAuditManifest, priorReproManifest);

  assert.equal(priorAuditManifest.length, 905);
  assert.equal(priorReproManifest.length, 905);
  assert.deepEqual(historicDiff.missing, []);
  assert.deepEqual(historicDiff.unexpected, []);
  assert.deepEqual(historicDiff.changed, []);
  assert.equal(historicDiff.expectedTotalUncompressedBytes, 3_751_004);
  assert.equal(historicDiff.actualTotalUncompressedBytes, 3_751_004);

  const varsReconciledManifest = extractCanonicalContentManifest(VARS_RECONCILED_ZIP_PATH);
  const delta = compareContentManifests(priorReproManifest, varsReconciledManifest);
  assert.equal(varsReconciledManifest.length, 905);
  assert.deepEqual(delta.missing, []);
  assert.deepEqual(delta.unexpected, []);
  assert.deepEqual(
    delta.changed.map(c => c.path),
    ['dist/sdk/catalystSdkBridge.js'],
  );
  assert.equal(delta.actualTotalUncompressedBytes, 3_754_947);
});

test('Phase 5.3 [PASS-LOCAL] Reproducible ZIP enforces code-point ordering, DOS 1980-01-01 timestamps, forward slashes, and clean metadata', () => {
  const entries = parseZipEntries(VARS_RECONCILED_ZIP_PATH);
  assert.equal(entries.length, 905);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0) {
      assert.ok(
        compareCodePoint(entries[i - 1].name, e.name) < 0,
        `Out-of-order ZIP entry at ${i}: ${entries[i - 1].name} >= ${e.name}`,
      );
    }
    assert.equal(e.name.includes('\\'), false, `Backslash separator found in ${e.name}`);
    assert.equal(e.name.startsWith('vigor_api/'), false, `Unexpected root folder wrapper in ${e.name}`);
    assert.equal(e.name.endsWith('/'), false, `Unexpected directory entry ${e.name}`);
    assert.equal(e.name.includes('node_modules/.bin/'), false, `Unexpected .bin shim ${e.name}`);
    assert.equal(e.name.endsWith('.js.map'), false, `Unexpected source map ${e.name}`);
    assert.equal(
      ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(path.posix.basename(e.name)),
      false,
      `Unexpected OS junk file ${e.name}`,
    );
    assert.equal(e.verMade, 20);
    assert.equal(e.verNeed, 20);
    assert.equal(e.flags, 0);
    assert.equal(e.method, 8);
    assert.equal(e.mtime, FIXED_DOS_MTIME);
    assert.equal(e.mdate, FIXED_DOS_MDATE);
    assert.equal(e.extAttr, 0x20);
    assert.equal(e.extraLen, 0);
    assert.equal(e.commentLen, 0);
  }
});

test('Phase 5.3 [PASS-LOCAL] Reproducible ZIP root package.json, catalyst-config.json, zero secrets, and zero devDependencies', () => {
  const pkgJson = JSON.parse(readZipFileUtf8(VARS_RECONCILED_ZIP_PATH, 'package.json')) as {
    name: string;
    type: string;
    main: string;
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.equal(pkgJson.name, 'vigor_api');
  assert.equal(pkgJson.type, 'module');
  assert.equal(pkgJson.main, 'dist/server/catalystEntry.js');
  assert.equal(pkgJson.engines?.node, '>=22');
  assert.equal(pkgJson.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkgJson.dependencies ?? {}).sort(), [...RUNTIME_PACKAGES].sort());

  const cfg = JSON.parse(readZipFileUtf8(VARS_RECONCILED_ZIP_PATH, 'catalyst-config.json')) as {
    deployment?: { name?: string; type?: string; stack?: string };
    execution?: { main?: string };
  };
  assert.equal(cfg.deployment?.name, 'vigor_api');
  assert.equal(cfg.deployment?.type, 'advancedio');
  assert.equal(cfg.deployment?.stack, 'node22');
  assert.equal(cfg.execution?.main, 'dist/server/catalystEntry.js');

  const manifest = extractCanonicalContentManifest(VARS_RECONCILED_ZIP_PATH);
  const paths = manifest.map(m => m.path);
  assert.equal(paths.some(p => p.startsWith('.env') || p.includes('/.env')), false);
  assert.equal(paths.some(p => p.startsWith('tests/') || p.startsWith('docs/') || p.startsWith('scripts/')), false);
  assert.equal(paths.some(p => p.includes('firebase')), false);
  assert.ok(paths.includes('dist/server/catalystEntry.js'));
});

test('Phase 5.3 [PASS-LOCAL] Linux unzip verification and Node 22 ESM entrypoint import succeed fail-closed (503)', async () => {
  execSync(`unzip -tq ${JSON.stringify(VARS_RECONCILED_ZIP_PATH)}`, { stdio: 'ignore' });
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-repro-unzip-'));
  try {
    execSync(`unzip -oq ${JSON.stringify(VARS_RECONCILED_ZIP_PATH)} -d ${JSON.stringify(extDir)}`, { stdio: 'ignore' });
    const entryPath = path.join(extDir, 'dist', 'server', 'catalystEntry.js');
    assert.equal(fs.existsSync(entryPath), true);

    const mod = (await import(pathToFileURL(entryPath).href)) as {
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
  } finally {
    fs.rmSync(extDir, { recursive: true, force: true });
  }
});

test('Phase 5.3 [PASS-STATIC] Deployment and reconciliation docs reflect final SHA-256 and reconciled verdict', () => {
  const doc37 = fs.readFileSync(path.join(POC_ROOT, 'docs', '37-phase-5.3-final-deployment-package.md'), 'utf8');
  const doc38 = fs.readFileSync(path.join(POC_ROOT, 'docs', '38-phase-5.3-final-artifact-reconciliation.md'), 'utf8');

  assert.ok(doc37.includes('vigor_api-vars-reconciled-portable.zip'));
  assert.ok(doc37.includes(EXPECTED_VARS_RECONCILED_SHA256));
  assert.ok(doc37.includes('PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED'));

  assert.ok(doc38.includes(EXPECTED_ENV_AUDIT_SHA256));
  assert.ok(doc38.includes('31b0f7b03b7aa48e07d28962ad6ea4cc52ab50e1b87696f7cf1e396effe4a9f7'));
  assert.ok(doc38.includes(EXPECTED_REPRODUCIBLE_SHA256));
  assert.ok(doc38.includes('PHASE_5_3_FINAL_ARTIFACT_RECONCILED_NOT_DEPLOYED'));
});
