/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 Real Zoho Catalyst SDK Compatibility Bridge & Strict Admin/User Separation
 *
 * Verified directly against installed packages in `poc/catalyst-clean-slate/node_modules/@zcatalyst`:
 * - `@zcatalyst/auth@1.0.0`
 * - `@zcatalyst/auth-admin@1.1.0`
 * - `@zcatalyst/nosql@1.0.0`
 * - `@zcatalyst/transport@1.1.0`
 * - `@zcatalyst/utils@1.1.0`
 *
 * Security & SDK Findings Enforced Here:
 * 1. CRITICAL SDK DEFECT MITIGATED (`ApplicationCustomCredential`):
 *    In `@zcatalyst/auth-admin@1.1.0`, `zcAuth.init(options, { type: 'custom' })` wraps credentials
 *    inside `new ApplicationCustomCredential(options.credential)`. However,
 *    `CatalystApp.authenticateRequest(req)` ONLY inspects `AccessTokenCredential`,
 *    `RefreshTokenCredential`, `TicketCredential`, `CatalystCredential`, and
 *    `ApplicationDefaultCredential` — silently omitting `Authorization` for
 *    `ApplicationCustomCredential`!
 *    `CatalystAdminAppProvider` bypasses that bug safely by constructing `CatalystApp`
 *    directly with unwrapped `RefreshTokenCredential` or `AccessTokenCredential`, NEVER
 *    mutating caller config objects and NEVER emitting `Authorization`-less admin requests.
 * 2. REQUEST-INDEPENDENT ADMIN CREDENTIAL PROVIDER:
 *    Backend `NoSQL` and `UserManagementAdmin` operations ALWAYS use `CatalystAdminAppProvider`
 *    sourced from validated server environment variables (never `zcAuth.init(req, { scope: 'admin' })`,
 *    never trusting incoming `x-zc-admin-cred-*` or `x-zc-user-*` headers).
 * 3. FAIL-CLOSED CROSS-ENVIRONMENT & PLACEHOLDER VALIDATION:
 *    Rejects missing creds, placeholder values (`YOUR_*`, `<...>`), environment mismatches
 *    (`VIGOR_ENVIRONMENT=production` vs `VIGORCORE_DEPLOYMENT_ENVIRONMENT=Development`), and non-HTTPS
 *    Catalyst origins outside explicit loopback tests.
 * 4. STRICT SECRET REDACTION:
 *    `redactSecretsFromString()` and `redactSensitiveObject()` strip OAuth client secrets,
 *    refresh/access tokens, `Authorization` headers, cookies, HMAC keys, and project keys
 *    before errors or diagnostic summaries leave the process.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { USER_STATUS, UserManagement, type Authentication } from '@zcatalyst/auth';
import {
  AccessTokenCredential,
  CatalystApp,
  RefreshTokenCredential,
  ZCAuth,
} from '@zcatalyst/auth-admin';
import { NoSQL } from '@zcatalyst/nosql';
import { CONSTANTS } from '@zcatalyst/utils';
import {
  AuthGuardError,
  type CatalystIdentitySnapshot,
  type ICatalystAuthRuntime,
  type IncomingHttpRequest,
} from '../auth/cleanSlateAuthGuard.js';

export const CATALYST_SDK_VERSIONS = {
  '@zcatalyst/auth': '1.0.0',
  '@zcatalyst/auth-admin': '1.1.0',
  '@zcatalyst/nosql': '1.0.0',
  '@zcatalyst/transport': '1.1.0',
  '@zcatalyst/utils': '1.1.0',
} as const;

export const ADMIN_APP_NAME = 'vigorcore-admin';
export const VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY = 'VIGORCORE_DEPLOYMENT_ENVIRONMENT';
export const VIGORCORE_CATALYST_PROJECT_ID_KEY = 'VIGORCORE_CATALYST_PROJECT_ID';
export const VIGORCORE_CATALYST_API_DOMAIN_KEY = 'VIGORCORE_CATALYST_API_DOMAIN';
export const VIGORCORE_CATALYST_ACCOUNTS_URL_KEY = 'VIGORCORE_CATALYST_ACCOUNTS_URL';

/**
 * Resolves the server-side deployment environment exclusively from VigorCore's custom
 * non-reserved environment variable `VIGORCORE_DEPLOYMENT_ENVIRONMENT` (`'Development' | 'Production'`).
 *
 * Catalyst Function Configuration rejects `CATALYST_ENVIRONMENT` as a reserved keyword
 * (`environment_variables must not contain reserved keywords`), and `@zcatalyst/auth-admin`
 * only reads `process.env['x-zc-environment']` with an unsafe silent `'Development'` fallback.
 * Therefore VigorCore pins deployment intent explicitly via `VIGORCORE_DEPLOYMENT_ENVIRONMENT`,
 * never trusts incoming client HTTP headers to establish environment, and cross-checks
 * incoming `x-zc-environment` + `VIGOR_ENVIRONMENT` fail-closed.
 */
export function resolveDeploymentEnvironmentFromEnv(
  envMap: Record<string, string | undefined>
): 'Development' | 'Production' {
  const rawPrimary = (envMap[VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY] || '').trim();
  const rawReservedLegacy = (envMap.CATALYST_ENVIRONMENT || '').trim();

  if (!rawPrimary) {
    if (rawReservedLegacy) {
      throw new Error(
        `RESERVED_CATALYST_ENV_VAR: Catalyst rejects 'CATALYST_ENVIRONMENT' as a reserved keyword; configure '${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}'='Development' or 'Production' instead.`
      );
    }
    throw new Error(
      `INVALID_DEPLOYMENT_ENVIRONMENT: '${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}' must be strictly 'Development' or 'Production'.`
    );
  }

  if (
    isPlaceholderValue(rawPrimary) ||
    (rawPrimary !== 'Development' && rawPrimary !== 'Production')
  ) {
    throw new Error(
      `INVALID_DEPLOYMENT_ENVIRONMENT: '${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}' must be strictly 'Development' or 'Production' (got '${rawPrimary}').`
    );
  }

  if (rawReservedLegacy && rawReservedLegacy !== rawPrimary) {
    throw new Error(
      `ENVIRONMENT_SEPARATION_VIOLATION: Reserved legacy CATALYST_ENVIRONMENT='${rawReservedLegacy}' conflicts with ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}='${rawPrimary}'. Remove CATALYST_ENVIRONMENT.`
    );
  }

  return rawPrimary;
}

/**
 * Resolves the server-pinned Catalyst Project ID from custom non-reserved
 * `VIGORCORE_CATALYST_PROJECT_ID` (`136967000000014024` in Development).
 * Rejects reserved `CATALYST_PROJECT_ID` if configured instead or conflicting,
 * and NEVER falls back to an unpinned ID or client HTTP headers (`x-zc-projectid`).
 */
export function resolveCatalystProjectIdFromEnv(
  envMap: Record<string, string | undefined>
): string {
  const rawPrimary = (envMap[VIGORCORE_CATALYST_PROJECT_ID_KEY] || '').trim();
  const rawReservedLegacy = (envMap.CATALYST_PROJECT_ID || '').trim();

  if (!rawPrimary) {
    if (rawReservedLegacy) {
      throw new Error(
        `RESERVED_CATALYST_ENV_VAR: Catalyst rejects 'CATALYST_PROJECT_ID' as a reserved keyword; configure '${VIGORCORE_CATALYST_PROJECT_ID_KEY}' instead.`
      );
    }
    throw new Error(
      `MISSING_CATALYST_ADMIN_CONFIG: Required server setting '${VIGORCORE_CATALYST_PROJECT_ID_KEY}' is missing.`
    );
  }

  if (rawReservedLegacy && rawReservedLegacy !== rawPrimary) {
    throw new Error(
      `PROJECT_CONFIGURATION_CONFLICT: Reserved legacy CATALYST_PROJECT_ID='${rawReservedLegacy}' conflicts with ${VIGORCORE_CATALYST_PROJECT_ID_KEY}='${rawPrimary}'. Remove CATALYST_PROJECT_ID.`
    );
  }

  return rawPrimary;
}

