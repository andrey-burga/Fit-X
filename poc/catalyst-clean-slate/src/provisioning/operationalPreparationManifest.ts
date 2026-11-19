/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.1.2 Consolidated Operational Preparation Manifest & Validators
 *
 * STRICT SCOPE BOUNDARIES (Phase 5.1.2 ONLY):
 * - NO Phase 5.2 remote provisioning, NO deployments, NO API Gateway activation,
 *   NO DNS modifications, NO Security Rules edits, NO real secrets.
 * - Strictly separates local verified assets `[SOLO LOCAL / DOCUMENTACIÓN]` from
 *   remote Catalyst items `[NO COMPROBABLE SIN ACCESO REMOTO]` and `[VERIFICADO REMOTAMENTE]`.
 * - Enforces exact 5-table / 8-GSI physical schema lock, conditional TTL on
 *   AdminInvitations & SystemControl, 41/41 route & API Gateway rewrite parity,
 *   hosted_native vs external_oauth env var matrix, and fail-closed apply lock.
 */

import { ROUTE_CONTRACT_SPECS, type RouteContractSpec } from '../routes/routeContracts.js';
import {
  CATALYST_PLATFORM_LIMITS,
  TABLE_SCHEMA_REGISTRY,
  type TableName,
  type TableSchemaSpec,
} from '../types/cleanSlate.js';
import {
  CATALYST_ENV_VAR_CATALOG,
  runCatalystConfigPreflight,
  type CatalystConfigPreflightReport,
} from './catalystConfigPreflight.js';
import {
  buildAlternativeBConfig,
  buildApiGatewayGlobalImpactAudit,
  buildCorsOptionsMatrix,
  getRequiredServerEnvSpecs,
  verifyGatewayAuthMatrixCompleteness,
  verifyGatewayRewriteCoverage,
} from './domainGatewayConfigs.js';
import { EXPECTED_TABLES_ORDERED } from './postProvisioningVerifier.js';
import {
  EIGHT_GSI_COVERAGE_AUDIT,
  ROUTE_TO_SCHEMA_MAPPING,
  verifyReconciliationCompleteness,
} from './schemaReconciliationAudit.js';

export type InventoryVerificationTag =
  | 'VERIFICADO REMOTAMENTE'
  | 'SOLO LOCAL / DOCUMENTACIÓN'
  | 'NO COMPROBABLE SIN ACCESO REMOTO';

export interface ResourceInventoryItem {
  readonly id: string;
  readonly category:
    | 'SANDBOX_CLI_AND_ENV'
    | 'PROJECT_AND_ENVIRONMENTS'
    | 'NOSQL_TABLES_AND_GSIS'
    | 'CATALYST_AUTH'
    | 'ADVANCED_IO_FUNCTIONS'
    | 'API_GATEWAY_AND_SECURITY_RULES'
    | 'DOMAIN_MAPPING_AND_DNS'
    | 'AUTHORIZED_DOMAINS_CORS'
    | 'SLATE_FRONTEND';
  readonly resourceName: string;
  readonly verificationTag: InventoryVerificationTag;
  readonly localEvidence: string;
  readonly safeReadOnlyQueryForOperator: string;
}

export interface TableProvisioningStepSpec {
  readonly order: number;
  readonly tableName: TableName;
  readonly partitionKey: { name: string; type: 'String' | 'Number' };
  readonly sortKey: { name: string; type: 'String' } | null;
  readonly additionalSortKeys: ReadonlyArray<{ name: string; type: 'String' | 'Number' }>;
  readonly secondaryIndexes: ReadonlyArray<{
    indexName: string;
    partitionKey: string;
    partitionKeyType: 'String' | 'Number';
    sortKey: string | null;
    sortKeyType: 'String' | 'Number' | null;
    projection: 'ALL' | 'KEYS_ONLY' | 'SPECIFIC_ATTRIBUTES';
    includeColumns: readonly string[] | null;
    isUniqueConstraint: false;
  }>;
  readonly ttlConfig: {
    enabled: boolean;
    attributeName: 'ttlEpochSec' | null;
    attributeType: 'Number' | null;
    allowedItemKeyPatterns: readonly string[];
    prohibitedItemKeyPatterns: readonly string[];
  };
  readonly dependencies: readonly string[];
  readonly stopConditionsOnCreate: readonly string[];
  readonly postCreationReadOnlyCheck: string;
}

export interface ExhaustiveEnvVarMatrixEntry {
  readonly name: string;
  readonly category:
    | 'AUTH_AND_CORS_POLICY'
    | 'CATALYST_IDENTIFIERS'
    | 'CATALYST_SERVER_SECRETS'
    | 'ADMIN_OAUTH_FALLBACK'
    | 'SESSION_COOKIE_AND_CSRF'
    | 'LISTENER_AND_RUNTIME_SAFETY'
    | 'CLIENT_SLATE_ONLY'
    | 'LEGACY_DEPRECATED';
  readonly isSecret: boolean;
  readonly secretConfigurationMarker: string;
  readonly localExpress: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';
  readonly hostedNativeAdvancedIo: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN' | 'PLATFORM_INJECTED';
  readonly externalOAuthAdvancedIo: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN' | 'PLATFORM_INJECTED';
  readonly cliReadOnlyLive: 'REQUIRED' | 'OPTIONAL' | 'FORBIDDEN';
  readonly purposeAndValidationRule: string;
}

export interface FunctionEndpointManifestEntry {
  readonly functionName: 'vigor_api';
  readonly type: 'advancedio';
  readonly runtime: 'node22';
  readonly entrypoint: 'dist/server/catalystEntry.js';
  readonly buildConfigFile: 'tsconfig.server.json';
  readonly buildCommand: 'npm --prefix poc/catalyst-clean-slate run build:server';
  readonly dependencies: readonly string[];
  readonly healthEndpoint: '/health';
  readonly canonicalApiRoutesCount: 41;
  readonly pathNormalizationHelper: 'normalizeCatalystPath';
  readonly packagingContents: readonly string[];
}

