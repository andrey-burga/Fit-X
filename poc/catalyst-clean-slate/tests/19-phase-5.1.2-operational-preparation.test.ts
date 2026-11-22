/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.1.2 — Test Suite 19:
 * Consolidated Operational Preparation Manifest, Exact 5-Table / 8-GSI Validation,
 * Conditional TTL Guardrails, 41/41 Route & Gateway Anomaly Detection, Exhaustive
 * Env Variable Audit (Zero Secret Leakage), and Mode-Separated CLI (`--mode apply` blocked).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import {
  auditEnvironmentVariableCoverage,
  buildConsolidatedProvisioningManifest,
  buildPhase512ClosureReport,
  buildPhase512OperationalPlan,
  CATALYST_RESOURCE_INVENTORY_BASELINE,
  detectRouteAndManifestAnomalies,
  EXHAUSTIVE_ENV_VAR_MATRIX,
  getFunctionDeploymentManifest,
  PROJECT_RAINFALL_RECONCILED_INVENTORY,
  validateConsolidatedProvisioningManifest,
} from '../src/provisioning/operationalPreparationManifest.js';
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';
import { TABLE_SCHEMA_REGISTRY, type TableSchemaSpec } from '../src/types/cleanSlate.js';
import {
  ApplyModeForbiddenError,
  runPreparationCli,
} from '../scripts/prepare-catalyst-phase-5.1.2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');

test('Phase 5.1.2 [PASS-UNIT] Consolidated provisioning manifest enforces exact 5 tables, 8 GSIs, ordered dependencies, and rejects 6th table or 9th GSI', () => {
  const manifest = buildConsolidatedProvisioningManifest();
  assert.equal(manifest.length, 5);
  assert.deepEqual(
    manifest.map(m => `${m.order}:${m.tableName}`),
    ['1:Users', '2:UserData', '3:AdminInvitations', '4:AuditLogs', '5:SystemControl']
  );

  const valid = validateConsolidatedProvisioningManifest(manifest);
  assert.equal(valid.passed, true);
  assert.equal(valid.tableCount, 5);
  assert.equal(valid.gsiCount, 8);
  assert.equal(valid.ttlRulesValid, true);
  assert.equal(valid.gsiDirectory11ColsValid, true);
  assert.deepEqual(valid.violations, []);

  // Negative 1: Inject forbidden 6th table -> MUST FAIL
  const withSixthTable: Record<string, TableSchemaSpec> = {
    ...TABLE_SCHEMA_REGISTRY,
    ExtraSixthTable: {
      tableName: 'Users',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: null,
      additionalSortKeys: [],
      secondaryIndexes: [],
    },
  };
  const sixthRes = validateConsolidatedProvisioningManifest(manifest, withSixthTable);
  assert.equal(sixthRes.passed, false);
  assert.equal(sixthRes.tableCount, 6);

  // Negative 2: Inject forbidden 9th GSI -> MUST FAIL
  const withNinthGsi: Record<string, TableSchemaSpec> = {
    ...TABLE_SCHEMA_REGISTRY,
    SystemControl: {
      ...TABLE_SCHEMA_REGISTRY.SystemControl,
      secondaryIndexes: [
        {
          indexName: 'GSI_IllegalNinth',
          partitionKey: 'status',
          partitionKeyType: 'String',
          projection: 'ALL',
          isUniqueConstraint: false,
        },
      ],
    },
  };
  const ninthRes = validateConsolidatedProvisioningManifest(manifest, withNinthGsi);
  assert.equal(ninthRes.passed, false);
  assert.equal(ninthRes.gsiCount, 9);
  assert.ok(ninthRes.violations.some(v => v.includes('8 GSIs')));
});

