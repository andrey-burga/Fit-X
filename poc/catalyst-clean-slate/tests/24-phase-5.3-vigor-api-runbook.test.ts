/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 24:
 * Reconciled Preparation Manifest, 41/41 Route & Gateway Parity,
 * Stage 1 & Stage 2 Baseline Reconciliation, Security Invariants,
 * and `docs/32-phase-5.3-vigor-api-implementation-runbook.md` Completeness.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXHAUSTIVE_ENV_VAR_MATRIX } from '../src/provisioning/operationalPreparationManifest.js';
import { PHASE_5_2_STAGE_1_DEV_INVENTORY } from '../src/provisioning/phase52Stage1Inventory.js';
import { PHASE_5_2_STAGE_2_DEV_INVENTORY } from '../src/provisioning/phase52Stage2Inventory.js';
import {
  buildPhase53RouteInventory,
  PHASE_5_3_VIGOR_API_PREPARATION,
  validatePhase53VigorApiPreparation,
} from '../src/provisioning/phase53VigorApiManifest.js';
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

test('Phase 5.3 [PASS-UNIT] Declarative preparation manifest passes parity checks with 41 routes, 5 tables, 8 GSIs, and disabled API Gateway', () => {
  const result = validatePhase53VigorApiPreparation();
  assert.equal(result.passed, true, `Unexpected violations: ${result.violations.join('; ')}`);
  assert.equal(result.canonicalRouteCount, 41);
  assert.equal(result.tableCount, 5);
  assert.equal(result.indexCount, 8);
  assert.ok(result.envVarCount >= 32);

  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.projectName, 'Project-Rainfall');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.catalystProjectId, '136967000000014024');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.targetEnvironment, 'Development');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.productionModified, false);
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.apiGatewayEnabledInitially, false);
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.apiGatewayRollbackCommand, 'catalyst apig:disable');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.apiDomainGate, 'BLOCKED_PENDING_ZOHO_CLARIFICATION');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.verdict, 'PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED');
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.remoteOperationsExecuted, 0);

  assert.equal(
    PHASE_5_3_VIGOR_API_PREPARATION.inheritedClosures.stage1Verdict,
    'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED'
  );
  assert.equal(
    PHASE_5_3_VIGOR_API_PREPARATION.inheritedClosures.stage2Verdict,
    'PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION'
  );
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.inheritedClosures.stage2ObservedUsersCount, 0);
  assert.equal(PHASE_5_3_VIGOR_API_PREPARATION.inheritedClosures.stage2AutomatedCliExecuted, false);

  const routes = buildPhase53RouteInventory('vigor_api');
  assert.equal(routes.length, ROUTE_CONTRACT_SPECS.length);
  for (let i = 0; i < routes.length; i++) {
    assert.equal(routes[i].routeId, ROUTE_CONTRACT_SPECS[i].id);
    assert.equal(routes[i].method, ROUTE_CONTRACT_SPECS[i].method);
    assert.equal(routes[i].canonicalPath, ROUTE_CONTRACT_SPECS[i].path);
  }
});

test('Phase 5.3 [PASS-STATIC] docs/32 covers full backend audit, 5 Table IDs, 8 Index IDs, Stage 2 posture, 41/41 routes, env vars, PS 5.1 syntax, and verdict', () => {
  const docPath = path.join(POC_ROOT, 'docs', '32-phase-5.3-vigor-api-implementation-runbook.md');
  assert.equal(fs.existsSync(docPath), true, 'Missing docs/32-phase-5.3-vigor-api-implementation-runbook.md');

  const doc = fs.readFileSync(docPath, 'utf8');

  const requiredMarkers = [
    'Project-Rainfall',
    '136967000000014024',
    'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED',
    'PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION',
    'PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED',
    'BLOCKED_PENDING_ZOHO_CLARIFICATION',
    'PENDING_LIVE_VERIFICATION',
    'vigor_api',
    'dist/server/catalystEntry.js',
    'AUD-53-01',
    'AUD-53-02',
    'AUD-53-03',
    'hosted_native',
    'external_oauth',
    "generateAuthToken('functions')",
    '__Host-vigor_session',
    'SameSite=Strict',
    'X-Vigor-CSRF',
    'Add your first user',
    'Manage Application Users',
    'verify-clean-slate-provisioning.ts --live --confirm-readonly --auth-mode external_oauth',
    'catalyst apig:enable',
    'catalyst apig:disable',
    'CATALYST_USERS_AUTHENTICATION',
    'NO_AUTHENTICATION',
    'OPTIONS /api/v1/*',
    '/health',
    '/api/v1/health',
    'app.vigorcore.lat',
    'api.vigorcore.lat',
    'Set-StrictMode -Version Latest',
  ];

  for (const marker of requiredMarkers) {
    assert.ok(doc.includes(marker), `docs/32 missing required marker: ${marker}`);
  }

  for (const table of PHASE_5_2_STAGE_1_DEV_INVENTORY.tables) {
    assert.ok(doc.includes(table.tableName), `docs/32 missing table name: ${table.tableName}`);
    assert.ok(doc.includes(table.tableId), `docs/32 missing Table ID ${table.tableName}: ${table.tableId}`);
    for (const idx of table.indexes) {
      assert.ok(doc.includes(idx.indexName), `docs/32 missing GSI name: ${idx.indexName}`);
      assert.ok(doc.includes(idx.indexId), `docs/32 missing Index ID ${idx.indexName}: ${idx.indexId}`);
    }
  }

  for (const spec of ROUTE_CONTRACT_SPECS) {
    assert.ok(doc.includes(spec.id), `docs/32 missing canonical routeId: ${spec.id}`);
    assert.ok(doc.includes(spec.path), `docs/32 missing canonical path: ${spec.path}`);
  }

  for (const envEntry of EXHAUSTIVE_ENV_VAR_MATRIX) {
    assert.ok(doc.includes(envEntry.name), `docs/32 missing env var: ${envEntry.name}`);
  }

  // Verify every PowerShell code block in docs/32 avoids bash-only && and || chaining operators
  const psBlocks = [...doc.matchAll(/```powershell\r?\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(psBlocks.length >= 2, 'Expected PowerShell 5.1 command blocks in docs/32');
  for (const block of psBlocks) {
    assert.equal(block.includes('&&'), false, 'PowerShell 5.1 block must NOT contain &&');
    assert.equal(block.includes('||'), false, 'PowerShell 5.1 block must NOT contain ||');
  }

  // Verify Stage 2 visual count baseline matches
  assert.equal(PHASE_5_2_STAGE_2_DEV_INVENTORY.visualUserListEvidence.observedUsersCount, 0);
});
