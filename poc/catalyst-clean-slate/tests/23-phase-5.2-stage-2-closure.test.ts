/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.2, Stage 2 — Test Suite 23:
 * Documentary & Inventory Closure Tests for Stage 2 Execution in `Development`
 * (`Project-Rainfall`, `136967000000014024`, DC `US`).
 *
 * Verifies:
 * 1. Exact applied Catalyst Console settings (`Hosted Login`, `Public Signup: Disabled`,
 *    `Social Login` disabled, `Third-party Authentication` unconfigured, `Custom User Validation: Disabled`,
 *    `Authorized Domain: app.vigorcore.lat`, `CORS: Enabled`, `iFrame: Disabled`, `api.vigorcore.lat` excluded,
 *    `Production` unmodified).
 * 2. Direct visual empty-user evidence (`Manage Application Users` -> `Add your first user` -> `0` users,
 *    zero test accounts created, `Add User` not clicked).
 * 3. Strict differentiation between visual Console evidence and unexecuted automated CLI remote queries.
 * 4. All 7 mandatory `PENDING_LIVE_VERIFICATION` live integration items.
 * 5. Parity across `phase52Stage2Inventory.ts`, `docs/30`, `docs/31`, and `CatalystHostedAuthBridge.ts`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PHASE_5_2_STAGE_2_DEV_INVENTORY,
  validatePhase52Stage2Inventory,
} from '../src/provisioning/phase52Stage2Inventory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

test('Phase 5.2 Stage 2 Closure [PASS-UNIT] Reconciled Development auth inventory validates applied Console config, visual 0-user evidence & 7 pending live items', () => {
  const inv = PHASE_5_2_STAGE_2_DEV_INVENTORY;

  assert.equal(inv.projectName, 'Project-Rainfall');
  assert.equal(inv.catalystProjectId, '136967000000014024');
  assert.equal(inv.dataCenter, 'US');
  assert.equal(inv.accountsUrl, 'https://accounts.zoho.com');
  assert.equal(inv.catalystEnvironment, 'Development');
  assert.equal(inv.verdict, 'PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION');
  assert.equal(inv.productionModified, false);
  assert.equal(inv.remoteOperationsExecutedDuringClosure, 0);
  assert.equal(inv.automatedRemoteCliQueriesExecuted, false);

  assert.deepEqual(inv.appliedConsoleConfiguration, {
    nativeCatalystAuthenticationMode: 'Hosted Login',
    publicSignup: 'Disabled',
    socialLogin: 'all_disabled',
    thirdPartyAuthentication: 'unconfigured',
    customUserValidation: 'Disabled',
    authorizedDomain: 'app.vigorcore.lat',
    cors: 'Enabled',
    iframe: 'Disabled',
    apiDomainAddedToAuth: false,
    apiDomainExcluded: 'api.vigorcore.lat',
  });

  assert.deepEqual(inv.visualUserListEvidence, {
    consoleScreen: 'Manage Application Users',
    observedEmptyStateMessage: 'Add your first user',
    observedUsersCount: 0,
    testAccountsCreated: 0,
    addUserButtonClicked: false,
    evidenceOrigin: 'CONSOLE_VISUAL_OBSERVED_BY_OPERATOR',
  });

  const validation = validatePhase52Stage2Inventory(inv);
  assert.equal(validation.passed, true, `Unexpected Stage 2 mismatches: ${validation.mismatches.join('; ')}`);
  assert.equal(validation.pendingLiveCount, 7);
  assert.deepEqual(validation.mismatches, []);

  // Negative validations: modifying Production, non-zero users, or running CLI unexpectedly must fail
  const prodMutated = validatePhase52Stage2Inventory({
    ...inv,
    productionModified: true as unknown as false,
  });
  assert.equal(prodMutated.passed, false);

  const nonZeroUsers = validatePhase52Stage2Inventory({
    ...inv,
    visualUserListEvidence: {
      ...inv.visualUserListEvidence,
      observedUsersCount: 1 as unknown as 0,
    },
  });
  assert.equal(nonZeroUsers.passed, false);
});

test('Phase 5.2 Stage 2 Closure [PASS-STATIC] docs/30 and docs/31 completely record Stage 2 execution, visual evidence, bridge reconciliation & 7 PENDING_LIVE_VERIFICATION items', () => {
  const docs30Path = path.join(POC_ROOT, 'docs', '30-phase-5.2-stage-2-native-auth-runbook.md');
  const docs31Path = path.join(POC_ROOT, 'docs', '31-phase-5.2-stage-2-native-auth-closure.md');

  assert.equal(fs.existsSync(docs30Path), true, 'Missing docs/30');
  assert.equal(fs.existsSync(docs31Path), true, 'Missing docs/31-phase-5.2-stage-2-native-auth-closure.md');

  const docs30 = fs.readFileSync(docs30Path, 'utf8');
  const docs31 = fs.readFileSync(docs31Path, 'utf8');

  const requiredClosureMarkers = [
    'Project-Rainfall',
    '136967000000014024',
    'accounts.zoho.com',
    'Development',
    'PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION',
    'Hosted Login',
    'Public Signup',
    'Disabled',
    'Social Login',
    'Third-party Authentication',
    'Custom User Validation',
    'app.vigorcore.lat',
    'CORS',
    'Enabled',
    'iFrame',
    'api.vigorcore.lat',
    'Production',
    'Manage Application Users',
    'Add your first user',
    'Add User',
    'verify-clean-slate-provisioning.ts --live --confirm-readonly',
    'CatalystHostedAuthBridge.ts',
    '/auth/login',
    '/auth/callback',
    "generateAuthToken('functions')",
    '__Host-vigor_session',
    'X-Vigor-CSRF',
    'SPA history fallback',
    'Chromium',
    'Safari/WebKit',
    'API Gateway',
    'vigor_api',
    'PENDING_LIVE_VERIFICATION',
  ];

  for (const docContent of [docs30, docs31]) {
    for (const marker of requiredClosureMarkers) {
      assert.ok(docContent.includes(marker), `Document missing required Stage 2 closure marker '${marker}'`);
    }
    assert.equal(
      docContent.includes('PENDING-LIVE-VERIFICATION'),
      false,
      'Documents must use underscored PENDING_LIVE_VERIFICATION'
    );
  }

  // Ensure docs/31 contains explicit LIVE-01..LIVE-07 verification matrix rows
  for (const liveId of ['LIVE-01', 'LIVE-02', 'LIVE-03', 'LIVE-04', 'LIVE-05', 'LIVE-06', 'LIVE-07']) {
    assert.ok(docs31.includes(liveId), `docs/31 missing mandatory live verification item ${liveId}`);
  }

  // Ensure CatalystHostedAuthBridge.ts carries reconciled Stage 2 guards without violating tests/10 static isolation
  const bridgeSrc = fs.readFileSync(
    path.join(POC_ROOT, 'src/frontend/adapters/CatalystHostedAuthBridge.ts'),
    'utf8'
  );
  assert.ok(bridgeSrc.includes('NATIVE_HOSTED_AUTH_PROFILE'));
  assert.ok(bridgeSrc.includes('HOSTED_LOGIN_IFRAME_FORBIDDEN'));
  assert.ok(bridgeSrc.includes('INVALID_HOSTED_CALLBACK_PATH'));
  assert.equal(bridgeSrc.includes('vigorcore.lat'), false);
});