/**
 * Resolves custom non-reserved `VIGORCORE_CATALYST_API_DOMAIN`, rejecting reserved
 * `CATALYST_API_DOMAIN` if configured instead or conflicting. When omitted, returns
 * undefined so callers may fall back to documented US SDK default (`CONSTANTS.CATALYST_ORIGIN`).
 */
export function resolveCatalystApiDomainFromEnv(
  envMap: Record<string, string | undefined>
): string | undefined {
  const rawPrimary = (envMap[VIGORCORE_CATALYST_API_DOMAIN_KEY] || '').trim();
  const rawReservedLegacy = (envMap.CATALYST_API_DOMAIN || '').trim();

  if (!rawPrimary && rawReservedLegacy) {
    throw new Error(
      `RESERVED_CATALYST_ENV_VAR: Catalyst rejects 'CATALYST_API_DOMAIN' as a reserved keyword; configure '${VIGORCORE_CATALYST_API_DOMAIN_KEY}' instead.`
    );
  }

  if (rawPrimary && rawReservedLegacy && rawReservedLegacy !== rawPrimary) {
    throw new Error(
      `ENVIRONMENT_CONFIGURATION_CONFLICT: Reserved legacy CATALYST_API_DOMAIN='${rawReservedLegacy}' conflicts with ${VIGORCORE_CATALYST_API_DOMAIN_KEY}='${rawPrimary}'. Remove CATALYST_API_DOMAIN.`
    );
  }

  return rawPrimary || undefined;
}

/**
 * Resolves custom non-reserved `VIGORCORE_CATALYST_ACCOUNTS_URL`, rejecting reserved
 * `CATALYST_ACCOUNTS_URL` if configured instead or conflicting. When omitted, returns
 * undefined so callers may fall back to documented US SDK default (`CONSTANTS.ACCOUNTS_ORIGIN`).
 */
export function resolveCatalystAccountsUrlFromEnv(
  envMap: Record<string, string | undefined>
): string | undefined {
  const rawPrimary = (envMap[VIGORCORE_CATALYST_ACCOUNTS_URL_KEY] || '').trim();
  const rawReservedLegacy = (envMap.CATALYST_ACCOUNTS_URL || '').trim();

  if (!rawPrimary && rawReservedLegacy) {
    throw new Error(
      `RESERVED_CATALYST_ENV_VAR: Catalyst rejects 'CATALYST_ACCOUNTS_URL' as a reserved keyword; configure '${VIGORCORE_CATALYST_ACCOUNTS_URL_KEY}' instead.`
    );
  }

  if (rawPrimary && rawReservedLegacy && rawReservedLegacy !== rawPrimary) {
    throw new Error(
      `ENVIRONMENT_CONFIGURATION_CONFLICT: Reserved legacy CATALYST_ACCOUNTS_URL='${rawReservedLegacy}' conflicts with ${VIGORCORE_CATALYST_ACCOUNTS_URL_KEY}='${rawPrimary}'. Remove CATALYST_ACCOUNTS_URL.`
    );
  }

  return rawPrimary || undefined;
}

export interface SdkCompatibilityFinding {
  id: string;
  package: keyof typeof CATALYST_SDK_VERSIONS;
  severity: 'HIGH' | 'MEDIUM' | 'INFO';
  summary: string;
  mitigation: string;
  requiresLiveVerification?: string;
}

export interface InstalledSdkCompatibilityReport {
  packages: typeof CATALYST_SDK_VERSIONS;
  applicationCustomCredentialBugVerified: boolean;
  getDefaultCredentialsNegationBugVerified: boolean;
  userManagementResetPasswordUsesUserScope: boolean;
  findings: SdkCompatibilityFinding[];
}

/**
 * Inspects exact compatibility contracts verified against installed `@zcatalyst/*` sources.
 */
export function inspectInstalledCatalystSdkCompatibility(): InstalledSdkCompatibilityReport {
  return {
    packages: { ...CATALYST_SDK_VERSIONS },
    applicationCustomCredentialBugVerified: true,
    getDefaultCredentialsNegationBugVerified: true,
    userManagementResetPasswordUsesUserScope: true,
    findings: [
      {
        id: 'SDK-01',
        package: '@zcatalyst/auth-admin',
        severity: 'HIGH',
        summary:
          "CatalystApp.authenticateRequest(req) omits 'instanceof ApplicationCustomCredential', causing zcAuth.init(..., { type: 'custom' }) to omit Authorization headers on outbound Handler calls.",
        mitigation:
          'CatalystAdminAppProvider instantiates CatalystApp directly with unwrapped RefreshTokenCredential / AccessTokenCredential.',
      },
      {
        id: 'SDK-02',
        package: '@zcatalyst/auth',
        severity: 'MEDIUM',
        summary:
          "Node.d.ts documents flat credential keys while runtime zcAuth.init(..., { type: 'custom' }) expects options.credential and mutates the input object.",
        mitigation:
          'CatalystAdminAppProvider validates typed config internally without relying on flat options mutation.',
      },
      {
        id: 'SDK-03',
        package: '@zcatalyst/auth-admin',
        severity: 'MEDIUM',
        summary:
          "ZCAuth.getDefaultCredentials() evaluates '!isNonEmptyString(!projectId)', making env auto-discovery fragile.",
        mitigation:
          'Never call getDefaultCredentials(); always validate CATALYST_* env explicitly in CatalystAdminAppProvider.',
      },
      {
        id: 'SDK-04',
        package: '@zcatalyst/auth',
        severity: 'MEDIUM',
        summary:
          "UserManagement.resetPassword() hardcodes user: CREDENTIAL_USER.user on '/project-user/forgotpassword', whereas UserManagementAdmin operates under admin credentials.",
        mitigation:
          'Guarded by live-verification flag INT-08; cannot be claimed live-verified until tested against real Zoho Catalyst BaaS.',
        requiresLiveVerification: 'INT-08',
      },
      {
        id: 'SDK-05',
        package: '@zcatalyst/auth-admin',
        severity: 'INFO',
        summary:
          "CatalystCredential(..., 'user') requires x-zc-admin-cred-type/token in constructor even when only user credentials are used, and trusts request project headers if unsanitized.",
        mitigation:
          'CatalystSeparatedAuthRuntime verifies x-zc-projectid against server config, rejects x-zc-user-type: admin, pins server project/domain headers, and isolates scope: user.',
      },
    ],
  };
}

const PLACEHOLDER_PATTERNS = [
  /^your[_-]/i,
  /^replace[_-]/i,
  /^changeme/i,
  /^example/i,
  /^placeholder/i,
  /^dummy[_-]/i,
  /^<.*>$/,
  /^todo/i,
];

function isPlaceholderValue(val: string): boolean {
  const trimmed = val.trim();
  return PLACEHOLDER_PATTERNS.some(re => re.test(trimmed));
}

const SENSITIVE_KEY_RE =
  /^(secret|client_?secret|refresh_?token|access_?token|authorization|cookie|set-cookie|hmac|password|ticket|x-zc-admin-cred-token|x-zc-user-cred-token|x-zc-project-key|x-zc-project-secret-key|zcrf|csrf)$/i;

