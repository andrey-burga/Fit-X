/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.3 Declarative Preparation Manifest for `vigor_api` (Development First)
 *
 * Strictly zero-network, zero-mutation registry & parity validator:
 * - Reconciles inherited closed baselines:
 *   - Phase 5.2 Stage 1 (`PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED`)
 *   - Phase 5.2 Stage 2 (`PHASE_5_2_STAGE_2_NATIVE_AUTH_CONFIGURED_PENDING_LIVE_VERIFICATION`)
 * - Captures backend audit findings, 41/41 route + API Gateway matrix, runtime dependencies,
 *   packaging inventory, env var policy (`hosted_native`), security invariants, and STOP/rollback gates.
 * - Keeps `api.vigorcore.lat` at `BLOCKED_PENDING_ZOHO_CLARIFICATION` and API Gateway disabled.
 * - Executes ZERO remote operations; emits verdict `PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED`.
 */

import { ROUTE_CONTRACT_SPECS, type RouteContractSpec } from '../routes/routeContracts.js';
import {
  buildRouteGatewayAuthMatrix,
  type RouteGatewayAuthSpec,
} from './domainGatewayConfigs.js';
import {
  CODEBASE_REFERENCED_ENV_VARS,
  EXHAUSTIVE_ENV_VAR_MATRIX,
  getFunctionDeploymentManifest,
} from './operationalPreparationManifest.js';
import {
  PHASE_5_2_STAGE_1_DEV_INVENTORY,
  validatePhase52Stage1Inventory,
} from './phase52Stage1Inventory.js';
import {
  PHASE_5_2_STAGE_2_DEV_INVENTORY,
  validatePhase52Stage2Inventory,
} from './phase52Stage2Inventory.js';

export interface Phase53AuditFinding {
  readonly id: string;
  readonly area: string;
  readonly severity: 'CRITICAL_BEFORE_DEPLOY' | 'LIVE_VERIFY_REQUIRED' | 'VERIFIED_LOCAL';
  readonly sourceRef: string;
  readonly finding: string;
  readonly disposition: string;
}

export interface Phase53VigorApiRouteInventoryItem {
  readonly index: number;
  readonly routeId: string;
  readonly method: RouteContractSpec['method'];
  readonly canonicalPath: string;
  readonly auth: RouteContractSpec['auth'];
  readonly authPolicy: RouteContractSpec['authPolicy'];
  readonly csrfPolicy: RouteContractSpec['csrfPolicy'];
  readonly requiresCsrf: boolean;
  readonly requiresCatalystLiveCheck: boolean;
  readonly allowedRoles: readonly string[];
  readonly gatewayPathPattern: string;
  readonly targetPathPattern: string;
  readonly recommendedGatewayAuth: RouteGatewayAuthSpec['recommendedGatewayAuth'];
}

export const PHASE_5_3_RUNTIME_DEPENDENCIES = [
  '@zcatalyst/auth',
  '@zcatalyst/auth-admin',
  '@zcatalyst/nosql',
  '@zcatalyst/transport',
  '@zcatalyst/utils',
  'express',
] as const;

export const PHASE_5_3_EXCLUDED_DEV_DEPENDENCIES = [
  '@types/express',
  '@types/node',
  'playwright-core',
  'tsx',
  'typescript',
] as const;