test('Phase 5.1.2 [PASS-UNIT] TTL manifest rules permit ttlEpochSec (Number) strictly on AdminInvitations & SystemControl transient items only', () => {
  const manifest = buildConsolidatedProvisioningManifest();
  const sysStep = manifest.find(m => m.tableName === 'SystemControl')!;
  assert.equal(sysStep.ttlConfig.enabled, true);
  assert.equal(sysStep.ttlConfig.attributeName, 'ttlEpochSec');
  assert.equal(sysStep.ttlConfig.attributeType, 'Number');
  assert.deepEqual(sysStep.ttlConfig.allowedItemKeyPatterns, ['CTRL#SAGA#<idempotencyKey>', 'SESSION#<sid>']);
  assert.deepEqual(sysStep.ttlConfig.prohibitedItemKeyPatterns, ['CTRL#BOOTSTRAP', 'CTRL#SUPERADMIN_COUNT']);

  // Negative: Enable TTL on AuditLogs (must stay strictly disabled / append-only)
  const badAuditTtl: Record<string, TableSchemaSpec> = {
    ...TABLE_SCHEMA_REGISTRY,
    AuditLogs: {
      ...TABLE_SCHEMA_REGISTRY.AuditLogs,
      ttlAttribute: { name: 'ttlEpochSec', type: 'Number' },
    },
  };
  const res = validateConsolidatedProvisioningManifest(manifest, badAuditTtl);
  assert.equal(res.passed, false);
  assert.equal(res.ttlRulesValid, false);
  assert.ok(res.violations.some(v => v.includes('AuditLogs') && v.includes('TTL')));
});

test('Phase 5.1.2 [PASS-UNIT] Anomaly detector validates 41/41 routes, zero orphans, zero collisions, and flags injected duplicate method+path', () => {
  const cleanReport = detectRouteAndManifestAnomalies();
  assert.equal(cleanReport.passed, true);
  assert.equal(cleanReport.totalCanonicalRoutes, 41);
  assert.equal(cleanReport.mappedSchemaRoutes, 41);
  assert.equal(cleanReport.gatewayAuthMatrixRoutes, 41);
  assert.equal(cleanReport.gatewayRewriteMatchedRoutes, 41);
  assert.equal(cleanReport.anomalyCount, 0);
  assert.deepEqual(cleanReport.orphanRouteIds, []);
  assert.deepEqual(cleanReport.unmappedRouteIds, []);
  assert.deepEqual(cleanReport.duplicateMethodPathCollisions, []);
  assert.deepEqual(cleanReport.uninventoriedEnvVarsReadInCode, []);

  // Negative: Inject collision duplicate route
  const collidingRoutes = [
    ...ROUTE_CONTRACT_SPECS,
    {
      ...ROUTE_CONTRACT_SPECS[0],
      id: 'auth.session.duplicateCollision',
    },
  ];
  const badReport = detectRouteAndManifestAnomalies(collidingRoutes);
  assert.equal(badReport.passed, false);
  assert.ok(badReport.duplicateMethodPathCollisions.length >= 1);
  assert.ok(badReport.unmappedRouteIds.includes('auth.session.duplicateCollision'));
});

test('Phase 5.1.2 [PASS-UNIT] Exhaustive env matrix covers every catalog + codebase var, keeps hosted_native free of CATALYST_ADMIN_*, and masks secrets', () => {
  const coverage = auditEnvironmentVariableCoverage();
  assert.equal(coverage.passed, true);
  assert.deepEqual(coverage.missingFromExhaustiveMatrix, []);
  assert.equal(coverage.hostedNativeRequiresExternalOAuthSecrets, false);
  assert.equal(coverage.allSecretsHaveRedactedOrMarker, true);

  for (const adminVar of ['CATALYST_ADMIN_CLIENT_ID', 'CATALYST_ADMIN_CLIENT_SECRET', 'CATALYST_ADMIN_REFRESH_TOKEN']) {
    const entry = EXHAUSTIVE_ENV_VAR_MATRIX.find(e => e.name === adminVar)!;
    assert.equal(entry.hostedNativeAdvancedIo, 'OPTIONAL');
    assert.equal(entry.externalOAuthAdvancedIo, 'REQUIRED');
    assert.equal(entry.cliReadOnlyLive, 'REQUIRED');
  }
});