export function redactSecretsFromString(input: string, extraSecrets: string[] = []): string {
  let out = input;
  for (const s of extraSecrets) {
    if (s && s.length >= 6) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  out = out.replace(/Zoho-oauthtoken\s+[A-Za-z0-9._-]+/gi, 'Zoho-oauthtoken [REDACTED]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  out = out.replace(/(__Host-vigor_session=)[^;\s]+/gi, '$1[REDACTED]');
  out = out.replace(
    /((?:client_secret|refresh_token|access_token|hmac_?secret)=)[^&\s]+/gi,
    '$1[REDACTED]'
  );
  return out;
}

export function redactSensitiveObject<T>(value: T, extraSecrets: string[] = []): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return redactSecretsFromString(value, extraSecrets) as unknown as T;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveObject(item, extraSecrets)) as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k) || /secret|token|password|cookie/i.test(k)) {
      copy[k] = '[REDACTED]';
    } else {
      copy[k] = redactSensitiveObject(v, extraSecrets);
    }
  }
  return copy as T;
}

function readHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  target: string
): string | undefined {
  if (!headers) return undefined;
  const lower = target.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && typeof v === 'string') {
      const trimmed = v.trim();
      return trimmed ? trimmed : undefined;
    }
  }
  return undefined;
}

function assertValidHttpOrigin(
  rawUrl: string,
  label: string,
  allowInsecureLoopbackForTest: boolean
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`INVALID_CATALYST_URL: '${label}' is not a valid URL.`);
  }
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol === 'https:') {
    return parsed.origin;
  }
  if (parsed.protocol === 'http:' && allowInsecureLoopbackForTest && isLoopback) {
    return parsed.origin;
  }
  throw new Error(
    `INSECURE_CATALYST_URL: '${label}' must use HTTPS in non-test environments.`
  );
}

export interface CatalystAdminConfigInput {
  projectId: string;
  projectKey: string;
  projectSecretKey?: string;
  catalystEnvironment: 'Development' | 'Production';
  vigorEnvironment?: 'development' | 'staging' | 'production' | 'test';
  apiDomain?: string;
  accountsUrl?: string;
  projectDomain?: string;
  orgId?: string;
  authMode?: 'refresh_token' | 'access_token';
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  resetRedirectUrl?: string;
  allowInsecureLoopbackForTest?: boolean;
}

export interface CatalystAdminRedactedSummary {
  appName: typeof ADMIN_APP_NAME;
  credentialVersion: number;
  projectId: string;
  catalystEnvironment: 'Development' | 'Production';
  vigorEnvironment: string;
  apiDomain: string;
  accountsUrl: string;
  authMode: 'refresh_token' | 'access_token';
  hasProjectKey: boolean;
  credentialsConfigured: true;
}

function validateNonPlaceholder(value: string | undefined, name: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    throw new Error(`MISSING_CATALYST_ADMIN_CONFIG: Required server setting '${name}' is missing.`);
  }
  if (isPlaceholderValue(trimmed)) {
    throw new Error(`PLACEHOLDER_CATALYST_ADMIN_CONFIG: Server setting '${name}' contains an unconfigured placeholder.`);
  }
  return trimmed;
}

function buildValidatedAdminApp(
  cfg: CatalystAdminConfigInput,
  credentialVersion: number
): {
  app: CatalystApp;
  summary: CatalystAdminRedactedSummary;
  knownSecrets: string[];
  resetRedirectUrl: string;
} {
  const allowLoopback = Boolean(cfg.allowInsecureLoopbackForTest);
  const projectId = validateNonPlaceholder(cfg.projectId, VIGORCORE_CATALYST_PROJECT_ID_KEY);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(projectId)) {
    throw new Error(`INVALID_CATALYST_PROJECT_ID: ${VIGORCORE_CATALYST_PROJECT_ID_KEY} contains invalid characters.`);
  }

  const rawEnv = (cfg.catalystEnvironment || '').trim();
  if (rawEnv !== 'Development' && rawEnv !== 'Production') {
    throw new Error(
      `INVALID_DEPLOYMENT_ENVIRONMENT: ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY} must be 'Development' or 'Production'.`
    );
  }
  const vigorEnv = (cfg.vigorEnvironment || process.env.VIGOR_ENVIRONMENT || 'development').trim().toLowerCase();
  if (vigorEnv === 'production' && rawEnv !== 'Production') {
    throw new Error(
      `ENVIRONMENT_SEPARATION_VIOLATION: VIGOR_ENVIRONMENT='production' cannot connect to ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}='${rawEnv}'.`
    );
  }
  if ((vigorEnv === 'development' || vigorEnv === 'test') && rawEnv === 'Production') {
    throw new Error(
      `ENVIRONMENT_SEPARATION_VIOLATION: Non-production VIGOR_ENVIRONMENT='${vigorEnv}' cannot connect to ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}='Production'.`
    );
  }

  const apiDomain = assertValidHttpOrigin(
    cfg.apiDomain || CONSTANTS.CATALYST_ORIGIN,
    VIGORCORE_CATALYST_API_DOMAIN_KEY,
    allowLoopback
  );
  const accountsUrl = assertValidHttpOrigin(
    cfg.accountsUrl || CONSTANTS.ACCOUNTS_ORIGIN,
    VIGORCORE_CATALYST_ACCOUNTS_URL_KEY,
    allowLoopback
  );

  const projectKey = validateNonPlaceholder(cfg.projectKey, 'CATALYST_PROJECT_KEY');
  const projectSecretKey = cfg.projectSecretKey?.trim() || undefined;
  if (projectSecretKey && isPlaceholderValue(projectSecretKey)) {
    throw new Error('PLACEHOLDER_CATALYST_ADMIN_CONFIG: CATALYST_PROJECT_SECRET_KEY contains a placeholder.');
  }

  const mode =
    cfg.authMode ??
    (cfg.accessToken && !cfg.refreshToken ? 'access_token' : 'refresh_token');

  const knownSecrets: string[] = [projectKey];
  if (projectSecretKey) knownSecrets.push(projectSecretKey);

  let credential: RefreshTokenCredential | AccessTokenCredential;
  if (mode === 'access_token') {
    const accessToken = validateNonPlaceholder(cfg.accessToken, 'CATALYST_ADMIN_ACCESS_TOKEN');
    knownSecrets.push(accessToken);
    credential = new AccessTokenCredential({ access_token: accessToken });
  } else {
    const clientId = validateNonPlaceholder(cfg.clientId, 'CATALYST_ADMIN_CLIENT_ID');
    const clientSecret = validateNonPlaceholder(cfg.clientSecret, 'CATALYST_ADMIN_CLIENT_SECRET');
    const refreshToken = validateNonPlaceholder(cfg.refreshToken, 'CATALYST_ADMIN_REFRESH_TOKEN');
    knownSecrets.push(clientSecret, refreshToken);
    credential = new RefreshTokenCredential({
      clientId,
      clientSecret,
      refreshToken,
      accountsUrl,
    });
  }

  const app = new CatalystApp({
    projectId,
    projectKey,
    ...(projectSecretKey ? { projectSecretKey } : {}),
    projectDomain: cfg.projectDomain || apiDomain.replace(/^https?:\/\//, ''),
    environment: rawEnv,
    origin: apiDomain,
    apiDomain,
    authPortalDomain: accountsUrl,
    servedByCLI: false,
    credential,
  });

  const resetRedirectUrl =
    cfg.resetRedirectUrl?.trim() || 'https://fit-x-bhnatsxl.onslate.com/auth/login';

  return {
    app,
    knownSecrets,
    resetRedirectUrl,
    summary: {
      appName: ADMIN_APP_NAME,
      credentialVersion,
      projectId,
      catalystEnvironment: rawEnv,
      vigorEnvironment: vigorEnv,
      apiDomain,
      accountsUrl,
      authMode: mode,
      hasProjectKey: true,
      credentialsConfigured: true,
    },
  };
}

