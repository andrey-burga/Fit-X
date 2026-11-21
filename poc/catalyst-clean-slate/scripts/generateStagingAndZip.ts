import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(POC_ROOT, 'artifacts');
const STAGING_DIR = path.join(ARTIFACTS_DIR, 'vigor_api');
const PORTABLE_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api-portable.zip');
const ORIGINAL_ZIP_PATH = path.join(ARTIFACTS_DIR, 'vigor_api.zip');

const RUNTIME_DEPS = [
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
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function main() {
  console.log('Generating clean staging & portable ZIP...');
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
  for (const dep of RUNTIME_DEPS) {
    prodDeps[dep] = rootPkg.dependencies[dep];
  }

  const stagingPkg = {
    name: 'vigor_api',
    version: '1.0.0',
    private: true,
    type: 'module',
    description: 'VigorCore Advanced I/O API backend for Zoho Catalyst (Node.js 22)',
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

  console.log('Installing production dependencies in staging...');
  execSync('npm install --omit=dev --ignore-scripts', { cwd: STAGING_DIR, stdio: 'inherit' });

  // Remove .bin symlinks to ensure portable ZIP has zero symlinks
  const binDir = path.join(STAGING_DIR, 'node_modules', '.bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  console.log('Building portable ZIP...');
  // We can use a lightweight custom zip builder or JS zip code to ensure 100% portable forward slashes and create_system=0
  // Let's build the ZIP buffer manually or write a clean builder script
  const filesToZip = walkFiles(STAGING_DIR).map(f => path.relative(STAGING_DIR, f).replace(/\\/g, '/'));
  
  // Let's write a simple JS builder for ZIP archive matching tests/27 expectations
  // Actually, we can use adm-zip or archiver if installed, or build standard ZIP.
  // Or even simpler: let's invoke node script to create portable zip.
  console.log(`Staging populated with ${filesToZip.length} files.`);
}

main();
