/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.1 Operational Catalyst Configuration Preflight Validator
 *
 * Strictly zero-network, read-only configuration audit built against:
 * - Installed `@zcatalyst/auth-admin@1.1.0` (`CatalystApp`, `RefreshTokenCredential`, `AccessTokenCredential`)
 * - Installed `@zcatalyst/auth@1.0.0` (`UserManagement`) & browser Web SDK (`ZAID` public-only scope)
 * - Installed `@zcatalyst/nosql@1.0.0` (`NoSQL`)
 * - Installed `@zcatalyst/transport@1.1.0` (`ZC_SECURE` TLS safety guard)
 * - Installed `@zcatalyst/utils@1.1.0` (`CATALYST_DATA_CENTERS`, `CONSTANTS`)
 *
 * Security Guarantees:
 * - Executes ZERO network calls and ZERO remote/local writes.
 * - Never logs, prints, or returns raw secrets in check results or reports.
 * - Separates public project identifiers from server admin credentials and browser-only `ZAID`.
 */

import { CATALYST_DATA_CENTERS, CONSTANTS } from '@zcatalyst/utils';
import { decodeAndValidateHmacSecret } from '../auth/cleanSlateAuthGuard.js';
import {
  redactSecretsFromString,
} from '../sdk/catalystSdkBridge.js';

export type CatalystRegion = keyof typeof CATALYST_DATA_CENTERS;

export type EnvVarClassification =
  | 'PUBLIC_PROJECT_IDENTIFIER'
  | 'CLIENT_ONLY_PUBLIC'
  | 'SENSITIVE_APP_CREDENTIAL'
  | 'ADMIN_OAUTH_SECRET'
  | 'RUNTIME_SECURITY_SECRET'
  | 'RUNTIME_POLICY'
  | 'SDK_TRANSPORT_FLAG'
  | 'LEGACY_DEPRECATED';

export interface EnvVarAuditCatalogEntry {
  readonly name: string;
  readonly classification: EnvVarClassification;
  readonly secret: boolean;
  readonly requiredInReadOnlyProvisioning: boolean;
  readonly requiredInFullRuntime: boolean;
  readonly usedBySdkOrRuntime: string;
}

export const CATALYST_ENV_VAR_CATALOG: readonly EnvVarAuditCatalogEntry[] = [
  {
    name: 'CATALYST_PROJECT_ID',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'CatalystApp.config.projectId -> URL /baas/v1/project/:projectId & x-zc-projectid anti-spoof pin',
  },
  {
    name: 'CATALYST_PROJECT_KEY',
    classification: 'SENSITIVE_APP_CREDENTIAL',
    secret: true,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'CatalystApp.config.projectKey -> HTTP header PROJECT_ID in addDefaultAppHeaders()',
  },
  {
    name: 'CATALYST_PROJECT_SECRET_KEY',
    classification: 'SENSITIVE_APP_CREDENTIAL',
    secret: true,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'CatalystApp.config.projectSecretKey -> optional HTTP header x-zc-project-secret-key',
  },
  {
    name: 'CATALYST_ENVIRONMENT',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: "CatalystApp.config.environment ('Development' | 'Production') -> HTTP header X-Catalyst-Environment",
  },
  {
    name: 'VIGOR_ENVIRONMENT',
    classification: 'RUNTIME_POLICY',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'CatalystAdminAppProvider & ServerSessionTokenManager environment isolation policy',
  },
  {
    name: 'CATALYST_API_DOMAIN',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'CatalystApp.config.apiDomain -> @zcatalyst/nosql & @zcatalyst/auth regional base host',
  },
  {
    name: 'CATALYST_ACCOUNTS_URL',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'RefreshTokenCredential.accountsUrl -> Zoho OAuth /oauth/v2/token endpoint',
  },
  {
    name: 'CATALYST_PROJECT_DOMAIN',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'CatalystApp.config.projectDomain -> optional custom project host metadata',
  },
  {
    name: 'CATALYST_ADMIN_CLIENT_ID',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'RefreshTokenCredential.clientId -> server-only admin OAuth exchange',
  },
  {
    name: 'CATALYST_ADMIN_CLIENT_SECRET',
    classification: 'ADMIN_OAUTH_SECRET',
    secret: true,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'RefreshTokenCredential.clientSecret -> server-only admin OAuth exchange',
  },
  {
    name: 'CATALYST_ADMIN_REFRESH_TOKEN',
    classification: 'ADMIN_OAUTH_SECRET',
    secret: true,
    requiredInReadOnlyProvisioning: true,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'RefreshTokenCredential.refreshToken -> server-only Catalyst NoSQL & UserManagementAdmin',
  },
  {
    name: 'CATALYST_ADMIN_ACCESS_TOKEN',
    classification: 'ADMIN_OAUTH_SECRET',
    secret: true,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'Optional short-lived AccessTokenCredential alternative for non-production read-only diagnostics only',
  },
  {
    name: 'X_ZOHO_CATALYST_ORG_ID',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: '@zcatalyst/auth-admin native env -> optional CATALYST-ORG HTTP header',
  },
  {
    name: 'ZAID',
    classification: 'CLIENT_ONLY_PUBLIC',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: '@zcatalyst/auth web/client SDK ONLY (/accounts/p/:zaid); NOT consumed by server auth-admin or NoSQL',
  },
  {
    name: 'VIGOR_SESSION_HMAC_SECRET',
    classification: 'RUNTIME_SECURITY_SECRET',
    secret: true,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'ServerSessionTokenManager -> 256-bit Base64URL key signing __Host-vigor_session & X-Vigor-CSRF',
  },
  {
    name: 'VIGOR_SESSION_ACTIVE_KID',
    classification: 'RUNTIME_POLICY',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'ServerSessionTokenManager -> active HMAC key identifier (default k1)',
  },
  {
    name: 'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
    classification: 'RUNTIME_SECURITY_SECRET',
    secret: true,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'ServerSessionTokenManager -> optional key rotation history [{ kid, secret }]',
  },
  {
    name: 'VIGOR_ALLOWED_ORIGINS',
    classification: 'RUNTIME_POLICY',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: true,
    usedBySdkOrRuntime: 'HttpSecurityPolicy -> explicit HTTPS CORS origin allowlist (no wildcard *)',
  },
  {
    name: 'CATALYST_FUNCTION_NAME',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'Express advancedIoApp health service label (default vigorcore-advanced-io)',
  },
  {
    name: 'CATALYST_RESET_REDIRECT_URL',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: 'CatalystSeparatedAuthRuntime password reset redirect_url (awaiting INT-08)',
  },
  {
    name: 'VIGOR_CATALYST_AUTH_MODE',
    classification: 'RUNTIME_POLICY',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: "Selects 'external_oauth' (CatalystAdminAppProvider) or 'hosted_native' (zcAuth.init inside hosted Advanced I/O)",
  },
  {
    name: 'VIGOR_CORS_MODE',
    classification: 'RUNTIME_POLICY',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: "Selects 'express_enforced' or 'platform_managed' (suppresses duplicate Access-Control-* headers with CloudScale Authorized Domains)",
  },
  {
    name: 'ZC_SECURE',
    classification: 'SDK_TRANSPORT_FLAG',
    secret: false,
    requiredInReadOnlyProvisioning: false,
    requiredInFullRuntime: false,
    usedBySdkOrRuntime: "@zcatalyst/transport HttpHandler -> 'override' disables TLS certificate verification (PROHIBITED)",
  },
] as const;