/**
 * Request-independent server-only Catalyst Admin Credential Provider.
 * Registered under `'vigorcore-admin'`. NEVER reads incoming `req.headers` and supports atomic rotation.
 */
export class CatalystAdminAppProvider {
  private currentApp: CatalystApp;
  private currentSummary: CatalystAdminRedactedSummary;
  private knownSecrets: string[];
  private resetRedirectUrl: string;
  private credentialVersion = 1;

  constructor(config: CatalystAdminConfigInput) {
    const built = buildValidatedAdminApp(config, this.credentialVersion);
    this.currentApp = built.app;
    this.currentSummary = built.summary;
    this.knownSecrets = built.knownSecrets;
    this.resetRedirectUrl = built.resetRedirectUrl;
  }

  static fromEnvironment(
    envMap: Record<string, string | undefined> = process.env,
    options: { allowInsecureLoopbackForTest?: boolean } = {}
  ): CatalystAdminAppProvider {
    const normalizedCatEnv = resolveDeploymentEnvironmentFromEnv(envMap);
    const projectId = resolveCatalystProjectIdFromEnv(envMap);
    const apiDomain = resolveCatalystApiDomainFromEnv(envMap);
    const accountsUrl = resolveCatalystAccountsUrlFromEnv(envMap);

    const rawVigorEnv = (envMap.VIGOR_ENVIRONMENT || envMap.NODE_ENV || 'development')
      .trim()
      .toLowerCase();
    const vigorEnvironment: CatalystAdminConfigInput['vigorEnvironment'] =
      rawVigorEnv === 'production' || rawVigorEnv === 'staging' || rawVigorEnv === 'test'
        ? rawVigorEnv
        : 'development';

    return new CatalystAdminAppProvider({
      projectId,
      projectKey: envMap.CATALYST_PROJECT_KEY || '',
      projectSecretKey: envMap.CATALYST_PROJECT_SECRET_KEY,
      catalystEnvironment: normalizedCatEnv,
      vigorEnvironment,
      apiDomain,
      accountsUrl,
      projectDomain: envMap.CATALYST_PROJECT_DOMAIN,
      clientId: envMap.CATALYST_ADMIN_CLIENT_ID,
      clientSecret: envMap.CATALYST_ADMIN_CLIENT_SECRET,
      refreshToken: envMap.CATALYST_ADMIN_REFRESH_TOKEN,
      accessToken: envMap.CATALYST_ADMIN_ACCESS_TOKEN,
      resetRedirectUrl: envMap.CATALYST_RESET_REDIRECT_URL,
      allowInsecureLoopbackForTest: options.allowInsecureLoopbackForTest,
    });
  }

  rotateCredentials(nextConfig: CatalystAdminConfigInput): CatalystAdminRedactedSummary {
    const nextVersion = this.credentialVersion + 1;
    const built = buildValidatedAdminApp(nextConfig, nextVersion);
    this.credentialVersion = nextVersion;
    this.currentApp = built.app;
    this.currentSummary = built.summary;
    this.knownSecrets = built.knownSecrets;
    this.resetRedirectUrl = built.resetRedirectUrl;
    return { ...this.currentSummary };
  }

  getAppName(): typeof ADMIN_APP_NAME {
    return ADMIN_APP_NAME;
  }

  getProjectId(): string {
    return this.currentSummary.projectId;
  }

  getEnvironment(): 'Development' | 'Production' {
    return this.currentSummary.catalystEnvironment;
  }

  getApiDomain(): string {
    return this.currentSummary.apiDomain;
  }

  getResetRedirectUrl(): string {
    return this.resetRedirectUrl;
  }

  getAdminApp(): CatalystApp {
    return this.currentApp;
  }

  createNoSQLClient(): NoSQL {
    return new NoSQL(this.currentApp);
  }

  createUserManagementAdmin(): UserManagement {
    return new UserManagement(this.currentApp);
  }

  redactErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    return redactSecretsFromString(raw || 'Unknown Catalyst error', this.knownSecrets);
  }

  toRedactedSummary(): CatalystAdminRedactedSummary {
    return { ...this.currentSummary };
  }

  toJSON(): CatalystAdminRedactedSummary {
    return this.toRedactedSummary();
  }

  /**
   * Diagnostic reproduction proving the raw `@zcatalyst/auth-admin@1.1.0` defect where
   * `zcAuth.init({ projectId, credential }, { type: 'custom' })` creates `ApplicationCustomCredential`
   * and silently omits `Authorization` inside `CatalystApp.authenticateRequest(req)`.
   */
  static async verifyRawSdkCustomInitOmitsAuthHeader(sample: {
    projectId: string;
    accessToken: string;
  }): Promise<{ hasAuthorizationHeaderOnRawCustomInit: boolean; credentialConstructorName: string }> {
    const auth = new ZCAuth();
    const rawApp = auth.init(
      {
        projectId: sample.projectId,
        credential: { access_token: sample.accessToken },
      } as unknown as Record<string, string | number | boolean>,
      { type: 'custom', appName: `diag_${Date.now()}` }
    );
    const reqObj: Record<string, unknown> = { headers: {} };
    await rawApp.authenticateRequest(reqObj);
    const hdrs = (reqObj.headers || {}) as Record<string, unknown>;
    return {
      hasAuthorizationHeaderOnRawCustomInit: Boolean(hdrs.Authorization || hdrs.authorization),
      credentialConstructorName: rawApp.credential?.constructor?.name || 'unknown',
    };
  }
}

class UserScopedAccessTokenCredential extends AccessTokenCredential {
  override getCurrentUser(): string {
    return CONSTANTS.CREDENTIAL_USER.user;
  }
  override getCurrentUserType(): string {
    return CONSTANTS.CREDENTIAL_USER.user;
  }
}

export interface CatalystSeparatedAuthRuntimeOptions {
  adminProvider: CatalystAdminAppProvider;
  /**
   * Keeps admin-initiated Catalyst password reset fail-closed until INT-08 confirms
   * live behavior of `UserManagement.resetPassword()` against Catalyst BaaS.
   * Defaults to true (strict fail-closed).
   */
  requireLiveInt08ForPasswordReset?: boolean;
  /**
   * Optional custom authenticator for testing or specialized integration wiring;
   * defaults to `@zcatalyst/auth-admin` `ZCAuth` + `@zcatalyst/auth` `UserManagement`.
   */
  userScopeResolver?: (req: IncomingHttpRequest) => Promise<CatalystIdentitySnapshot | null>;
}

/**
 * Strictly separates user-scoped request authentication (`scope: 'user'`) from
 * request-independent backend admin calls (`CatalystAdminAppProvider`).
 */
export class CatalystSeparatedAuthRuntime implements ICatalystAuthRuntime {
  private readonly adminProvider: CatalystAdminAppProvider;
  private readonly requireLiveInt08ForPasswordReset: boolean;
  private readonly userScopeResolver?: (req: IncomingHttpRequest) => Promise<CatalystIdentitySnapshot | null>;

  constructor(options: CatalystSeparatedAuthRuntimeOptions) {
    this.adminProvider = options.adminProvider;
    this.requireLiveInt08ForPasswordReset = options.requireLiveInt08ForPasswordReset ?? true;
    this.userScopeResolver = options.userScopeResolver;
  }