export interface AnomalyDetectionReport {
  readonly totalCanonicalRoutes: number;
  readonly mappedSchemaRoutes: number;
  readonly gatewayAuthMatrixRoutes: number;
  readonly gatewayRewriteMatchedRoutes: number;
  readonly orphanRouteIds: readonly string[];
  readonly unmappedRouteIds: readonly string[];
  readonly duplicateMethodPathCollisions: readonly string[];
  readonly unknownTableReferences: readonly string[];
  readonly missingGsis: readonly string[];
  readonly extraGsis: readonly string[];
  readonly uninventoriedEnvVarsReadInCode: readonly string[];
  readonly anomalyCount: number;
  readonly passed: boolean;
}

export interface ProvisioningManifestValidationResult {
  readonly passed: boolean;
  readonly tableCount: number;
  readonly gsiCount: number;
  readonly ttlRulesValid: boolean;
  readonly gsiDirectory11ColsValid: boolean;
  readonly violations: readonly string[];
}

export interface ConsolidatedPhase512Plan {
  readonly phase: '5.1.2';
  readonly mode: 'PLAN_ONLY_NON_APPLIED';
  readonly applied: false;
  readonly phase52Authorized: false;
  readonly networkCallsExecuted: 0;
  readonly writeOperationsExecuted: 0;
  readonly targetArchitecture: {
    readonly slateFrontendOrigin: 'https://app.vigorcore.lat';
    readonly apiBackendOrigin: 'https://api.vigorcore.lat';
    readonly domainTopology: 'CloudScale > Domain Mapping (Production + CNAME, webClientHosting=false)';
    readonly corsPolicy: 'CloudScale > Whitelisting > Authorized Domains (https://app.vigorcore.lat) + VIGOR_CORS_MODE=platform_managed';
    readonly primaryHostedAuthMode: 'hosted_native';
    readonly fallbackAuthMode: 'external_oauth';
  };
  readonly inventorySummary: {
    readonly verifiedRemotelyCount: number;
    readonly localDocumentationOnlyCount: number;
    readonly unprovableWithoutRemoteAccessCount: number;
    readonly items: readonly ResourceInventoryItem[];
  };
  readonly provisioningManifest: readonly TableProvisioningStepSpec[];
  readonly provisioningValidation: ProvisioningManifestValidationResult;
  readonly envVarMatrix: readonly ExhaustiveEnvVarMatrixEntry[];
  readonly functionManifest: FunctionEndpointManifestEntry;
  readonly anomalyReport: AnomalyDetectionReport;
  readonly gatewayConfigCandidate: ReturnType<typeof buildAlternativeBConfig>;
  readonly gatewayGlobalImpactAudit: ReturnType<typeof buildApiGatewayGlobalImpactAudit>;
  readonly corsOptionsMatrix: ReturnType<typeof buildCorsOptionsMatrix>;
  readonly orderedTransitionPhases: readonly string[];
  readonly recoveryActions: readonly {
    readonly scenario: string;
    readonly detectionSignal: string;
    readonly safeRecoveryCommandOrAction: string;
  }[];
  readonly blockersAndPendingLiveChecks: readonly string[];
}

export const CATALYST_RESOURCE_INVENTORY_BASELINE: readonly ResourceInventoryItem[] = [
  {
    id: 'INV-SANDBOX-CLI',
    category: 'SANDBOX_CLI_AND_ENV',
    resourceName: 'Catalyst CLI binary (`catalyst`) & local shell env credentials',
    verificationTag: 'SOLO LOCAL / DOCUMENTACIÓN',
    localEvidence:
      'Local shell inspection verified `which catalyst` absent (`NO_CATALYST_CLI`), zero `CATALYST_*`/`VIGOR_*`/`ZC_*`/`X_ZOHO_*`/`ZAID` vars set, and no `catalyst.json` in workspace.',
    safeReadOnlyQueryForOperator:
      'Get-Command catalyst -ErrorAction SilentlyContinue; catalyst --version; catalyst whoami',
  },
  {
    id: 'INV-LOCAL-POC-BASELINE',
    category: 'SANDBOX_CLI_AND_ENV',
    resourceName: 'Isolated POC `poc/catalyst-clean-slate/` (SDK packages, schema, 41 routes, scripts)',
    verificationTag: 'SOLO LOCAL / DOCUMENTACIÓN',
    localEvidence:
      'Verified `@zcatalyst/auth@1.0.0`, `@zcatalyst/auth-admin@1.1.0`, `@zcatalyst/nosql@1.0.0`, `@zcatalyst/transport@1.1.0`, `@zcatalyst/utils@1.1.0`, `express@4.22.3`, Node >=22, 5 tables / 8 GSIs / 41 routes.',
    safeReadOnlyQueryForOperator: 'npm --prefix poc/catalyst-clean-slate run build; npm --prefix poc/catalyst-clean-slate test',
  },
  {
    id: 'INV-REMOTE-PROJECT-ENV',
    category: 'PROJECT_AND_ENVIRONMENTS',
    resourceName: 'Target Catalyst Organization, Project ID, and Development/Production environments',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Placeholders only in `.env.example`; zero real project IDs stored.',
    safeReadOnlyQueryForOperator:
      'catalyst whoami; catalyst project:list; Catalyst Console -> Project Settings -> General (read-only)',
  },
  {
    id: 'INV-REMOTE-NOSQL-TABLES',
    category: 'NOSQL_TABLES_AND_GSIS',
    resourceName: '5 Catalyst NoSQL tables (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) & 8 GSIs',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Schema frozen locally in `TABLE_SCHEMA_REGISTRY`; remote provisioning deferred to Phase 5.2.',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Cloud Scale -> Data Store / NoSQL (read-only view); post-Phase 5.2: npx tsx scripts/verify-clean-slate-provisioning.ts --live --confirm-readonly',
  },
  {
    id: 'INV-REMOTE-AUTH-USERS',
    category: 'CATALYST_AUTH',
    resourceName: 'Catalyst Authentication users, roles, and password-reset redirect templates',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Clean-slate contract expects 0 app users prior to offline bootstrap.',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Authentication -> Users & Email Templates (read-only inspection)',
  },
  {
    id: 'INV-REMOTE-FUNCTIONS',
    category: 'ADVANCED_IO_FUNCTIONS',
    resourceName: 'Existing Catalyst Functions (Basic I/O, Advanced I/O `vigor_api`, Cron, Event)',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Candidate function template prepared in `config/candidates/catalyst-function.template.json` (`applied: false`).',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Serverless -> Functions (inventory all existing functions before enabling API Gateway)',
  },
  {
    id: 'INV-REMOTE-APIG-RULES',
    category: 'API_GATEWAY_AND_SECURITY_RULES',
    resourceName: 'API Gateway status & Project Security Rules export',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Candidate gateway routes prepared in `config/candidates/alternative-b-api-gateway.routes.json` (`applied: false`).',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Cloud Scale -> API Gateway & Security Rules -> Export current JSON (read-only backup prior to Phase 5.2+)',
  },
  {
    id: 'INV-REMOTE-DOMAIN-DNS',
    category: 'DOMAIN_MAPPING_AND_DNS',
    resourceName: 'CloudScale > Domain Mapping (`api.vigorcore.lat`) and CNAME DNS record',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Domain topology reconciled per Zoho Support 2026-11-17 response; zero DNS edits performed.',
    safeReadOnlyQueryForOperator:
      'Resolve-DnsName -Name api.vigorcore.lat -Type CNAME -DnsOnly; Catalyst Console -> Cloud Scale -> Domain Mapping (read-only)',
  },
  {
    id: 'INV-REMOTE-AUTHORIZED-DOMAINS',
    category: 'AUTHORIZED_DOMAINS_CORS',
    resourceName: 'CloudScale > Whitelisting > Authorized Domains (`https://app.vigorcore.lat`)',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Required without wildcard `*` alongside `VIGOR_CORS_MODE=platform_managed`.',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Cloud Scale -> Security & Whitelisting -> Authorized Domains (read-only)',
  },
  {
    id: 'INV-REMOTE-SLATE-APP',
    category: 'SLATE_FRONTEND',
    resourceName: 'Zoho Catalyst Slate frontend at `https://app.vigorcore.lat/`',
    verificationTag: 'NO COMPROBABLE SIN ACCESO REMOTO',
    localEvidence: 'Untouched by Phase 5.1.2 isolation mandate; decoupled SPA client ready inside `poc/catalyst-clean-slate/frontend/`.',
    safeReadOnlyQueryForOperator:
      'Catalyst Console -> Cloud Scale -> Slate / Web Client deployments (read-only status check)',
  },
] as const;

