/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TypeScript equivalent of build-vigor-api-portable-package.ps1
 * Generates artifacts/vigor_api-env-audit-portable.zip with 100% forward slashes,
 * zero symlinks, 6 runtime dependencies, and exact packaging guarantees.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');
const STAGING_DIR = path.join(ARTIFACTS_DIR, 'vigor_api');
const VERSIONED_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-env-audit-portable.zip');

const RUNTIME_PACKAGES = [
  '@zcatalyst/auth',
  '@zcatalyst/auth-admin',
  '@zcatalyst/nosql',
  '@zcatalyst/transport',
  '@zcatalyst/utils',
  'express',
];

const REQUIRED_DIST_DIRS = [
  'auth',
  'nosql',
  'routes',
  'sdk',
  'security',
  'server',
  'services',
  'types',
  'validators',
];

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function createPortableZip(srcDir: string, destZipPath: string) {
  const files = walkFiles(srcDir).filter(f => !f.includes(`${path.sep}node_modules${path.sep}.bin${path.sep}`));
  const chunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const fileFull of files) {
    const rel = path.relative(srcDir, fileFull).replace(/\\/g, '/');
    const content = fs.readFileSync(fileFull);
    const nameBuf = Buffer.from(rel, 'utf8');
    const compBuf = zlib.deflateRawSync(content);
    const crcVal = computeCrc32(content);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
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
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
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
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalZip = Buffer.concat([...chunks, cdBuf, eocd]);
  fs.writeFileSync(destZipPath, finalZip);
}

function computeCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function main() {
  console.log('=== Building Final Portable Package (TypeScript TSX Builder) ===');
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  console.log('[1/4] Compiling server TS...');
  execSync('npm run build:server', { cwd: POC_ROOT, stdio: 'inherit' });

  console.log('[2/4] Preparing isolated staging directory...');
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const stagingDist = path.join(STAGING_DIR, 'dist');
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
        fs.copyFileSync(f, target);
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
    description: 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22) - Final Environment Audit Package',
    main: 'dist/server/catalystEntry.js',
    engines: { node: '>=22' },
    dependencies: prodDeps,
  };
  fs.writeFileSync(path.join(STAGING_DIR, 'package.json'), JSON.stringify(stagingPkg, null, 2) + '\n', 'utf8');

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
  fs.writeFileSync(path.join(STAGING_DIR, 'catalyst-config.json'), JSON.stringify(catalystConfig, null, 2) + '\n', 'utf8');

  console.log('[3/4] Installing runtime dependencies...');
  execSync('npm install --omit=dev --ignore-scripts', { cwd: STAGING_DIR, stdio: 'inherit' });

  const binDir = path.join(STAGING_DIR, 'node_modules', '.bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  console.log('[4/4] Creating versioned portable ZIP...');
  if (fs.existsSync(VERSIONED_ZIP_PATH)) {
    fs.rmSync(VERSIONED_ZIP_PATH, { force: true });
  }
  createPortableZip(STAGING_DIR, VERSIONED_ZIP_PATH);

  const zipBuf = fs.readFileSync(VERSIONED_ZIP_PATH);
  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');

  console.log('==================================================');
  console.log('SUCCESS: Final portable package built successfully!');
  console.log(`Path   : ${VERSIONED_ZIP_PATH}`);
  console.log(`Size   : ${zipBuf.length} bytes (${(zipBuf.length / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`SHA-256: ${sha256}`);
  console.log('==================================================');
}

main();