export const PHASE_5_3_BACKEND_AUDIT_FINDINGS: readonly Phase53AuditFinding[] = [
  {
    id: 'AUD-53-01',
    area: 'Entrypoint & Package Manifest',
    severity: 'CRITICAL_BEFORE_DEPLOY',
    sourceRef: 'poc/catalyst-clean-slate/package.json + tsconfig.server.json + src/server/catalystEntry.ts',
    finding:
      'Root POC `package.json` uses `"type": "module"` and compiles `dist/server/catalystEntry.js` (`export default catalystAdvancedIoEntry`), but omits `"main"` and mixes frontend/test `devDependencies` (`playwright-core`, `tsx`, `typescript`, `@types/*`).',
    disposition:
      'Prepare isolated staging bundle with compiled `dist/`, runtime-only `package.json` (`"main": "dist/server/catalystEntry.js"`, `"type": "module"`), prod `dependencies` only, and `catalyst-config.json`; verify Node 22 ESM Advanced I/O loader live (`PENDING_LIVE_VERIFICATION`).',
  },
  {
    id: 'AUD-53-02',
    area: 'CORS Access-Control-Allow-Headers vs Authorization',
    severity: 'LIVE_VERIFY_REQUIRED',
    sourceRef: 'poc/catalyst-clean-slate/src/security/httpSecurityPolicy.ts:149-160',
    finding:
      'Under `VIGOR_CORS_MODE=express_enforced`, `Access-Control-Allow-Headers` emits `Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With` (without `Authorization`). Under recommended `VIGOR_CORS_MODE=platform_managed`, Express omits `Access-Control-*` and relies on CloudScale Whitelisting > Authorized Domains.',
    disposition:
      'Keep `VIGOR_CORS_MODE=platform_managed` as primary target and verify `Authorization` + `X-Vigor-CSRF` + `Cookie` + `Set-Cookie` passthrough on live Gateway/CloudScale (`PENDING_LIVE_VERIFICATION`).',
  },
  {
    id: 'AUD-53-03',
    area: 'NoSQL Logical Name vs Physical Table ID Resolution',
    severity: 'LIVE_VERIFY_REQUIRED',
    sourceRef: 'poc/catalyst-clean-slate/src/nosql/providers/baseTableProvider.ts:34-46',
    finding:
      '`createCatalystLiveNoSQLAdapter` supports an optional `tableIdResolver`, but `advancedIoApp.ts` calls `createTableProviders(() => hostedRuntime!.getActiveRequestNoSQLClient())` passing table names (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`).',
    disposition:
      'Verify live against `Project-Rainfall` (`Development`) whether `@zcatalyst/nosql` resolves table names directly or requires binding the 5 confirmed Table IDs via `tableIdResolver` (`PENDING_LIVE_VERIFICATION`).',
  },
  {
    id: 'AUD-53-04',
    area: 'Hosted Native Admin Context & No Silent external_oauth Fallback',
    severity: 'VERIFIED_LOCAL',
    sourceRef: 'poc/catalyst-clean-slate/src/sdk/catalystSdkBridge.ts:907-1076',
    finding:
      '`HostedNativeCatalystAuthRuntime` isolates per-request `AsyncLocalStorage`, forces fresh `new ZCAuth().init(..., { type: "advancedio", scope: "admin" | "user" })`, pins `projectId`/`environment`/`apiDomain`, blocks `x-zc-user-type: admin`, and fails closed with `503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE` if `x-zc-admin-cred-token` is missing.',
    disposition:
      'Keep `VIGOR_CATALYST_AUTH_MODE=hosted_native` mandatory; DO NOT enable `external_oauth` fallback in Catalyst unless live Gateway proof + independent operator authorization occur.',
  },
  {
    id: 'AUD-53-05',
    area: 'Preflight OPTIONS & Unauthenticated Health Bypass',
    severity: 'VERIFIED_LOCAL',
    sourceRef: 'poc/catalyst-clean-slate/src/server/advancedIoApp.ts:238-317',
    finding:
      '`GET /health` and `GET /api/v1/health` respond before `wrapDispatch` (no secrets exposed); `OPTIONS` skips `deps.wrapDispatch` so preflight evaluates `HttpSecurityPolicy` cleanly without admin headers.',
    disposition:
      'Preserved as verified locally in loopback tests; live Catalyst edge passthrough stays `PENDING_LIVE_VERIFICATION`.',
  },
  {
    id: 'AUD-53-06',
    area: 'Offline Superadmin Bootstrap & Fail-Closed Admin Guards',
    severity: 'VERIFIED_LOCAL',
    sourceRef: 'poc/catalyst-clean-slate/src/services/adminGovernanceService.ts + routes/apiRouterSchema.ts',
    finding:
      'Zero HTTP route exists for superadmin bootstrap (`404`/`403`); `liveAtomicityVerifiedForSuperadminMutations` defaults to `false` (`403 SUPERADMIN_MUTATION_DISABLED_UNTIL_LIVE_ATOMICITY_VERIFIED`); password reset stays fail-closed (`INT_08_LIVE_VERIFICATION_PENDING`) with `VIGOR_ALLOW_RESET_WITHOUT_INT08` forbidden in hosted Catalyst.',
    disposition:
      'Maintain all fail-closed locks intact during Phase 5.3 Development deployment.',
  },
] as const;