/**
 * Exact environment variable names actively referenced across `poc/catalyst-clean-slate/src/`.
 * Used to detect uninventoried/undocumented env reads automatically.
 */
export const CODEBASE_REFERENCED_ENV_VARS: readonly string[] = [
  'CATALYST_ACCOUNTS_URL',
  'CATALYST_ADMIN_ACCESS_TOKEN',
  'CATALYST_ADMIN_CLIENT_ID',
  'CATALYST_ADMIN_CLIENT_SECRET',
  'CATALYST_ADMIN_REFRESH_TOKEN',
  'CATALYST_API_DOMAIN',
  'CATALYST_ENVIRONMENT',
  'CATALYST_FUNCTION_NAME',
  'CATALYST_PROJECT_DOMAIN',
  'CATALYST_PROJECT_ID',
  'CATALYST_PROJECT_KEY',
  'CATALYST_PROJECT_SECRET_KEY',
  'CATALYST_RESET_REDIRECT_URL',
  'NODE_ENV',
  'PORT',
  'VIGOR_ALLOWED_ORIGINS',
  'VIGOR_ALLOW_RESET_WITHOUT_INT08',
  'VIGOR_CATALYST_AUTH_MODE',
  'VIGOR_CORS_MODE',
  'VIGOR_ENVIRONMENT',
  'VIGOR_SESSION_ACTIVE_KID',
  'VIGOR_SESSION_HMAC_SECRET',
  'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
  'X_ZOHO_CATALYST_LISTEN_PORT',
  'X_ZOHO_CATALYST_ORG_ID',
  'ZAID',
  'ZC_CLIENT_ID',
  'ZC_CLIENT_SECRET',
  'ZC_ENVIRONMENT',
  'ZC_PROJECT_ID',
  'ZC_PROJECT_KEY',
  'ZC_REFRESH_TOKEN',
  'ZC_SECURE',
] as const;

