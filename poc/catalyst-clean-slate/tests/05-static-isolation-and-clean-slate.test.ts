/**
 * Classification: PASS-STATIC
 * Validates Clean-Slate architectural isolation, zero untrusted client epoch logic,
 * zero legacy camelCase `consistentRead` or invalid `'ADD'` operation_type,
 * 11 functional areas mapping, disposition of all 10+1 Cloud Functions v2,
 * frozen 5-table schema, and Phase 4.0.3 documentation completeness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEAN_SLATE_ENDPOINT_CATALOG } from '../src/routes/apiRouterSchema.js';
import { KeyBuilders, TABLE_SCHEMA_REGISTRY } from '../src/types/cleanSlate.js';
import { BROWSER_E2E_MATRIX } from './06-integration-catalyst-live.spec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function collectFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test('[PASS-STATIC] Zero Firestore ETL/UID-bridge logic, zero undocumented fields, and zero trusted client epoch/camelCase consistentRead in src/', () => {
  const srcFiles = collectFiles(path.join(POC_ROOT, 'src'), ['.ts']);
  assert.ok(srcFiles.length >= 7);

  const forbiddenTerms = [
    'firestore.googleapis.com',
    'exportDocuments',
    'IdentityBridgeRecord',
    'IdentityLinker',
    '_migrationBatchId',
    'auth_time_sec',
    'consistentRead:',
    "operation_type: 'ADD'",
    'operation_type: "ADD"',
    "function_name: 'attribute_not_exists'",
    'clientSessionEpoch?:',
    'clientRoleVersion?:',
    'readOptionalNumericHeader',
  ];

  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const term of forbiddenTerms) {
      assert.equal(
        content.includes(term),
        false,
        `Forbidden or deprecated pattern '${term}' found in ${path.relative(POC_ROOT, file)}`
      );
    }
  }
});

test('[PASS-STATIC] Public HTTP superadmin bootstrap route absent & all 11 areas + 10 core Cloud Functions mapped', () => {
  const publicBootstrap = CLEAN_SLATE_ENDPOINT_CATALOG.find(e => e.path.includes('bootstrap-superadmin'));
  assert.equal(publicBootstrap, undefined);

  const expectedSkPrefixes = [
    KeyBuilders.biometricsSk(),
    KeyBuilders.preferencesSk(),
    KeyBuilders.grocerySk('g1'),
    KeyBuilders.mealSk('2026-11-13T08:00', 'm1'),
    KeyBuilders.workoutSetSk('w1', 's1'),
    KeyBuilders.cardioSk('2026-11-13', 'c1'),
    KeyBuilders.notificationSk('2026-11-13T08:00:00Z', 'n1'),
    KeyBuilders.recipeSk('r1'),
    KeyBuilders.mealPlanSk('2026-11-09'),
    KeyBuilders.routineSk('rt1'),
    KeyBuilders.executedWorkoutSk('2026-11-13T08:00:00Z', 'w1'),
  ];
  assert.equal(expectedSkPrefixes.length, 11);
  assert.ok(expectedSkPrefixes[4].startsWith('SET#'));
  assert.ok(expectedSkPrefixes[10].startsWith('WORKOUT#'));

  const replacedFns = [
    'listAdminUsers',
    'getAdminStats',
    'getAdminUserDetail',
    'createAdminInvitation',
    'revokeAdminInvitation',
    'acceptAdminInvitation',
    'setAdminUserRole',
    'setAdminUserStatus',
    'requestAdminPasswordReset',
    'syncCurrentUserDirectory',
    'getAdminAuditLogs',
  ];
  for (const fnName of replacedFns) {
    assert.ok(
      CLEAN_SLATE_ENDPOINT_CATALOG.some(e => e.replacesFirebaseMechanism.includes(fnName)),
      `Missing Cloud Function mapping for ${fnName}`
    );
  }

  for (const requiredSessionRoute of [
    '/api/v1/auth/session/bootstrap-profile',
    '/api/v1/auth/session/exchange',
    '/api/v1/auth/session/refresh',
    '/api/v1/auth/session/logout',
    '/api/v1/auth/session/revoke',
  ]) {
    assert.ok(
      CLEAN_SLATE_ENDPOINT_CATALOG.some(e => e.path === requiredSessionRoute),
      `Missing Phase 4.0.4 session endpoint ${requiredSessionRoute}`
    );
  }
});

test('[PASS-STATIC] Cookie & CORS hardening: zero wildcard Access-Control-Allow-Origin or automatic SameSite=None downgrade in auth/routes', () => {
  const authContent = fs.readFileSync(path.join(POC_ROOT, 'src/auth/cleanSlateAuthGuard.ts'), 'utf8');
  const routesContent = fs.readFileSync(path.join(POC_ROOT, 'src/routes/apiRouterSchema.ts'), 'utf8');
  assert.ok(authContent.includes('SameSite=Strict'), 'Default SameSite=Strict cookie policy must remain intact');
  assert.ok(
    authContent.includes("VIGOR_CROSS_SITE_COOKIES") && authContent.includes('this.crossSiteCookies ?'),
    'SameSite=None must be strictly gated behind explicit VIGOR_CROSS_SITE_COOKIES=true opt-in (never automatic)'
  );
  assert.equal(authContent.includes('vigorcore-poc-dev-hmac-secret'), false, 'Hardcoded dev HMAC secret literal must be removed');
  assert.equal(routesContent.includes("'Access-Control-Allow-Origin': '*'"), false, 'Wildcard CORS origin is forbidden');
});

test('[PASS-STATIC] Frozen 5-table schema, single TTL attribute (ttlEpochSec), and 20-item browser spec match Phase 4.0.5', () => {
  assert.deepEqual(Object.keys(TABLE_SCHEMA_REGISTRY).sort(), [
    'AdminInvitations',
    'AuditLogs',
    'SystemControl',
    'UserData',
    'Users',
  ]);
  assert.equal(TABLE_SCHEMA_REGISTRY.Users.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.AdminInvitations.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.ttlAttribute?.name, 'ttlEpochSec');
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.ttlAttribute?.type, 'Number');
  assert.equal(TABLE_SCHEMA_REGISTRY.AdminInvitations.ttlAttribute?.name, 'ttlEpochSec');

  assert.equal(BROWSER_E2E_MATRIX.length, 20);
  for (const item of BROWSER_E2E_MATRIX) {
    assert.equal(item.status, 'PENDING_LIVE_VERIFICATION');
    assert.ok(item.browsers.includes('Chromium'));
    assert.ok(item.browsers.includes('Safari/WebKit'));
  }
});

test('[PASS-STATIC] All Phase 4.0 through 4.1 documents exist and frozen docs consistently align schema + ttlEpochSec', () => {
  const expectedDocs = [
    'docs/01-clean-slate-architecture-report.md',
    'docs/02-functional-inventory.md',
    'docs/03-nosql-data-model-and-indexes.md',
    'docs/04-equivalence-auth-endpoints-security.md',
    'docs/05-verification-and-test-report.md',
    'docs/06-adversarial-audit-4.0.1.md',
    'docs/07-manual-catalyst-tables-runbook.md',
    'docs/08-phase-4.0.2-schema-freeze-and-guarantees.md',
    'docs/09-phase-4.0.3-auth-and-sdk-audit.md',
    'docs/10-phase-4.0.4-session-and-slate-compatibility.md',
    'docs/11-phase-4.0.5-pre-provisioning-closure.md',
    'docs/12-phase-4.1-provisioning-plan.md',
  ];

  for (const rel of expectedDocs) {
    const full = path.join(POC_ROOT, rel);
    assert.ok(fs.existsSync(full), `Missing Clean-Slate doc: ${rel}`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(content.length > 500, `Doc too short: ${rel}`);
  }

  const frozenAlignedDocs = [
    'docs/03-nosql-data-model-and-indexes.md',
    'docs/07-manual-catalyst-tables-runbook.md',
    'docs/08-phase-4.0.2-schema-freeze-and-guarantees.md',
    'docs/10-phase-4.0.4-session-and-slate-compatibility.md',
    'docs/11-phase-4.0.5-pre-provisioning-closure.md',
    'docs/12-phase-4.1-provisioning-plan.md',
  ];

  for (const rel of frozenAlignedDocs) {
    const content = fs.readFileSync(path.join(POC_ROOT, rel), 'utf8');
    assert.equal(content.includes('validAfterSec'), false, `Legacy validAfterSec found in ${rel}`);
    assert.equal(content.includes('consistentRead:'), false, `Legacy camelCase consistentRead found in ${rel}`);
    assert.ok(content.includes('ttlEpochSec'), `Missing ttlEpochSec in ${rel}`);
    assert.ok(content.includes('SESSION#<sid>'), `Missing SESSION#<sid> in ${rel}`);
  }
});

test('[PASS-STATIC] Phase 4.1 provisioning verifier & CLI script contain ZERO write or mutation operations', () => {
  const provisioningFiles = [
    ...collectFiles(path.join(POC_ROOT, 'src/provisioning'), ['.ts']),
    ...collectFiles(path.join(POC_ROOT, 'scripts'), ['.ts']),
  ];
  assert.ok(provisioningFiles.length >= 2);

  const forbiddenWritePatterns = [
    /\binsertItem\s*\(/,
    /\binsertItems\s*\(/,
    /\binsertBatch\s*\(/,
    /\bupdateItem\s*\(/,
    /\bupdateItems\s*\(/,
    /\bdeleteItem\s*\(/,
    /\bdeleteItems\s*\(/,
    /\bdeleteBatch\s*\(/,
    /\bexecuteOfflineAdminBootstrap\s*\(/,
    /\bregisterUser\s*\(/,
    /\bdeleteUser\s*\(/,
    /\bupdateUserStatus\s*\(/,
    /\bupdateUserDetails\s*\(/,
    /\baddUserToOrg\s*\(/,
  ];

  for (const file of provisioningFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenWritePatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden write/mutation call matching ${pattern} found in ${path.relative(POC_ROOT, file)}`
      );
    }
  }
});