export interface PreflightCheckItem {
  id: string;
  key: string;
  classification: EnvVarClassification | 'CROSS_CONFIG';
  passed: boolean;
  severity: 'FAIL' | 'WARN' | 'INFO';
  code: string;
  message: string;
  redactedPreview?: string;
}

export interface PreflightValidationOptions {
  scope?: 'provisioning_readonly' | 'full_server_runtime';
  authMode?: 'external_oauth' | 'hosted_native';
  expectedProjectId?: string;
  expectedRegion?: CatalystRegion;
  allowInsecureLoopbackForTest?: boolean;
}

export interface CatalystConfigPreflightReport {
  phase: '5.1' | '5.1.1';
  mode: 'CONFIG_PREFLIGHT_ZERO_NETWORK';
  scope: 'provisioning_readonly' | 'full_server_runtime';
  runtimeAuthMode: 'external_oauth' | 'hosted_native';
  corsMode: 'express_enforced' | 'platform_managed';
  verdict: 'PASS' | 'FAIL';
  networkCallsExecuted: 0;
  writeOperationsExecuted: 0;
  inferredRegion: CatalystRegion | 'CUSTOM_OR_UNKNOWN';
  authModeDetected: 'hosted_native' | 'refresh_token' | 'access_token' | 'incomplete';
  targetSummary: {
    projectId: string | null;
    catalystEnvironment: string | null;
    vigorEnvironment: string | null;
    apiDomain: string | null;
    accountsUrl: string | null;
    clientAppZaidPresent: boolean;
  };
  checks: PreflightCheckItem[];
  failures: PreflightCheckItem[];
  warnings: PreflightCheckItem[];
}

const REGION_HOSTS: Record<
  CatalystRegion,
  { apiOrigin: string; tldSuffix: string }
> = {
  us: { apiOrigin: CATALYST_DATA_CENTERS.us.apiDomain, tldSuffix: '.zoho.com' },
  eu: { apiOrigin: CATALYST_DATA_CENTERS.eu.apiDomain, tldSuffix: '.zoho.eu' },
  in: { apiOrigin: CATALYST_DATA_CENTERS.in.apiDomain, tldSuffix: '.zoho.in' },
  au: { apiOrigin: CATALYST_DATA_CENTERS.au.apiDomain, tldSuffix: '.zoho.com.au' },
  ca: { apiOrigin: CATALYST_DATA_CENTERS.ca.apiDomain, tldSuffix: '.zohocloud.ca' },
  sa: { apiOrigin: CATALYST_DATA_CENTERS.sa.apiDomain, tldSuffix: '.zoho.sa' },
  jp: { apiOrigin: CATALYST_DATA_CENTERS.jp.apiDomain, tldSuffix: '.zoho.jp' },
  uae: { apiOrigin: CATALYST_DATA_CENTERS.uae.apiDomain, tldSuffix: '.zoho.ae' },
};

const REGION_ACCOUNTS_TLD: Record<CatalystRegion, string> = {
  us: '.zoho.com',
  eu: '.zoho.eu',
  in: '.zoho.in',
  au: '.zoho.com.au',
  ca: '.zoho.ca',
  sa: '.zoho.sa',
  jp: '.zoho.jp',
  uae: '.zoho.ae',
};

const PLACEHOLDER_VALUE_PATTERNS = [
  /^your[_-]/i,
  /^replace[_-]/i,
  /^changeme/i,
  /^example/i,
  /^placeholder/i,
  /^dummy[_-]/i,
  /^<.*>$/,
  /^todo/i,
  /^0+$/,
  /^xxx+$/i,
];

function isPlaceholderOrDummy(raw: string): boolean {
  const trimmed = raw.trim();
  return PLACEHOLDER_VALUE_PATTERNS.some(re => re.test(trimmed));
}

function maskSecretPreview(val: string | undefined): string | undefined {
  if (!val || !val.trim()) return undefined;
  return `[REDACTED:len=${val.trim().length}]`;
}

export function inferCatalystRegionFromApiDomain(rawApiDomain: string | undefined): CatalystRegion | 'CUSTOM_OR_UNKNOWN' {
  if (!rawApiDomain) return 'CUSTOM_OR_UNKNOWN';
  let origin: string;
  try {
    origin = new URL(rawApiDomain.trim()).origin.toLowerCase();
  } catch {
    return 'CUSTOM_OR_UNKNOWN';
  }
  for (const [region, info] of Object.entries(REGION_HOSTS)) {
    if (info.apiOrigin.toLowerCase() === origin) {
      return region as CatalystRegion;
    }
  }
  return 'CUSTOM_OR_UNKNOWN';
}