export const EXHAUSTIVE_ENV_VAR_MATRIX: readonly ExhaustiveEnvVarMatrixEntry[] = [
  {
    name: 'VIGOR_CATALYST_AUTH_MODE',
    category: 'AUTH_AND_CORS_POLICY',
    isSecret: false,
    secretConfigurationMarker: 'hosted_native',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule:
      "Must be 'hosted_native' (primary inside Catalyst Advanced I/O using zcAuth.init) or 'external_oauth' (CatalystAdminAppProvider).",
  },
  {
    name: 'VIGOR_CORS_MODE',
    category: 'AUTH_AND_CORS_POLICY',
    isSecret: false,
    secretConfigurationMarker: 'platform_managed',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule:
      "Must be 'platform_managed' behind CloudScale Authorized Domains (prevents duplicate Access-Control-* headers) or 'express_enforced'.",
  },
  {
    name: 'CATALYST_PROJECT_ID',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'Non-placeholder public project ID pinned for BaaS calls & x-zc-projectid anti-spoof verification.',
  },
  {
    name: 'CATALYST_ENVIRONMENT',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: 'Development | Production',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: "Strictly 'Development' or 'Production'; must match VIGOR_ENVIRONMENT without dev/prod crossover.",
  },
  {
    name: 'VIGOR_ENVIRONMENT',
    category: 'AUTH_AND_CORS_POLICY',
    isSecret: false,
    secretConfigurationMarker: 'development | staging | production',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: "Enforces HMAC/Catalyst environment pairing ('production' requires CATALYST_ENVIRONMENT='Production').",
  },
  {
    name: 'CATALYST_API_DOMAIN',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: 'https://api.catalyst.zoho.com',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'Explicit regional HTTPS origin; prevents zc-api-domain header injection against SSRF/redirect abuse.',
  },
  {
    name: 'CATALYST_ACCOUNTS_URL',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: 'https://accounts.zoho.com',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'Explicit Zoho Accounts regional HTTPS host matching CATALYST_API_DOMAIN DC TLD.',
  },
  {
    name: 'CATALYST_PROJECT_DOMAIN',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Optional Catalyst project default domain metadata.',
  },
  {
    name: 'CATALYST_FUNCTION_NAME',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: 'vigor_api',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Non-secret service label emitted on /health and audit diagnostics (default vigor_api / vigorcore-advanced-io).',
  },
  {
    name: 'CATALYST_RESET_REDIRECT_URL',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: 'https://app.vigorcore.lat/auth/login',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Optional redirect_url passed during admin password reset once INT-08 is live-verified.',
  },
  {
    name: 'X_ZOHO_CATALYST_ORG_ID',
    category: 'CATALYST_IDENTIFIERS',
    isSecret: false,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Optional Catalyst Org ID forwarded in CATALYST-ORG header when multi-org disambiguation applies.',
  },
  {
    name: 'CATALYST_PROJECT_KEY',
    category: 'CATALYST_SERVER_SECRETS',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule:
      'Required in external_oauth (sent in PROJECT_ID header). Optional in hosted_native when Catalyst edge supplies x-zc-project-key.',
  },
  {
    name: 'CATALYST_PROJECT_SECRET_KEY',
    category: 'CATALYST_SERVER_SECRETS',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Optional x-zc-project-secret-key credential; rejected if set to a placeholder.',
  },
  {
    name: 'CATALYST_ADMIN_CLIENT_ID',
    category: 'ADMIN_OAUTH_FALLBACK',
    isSecret: false,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'OAuth client ID for external_oauth / CLI --live; NOT required in hosted_native.',
  },
  {
    name: 'CATALYST_ADMIN_CLIENT_SECRET',
    category: 'ADMIN_OAUTH_FALLBACK',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'OAuth client secret for external_oauth / CLI --live; NOT required in hosted_native.',
  },
  {
    name: 'CATALYST_ADMIN_REFRESH_TOKEN',
    category: 'ADMIN_OAUTH_FALLBACK',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'REQUIRED',
    purposeAndValidationRule: 'OAuth refresh token for external_oauth / CLI --live; NOT required in hosted_native.',
  },
  {
    name: 'CATALYST_ADMIN_ACCESS_TOKEN',
    category: 'ADMIN_OAUTH_FALLBACK',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Ephemeral short-lived read-only diagnostic credential ONLY; forbidden in production server runtimes.',
  },
  {
    name: 'VIGOR_SESSION_HMAC_SECRET',
    category: 'SESSION_COOKIE_AND_CSRF',
    isSecret: true,
    secretConfigurationMarker: '[CONFIGURAR_EN_CATALYST]',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'CSPRNG >= 256-bit Base64URL key signing __Host-vigor_session & bound X-Vigor-CSRF tokens.',
  },
  {
    name: 'VIGOR_SESSION_ACTIVE_KID',
    category: 'SESSION_COOKIE_AND_CSRF',
    isSecret: false,
    secretConfigurationMarker: 'k1',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Active HMAC key identifier stamped inside session cookie headers.',
  },
  {
    name: 'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
    category: 'SESSION_COOKIE_AND_CSRF',
    isSecret: true,
    secretConfigurationMarker: '[]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Optional JSON array of rotated [{ kid, secret }] for zero-downtime key rotation.',
  },
  {
    name: 'VIGOR_ALLOWED_ORIGINS',
    category: 'SESSION_COOKIE_AND_CSRF',
    isSecret: false,
    secretConfigurationMarker: 'https://app.vigorcore.lat',
    localExpress: 'REQUIRED',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Comma-separated explicit HTTPS origins; wildcard * is rejected fail-closed.',
  },
  {
    name: 'X_ZOHO_CATALYST_LISTEN_PORT',
    category: 'LISTENER_AND_RUNTIME_SAFETY',
    isSecret: false,
    secretConfigurationMarker: 'PLATFORM_INJECTED',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'PLATFORM_INJECTED',
    externalOAuthAdvancedIo: 'PLATFORM_INJECTED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'TCP port injected automatically by Zoho Catalyst Advanced I/O container.',
  },
  {
    name: 'PORT',
    category: 'LISTENER_AND_RUNTIME_SAFETY',
    isSecret: false,
    secretConfigurationMarker: '3002',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Local Express fallback port when X_ZOHO_CATALYST_LISTEN_PORT is absent.',
  },
  {
    name: 'NODE_ENV',
    category: 'LISTENER_AND_RUNTIME_SAFETY',
    isSecret: false,
    secretConfigurationMarker: 'production',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'REQUIRED',
    externalOAuthAdvancedIo: 'REQUIRED',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: "Standard Node runtime mode ('development' locally, 'production' in hosted Advanced I/O).",
  },
  {
    name: 'VIGOR_ALLOW_RESET_WITHOUT_INT08',
    category: 'LISTENER_AND_RUNTIME_SAFETY',
    isSecret: false,
    secretConfigurationMarker: 'false',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: "Safety guard keeping admin password-reset gated until live INT-08 verification passes; never enable in prod.",
  },
  {
    name: 'ZC_SECURE',
    category: 'LISTENER_AND_RUNTIME_SAFETY',
    isSecret: false,
    secretConfigurationMarker: 'UNSET (override FORBIDDEN)',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: "If set to 'override', disables TLS certificate checks in @zcatalyst/transport -> strictly rejected.",
  },
  {
    name: 'ZAID',
    category: 'CLIENT_SLATE_ONLY',
    isSecret: false,
    secretConfigurationMarker: '[PUBLIC_WEB_SDK_ZAID]',
    localExpress: 'OPTIONAL',
    hostedNativeAdvancedIo: 'OPTIONAL',
    externalOAuthAdvancedIo: 'OPTIONAL',
    cliReadOnlyLive: 'OPTIONAL',
    purposeAndValidationRule: 'Frontend Slate browser Web SDK public app identifier ONLY; never read or accepted as server credential.',
  },
  {
    name: 'ZC_PROJECT_ID',
    category: 'LEGACY_DEPRECATED',
    isSecret: false,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* env var; preflight warns or fails if conflicting with CATALYST_PROJECT_ID.',
  },
  {
    name: 'ZC_PROJECT_KEY',
    category: 'LEGACY_DEPRECATED',
    isSecret: true,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* secret; migrate exclusively to CATALYST_PROJECT_KEY.',
  },
  {
    name: 'ZC_CLIENT_ID',
    category: 'LEGACY_DEPRECATED',
    isSecret: false,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* identifier; migrate exclusively to CATALYST_ADMIN_CLIENT_ID.',
  },
  {
    name: 'ZC_CLIENT_SECRET',
    category: 'LEGACY_DEPRECATED',
    isSecret: true,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* secret; migrate exclusively to CATALYST_ADMIN_CLIENT_SECRET.',
  },
  {
    name: 'ZC_REFRESH_TOKEN',
    category: 'LEGACY_DEPRECATED',
    isSecret: true,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* token; migrate exclusively to CATALYST_ADMIN_REFRESH_TOKEN.',
  },
  {
    name: 'ZC_ENVIRONMENT',
    category: 'LEGACY_DEPRECATED',
    isSecret: false,
    secretConfigurationMarker: 'DEPRECATED',
    localExpress: 'FORBIDDEN',
    hostedNativeAdvancedIo: 'FORBIDDEN',
    externalOAuthAdvancedIo: 'FORBIDDEN',
    cliReadOnlyLive: 'FORBIDDEN',
    purposeAndValidationRule: 'Legacy unprefixed ZC_* env selector; migrate exclusively to CATALYST_ENVIRONMENT.',
  },
] as const;

