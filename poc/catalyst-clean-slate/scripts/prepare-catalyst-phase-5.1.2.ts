/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.1.2 Strictly Non-Destructive Operational Preparation CLI
 *
 * Usage:
 *   npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode inspect
 *     -> Emits local + unverified remote Catalyst resource inventory & read-only queries (0 remote calls).
 *
 *   npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode preflight [--auth-mode hosted_native|external_oauth]
 *     -> Validates 5-table / 8-GSI schema lock, TTL rules, 41/41 route rewrite & auth coverage,
 *        env var matrix completeness & zero secret leakage (0 remote calls, 0 writes).
 *
 *   npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode plan
 *     -> Generates the full consolidated non-applied provisioning + API Gateway + Advanced I/O
 *        operational plan (`applied: false`, `phase52Authorized: false`).
 *
 *   npx tsx scripts/prepare-catalyst-phase-5.1.2.ts --mode apply
 *     -> STRICTLY FORBIDDEN & HARD-BLOCKED (`PHASE_5_1_2_APPLY_FORBIDDEN`, exit code 1).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  auditEnvironmentVariableCoverage,
  buildPhase512OperationalPlan,
  CATALYST_RESOURCE_INVENTORY_BASELINE,
  detectRouteAndManifestAnomalies,
  runSafePreflightValidation,
} from '../src/provisioning/operationalPreparationManifest.js';
import { redactSecretsFromString } from '../src/sdk/catalystSdkBridge.js';

export type PreparationCliMode = 'inspect' | 'preflight' | 'plan' | 'apply';

export interface ParsedPrepCliArgs {
  mode: PreparationCliMode;
  authMode: 'hosted_native' | 'external_oauth';
  scope: 'provisioning_readonly' | 'full_server_runtime';
  allowLoopbackTest: boolean;
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) {
    const next = argv[idx + 1]?.trim();
    return next && !next.startsWith('--') ? next : undefined;
  }
  const prefixed = argv.find(a => a.startsWith(`${flag}=`));
  if (prefixed) {
    return prefixed.slice(flag.length + 1).trim() || undefined;
  }
  return undefined;
}

export function parsePreparationCliArgs(argv: string[]): ParsedPrepCliArgs {
  if (argv.includes('--apply')) {
    return {
      mode: 'apply',
      authMode: 'hosted_native',
      scope: 'full_server_runtime',
      allowLoopbackTest: false,
    };
  }

  const rawMode = (readFlagValue(argv, '--mode') ?? 'inspect').toLowerCase();
  let mode: PreparationCliMode = 'inspect';
  if (rawMode === 'inspect' || rawMode === 'preflight' || rawMode === 'plan' || rawMode === 'apply') {
    mode = rawMode;
  } else {
    throw new Error(
      `INVALID_PREPARATION_MODE: Supported modes are inspect | preflight | plan | apply (got '${rawMode}').`
    );
  }

  const rawAuthMode = readFlagValue(argv, '--auth-mode');
  const authMode: 'hosted_native' | 'external_oauth' =
    rawAuthMode === 'external_oauth' ? 'external_oauth' : 'hosted_native';

  const scope = argv.includes('--readonly-scope') ? 'provisioning_readonly' : 'full_server_runtime';

  return {
    mode,
    authMode,
    scope,
    allowLoopbackTest: argv.includes('--allow-loopback-test'),
  };
}

export class ApplyModeForbiddenError extends Error {
  readonly code = 'PHASE_5_1_2_APPLY_FORBIDDEN';
  readonly exitCode = 1;
  readonly applied = false;
  readonly networkCallsExecuted = 0;
  readonly writeOperationsExecuted = 0;

  constructor() {
    super(
      'PHASE_5_1_2_APPLY_FORBIDDEN: Remote provisioning, API Gateway activation, DNS edits, and deployments are prohibited during Phase 5.1.2. Obtain separate authorization for Phase 5.2+.'
    );
    this.name = 'ApplyModeForbiddenError';
  }
}

