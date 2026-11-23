/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 37:
 * Deployment Candidate Verification, Double-Build SHA-256 Reproducibility,
 * Structural/Security Hygiene, Source-to-Package Traceability, and
 * Extracted Runtime Auth Behavior Probe (`NODE 22` ESM).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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

const CANDIDATE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-reconciled-portable.zip');
const CANDIDATE_MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-auth-reconciled-portable.manifest.json');
const PRIOR_VARS_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-vars-reconciled-portable.zip');

const EXPECTED_CANDIDATE_SIZE_BYTES = 1_279_670;
const EXPECTED_CANDIDATE_UNCOMPRESSED_BYTES = 3_761_484;
const EXPECTED_CANDIDATE_ENTRY_COUNT = 905;
const EXPECTED_CANDIDATE_SHA256 = 'd268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readZipEntryBuffer(zipPath: string, entryName: string): Buffer {
  const buf = fs.readFileSync(zipPath);
  const entry = parseZipEntries(zipPath).find(e => e.name === entryName);
  assert.ok(entry, `Missing ZIP entry: ${entryName}`);
  const lfhNLen = buf.readUInt16LE(entry.lfhOffset + 26);
  const lfhELen = buf.readUInt16LE(entry.lfhOffset + 28);
  const start = entry.lfhOffset + 30 + lfhNLen + lfhELen;
  const comp = buf.subarray(start, start + entry.compSize);
  return entry.method === 0 ? comp : zlib.inflateRawSync(comp);
}

test('Phase 5.3 [PASS-LOCAL] Deployment candidate ZIP matches exact size, SHA-256, and double-build reproducibility', () => {
  assert.equal(fs.existsSync(CANDIDATE_ZIP_PATH), true, 'Missing deployment candidate ZIP');
  assert.equal(fs.existsSync(CANDIDATE_MANIFEST_PATH), true, 'Missing deployment candidate manifest JSON');

  const stat = fs.statSync(CANDIDATE_ZIP_PATH);
  assert.equal(stat.size, EXPECTED_CANDIDATE_SIZE_BYTES);
  assert.equal(sha256File(CANDIDATE_ZIP_PATH), EXPECTED_CANDIDATE_SHA256);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-cand-repro-'));
  try {
    const buildA = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'cand-a.zip'),
      skipCompile: true,
      quiet: true,
    });
    const buildB = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'cand-b.zip'),
      skipCompile: true,
      quiet: true,
    });

    assert.equal(buildA.entryCount, EXPECTED_CANDIDATE_ENTRY_COUNT);
    assert.ok(buildA.zipSizeBytes > 0);
    assert.equal(buildB.entryCount, buildA.entryCount);
    assert.equal(buildB.totalUncompressedBytes, buildA.totalUncompressedBytes);
    assert.equal(buildB.zipSizeBytes, buildA.zipSizeBytes);
    assert.equal(buildB.sha256, buildA.sha256);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 5.3 [PASS-LOCAL] ZIP passes CRC/unzip -tq, hygiene checks, and exact 2-file traceability delta vs prior package', () => {
  execSync(`unzip -tq ${JSON.stringify(CANDIDATE_ZIP_PATH)}`, { stdio: 'ignore' });

  const entries = parseZipEntries(CANDIDATE_ZIP_PATH);
  assert.equal(entries.length, EXPECTED_CANDIDATE_ENTRY_COUNT);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0) {
      assert.ok(compareCodePoint(entries[i - 1].name, e.name) < 0);
    }
    assert.equal(e.name.startsWith('/'), false);
    assert.equal(e.name.includes('\\'), false);
    assert.equal(e.name.split('/').includes('..'), false);
    assert.equal(e.name.endsWith('/'), false);
    assert.equal(/\.(sh|bat|cmd|ps1|exe|dll|so|dylib|node)$/i.test(e.name), false, `Unexpected executable file ${e.name}`);
    assert.equal(e.name.includes('node_modules/.bin/'), false);
    assert.equal(e.name.includes('.cache'), false);
    assert.equal(e.name.startsWith('.env') || e.name.includes('/.env'), false);
    assert.equal(
      e.name.startsWith('tests/') || e.name.startsWith('docs/') || e.name.startsWith('scripts/'),
      false,
    );
    assert.equal(e.name.endsWith('.js.map'), false);
    assert.equal(e.name.toLowerCase().includes('firebase'), false);
    assert.equal(e.name.startsWith('node_modules/typescript/'), false);
    assert.equal(e.name.startsWith('node_modules/tsx/'), false);
    assert.equal(e.name.startsWith('node_modules/playwright-core/'), false);
    assert.equal(e.name.startsWith('node_modules/@types/'), false);
    assert.equal(e.verMade, 20);
    assert.equal(e.verNeed, 20);
    assert.equal(e.flags, 0);
    assert.equal(e.method, 8);
    assert.equal(e.mtime, FIXED_DOS_MTIME);
    assert.equal(e.mdate, FIXED_DOS_MDATE);
    assert.equal(e.extAttr, 0x20);
  }

  const pkg = JSON.parse(readZipEntryBuffer(CANDIDATE_ZIP_PATH, 'package.json').toString('utf8')) as {
    name: string;
    type: string;
    main: string;
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.name, 'vigor_api');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'dist/server/catalystEntry.js');
  assert.equal(pkg.engines?.node, '>=22');
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), [...RUNTIME_PACKAGES].sort());

  const candManifest = extractCanonicalContentManifest(CANDIDATE_ZIP_PATH);
  const diskManifest = JSON.parse(fs.readFileSync(CANDIDATE_MANIFEST_PATH, 'utf8'));
  assert.deepEqual(candManifest, diskManifest);

  const priorManifest = extractCanonicalContentManifest(PRIOR_VARS_ZIP_PATH);
  const diff = compareContentManifests(priorManifest, candManifest);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.unexpected, []);
  assert.deepEqual(
    diff.changed.map(c => c.path).sort(),
    ['dist/auth/cleanSlateAuthGuard.js', 'dist/sdk/catalystSdkBridge.js'],
  );

  // Source-to-package parity for compiled modules except the subsequent local-only 403 diagnostic additions
  const diagUpdatedDist = new Set([
    'dist/auth/cleanSlateAuthGuard.js',
    'dist/sdk/catalystSdkBridge.js',
    'dist/server/advancedIoApp.js',
  ]);
  for (const item of candManifest.filter(m => m.path.startsWith('dist/'))) {
    assert.equal(fs.existsSync(path.join(POC_ROOT, item.path)), true);
    if (!diagUpdatedDist.has(item.path)) {
      const localJs = fs.readFileSync(path.join(POC_ROOT, item.path), 'utf8').replace(/\r\n/g, '\n');
      const localSha = crypto.createHash('sha256').update(localJs, 'utf8').digest('hex');
      assert.equal(item.sha256, localSha, `Unexpected drift in non-diagnostic dist module ${item.path}`);
    }
  }
});