export function buildConsolidatedProvisioningManifest(
  registry: Record<TableName, TableSchemaSpec> = TABLE_SCHEMA_REGISTRY
): TableProvisioningStepSpec[] {
  const dependenciesByTable: Record<TableName, readonly string[]> = {
    Users: ['Clean-slate Catalyst project confirmed empty (0 pre-existing Users rows)'],
    UserData: ['Users created and verified ONLINE (per-user partition pk = USER#<uid>)'],
    AdminInvitations: ['Users created (role target attribution + GSI_InviteEmailStatus lookup)'],
    AuditLogs: ['Users & AdminInvitations defined (immutable append-only trail referencing actorUid/targetUid)'],
    SystemControl: ['Users & AdminInvitations defined (locks CTRL#BOOTSTRAP, CTRL#SUPERADMIN_COUNT, CTRL#SAGA#*, SESSION#<sid>)'],
  };

  return EXPECTED_TABLES_ORDERED.map((tableName, idx) => {
    const spec = registry[tableName];
    const hasTtl = Boolean(spec.ttlAttribute);
    const isSystemControl = tableName === 'SystemControl';

    return {
      order: idx + 1,
      tableName,
      partitionKey: { name: spec.partitionKey, type: spec.partitionKeyType },
      sortKey: spec.sortKey ? { name: spec.sortKey, type: spec.sortKeyType ?? 'String' } : null,
      additionalSortKeys: spec.additionalSortKeys.map(k => ({ name: k.name, type: k.type })),
      secondaryIndexes: spec.secondaryIndexes.map(gsi => ({
        indexName: gsi.indexName,
        partitionKey: gsi.partitionKey,
        partitionKeyType: gsi.partitionKeyType,
        sortKey: gsi.sortKey ?? null,
        sortKeyType: gsi.sortKeyType ?? null,
        projection: gsi.projection,
        includeColumns: gsi.projectedAttributes ? [...gsi.projectedAttributes] : null,
        isUniqueConstraint: gsi.isUniqueConstraint,
      })),
      ttlConfig: {
        enabled: hasTtl,
        attributeName: hasTtl ? 'ttlEpochSec' : null,
        attributeType: hasTtl ? 'Number' : null,
        allowedItemKeyPatterns:
          tableName === 'AdminInvitations'
            ? ['INVITE#<inviteId>']
            : isSystemControl
              ? ['CTRL#SAGA#<idempotencyKey>', 'SESSION#<sid>']
              : [],
        prohibitedItemKeyPatterns:
          isSystemControl
            ? ['CTRL#BOOTSTRAP', 'CTRL#SUPERADMIN_COUNT']
            : ['ALL_ITEMS (TTL strictly disabled)'],
      },
      dependencies: dependenciesByTable[tableName],
      stopConditionsOnCreate: [
        `STOP immediately if '${tableName}' already exists with residual rows or incompatible schema.`,
        spec.sortKey === null
          ? `STOP if Catalyst Console forces a Primary Sort Key on '${tableName}' (must be omitted).`
          : `STOP if Primary Sort Key '${spec.sortKey}' (String) cannot be configured.`,
        hasTtl
          ? `STOP if Catalyst Console refuses ttlEpochSec with type Number on '${tableName}'.`
          : `STOP if TTL is enabled accidentally on '${tableName}'.`,
        ...(tableName === 'Users'
          ? ['STOP if GSI_Directory SPECIFIC_ATTRIBUTES projection omits any of the exact 11 columns.']
          : []),
      ],
      postCreationReadOnlyCheck: `Verify table '${tableName}' is ONLINE, metrics=0, GSIs ONLINE, via verify-clean-slate-provisioning.ts --live --confirm-readonly.`,
    };
  });
}