function collectRawSecretsForRedaction(envMap: Record<string, string | undefined>): string[] {
  const secretKeys = [
    'CATALYST_PROJECT_KEY',
    'CATALYST_PROJECT_SECRET_KEY',
    'CATALYST_ADMIN_CLIENT_SECRET',
    'CATALYST_ADMIN_REFRESH_TOKEN',
    'CATALYST_ADMIN_ACCESS_TOKEN',
    'VIGOR_SESSION_HMAC_SECRET',
    'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
    'ZC_PROJECT_KEY',
    'ZC_CLIENT_SECRET',
    'ZC_REFRESH_TOKEN',
  ];
  const out: string[] = [];
  for (const key of secretKeys) {
    const val = (envMap[key] || '').trim();
    if (val.length >= 4) out.push(val);
  }
  return out;
}

function validateOriginUrl(
  rawUrl: string | undefined,
  envKey: string,
  allowLoopback: boolean
): { ok: boolean; origin: string | null; isLoopback: boolean; code: string; message: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      origin: null,
      isLoopback: false,
      code: 'MISSING_CATALYST_URL',
      message: `${envKey} is required.`,
    };
  }
  if (isPlaceholderOrDummy(trimmed)) {
    return {
      ok: false,
      origin: null,
      isLoopback: false,
      code: 'PLACEHOLDER_CATALYST_URL',
      message: `${envKey} contains a placeholder value.`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      origin: null,
      isLoopback: false,
      code: 'INVALID_CATALYST_URL',
      message: `${envKey} is not a valid absolute URL.`,
    };
  }
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol === 'https:') {
    return {
      ok: true,
      origin: parsed.origin,
      isLoopback,
      code: 'OK',
      message: `${envKey} valid HTTPS origin (${parsed.origin}).`,
    };
  }
  if (parsed.protocol === 'http:' && allowLoopback && isLoopback) {
    return {
      ok: true,
      origin: parsed.origin,
      isLoopback: true,
      code: 'OK_LOOPBACK_TEST',
      message: `${envKey} allowed over HTTP strictly for loopback test (${parsed.origin}).`,
    };
  }
  return {
    ok: false,
    origin: parsed.origin,
    isLoopback,
    code: 'INSECURE_CATALYST_URL',
    message: `${envKey} MUST use https:// outside explicit local loopback tests.`,
  };
}

/**
 * Validates VigorCore + Zoho Catalyst operational configuration with zero network calls and zero writes.
 * Ensures all error/check details are completely free of raw secret values.
 */