test('Phase 5.1.2 [PASS-UNIT] Function deployment manifest, non-applied plan, resource inventory classification & tsconfig.server.json parity', () => {
  const fnManifest = getFunctionDeploymentManifest();
  assert.equal(fnManifest.functionName, 'vigor_api');
  assert.equal(fnManifest.type, 'advancedio');
  assert.equal(fnManifest.runtime, 'node22');
  assert.equal(fnManifest.entrypoint, 'dist/server/catalystEntry.js');
  assert.equal(fnManifest.canonicalApiRoutesCount, 41);

  const tsconfigServerPath = path.join(POC_ROOT, 'tsconfig.server.json');
  assert.equal(fs.existsSync(tsconfigServerPath), true);
  const tsconfigServer = JSON.parse(fs.readFileSync(tsconfigServerPath, 'utf8'));
  assert.equal(tsconfigServer.compilerOptions.noEmit, false);
  assert.equal(tsconfigServer.compilerOptions.outDir, './dist');

  const plan = buildPhase512OperationalPlan();
  assert.equal(plan.phase, '5.1.2');
  assert.equal(plan.applied, false);
  assert.equal(plan.phase52Authorized, false);
  assert.equal(plan.networkCallsExecuted, 0);
  assert.equal(plan.writeOperationsExecuted, 0);
  assert.equal(plan.inventorySummary.verifiedRemotelyCount, 0);
  assert.ok(plan.inventorySummary.localDocumentationOnlyCount >= 2);
  assert.ok(plan.inventorySummary.unprovableWithoutRemoteAccessCount >= 7);
  assert.ok(CATALYST_RESOURCE_INVENTORY_BASELINE.some(i => i.verificationTag === 'NO COMPROBABLE SIN ACCESO REMOTO'));
  assert.equal(plan.gatewayGlobalImpactAudit.applied, false);
  assert.equal(plan.gatewayGlobalImpactAudit.rollbackPlan.command, 'catalyst apig:disable');
  assert.ok(plan.recoveryActions.length >= 4);
});

test('Phase 5.1.2 [PASS-UNIT] Preparation CLI executes inspect/preflight/plan offline cleanly without leaking secrets and HARD-BLOCKS --mode apply', async () => {
  const hmacSecret = ServerSessionTokenManager.generateStrongSecret(32);
  const hostedEnv: Record<string, string> = {
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'platform_managed',
    VIGORCORE_CATALYST_PROJECT_ID: 'proj_prep_512',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: hmacSecret,
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };

  // 1. --mode inspect
  const inspectRes = await runPreparationCli(['--mode', 'inspect'], {});
  assert.equal(inspectRes.phase, '5.1.2');
  assert.equal(inspectRes.mode, 'inspect');
  assert.equal(inspectRes.applied, false);
  assert.equal(inspectRes.networkCallsExecuted, 0);
  assert.equal(inspectRes.writeOperationsExecuted, 0);

  // 2. --mode preflight (hosted_native without external OAuth secrets)
  const preflightPass = await runPreparationCli(['--mode', 'preflight', '--auth-mode', 'hosted_native'], hostedEnv);
  assert.equal(preflightPass.verdict, 'PASS');
  assert.equal(preflightPass.applied, false);
  assert.equal(preflightPass.networkCallsExecuted, 0);
  assert.equal(preflightPass.writeOperationsExecuted, 0);
  assert.equal(JSON.stringify(preflightPass).includes(hmacSecret), false, 'Secret leaked in CLI preflight report!');

  // 3. --mode preflight fails cleanly when ZC_SECURE=override
  const preflightBad = await runPreparationCli(
    ['--mode', 'preflight', '--auth-mode', 'hosted_native'],
    { ...hostedEnv, ZC_SECURE: 'override' }
  );
  assert.equal(preflightBad.verdict, 'FAIL');

  // 4. --mode plan
  const planRes = await runPreparationCli(['--mode', 'plan'], {});
  assert.equal(planRes.verdict, 'PLAN_READY_NON_APPLIED');
  assert.equal(planRes.applied, false);
  assert.equal(planRes.networkCallsExecuted, 0);
  assert.equal(planRes.writeOperationsExecuted, 0);

  // 5. --mode apply & --apply MUST ALWAYS FAIL CLOSED
  await assert.rejects(
    () => runPreparationCli(['--mode', 'apply'], hostedEnv),
    (err: unknown) =>
      err instanceof ApplyModeForbiddenError &&
      err.code === 'PHASE_5_1_2_APPLY_FORBIDDEN' &&
      err.applied === false &&
      err.writeOperationsExecuted === 0
  );
  await assert.rejects(
    () => runPreparationCli(['--apply'], hostedEnv),
    (err: unknown) => err instanceof ApplyModeForbiddenError && err.code === 'PHASE_5_1_2_APPLY_FORBIDDEN'
  );
});

