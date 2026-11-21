/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.1 Strictly Read-Only Provisioning & Preflight CLI
 *
 * Usage:
 *   npx tsx scripts/verify-clean-slate-provisioning.ts
 *     -> Offline self-check only (0 remote API calls, 0 writes). Safe before provisioning.
 *
 *   npx tsx scripts/verify-clean-slate-provisioning.ts --preflight [--full-runtime] [--expected-project <id>] [--expected-region <region>]
 *     -> Secret-redacting local environment/config preflight check (0 remote API calls, 0 writes).
 *
 *   npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly [--allow-extra-tables] [--expected-project <id>] [--expected-region <region>]
 *     -> First runs zero-network config preflight, then connects strictly READ-ONLY through
 *        CatalystAdminAppProvider (SDK-01 mitigation) after manual Catalyst table provisioning.
 *     -> Consumes canonical server vars: CATALYST_PROJECT_ID, CATALYST_PROJECT_KEY,
 *        VIGORCORE_DEPLOYMENT_ENVIRONMENT, VIGOR_ENVIRONMENT, CATALYST_API_DOMAIN, CATALYST_ACCOUNTS_URL,
 *        and CATALYST_ADMIN_CLIENT_ID/SECRET/REFRESH_TOKEN (or CATALYST_ADMIN_ACCESS_TOKEN).
 *     -> Strictly READ-ONLY: zero writes, zero test documents, zero user creation.
 */

import {
  runCatalystConfigPreflight,
  type CatalystConfigPreflightReport,
  type CatalystRegion,
} from '../src/provisioning/catalystConfigPreflight.js';
import {
  createReadOnlyEnvironmentFromProvider,
  probeCleanSlateEmptyAndContracts,
  runOfflineSelfCheck,
  type PostProvisioningVerificationReport,
} from '../src/provisioning/postProvisioningVerifier.js';
import {
  CatalystAdminAppProvider,
  redactSecretsFromString,
} from '../src/sdk/catalystSdkBridge.js';

export interface ParsedCliArgs {
  preflight: boolean;
  fullRuntime: boolean;
  live: boolean;
  confirmReadonly: boolean;
  allowExtraTables: boolean;
  allowLoopbackTest: boolean;
  authMode?: 'external_oauth' | 'hosted_native';
  expectedProjectId?: string;
  expectedRegion?: CatalystRegion;
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) {
    const next = argv[idx + 1]?.trim();
    return next && !next.startsWith('--') ? next : undefined;
  }
  const prefixed = argv.find(a => a.startsWith(`${flag}=`));
  if (prefixed) {
    const val = prefixed.slice(flag.length + 1).trim();
    return val || undefined;
  }
  return undefined;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const rawAuthMode = readFlagValue(argv, '--auth-mode');
  const authMode =
    rawAuthMode === 'external_oauth' || rawAuthMode === 'hosted_native'
      ? rawAuthMode
      : undefined;

  return {
    preflight: argv.includes('--preflight'),
    fullRuntime: argv.includes('--full-runtime'),
    live: argv.includes('--live'),
    confirmReadonly: argv.includes('--confirm-readonly'),
    allowExtraTables: argv.includes('--allow-extra-tables'),
    allowLoopbackTest: argv.includes('--allow-loopback-test'),
    authMode,
    expectedProjectId: readFlagValue(argv, '--expected-project'),
    expectedRegion: readFlagValue(argv, '--expected-region') as CatalystRegion | undefined,
  };
}

export async function runVerifierCli(
  argv: string[] = process.argv.slice(2),
  envMap: Record<string, string | undefined> = process.env
): Promise<PostProvisioningVerificationReport | CatalystConfigPreflightReport> {
  const args = parseCliArgs(argv);

  if (args.preflight && !args.live) {
    return runCatalystConfigPreflight(envMap, {
      scope: args.fullRuntime ? 'full_server_runtime' : 'provisioning_readonly',
      authMode: args.authMode,
      expectedProjectId: args.expectedProjectId,
      expectedRegion: args.expectedRegion,
      allowInsecureLoopbackForTest: args.allowLoopbackTest,
    });
  }

  if (!args.live) {
    return runOfflineSelfCheck();
  }

  if (!args.confirmReadonly) {
    throw new Error(
      'READONLY_CONFIRMATION_REQUIRED: Pass `--confirm-readonly` together with `--live` to run remote read-only verification.'
    );
  }

  const effectiveLiveAuthMode =
    args.authMode ??
    ((envMap.VIGOR_CATALYST_AUTH_MODE || '').trim() === 'hosted_native'
      ? 'hosted_native'
      : 'external_oauth');
  if (effectiveLiveAuthMode === 'hosted_native') {
    throw new Error(
      'HOSTED_NATIVE_UNAVAILABLE_OUTSIDE_ADVANCED_IO: `--live --confirm-readonly` runs locally outside Catalyst Advanced I/O and requires `--auth-mode external_oauth` credentials (`CATALYST_ADMIN_*`).'
    );
  }

  const preflightReport = runCatalystConfigPreflight(envMap, {
    scope: args.fullRuntime ? 'full_server_runtime' : 'provisioning_readonly',
    authMode: 'external_oauth',
    expectedProjectId: args.expectedProjectId,
    expectedRegion: args.expectedRegion,
    allowInsecureLoopbackForTest: args.allowLoopbackTest,
  });

  if (preflightReport.verdict !== 'PASS') {
    const summary = preflightReport.failures.map(f => `${f.code}: ${f.message}`).join(' | ');
    throw new Error(`PREFLIGHT_FAILED: Remote read-only check aborted before network calls -> ${summary}`);
  }

  const adminProvider = CatalystAdminAppProvider.fromEnvironment(envMap, {
    allowInsecureLoopbackForTest: args.allowLoopbackTest,
  });
  const env = createReadOnlyEnvironmentFromProvider(adminProvider);

  return probeCleanSlateEmptyAndContracts(env, {
    failOnExtraTables: !args.allowExtraTables,
    expectedProjectId: args.expectedProjectId ?? adminProvider.getProjectId(),
    catalystEnvironment: adminProvider.getEnvironment(),
    apiDomain: adminProvider.getApiDomain(),
  });
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith('verify-clean-slate-provisioning.ts');

if (isEntrypoint) {
  runVerifierCli()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      const ok =
        report.verdict === 'PASS' ||
        report.verdict === 'PASS_SELF_CHECK' ||
        report.verdict === 'PASS_READONLY_CLEAN_SLATE';
      process.exitCode = ok ? 0 : 1;
    })
    .catch(err => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(redactSecretsFromString(msg));
      process.exitCode = 1;
    });
}