export const PHASE_5_3_MANDATORY_SECURITY_INVARIANTS: readonly string[] = [
  'VIGOR_CATALYST_AUTH_MODE=hosted_native (no silent fallback to external_oauth)',
  "CatalystHostedAuthBridge acquires generateAuthToken('functions') strictly in RAM and wipes it in finally",
  'Session cookie remains strictly __Host-vigor_session with HttpOnly; Secure; SameSite=Strict; Path=/ and NO Domain attribute',
  'Post-session mutations validate bound HMAC X-Vigor-CSRF + Origin/Referer allowlist + Sec-Fetch-Site Fetch Metadata',
  'Authoritative role, roleVersion, sessionEpoch, and accountStatus come exclusively from Users consistent_read + SystemControl SESSION#<sid>',
  'Public Signup Disabled, Social Login disabled, Third-party Authentication unconfigured, Custom User Validation Disabled',
  'Zero wildcard CORS (*); explicit HTTPS origins via VIGOR_ALLOWED_ORIGINS (https://app.vigorcore.lat)',
  'ZC_SECURE=override and VIGOR_ALLOW_RESET_WITHOUT_INT08=true remain strictly forbidden in hosted Catalyst',
  'api.vigorcore.lat remains BLOCKED_PENDING_ZOHO_CLARIFICATION until independent Zoho clarification & Stage 5 cutover authorization',
] as const;

export function buildPhase53RouteInventory(
  functionName = 'vigor_api'
): readonly Phase53VigorApiRouteInventoryItem[] {
  const gatewayMatrix = buildRouteGatewayAuthMatrix(functionName);
  const byId = new Map<string, RouteGatewayAuthSpec>(
    gatewayMatrix.map(entry => [entry.routeId, entry])
  );

  return ROUTE_CONTRACT_SPECS.map((spec, idx) => {
    const gw = byId.get(spec.id);
    if (!gw) {
      throw new Error(`PHASE_5_3_ROUTE_MISMATCH: Missing gateway spec for '${spec.id}'.`);
    }
    return {
      index: idx + 1,
      routeId: spec.id,
      method: spec.method,
      canonicalPath: spec.path,
      auth: spec.auth,
      authPolicy: spec.authPolicy,
      csrfPolicy: spec.csrfPolicy,
      requiresCsrf: spec.requiresCsrf,
      requiresCatalystLiveCheck: spec.requiresCatalystLiveCheck,
      allowedRoles: [...spec.allowedRoles],
      gatewayPathPattern: gw.gatewayPathPattern,
      targetPathPattern: gw.targetPathPattern,
      recommendedGatewayAuth: gw.recommendedGatewayAuth,
    };
  });
}

export const PHASE_5_3_VIGOR_API_PREPARATION = {
  phase: '5.3',
  targetFunction: 'vigor_api',
  targetFunctionType: 'advancedio',
  targetRuntime: 'node22',
  entrypoint: 'dist/server/catalystEntry.js',
  projectName: 'Project-Rainfall',
  catalystProjectId: '136967000000014024',
  dataCenter: 'US',
  accountsUrl: 'https://accounts.zoho.com',
  catalystApiDomain: 'https://api.catalyst.zoho.com',
  targetEnvironment: 'Development',
  productionModified: false,
  apiGatewayEnabledInitially: false,
  apiGatewayRollbackCommand: 'catalyst apig:disable',
  apiDomain: 'api.vigorcore.lat',
  apiDomainGate: 'BLOCKED_PENDING_ZOHO_CLARIFICATION',
  verdict: 'PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED',
  remoteOperationsExecuted: 0,
  inheritedClosures: {
    stage1Verdict: PHASE_5_2_STAGE_1_DEV_INVENTORY.verdict,
    stage1TableCount: PHASE_5_2_STAGE_1_DEV_INVENTORY.tables.length,
    stage1IndexCount: PHASE_5_2_STAGE_1_DEV_INVENTORY.tables.reduce(
      (sum, t) => sum + t.indexes.length,
      0
    ),
    stage2Verdict: PHASE_5_2_STAGE_2_DEV_INVENTORY.verdict,
    stage2ObservedUsersCount: PHASE_5_2_STAGE_2_DEV_INVENTORY.visualUserListEvidence.observedUsersCount,
    stage2AutomatedCliExecuted: PHASE_5_2_STAGE_2_DEV_INVENTORY.automatedRemoteCliQueriesExecuted,
  },
  runtimeDependencies: PHASE_5_3_RUNTIME_DEPENDENCIES,
  excludedDevDependencies: PHASE_5_3_EXCLUDED_DEV_DEPENDENCIES,
  auditFindings: PHASE_5_3_BACKEND_AUDIT_FINDINGS,
  securityInvariants: PHASE_5_3_MANDATORY_SECURITY_INVARIANTS,
  routeInventory: buildPhase53RouteInventory('vigor_api'),
  auxiliaryRoutes: {
    healthPaths: ['/health', '/api/v1/health'] as const,
    corsPreflightPath: '/api/v1/*' as const,
  },
  separationPlanes: [
    'LOCAL_PREPARATION_COMPLETED',
    'LOCAL_AUTOMATED_TESTS_VERIFIED',
    'PENDING_REMOTE_VERIFICATION_READONLY_OR_LIVE',
    'FUTURE_OPERATIONS_REQUIRING_INDEPENDENT_AUTHORIZATION',
  ] as const,
} as const;

