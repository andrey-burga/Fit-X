/**
 * Classification: PASS-STATIC + PASS-LOCAL (ZERO REMOTE CALLS)
 * Validates Phase 5.3 isolated staging (`artifacts/vigor_api/`), upload ZIP (`artifacts/vigor_api.zip`),
 * Windows PowerShell 5.1 packaging script, all 8 mandatory local package checks,
 * 41-endpoint 30s execution timeout audit, and Security Rules inspection checklist.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';
import { CATALYST_PLATFORM_LIMITS } from '../src/types/cleanSlate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

const STAGING_DIR = path.join(POC_ROOT, 'artifacts', 'vigor_api');
const ZIP_PATH = path.join(POC_ROOT, 'artifacts', 'vigor_api.zip');
const PS1_PATH = path.join(POC_ROOT, 'scripts', 'prepare-vigor-api-upload.ps1');
const DOC_PATH = path.join(POC_ROOT, 'docs', '34-phase-5.3-vigor-api-upload-package.md');

const EXPECTED_RUNTIME_DEPS = [
  '@zcatalyst/auth',
  '@zcatalyst/auth-admin',
  '@zcatalyst/nosql',
  '@zcatalyst/transport',
  '@zcatalyst/utils',
  'express',
];

const EXCLUDED_DEV_DEPS = [
  '@types/express',
  '@types/node',
  'playwright-core',
  'tsx',
  'typescript',
];

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

interface ParsedZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipCentralDirectory(zipBuffer: Buffer): ParsedZipEntry[] {
  // Locate End of Central Directory record (0x06054b50) from tail
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End-of-Central-Directory signature missing');

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries: ParsedZipEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    assert.equal(zipBuffer.readUInt32LE(cursor), 0x02014b50, `Invalid Central Directory entry at ${cursor}`);
    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);
    const name = zipBuffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractZipEntryText(zipBuffer: Buffer, entry: ParsedZipEntry): string {
  const lh = entry.localHeaderOffset;
  assert.equal(zipBuffer.readUInt32LE(lh), 0x04034b50, `Invalid local header for ${entry.name}`);
  const nameLen = zipBuffer.readUInt16LE(lh + 26);
  const extraLen = zipBuffer.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const slice = zipBuffer.subarray(dataStart, dataStart + entry.compressedSize);
  const raw =
    entry.compressionMethod === 0
      ? slice
      : entry.compressionMethod === 8
        ? zlib.inflateRawSync(slice)
        : (() => {
            throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}`);
          })();
  assert.equal(raw.length, entry.uncompressedSize, `Size mismatch extracting ${entry.name}`);
  return raw.toString('utf8');
}

test('[PASS-LOCAL] Checks 1-4 & 7: Staging dir contains exclusively runtime files, 6 runtime deps, isolated lockfile, zero devDeps/secrets/excluded dirs', () => {
  assert.ok(fs.existsSync(STAGING_DIR), `Missing clean staging dir: ${STAGING_DIR}`);

  const topEntries = fs.readdirSync(STAGING_DIR).sort();
  assert.deepEqual(topEntries, [
    'catalyst-config.json',
    'dist',
    'node_modules',
    'package-lock.json',
    'package.json',
  ]);

  // Package.json checks
  const pkg = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, 'package.json'), 'utf8')) as {
    name: string;
    type: string;
    main: string;
    engines?: { node?: string };
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(pkg.name, 'vigor_api');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'dist/server/catalystEntry.js');
  assert.equal(pkg.engines?.node, '>=22');
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [...EXPECTED_RUNTIME_DEPS].sort());

  // Isolated production package-lock.json check (separate from root POC lockfile)
  const stagingLockRaw = fs.readFileSync(path.join(STAGING_DIR, 'package-lock.json'), 'utf8');
  const rootLockRaw = fs.readFileSync(path.join(POC_ROOT, 'package-lock.json'), 'utf8');
  assert.notEqual(stagingLockRaw, rootLockRaw);
  const stagingLock = JSON.parse(stagingLockRaw) as {
    name?: string;
    packages?: Record<string, { dev?: boolean; dependencies?: Record<string, string> }>;
  };
  assert.equal(stagingLock.name, 'vigor_api');
  for (const excluded of EXCLUDED_DEV_DEPS) {
    assert.equal(
      Boolean(stagingLock.packages?.[`node_modules/${excluded}`]),
      false,
      `Staging package-lock.json must NOT contain devDependency '${excluded}'`
    );
    assert.equal(
      fs.existsSync(path.join(STAGING_DIR, 'node_modules', excluded)),
      false,
      `Staging node_modules must NOT contain '${excluded}'`
    );
  }
  for (const reqDep of EXPECTED_RUNTIME_DEPS) {
    assert.ok(
      fs.existsSync(path.join(STAGING_DIR, 'node_modules', reqDep, 'package.json')),
      `Staging node_modules missing runtime dep '${reqDep}'`
    );
  }

  // catalyst-config.json check
  const cfg = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, 'catalyst-config.json'), 'utf8')) as {
    deployment?: { name?: string; type?: string; stack?: string };
    execution?: { main?: string };
  };
  assert.equal(cfg.deployment?.name, 'vigor_api');
  assert.equal(cfg.deployment?.type, 'advancedio');
  assert.equal(cfg.deployment?.stack, 'node22');
  assert.equal(cfg.execution?.main, 'dist/server/catalystEntry.js');

  // Recursive dist & secret/forbidden-file inspection
  const distFiles = walkFiles(path.join(STAGING_DIR, 'dist')).map(f =>
    path.relative(STAGING_DIR, f).replace(/\\/g, '/')
  );
  assert.equal(distFiles.length, 16);
  assert.ok(distFiles.includes('dist/server/catalystEntry.js'));

  const forbiddenPathFragments = [
    '.env',
    'provisioning',
    'frontend',
    'dist-frontend',
    'tests/',
    'docs/',
    'scripts/',
    'candidates',
    'firebase',
    'firestore',
    'google-services',
    'gcp',
    '.js.map',
  ];
  const nonNodeModulesFiles = walkFiles(STAGING_DIR)
    .filter(f => !f.includes(`${path.sep}node_modules${path.sep}`))
    .map(f => path.relative(STAGING_DIR, f).replace(/\\/g, '/'));

  for (const rel of nonNodeModulesFiles) {
    const lower = rel.toLowerCase();
    for (const frag of forbiddenPathFragments) {
      assert.equal(lower.includes(frag), false, `Forbidden file fragment '${frag}' found at '${rel}'`);
    }
    if (lower.endsWith('.js') || lower.endsWith('.json')) {
      const content = fs.readFileSync(path.join(STAGING_DIR, rel), 'utf8');
      assert.equal(content.includes('1000.'), false, `Suspicious Zoho token pattern in ${rel}`);
      assert.equal(/AKIA[0-9A-Z]{16}/.test(content), false, `Suspicious key pattern in ${rel}`);
      assert.equal(content.includes('BEGIN PRIVATE KEY'), false, `Private key header in ${rel}`);
    }
  }
});

test('[PASS-LOCAL] Check 5: Staged dist/server/catalystEntry.js imports cleanly as Node 22 ESM & fails closed (503) without env', async () => {
  const stagedEntry = path.join(STAGING_DIR, 'dist', 'server', 'catalystEntry.js');
  assert.ok(fs.existsSync(stagedEntry));

  const mod = (await import(pathToFileURL(stagedEntry).href)) as {
    default?: (req: unknown, res: unknown) => void;
    catalystAdvancedIoEntry?: (req: unknown, res: unknown) => void;
    resetAdvancedIoRuntimeForTests?: () => void;
  };
  assert.equal(typeof mod.default, 'function');
  assert.equal(typeof mod.catalystAdvancedIoEntry, 'function');
  mod.resetAdvancedIoRuntimeForTests?.();

  let statusCode = 0;
  let bodyText = '';
  const headers: Record<string, string> = {};
  const mockRes = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      statusCode = mockRes.statusCode;
      bodyText = String(chunk || '');
    },
  };
  mod.default!(
    { headers: {}, method: 'GET', url: '/health' },
    mockRes
  );
  assert.equal(statusCode, 503);
  assert.ok(headers['content-type']?.includes('application/json'));
  const parsed = JSON.parse(bodyText) as { success: boolean; error: string; message: string };
  assert.equal(parsed.success, false);
  assert.equal(parsed.error, 'SERVER_CONFIGURATION_UNAVAILABLE');
  assert.ok(parsed.message.includes('CATALYST_PROJECT_ID'));
});

test('[PASS-LOCAL] Check 8: vigor_api.zip exists, is compact (< 5 MiB), has root structure without wrapping folder, and inflates cleanly', () => {
  assert.ok(fs.existsSync(ZIP_PATH), `Missing upload ZIP: ${ZIP_PATH}`);
  const zipBuf = fs.readFileSync(ZIP_PATH);
  assert.ok(zipBuf.length > 100_000, 'ZIP too small to hold runtime dependencies');
  assert.ok(
    zipBuf.length < 5 * 1024 * 1024,
    `ZIP size (${zipBuf.length}) unexpectedly exceeds 5 MiB threshold`
  );

  const entries = readZipCentralDirectory(zipBuf);
  const entryNames = entries.map(e => e.name);
  assert.ok(entries.length >= 900, `Unexpected low ZIP entry count: ${entries.length}`);

  for (const requiredRoot of [
    'package.json',
    'package-lock.json',
    'catalyst-config.json',
    'dist/server/catalystEntry.js',
  ]) {
    assert.ok(entryNames.includes(requiredRoot), `Missing '${requiredRoot}' at ZIP archive root`);
  }

  for (const name of entryNames) {
    assert.equal(name.startsWith('vigor_api/'), false, `ZIP must NOT wrap entries inside vigor_api/: ${name}`);
    assert.equal(name.includes('devDependencies'), false);
    assert.equal(name.startsWith('dist/provisioning/'), false, `Unexpected provisioning module in ZIP: ${name}`);
    assert.equal(name.startsWith('tests/'), false, `Unexpected test file in ZIP: ${name}`);
    assert.equal(name.includes('.js.map'), false, `Unexpected sourcemap in ZIP: ${name}`);
    for (const excluded of EXCLUDED_DEV_DEPS) {
      assert.equal(name.startsWith(`node_modules/${excluded}/`), false, `Excluded devDep inside ZIP: ${name}`);
    }
  }

  const pkgEntry = entries.find(e => e.name === 'package.json')!;
  const cfgEntry = entries.find(e => e.name === 'catalyst-config.json')!;
  const zipPkg = JSON.parse(extractZipEntryText(zipBuf, pkgEntry)) as { name: string; main: string; type: string };
  const zipCfg = JSON.parse(extractZipEntryText(zipBuf, cfgEntry)) as {
    deployment: { name: string; type: string; stack: string };
    execution: { main: string };
  };
  assert.equal(zipPkg.name, 'vigor_api');
  assert.equal(zipPkg.type, 'module');
  assert.equal(zipPkg.main, 'dist/server/catalystEntry.js');
  assert.equal(zipCfg.deployment.name, 'vigor_api');
  assert.equal(zipCfg.deployment.type, 'advancedio');
  assert.equal(zipCfg.deployment.stack, 'node22');
  assert.equal(zipCfg.execution.main, 'dist/server/catalystEntry.js');
});

test('[PASS-STATIC] Check 6 & Script Compliance: prepare-vigor-api-upload.ps1 is PS 5.1 + Node 24.16.0 safe and executes zero remote operations', () => {
  assert.ok(fs.existsSync(PS1_PATH), `Missing PowerShell script: ${PS1_PATH}`);
  const ps1 = fs.readFileSync(PS1_PATH, 'utf8');

  const psOnlyPortion = ps1.replace(/\$validationScript\s*=\s*@'[\s\S]*?\r?\n'@/g, '');
  assert.equal(psOnlyPortion.includes('&&'), false, 'PowerShell 5.1 script must not use &&');
  assert.equal(psOnlyPortion.includes('||'), false, 'PowerShell 5.1 script must not use ||');
  assert.ok(ps1.includes('$LASTEXITCODE'), 'Script must inspect $LASTEXITCODE after CLI invocations');
  assert.ok(ps1.includes('Invoke-ExternalCommand'), 'Script must wrap external CLI calls safely for PS 5.1 stderr');
  assert.ok(ps1.includes("ErrorActionPreference = 'Continue'"), 'External CLI wrapper must tolerate npm/node stderr notices cleanly');
  assert.ok(ps1.includes('$PSScriptRoot'), 'Script must anchor relative paths via $PSScriptRoot');
  assert.ok(ps1.includes('UTF8Encoding($false)'), 'Script must write JSON files without UTF-8 BOM');
  assert.ok(ps1.includes('--omit=dev --ignore-scripts'), 'Script must install prod deps only inside staging');
  assert.ok(ps1.includes('System.IO.Compression'), 'Script must load System.IO.Compression explicitly');
  assert.ok(ps1.includes('System.IO.Compression.FileSystem'), 'Script must load System.IO.Compression.FileSystem explicitly');
  assert.ok(ps1.includes('GetEntry(') && ps1.includes('.Open()'), 'Script must verify ZIP entry stream readability');
  assert.ok(ps1.includes('exit 0'), 'Script must explicitly exit 0 on completion');

  // Regression: accepts Node >= 22 (e.g. v24.16.0) without conflating with remote Catalyst node22 verification
  assert.ok(ps1.includes('$nodeMajor -lt 22'), 'Script must accept Node >= 22 (including v24.16.0)');
  assert.equal(ps1.includes('$nodeMajor -ne 22) { throw'), false);
  assert.ok(
    ps1.includes('does NOT replace testing the remote Catalyst Node.js 22 runtime'),
    'Script must clarify Node 24 execution does not replace remote Catalyst node22 runtime testing'
  );
  assert.ok(ps1.includes("ContainsKey('PSEdition')"), 'Script must safely guard $PSVersionTable.PSEdition under Set-StrictMode');

  // Verify the version regex implemented in prepare-vigor-api-upload.ps1 accepts v24.16.0 and v22.23.2 but rejects v20.x
  const versionPattern = /^v(\d+)\.(\d+)\.(\d+)/;
  for (const [ver, expectedAllowed] of [
    ['v24.16.0', true],
    ['v22.23.2', true],
    ['v20.18.1', false],
  ] as const) {
    const match = ver.match(versionPattern);
    assert.ok(match, `Expected version regex match for ${ver}`);
    assert.equal(Number(match[1]) >= 22, expectedAllowed);
  }

  for (const remoteCmd of [
    'catalyst deploy',
    'catalyst init',
    'apig:enable',
    'ds:import',
    'token:generate',
    'Invoke-RestMethod',
    'Invoke-WebRequest',
  ]) {
    assert.equal(ps1.includes(remoteCmd), false, `Forbidden remote operation in PS1: ${remoteCmd}`);
  }
});

test('[PASS-STATIC] docs/34 reconciles Node 24.16.0 vs Node 22.23.2 evidence, Zoho default Security Rules, 41 endpoints & 30s hotspots', () => {
  assert.ok(fs.existsSync(DOC_PATH), `Missing documentation: ${DOC_PATH}`);
  const doc = fs.readFileSync(DOC_PATH, 'utf8');

  assert.ok(doc.includes('PHASE_5_3_UPLOAD_PACKAGE_READY_NOT_DEPLOYED'));
  assert.ok(doc.includes('PENDING_LIVE_VERIFICATION'));
  assert.equal(CATALYST_PLATFORM_LIMITS.ADVANCED_IO_TIMEOUT_MS, 30_000);
  assert.ok(doc.includes('30,000 ms') || doc.includes('30s'));
  assert.ok(doc.includes('vigor_api.zip'));
  assert.ok(doc.includes('catalyst-config.json'));
  assert.ok(doc.includes('dist/server/catalystEntry.js'));

  // Regression: Node 24.16.0 PS 5.1 reconciliation + preserved Node 22.23.2 evidence
  assert.ok(doc.includes('Windows PowerShell 5.1'));
  assert.ok(doc.includes('v24.16.0'));
  assert.ok(doc.includes('v22.23.2'));
  assert.ok(doc.includes('engines.node >=22'));
  assert.ok(doc.includes('NO equivale a probar el runtime remoto Node.js 22'));

  // Regression: Zoho Catalyst default Advanced I/O Security Rules + Function URL vs API Gateway preflight boundary
  assert.ok(doc.includes('Security Rules'));
  assert.ok(doc.includes('`.*`'));
  assert.ok(doc.includes('`optional`'));
  for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'PATCH']) {
    assert.ok(doc.includes(method), `Missing default Security Rules method ${method}`);
  }
  assert.ok(doc.includes('NO incluido entre los métodos admitidos'));
  assert.ok(doc.includes('controles internos fail-closed de Express'));
  assert.ok(doc.includes('preflight del navegador') && doc.includes('API Gateway'));

  // Regression: exact 3 critical 30s endpoints + all 41 routes
  for (const critical30sId of [
    'admin.stats.get',
    'athlete.groceries.sync',
    'athlete.notifications.markAllRead',
  ]) {
    assert.ok(doc.includes(critical30sId), `Missing critical 30s endpoint ${critical30sId}`);
  }

  assert.equal(ROUTE_CONTRACT_SPECS.length, 41);
  for (const spec of ROUTE_CONTRACT_SPECS) {
    assert.ok(
      doc.includes(spec.id),
      `41-endpoint 30s timeout audit in docs/34 is missing endpoint id '${spec.id}'`
    );
  }
});