export function validateConsolidatedProvisioningManifest(
  manifest: readonly TableProvisioningStepSpec[],
  registry: Record<string, TableSchemaSpec> = TABLE_SCHEMA_REGISTRY
): ProvisioningManifestValidationResult {
  const violations: string[] = [];
  const tableNames = Object.keys(registry).sort();
  const expectedSorted = [...EXPECTED_TABLES_ORDERED].sort();

  if (tableNames.length !== 5 || JSON.stringify(tableNames) !== JSON.stringify(expectedSorted)) {
    violations.push(
      `Expected exact 5 frozen tables (${expectedSorted.join(', ')}), got [${tableNames.join(', ')}].`
    );
  }
  if (manifest.length !== 5) {
    violations.push(`Expected 5 manifest steps, got ${manifest.length}.`);
  }

  let totalGsis = 0;
  let ttlRulesValid = true;
  let gsiDirectory11ColsValid = true;

  for (const [tName, spec] of Object.entries(registry)) {
    totalGsis += spec.secondaryIndexes.length;
    const totalSks = (spec.sortKey ? 1 : 0) + spec.additionalSortKeys.length;
    if (totalSks > CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE) {
      violations.push(`Table '${tName}' exceeds 5 sort keys (${totalSks}).`);
    }

    if (tName === 'AdminInvitations' || tName === 'SystemControl') {
      if (spec.ttlAttribute?.name !== 'ttlEpochSec' || spec.ttlAttribute?.type !== 'Number') {
        ttlRulesValid = false;
        violations.push(`Table '${tName}' MUST configure TTL on ttlEpochSec (Number).`);
      }
    } else if (spec.ttlAttribute !== undefined) {
      ttlRulesValid = false;
      violations.push(`Table '${tName}' MUST have TTL completely disabled.`);
    }

    if (tName === 'Users') {
      const gsiDir = spec.secondaryIndexes.find(g => g.indexName === 'GSI_Directory');
      if (
        !gsiDir ||
        gsiDir.projection !== 'SPECIFIC_ATTRIBUTES' ||
        (gsiDir.projectedAttributes?.length ?? 0) !== 11
      ) {
        gsiDirectory11ColsValid = false;
        violations.push('Users.GSI_Directory must project SPECIFIC_ATTRIBUTES with exact 11 columns.');
      }
    }
  }

  const sysStep = manifest.find(m => m.tableName === 'SystemControl');
  if (
    !sysStep ||
    !sysStep.ttlConfig.prohibitedItemKeyPatterns.includes('CTRL#BOOTSTRAP') ||
    !sysStep.ttlConfig.prohibitedItemKeyPatterns.includes('CTRL#SUPERADMIN_COUNT')
  ) {
    ttlRulesValid = false;
    violations.push('SystemControl manifest must explicitly prohibit TTL on CTRL#BOOTSTRAP and CTRL#SUPERADMIN_COUNT.');
  }

  if (totalGsis !== 8) {
    violations.push(`Expected exact 8 GSIs across the 5 tables, found ${totalGsis}.`);
  }

  return {
    passed: violations.length === 0,
    tableCount: tableNames.length,
    gsiCount: totalGsis,
    ttlRulesValid,
    gsiDirectory11ColsValid,
    violations,
  };
}

export function detectRouteAndManifestAnomalies(
  routes: readonly RouteContractSpec[] = ROUTE_CONTRACT_SPECS,
  functionName = 'vigor_api'
): AnomalyDetectionReport {
  const schemaAudit = verifyReconciliationCompleteness();
  const gatewayAuthAudit = verifyGatewayAuthMatrixCompleteness();
  const rewriteReport = verifyGatewayRewriteCoverage(functionName);

  const canonicalIds = new Set(routes.map(r => r.id));
  const mappedIds = new Set(ROUTE_TO_SCHEMA_MAPPING.map(m => m.routeId));
  const orphanRouteIds = [...mappedIds].filter(id => !canonicalIds.has(id));
  const unmappedRouteIds = [...canonicalIds].filter(id => !mappedIds.has(id));

  const seenMethodPath = new Map<string, string>();
  const duplicateMethodPathCollisions: string[] = [];
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const prev = seenMethodPath.get(key);
    if (prev) {
      duplicateMethodPathCollisions.push(`${key} (${prev} vs ${r.id})`);
    } else {
      seenMethodPath.set(key, r.id);
    }
  }

  const validTableSet = new Set<string>(EXPECTED_TABLES_ORDERED);
  const unknownTableReferences: string[] = [];
  for (const row of ROUTE_TO_SCHEMA_MAPPING) {
    for (const tbl of row.primaryTables) {
      if (!validTableSet.has(tbl)) {
        unknownTableReferences.push(`${row.routeId} -> ${tbl}`);
      }
    }
  }

  const registryGsis = new Set<string>();
  for (const [tName, spec] of Object.entries(TABLE_SCHEMA_REGISTRY)) {
    for (const gsi of spec.secondaryIndexes) {
      registryGsis.add(`${tName}.${gsi.indexName}`);
    }
  }
  const auditedGsis = new Set(EIGHT_GSI_COVERAGE_AUDIT.map(g => `${g.table}.${g.indexName}`));
  const extraGsis = [...auditedGsis].filter(g => !registryGsis.has(g));

  const inventoriedNames = new Set(EXHAUSTIVE_ENV_VAR_MATRIX.map(e => e.name));
  const uninventoriedEnvVarsReadInCode = CODEBASE_REFERENCED_ENV_VARS.filter(
    name => !inventoriedNames.has(name)
  );

  const anomalyCount =
    orphanRouteIds.length +
    unmappedRouteIds.length +
    duplicateMethodPathCollisions.length +
    unknownTableReferences.length +
    schemaAudit.missingGsis.length +
    extraGsis.length +
    uninventoriedEnvVarsReadInCode.length +
    gatewayAuthAudit.missingRouteIds.length +
    gatewayAuthAudit.extraRouteIds.length +
    (rewriteReport.allMatched ? 0 : 1) +
    (gatewayAuthAudit.zeroOAuthExecuteForced ? 0 : 1);

  return {
    totalCanonicalRoutes: routes.length,
    mappedSchemaRoutes: ROUTE_TO_SCHEMA_MAPPING.length,
    gatewayAuthMatrixRoutes: gatewayAuthAudit.totalMatrixRoutes,
    gatewayRewriteMatchedRoutes: rewriteReport.passedRoutes,
    orphanRouteIds,
    unmappedRouteIds,
    duplicateMethodPathCollisions,
    unknownTableReferences,
    missingGsis: schemaAudit.missingGsis,
    extraGsis,
    uninventoriedEnvVarsReadInCode,
    anomalyCount,
    passed: anomalyCount === 0 && routes.length === 41 && rewriteReport.allMatched,
  };
}