test('Phase 5.1.2 [PASS-STATIC] Windows PowerShell 5.1 read-only inventory script & docs/26 enforce allowlist, zero &&/||, zero secret exposure, and valid status taxonomy', () => {
  const ps1Path = path.join(POC_ROOT, 'scripts', 'phase-5.1.2-readonly-inventory.ps1');
  const docs25Path = path.join(POC_ROOT, 'docs', '25-phase-5.1.2-operational-preparation-pack.md');
  const docs26Path = path.join(POC_ROOT, 'docs', '26-phase-5.1.2-readonly-remote-inventory.md');
  const manifestPath = path.join(POC_ROOT, 'src', 'provisioning', 'operationalPreparationManifest.ts');

  assert.equal(fs.existsSync(ps1Path), true, 'Missing scripts/phase-5.1.2-readonly-inventory.ps1');
  assert.equal(fs.existsSync(docs26Path), true, 'Missing docs/26-phase-5.1.2-readonly-remote-inventory.md');

  const ps1 = fs.readFileSync(ps1Path, 'utf8');
  // Strict Windows PowerShell 5.1 discipline: zero && or || pipeline chaining operators
  assert.equal(ps1.includes('&&'), false, 'PowerShell 5.1 script must NOT contain && operator');
  assert.equal(ps1.includes('||'), false, 'PowerShell 5.1 script must NOT contain || operator');

  // Strict non-destructive CLI check & DNS read-only check
  assert.ok(ps1.includes('Get-Command catalyst -ErrorAction SilentlyContinue'));
  assert.ok(ps1.includes('Resolve-DnsName'));
  assert.ok(ps1.includes('api.vigorcore.lat'));
  assert.ok(ps1.includes('app.vigorcore.lat'));
  assert.ok(ps1.includes('ALLOWED_READONLY_COMMAND_VIOLATION'));
  assert.ok(ps1.includes("$script:AllowedCatalystCommands = @('--version', 'whoami', 'project:list')"));

  // Never read secret env vars in PowerShell script and never use dynamic execution
  assert.equal(/\$env:(CATALYST_ADMIN_|CATALYST_PROJECT_KEY|VIGOR_SESSION_HMAC_SECRET|ZC_)/i.test(ps1), false);
  assert.equal(/\b(Invoke-Expression|iex|Start-Process|cmd\.exe|ScriptBlock::Create)\b/i.test(ps1), false, 'PS1 must never use Invoke-Expression or dynamic command execution');

  // Verify literal switch allowlist dispatch, sanitization helpers, BOM-free UTF-8 writer, and Secciones 4.A-4.G alignment
  assert.ok(ps1.includes('switch ($SubCommand)'));
  assert.ok(ps1.includes('Get-RedactedWhoamiSummary'));
  assert.ok(ps1.includes('Write-Utf8NoBomFile'));
  assert.ok(ps1.includes('UTF8Encoding($false)'));
  assert.ok(ps1.includes('Protect-SensitiveText'));
  assert.ok(ps1.includes('\\x1B\\['));
  assert.ok(ps1.includes('Secciones 4.A-4.G'));
  assert.equal(ps1.includes('Secciones 5.A-5.G'), false, 'PS1 should reference Secciones 4.A-4.G, not 5.A-5.G');
  assert.ok(ps1.trimEnd().endsWith('exit 0'));

  // Required forbidden subcommands guarded explicitly in $script:ForbiddenCatalystCommands
  for (const forbidden of ['config:list', 'config:get', 'pull', 'deploy', 'apig:enable', 'apig:disable', 'ds:import', 'project:use', 'project:reset', 'org:list']) {
    assert.ok(ps1.includes(`'${forbidden}'`), `PS1 forbidden command list missing '${forbidden}'`);
  }

  // Required 6-state matrix enum presence
  for (const st of ['VERIFIED_REMOTE', 'VERIFIED_LOCAL_ONLY', 'NOT_ACCESSIBLE', 'NOT_CONFIGURED', 'AMBIGUOUS', 'PENDING_OPERATOR']) {
    assert.ok(ps1.includes(st), `PS1 missing status taxonomy label ${st}`);
  }

  // Verify org:list is NOT recommended anywhere in manifest or docs/25
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const docs25Content = fs.readFileSync(docs25Path, 'utf8');
  assert.equal(manifestContent.includes('org:list'), false, 'Manifest must not assume catalyst org:list');
  assert.equal(docs25Content.includes('org:list'), false, 'docs/25 must not assume catalyst org:list');

  // Verify docs/26 completeness
  const docs26 = fs.readFileSync(docs26Path, 'utf8');
  for (const marker of [
    'PREPARATION_PARTIAL',
    'Get-Command catalyst -ErrorAction SilentlyContinue',
    'Resolve-DnsName',
    'VERIFIED_REMOTE',
    'VERIFIED_LOCAL_ONLY',
    'NOT_ACCESSIBLE',
    'NOT_CONFIGURED',
    'AMBIGUOUS',
    'PENDING_OPERATOR',
    'A. Proyecto y organización',
    'B. Aplicaciones y funciones',
    'C. API Gateway',
    'D. Seguridad',
    'E. NoSQL',
    'F. Authentication',
    'G. Dominios',
    'verify-clean-slate-provisioning.ts --live --confirm-readonly',
  ]) {
    assert.ok(docs26.includes(marker), `docs/26 missing required section/marker: ${marker}`);
  }
});

