/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.2 (Development First) — Test Suite 20:
 * Verifies 1:1 schema & manifest parity of docs/28-phase-5.2-development-first-runbook.md,
 * environment separation (Development -> Production), verify-clean-slate-provisioning.ts
 * preflight/external_oauth/CATALYST_PROJECT_KEY contracts, Hosted vs Embedded Native Auth
 * SDK grounding, direct Authentication -> Users verification, and Windows PowerShell 5.1 safety.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApplyModeForbiddenError, runPreparationCli } from '../scripts/prepare-catalyst-phase-5.1.2.js';
import { runVerifierCli } from '../scripts/verify-clean-slate-provisioning.js';
import {
  buildConsolidatedProvisioningManifest,
  validateConsolidatedProvisioningManifest,
} from '../src/provisioning/operationalPreparationManifest.js';
import { TABLE_SCHEMA_REGISTRY } from '../src/types/cleanSlate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

function extractFencedBlocks(markdown: string, lang: string): string[] {
  const blocks: string[] = [];
  const regex = new RegExp(`\`\`\`${lang}\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

test('Phase 5.2 [PASS-STATIC] docs/28 maintains exact 1:1 parity with frozen 5-table / 8-GSI schema, 11 GSI_Directory columns & TTL rules', () => {
  const docs28Path = path.join(POC_ROOT, 'docs', '28-phase-5.2-development-first-runbook.md');
  assert.equal(fs.existsSync(docs28Path), true, 'Missing docs/28-phase-5.2-development-first-runbook.md');

  const docs28 = fs.readFileSync(docs28Path, 'utf8');
  const manifest = buildConsolidatedProvisioningManifest();
  const validation = validateConsolidatedProvisioningManifest(manifest);
  assert.equal(validation.passed, true);
  assert.equal(manifest.length, 5);

  // Every table name, PK, SK, additional SKs, and GSIs from TABLE_SCHEMA_REGISTRY must appear accurately
  const allGsiNames: string[] = [];
  for (const spec of Object.values(TABLE_SCHEMA_REGISTRY)) {
    assert.ok(docs28.includes(spec.tableName), `docs/28 missing tableName '${spec.tableName}'`);
    assert.ok(docs28.includes(`\`${spec.partitionKey}\``), `docs/28 missing PK '${spec.partitionKey}' for ${spec.tableName}`);
    if (spec.sortKey) {
      assert.ok(docs28.includes(`\`${spec.sortKey}\``), `docs/28 missing SK '${spec.sortKey}' for ${spec.tableName}`);
    }
    for (const addSk of spec.additionalSortKeys) {
      assert.ok(docs28.includes(`\`${addSk.name}\``), `docs/28 missing additional SK '${addSk.name}' for ${spec.tableName}`);
    }
    for (const idx of spec.secondaryIndexes) {
      allGsiNames.push(idx.indexName);
      assert.ok(docs28.includes(idx.indexName), `docs/28 missing GSI '${idx.indexName}'`);
      assert.ok(docs28.includes(`\`${idx.partitionKey}\``), `docs/28 missing GSI PK '${idx.partitionKey}'`);
      if (idx.sortKey) {
        assert.ok(docs28.includes(`\`${idx.sortKey}\``), `docs/28 missing GSI SK '${idx.sortKey}'`);
      }
    }
  }
  assert.equal(allGsiNames.length, 8);

  // Exact 11 columns of Users.GSI_Directory
  const gsiDir = TABLE_SCHEMA_REGISTRY.Users.secondaryIndexes.find(i => i.indexName === 'GSI_Directory')!;
  assert.equal(gsiDir.projectedAttributes?.length, 11);
  for (const col of gsiDir.projectedAttributes!) {
    assert.ok(docs28.includes(`\`${col}\``), `docs/28 missing GSI_Directory projected attribute '${col}'`);
  }

  // Exact TTL rules & prohibited SystemControl control keys
  for (const marker of [
    'ttlEpochSec',
    'Number',
    'CTRL#BOOTSTRAP',
    'CTRL#SUPERADMIN_COUNT',
    'CTRL#SAGA#<idempotencyKey>',
    'SESSION#<sid>',
  ]) {
    assert.ok(docs28.includes(marker), `docs/28 missing TTL/control key marker '${marker}'`);
  }
});