export interface Phase53PreparationValidationResult {
  readonly passed: boolean;
  readonly canonicalRouteCount: number;
  readonly tableCount: number;
  readonly indexCount: number;
  readonly envVarCount: number;
  readonly violations: readonly string[];
}

export function validatePhase53VigorApiPreparation(): Phase53PreparationValidationResult {
  const violations: string[] = [];

  const stage1Check = validatePhase52Stage1Inventory();
  if (!stage1Check.passed) {
    violations.push(...stage1Check.mismatches.map(m => `Stage1: ${m}`));
  }

  const stage2Check = validatePhase52Stage2Inventory();
  if (!stage2Check.passed) {
    violations.push(...stage2Check.mismatches.map(m => `Stage2: ${m}`));
  }

  const fnManifest = getFunctionDeploymentManifest();
  if (
    fnManifest.functionName !== PHASE_5_3_VIGOR_API_PREPARATION.targetFunction ||
    fnManifest.type !== PHASE_5_3_VIGOR_API_PREPARATION.targetFunctionType ||
    fnManifest.runtime !== PHASE_5_3_VIGOR_API_PREPARATION.targetRuntime ||
    fnManifest.entrypoint !== PHASE_5_3_VIGOR_API_PREPARATION.entrypoint
  ) {
    violations.push('Function manifest mismatch against Phase 5.3 vigor_api preparation.');
  }

  if (PHASE_5_3_VIGOR_API_PREPARATION.routeInventory.length === 0 ||
      PHASE_5_3_VIGOR_API_PREPARATION.routeInventory.length !== ROUTE_CONTRACT_SPECS.length) {
    violations.push(
      `Expected ${ROUTE_CONTRACT_SPECS.length} canonical routes, got ${PHASE_5_3_VIGOR_API_PREPARATION.routeInventory.length}.`
    );
  }

  const uniqueKeys = new Set<string>();
  for (const r of PHASE_5_3_VIGOR_API_PREPARATION.routeInventory) {
    const key = `${r.method} ${r.canonicalPath}`;
    if (uniqueKeys.has(key)) {
      violations.push(`Duplicate route detected: ${key}`);
    }
    uniqueKeys.add(key);
    if (!r.targetPathPattern.startsWith('/server/vigor_api/api/v1/')) {
      violations.push(`Invalid target rewrite for ${r.routeId}: ${r.targetPathPattern}`);
    }
  }

  const matrixNames = new Set(EXHAUSTIVE_ENV_VAR_MATRIX.map(e => e.name));
  for (const refEnv of CODEBASE_REFERENCED_ENV_VARS) {
    if (!matrixNames.has(refEnv)) {
      violations.push(`Env var '${refEnv}' missing from EXHAUSTIVE_ENV_VAR_MATRIX.`);
    }
  }

  if (PHASE_5_3_VIGOR_API_PREPARATION.apiGatewayEnabledInitially !== false) {
    violations.push('API Gateway must remain initially disabled during vigor_api preparation.');
  }
  if (PHASE_5_3_VIGOR_API_PREPARATION.apiDomainGate !== 'BLOCKED_PENDING_ZOHO_CLARIFICATION') {
    violations.push('api.vigorcore.lat gate must remain BLOCKED_PENDING_ZOHO_CLARIFICATION.');
  }
  if (PHASE_5_3_VIGOR_API_PREPARATION.verdict !== 'PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED') {
    violations.push('Phase 5.3 preparation verdict must remain PHASE_5_3_RUNBOOK_READY_NOT_EXECUTED.');
  }

  return {
    passed: violations.length === 0,
    canonicalRouteCount: PHASE_5_3_VIGOR_API_PREPARATION.routeInventory.length,
    tableCount: stage1Check.tableCount,
    indexCount: stage1Check.indexCount,
    envVarCount: EXHAUSTIVE_ENV_VAR_MATRIX.length,
    violations,
  };
}