export function getFunctionDeploymentManifest(
  functionName: 'vigor_api' = 'vigor_api'
): FunctionEndpointManifestEntry {
  return {
    functionName,
    type: 'advancedio',
    runtime: 'node22',
    entrypoint: 'dist/server/catalystEntry.js',
    buildConfigFile: 'tsconfig.server.json',
    buildCommand: 'npm --prefix poc/catalyst-clean-slate run build:server',
    dependencies: [
      '@zcatalyst/auth@^1.0.0',
      '@zcatalyst/auth-admin@^1.1.0',
      '@zcatalyst/nosql@^1.0.0',
      '@zcatalyst/transport@^1.1.0',
      '@zcatalyst/utils@^1.1.0',
      'express@^4.22.3',
    ],
    healthEndpoint: '/health',
    canonicalApiRoutesCount: 41,
    pathNormalizationHelper: 'normalizeCatalystPath',
    packagingContents: [
      'dist/server/catalystEntry.js (+ dist/**/*.js server artifacts only; exclude src/frontend)',
      'package.json (runtime dependencies + "type": "module" + engines.node >= 22)',
      'node_modules/@zcatalyst/* + express (production runtime dependencies)',
    ],
  };
}

export function auditEnvironmentVariableCoverage(): {
  catalogCount: number;
  requiredServerSpecCount: number;
  exhaustiveMatrixCount: number;
  missingFromExhaustiveMatrix: string[];
  hostedNativeRequiresExternalOAuthSecrets: boolean;
  allSecretsHaveRedactedOrMarker: boolean;
  passed: boolean;
} {
  const matrixByName = new Map(EXHAUSTIVE_ENV_VAR_MATRIX.map(e => [e.name, e]));
  const missingFromExhaustiveMatrix: string[] = [];

  for (const item of CATALYST_ENV_VAR_CATALOG) {
    if (!matrixByName.has(item.name)) {
      missingFromExhaustiveMatrix.push(`CATALYST_ENV_VAR_CATALOG:${item.name}`);
    }
  }
  for (const item of getRequiredServerEnvSpecs()) {
    if (!matrixByName.has(item.name)) {
      missingFromExhaustiveMatrix.push(`getRequiredServerEnvSpecs:${item.name}`);
    }
  }
  for (const codeEnv of CODEBASE_REFERENCED_ENV_VARS) {
    if (!matrixByName.has(codeEnv)) {
      missingFromExhaustiveMatrix.push(`CODEBASE:${codeEnv}`);
    }
  }

  const externalOAuthKeys = [
    'CATALYST_ADMIN_CLIENT_ID',
    'CATALYST_ADMIN_CLIENT_SECRET',
    'CATALYST_ADMIN_REFRESH_TOKEN',
  ];
  const hostedNativeRequiresExternalOAuthSecrets = externalOAuthKeys.some(k => {
    const entry = matrixByName.get(k);
    return !entry || entry.hostedNativeAdvancedIo === 'REQUIRED';
  });

  const allSecretsHaveRedactedOrMarker = EXHAUSTIVE_ENV_VAR_MATRIX.filter(e => e.isSecret).every(
    e =>
      e.secretConfigurationMarker === '[CONFIGURAR_EN_CATALYST]' ||
      e.secretConfigurationMarker === 'DEPRECATED' ||
      e.secretConfigurationMarker === '[]'
  );

  return {
    catalogCount: CATALYST_ENV_VAR_CATALOG.length,
    requiredServerSpecCount: getRequiredServerEnvSpecs().length,
    exhaustiveMatrixCount: EXHAUSTIVE_ENV_VAR_MATRIX.length,
    missingFromExhaustiveMatrix,
    hostedNativeRequiresExternalOAuthSecrets,
    allSecretsHaveRedactedOrMarker,
    passed:
      missingFromExhaustiveMatrix.length === 0 &&
      !hostedNativeRequiresExternalOAuthSecrets &&
      allSecretsHaveRedactedOrMarker,
  };
}

