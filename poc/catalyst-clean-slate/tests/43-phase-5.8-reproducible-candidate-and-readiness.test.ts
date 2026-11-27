/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.8 — Test Suite 43:
 * Reproducible Development Candidate Packaging, Immutable Historical Archive Verification,
 * 53-Route Contract Parity, Fail-Closed Security Gates, Extracted Node 22 Runtime Execution,
 * and Phase 5.8 Readiness Documentation Checks.
 *
 * Scope Classification: LOCAL_VERIFIED (Loopback `127.0.0.1:0` only).
 * Zero remote Catalyst operations. Zero Production changes.
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
  compareCodePoint,
  computeServerSourceStateFingerprint,
  extractCanonicalContentManifest,
  FIXED_DOS_MDATE,
  FIXED_DOS_MTIME,
  parseZipEntries,
  PHASE_5_8_CANDIDATE_MANIFEST_NAME,
  PHASE_5_8_CANDIDATE_RELEASE_NAME,
  PHASE_5_8_CANDIDATE_ZIP_NAME,
  PHASE_5_9_CANDIDATE_MANIFEST_NAME,
  PHASE_5_9_CANDIDATE_RELEASE_NAME,
  PHASE_5_9_CANDIDATE_ZIP_NAME,
  PRESERVED_HISTORICAL_ZIPS,
  REQUIRED_DIST_DIRS,
  RUNTIME_PACKAGES,
} from '../scripts/build-vigor-api-portable-package.js';
import { verifyReconciliationCompleteness } from '../src/provisioning/schemaReconciliationAudit.js';
import {
  CANONICAL_ROUTE_COUNT,
  CLEAN_SLATE_ENDPOINT_CATALOG,
  matchCompiledRoute,
  ROUTE_CONTRACT_SPECS,
  ROUTE_DEFINITIONS,
} from '../src/routes/apiRouterSchema.js';
import { HostedNativeCatalystAuthRuntime } from '../src/sdk/catalystSdkBridge.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');

const CANDIDATE_ZIP_PATH = path.join(ARTIFACTS_DIR, PHASE_5_9_CANDIDATE_ZIP_NAME);
const CANDIDATE_MANIFEST_PATH = path.join(ARTIFACTS_DIR, PHASE_5_9_CANDIDATE_MANIFEST_NAME);
const CANDIDATE_RELEASE_PATH = path.join(ARTIFACTS_DIR, PHASE_5_9_CANDIDATE_RELEASE_NAME);

const EXPECTED_PHASE_5_8_SHA256 = '75db5ec6a516f6d5b349b80bf97ec443a798cf3b68cdc17a661d3e648e1d8354';
const EXPECTED_CANDIDATE_ENTRY_COUNT = 905;
const EXPECTED_CANDIDATE_SIZE_BYTES = 1_289_175;
const EXPECTED_CANDIDATE_UNCOMPRESSED_BYTES = 3_829_683;
const EXPECTED_CANDIDATE_SHA256 = '9379a10139614b334b5c757bb27a4670576cecd6dceef4707f477b89ca3191f7';