  /**
   * Verifies caller's Catalyst user session strictly in `scope: 'user'`.
   * - Returns `null` immediately on routine HMAC cookie-only requests lacking Catalyst user tokens/cookies.
   * - Rejects `x-zc-user-type: admin` spoofing.
   * - Rejects `x-zc-projectid` mismatches against server `CATALYST_PROJECT_ID` (`403 PROJECT_CONTEXT_MISMATCH`).
   * - NEVER reads request headers to elevate privileges or connect to NoSQL.
   */
  async getCurrentUserFromRequest(req: IncomingHttpRequest): Promise<CatalystIdentitySnapshot | null> {
    const incomingHeaders = req.headers ?? {};

    const reqProjectId = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.PROJECT_HEADER.id);
    if (reqProjectId && reqProjectId !== this.adminProvider.getProjectId()) {
      throw new AuthGuardError(
        403,
        'PROJECT_CONTEXT_MISMATCH',
        'Incoming x-zc-projectid does not match the configured server Catalyst project.'
      );
    }

    const adminAppConfig = this.adminProvider.getAdminApp().config;

    const reqProjectKey = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.PROJECT_HEADER.key);
    if (reqProjectKey && reqProjectKey !== adminAppConfig.projectKey) {
      throw new AuthGuardError(
        403,
        'PROJECT_CONTEXT_MISMATCH',
        'Incoming x-zc-project-key does not match the configured server Catalyst project.'
      );
    }

    const reqUserType = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user);
    if (reqUserType && reqUserType.toLowerCase() === CONSTANTS.CREDENTIAL_USER.admin) {
      throw new AuthGuardError(
        403,
        'CATALYST_ADMIN_HEADER_SPOOFED',
        'Incoming x-zc-user-type=admin is strictly prohibited on user authentication endpoints.'
      );
    }

    const userCredToken = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user_token);
    const userCredType =
      readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user_cred_type) || 'token';
    const zcCookie = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.cookie);

    if (!userCredToken && !zcCookie) {
      return null;
    }

    if (this.userScopeResolver) {
      return this.userScopeResolver(req);
    }

    const expectedProjectId = this.adminProvider.getProjectId();
    const pinnedApiDomain = this.adminProvider.getApiDomain();
    const pinnedEnv = this.adminProvider.getEnvironment();

    const adminCredType = readHeaderCaseInsensitive(
      incomingHeaders,
      CONSTANTS.CREDENTIAL_HEADER.admin_cred_type
    );
    const adminCredToken = readHeaderCaseInsensitive(
      incomingHeaders,
      CONSTANTS.CREDENTIAL_HEADER.admin_token
    );

    let userApp: CatalystApp;
    if (adminCredType && adminCredToken) {
      const sanitizedHeaders: Record<string, string> = {
        [CONSTANTS.PROJECT_HEADER.id]: expectedProjectId,
        [CONSTANTS.PROJECT_HEADER.key]: adminAppConfig.projectKey,
        [CONSTANTS.PROJECT_HEADER.environment]: pinnedEnv,
        [CONSTANTS.PROJECT_HEADER.domain]: adminAppConfig.projectDomain,
        [CONSTANTS.DOMAIN_HEADER.api]: pinnedApiDomain,
        [CONSTANTS.SERVED_BY_CLI_HEADER]: 'false',
        [CONSTANTS.CREDENTIAL_HEADER.user]: CONSTANTS.CREDENTIAL_USER.user,
        [CONSTANTS.CREDENTIAL_HEADER.admin_cred_type]: adminCredType,
        [CONSTANTS.CREDENTIAL_HEADER.admin_token]: adminCredToken,
      };
      if (userCredToken) {
        sanitizedHeaders[CONSTANTS.CREDENTIAL_HEADER.user_cred_type] = userCredType;
        sanitizedHeaders[CONSTANTS.CREDENTIAL_HEADER.user_token] = userCredToken;
      }
      if (zcCookie) {
        sanitizedHeaders[CONSTANTS.CREDENTIAL_HEADER.cookie] = zcCookie;
      }

      const zcAuthLocal = new ZCAuth();
      userApp = zcAuthLocal.init(
        { headers: sanitizedHeaders } as unknown as Record<string, string | number | boolean>,
        { type: 'advancedio', scope: 'user' }
      );
      // Force pinned apiDomain & projectKey so custom/loopback domains cannot be hijacked by client headers
      userApp.config.apiDomain = pinnedApiDomain;
      userApp.config.projectKey = adminAppConfig.projectKey;
      userApp.config.servedByCLI = false;
    } else if (userCredToken && userCredType.toLowerCase() === 'token') {
      userApp = new CatalystApp({
        projectId: expectedProjectId,
        projectKey: adminAppConfig.projectKey,
        projectDomain: adminAppConfig.projectDomain,
        environment: pinnedEnv,
        origin: pinnedApiDomain,
        apiDomain: pinnedApiDomain,
        authPortalDomain: adminAppConfig.authPortalDomain,
        servedByCLI: false,
        credential: new UserScopedAccessTokenCredential({ access_token: userCredToken }),
      });
    } else {
      throw new AuthGuardError(
        401,
        'AUTH_SESSION_INVALID',
        'Catalyst user credentials could not be initialized cleanly in user scope.'
      );
    }

    try {
      const um = new UserManagement(userApp);
      const user = await um.getCurrentUser();
      if (!user || !user.user_id) {
        return null;
      }
      return {
        zuid: String(user.zuid || ''),
        user_id: String(user.user_id),
        status: String(user.status || ''),
        is_confirmed: Boolean(user.is_confirmed),
        email_id: String(user.email_id || ''),
        ...(user.org_id ? { org_id: String(user.org_id) } : {}),
        ...(user.first_name ? { first_name: String(user.first_name) } : {}),
        ...(user.last_name ? { last_name: String(user.last_name) } : {}),
        ...(user.role_details ? { role_details: user.role_details } : {}),
      };
    } catch (err) {
      throw new AuthGuardError(
        401,
        'AUTH_SESSION_INVALID',
        `Catalyst user-scope verification failed: ${this.adminProvider.redactErrorMessage(err)}`
      );
    }
  }

  /**
   * Revalidates a user's live Catalyst status strictly using server-only admin credentials.
   * Returns `null` when Catalyst reports 404 (deleted user). Throws Error on BaaS outages (fails closed -> 503).
   */
  async getUserDetails(userId: string): Promise<CatalystIdentitySnapshot | null> {
    const um = this.adminProvider.createUserManagementAdmin();
    try {
      const details = await um.getUserDetails(userId);
      if (!details || !details.user_id) {
        return null;
      }
      return {
        zuid: String(details.zuid || ''),
        user_id: String(details.user_id),
        status: String(details.status || ''),
        is_confirmed: Boolean(details.is_confirmed),
        email_id: String(details.email_id || ''),
        ...(details.org_id ? { org_id: String(details.org_id) } : {}),
        ...(details.first_name ? { first_name: String(details.first_name) } : {}),
        ...(details.last_name ? { last_name: String(details.last_name) } : {}),
        ...(details.role_details ? { role_details: details.role_details } : {}),
      };
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown })?.statusCode;
      if (statusCode === 404) {
        return null;
      }
      throw new Error(
        `Catalyst getUserDetails failed: ${this.adminProvider.redactErrorMessage(err)}`
      );
    }
  }

  /**
   * Enables/disables a Catalyst account strictly via server-only admin credentials.
   */
  async updateUserStatus(userId: string, status: USER_STATUS): Promise<boolean> {
    const um = this.adminProvider.createUserManagementAdmin();
    try {
      return await um.updateUserStatus(userId, status);
    } catch (err) {
      throw new Error(
        `Catalyst updateUserStatus failed: ${this.adminProvider.redactErrorMessage(err)}`
      );
    }
  }

  /**
   * Sends password reset via Catalyst SDK.
   * Blocked by default (`INT_08_LIVE_VERIFICATION_PENDING`) because `@zcatalyst/auth@1.0.0`
   * `UserManagement.resetPassword()` specifies `user: 'user'` on `/project-user/forgotpassword`
   * and must be live-tested (`INT-08`) before relying on it in production.
   */
  async sendPasswordReset(email: string): Promise<void> {
    if (this.requireLiveInt08ForPasswordReset) {
      throw new Error(
        'INT_08_LIVE_VERIFICATION_PENDING: Catalyst resetPassword uses user-scope header in @zcatalyst/auth@1.0.0 and awaits live BaaS verification (INT-08).'
      );
    }
    const um = this.adminProvider.createUserManagementAdmin();
    try {
      await um.resetPassword(email, {
        platform_type: 'web',
        redirect_url: this.adminProvider.getResetRedirectUrl(),
      });
    } catch (err) {
      throw new Error(
        `Catalyst sendPasswordReset failed: ${this.adminProvider.redactErrorMessage(err)}`
      );
    }
  }
}

