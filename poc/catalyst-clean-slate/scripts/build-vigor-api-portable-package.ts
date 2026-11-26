/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.8 — Deterministic & Reproducible Portable Package Builder
 * Generates `artifacts/vigor_api-phase-5.8-development-candidate.zip` using an isolated
 * temporary staging directory so all preserved historical archives remain untouched.
 *
 * Determinism Guarantees:
 *   1. Entry paths sorted strictly by ASCII / UTF-8 code-point ordinal order.
 *   2. 100% POSIX forward-slash ('/') separators, zero directory entries.
 *   3. Fixed valid DOS epoch timestamp: 1980-01-01 00:00:00 (mtime=0x0000, mdate=0x0021).
 *   4. Pinned zlib DEFLATE parameters (level=6, memLevel=8, Z_DEFAULT_STRATEGY).
 *   5. Portable MS-DOS attributes (verMade=20, verNeed=20, flags=0, extAttr=0x20).
 *   6. Symlinks, node_modules/.bin shims, source maps, and OS metadata excluded.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const POC_ROOT = path.resolve(__dirname, '..');
export const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');
export const PHASE_5_8_CANDIDATE_ZIP_NAME = 'vigor_api-phase-5.8-development-candidate.zip';
export const PHASE_5_8_CANDIDATE_MANIFEST_NAME = 'vigor_api-phase-5.8-development-candidate.manifest.json';
export const PHASE_5_8_CANDIDATE_RELEASE_NAME = 'vigor_api-phase-5.8-development-candidate.release.json';
export const DEFAULT_OUTPUT_ZIP_PATH = path.join(ARTIFACTS_DIR, PHASE_5_8_CANDIDATE_ZIP_NAME);
export const DEFAULT_OUTPUT_MANIFEST_PATH = path.join(ARTIFACTS_DIR, PHASE_5_8_CANDIDATE_MANIFEST_NAME);
export const DEFAULT_OUTPUT_RELEASE_PATH = path.join(ARTIFACTS_DIR, PHASE_5_8_CANDIDATE_RELEASE_NAME);

export const PRESERVED_HISTORICAL_ZIPS = new Set<string>([
  'vigor_api.zip',
  'vigor_api-portable.zip',
  'vigor_api-env-audit-portable.zip',
  'vigor_api-reproducible-portable.zip',
  'vigor_api-vars-reconciled-portable.zip',
  'vigor_api-auth-reconciled-portable.zip',
  'vigor_api-auth-forensic-diagnostic-portable.zip',
  'vigor_api-hosted-admin-remediated-portable.zip',
]);

// Canonical DOS epoch 1980-01-01 00:00:00
// Date bits: ((1980-1980) << 9) | (1 << 5) | 1 = 0x0021
export const FIXED_DOS_MTIME = 0x0000;
export const FIXED_DOS_MDATE = 0x0021;

export const RUNTIME_PACKAGES = [
  '@zcatalyst/auth',
  '@zcatalyst/auth-admin',
  '@zcatalyst/nosql',
  '@zcatalyst/transport',
  '@zcatalyst/utils',
  'express',
] as const;

export const REQUIRED_DIST_DIRS = [
  'auth',
  'nosql',
  'routes',
  'sdk',
  'security',
  'server',
  'services',
  'types',
  'validators',
] as const;

const EXCLUDED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface CanonicalManifestEntry {
  path: string;
  uncompressedSize: number;
  sha256: string;
  fileType: string;
}

export interface ParsedZipEntry {
  name: string;
  verMade: number;
  verNeed: number;
  flags: number;
  method: number;
  mtime: number;
  mdate: number;
  crc32: number;
  compSize: number;
  uncompSize: number;
  extraLen: number;
  commentLen: number;
  extAttr: number;
  lfhOffset: number;
}