test('Phase 5.2 [PASS-STATIC] docs/28 covers Project-Rainfall, Development->Production, CLI external_oauth/PROJECT_KEY audit, Hosted vs Embedded Auth & PowerShell 5.1 safety', () => {
  const docs28Path = path.join(POC_ROOT, 'docs', '28-phase-5.2-development-first-runbook.md');
  const docs28 = fs.readFileSync(docs28Path, 'utf8');

  const requiredMarkers = [
    'Project-Rainfall',
    '136967000000014024',
    'accounts.zoho.com',
    'https://api.catalyst.zoho.com',
    'PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2',
    'PHASE_5_2_RUNBOOK_READY_NOT_EXECUTED',
    'BLOCKED_PENDING_ZOHO_CLARIFICATION',
    'Development',
    'Production',
    'ENVIRONMENT_SEPARATION_VIOLATION',
    '--auth-mode external_oauth',
    'HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO',
    'VIGOR_CATALYST_AUTH_MODE=hosted_native',
    'CATALYST_PROJECT_KEY',
    'addDefaultAppHeaders()',
    'PROJECT_ID',
    'Hosted Login',
    'Embedded Login',
    'hostedSignIn',
    'iam_iframe',
    'generateAuthToken',
    '__Host-vigor_session',
    'Third-party Authentication',
    'Authentication → Users',
    'PASS_READONLY_CLEAN_SLATE',
    'FAIL_SCHEMA_MISMATCH',
    'FAIL_NON_EMPTY_STATE',
  ];

  for (const marker of requiredMarkers) {
    assert.ok(docs28.includes(marker), `docs/28 missing required Phase 5.2 operational marker: ${marker}`);
  }

  // PowerShell 5.1 blocks must have ZERO && or || operators and ZERO real credential leakage
  const psBlocks = extractFencedBlocks(docs28, 'powershell');
  assert.ok(psBlocks.length >= 3, 'Expected >= 3 PowerShell 5.1 code blocks in docs/28');
  for (const block of psBlocks) {
    assert.equal(block.includes('&&'), false, 'PowerShell 5.1 block must NOT contain &&');
    assert.equal(block.includes('||'), false, 'PowerShell 5.1 block must NOT contain ||');
    assert.equal(/1000\.[a-f0-9]{16,}/i.test(block), false, 'PowerShell block must NOT contain real Zoho OAuth token');
  }
});

test('Phase 5.2 [PASS-UNIT] verify-clean-slate-provisioning.ts runs offline & Project-Rainfall preflight cleanly with redacted secrets and blocks unsafe live flags', async () => {
  // 1. Offline self-check (0 network calls, 0 writes)
  const selfCheck = await runVerifierCli([], {});
  assert.equal(selfCheck.verdict, 'PASS_SELF_CHECK');
  assert.equal(selfCheck.mode, 'OFFLINE_SELF_CHECK');
  assert.equal(selfCheck.writeOperationsExecuted, 0);

  // 2. Local preflight for Project-Rainfall (Development, US, CLI external_oauth with CATALYST_PROJECT_KEY + ephemeral read-only token)
  const syntheticProjectKey = 'synthetic-test-project-key-9876543210';
  const syntheticEphemeralToken = 'synthetic-test-ephemeral-token-1234567890';
  const preflightReport = await runVerifierCli(
    [
      '--preflight',
      '--auth-mode',
      'external_oauth',
      '--expected-project',
      '136967000000014024',
      '--expected-region',
      'us',
    ],
    {
      VIGOR_CATALYST_AUTH_MODE: 'external_oauth',
      VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
      CATALYST_PROJECT_KEY: syntheticProjectKey,
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      CATALYST_ADMIN_ACCESS_TOKEN: syntheticEphemeralToken,
    }
  );

  assert.equal(preflightReport.verdict, 'PASS');
  assert.equal('networkCallsExecuted' in preflightReport && preflightReport.networkCallsExecuted, 0);
  const serialized = JSON.stringify(preflightReport);
  assert.equal(serialized.includes(syntheticProjectKey), false, 'Project key leaked in preflight JSON');
  assert.equal(serialized.includes(syntheticEphemeralToken), false, 'Access token leaked in preflight JSON');
  assert.ok(serialized.includes('[REDACTED:len='), 'Expected secret redaction marker in preflight JSON');

  // 3. Running --live --confirm-readonly with hosted_native MUST fail closed locally
  await assert.rejects(
    () =>
      runVerifierCli(
        ['--live', '--confirm-readonly', '--auth-mode', 'hosted_native'],
        {
          VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
          VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
        }
      ),
    (err: unknown) => err instanceof Error && err.message.includes('HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO')
  );

  // 4. Preparation CLI --mode apply stays hard-blocked (zero remote writes)
  await assert.rejects(
    () => runPreparationCli(['--mode', 'apply'], {}),
    (err: unknown) => err instanceof ApplyModeForbiddenError && err.writeOperationsExecuted === 0
  );
});