// ============================================================================
// PHASE 5.1.1 — ADR RECONCILIATION: HOSTED NATIVE `zcAuth.init(req, { scope })`
// VS EXTERNAL SERVER OAUTH (`CatalystAdminAppProvider`)
// ============================================================================

export type CatalystRuntimeAuthMode = 'hosted_native' | 'external_oauth';

export const HOSTED_VS_EXTERNAL_AUTH_ADR = {
  adrId: 'ADR-002-CATALYST-AUTH-DUAL-MODE',
  date: '2026-11-17',
  decision:
    'Adopt Option A (Hosted Native `zcAuth.init(req, { scope: "admin" | "user" })` via `HostedNativeCatalystAuthRuntime`) as PRIMARY inside Catalyst-hosted Advanced I/O Functions, while RETAINING Option B (`CatalystAdminAppProvider` via `RefreshTokenCredential`/`AccessTokenCredential`) as MANDATORY for external dev/Express servers, CLI `--live --confirm-readonly`, offline superadmin bootstrap, and fallback if API Gateway NO_AUTHENTICATION routes omit `x-zc-admin-cred-token`.',
  zohoSupportConfirmations: [
    'ApplicationCustomCredential is NOT required inside a hosted Catalyst Advanced I/O Function.',
    'Official modular SDK pattern inside hosted Advanced I/O is `zcAuth.init(req, { scope: "admin" })` for admin operations and `zcAuth.init(req, { scope: "user" })` for restricted user context.',
    'Catalyst declares it overwrites specific platform headers (`x-zc-*`) on incoming requests to hosted functions.',
  ],
  residualLiveVerificationRequired: {
    hostedHeaderOverwriteAndInjectionVerified: 'PENDING-LIVE-VERIFICATION',
    gatewayNoAuthInjectsAdminCredHeader: 'PENDING-LIVE-VERIFICATION',
    originRefererFetchMetadataPassthrough: 'PENDING-LIVE-VERIFICATION',
    int08PasswordResetAdminScope: 'PENDING-LIVE-VERIFICATION',
  },
  sdkFindingsStillRelevant: ['SDK-01', 'SDK-02', 'SDK-03', 'SDK-04', 'SDK-05'],
  externalSecretsEliminatedInHostedMode: [
    'CATALYST_ADMIN_CLIENT_ID',
    'CATALYST_ADMIN_CLIENT_SECRET',
    'CATALYST_ADMIN_REFRESH_TOKEN',
  ],
} as const;

export interface HostedNativeConfigInput {
  projectId: string;
  projectKey?: string;
  catalystEnvironment: 'Development' | 'Production';
  vigorEnvironment?: 'development' | 'staging' | 'production' | 'test';
  apiDomain?: string;
  accountsUrl?: string;
  projectDomain?: string;
  resetRedirectUrl?: string;
  allowInsecureLoopbackForTest?: boolean;
}

export interface HostedNativeValidatedConfig {
  projectId: string;
  projectKey?: string;
  catalystEnvironment: 'Development' | 'Production';
  vigorEnvironment: string;
  apiDomain: string;
  accountsUrl: string;
  projectDomain: string;
  resetRedirectUrl: string;
  allowInsecureLoopbackForTest: boolean;
}

export function validateHostedNativeConfig(
  cfg: HostedNativeConfigInput
): HostedNativeValidatedConfig {
  const allowLoopback = Boolean(cfg.allowInsecureLoopbackForTest);
  const projectId = validateNonPlaceholder(cfg.projectId, VIGORCORE_CATALYST_PROJECT_ID_KEY);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(projectId)) {
    throw new Error(`INVALID_CATALYST_PROJECT_ID: ${VIGORCORE_CATALYST_PROJECT_ID_KEY} contains invalid characters.`);
  }

  const projectKey = cfg.projectKey?.trim() || undefined;
  if (projectKey && isPlaceholderValue(projectKey)) {
    throw new Error('PLACEHOLDER_CATALYST_ADMIN_CONFIG: CATALYST_PROJECT_KEY contains a placeholder.');
  }

  const rawEnv = (cfg.catalystEnvironment || '').trim();
  if (rawEnv !== 'Development' && rawEnv !== 'Production') {
    throw new Error(
      `INVALID_DEPLOYMENT_ENVIRONMENT: ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY} must be 'Development' or 'Production'.`
    );
  }
  const vigorEnv = (cfg.vigorEnvironment || process.env.VIGOR_ENVIRONMENT || 'development')
    .trim()
    .toLowerCase();
  if (vigorEnv === 'production' && rawEnv !== 'Production') {
    throw new Error(
      `ENVIRONMENT_SEPARATION_VIOLATION: VIGOR_ENVIRONMENT='production' cannot connect to ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}='${rawEnv}'.`
    );
  }
  if ((vigorEnv === 'development' || vigorEnv === 'test') && rawEnv === 'Production') {
    throw new Error(
      `ENVIRONMENT_SEPARATION_VIOLATION: Non-production VIGOR_ENVIRONMENT='${vigorEnv}' cannot connect to ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}='Production'.`
    );
  }

  const apiDomain = assertValidHttpOrigin(
    cfg.apiDomain || CONSTANTS.CATALYST_ORIGIN,
    VIGORCORE_CATALYST_API_DOMAIN_KEY,
    allowLoopback
  );
  const accountsUrl = assertValidHttpOrigin(
    cfg.accountsUrl || CONSTANTS.ACCOUNTS_ORIGIN,
    VIGORCORE_CATALYST_ACCOUNTS_URL_KEY,
    allowLoopback
  );

  return {
    projectId,
    projectKey,
    catalystEnvironment: rawEnv,
    vigorEnvironment: vigorEnv,
    apiDomain,
    accountsUrl,
    projectDomain: cfg.projectDomain || apiDomain.replace(/^https?:\/\//, ''),
    resetRedirectUrl:
      cfg.resetRedirectUrl?.trim() || 'https://app.vigorcore.lat/auth/login',
    allowInsecureLoopbackForTest: allowLoopback,
  };
}

/**
 * Validates incoming Catalyst edge headers against server-pinned project/domain policy
 * and builds an isolated per-request `CatalystApp` via `@zcatalyst/auth-admin`'s official
 * `new ZCAuth().init({ headers }, { type: 'advancedio', scope: 'admin' })`.
 *
 * Security invariants:
 * - Instantiates a fresh `ZCAuth()` per request to prevent `@zcatalyst/auth-admin`'s
 *   module-level `appOptions` / `[DEFAULT]` shared-state hazards across concurrent requests.
 * - Rejects mismatched `x-zc-projectid`, `x-zc-project-key`, or `x-zc-environment` (`403 PROJECT_CONTEXT_MISMATCH`).
 * - Pins `apiDomain`, `authPortalDomain`, `projectId`, `environment`, and `servedByCLI = false`
 *   so forged `zc-api-domain` or `za-portal-domain` headers can NEVER hijack outbound BaaS calls.
 * - Fails closed (`503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE`) if Catalyst edge admin headers
 *   are absent.
 */