export function buildPhase512OperationalPlan(): ConsolidatedPhase512Plan {
  const inventoryItems = CATALYST_RESOURCE_INVENTORY_BASELINE;
  const provisioningManifest = buildConsolidatedProvisioningManifest();
  const provisioningValidation = validateConsolidatedProvisioningManifest(provisioningManifest);
  const anomalyReport = detectRouteAndManifestAnomalies();
  const functionManifest = getFunctionDeploymentManifest('vigor_api');
  const gatewayConfigCandidate = buildAlternativeBConfig({
    frontendOrigin: 'https://app.vigorcore.lat',
    apiHostname: 'api.vigorcore.lat',
    functionName: 'vigor_api',
    projectEnvironment: 'Production',
  });
  const gatewayGlobalImpactAudit = buildApiGatewayGlobalImpactAudit();
  const corsOptionsMatrix = buildCorsOptionsMatrix('https://app.vigorcore.lat');

  return {
    phase: '5.1.2',
    mode: 'PLAN_ONLY_NON_APPLIED',
    applied: false,
    phase52Authorized: false,
    networkCallsExecuted: 0,
    writeOperationsExecuted: 0,
    targetArchitecture: {
      slateFrontendOrigin: 'https://app.vigorcore.lat',
      apiBackendOrigin: 'https://api.vigorcore.lat',
      domainTopology: 'CloudScale > Domain Mapping (Production + CNAME, webClientHosting=false)',
      corsPolicy: 'CloudScale > Whitelisting > Authorized Domains (https://app.vigorcore.lat) + VIGOR_CORS_MODE=platform_managed',
      primaryHostedAuthMode: 'hosted_native',
      fallbackAuthMode: 'external_oauth',
    },
    inventorySummary: {
      verifiedRemotelyCount: inventoryItems.filter(i => i.verificationTag === 'VERIFICADO REMOTAMENTE').length,
      localDocumentationOnlyCount: inventoryItems.filter(i => i.verificationTag === 'SOLO LOCAL / DOCUMENTACIÓN').length,
      unprovableWithoutRemoteAccessCount: inventoryItems.filter(
        i => i.verificationTag === 'NO COMPROBABLE SIN ACCESO REMOTO'
      ).length,
      items: inventoryItems,
    },
    provisioningManifest,
    provisioningValidation,
    envVarMatrix: EXHAUSTIVE_ENV_VAR_MATRIX,
    functionManifest,
    anomalyReport,
    gatewayConfigCandidate,
    gatewayGlobalImpactAudit,
    corsOptionsMatrix,
    orderedTransitionPhases: [
      'PHASE 5.1.2 (CURRENT — NO REMOTE WRITES): Complete local manifest, build check, CLI preflight/plan, and remote read-only inventory checklist.',
      'PHASE 5.2 (SEPARATE AUTHORIZATION REQUIRED): Create the exact 5 empty NoSQL tables and 8 GSIs manually in Catalyst Console in order Users -> UserData -> AdminInvitations -> AuditLogs -> SystemControl, then verify via `verify-clean-slate-provisioning.ts --live --confirm-readonly`.',
      'PHASE 5.3+ PRE-DEPLOY GATE: Snapshot Project Security Rules JSON, inventory all existing project functions, configure Authorized Domains (`https://app.vigorcore.lat`), and set runtime env secrets (`[CONFIGURAR_EN_CATALYST]`) in Catalyst.',
      'PHASE 5.3+ DEPLOY: Compile server (`npm run build:server` -> `dist/server/catalystEntry.js`), package Advanced I/O `vigor_api` (Node 22), deploy function, enable API Gateway with vetted `alternative-b-api-gateway.routes.json`, and configure Domain Mapping `api.vigorcore.lat` + CNAME.',
      'PHASE 5.4 LIVE VERIFICATION (INT-01..INT-08 & BR-01..BR-20): Validate live `x-zc-*` headers, `Set-Cookie __Host-vigor_session`, Chromium OPTIONS/CORS, Safari/WebKit SameSite=Strict, and offline superadmin bootstrap prior to production cutover.',
    ],
    recoveryActions: [
      {
        scenario: 'Schema discrepancy or unwanted sort key/TTL detected while creating 5 tables',
        detectionSignal: 'Catalyst Console rejects omitted SK, refuses ttlEpochSec=Number, or --live verifier returns FAIL_SCHEMA_MISMATCH',
        safeRecoveryCommandOrAction:
          'STOP IMMEDIATELY. Do not insert rows; record mismatch because Catalyst keys/GSIs are immutable post-creation and re-create in clean project before any writes.',
      },
      {
        scenario: 'API Gateway enablement breaks existing functions or exposes unmapped internal endpoints',
        detectionSignal: 'Non-VigorCore function unreachable or unintended public route reachable after `catalyst apig:enable`',
        safeRecoveryCommandOrAction:
          'Execute `catalyst apig:disable` immediately to re-enable prior Project Security Rules globally and inspect snapshot diff.',
      },
      {
        scenario: 'API Gateway NO_AUTHENTICATION route fails with 503 HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
        detectionSignal: 'Gateway does not inject x-zc-admin-cred-token on NO_AUTHENTICATION routes',
        safeRecoveryCommandOrAction:
          'Switch runtime env `VIGOR_CATALYST_AUTH_MODE=external_oauth` with `[CONFIGURAR_EN_CATALYST]` OAuth secrets cleanly without code redesign.',
      },
      {
        scenario: 'Duplicate Access-Control-Allow-Origin header errors in Chromium/Safari',
        detectionSignal: 'Browser console reports multiple Access-Control-Allow-Origin values',
        safeRecoveryCommandOrAction:
          'Confirm `VIGOR_CORS_MODE=platform_managed` when CloudScale Authorized Domains is active so Express emits only `Vary: Origin`.',
      },
    ],
    blockersAndPendingLiveChecks: [
      'NO_CATALYST_CLI & NO_REMOTE_CREDENTIALS_IN_SANDBOX: Remote project/table/function/Security Rules inventory requires operator inspection with read-only access.',
      'INT-01..INT-05: Live Catalyst NoSQL conditional/consistent_read/superadmin-atomicity/TTL-Number verification pending until Phase 5.2 tables exist.',
      'INT-06..INT-07 & BR-01..BR-20: Real Chromium + Safari/WebKit OPTIONS preflight & SameSite=Strict __Host-vigor_session delivery on app.vigorcore.lat -> api.vigorcore.lat.',
      'INT-08 & GATEWAY-NOAUTH-ADMIN-HDR: Real Catalyst `x-zc-admin-cred-token` & `Origin`/`Referer`/`Sec-Fetch-Site` edge header behavior under NO_AUTHENTICATION vs CATALYST_USERS_AUTHENTICATION.',
    ],
  };
}

export function runSafePreflightValidation(
  envMap: Record<string, string | undefined> = process.env,
  options: {
    authMode?: 'hosted_native' | 'external_oauth';
    scope?: 'provisioning_readonly' | 'full_server_runtime';
    allowInsecureLoopbackForTest?: boolean;
  } = {}
): {
  mode: 'PREFLIGHT_ZERO_NETWORK';
  applied: false;
  networkCallsExecuted: 0;
  writeOperationsExecuted: 0;
  provisioningValidation: ProvisioningManifestValidationResult;
  envCoverageAudit: ReturnType<typeof auditEnvironmentVariableCoverage>;
  anomalyReport: AnomalyDetectionReport;
  configPreflight: CatalystConfigPreflightReport;
  overallPassed: boolean;
} {
  const provisioningManifest = buildConsolidatedProvisioningManifest();
  const provisioningValidation = validateConsolidatedProvisioningManifest(provisioningManifest);
  const envCoverageAudit = auditEnvironmentVariableCoverage();
  const anomalyReport = detectRouteAndManifestAnomalies();
  const configPreflight = runCatalystConfigPreflight(envMap, {
    scope: options.scope ?? 'full_server_runtime',
    authMode: options.authMode ?? 'hosted_native',
    allowInsecureLoopbackForTest: options.allowInsecureLoopbackForTest,
  });

  return {
    mode: 'PREFLIGHT_ZERO_NETWORK',
    applied: false,
    networkCallsExecuted: 0,
    writeOperationsExecuted: 0,
    provisioningValidation,
    envCoverageAudit,
    anomalyReport,
    configPreflight,
    overallPassed:
      provisioningValidation.passed &&
      envCoverageAudit.passed &&
      anomalyReport.passed &&
      configPreflight.verdict === 'PASS',
  };
}
