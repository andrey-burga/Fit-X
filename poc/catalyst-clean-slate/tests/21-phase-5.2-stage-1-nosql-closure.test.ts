/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.2, Stage 1 — Test Suite 21:
 * Verifies exact inventory integrity of the 5 Table IDs and 8 Index IDs provisioned
 * manually in Catalyst Console (`Development`, Project-Rainfall `136967000000014024`),
 * checks uniqueness/non-contradiction against project/Slate reference IDs, reconciles
 * 1:1 against `TABLE_SCHEMA_REGISTRY`, and audits `docs/28` & `docs/29` closure completeness.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PHASE_5_2_STAGE_1_DEV_INVENTORY,
  validatePhase52Stage1Inventory,
} from '../src/provisioning/phase52Stage1Inventory.js';
import { TABLE_SCHEMA_REGISTRY } from '../src/types/cleanSlate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

const EXPECTED_TABLE_IDS = {
  Users: '136967000000065001',
  UserData: '136967000000067007',
  AdminInvitations: '136967000000067014',
  AuditLogs: '136967000000067021',
  SystemControl: '136967000000067034',
} as const;

const EXPECTED_INDEX_IDS = {
  'Users.GSI_Email': '136967000000065003',
  'Users.GSI_Directory': '136967000000067001',
  'Users.GSI_RoleStatus': '136967000000067004',
  'UserData.GSI_UserEntityDate': '136967000000067011',
  'AdminInvitations.GSI_InviteEmailStatus': '136967000000067016',
  'AuditLogs.GSI_AuditActor': '136967000000067025',
  'AuditLogs.GSI_AuditTarget': '136967000000067028',
  'AuditLogs.GSI_GlobalChronology': '136967000000067031',
} as const;

test('Phase 5.2 Stage 1 [PASS-UNIT] Reconciled Development inventory verifies exact 5 Table IDs, 8 Index IDs, zero duplicates, empty metrics & schema parity', () => {
  const inv = PHASE_5_2_STAGE_1_DEV_INVENTORY;
  assert.equal(inv.projectName, 'Project-Rainfall');
  assert.equal(inv.catalystProjectId, '136967000000014024');
  assert.equal(inv.slateDnsHostnameId, '16391000000005003');
  assert.equal(inv.dataCenter, 'US');
  assert.equal(inv.catalystEnvironment, 'Development');
  assert.equal(inv.verdict, 'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED');
  assert.equal(inv.stage2AuthStatus, 'PENDING_INDEPENDENT_AUTHORIZATION');
  assert.equal(inv.productionPromotionStatus, 'NOT_PROMOTED');
  assert.equal(inv.remoteOperationsExecutedDuringClosure, 0);
  assert.equal(inv.automatedRemoteQueriesExecuted, false);

  const validation = validatePhase52Stage1Inventory(inv);
  assert.equal(validation.passed, true, `Validation mismatches: ${validation.mismatches.join('; ')}`);
  assert.equal(validation.tableCount, 5);
  assert.equal(validation.indexCount, 8);
  assert.equal(validation.uniqueResourceIdCount, 13);
  assert.deepEqual(validation.mismatches, []);

  // Exact mapping check for every Table ID
  for (const [tableName, expectedId] of Object.entries(EXPECTED_TABLE_IDS)) {
    const row = inv.tables.find(t => t.tableName === tableName);
    assert.ok(row, `Missing table ${tableName}`);
    assert.equal(row.tableId, expectedId);
    assert.equal(row.reportedRows, 0);
    assert.equal(row.reportedBytes, 0);
  }

  // Exact mapping check for every Index ID + Active/empty state
  for (const [qualifiedName, expectedIndexId] of Object.entries(EXPECTED_INDEX_IDS)) {
    const [tableName, indexName] = qualifiedName.split('.');
    const tbl = inv.tables.find(t => t.tableName === tableName);
    const idx = tbl?.indexes.find(i => i.indexName === indexName);
    assert.ok(idx, `Missing index ${qualifiedName}`);
    assert.equal(idx.indexId, expectedIndexId);
    assert.equal(idx.reportedStatus, 'Active');
    assert.equal(idx.reportedItems, 0);
    assert.equal(idx.reportedBytes, 0);
  }

  // Negative checks: duplicate ID or mismatched table schema MUST fail validation
  const dupIdInventory = {
    ...inv,
    tables: inv.tables.map(t =>
      t.tableName === 'SystemControl' ? { ...t, tableId: EXPECTED_TABLE_IDS.Users } : t
    ),
  };
  const dupRes = validatePhase52Stage1Inventory(dupIdInventory);
  assert.equal(dupRes.passed, false);
  assert.ok(dupRes.mismatches.some(m => m.includes('Duplicate Catalyst ID')));

  const nonEmptyInventory = {
    ...inv,
    tables: inv.tables.map(t =>
      t.tableName === 'Users' ? { ...t, reportedRows: 1 as unknown as 0 } : t
    ),
  };
  const nonEmptyRes = validatePhase52Stage1Inventory(nonEmptyInventory);
  assert.equal(nonEmptyRes.passed, false);
  assert.ok(nonEmptyRes.mismatches.some(m => m.includes('not empty')));
});