test('Phase 5.1.2 [PASS-UNIT] Reconciled Project-Rainfall (136967000000014024) closure separates Auth evidence vs inference, external_oauth CLI vs hosted_native, Security Rules scope & domain gate', async () => {
  const closure = buildPhase512ClosureReport();
  assert.equal(closure.projectObservedName, 'Project-Rainfall');
  assert.equal(closure.projectObservedId, '136967000000014024');
  assert.equal(closure.applied, false);
  assert.equal(closure.remoteOperationsExecutedInThisStep, 0);
  assert.equal(closure.phase52Executed, false);
  assert.equal(closure.closureVerdict, 'PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2');
  assert.equal(closure.apiDomainCutoverGate, 'BLOCKED_PENDING_ZOHO_CLARIFICATION');

  // Point 1: Confirmed public Project ID passes preflight placeholder validation cleanly
  const preflightWithConfirmedProject = await runPreparationCli(
    ['--mode', 'preflight', '--auth-mode', 'hosted_native'],
    {
      VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
      VIGOR_CORS_MODE: 'platform_managed',
      VIGORCORE_CATALYST_PROJECT_ID: closure.projectObservedId,
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      VIGOR_ENVIRONMENT: 'development',
      VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
      VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: ServerSessionTokenManager.generateStrongSecret(32),
      VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
    }
  );
  assert.equal(preflightWithConfirmedProject.verdict, 'PASS');

  // Point 2: Auth Set Up evidence is separated from unverified user count inference
  assert.equal(closure.authEvidenceVsInference.userCountVerificationStatus, 'NOT_DIRECTLY_INSPECTED');

  // Point 3: --auth-mode external_oauth in verifier CLI is strictly operator admin read-only and does NOT alter hosted_native app mode
  assert.equal(closure.cliExternalOauthVsAppHostedNative.verifierCliAuthMode, 'external_oauth');
  assert.equal(closure.cliExternalOauthVsAppHostedNative.altersAppAuthMode, false);
  assert.equal(closure.cliExternalOauthVsAppHostedNative.applicationHostedRuntimeMode, 'hosted_native');

  // Point 4: Security Rules zero risk bounded strictly to legacy functions; vigor_api protections stay mandatory
  assert.equal(closure.securityRulesImpactScope.legacyFunctionsExposureRisk, 'ZERO_VERIFIED_LEGACY_FUNCTIONS');
  assert.equal(closure.securityRulesImpactScope.globalImpactOnFutureVigorApi, 'NON_ZERO_REQUIRES_FULL_GATEWAY_AND_APP_CONTROLS');
  assert.ok(closure.securityRulesImpactScope.mandatoryVigorApiProtections.length >= 4);

  assert.equal(PROJECT_RAINFALL_RECONCILED_INVENTORY.length, 11);
  assert.equal(closure.domainMappingDifferentiation.webClientDomainMapping.applicableToVigorCoreApi, false);
  assert.equal(closure.domainMappingDifferentiation.apiGatewayAdvancedIoCustomDomain.zohoClarificationRequired, true);
  assert.ok(closure.domainMappingDifferentiation.apiGatewayAdvancedIoCustomDomain.openClarificationQuestions.length >= 3);

  assert.deepEqual(
    closure.nextPhaseExecutionSequence.map(s => s.stageId),
    [
      'STAGE_1_NOSQL_TABLES',
      'STAGE_2_CATALYST_AUTH',
      'STAGE_3_FUNCTION_VIGOR_API',
      'STAGE_4_API_GATEWAY',
      'STAGE_5_DOMAIN_API_VIGORCORE',
    ]
  );
  assert.equal(closure.nextPhaseExecutionSequence[0].blockedByZohoClarification, false);
  assert.equal(closure.nextPhaseExecutionSequence[4].blockedByZohoClarification, true);
  for (const stage of closure.nextPhaseExecutionSequence) {
    assert.equal(stage.applied, false);
    assert.ok(stage.costAndQuotaConsiderations.length >= 1);
    assert.ok(stage.prerequisitesBeforeRemoteWrite.length >= 1);
    assert.ok(stage.postOperationVerifications.length >= 1);
  }

  const docs27Path = path.join(POC_ROOT, 'docs', '27-phase-5.1.2-closure-and-phase-5.2-plan.md');
  assert.equal(fs.existsSync(docs27Path), true, 'Missing docs/27-phase-5.1.2-closure-and-phase-5.2-plan.md');
  const docs27 = fs.readFileSync(docs27Path, 'utf8');
  for (const marker of [
    'Project-Rainfall',
    '136967000000014024',
    'NOT_DIRECTLY_INSPECTED',
    'external_oauth',
    'hosted_native',
    'PHASE_5_1_2_CLOSED_READY_FOR_PHASE_5_2',
    'BLOCKED_PENDING_ZOHO_CLARIFICATION',
    'Web Client Hosting',
    'API Gateway',
    'app.vigorcore.lat',
    'api.vigorcore.lat',
    'Etapa 1',
    'Etapa 5',
  ]) {
    assert.ok(docs27.includes(marker), `docs/27 missing required marker: ${marker}`);
  }
});