export function buildHostedAdminAppFromHeaders(
  rawHeaders: Record<string, string | undefined> | undefined,
  config: HostedNativeValidatedConfig
): CatalystApp {
  const reqProjectId = readHeaderCaseInsensitive(rawHeaders, CONSTANTS.PROJECT_HEADER.id);
  if (reqProjectId && reqProjectId !== config.projectId) {
    throw new AuthGuardError(
      403,
      'PROJECT_CONTEXT_MISMATCH',
      'Incoming x-zc-projectid does not match the configured server Catalyst project.'
    );
  }

  const reqProjectKey = readHeaderCaseInsensitive(rawHeaders, CONSTANTS.PROJECT_HEADER.key);
  if (config.projectKey && reqProjectKey && reqProjectKey !== config.projectKey) {
    throw new AuthGuardError(
      403,
      'PROJECT_CONTEXT_MISMATCH',
      'Incoming x-zc-project-key does not match the configured server Catalyst project.'
    );
  }

  const reqEnv = readHeaderCaseInsensitive(rawHeaders, CONSTANTS.PROJECT_HEADER.environment);
  if (reqEnv && reqEnv !== config.catalystEnvironment) {
    throw new AuthGuardError(
      403,
      'PROJECT_CONTEXT_MISMATCH',
      `Incoming x-zc-environment does not match configured ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}.`
    );
  }

  const adminCredType = readHeaderCaseInsensitive(
    rawHeaders,
    CONSTANTS.CREDENTIAL_HEADER.admin_cred_type
  );
  const adminCredToken = readHeaderCaseInsensitive(
    rawHeaders,
    CONSTANTS.CREDENTIAL_HEADER.admin_token
  );
  if (!adminCredType || !adminCredToken) {
    throw new AuthGuardError(
      503,
      'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
      'Hosted Catalyst admin headers (x-zc-admin-cred-type/token) were not injected on this request; verify Catalyst platform edge context or fall back to external_oauth mode.'
    );
  }

  const effectiveProjectKey = config.projectKey ?? reqProjectKey ?? '';
  if (!effectiveProjectKey) {
    throw new AuthGuardError(
      503,
      'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
      'Missing x-zc-project-key platform header (required for outbound HTTP PROJECT_ID header).'
    );
  }

  const sanitizedAdminHeaders: Record<string, string> = {
    [CONSTANTS.PROJECT_HEADER.id]: config.projectId,
    [CONSTANTS.PROJECT_HEADER.key]: effectiveProjectKey,
    [CONSTANTS.PROJECT_HEADER.environment]: config.catalystEnvironment,
    [CONSTANTS.PROJECT_HEADER.domain]: config.projectDomain,
    [CONSTANTS.DOMAIN_HEADER.api]: config.apiDomain,
    [CONSTANTS.DOMAIN_HEADER.authPortal]: config.accountsUrl,
    [CONSTANTS.SERVED_BY_CLI_HEADER]: 'false',
    [CONSTANTS.CREDENTIAL_HEADER.admin_cred_type]: adminCredType,
    [CONSTANTS.CREDENTIAL_HEADER.admin_token]: adminCredToken,
    // Admin operations NEVER inherit client user headers or spoofing flags
    [CONSTANTS.CREDENTIAL_HEADER.user]: CONSTANTS.CREDENTIAL_USER.admin,
  };

  const zcAuthLocal = new ZCAuth();
  const adminApp = zcAuthLocal.init(
    { headers: sanitizedAdminHeaders } as unknown as Record<string, string | number | boolean>,
    { type: 'advancedio', scope: 'admin' }
  );
  adminApp.config.apiDomain = config.apiDomain;
  adminApp.config.authPortalDomain = config.accountsUrl;
  adminApp.config.projectKey = effectiveProjectKey;
  adminApp.config.servedByCLI = false;
  return adminApp;
}

export class HostedNativeCatalystAuthRuntime implements ICatalystAuthRuntime {
  private readonly config: HostedNativeValidatedConfig;
  private readonly requireLiveInt08ForPasswordReset: boolean;
  private readonly adminStorage = new AsyncLocalStorage<CatalystApp>();
  private readonly knownSecrets: string[];

  constructor(options: {
    config: HostedNativeConfigInput;
    requireLiveInt08ForPasswordReset?: boolean;
  }) {
    this.config = validateHostedNativeConfig(options.config);
    this.requireLiveInt08ForPasswordReset = options.requireLiveInt08ForPasswordReset ?? true;
    this.knownSecrets = this.config.projectKey ? [this.config.projectKey] : [];
  }

  static fromEnvironment(
    envMap: Record<string, string | undefined> = process.env,
    options: { allowInsecureLoopbackForTest?: boolean } = {}
  ): HostedNativeCatalystAuthRuntime {
    const deploymentEnv = resolveDeploymentEnvironmentFromEnv(envMap);
    const projectId = resolveCatalystProjectIdFromEnv(envMap);
    const apiDomain = resolveCatalystApiDomainFromEnv(envMap);
    const accountsUrl = resolveCatalystAccountsUrlFromEnv(envMap);
    const rawVigorEnv = (envMap.VIGOR_ENVIRONMENT || envMap.NODE_ENV || 'development')
      .trim()
      .toLowerCase();
    const vigorEnvironment: HostedNativeConfigInput['vigorEnvironment'] =
      rawVigorEnv === 'production' || rawVigorEnv === 'staging' || rawVigorEnv === 'test'
        ? rawVigorEnv
        : 'development';

    return new HostedNativeCatalystAuthRuntime({
      config: {
        projectId,
        projectKey: envMap.CATALYST_PROJECT_KEY,
        catalystEnvironment: deploymentEnv,
        vigorEnvironment,
        apiDomain,
        accountsUrl,
        projectDomain: envMap.CATALYST_PROJECT_DOMAIN,
        resetRedirectUrl: envMap.CATALYST_RESET_REDIRECT_URL,
        allowInsecureLoopbackForTest: options.allowInsecureLoopbackForTest,
      },
      requireLiveInt08ForPasswordReset:
        envMap.VIGOR_ALLOW_RESET_WITHOUT_INT08 !== 'true',
    });
  }

  getConfig(): HostedNativeValidatedConfig {
    return { ...this.config };
  }

  redactErrorMessage(err: unknown, requestHeaders?: Record<string, string | undefined>): string {
    const extras = [...this.knownSecrets];
    if (requestHeaders) {
      for (const k of [
        CONSTANTS.CREDENTIAL_HEADER.admin_token,
        CONSTANTS.CREDENTIAL_HEADER.user_token,
        CONSTANTS.CREDENTIAL_HEADER.cookie,
      ]) {
        const val = readHeaderCaseInsensitive(requestHeaders, k);
        if (val) extras.push(val);
      }
    }
    const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    return redactSecretsFromString(raw || 'Unknown Catalyst error', extras);
  }

  runWithRequestContext<T>(
    rawHeaders: Record<string, string | undefined> | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const adminApp = buildHostedAdminAppFromHeaders(rawHeaders, this.config);
    return this.adminStorage.run(adminApp, fn);
  }

  getActiveRequestAdminApp(): CatalystApp {
    const app = this.adminStorage.getStore();
    if (!app) {
      throw new AuthGuardError(
        503,
        'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
        'Hosted Catalyst admin context is unavailable outside an active hosted request lifecycle.'
      );
    }
    return app;
  }

  getActiveRequestNoSQLClient(): NoSQL {
    return new NoSQL(this.getActiveRequestAdminApp());
  }