test('Phase 5.2 Stage 1 [PASS-STATIC] docs/28 and docs/29 record all 5 Table IDs, 8 Index IDs, evidence separation & Stage 2 pending gate without contradictions', () => {
  const docs28 = fs.readFileSync(path.join(POC_ROOT, 'docs', '28-phase-5.2-development-first-runbook.md'), 'utf8');
  const docs29Path = path.join(POC_ROOT, 'docs', '29-phase-5.2-stage-1-nosql-provisioning-closure.md');
  assert.equal(fs.existsSync(docs29Path), true, 'Missing docs/29-phase-5.2-stage-1-nosql-provisioning-closure.md');
  const docs29 = fs.readFileSync(docs29Path, 'utf8');

  for (const docContent of [docs28, docs29]) {
    for (const id of Object.values(EXPECTED_TABLE_IDS)) {
      assert.ok(docContent.includes(id), `Document missing Table ID ${id}`);
    }
    for (const id of Object.values(EXPECTED_INDEX_IDS)) {
      assert.ok(docContent.includes(id), `Document missing Index ID ${id}`);
    }
    for (const marker of [
      'Project-Rainfall',
      '136967000000014024',
      'Development',
      'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED',
      'ttlEpochSec',
      'Number',
      'CTRL#SAGA#<idempotencyKey>',
      'SESSION#<sid>',
      'CTRL#BOOTSTRAP',
      'CTRL#SUPERADMIN_COUNT',
      'Active',
    ]) {
      assert.ok(docContent.includes(marker), `Document missing required Stage 1 marker '${marker}'`);
    }
  }

  // Exact 11 projected columns of Users.GSI_Directory verified against TABLE_SCHEMA_REGISTRY in docs/29
  const expected11Cols = TABLE_SCHEMA_REGISTRY.Users.secondaryIndexes.find(
    i => i.indexName === 'GSI_Directory'
  )!.projectedAttributes!;
  assert.equal(expected11Cols.length, 11);
  for (const col of expected11Cols) {
    assert.ok(docs29.includes(`\`${col}\``), `docs/29 missing GSI_Directory column '${col}'`);
  }

  // Evidence classification phrases explicitly present in docs/29
  for (const provenanceMarker of [
    'Evidencia observada en la consola',
    'Configuración comunicada por el operador',
    'Validaciones locales del código',
    'Consultas remotas automatizadas',
    '16391000000005003',
  ]) {
    assert.ok(docs29.includes(provenanceMarker), `docs/29 missing evidence differentiation '${provenanceMarker}'`);
  }
});