export function runCatalystConfigPreflight(
  envMap: Record<string, string | undefined> = process.env,
  options: PreflightValidationOptions = {}
): CatalystConfigPreflightReport {
  const scope = options.scope ?? 'provisioning_readonly';
  const allowLoopback = Boolean(options.allowInsecureLoopbackForTest);
  const secretsToRedact = collectRawSecretsForRedaction(envMap);
  const checks: PreflightCheckItem[] = [];

  const pushCheck = (item: PreflightCheckItem) => {
    checks.push({
      ...item,
      message: redactSecretsFromString(item.message, secretsToRedact),
      ...(item.redactedPreview
        ? { redactedPreview: redactSecretsFromString(item.redactedPreview, secretsToRedact) }
        : {}),
    });
  };

  // 0. Runtime Auth Mode & CORS Mode
  const rawAuthModeInput = (options.authMode ?? envMap.VIGOR_CATALYST_AUTH_MODE ?? '').trim();
  let runtimeAuthMode: 'external_oauth' | 'hosted_native' = 'external_oauth';
  if (!rawAuthModeInput || rawAuthModeInput === 'external_oauth') {
    runtimeAuthMode = 'external_oauth';
    pushCheck({
      id: 'PRE-AUTH-MODE',
      key: 'VIGOR_CATALYST_AUTH_MODE',
      classification: 'RUNTIME_POLICY',
      passed: true,
      severity: 'INFO',
      code: 'OK_EXTERNAL_OAUTH',
      message:
        "Runtime auth mode is 'external_oauth' (CatalystAdminAppProvider + RefreshToken/AccessTokenCredential for external runtime or CLI).",
      redactedPreview: 'external_oauth',
    });
  } else if (rawAuthModeInput === 'hosted_native') {
    runtimeAuthMode = 'hosted_native';
    pushCheck({
      id: 'PRE-AUTH-MODE',
      key: 'VIGOR_CATALYST_AUTH_MODE',
      classification: 'RUNTIME_POLICY',
      passed: true,
      severity: 'INFO',
      code: 'OK_HOSTED_NATIVE',
      message:
        "Runtime auth mode is 'hosted_native' (HostedNativeCatalystAuthRuntime via ZCAuth.init(req, { scope: 'admin' | 'user' }); external OAuth secrets NOT required inside hosted Advanced I/O).",
      redactedPreview: 'hosted_native',
    });
  } else {
    pushCheck({
      id: 'PRE-AUTH-MODE',
      key: 'VIGOR_CATALYST_AUTH_MODE',
      classification: 'RUNTIME_POLICY',
      passed: false,
      severity: 'FAIL',
      code: 'INVALID_CATALYST_AUTH_MODE',
      message: `VIGOR_CATALYST_AUTH_MODE must be 'external_oauth' or 'hosted_native' (got '${rawAuthModeInput}').`,
      redactedPreview: rawAuthModeInput,
    });
  }

  const rawCorsMode = (envMap.VIGOR_CORS_MODE || '').trim();
  let corsMode: 'express_enforced' | 'platform_managed' = 'express_enforced';
  if (!rawCorsMode || rawCorsMode === 'express_enforced') {
    corsMode = 'express_enforced';
    pushCheck({
      id: 'PRE-CORS-MODE',
      key: 'VIGOR_CORS_MODE',
      classification: 'RUNTIME_POLICY',
      passed: true,
      severity: 'INFO',
      code: 'OK_EXPRESS_ENFORCED',
      message:
        "CORS mode is 'express_enforced' (Express emits Access-Control-Allow-* headers from explicit allowlist).",
      redactedPreview: 'express_enforced',
    });
  } else if (rawCorsMode === 'platform_managed') {
    corsMode = 'platform_managed';
    pushCheck({
      id: 'PRE-CORS-MODE',
      key: 'VIGOR_CORS_MODE',
      classification: 'RUNTIME_POLICY',
      passed: true,
      severity: 'INFO',
      code: 'OK_PLATFORM_MANAGED',
      message:
        "CORS mode is 'platform_managed' (CloudScale Whitelisting > Authorized Domains emits Access-Control-* headers; Express omits duplicate Access-Control-* while keeping fail-closed Origin/CSRF enforcement).",
      redactedPreview: 'platform_managed',
    });
  } else {
    pushCheck({
      id: 'PRE-CORS-MODE',
      key: 'VIGOR_CORS_MODE',
      classification: 'RUNTIME_POLICY',
      passed: false,
      severity: 'FAIL',
      code: 'INVALID_CORS_MODE',
      message: `VIGOR_CORS_MODE must be 'express_enforced' or 'platform_managed' (got '${rawCorsMode}').`,
      redactedPreview: rawCorsMode,
    });
  }

  // 1. CATALYST_PROJECT_ID
  const rawProjectId = (envMap.CATALYST_PROJECT_ID || '').trim();
  if (!rawProjectId) {
    pushCheck({
      id: 'PRE-PROJECT-ID',
      key: 'CATALYST_PROJECT_ID',
      classification: 'PUBLIC_PROJECT_IDENTIFIER',
      passed: false,
      severity: 'FAIL',
      code: 'MISSING_CATALYST_PROJECT_ID',
      message: 'CATALYST_PROJECT_ID is missing.',
    });
  } else if (isPlaceholderOrDummy(rawProjectId) || !/^[A-Za-z0-9_-]{3,64}$/.test(rawProjectId)) {
    pushCheck({
      id: 'PRE-PROJECT-ID',
      key: 'CATALYST_PROJECT_ID',
      classification: 'PUBLIC_PROJECT_IDENTIFIER',
      passed: false,
      severity: 'FAIL',
      code: isPlaceholderOrDummy(rawProjectId) ? 'PLACEHOLDER_CATALYST_PROJECT_ID' : 'INVALID_CATALYST_PROJECT_ID',
      message: `CATALYST_PROJECT_ID '${rawProjectId}' is empty, placeholder, or malformed.`,
    });
  } else if (options.expectedProjectId && rawProjectId !== options.expectedProjectId) {
    pushCheck({
      id: 'PRE-PROJECT-ID',
      key: 'CATALYST_PROJECT_ID',
      classification: 'PUBLIC_PROJECT_IDENTIFIER',
      passed: false,
      severity: 'FAIL',
      code: 'WRONG_PROJECT_TARGET',
      message: `CATALYST_PROJECT_ID (${rawProjectId}) does not match expected project (${options.expectedProjectId}).`,
      redactedPreview: rawProjectId,
    });
  } else {
    pushCheck({
      id: 'PRE-PROJECT-ID',
      key: 'CATALYST_PROJECT_ID',
      classification: 'PUBLIC_PROJECT_IDENTIFIER',
      passed: true,
      severity: 'INFO',
      code: 'OK',
      message: `Public Catalyst project ID validated (${rawProjectId}).`,
      redactedPreview: rawProjectId,
    });
  }

  // 2. CATALYST_PROJECT_KEY (Required in external_oauth; optional edge-supplied/pinned in hosted_native)
  const rawProjectKey = (envMap.CATALYST_PROJECT_KEY || '').trim();
  if (!rawProjectKey) {
    if (runtimeAuthMode === 'hosted_native') {
      pushCheck({
        id: 'PRE-PROJECT-KEY',
        key: 'CATALYST_PROJECT_KEY',
        classification: 'SENSITIVE_APP_CREDENTIAL',
        passed: true,
        severity: 'INFO',
        code: 'OPTIONAL_IN_HOSTED_NATIVE',
        message:
          'CATALYST_PROJECT_KEY omitted in hosted_native mode; runtime accepts edge x-zc-project-key header.',
      });
    } else {
      pushCheck({
        id: 'PRE-PROJECT-KEY',
        key: 'CATALYST_PROJECT_KEY',
        classification: 'SENSITIVE_APP_CREDENTIAL',
        passed: false,
        severity: 'FAIL',
        code: 'MISSING_CATALYST_PROJECT_KEY',
        message: 'CATALYST_PROJECT_KEY is missing (required by @zcatalyst/auth-admin addDefaultAppHeaders in external_oauth mode).',
      });
    }
  } else if (isPlaceholderOrDummy(rawProjectKey) || rawProjectKey.length < 6) {
    pushCheck({
      id: 'PRE-PROJECT-KEY',
      key: 'CATALYST_PROJECT_KEY',
      classification: 'SENSITIVE_APP_CREDENTIAL',
      passed: false,
      severity: 'FAIL',
      code: 'PLACEHOLDER_OR_SHORT_PROJECT_KEY',
      message: 'CATALYST_PROJECT_KEY contains a placeholder or implausibly short value.',
      redactedPreview: maskSecretPreview(rawProjectKey),
    });
  } else {
    pushCheck({
      id: 'PRE-PROJECT-KEY',
      key: 'CATALYST_PROJECT_KEY',
      classification: 'SENSITIVE_APP_CREDENTIAL',
      passed: true,
      severity: 'INFO',
      code: 'OK',
      message: 'CATALYST_PROJECT_KEY configured and masked.',
      redactedPreview: maskSecretPreview(rawProjectKey),
    });
  }

  // Optional CATALYST_PROJECT_SECRET_KEY placeholder check
  const rawProjectSecretKey = (envMap.CATALYST_PROJECT_SECRET_KEY || '').trim();
  if (rawProjectSecretKey && isPlaceholderOrDummy(rawProjectSecretKey)) {
    pushCheck({
      id: 'PRE-PROJECT-SECRET-KEY',
      key: 'CATALYST_PROJECT_SECRET_KEY',
      classification: 'SENSITIVE_APP_CREDENTIAL',
      passed: false,
      severity: 'FAIL',
      code: 'PLACEHOLDER_PROJECT_SECRET_KEY',
      message: 'CATALYST_PROJECT_SECRET_KEY is set to a placeholder value.',
      redactedPreview: maskSecretPreview(rawProjectSecretKey),
    });
  }

  // 3. Environments & strict separation
  const rawCatEnv = (envMap.CATALYST_ENVIRONMENT || '').trim();
  const catEnvValid = rawCatEnv === 'Development' || rawCatEnv === 'Production';
  pushCheck({
    id: 'PRE-CATALYST-ENV',
    key: 'CATALYST_ENVIRONMENT',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    passed: catEnvValid,
    severity: catEnvValid ? 'INFO' : 'FAIL',
    code: catEnvValid ? 'OK' : 'INVALID_CATALYST_ENVIRONMENT',
    message: catEnvValid
      ? `CATALYST_ENVIRONMENT='${rawCatEnv}' validated.`
      : `CATALYST_ENVIRONMENT must be strictly 'Development' or 'Production' (got '${rawCatEnv || 'UNSET'}').`,
    ...(rawCatEnv ? { redactedPreview: rawCatEnv } : {}),
  });

  const rawVigorEnv = (envMap.VIGOR_ENVIRONMENT || '').trim().toLowerCase();
  const vigorEnvValid = ['development', 'staging', 'production', 'test'].includes(rawVigorEnv);
  pushCheck({
    id: 'PRE-VIGOR-ENV',
    key: 'VIGOR_ENVIRONMENT',
    classification: 'RUNTIME_POLICY',
    passed: vigorEnvValid,
    severity: vigorEnvValid ? 'INFO' : 'FAIL',
    code: vigorEnvValid ? 'OK' : 'INVALID_VIGOR_ENVIRONMENT',
    message: vigorEnvValid
      ? `VIGOR_ENVIRONMENT='${rawVigorEnv}' validated.`
      : `VIGOR_ENVIRONMENT must be 'development' | 'staging' | 'production' | 'test' (got '${rawVigorEnv || 'UNSET'}').`,
    ...(rawVigorEnv ? { redactedPreview: rawVigorEnv } : {}),
  });

  if (catEnvValid && vigorEnvValid) {
    const mismatchProd = rawVigorEnv === 'production' && rawCatEnv !== 'Production';
    const mismatchNonProd = (rawVigorEnv === 'development' || rawVigorEnv === 'test') && rawCatEnv === 'Production';
    const separationOk = !mismatchProd && !mismatchNonProd;
    pushCheck({
      id: 'PRE-ENV-SEPARATION',
      key: 'VIGOR_ENVIRONMENT+CATALYST_ENVIRONMENT',
      classification: 'CROSS_CONFIG',
      passed: separationOk,
      severity: separationOk ? 'INFO' : 'FAIL',
      code: separationOk ? 'OK' : 'ENVIRONMENT_SEPARATION_VIOLATION',
      message: separationOk
        ? `Environment separation enforced (VIGOR_ENVIRONMENT='${rawVigorEnv}' <-> CATALYST_ENVIRONMENT='${rawCatEnv}').`
        : `Cross-environment conflict: VIGOR_ENVIRONMENT='${rawVigorEnv}' cannot pair with CATALYST_ENVIRONMENT='${rawCatEnv}'.`,
    });
  }

  // 4. API Domain & Accounts URL + Region coherence
  const apiUrlRes = validateOriginUrl(
    envMap.CATALYST_API_DOMAIN || (allowLoopback ? undefined : CONSTANTS.CATALYST_ORIGIN),
    'CATALYST_API_DOMAIN',
    allowLoopback
  );
  // Require explicit CATALYST_API_DOMAIN in preflight so operator never relies on silent US default unintentionally
  const apiExplicit = Boolean((envMap.CATALYST_API_DOMAIN || '').trim());
  pushCheck({
    id: 'PRE-API-DOMAIN',
    key: 'CATALYST_API_DOMAIN',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    passed: apiExplicit && apiUrlRes.ok,
    severity: apiExplicit && apiUrlRes.ok ? 'INFO' : 'FAIL',
    code: !apiExplicit ? 'MISSING_CATALYST_API_DOMAIN' : apiUrlRes.code,
    message: !apiExplicit
      ? 'CATALYST_API_DOMAIN must be declared explicitly (e.g., https://api.catalyst.zoho.com) instead of relying on implicit defaults.'
      : apiUrlRes.message,
    ...(apiUrlRes.origin ? { redactedPreview: apiUrlRes.origin } : {}),
  });

  const accUrlRes = validateOriginUrl(
    envMap.CATALYST_ACCOUNTS_URL || (allowLoopback ? undefined : CONSTANTS.ACCOUNTS_ORIGIN),
    'CATALYST_ACCOUNTS_URL',
    allowLoopback
  );
  const accExplicit = Boolean((envMap.CATALYST_ACCOUNTS_URL || '').trim());
  pushCheck({
    id: 'PRE-ACCOUNTS-URL',
    key: 'CATALYST_ACCOUNTS_URL',
    classification: 'PUBLIC_PROJECT_IDENTIFIER',
    passed: accExplicit && accUrlRes.ok,
    severity: accExplicit && accUrlRes.ok ? 'INFO' : 'FAIL',
    code: !accExplicit ? 'MISSING_CATALYST_ACCOUNTS_URL' : accUrlRes.code,
    message: !accExplicit
      ? 'CATALYST_ACCOUNTS_URL must be declared explicitly (e.g., https://accounts.zoho.com).'
      : accUrlRes.message,
    ...(accUrlRes.origin ? { redactedPreview: accUrlRes.origin } : {}),
  });

  const inferredRegion = inferCatalystRegionFromApiDomain(envMap.CATALYST_API_DOMAIN);
  if (apiExplicit && apiUrlRes.ok && !apiUrlRes.isLoopback) {
    if (options.expectedRegion && inferredRegion !== options.expectedRegion) {
      pushCheck({
        id: 'PRE-REGION-TARGET',
        key: 'CATALYST_API_DOMAIN',
        classification: 'CROSS_CONFIG',
        passed: false,
        severity: 'FAIL',
        code: 'WRONG_CATALYST_REGION',
        message: `CATALYST_API_DOMAIN resolved region '${inferredRegion}', expected '${options.expectedRegion}'.`,
      });
    }
    if (inferredRegion !== 'CUSTOM_OR_UNKNOWN' && accExplicit && accUrlRes.ok && accUrlRes.origin) {
      const expectedTld = REGION_ACCOUNTS_TLD[inferredRegion];
      const accHost = new URL(accUrlRes.origin).hostname.toLowerCase();
      const regionMatch = accHost.endsWith(expectedTld);
      pushCheck({
        id: 'PRE-REGION-COHERENCE',
        key: 'CATALYST_API_DOMAIN+CATALYST_ACCOUNTS_URL',
        classification: 'CROSS_CONFIG',
        passed: regionMatch,
        severity: regionMatch ? 'INFO' : 'FAIL',
        code: regionMatch ? 'OK' : 'REGION_ACCOUNTS_MISMATCH',
        message: regionMatch
          ? `Catalyst region '${inferredRegion}' consistent between API domain and Zoho Accounts host (${accHost}).`
          : `Region mismatch: CATALYST_API_DOMAIN maps to '${inferredRegion}' (expects Accounts '*${expectedTld}') but CATALYST_ACCOUNTS_URL is '${accHost}'.`,
      });
    }
  }

  // 5. Server Admin OAuth Credentials (strictly required in external_oauth; omitted in hosted_native)
  const rawClientId = (envMap.CATALYST_ADMIN_CLIENT_ID || '').trim();
  const rawClientSecret = (envMap.CATALYST_ADMIN_CLIENT_SECRET || '').trim();
  const rawRefreshToken = (envMap.CATALYST_ADMIN_REFRESH_TOKEN || '').trim();
  const rawAccessToken = (envMap.CATALYST_ADMIN_ACCESS_TOKEN || '').trim();

  const hasAccessTokenOnly = Boolean(rawAccessToken) && !rawRefreshToken;
  const authModeDetected: CatalystConfigPreflightReport['authModeDetected'] =
    runtimeAuthMode === 'hosted_native'
      ? 'hosted_native'
      : hasAccessTokenOnly
        ? 'access_token'
        : rawClientId || rawClientSecret || rawRefreshToken
          ? rawClientId &&
            rawClientSecret &&
            rawRefreshToken &&
            !isPlaceholderOrDummy(rawClientId) &&
            !isPlaceholderOrDummy(rawClientSecret) &&
            !isPlaceholderOrDummy(rawRefreshToken)
            ? 'refresh_token'
            : 'incomplete'
          : 'incomplete';

  if (runtimeAuthMode === 'hosted_native') {
    const anyPlaceholderInOptionalOAuth = [
      ['CATALYST_ADMIN_CLIENT_ID', rawClientId],
      ['CATALYST_ADMIN_CLIENT_SECRET', rawClientSecret],
      ['CATALYST_ADMIN_REFRESH_TOKEN', rawRefreshToken],
      ['CATALYST_ADMIN_ACCESS_TOKEN', rawAccessToken],
    ].filter(([, val]) => Boolean(val) && isPlaceholderOrDummy(val));

    if (anyPlaceholderInOptionalOAuth.length > 0) {
      for (const [key, val] of anyPlaceholderInOptionalOAuth) {
        pushCheck({
          id: `PRE-ADMIN-HOSTED-${key}`,
          key,
          classification: 'ADMIN_OAUTH_SECRET',
          passed: false,
          severity: 'FAIL',
          code: `PLACEHOLDER_${key}`,
          message: `${key} is set to a placeholder value; unset it in hosted_native mode or provide real fallback credentials.`,
          redactedPreview: maskSecretPreview(val),
        });
      }
    } else {
      pushCheck({
        id: 'PRE-ADMIN-OAUTH',
        key: 'CATALYST_ADMIN_CLIENT_ID+CLIENT_SECRET+REFRESH_TOKEN',
        classification: 'ADMIN_OAUTH_SECRET',
        passed: true,
        severity: 'INFO',
        code: 'OK_HOSTED_NATIVE_NO_EXTERNAL_OAUTH',
        message:
          'External admin OAuth credentials are not required in hosted_native mode inside Catalyst Advanced I/O (`zcAuth.init(req, { scope: "admin" | "user" })`). Keep external_oauth credentials ready in external secret store only for fallback or CLI `--live --confirm-readonly`.',
      });
    }
  } else if (hasAccessTokenOnly) {
    const accessValid = !isPlaceholderOrDummy(rawAccessToken) && rawAccessToken.length >= 10;
    const accessBlockedInProd = scope === 'full_server_runtime' && rawVigorEnv === 'production';
    pushCheck({
      id: 'PRE-ADMIN-OAUTH',
      key: 'CATALYST_ADMIN_ACCESS_TOKEN',
      classification: 'ADMIN_OAUTH_SECRET',
      passed: accessValid && !accessBlockedInProd,
      severity: accessValid && !accessBlockedInProd ? 'WARN' : 'FAIL',
      code: accessBlockedInProd
        ? 'EPHEMERAL_ACCESS_TOKEN_FORBIDDEN_IN_PROD'
        : accessValid
          ? 'OK_EPHEMERAL_ACCESS_TOKEN'
          : 'PLACEHOLDER_OR_INVALID_ACCESS_TOKEN',
      message: accessBlockedInProd
        ? 'Short-lived CATALYST_ADMIN_ACCESS_TOKEN cannot be used in full_server_runtime production; configure RefreshToken OAuth credentials.'
        : accessValid
          ? 'Using short-lived CATALYST_ADMIN_ACCESS_TOKEN for read-only verification (refresh_token preferred for long-running services).'
          : 'CATALYST_ADMIN_ACCESS_TOKEN contains a placeholder or invalid value.',
      redactedPreview: maskSecretPreview(rawAccessToken),
    });
  } else {
    for (const [id, key, val, classification, isSecret] of [
      ['PRE-ADMIN-CLIENT-ID', 'CATALYST_ADMIN_CLIENT_ID', rawClientId, 'PUBLIC_PROJECT_IDENTIFIER', false],
      ['PRE-ADMIN-CLIENT-SECRET', 'CATALYST_ADMIN_CLIENT_SECRET', rawClientSecret, 'ADMIN_OAUTH_SECRET', true],
      ['PRE-ADMIN-REFRESH-TOKEN', 'CATALYST_ADMIN_REFRESH_TOKEN', rawRefreshToken, 'ADMIN_OAUTH_SECRET', true],
    ] as const) {
      const valid = Boolean(val) && !isPlaceholderOrDummy(val) && val.length >= 6;
      pushCheck({
        id,
        key,
        classification,
        passed: valid,
        severity: valid ? 'INFO' : 'FAIL',
        code: !val ? `MISSING_${key}` : isPlaceholderOrDummy(val) ? `PLACEHOLDER_${key}` : 'OK',
        message: valid
          ? `${key} validated (${isSecret ? 'secret redacted' : 'OAuth client identifier'}).`
          : `${key} is missing, placeholder, or invalid.`,
        redactedPreview: isSecret ? maskSecretPreview(val) : val || undefined,
      });
    }
  }

  // 6. Client-only ZAID separation check (optional, never treated as server credential)
  const rawZaid = (envMap.ZAID || '').trim();
  if (rawZaid) {
    const zaidBad = isPlaceholderOrDummy(rawZaid);
    pushCheck({
      id: 'PRE-CLIENT-ZAID',
      key: 'ZAID',
      classification: 'CLIENT_ONLY_PUBLIC',
      passed: !zaidBad,
      severity: zaidBad ? 'FAIL' : 'INFO',
      code: zaidBad ? 'PLACEHOLDER_ZAID' : 'CLIENT_PUBLIC_IDENTIFIER_ONLY',
      message: zaidBad
        ? 'ZAID contains a placeholder value.'
        : 'ZAID detected as public browser Web SDK identifier only (unused by server @zcatalyst/auth-admin or @zcatalyst/nosql).',
      redactedPreview: rawZaid,
    });
  }

  // 7. TLS safety flag guard (@zcatalyst/transport ZC_SECURE)
  if ((envMap.ZC_SECURE || '').trim().toLowerCase() === 'override') {
    pushCheck({
      id: 'PRE-TLS-OVERRIDE',
      key: 'ZC_SECURE',
      classification: 'SDK_TRANSPORT_FLAG',
      passed: false,
      severity: 'FAIL',
      code: 'INSECURE_TLS_OVERRIDE_FORBIDDEN',
      message: "ZC_SECURE='override' disables TLS verification in @zcatalyst/transport and is strictly forbidden.",
    });
  }

  // 8. Legacy ZC_* mismatch/deprecation warning
  const legacyZcs = ['ZC_PROJECT_ID', 'ZC_PROJECT_KEY', 'ZC_CLIENT_ID', 'ZC_CLIENT_SECRET', 'ZC_REFRESH_TOKEN', 'ZC_ENVIRONMENT']
    .filter(k => Boolean((envMap[k] || '').trim()));
  if (legacyZcs.length > 0) {
    const legacyPid = (envMap.ZC_PROJECT_ID || '').trim();
    const pidMismatch = Boolean(legacyPid && rawProjectId && legacyPid !== rawProjectId);
    pushCheck({
      id: 'PRE-LEGACY-ZC-VARS',
      key: legacyZcs.join(','),
      classification: 'LEGACY_DEPRECATED',
      passed: !pidMismatch,
      severity: pidMismatch ? 'FAIL' : 'WARN',
      code: pidMismatch ? 'LEGACY_ZC_PROJECT_MISMATCH' : 'LEGACY_ZC_VARS_PRESENT',
      message: pidMismatch
        ? `Legacy ZC_PROJECT_ID conflicts with canonical CATALYST_PROJECT_ID.`
        : `Legacy unprefixed ZC_* env variable(s) present (${legacyZcs.join(', ')}); CatalystAdminAppProvider consumes canonical CATALYST_* variables.`,
    });
  }

  // 9. Server Session HMAC & CORS Origins
  const rawHmac = (envMap.VIGOR_SESSION_HMAC_SECRET || '').trim();
  if (rawHmac) {
    try {
      decodeAndValidateHmacSecret(rawHmac, 'VIGOR_SESSION_HMAC_SECRET');
      pushCheck({
        id: 'PRE-SESSION-HMAC',
        key: 'VIGOR_SESSION_HMAC_SECRET',
        classification: 'RUNTIME_SECURITY_SECRET',
        passed: true,
        severity: 'INFO',
        code: 'OK',
        message: 'VIGOR_SESSION_HMAC_SECRET validated (canonical Base64URL, >= 256 bits & high entropy).',
        redactedPreview: maskSecretPreview(rawHmac),
      });
    } catch (err) {
      pushCheck({
        id: 'PRE-SESSION-HMAC',
        key: 'VIGOR_SESSION_HMAC_SECRET',
        classification: 'RUNTIME_SECURITY_SECRET',
        passed: false,
        severity: 'FAIL',
        code: 'INVALID_SESSION_HMAC_SECRET',
        message: err instanceof Error ? err.message : 'Invalid VIGOR_SESSION_HMAC_SECRET.',
        redactedPreview: maskSecretPreview(rawHmac),
      });
    }
  } else if (scope === 'full_server_runtime') {
    pushCheck({
      id: 'PRE-SESSION-HMAC',
      key: 'VIGOR_SESSION_HMAC_SECRET',
      classification: 'RUNTIME_SECURITY_SECRET',
      passed: false,
      severity: 'FAIL',
      code: 'MISSING_SESSION_HMAC_SECRET',
      message: 'VIGOR_SESSION_HMAC_SECRET is required for full_server_runtime.',
    });
  } else {
    pushCheck({
      id: 'PRE-SESSION-HMAC',
      key: 'VIGOR_SESSION_HMAC_SECRET',
      classification: 'RUNTIME_SECURITY_SECRET',
      passed: true,
      severity: 'WARN',
      code: 'NOT_NEEDED_FOR_READONLY_PREFLIGHT_REQUIRED_FOR_SERVER',
      message: 'VIGOR_SESSION_HMAC_SECRET not set (not needed for --live --confirm-readonly; MANDATORY before launching Advanced I/O server).',
    });
  }

  const rawPrevHmac = (envMap.VIGOR_SESSION_PREVIOUS_SECRETS_JSON || '').trim();
  if (rawPrevHmac) {
    try {
      const parsed = JSON.parse(rawPrevHmac);
      if (!Array.isArray(parsed)) throw new Error('Must be JSON array');
      for (const entry of parsed) {
        if (!entry || typeof entry.kid !== 'string' || typeof entry.secret !== 'string') {
          throw new Error('Each rotation entry requires { kid, secret }');
        }
        decodeAndValidateHmacSecret(entry.secret, `previous[${entry.kid}]`);
      }
      pushCheck({
        id: 'PRE-SESSION-ROTATION-KEYS',
        key: 'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
        classification: 'RUNTIME_SECURITY_SECRET',
        passed: true,
        severity: 'INFO',
        code: 'OK',
        message: `Validated ${parsed.length} previous HMAC rotation key(s).`,
        redactedPreview: `[REDACTED:entries=${parsed.length}]`,
      });
    } catch (err) {
      pushCheck({
        id: 'PRE-SESSION-ROTATION-KEYS',
        key: 'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
        classification: 'RUNTIME_SECURITY_SECRET',
        passed: false,
        severity: 'FAIL',
        code: 'INVALID_PREVIOUS_SECRETS_JSON',
        message: err instanceof Error ? err.message : 'Invalid VIGOR_SESSION_PREVIOUS_SECRETS_JSON.',
        redactedPreview: maskSecretPreview(rawPrevHmac),
      });
    }
  }

  const rawOrigins = (envMap.VIGOR_ALLOWED_ORIGINS || '').trim();
  if (rawOrigins) {
    const parts = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);
    let originsOk = parts.length > 0 && !parts.includes('*');
    let errMsg = '';
    if (parts.includes('*')) {
      errMsg = 'Wildcard * is strictly forbidden in VIGOR_ALLOWED_ORIGINS.';
    } else {
      for (const origin of parts) {
        try {
          const parsed = new URL(origin);
          const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
          if (parsed.protocol !== 'https:' && !(allowLoopback && isLoopback)) {
            originsOk = false;
            errMsg = `Origin '${origin}' must use https://.`;
            break;
          }
        } catch {
          originsOk = false;
          errMsg = `Origin '${origin}' is not a valid URL.`;
          break;
        }
      }
    }
    pushCheck({
      id: 'PRE-ALLOWED-ORIGINS',
      key: 'VIGOR_ALLOWED_ORIGINS',
      classification: 'RUNTIME_POLICY',
      passed: originsOk,
      severity: originsOk ? 'INFO' : 'FAIL',
      code: originsOk ? 'OK' : 'INVALID_ALLOWED_ORIGINS',
      message: originsOk
        ? `Validated ${parts.length} CORS origin(s): ${parts.join(', ')}`
        : errMsg,
      redactedPreview: parts.join(', '),
    });
  } else if (scope === 'full_server_runtime') {
    pushCheck({
      id: 'PRE-ALLOWED-ORIGINS',
      key: 'VIGOR_ALLOWED_ORIGINS',
      classification: 'RUNTIME_POLICY',
      passed: false,
      severity: 'FAIL',
      code: 'MISSING_ALLOWED_ORIGINS',
      message: 'VIGOR_ALLOWED_ORIGINS must be configured explicitly for full_server_runtime.',
    });
  }

  const failures = checks.filter(c => !c.passed && c.severity === 'FAIL');
  const warnings = checks.filter(c => c.severity === 'WARN' || (!c.passed && c.severity !== 'FAIL'));

  return {
    phase: '5.1.1',
    mode: 'CONFIG_PREFLIGHT_ZERO_NETWORK',
    scope,
    runtimeAuthMode,
    corsMode,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    networkCallsExecuted: 0,
    writeOperationsExecuted: 0,
    inferredRegion,
    authModeDetected,
    targetSummary: {
      projectId: rawProjectId && !isPlaceholderOrDummy(rawProjectId) ? rawProjectId : null,
      catalystEnvironment: catEnvValid ? rawCatEnv : null,
      vigorEnvironment: vigorEnvValid ? rawVigorEnv : null,
      apiDomain: apiUrlRes.origin,
      accountsUrl: accUrlRes.origin,
      clientAppZaidPresent: Boolean(rawZaid && !isPlaceholderOrDummy(rawZaid)),
    },
    checks,
    failures,
    warnings,
  };
}