export function detectLocalSandboxCliAvailability(
  envMap: Record<string, string | undefined> = process.env
): {
  catalystCliInPath: boolean;
  configuredEnvVarNamesOnly: string[];
  remoteAccessAvailable: boolean;
} {
  const pathEntries = (envMap.PATH || '').split(path.delimiter).filter(Boolean);
  let catalystCliInPath = false;
  for (const dir of pathEntries) {
    try {
      const candidate = path.join(dir, 'catalyst');
      if (fs.existsSync(candidate)) {
        catalystCliInPath = true;
        break;
      }
    } catch {
      // ignore inaccessible PATH directory
    }
  }

  const prefixes = ['VIGORCORE_', 'CATALYST_', 'VIGOR_', 'ZC_', 'X_ZOHO_', 'ZAID'];
  const configuredEnvVarNamesOnly = Object.keys(envMap)
    .filter(k => prefixes.some(p => k === p || k.startsWith(p)) && Boolean((envMap[k] || '').trim()))
    .sort();

  const hasMinOAuth =
    Boolean((envMap.VIGORCORE_CATALYST_PROJECT_ID || '').trim()) &&
    Boolean((envMap.CATALYST_ADMIN_REFRESH_TOKEN || envMap.CATALYST_ADMIN_ACCESS_TOKEN || '').trim());

  return {
    catalystCliInPath,
    configuredEnvVarNamesOnly,
    remoteAccessAvailable: catalystCliInPath || hasMinOAuth,
  };
}

export async function runPreparationCli(
  argv: string[] = process.argv.slice(2),
  envMap: Record<string, string | undefined> = process.env
): Promise<{
  phase: '5.1.2';
  mode: PreparationCliMode;
  verdict: string;
  applied: false;
  networkCallsExecuted: 0;
  writeOperationsExecuted: 0;
  data: Record<string, unknown>;
}> {
  const args = parsePreparationCliArgs(argv);

  if (args.mode === 'apply') {
    throw new ApplyModeForbiddenError();
  }

  if (args.mode === 'inspect') {
    const sandbox = detectLocalSandboxCliAvailability(envMap);
    const anomalies = detectRouteAndManifestAnomalies();
    const envAudit = auditEnvironmentVariableCoverage();
    return {
      phase: '5.1.2',
      mode: 'inspect',
      verdict: sandbox.remoteAccessAvailable ? 'INSPECT_LOCAL_AND_REMOTE_ELIGIBLE' : 'INSPECT_LOCAL_ONLY_NO_REMOTE_ACCESS',
      applied: false,
      networkCallsExecuted: 0,
      writeOperationsExecuted: 0,
      data: {
        sandbox,
        inventory: CATALYST_RESOURCE_INVENTORY_BASELINE,
        envAudit,
        anomalies,
      },
    };
  }

  if (args.mode === 'preflight') {
    const preflight = runSafePreflightValidation(envMap, {
      authMode: args.authMode,
      scope: args.scope,
      allowInsecureLoopbackForTest: args.allowLoopbackTest,
    });
    return {
      phase: '5.1.2',
      mode: 'preflight',
      verdict: preflight.overallPassed ? 'PASS' : 'FAIL',
      applied: false,
      networkCallsExecuted: 0,
      writeOperationsExecuted: 0,
      data: preflight,
    };
  }

  // args.mode === 'plan'
  const plan = buildPhase512OperationalPlan();
  const planValid = plan.provisioningValidation.passed && plan.anomalyReport.passed;
  return {
    phase: '5.1.2',
    mode: 'plan',
    verdict: planValid ? 'PLAN_READY_NON_APPLIED' : 'PLAN_VALIDATION_FAILED',
    applied: false,
    networkCallsExecuted: 0,
    writeOperationsExecuted: 0,
    data: plan as unknown as Record<string, unknown>,
  };
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith('prepare-catalyst-phase-5.1.2.ts');

if (isEntrypoint) {
  runPreparationCli()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      const failed = report.verdict === 'FAIL' || report.verdict === 'PLAN_VALIDATION_FAILED';
      process.exitCode = failed ? 1 : 0;
    })
    .catch(err => {
      const code = err instanceof ApplyModeForbiddenError ? err.code : 'PREPARATION_CLI_ERROR';
      const msg = redactSecretsFromString(err instanceof Error ? err.message : String(err));
      console.error(
        JSON.stringify(
          {
            phase: '5.1.2',
            applied: false,
            networkCallsExecuted: 0,
            writeOperationsExecuted: 0,
            error: code,
            message: msg,
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
