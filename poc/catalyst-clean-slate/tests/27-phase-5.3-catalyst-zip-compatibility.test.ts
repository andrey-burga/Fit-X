/**
 * Classification: PASS-STATIC + PASS-LOCAL (ZERO REMOTE CALLS)
 * Forensic audit and compatibility regression tests for Phase 5.3 Catalyst `unzip -o`
 * `status: 1` failure analysis (`docs/35`), `diagnose-vigor-api-zip.ps1`,
 * preserved `vigor_api.zip`, and conservative `vigor_api-portable.zip`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

const STAGING_DIR = path.join(POC_ROOT, 'artifacts', 'vigor_api');
const ORIGINAL_ZIP_PATH = path.join(POC_ROOT, 'artifacts', 'vigor_api.zip');
const PORTABLE_ZIP_PATH = path.join(POC_ROOT, 'artifacts', 'vigor_api-portable.zip');
const DIAG_PS1_PATH = path.join(POC_ROOT, 'scripts', 'diagnose-vigor-api-zip.ps1');
const DOC_35_PATH = path.join(POC_ROOT, 'docs', '35-phase-5.3-catalyst-unzip-failure-analysis.md');

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

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface RawZipEntryInfo {
  name: string;
  createSystem: number;
  versionMade: number;
  versionNeeded: number;
  flagBits: number;
  compressionMethod: number;
  expectedCrc32: number;
  compressedSize: number;
  uncompressedSize: number;
  extraLen: number;
  externalAttributes: number;
  localHeaderOffset: number;
}

function parseRawZipCentralDirectory(zipBuf: Buffer): { hasZip64Locator: boolean; entries: RawZipEntryInfo[] } {
  let eocdOffset = -1;
  const minOff = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOff; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End-of-Central-Directory missing');

  const hasZip64Locator =
    eocdOffset >= 20 && zipBuf.readUInt32LE(eocdOffset - 20) === 0x07064b50;
  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const entries: RawZipEntryInfo[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(zipBuf.readUInt32LE(cursor), 0x02014b50, `Invalid CD header at ${cursor}`);
    const versionMade = zipBuf.readUInt16LE(cursor + 4);
    const versionNeeded = zipBuf.readUInt16LE(cursor + 6);
    const flagBits = zipBuf.readUInt16LE(cursor + 8);
    const compressionMethod = zipBuf.readUInt16LE(cursor + 10);
    const expectedCrc32 = zipBuf.readUInt32LE(cursor + 16);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const externalAttributes = zipBuf.readUInt32LE(cursor + 38);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);
    const name = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');

    entries.push({
      name,
      createSystem: (versionMade >>> 8) & 0xff,
      versionMade,
      versionNeeded,
      flagBits,
      compressionMethod,
      expectedCrc32,
      compressedSize,
      uncompressedSize,
      extraLen,
      externalAttributes,
      localHeaderOffset,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return { hasZip64Locator, entries };
}

function inflateZipEntry(zipBuf: Buffer, entry: RawZipEntryInfo): Buffer {
  const lh = entry.localHeaderOffset;
  assert.equal(zipBuf.readUInt32LE(lh), 0x04034b50, `Invalid LFH for ${entry.name}`);
  const lfhFlags = zipBuf.readUInt16LE(lh + 6);
  assert.equal(lfhFlags, entry.flagBits, `Flag mismatch LFH vs CD for ${entry.name}`);
  const lfhNameLen = zipBuf.readUInt16LE(lh + 26);
  const lfhExtraLen = zipBuf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + lfhNameLen + lfhExtraLen;
  const compressed = zipBuf.subarray(dataStart, dataStart + entry.compressedSize);
  const plain =
    entry.compressionMethod === 0
      ? Buffer.from(compressed)
      : entry.compressionMethod === 8
        ? zlib.inflateRawSync(compressed)
        : (() => {
            throw new Error(`Unsupported compression method ${entry.compressionMethod}`);
          })();
  assert.equal(plain.length, entry.uncompressedSize, `Uncompressed length mismatch for ${entry.name}`);
  assert.equal(crc32(plain), entry.expectedCrc32, `CRC32 mismatch for ${entry.name}`);
  return plain;
}

function collectRegularFiles(dir: string, skipNodeBin = false): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(STAGING_DIR, full).replace(/\\/g, '/');
    if (skipNodeBin && (rel === 'node_modules/.bin' || rel.startsWith('node_modules/.bin/'))) {
      continue;
    }
    if (e.isSymbolicLink()) {
      if (skipNodeBin) continue;
      out.push(full);
      continue;
    }
    if (e.isDirectory()) {
      out.push(...collectRegularFiles(full, skipNodeBin));
    } else {
      out.push(full);
    }
  }
  return out;
}

function hasLinuxUnzip(): boolean {
  if (process.platform === 'win32') return false;
  const res = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  return res.status === 0;
}

test('[PASS-LOCAL] Original vigor_api.zip is preserved untouched with traceable SHA-256 and valid headers', () => {
  assert.ok(fs.existsSync(ORIGINAL_ZIP_PATH), 'Original vigor_api.zip must remain preserved');
  const origBuf = fs.readFileSync(ORIGINAL_ZIP_PATH);
  assert.equal(origBuf.length, 1275008);
  assert.equal(
    sha256File(ORIGINAL_ZIP_PATH),
    'd0b6e60814f50fb7e47363fb9bef725b3fa5182ae31c826c075e3bab0ec34d64'
  );
  const { hasZip64Locator, entries } = parseRawZipCentralDirectory(origBuf);
  assert.equal(hasZip64Locator, false);
  assert.equal(entries.length, 906);
});

test('[PASS-LOCAL] Conservative portable ZIP passes deep header, CRC32, forward-slash, zero-symlink, and tree-parity audits', () => {
  assert.ok(fs.existsSync(PORTABLE_ZIP_PATH), `Missing portable ZIP: ${PORTABLE_ZIP_PATH}`);
  const portBuf = fs.readFileSync(PORTABLE_ZIP_PATH);
  assert.notEqual(sha256File(PORTABLE_ZIP_PATH), sha256File(ORIGINAL_ZIP_PATH));

  const { hasZip64Locator, entries } = parseRawZipCentralDirectory(portBuf);
  assert.equal(hasZip64Locator, false, 'Portable ZIP must not use ZIP64');
  assert.equal(entries.length, 905);

  const exactSeen = new Set<string>();
  const lowerSeen = new Set<string>();
  const extractedMap = new Map<string, Buffer>();

  for (const entry of entries) {
    assert.equal(entry.name.includes('\\'), false, `Backslash detected in ${entry.name}`);
    assert.equal(entry.name.startsWith('/'), false, `Absolute path in ${entry.name}`);
    assert.equal(entry.name.endsWith('/'), false, `Explicit empty dir in ${entry.name}`);
    assert.equal(entry.name.startsWith('vigor_api/'), false, `Wrapping folder in ${entry.name}`);
    assert.equal(entry.name.split('/').includes('..'), false, `Traversal in ${entry.name}`);
    assert.equal(/[^\x20-\x7e]/.test(entry.name), false, `Non-ASCII character in ${entry.name}`);
    assert.equal(entry.name.startsWith('node_modules/.bin/'), false, `Unexpected .bin shim in ${entry.name}`);
    assert.equal(entry.createSystem, 0, `Expected MS-DOS portable create_system=0 on ${entry.name}`);
    assert.equal(entry.versionNeeded, 20, `Expected ZIP 2.0 versionNeeded=20 on ${entry.name}`);
    assert.equal(entry.flagBits, 0, `Expected flagBits=0 (no data descriptor/UTF-8/encryption) on ${entry.name}`);
    assert.equal(entry.compressionMethod, 8, `Expected DEFLATE compression on ${entry.name}`);
    assert.equal(entry.extraLen, 0, `Expected zero extra fields on ${entry.name}`);
    assert.equal(entry.externalAttributes, 0x20, `Expected archive regular file attr 0x20 on ${entry.name}`);
    assert.ok(entry.compressedSize < 0xffffffff && entry.uncompressedSize < 0xffffffff);

    assert.equal(exactSeen.has(entry.name), false, `Duplicate ZIP entry ${entry.name}`);
    exactSeen.add(entry.name);
    const lower = entry.name.toLowerCase();
    assert.equal(lowerSeen.has(lower), false, `Case-insensitive collision on ${entry.name}`);
    lowerSeen.add(lower);

    const plain = inflateZipEntry(portBuf, entry);
    extractedMap.set(entry.name, plain);
  }

  // Required runtime files & 6 runtime deps present, zero devDeps
  const portPkg = JSON.parse(extractedMap.get('package.json')!.toString('utf8')) as {
    name: string;
    type: string;
    main: string;
    engines: { node: string };
    dependencies: Record<string, string>;
    devDependencies?: unknown;
  };
  assert.equal(portPkg.name, 'vigor_api');
  assert.equal(portPkg.type, 'module');
  assert.equal(portPkg.main, 'dist/server/catalystEntry.js');
  assert.equal(portPkg.engines.node, '>=22');
  assert.equal(portPkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(portPkg.dependencies).sort(), [...EXPECTED_RUNTIME_DEPS].sort());

  const portCfg = JSON.parse(extractedMap.get('catalyst-config.json')!.toString('utf8')) as {
    deployment: { name: string; type: string; stack: string };
    execution: { main: string };
  };
  assert.equal(portCfg.deployment.name, 'vigor_api');
  assert.equal(portCfg.deployment.type, 'advancedio');
  assert.equal(portCfg.deployment.stack, 'node22');
  assert.equal(portCfg.execution.main, 'dist/server/catalystEntry.js');

  assert.ok(extractedMap.has('package-lock.json'));
  assert.ok(extractedMap.has('dist/server/catalystEntry.js'));
  for (const dep of EXPECTED_RUNTIME_DEPS) {
    assert.ok(extractedMap.has(`node_modules/${dep}/package.json`), `Missing ${dep} in portable ZIP`);
  }
  for (const dev of EXCLUDED_DEV_DEPS) {
    assert.equal(
      [...exactSeen].some(n => n.startsWith(`node_modules/${dev}/`)),
      false,
      `Forbidden devDep ${dev} in portable ZIP`
    );
  }

  // Byte-for-byte parity against staging dir (excluding node_modules/.bin symlink)
  const stagingRegular = collectRegularFiles(STAGING_DIR, true)
    .map(f => path.relative(STAGING_DIR, f).replace(/\\/g, '/'))
    .sort();
  assert.deepEqual([...exactSeen].sort(), stagingRegular);
  for (const rel of stagingRegular) {
    const srcBytes = fs.readFileSync(path.join(STAGING_DIR, rel));
    assert.equal(extractedMap.get(rel)!.equals(srcBytes), true, `Byte mismatch for ${rel}`);
  }
});

test('[PASS-LOCAL] Linux Info-ZIP regression: backslash entry produces exit=1, while portable ZIP extracts exit=0 and boots Node 22 ESM', async t => {
  if (!hasLinuxUnzip()) {
    t.skip('Linux Info-ZIP unzip binary not installed on host');
    return;
  }

  // 1. Verify Linux unzip -tq and double unzip -o on portable ZIP both exit 0 with empty stderr
  const testRes = spawnSync('unzip', ['-tq', PORTABLE_ZIP_PATH], { encoding: 'utf8' });
  assert.equal(testRes.status, 0, testRes.stderr);

  const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-portable-test-'));
  try {
    const ext1 = spawnSync('unzip', ['-o', PORTABLE_ZIP_PATH, '-d', tmpExtract], { encoding: 'utf8' });
    assert.equal(ext1.status, 0, ext1.stderr);
    assert.equal(ext1.stderr, '');

    const ext2 = spawnSync('unzip', ['-o', PORTABLE_ZIP_PATH, '-d', tmpExtract], { encoding: 'utf8' });
    assert.equal(ext2.status, 0, ext2.stderr);
    assert.equal(ext2.stderr, '');

    // 2. Import extracted dist/server/catalystEntry.js directly and verify 503 fail-closed response
    const mod = (await import(pathToFileURL(path.join(tmpExtract, 'dist/server/catalystEntry.js')).href)) as {
      default: (req: unknown, res: unknown) => void;
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
    mod.default({ headers: {}, method: 'GET', url: '/health' }, mockRes);
    assert.equal(statusCode, 503);
    assert.ok(bodyText.includes('SERVER_CONFIGURATION_UNAVAILABLE'));
  } finally {
    fs.rmSync(tmpExtract, { recursive: true, force: true });
  }

  // 3. Reproduce Catalyst runtime error signature: backslash `\` in ZIP entry makes Info-ZIP `unzip -o` exit with status=1
  const pyCheck = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (pyCheck.status === 0) {
    const badZip = path.join(os.tmpdir(), `vigor-backslash-repro-${Date.now()}.zip`);
    const badExt = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-backslash-out-'));
    try {
      execFileSync('python3', [
        '-c',
        `import zipfile, sys; zf=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); zi=zipfile.ZipInfo('dist\\\\server\\\\catalystEntry.js'); zi.create_system=0; zi.external_attr=0x20; zf.writestr(zi,b'export default function(){}\\n'); zf.close()`,
        badZip,
      ]);
      const badRes = spawnSync('unzip', ['-o', badZip, '-d', badExt], { encoding: 'utf8' });
      assert.equal(badRes.status, 1);
      assert.ok(badRes.stderr.includes('backslashes as path separators'));
    } finally {
      fs.rmSync(badZip, { force: true });
      fs.rmSync(badExt, { recursive: true, force: true });
    }
  }
});

test('[PASS-STATIC] diagnose-vigor-api-zip.ps1 is Windows PS 5.1 + Node 24.16.0 safe, preserves vigor_api.zip, and never runs remote calls', () => {
  assert.ok(fs.existsSync(DIAG_PS1_PATH), `Missing script: ${DIAG_PS1_PATH}`);
  const ps1 = fs.readFileSync(DIAG_PS1_PATH, 'utf8');

  const psOnly = ps1.replace(/\$esmScript\s*=\s*@'[\s\S]*?\r?\n'@/g, '');
  assert.equal(psOnly.includes('&&'), false, 'PowerShell 5.1 script must not use &&');
  assert.equal(psOnly.includes('||'), false, 'PowerShell 5.1 script must not use ||');
  assert.ok(ps1.includes('$LASTEXITCODE'));
  assert.ok(ps1.includes('Invoke-ExternalCommand'));
  assert.ok(ps1.includes("ContainsKey('PSEdition')"));
  assert.ok(ps1.includes('$nodeMajor -lt 22'));
  assert.ok(ps1.includes('System.IO.Compression.ZipArchive'));
  assert.ok(ps1.includes('vigor_api-portable.zip'));
  assert.ok(ps1.includes("PSObject.Properties['ExternalAttributes']"));
  assert.ok(ps1.includes('Compute-Crc32'));
  assert.ok(ps1.includes('exit 0'));

  // Audit inspects raw Central Directory without normalizing backslashes first
  assert.ok(ps1.includes('if ($rawName.Contains(\'\\\'))'));
  // Never deletes or overwrites OriginalZipPath (`vigor_api.zip`)
  assert.equal(ps1.includes('Remove-Item -LiteralPath $OriginalZipPath'), false);

  for (const remoteCmd of [
    'catalyst deploy',
    'catalyst init',
    'apig:enable',
    'ds:import',
    'token:generate',
    'Invoke-RestMethod',
    'Invoke-WebRequest',
  ]) {
    assert.equal(ps1.includes(remoteCmd), false, `Forbidden remote cmd in PS1: ${remoteCmd}`);
  }
});

test('[PASS-STATIC] docs/35 records observed Catalyst failure, SHA-256 traceability, Zoho dossier, and final verdict', () => {
  assert.ok(fs.existsSync(DOC_35_PATH), `Missing forensic doc: ${DOC_35_PATH}`);
  const doc = fs.readFileSync(DOC_35_PATH, 'utf8');

  assert.ok(doc.includes('PHASE_5_3_CATALYST_UNZIP_FAILURE_ANALYZED'));
  assert.ok(doc.includes('136967000000014024'));
  assert.ok(doc.includes('136967000000074001'));
  assert.ok(doc.includes('https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/'));
  assert.ok(doc.includes('unzip -o /tmp/customer_code.zip -d /catalyst/'));
  assert.ok(doc.includes('/var/runtime/index.js:145'));
  assert.ok(doc.includes('status: 1, signal: null, stdout: null, stderr: null'));
  assert.ok(doc.includes(sha256File(ORIGINAL_ZIP_PATH)));
  assert.ok(doc.includes(sha256File(PORTABLE_ZIP_PATH)));
  assert.ok(doc.includes('diagnose-vigor-api-zip.ps1'));
  assert.ok(doc.includes('Zoho'));
});