const HISTORICAL_ARCHIVE_BASELINE: ReadonlyArray<{
  filename: string;
  sizeBytes: number;
  sha256: string;
}> = [
  {
    filename: 'vigor_api.zip',
    sizeBytes: 1_275_008,
    sha256: 'd0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64',
  },
  {
    filename: 'vigor_api-portable.zip',
    sizeBytes: 1_274_771,
    sha256: 'd009bcc01cb1afa77012f47bfc5307d91a1b75101231982bce4e045eda52b8d8',
  },
  {
    filename: 'vigor_api-env-audit-portable.zip',
    sizeBytes: 1_277_498,
    sha256: 'a7565d2c2c121e0f585e2c65daf5204e1645819737869c0d6edb0e35af3af7a0',
  },
  {
    filename: 'vigor_api-reproducible-portable.zip',
    sizeBytes: 1_277_498,
    sha256: '31e9b71ea7af48a8483c903e206c625bbe823048bdab6db47567d8ce4cdd52fb',
  },
  {
    filename: 'vigor_api-vars-reconciled-portable.zip',
    sizeBytes: 1_277_920,
    sha256: 'cf66836ded6a82297404d0161694d5fa3b1c71a182fb825dfe2376022611c3fc',
  },
  {
    filename: 'vigor_api-auth-reconciled-portable.zip',
    sizeBytes: 1_279_670,
    sha256: 'd268c7bfa12ed4ec8d4765e38516e416957120ccc9d47a8c32a6f6ccffc20319',
  },
  {
    filename: 'vigor_api-auth-forensic-diagnostic-portable.zip',
    sizeBytes: 1_280_918,
    sha256: 'c9ade1264bc340560d1b503544162df50d78cf41949ecb37642a416caf8b2839',
  },
  {
    filename: 'vigor_api-hosted-admin-remediated-portable.zip',
    sizeBytes: 1_281_449,
    sha256: '6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f',
  },
  {
    filename: 'vigor_api-phase-5.8-development-candidate.zip',
    sizeBytes: 1_288_500,
    sha256: '75db5ec6a516f6d5b349b80bf97ec443a798cf3b68cdc17a661d3e648e1d8354',
  },
];

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walkRelativeFiles(dir: string, root: string = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkRelativeFiles(full, root));
    } else if (entry.isFile()) {
      out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

test('Phase 5.8/5.9 [LOCAL_VERIFIED / PASS-STATIC] All 9 historical archives remain byte-for-byte untouched and overwrite guard fails closed', () => {
  assert.equal(PRESERVED_HISTORICAL_ZIPS.size, 9);
  for (const item of HISTORICAL_ARCHIVE_BASELINE) {
    const p = path.join(ARTIFACTS_DIR, item.filename);
    assert.equal(fs.existsSync(p), true, `Missing preserved historical archive ${item.filename}`);
    assert.equal(fs.statSync(p).size, item.sizeBytes, `Byte size drift in ${item.filename}`);
    assert.equal(sha256File(p), item.sha256, `SHA-256 drift in ${item.filename}`);
    assert.throws(
      () =>
        buildReproduciblePortablePackage({
          outputZipPath: p,
          skipCompile: true,
          quiet: true,
        }),
      /PRESERVED_HISTORICAL_ARCHIVE_IMMUTABLE/
    );
  }
});

test('Phase 5.8 [LOCAL_VERIFIED / PASS-LOCAL] Double clean-room build reproduces Phase 5.8 candidate ZIP SHA-256 bit-for-bit', () => {
  assert.equal(fs.existsSync(CANDIDATE_ZIP_PATH), true, 'Missing Phase 5.8 candidate archive');
  assert.equal(fs.existsSync(CANDIDATE_MANIFEST_PATH), true, 'Missing Phase 5.8 candidate manifest');
  assert.equal(fs.existsSync(CANDIDATE_RELEASE_PATH), true, 'Missing Phase 5.8 candidate release metadata');

  assert.equal(fs.statSync(CANDIDATE_ZIP_PATH).size, EXPECTED_CANDIDATE_SIZE_BYTES);
  assert.equal(sha256File(CANDIDATE_ZIP_PATH), EXPECTED_CANDIDATE_SHA256);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-p58-repro-'));
  try {
    const build1 = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'p58-a.zip'),
      skipCompile: true,
      quiet: true,
    });
    const build2 = buildReproduciblePortablePackage({
      outputZipPath: path.join(tmpDir, 'p58-b.zip'),
      skipCompile: true,
      quiet: true,
    });

    assert.equal(build1.entryCount, EXPECTED_CANDIDATE_ENTRY_COUNT);
    assert.equal(build1.totalUncompressedBytes, EXPECTED_CANDIDATE_UNCOMPRESSED_BYTES);
    assert.equal(build1.zipSizeBytes, EXPECTED_CANDIDATE_SIZE_BYTES);
    assert.equal(build1.sha256, EXPECTED_CANDIDATE_SHA256);

    assert.equal(build2.entryCount, build1.entryCount);
    assert.equal(build2.totalUncompressedBytes, build1.totalUncompressedBytes);
    assert.equal(build2.zipSizeBytes, build1.zipSizeBytes);
    assert.equal(build2.sha256, build1.sha256);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 5.8 [LOCAL_VERIFIED / PASS-STATIC] Manifest, release metadata, structural hygiene, and 16 compiled dist/*.js files match 100%', () => {
  execSync(`unzip -tq ${JSON.stringify(CANDIDATE_ZIP_PATH)}`, { stdio: 'ignore' });

  const entries = parseZipEntries(CANDIDATE_ZIP_PATH);
  assert.equal(entries.length, EXPECTED_CANDIDATE_ENTRY_COUNT);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0) {
      assert.ok(compareCodePoint(entries[i - 1].name, e.name) < 0, `Out-of-order entry ${e.name}`);
    }
    assert.equal(e.name.startsWith('/'), false);
    assert.equal(e.name.includes('\\'), false);
    assert.equal(e.name.split('/').includes('..'), false);
    assert.equal(e.name.endsWith('/'), false);
    assert.equal(/\.(sh|bat|cmd|ps1|exe|dll|so|dylib|node)$/i.test(e.name), false, `Unexpected executable ${e.name}`);
    assert.equal(e.name.includes('node_modules/.bin/'), false);
    assert.equal(e.name.endsWith('.js.map'), false);
    assert.equal(e.name.startsWith('.env') || e.name.includes('/.env'), false);
    assert.equal(
      e.name.startsWith('tests/') ||
        e.name.startsWith('docs/') ||
        e.name.startsWith('scripts/') ||
        e.name.startsWith('src/frontend/') ||
        e.name.startsWith('src/provisioning/') ||
        e.name.startsWith('dist-frontend/'),
      false,
      `Forbidden dev/frontend path in ZIP: ${e.name}`
    );
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

  const canonical = extractCanonicalContentManifest(CANDIDATE_ZIP_PATH);
  const diskManifest = JSON.parse(fs.readFileSync(CANDIDATE_MANIFEST_PATH, 'utf8'));
  assert.deepEqual(canonical, diskManifest);

  const releaseMeta = JSON.parse(fs.readFileSync(CANDIDATE_RELEASE_PATH, 'utf8')) as {
    candidateName: string;
    phase: string;
    targetEnvironment: string;
    readinessStatus: string;
    sourceStateIdentifier: { sha256: string; fileCount: number };
    nodeRuntime: { targetCatalystStack: string; enginesNode: string };
    entryPoint: string;
    entryPointSha256: string;
    requiredDependencies: Record<string, string>;
    packageStats: { entryCount: number; zipSizeBytes: number; totalUncompressedBytes: number; zipSha256: string };
    compiledEntrySha256s: Array<{ path: string; uncompressedSize: number; sha256: string }>;
  };

  assert.equal(releaseMeta.candidateName, PHASE_5_9_CANDIDATE_ZIP_NAME);
  assert.equal(releaseMeta.phase, '5.9');
  assert.equal(releaseMeta.targetEnvironment, 'Development');
  assert.equal(releaseMeta.readinessStatus, 'READY_FOR_DEVELOPMENT_OPERATOR_REVIEW');
  assert.equal(releaseMeta.entryPoint, 'dist/server/catalystEntry.js');
  assert.equal(releaseMeta.nodeRuntime.targetCatalystStack, 'node22');
  assert.equal(releaseMeta.nodeRuntime.enginesNode, '>=22');
  assert.deepEqual(Object.keys(releaseMeta.requiredDependencies).sort(), [...RUNTIME_PACKAGES].sort());
  assert.equal(releaseMeta.packageStats.entryCount, EXPECTED_CANDIDATE_ENTRY_COUNT);
  assert.equal(releaseMeta.packageStats.zipSizeBytes, EXPECTED_CANDIDATE_SIZE_BYTES);
  assert.equal(releaseMeta.packageStats.totalUncompressedBytes, EXPECTED_CANDIDATE_UNCOMPRESSED_BYTES);
  assert.equal(releaseMeta.packageStats.zipSha256, EXPECTED_CANDIDATE_SHA256);

  const liveFingerprint = computeServerSourceStateFingerprint(POC_ROOT);
  assert.equal(releaseMeta.sourceStateIdentifier.fileCount, 18);
  assert.equal(releaseMeta.sourceStateIdentifier.sha256, liveFingerprint.sha256);

  const distManifestItems = canonical.filter(m => m.path.startsWith('dist/'));
  assert.equal(distManifestItems.length, 16);
  assert.equal(releaseMeta.compiledEntrySha256s.length, 16);
  assert.deepEqual(releaseMeta.compiledEntrySha256s, distManifestItems.map(m => ({
    path: m.path,
    uncompressedSize: m.uncompressedSize,
    sha256: m.sha256,
  })));

  for (const item of distManifestItems) {
    const localJs = fs.readFileSync(path.join(POC_ROOT, item.path), 'utf8').replace(/\r\n/g, '\n');
    const localSha = crypto.createHash('sha256').update(localJs, 'utf8').digest('hex');
    assert.equal(item.sha256, localSha, `Compiled dist mismatch in ${item.path}`);
  }
});

test('Phase 5.8 [LOCAL_VERIFIED / PASS-LOOPBACK] Extracted Phase 5.8 candidate ZIP executes fail-closed 503, Development hosted_native 53-route health, and auth checks on Node 22', async () => {
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-p58-exec-'));
  const prevEnv = { ...process.env };
  let srv: http.Server | undefined;

  try {
    execSync(`unzip -oq ${JSON.stringify(CANDIDATE_ZIP_PATH)} -d ${JSON.stringify(extDir)}`, { stdio: 'ignore' });
    const entryPath = path.join(extDir, 'dist', 'server', 'catalystEntry.js');
    assert.equal(fs.existsSync(entryPath), true);

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

    // 1. Cold boot without env -> 503 without leaking secrets
    const r503 = await fetch(`${base}/health`);
    assert.equal(r503.status, 503);
    const body503 = await r503.text();
    assert.equal((JSON.parse(body503) as { error?: string }).error, 'SERVER_CONFIGURATION_UNAVAILABLE');
    assert.equal(body503.includes('VIGOR_SESSION_HMAC_SECRET'), false);

    // 2. Development hosted_native env -> /health & /api/v1/health 200 with routeCount: 53
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
    const health1 = (await rHealth.json()) as { status?: string; routeCount?: number };
    assert.equal(health1.status, 'ok');
    assert.equal(health1.routeCount, 53);

    const rApiHealth = await fetch(`${base}/api/v1/health`);
    assert.equal(rApiHealth.status, 200);
    const health2 = (await rApiHealth.json()) as { status?: string; routeCount?: number };
    assert.equal(health2.status, 'ok');
    assert.equal(health2.routeCount, 53);

    // 3. Bare HTTP without Catalyst Edge platform headers -> fail-closed 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE
    const rMissingEdge = await fetch(`${base}/api/v1/athlete/workspace`);
    assert.equal(rMissingEdge.status, 503);
    assert.equal(((await rMissingEdge.json()) as { error?: string }).error, 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE');

    // 4. Anonymous Catalyst Edge platform request (no user session, no admin user-type) -> 401 UNAUTHENTICATED
    const edgeBaseCtx: Record<string, string> = {
      'x-zc-projectid': '136967000000014024',
      'x-zc-environment': 'Development',
      'x-zc-project-key': 'proj_key_p58_test',
      'x-zc-admin-cred-type': 'token',
      'x-zc-admin-cred-token': 'adm_tok_p58_test',
    };
    const rAnon = await fetch(`${base}/api/v1/athlete/workspace`, { headers: edgeBaseCtx });
    assert.equal(rAnon.status, 401);
    assert.equal(((await rAnon.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    // 5. Platform admin context + opaque platform token -> 401 UNAUTHENTICATED
    const edgeAdminCtx: Record<string, string> = {
      ...edgeBaseCtx,
      'x-zc-user-type': 'admin',
    };
    const rAdminOpaque = await fetch(`${base}/api/v1/athlete/workspace`, {
      headers: {
        ...edgeAdminCtx,
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'opaque_platform_tok_p58',
      },
    });
    assert.equal(rAdminOpaque.status, 401);
    assert.equal(((await rAdminOpaque.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    // 6. hosted_native x-zc-user-type=admin + cookie also resolves 401 UNAUTHENTICATED (no spoof false positive)
    const rAdminCookie = await fetch(`${base}/api/v1/athlete/workspace`, {
      headers: {
        ...edgeAdminCtx,
        'x-zc-cookie': 'JWT_AUTH=contradictory_user_cookie',
      },
    });
    assert.equal(rAdminCookie.status, 401);
    assert.equal(((await rAdminCookie.json()) as { error?: string }).error, 'UNAUTHENTICATED');

    // 7. Mismatched x-zc-projectid fails closed 403 PROJECT_CONTEXT_MISMATCH
    const rProjMismatch = await fetch(`${base}/api/v1/athlete/workspace`, {
      headers: {
        ...edgeBaseCtx,
        'x-zc-projectid': '999999999999999999',
      },
    });
    assert.equal(rProjMismatch.status, 403);
    assert.equal(((await rProjMismatch.json()) as { error?: string }).error, 'PROJECT_CONTEXT_MISMATCH');
  } finally {
    if (srv) await new Promise<void>(resolve => srv!.close(() => resolve()));
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(extDir, { recursive: true, force: true });
  }
});

test('Phase 5.8 [LOCAL_VERIFIED / PASS-UNIT] Exact 53-route contract parity, static-first order, zero 501 stubs, and fail-closed security release gates', async () => {
  assert.equal(CANONICAL_ROUTE_COUNT, 53);
  assert.equal(ROUTE_CONTRACT_SPECS.length, 53);
  assert.equal(ROUTE_DEFINITIONS.length, 53);
  assert.equal(CLEAN_SLATE_ENDPOINT_CATALOG.length, 53);

  const uniqueIds = new Set(ROUTE_CONTRACT_SPECS.map(r => r.id));
  assert.equal(uniqueIds.size, 53);

  const recon = verifyReconciliationCompleteness();
  assert.equal(recon.routeCount, 53);
  assert.equal(recon.mappedCount, 53);
  assert.deepEqual(recon.missingRouteIds, []);
  assert.deepEqual(recon.extraRouteIds, []);
  assert.equal(recon.gsiCount, 8);
  assert.deepEqual(recon.missingGsis, []);

  // Verify COMPILED_ROUTE_TABLE matches static routes ahead of parameterized routes sharing prefix
  assert.equal(
    matchCompiledRoute('DELETE', '/api/v1/athlete/groceries/completed')?.def.id,
    'athlete.groceries.clearCompleted'
  );
  assert.equal(
    matchCompiledRoute('DELETE', '/api/v1/athlete/groceries/item_123')?.def.id,
    'athlete.groceries.delete'
  );
  assert.equal(
    matchCompiledRoute('POST', '/api/v1/athlete/notifications/read-all')?.def.id,
    'athlete.notifications.markAllRead'
  );
  assert.equal(
    matchCompiledRoute('POST', '/api/v1/athlete/workouts/start')?.def.id,
    'athlete.workouts.start'
  );

  // Zero 501 / NOT_IMPLEMENTED stubs across server, routes, and services
  for (const sub of REQUIRED_DIST_DIRS) {
    const dir = path.join(POC_ROOT, 'src', sub);
    if (!fs.existsSync(dir)) continue;
    for (const rel of walkRelativeFiles(dir).filter(f => f.endsWith('.ts'))) {
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      assert.equal(text.includes('NOT_IMPLEMENTED'), false, `Found NOT_IMPLEMENTED in src/${sub}/${rel}`);
      assert.equal(/\bstatus\(\s*501\s*\)/.test(text), false, `Found 501 status in src/${sub}/${rel}`);
    }
  }

  // Fail-closed security defaults: allowSuperadminMutations === false & sendPasswordReset enforces INT-08
  const adminSvc = new AdminGovernanceService(
    new CleanSlateInMemoryNoSQLAdapter(),
    {
      sendPasswordReset: async () => ({ dispatched: true, mode: 'sdk' }),
      listUsers: async () => [],
      getUserDetails: async () => null,
      updateUserStatus: async () => {},
    } as never
  );
  assert.equal((adminSvc as unknown as { allowSuperadminMutations: boolean }).allowSuperadminMutations, false);

  const hostedRuntime = HostedNativeCatalystAuthRuntime.fromEnvironment({
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
  });
  await assert.rejects(
    () => hostedRuntime.sendPasswordReset('athlete58@vigorcore.lat'),
    /INT_08_LIVE_VERIFICATION_PENDING/
  );
});

test('Phase 5.8 [LOCAL_VERIFIED / PASS-STATIC] docs/50 and docs/51 capture required Phase 5.8 packaging, audit, and Development runbook details', () => {
  const doc50 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '50-phase-5.8-packaging-and-test-reconciliation.md'),
    'utf8'
  );
  const doc51 = fs.readFileSync(
    path.join(POC_ROOT, 'docs', '51-phase-5.8-development-live-verification-runbook.md'),
    'utf8'
  );

  for (const token of [
    PHASE_5_8_CANDIDATE_ZIP_NAME,
    EXPECTED_PHASE_5_8_SHA256,
    'READY_FOR_DEVELOPMENT_OPERATOR_REVIEW',
    'PHASE_5_8_REPRODUCIBLE_CANDIDATE_AND_DEVELOPMENT_RELEASE_READINESS_COMPLETE',
    'PRESERVED_HISTORICAL_ARCHIVE_IMMUTABLE',
    '53',
  ]) {
    assert.ok(doc50.includes(token), `docs/50 missing required token: ${token}`);
  }

  for (const token of [
    PHASE_5_8_CANDIDATE_ZIP_NAME,
    EXPECTED_PHASE_5_8_SHA256,
    '6b64d440aafbfc7c6e19ea4f5a8617b84056fc7f2494307e6685e04b76de618f',
    '136967000000014024',
    '136967000000074001',
    'INT-08',
  ]) {
    assert.ok(doc51.includes(token), `docs/51 missing required token: ${token}`);
  }
});