export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function classifyFileType(relPath: string): string {
  if (relPath === 'package.json' || relPath === 'package-lock.json' || relPath === 'catalyst-config.json') {
    return 'manifest';
  }
  if (relPath.startsWith('dist/')) return 'compiled-esm';
  if (relPath.startsWith('node_modules/')) {
    const ext = path.posix.extname(relPath).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'dependency-js';
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'dependency-dts';
    if (ext === '.json') return 'dependency-json';
    return 'dependency-asset';
  }
  return 'other';
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const dirEntries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareCodePoint(a.name, b.name));
  for (const entry of dirEntries) {
    if (EXCLUDED_BASENAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const lstat = fs.lstatSync(full);
    if (lstat.isSymbolicLink() || entry.isSymbolicLink()) continue;
    if (lstat.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (lstat.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function computeCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function createDeterministicPortableZip(srcDir: string, destZipPath: string): {
  entryCount: number;
  totalUncompressedBytes: number;
  zipSizeBytes: number;
  sha256: string;
} {
  const collected = walkFiles(srcDir)
    .map(fileFull => ({
      fileFull,
      rel: path.relative(srcDir, fileFull).replace(/\\/g, '/'),
    }))
    .filter(item => {
      if (item.rel.startsWith('node_modules/.bin/') || item.rel.includes('/node_modules/.bin/')) return false;
      if (item.rel.endsWith('.js.map')) return false;
      return true;
    })
    .sort((a, b) => compareCodePoint(a.rel, b.rel));

  const chunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;
  let totalUncompressedBytes = 0;

  for (const { fileFull, rel } of collected) {
    const content = fs.readFileSync(fileFull);
    totalUncompressedBytes += content.length;
    const nameBuf = Buffer.from(rel, 'utf8');
    const compBuf = zlib.deflateRawSync(content, {
      level: 6,
      memLevel: 8,
      strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    });
    const crcVal = computeCrc32(content);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(FIXED_DOS_MTIME, 10);
    lfh.writeUInt16LE(FIXED_DOS_MDATE, 12);
    lfh.writeUInt32LE(crcVal, 14);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    chunks.push(lfh, nameBuf, compBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(FIXED_DOS_MTIME, 12);
    cdh.writeUInt16LE(FIXED_DOS_MDATE, 14);
    cdh.writeUInt32LE(crcVal, 16);
    cdh.writeUInt32LE(compBuf.length, 20);
    cdh.writeUInt32LE(content.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0x20, 38);
    cdh.writeUInt32LE(offset, 42);

    cdChunks.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + compBuf.length;
  }

  const cdBuf = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(collected.length, 8);
  eocd.writeUInt16LE(collected.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...chunks, cdBuf, eocd]);
  fs.mkdirSync(path.dirname(destZipPath), { recursive: true });
  fs.writeFileSync(destZipPath, finalZip);

  return {
    entryCount: collected.length,
    totalUncompressedBytes,
    zipSizeBytes: finalZip.length,
    sha256: crypto.createHash('sha256').update(finalZip).digest('hex'),
  };
}

export function parseZipEntries(zipPath: string): ParsedZipEntry[] {
  const buf = fs.readFileSync(zipPath);
  const eocdOff = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOff < 0) throw new Error(`Missing EOCD signature in ZIP: ${zipPath}`);

  const totalEntries = buf.readUInt16LE(eocdOff + 10);
  const cdOff = buf.readUInt32LE(eocdOff + 16);
  let p = cdOff;
  const entries: ParsedZipEntry[] = [];

  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(p);
    if (sig !== 0x02014b50) throw new Error(`Invalid CDH signature at index ${i}`);
    const verMade = buf.readUInt16LE(p + 4);
    const verNeed = buf.readUInt16LE(p + 6);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const mtime = buf.readUInt16LE(p + 12);
    const mdate = buf.readUInt16LE(p + 14);
    const crc32 = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const lfhOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nLen).toString('utf8');

    entries.push({
      name,
      verMade,
      verNeed,
      flags,
      method,
      mtime,
      mdate,
      crc32,
      compSize,
      uncompSize,
      extraLen: eLen,
      commentLen: cLen,
      extAttr,
      lfhOffset,
    });
    p += 46 + nLen + eLen + cLen;
  }
  return entries;
}

export function extractCanonicalContentManifest(zipPath: string): CanonicalManifestEntry[] {
  const buf = fs.readFileSync(zipPath);
  const parsed = parseZipEntries(zipPath);
  const manifest: CanonicalManifestEntry[] = [];

  for (const entry of parsed) {
    const lfhOff = entry.lfhOffset;
    if (buf.readUInt32LE(lfhOff) !== 0x04034b50) {
      throw new Error(`Invalid LFH signature for ${entry.name}`);
    }
    const lfhNLen = buf.readUInt16LE(lfhOff + 26);
    const lfhELen = buf.readUInt16LE(lfhOff + 28);
    const dataStart = lfhOff + 30 + lfhNLen + lfhELen;
    const compData = buf.subarray(dataStart, dataStart + entry.compSize);
    const plain = entry.method === 0 ? compData : zlib.inflateRawSync(compData);
    manifest.push({
      path: entry.name,
      uncompressedSize: plain.length,
      sha256: crypto.createHash('sha256').update(plain).digest('hex'),
      fileType: classifyFileType(entry.name),
    });
  }

  return manifest.sort((a, b) => compareCodePoint(a.path, b.path));
}

export function compareContentManifests(
  expected: CanonicalManifestEntry[],
  actual: CanonicalManifestEntry[],
): {
  missing: string[];
  unexpected: string[];
  changed: Array<{ path: string; expectedSha256: string; actualSha256: string }>;
  expectedTotalUncompressedBytes: number;
  actualTotalUncompressedBytes: number;
} {
  const expMap = new Map(expected.map(item => [item.path, item]));
  const actMap = new Map(actual.map(item => [item.path, item]));

  const missing = expected.filter(item => !actMap.has(item.path)).map(item => item.path);
  const unexpected = actual.filter(item => !expMap.has(item.path)).map(item => item.path);
  const changed: Array<{ path: string; expectedSha256: string; actualSha256: string }> = [];

  for (const item of expected) {
    const other = actMap.get(item.path);
    if (other && (other.sha256 !== item.sha256 || other.uncompressedSize !== item.uncompressedSize)) {
      changed.push({ path: item.path, expectedSha256: item.sha256, actualSha256: other.sha256 });
    }
  }

  return {
    missing,
    unexpected,
    changed,
    expectedTotalUncompressedBytes: expected.reduce((s, e) => s + e.uncompressedSize, 0),
    actualTotalUncompressedBytes: actual.reduce((s, e) => s + e.uncompressedSize, 0),
  };
}

export interface BuildPackageOptions {
  outputZipPath?: string;
  skipCompile?: boolean;
  quiet?: boolean;
}

export function computeServerSourceStateFingerprint(pocRoot: string = POC_ROOT): {
  type: 'deterministic-server-source-sha256';
  sha256: string;
  fileCount: number;
  files: Array<{ path: string; sha256: string; sizeBytes: number }>;
} {
  const inputPaths: string[] = [
    path.join(pocRoot, 'package.json'),
    path.join(pocRoot, 'tsconfig.server.json'),
  ];
  for (const sub of REQUIRED_DIST_DIRS) {
    const srcSub = path.join(pocRoot, 'src', sub);
    if (fs.existsSync(srcSub)) {
      inputPaths.push(...walkFiles(srcSub).filter(f => f.endsWith('.ts') || f.endsWith('.json')));
    }
  }
  const normalizedFiles = inputPaths
    .map(full => {
      const rel = path.relative(pocRoot, full).replace(/\\/g, '/');
      const content = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
      const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      return {
        path: rel,
        sha256,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      };
    })
    .sort((a, b) => compareCodePoint(a.path, b.path));

  const aggregateHasher = crypto.createHash('sha256');
  for (const item of normalizedFiles) {
    aggregateHasher.update(`${item.path}:${item.sha256}\n`, 'utf8');
  }
  return {
    type: 'deterministic-server-source-sha256',
    sha256: aggregateHasher.digest('hex'),
    fileCount: normalizedFiles.length,
    files: normalizedFiles,
  };
}

export function generateCandidateReleaseMetadata(params: {
  zipPath: string;
  zipSizeBytes: number;
  zipSha256: string;
  entryCount: number;
  totalUncompressedBytes: number;
  manifest: CanonicalManifestEntry[];
}) {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(POC_ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const requiredDependencies: Record<string, string> = {};
  for (const dep of RUNTIME_PACKAGES) {
    requiredDependencies[dep] = rootPkg.dependencies[dep];
  }
  const compiledModules = params.manifest
    .filter(m => m.path.startsWith('dist/'))
    .map(m => ({
      path: m.path,
      uncompressedSize: m.uncompressedSize,
      sha256: m.sha256,
    }));
  const entryModule = compiledModules.find(m => m.path === 'dist/server/catalystEntry.js');

  return {
    candidateName: path.basename(params.zipPath),
    phase: '5.8',
    targetEnvironment: 'Development',
    readinessStatus: 'READY_FOR_DEVELOPMENT_OPERATOR_REVIEW',
    sourceStateIdentifier: computeServerSourceStateFingerprint(POC_ROOT),
    buildCommand:
      'npm --prefix poc/catalyst-clean-slate run build:server && ./poc/catalyst-clean-slate/node_modules/.bin/tsx poc/catalyst-clean-slate/scripts/build-vigor-api-portable-package.ts',
    nodeRuntime: {
      buildHostNodeVersion: process.version,
      targetCatalystStack: 'node22',
      enginesNode: '>=22',
    },
    entryPoint: 'dist/server/catalystEntry.js',
    entryPointSha256: entryModule?.sha256 ?? '',
    requiredDependencies,
    packageStats: {
      entryCount: params.entryCount,
      zipSizeBytes: params.zipSizeBytes,
      totalUncompressedBytes: params.totalUncompressedBytes,
      zipSha256: params.zipSha256,
    },
    compiledEntrySha256s: compiledModules,
  };
}

export function buildReproduciblePortablePackage(options: BuildPackageOptions = {}) {
  const outputZipPath = options.outputZipPath ? path.resolve(options.outputZipPath) : DEFAULT_OUTPUT_ZIP_PATH;
  if (
    path.resolve(path.dirname(outputZipPath)) === path.resolve(ARTIFACTS_DIR) &&
    PRESERVED_HISTORICAL_ZIPS.has(path.basename(outputZipPath))
  ) {
    throw new Error(
      `PRESERVED_HISTORICAL_ARCHIVE_IMMUTABLE: Refusing to overwrite preserved archive '${path.basename(outputZipPath)}'.`
    );
  }
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);

  log('=== Building Reproducible Development Candidate Portable Package (TypeScript TSX Builder) ===');
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  if (!options.skipCompile) {
    log('[1/4] Compiling server TS...');
    execSync('npm run build:server', { cwd: POC_ROOT, stdio: options.quiet ? 'ignore' : 'inherit' });
  }

  log('[2/4] Preparing isolated temporary staging directory...');
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigor-api-reproducible-'));
  try {
    const stagingDist = path.join(stagingDir, 'dist');
    fs.mkdirSync(stagingDist, { recursive: true });

    const distRoot = path.join(POC_ROOT, 'dist');
    for (const sub of REQUIRED_DIST_DIRS) {
      const srcSub = path.join(distRoot, sub);
      const dstSub = path.join(stagingDist, sub);
      if (fs.existsSync(srcSub)) {
        fs.mkdirSync(dstSub, { recursive: true });
        const files = walkFiles(srcSub).filter(f => f.endsWith('.js'));
        for (const f of files) {
          const rel = path.relative(srcSub, f);
          const target = path.join(dstSub, rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const jsContent = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
          fs.writeFileSync(target, jsContent, 'utf8');
        }
      }
    }

    const rootPkg = JSON.parse(fs.readFileSync(path.join(POC_ROOT, 'package.json'), 'utf8'));
    const prodDeps: Record<string, string> = {};
    for (const dep of RUNTIME_PACKAGES) {
      prodDeps[dep] = rootPkg.dependencies[dep];
    }

    const stagingPkg = {
      name: 'vigor_api',
      version: '1.0.0',
      private: true,
      type: 'module',
      description: 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22) - Phase 5.8 Development Candidate',
      main: 'dist/server/catalystEntry.js',
      engines: { node: '>=22' },
      dependencies: prodDeps,
    };
    fs.writeFileSync(
      path.join(stagingDir, 'package.json'),
      (JSON.stringify(stagingPkg, null, 2) + '\n').replace(/\r\n/g, '\n'),
      'utf8',
    );

    const catalystConfig = {
      deployment: {
        name: 'vigor_api',
        type: 'advancedio',
        stack: 'node22',
      },
      execution: {
        main: 'dist/server/catalystEntry.js',
      },
    };
    fs.writeFileSync(
      path.join(stagingDir, 'catalyst-config.json'),
      (JSON.stringify(catalystConfig, null, 2) + '\n').replace(/\r\n/g, '\n'),
      'utf8',
    );

    log('[3/4] Installing runtime dependencies...');
    execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund', {
      cwd: stagingDir,
      stdio: options.quiet ? 'ignore' : 'inherit',
    });

    const lockPath = path.join(stagingDir, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      const lockText = fs.readFileSync(lockPath, 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(lockPath, lockText, 'utf8');
    }

    const binDir = path.join(stagingDir, 'node_modules', '.bin');
    if (fs.existsSync(binDir)) {
      fs.rmSync(binDir, { recursive: true, force: true });
    }

    log('[4/4] Creating deterministic versioned portable ZIP...');
    if (fs.existsSync(outputZipPath)) {
      fs.rmSync(outputZipPath, { force: true });
    }
    const result = createDeterministicPortableZip(stagingDir, outputZipPath);

    log('==================================================');
    log('SUCCESS: Reproducible portable package built successfully!');
    log(`Path        : ${outputZipPath}`);
    log(`Entries     : ${result.entryCount}`);
    log(`Uncompressed: ${result.totalUncompressedBytes} bytes`);
    log(`Size        : ${result.zipSizeBytes} bytes (${(result.zipSizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
    log(`SHA-256     : ${result.sha256}`);
    log('==================================================');

    return { outputZipPath, ...result };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function parseCliArgs(argv: string[]): {
  outputZipPath?: string;
  manifestPath?: string;
  releaseMetaPath?: string;
  skipCompile: boolean;
} {
  let outputZipPath: string | undefined;
  let manifestPath: string | undefined;
  let releaseMetaPath: string | undefined;
  let skipCompile = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output' && argv[i + 1]) {
      outputZipPath = argv[++i];
    } else if (argv[i] === '--manifest' && argv[i + 1]) {
      manifestPath = argv[++i];
    } else if (argv[i] === '--release-meta' && argv[i + 1]) {
      releaseMetaPath = argv[++i];
    } else if (argv[i] === '--skip-compile') {
      skipCompile = true;
    }
  }
  return { outputZipPath, manifestPath, releaseMetaPath, skipCompile };
}

const isCliEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCliEntry) {
  const args = parseCliArgs(process.argv.slice(2));
  const res = buildReproduciblePortablePackage({
    outputZipPath: args.outputZipPath,
    skipCompile: args.skipCompile,
  });
  const effectiveManifestPath =
    args.manifestPath ??
    (path.resolve(res.outputZipPath) === path.resolve(DEFAULT_OUTPUT_ZIP_PATH)
      ? DEFAULT_OUTPUT_MANIFEST_PATH
      : undefined);
  const effectiveReleasePath =
    args.releaseMetaPath ??
    (path.resolve(res.outputZipPath) === path.resolve(DEFAULT_OUTPUT_ZIP_PATH)
      ? DEFAULT_OUTPUT_RELEASE_PATH
      : undefined);
  if (effectiveManifestPath || effectiveReleasePath) {
    const manifest = extractCanonicalContentManifest(res.outputZipPath);
    if (effectiveManifestPath) {
      fs.mkdirSync(path.dirname(path.resolve(effectiveManifestPath)), { recursive: true });
      fs.writeFileSync(path.resolve(effectiveManifestPath), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }
    if (effectiveReleasePath) {
      const releaseMeta = generateCandidateReleaseMetadata({
        zipPath: res.outputZipPath,
        zipSizeBytes: res.zipSizeBytes,
        zipSha256: res.sha256,
        entryCount: res.entryCount,
        totalUncompressedBytes: res.totalUncompressedBytes,
        manifest,
      });
      fs.mkdirSync(path.dirname(path.resolve(effectiveReleasePath)), { recursive: true });
      fs.writeFileSync(path.resolve(effectiveReleasePath), JSON.stringify(releaseMeta, null, 2) + '\n', 'utf8');
    }
  }
}