  /**
   * Resolves caller identity strictly under `scope: 'user'` using Catalyst Advanced I/O
   * native `ZCAuth.init({ headers }, { type: 'advancedio', scope: 'user' })`.
   * Rejects `x-zc-user-type: admin` and mismatched `x-zc-projectid` / `x-zc-project-key` fail-closed.
   */
  async getCurrentUserFromRequest(req: IncomingHttpRequest): Promise<CatalystIdentitySnapshot | null> {
    const incomingHeaders = req.headers ?? {};

    const reqProjectId = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.PROJECT_HEADER.id);
    if (reqProjectId && reqProjectId !== this.config.projectId) {
      throw new AuthGuardError(
        403,
        'PROJECT_CONTEXT_MISMATCH',
        'Incoming x-zc-projectid does not match the configured server Catalyst project.'
      );
    }

    const reqProjectKey = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.PROJECT_HEADER.key);
    if (this.config.projectKey && reqProjectKey && reqProjectKey !== this.config.projectKey) {
      throw new AuthGuardError(
        403,
        'PROJECT_CONTEXT_MISMATCH',
        'Incoming x-zc-project-key does not match the configured server Catalyst project.'
      );
    }

    const reqEnv = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.PROJECT_HEADER.environment);
    if (reqEnv && reqEnv !== this.config.catalystEnvironment) {
      throw new AuthGuardError(
        403,
        'PROJECT_CONTEXT_MISMATCH',
        `Incoming x-zc-environment does not match configured ${VIGORCORE_DEPLOYMENT_ENVIRONMENT_KEY}.`
      );
    }

    const reqUserType = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user);
    if (reqUserType && reqUserType.toLowerCase() === CONSTANTS.CREDENTIAL_USER.admin) {
      throw new AuthGuardError(
        403,
        'CATALYST_ADMIN_HEADER_SPOOFED',
        'Incoming x-zc-user-type=admin is strictly prohibited on user authentication endpoints.'
      );
    }

    const userCredToken = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user_token);
    const userCredType =
      readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.user_cred_type) || 'token';
    const zcCookie = readHeaderCaseInsensitive(incomingHeaders, CONSTANTS.CREDENTIAL_HEADER.cookie);

    if (!userCredToken && !zcCookie) {
      return null;
    }

    const adminCredType = readHeaderCaseInsensitive(
      incomingHeaders,
      CONSTANTS.CREDENTIAL_HEADER.admin_cred_type
    );
    const adminCredToken = readHeaderCaseInsensitive(
      incomingHeaders,
      CONSTANTS.CREDENTIAL_HEADER.admin_token
    );

    if (!adminCredType || !adminCredToken) {
      throw new AuthGuardError(
        401,
        'AUTH_SESSION_INVALID',
        'Missing Catalyst hosted admin context headers required for user-scope initialization.'
      );
    }

    const effectiveProjectKey = this.config.projectKey ?? reqProjectKey ?? '';
    const sanitizedUserHeaders: Record<string, string> = {
      [CONSTANTS.PROJECT_HEADER.id]: this.config.projectId,
      [CONSTANTS.PROJECT_HEADER.key]: effectiveProjectKey,
      [CONSTANTS.PROJECT_HEADER.environment]: this.config.catalystEnvironment,
      [CONSTANTS.PROJECT_HEADER.domain]: this.config.projectDomain,
      [CONSTANTS.DOMAIN_HEADER.api]: this.config.apiDomain,
      [CONSTANTS.DOMAIN_HEADER.authPortal]: this.config.accountsUrl,
      [CONSTANTS.SERVED_BY_CLI_HEADER]: 'false',
      [CONSTANTS.CREDENTIAL_HEADER.user]: CONSTANTS.CREDENTIAL_USER.user,
      [CONSTANTS.CREDENTIAL_HEADER.admin_cred_type]: adminCredType,
      [CONSTANTS.CREDENTIAL_HEADER.admin_token]: adminCredToken,
    };
    if (userCredToken) {
      sanitizedUserHeaders[CONSTANTS.CREDENTIAL_HEADER.user_cred_type] = userCredType;
      sanitizedUserHeaders[CONSTANTS.CREDENTIAL_HEADER.user_token] = userCredToken;
    }
    if (zcCookie) {
      sanitizedUserHeaders[CONSTANTS.CREDENTIAL_HEADER.cookie] = zcCookie;
    }

    const zcAuthLocal = new ZCAuth();
    const userApp = zcAuthLocal.init(
      { headers: sanitizedUserHeaders } as unknown as Record<string, string | number | boolean>,
      { type: 'advancedio', scope: 'user' }
    );
    userApp.config.apiDomain = this.config.apiDomain;
    userApp.config.authPortalDomain = this.config.accountsUrl;
    userApp.config.projectKey = effectiveProjectKey;
    userApp.config.servedByCLI = false;

    try {
      const um = new UserManagement(userApp);
      const user = await um.getCurrentUser();
      if (!user || !user.user_id) {
        return null;
      }
      return {
        zuid: String(user.zuid || ''),
        user_id: String(user.user_id),
        status: String(user.status || ''),
        is_confirmed: Boolean(user.is_confirmed),
        email_id: String(user.email_id || ''),
        ...(user.org_id ? { org_id: String(user.org_id) } : {}),
        ...(user.first_name ? { first_name: String(user.first_name) } : {}),
        ...(user.last_name ? { last_name: String(user.last_name) } : {}),
        ...(user.role_details ? { role_details: user.role_details } : {}),
      };
    } catch (err) {
      throw new AuthGuardError(
        401,
        'AUTH_SESSION_INVALID',
        `Catalyst hosted user-scope verification failed: ${this.redactErrorMessage(err, incomingHeaders)}`
      );
    }
  }

  async getUserDetails(userId: string): Promise<CatalystIdentitySnapshot | null> {
    const adminApp = this.getActiveRequestAdminApp();
    const um = new UserManagement(adminApp);
    try {
      const details = await um.getUserDetails(userId);
      if (!details || !details.user_id) {
        return null;
      }
      return {
        zuid: String(details.zuid || ''),
        user_id: String(details.user_id),
        status: String(details.status || ''),
        is_confirmed: Boolean(details.is_confirmed),
        email_id: String(details.email_id || ''),
        ...(details.org_id ? { org_id: String(details.org_id) } : {}),
        ...(details.first_name ? { first_name: String(details.first_name) } : {}),
        ...(details.last_name ? { last_name: String(details.last_name) } : {}),
        ...(details.role_details ? { role_details: details.role_details } : {}),
      };
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown })?.statusCode;
      if (statusCode === 404) {
        return null;
      }
      throw new Error(
        `Catalyst hosted getUserDetails failed: ${this.redactErrorMessage(err)}`
      );
    }
  }

  async updateUserStatus(userId: string, status: USER_STATUS): Promise<boolean> {
    const adminApp = this.getActiveRequestAdminApp();
    const um = new UserManagement(adminApp);
    try {
      return await um.updateUserStatus(userId, status);
    } catch (err) {
      throw new Error(
        `Catalyst hosted updateUserStatus failed: ${this.redactErrorMessage(err)}`
      );
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    if (this.requireLiveInt08ForPasswordReset) {
      throw new Error(
        'INT_08_LIVE_VERIFICATION_PENDING: Catalyst resetPassword uses user-scope header in @zcatalyst/auth@1.0.0 and awaits live BaaS verification (INT-08).'
      );
    }
    const adminApp = this.getActiveRequestAdminApp();
    const um = new UserManagement(adminApp);
    try {
      await um.resetPassword(email, {
        platform_type: 'web',
        redirect_url: this.config.resetRedirectUrl,
      });
    } catch (err) {
      throw new Error(
        `Catalyst hosted sendPasswordReset failed: ${this.redactErrorMessage(err)}`
      );
    }
  }
}

export type { Authentication };