test('Phase 5.3 [PASS-LOOPBACK] Extracted deployment candidate runtime executes reconciled hosted_native auth behavior on Node 22 HTTP', async () => {
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-cand-exec-'));
  const prevEnv = { ...process.env };
  let srv: http.Server | undefined;

  try {
    execSync(`unzip -oq ${JSON.stringify(CANDIDATE_ZIP_PATH)} -d ${JSON.stringify(extDir)}`, { stdio: 'ignore' });
    const entryPath = path.join(extDir, 'dist', 'server', 'catalystEntry.js');
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      default: http.RequestListener;
      resetAdvancedIoRuntimeForTests: () => void;
    };

    for (const key of [
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
    ]) {
      delete process.env[key];
    }
    mod.resetAdvancedIoRuntimeForTests();

    srv = http.createServer(mod.default);
    await new Promise<void>(resolve => srv!.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const r503 = await fetch(`${base}/health`);
    assert.equal(r503.status, 503);
    assert.equal(((await r503.json()) as { error?: string }).error, 'SERVER_CONFIGURATION_UNAVAILABLE');

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

    const rHealth = await fetch(`${base}/health`);
    assert.equal(rHealth.status, 200);
    const healthBody = (await rHealth.json()) as { status?: string; routeCount?: number };
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.routeCount, 41);

    const edgeAdminCtx: Record<string, string> = {
      'x-zc-projectid': '136967000000014024',
      'x-zc-environment': 'Development',
      'x-zc-project-key': 'proj_key_test',
      'x-zc-admin-cred-type': 'token',
      'x-zc-admin-cred-token': 'adm_tok_test',
      'x-zc-user-type': 'admin',
    };

    // Anonymous platform admin context MUST resolve 401 UNAUTHENTICATED (not 403 CATALYST_ADMIN_HEADER_SPOOFED)
    const rAnon = await fetch(`${base}/api/v1/athlete/workspace`, { headers: edgeAdminCtx });
    assert.equal(rAnon.status, 401);
    assert.equal(((await rAnon.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    // Contradictory genuine user cred + x-zc-user-type=admin MUST fail closed 403 CATALYST_ADMIN_HEADER_SPOOFED
    const rSpoof = await fetch(`${base}/api/v1/athlete/workspace`, {
      headers: {
        ...edgeAdminCtx,
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'user_tok_test',
      },
    });
    assert.equal(rSpoof.status, 403);
    assert.equal(((await rSpoof.json()) as { error?: string }).error, 'CATALYST_ADMIN_HEADER_SPOOFED');

    // Non-Catalyst Zoho console cookies + stratus_jwt must NOT trigger user-scope check or spoof
    const rConsole = await fetch(`${base}/api/v1/athlete/workspace`, {
      headers: {
        ...edgeAdminCtx,
        'x-zc-cookie': '_zcsr_tmp=xyz; zalb_abc=123; stratus_jwt=nope',
      },
    });
    assert.equal(rConsole.status, 401);
    assert.equal(((await rConsole.json()) as { error?: string }).error, 'UNAUTHENTICATED');
  } finally {
    if (srv) await new Promise<void>(resolve => srv!.close(() => resolve()));
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(extDir, { recursive: true, force: true });
  }
});

test('Phase 5.3 [PASS-STATIC] docs/44 captures deployment candidate metrics, traceability, and exact final verdict', () => {
  const doc44 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '44-phase-5.3-deployment-candidate-preparation.md'),
    'utf8',
  );
  assert.ok(doc44.includes('vigor_api-auth-reconciled-portable.zip'));
  assert.ok(doc44.includes('vigor_api-auth-reconciled-portable.manifest.json'));
  assert.ok(doc44.includes(EXPECTED_CANDIDATE_SHA256));
  assert.ok(doc44.includes('1,279,670'));
  assert.ok(doc44.includes('dist/auth/cleanSlateAuthGuard.js'));
  assert.ok(doc44.includes('dist/sdk/catalystSdkBridge.js'));
  assert.ok(doc44.includes('DEPLOYMENT_CANDIDATE_READY_PENDING_EXPLICIT_OPERATOR_AUTHORIZATION'));
});
