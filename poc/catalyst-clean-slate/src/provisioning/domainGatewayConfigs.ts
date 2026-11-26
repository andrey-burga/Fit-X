/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 + Phase 5.1.1 Candidate Non-Applied Domain, Security Rules,
 * CORS/OPTIONS Matrix, Gateway Global Impact Audit & API Gateway Configuration
 *
 * IMPORTANT:
 * - All configurations remain NON-APPLIED (`applied: false`).
 * - Incorporates Zoho Catalyst official support confirmation (2026-11-17):
 *   1. Frontend Slate remains at `https://app.vigorcore.lat`.
 *   2. Backend API uses `https://api.vigorcore.lat` via CloudScale Domain Mapping
 *      (Production environment + CNAME DNS record), eliminating cross-site cookies.
 *   3. Advanced I/O runs behind Catalyst API Gateway without Web Client Hosting.
 *   4. Gateway rewrites `/api/v1/*` -> `/server/<fnName>/api/v1/*`.
 *   5. CloudScale Whitelisting > Authorized Domains enables CORS without iFrame.
 *   6. Enabling API Gateway disables Project Security Rules GLOBALLY across the project.
 * - Zero real project IDs, zero secrets, zero credentials, zero remote writes.
 */

import { CANONICAL_ROUTE_COUNT, ROUTE_CONTRACT_SPECS, type RouteContractSpec } from '../routes/routeContracts.js';
import { normalizeCatalystPath } from '../server/advancedIoApp.js';

export interface DomainGatewayOptions {
  frontendOrigin?: string;
  apiHostname?: string;
  functionName?: string;
  projectEnvironment?: 'Development' | 'Production';
}

export interface CandidateSecurityRuleEntry {
  url: string;
  method?: string;
  authentication: 'optional' | 'required';
  notes: string;
}

export interface CandidateAlternativeAConfig {
  alternative: 'A_DIRECT_ADVANCED_IO_CUSTOM_DOMAIN';
  applied: false;
  frontendOrigin: string;
  apiOrigin: string;
  functionName: string;
  cookieTopology: 'same-site';
  securityRules: {
    version: string;
    rules: CandidateSecurityRuleEntry[];
  };
  catalystConfigTemplate: Record<string, unknown>;
  liveVerificationPending: string[];
  caveats: string[];
}

export type GatewayAuthMode =
  | 'CATALYST_USERS_AUTHENTICATION'
  | 'OAUTH_ZOHO_CATALYST_FUNCTIONS_EXECUTE'
  | 'NO_AUTHENTICATION'
  | 'PLATFORM_MANAGED_AUTHORIZED_DOMAINS';

export interface CandidateApiGatewayRouteEntry {
  request_method: 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  request_url: string;
  target_type: 'advancedio';
  target_function: string;
  target_path: string;
  authentication: 'NO_AUTHENTICATION' | 'CATALYST_USERS_AUTHENTICATION';
  notes: string;
}

export interface RouteGatewayAuthSpec {
  readonly routeId: string;
  readonly method: RouteContractSpec['method'];
  readonly canonicalPath: string;
  readonly gatewayPathPattern: string;
  readonly targetPathPattern: string;
  readonly recommendedGatewayAuth: 'NO_AUTHENTICATION' | 'CATALYST_USERS_AUTHENTICATION';
  readonly fallbackGatewayAuth: 'NO_AUTHENTICATION';
  readonly oauthExecuteAllowed: false;
  readonly oauthExecuteRationale: string;
  readonly backendSecurityEnforcement: string;
  readonly pendingLiveVerification: readonly string[];
}

export interface CandidateAlternativeBConfig {
  alternative: 'B_CLOUDSCALE_API_GATEWAY';
  applied: false;
  selectedByZohoSupportDecision: true;
  zohoSupportDecisionDate: '2026-11-17';
  frontendOrigin: string;
  apiOrigin: string;
  functionName: string;
  cookieTopology: 'same-site';
  domainMapping: {
    feature: 'CloudScale > Domain Mapping';
    hostname: string;
    targetCatalystEnvironment: 'Production' | 'Development';
    dnsRecordType: 'CNAME';
    webClientHostingRequired: false;
    prerequisite: 'Enable API Gateway on target Catalyst environment before final cutover';
  };
  authorizedDomainsCors: {
    feature: 'CloudScale > Whitelisting > Authorized Domains';
    allowedDomains: string[];
    wildcardPermitted: false;
    supportsWithoutIframe: true;
    duplicateHeaderPrevention: 'Use VIGOR_CORS_MODE=platform_managed when Catalyst edge emits Access-Control-* headers';
  };
  gatewayConfig: {
    domain: string;
    authEnabledAtGateway: false;
    routes: CandidateApiGatewayRouteEntry[];
  };
  perRouteAuthMatrix: readonly RouteGatewayAuthSpec[];
  liveVerificationPending: string[];
  caveats: string[];
}

export function buildAlternativeAConfig(
  options: DomainGatewayOptions = {}
): CandidateAlternativeAConfig {
  const frontendOrigin = options.frontendOrigin ?? 'https://app.vigorcore.lat';
  const apiHostname = options.apiHostname ?? 'api.vigorcore.lat';
  const functionName = options.functionName ?? 'vigor_api';
  const apiOrigin = `https://${apiHostname}`;

  return {
    alternative: 'A_DIRECT_ADVANCED_IO_CUSTOM_DOMAIN',
    applied: false,
    frontendOrigin,
    apiOrigin,
    functionName,
    cookieTopology: 'same-site',
    securityRules: {
      version: '1.0-candidate',
      rules: [
        {
          url: '/api/v1/*',
          authentication: 'optional',
          notes:
            'Security Rules set to optional because VigorCore verifies HMAC __Host-vigor_session cookies internally inside Express and Catalyst user-scope only on /auth/session/bootstrap-profile and /exchange.',
        },
        {
          url: '/health',
          method: 'GET',
          authentication: 'optional',
          notes: 'Non-sensitive liveness endpoint returning route count and service status only.',
        },
      ],
    },
    catalystConfigTemplate: {
      deployment: {
        name: functionName,
        type: 'advancedio',
        source: 'catalyst-clean-slate',
        stack: 'node22',
      },
      execution: {
        main: 'dist/server/catalystEntry.js',
        environmentVariablesSchema: [
          'VIGORCORE_CATALYST_PROJECT_ID',
          'CATALYST_PROJECT_KEY',
          'VIGORCORE_DEPLOYMENT_ENVIRONMENT',
          'VIGOR_ENVIRONMENT',
          'VIGORCORE_CATALYST_API_DOMAIN',
          'VIGORCORE_CATALYST_ACCOUNTS_URL',
          'VIGOR_CATALYST_AUTH_MODE',
          'VIGOR_CORS_MODE',
          'VIGOR_SESSION_HMAC_SECRET',
          'VIGOR_SESSION_ACTIVE_KID',
          'VIGOR_ALLOWED_ORIGINS',
        ],
      },
      candidateOnlyNotice: 'SUPERSEDED FOR PRIMARY TOPOLOGY BY ZOHO SUPPORT CONFIRMATION (ALTERNATIVE B: API GATEWAY + DOMAIN MAPPING)',
    },
    liveVerificationPending: [
      'SUPERSEDED: Zoho Support (2026-11-17) confirmed API Gateway + CloudScale Domain Mapping (Alternative B) is the supported topology without Web Client Hosting.',
    ],
    caveats: [
      'Retained only as rollback/reference record prior to Alternative B adoption.',
      'No wildcard CORS (*) is ever permitted.',
    ],
  };
}

export function buildRouteGatewayAuthMatrix(
  functionName = 'vigor_api'
): RouteGatewayAuthSpec[] {
  return ROUTE_CONTRACT_SPECS.map(spec => {
    const isCatalystExchange = spec.authPolicy === 'catalyst_exchange';
    const isInspectHybrid = spec.authPolicy === 'catalyst_or_hmac_inspect';

    return {
      routeId: spec.id,
      method: spec.method,
      canonicalPath: spec.path,
      gatewayPathPattern: spec.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
      targetPathPattern: `/server/${functionName}${spec.path}`,
      recommendedGatewayAuth: isCatalystExchange
        ? 'CATALYST_USERS_AUTHENTICATION'
        : 'NO_AUTHENTICATION',
      fallbackGatewayAuth: 'NO_AUTHENTICATION',
      oauthExecuteAllowed: false,
      oauthExecuteRationale:
        'OAuth ZohoCatalyst.Functions.Execute is reserved for external M2M Zoho API clients and MUST NOT be imposed across browser Slate endpoints authenticated by Catalyst Users or __Host-vigor_session.',
      backendSecurityEnforcement: isCatalystExchange
        ? 'Catalyst user-scope verification (scope="user") + server NoSQL profile/status resolution + pre-session CSRF (Origin/Sec-Fetch-Site/X-Vigor-Requested-With) + mints __Host-vigor_session & bound X-Vigor-CSRF.'
        : isInspectHybrid
          ? 'Verifies signed __Host-vigor_session HMAC + Users consistent_read OR Catalyst user-scope when cookie absent (deny-by-default if Users missing).'
          : `Requires valid signed __Host-vigor_session HMAC + SESSION#<sid> consistent_read + server role (${spec.allowedRoles.join('|')}) + anti-IDOR${spec.requiresCsrf ? ' + bound X-Vigor-CSRF + Origin/Referer check' : ''}.`,
      pendingLiveVerification: isCatalystExchange
        ? [
            'INT-08/GATEWAY-EXCHANGE: Confirm whether Catalyst Users Authentication vs NO_AUTHENTICATION injects both x-zc-admin-cred-token and x-zc-user-cred-token cleanly.',
            'INT-07: Confirm Set-Cookie __Host-vigor_session (SameSite=Strict) passes untouched from /server/<fn> through API Gateway.',
          ]
        : [
            'GATEWAY-NOAUTH-ADMIN-HDR: Confirm whether API Gateway NO_AUTHENTICATION injects x-zc-admin-cred-token on cookie-authenticated routes; if not, keep VIGOR_CATALYST_AUTH_MODE=external_oauth fallback.',
            'INT-06: Confirm Origin/Referer/Sec-Fetch-Site/X-Vigor-CSRF passthrough.',
          ],
    };
  });
}

export const ROUTE_GATEWAY_AUTH_MATRIX: readonly RouteGatewayAuthSpec[] =
  buildRouteGatewayAuthMatrix('vigor_api');

export function buildAlternativeBConfig(
  options: DomainGatewayOptions = {}
): CandidateAlternativeBConfig {
  const frontendOrigin = options.frontendOrigin ?? 'https://app.vigorcore.lat';
  const apiHostname = options.apiHostname ?? 'api.vigorcore.lat';
  const functionName = options.functionName ?? 'vigor_api';
  const apiOrigin = `https://${apiHostname}`;
  const projectEnvironment = options.projectEnvironment ?? 'Production';
  const perRouteAuthMatrix = buildRouteGatewayAuthMatrix(functionName);

  return {
    alternative: 'B_CLOUDSCALE_API_GATEWAY',
    applied: false,
    selectedByZohoSupportDecision: true,
    zohoSupportDecisionDate: '2026-11-17',
    frontendOrigin,
    apiOrigin,
    functionName,
    cookieTopology: 'same-site',
    domainMapping: {
      feature: 'CloudScale > Domain Mapping',
      hostname: apiHostname,
      targetCatalystEnvironment: projectEnvironment,
      dnsRecordType: 'CNAME',
      webClientHostingRequired: false,
      prerequisite: 'Enable API Gateway on target Catalyst environment before final cutover',
    },
    authorizedDomainsCors: {
      feature: 'CloudScale > Whitelisting > Authorized Domains',
      allowedDomains: [frontendOrigin],
      wildcardPermitted: false,
      supportsWithoutIframe: true,
      duplicateHeaderPrevention:
        'Use VIGOR_CORS_MODE=platform_managed when Catalyst edge emits Access-Control-* headers',
    },
    gatewayConfig: {
      domain: apiHostname,
      authEnabledAtGateway: false,
      routes: [
        {
          request_method: 'POST',
          request_url: '/api/v1/auth/session/bootstrap-profile',
          target_type: 'advancedio',
          target_function: functionName,
          target_path: `/server/${functionName}/api/v1/auth/session/bootstrap-profile`,
          authentication: 'CATALYST_USERS_AUTHENTICATION',
          notes:
            'Primary candidate uses Catalyst Users Authentication for user-scope bootstrap-profile (reconcile against NO_AUTHENTICATION fallback during INT-08 live test if edge header behavior differs).',
        },
        {
          request_method: 'POST',
          request_url: '/api/v1/auth/session/exchange',
          target_type: 'advancedio',
          target_function: functionName,
          target_path: `/server/${functionName}/api/v1/auth/session/exchange`,
          authentication: 'CATALYST_USERS_AUTHENTICATION',
          notes:
            'Primary candidate uses Catalyst Users Authentication for user-scope session exchange into __Host-vigor_session + X-Vigor-CSRF.',
        },
        {
          request_method: 'OPTIONS',
          request_url: '/api/v1/*',
          target_type: 'advancedio',
          target_function: functionName,
          target_path: `/server/${functionName}/api/v1/*`,
          authentication: 'NO_AUTHENTICATION',
          notes:
            'CORS preflight handled via CloudScale Authorized Domains (app.vigorcore.lat) at edge and validated fail-closed in Express without duplicate Access-Control-* headers when VIGOR_CORS_MODE=platform_managed.',
        },
        {
          request_method: 'ANY',
          request_url: '/api/v1/*',
          target_type: 'advancedio',
          target_function: functionName,
          target_path: `/server/${functionName}/api/v1/*`,
          authentication: 'NO_AUTHENTICATION',
          notes:
            `Covers refresh, logout, revoke, auth/me, all athlete routes, invitations/redeem, and all admin governance routes (${CANONICAL_ROUTE_COUNT} total canonical endpoints) under VigorCore HMAC cookie + bound X-Vigor-CSRF + RBAC middleware.`,
        },
        {
          request_method: 'GET',
          request_url: '/health',
          target_type: 'advancedio',
          target_function: functionName,
          target_path: `/server/${functionName}/health`,
          authentication: 'NO_AUTHENTICATION',
          notes: 'Minimal unprivileged health endpoint returning service status and route count only.',
        },
      ],
    },
    perRouteAuthMatrix,
    liveVerificationPending: [
      'INT-06: Verify OPTIONS CORS preflight from https://app.vigorcore.lat to https://api.vigorcore.lat/api/v1/* returns 2xx/204 in Chromium & Safari/WebKit without duplicate Access-Control-* headers.',
      'INT-07: Verify API Gateway preserves Set-Cookie: __Host-vigor_session=...; HttpOnly; Secure; SameSite=Strict; Path=/ and forwards Cookie on same-site fetches.',
      'INT-08: Verify Catalyst user-scope headers vs NO_AUTHENTICATION admin credential injection (`x-zc-admin-cred-token`) and password reset admin compatibility.',
      'EDGE-HEADERS: Verify whether API Gateway strips or overwrites Origin, Referer, and Sec-Fetch-Site before reaching Advanced I/O.',
    ],
    caveats: [
      'OPERATIONAL WARNING: Enabling Catalyst API Gateway (`catalyst apig:enable`) AUTOMATICALLY deactivates Project Security Rules globally; `catalyst apig:disable` re-enables them.',
      'PRICING/QUOTA WARNING: API Gateway requests may consume paid CloudScale / gateway tiers depending on Catalyst billing plan.',
      'Express normalizeCatalystPath strips `/server/<fnName>` automatically when Gateway rewrites `/api/v1/*` -> `/server/<fnName>/api/v1/*`.',
    ],
  };
}

export interface GatewayRewriteVerificationRow {
  routeId: string;
  method: RouteContractSpec['method'];
  canonicalPath: string;
  sampleRequestPath: string;
  gatewayRewrittenPath: string;
  normalizedExpressPath: string;
  matchesCanonicalContract: boolean;
}

export interface GatewayRewriteCoverageReport {
  functionName: string;
  totalRoutes: number;
  passedRoutes: number;
  allMatched: boolean;
  rows: GatewayRewriteVerificationRow[];
}

export function verifyGatewayRewriteCoverage(
  functionName = 'vigor_api'
): GatewayRewriteCoverageReport {
  const rows: GatewayRewriteVerificationRow[] = ROUTE_CONTRACT_SPECS.map(spec => {
    const sampleRequestPath = spec.path.replace(/:([A-Za-z0-9_]+)/g, (_m, param) => `sample_${param}_1`);
    const gatewayRewrittenPath = `/server/${functionName}${sampleRequestPath}`;
    const normalizedExpressPath = normalizeCatalystPath(gatewayRewrittenPath);
    const matchesCanonicalContract = normalizedExpressPath === sampleRequestPath;

    return {
      routeId: spec.id,
      method: spec.method,
      canonicalPath: spec.path,
      sampleRequestPath,
      gatewayRewrittenPath,
      normalizedExpressPath,
      matchesCanonicalContract,
    };
  });

  const passedRoutes = rows.filter(r => r.matchesCanonicalContract).length;
  return {
    functionName,
    totalRoutes: rows.length,
    passedRoutes,
    allMatched: passedRoutes === ROUTE_CONTRACT_SPECS.length && rows.length === CANONICAL_ROUTE_COUNT,
    rows,
  };
}

export interface GatewayAuthMatrixCompletenessReport {
  totalContractRoutes: number;
  totalMatrixRoutes: number;
  missingRouteIds: string[];
  extraRouteIds: string[];
  allRoutesCovered: boolean;
  zeroOAuthExecuteForced: boolean;
}

export function verifyGatewayAuthMatrixCompleteness(
  matrix: readonly RouteGatewayAuthSpec[] = ROUTE_GATEWAY_AUTH_MATRIX
): GatewayAuthMatrixCompletenessReport {
  const contractIds = ROUTE_CONTRACT_SPECS.map(r => r.id);
  const matrixIds = matrix.map(r => r.routeId);
  const contractSet = new Set(contractIds);
  const matrixSet = new Set(matrixIds);

  const missingRouteIds = contractIds.filter(id => !matrixSet.has(id));
  const extraRouteIds = matrixIds.filter(id => !contractSet.has(id));
  const zeroOAuthExecuteForced = matrix.every(entry => entry.oauthExecuteAllowed === false);

  return {
    totalContractRoutes: contractIds.length,
    totalMatrixRoutes: matrix.length,
    missingRouteIds,
    extraRouteIds,
    allRoutesCovered:
      missingRouteIds.length === 0 &&
      extraRouteIds.length === 0 &&
      matrixIds.length === matrixSet.size &&
      contractIds.length === CANONICAL_ROUTE_COUNT,
    zeroOAuthExecuteForced,
  };
}

export interface CorsOptionsMatrixEntry {
  method: 'OPTIONS' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  credentialsMode: 'include';
  requiredRequestHeaders: string[];
  expressEnforcedResponseHeaders: Record<string, string>;
  platformManagedExpressResponseHeaders: Record<string, string>;
  edgePlatformResponsibility: string;
  localVerified: boolean;
  liveBrowserStatus: 'PENDING-LIVE-VERIFICATION';
}

export function buildCorsOptionsMatrix(
  allowedOrigin = 'https://app.vigorcore.lat'
): {
  allowedOrigin: string;
  wildcardAllowed: false;
  authorizedDomainsConsolePath: string;
  iframeEmbeddingRequired: false;
  entries: CorsOptionsMatrixEntry[];
  liveVerificationPending: string[];
} {
  return {
    allowedOrigin,
    wildcardAllowed: false,
    authorizedDomainsConsolePath: 'CloudScale > Whitelisting > Authorized Domains',
    iframeEmbeddingRequired: false,
    entries: [
      {
        method: 'OPTIONS',
        credentialsMode: 'include',
        requiredRequestHeaders: [
          'Origin',
          'Access-Control-Request-Method',
          'Access-Control-Request-Headers (Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With)',
        ],
        expressEnforcedResponseHeaders: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With',
          Vary: 'Origin',
        },
        platformManagedExpressResponseHeaders: {
          Vary: 'Origin',
        },
        edgePlatformResponsibility:
          'CloudScale Authorized Domains emits Access-Control-Allow-Origin / Allow-Credentials / Allow-Methods / Allow-Headers at Gateway edge; Express suppresses duplicate Access-Control-* headers while validating Origin.',
        localVerified: true,
        liveBrowserStatus: 'PENDING-LIVE-VERIFICATION',
      },
      {
        method: 'GET',
        credentialsMode: 'include',
        requiredRequestHeaders: ['Origin (browser cross-origin fetch)', 'Cookie (__Host-vigor_session)'],
        expressEnforcedResponseHeaders: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        },
        platformManagedExpressResponseHeaders: {
          Vary: 'Origin',
        },
        edgePlatformResponsibility:
          'Gateway forwards Cookie and Origin; backend still authenticates strictly via HMAC session and Users consistent_read.',
        localVerified: true,
        liveBrowserStatus: 'PENDING-LIVE-VERIFICATION',
      },
      ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map(method => ({
        method,
        credentialsMode: 'include' as const,
        requiredRequestHeaders: [
          'Origin (validated fail-closed against allowlist; fallback Referer check)',
          'Sec-Fetch-Site (when sent by browser: same-origin | same-site; cross-site rejected)',
          'Content-Type: application/json',
          'X-Vigor-Requested-With: XMLHttpRequest (bootstrap/exchange pre-session) OR X-Vigor-CSRF (signed session-bound mutations)',
          'Cookie: __Host-vigor_session=... (all authenticated mutations post-exchange)',
        ],
        expressEnforcedResponseHeaders: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        },
        platformManagedExpressResponseHeaders: {
          Vary: 'Origin',
        },
        edgePlatformResponsibility:
          'IMPORTANT: Never assume Catalyst edge preserves Origin, Referer, or Sec-Fetch-Site untouched; X-Vigor-CSRF cryptographic session binding MUST stay mandatory independently of Fetch Metadata.',
        localVerified: true,
        liveBrowserStatus: 'PENDING-LIVE-VERIFICATION' as const,
      })),
    ],
    liveVerificationPending: [
      'Real Chromium preflight OPTIONS + credentialed POST/PUT/PATCH/DELETE against https://api.vigorcore.lat from https://app.vigorcore.lat.',
      'Real Safari/WebKit SameSite=Strict __Host-vigor_session cookie transmission across subdomains.',
    ],
  };
}

export interface ApiGatewayGlobalImpactAudit {
  applied: false;
  criticalRule: string;
  inventoryChecklist: Array<{
    item: string;
    whyInspectBeforeEnable: string;
  }>;
  equivalenceRules: Array<{
    priorSecurityRuleScope: string;
    postEnableGatewayEquivalent: string;
    riskIfOmitted: string;
  }>;
  orderedTransitionSteps: string[];
  verificationChecklistPostEnable: string[];
  rollbackPlan: {
    command: string;
    effect: string;
    safetyChecksAfterRollback: string[];
  };
}

export function buildApiGatewayGlobalImpactAudit(): ApiGatewayGlobalImpactAudit {
  return {
    applied: false,
    criticalRule:
      'Enabling Catalyst API Gateway (`catalyst apig:enable`) GLOBALLY disables Project Security Rules across the entire Catalyst project and can alter public routing for existing consumers.',
    inventoryChecklist: [
      {
        item: 'All Catalyst Functions (Basic I/O, Advanced I/O, Cron, Event, Integration) in target project',
        whyInspectBeforeEnable:
          'Any existing function previously gated by Project Security Rules becomes exposed unless explicitly mapped or excluded in API Gateway routes.',
      },
      {
        item: 'Current Project Security Rules configuration export',
        whyInspectBeforeEnable:
          'Must be backed up before `apig:enable` because Security Rules are automatically turned off while API Gateway is active.',
      },
      {
        item: 'Zoho Catalyst Slate frontend (app.vigorcore.lat) & legacy integrations',
        whyInspectBeforeEnable:
          'Verify whether any existing consumer still calls `/baas/*` or `/server/*` project-domain URLs directly so routes remain intact.',
      },
      {
        item: 'Custom Domain mappings, Webhooks, and Zoho CRM/External callbacks',
        whyInspectBeforeEnable:
          'Ensure external webhooks or Domain Mapping rules do not break or change host/path expectations after Gateway rewrite.',
      },
    ],
    equivalenceRules: [
      {
        priorSecurityRuleScope: 'Security Rule: /api/v1/auth/session/bootstrap-profile & /exchange',
        postEnableGatewayEquivalent:
          'Gateway route with CATALYST_USERS_AUTHENTICATION (or verified NO_AUTHENTICATION fallback) -> /server/<fn>/api/v1/auth/session/*',
        riskIfOmitted:
          'Bootstrap/exchange unreachable or stripped of Catalyst user context.',
      },
      {
        priorSecurityRuleScope: 'Security Rule: /api/v1/* (optional -> Express HMAC + CSRF)',
        postEnableGatewayEquivalent:
          'Gateway route ANY /api/v1/* with NO_AUTHENTICATION + VigorCore HMAC cookie, bound X-Vigor-CSRF, RBAC & anti-IDOR',
        riskIfOmitted:
          'Cross-origin credentialed API calls return 404/401 or fail cookie checks.',
      },
      {
        priorSecurityRuleScope: 'Any non-VigorCore or legacy function previously blocked to public web',
        postEnableGatewayEquivalent:
          'Do NOT expose in API Gateway route table (or protect via explicit Gateway auth)',
        riskIfOmitted:
          'Because Project Security Rules disable globally, unmapped internal functions could remain reachable if another public URL exists.',
      },
    ],
    orderedTransitionSteps: [
      '1. Export and snapshot existing Project Security Rules and complete the pre-enablement inventory checklist.',
      '2. Verify Whitelisting > Authorized Domains includes ONLY https://app.vigorcore.lat (zero wildcards).',
      '3. Deploy Advanced I/O function (`vigor_api`) with VIGOR_CORS_MODE=platform_managed (or validated express_enforced) and full VIGOR_SESSION_HMAC_SECRET before exposing public Gateway routes.',
      '4. Enable API Gateway (`catalyst apig:enable`) and apply ONLY the vetted route definitions from alternative-b-api-gateway.routes.json.',
      '5. Map api.vigorcore.lat via CloudScale > Domain Mapping (Production environment) and configure CNAME DNS.',
      '6. Execute read-only smoke verification (GET /health, OPTIONS preflight, INT-06, INT-07, INT-08, non-VigorCore exposure check).',
    ],
    verificationChecklistPostEnable: [
      'Verify GET https://api.vigorcore.lat/health returns 200 without leaking secrets or env variables.',
      'Verify OPTIONS /api/v1/* from https://app.vigorcore.lat returns 204/200 with single non-duplicated Access-Control-Allow-Origin: https://app.vigorcore.lat.',
      'Verify unauthenticated GET /api/v1/athlete/workspace returns 401 and does not leak data.',
      'Verify Set-Cookie __Host-vigor_session preserves HttpOnly; Secure; SameSite=Strict; Path=/.',
      'Verify any pre-existing non-VigorCore project function is not unintentionally reachable without auth.',
    ],
    rollbackPlan: {
      command: 'catalyst apig:disable',
      effect:
        'Disables API Gateway immediately and automatically re-enables the prior Project Security Rules.',
      safetyChecksAfterRollback: [
        'Confirm Project Security Rules are active again in Catalyst Console.',
        'Confirm https://app.vigorcore.lat remains completely operational and unaffected.',
        'Re-test /health and unauthenticated deny checks on any direct project endpoints.',
      ],
    },
  };
}

export interface ServerEnvVariableSpec {
  name: string;
  requiredInExternalOAuth: boolean;
  requiredInHostedNative: boolean;
  secret: boolean;
  exampleValue: string;
  purpose: string;
}

export function getRequiredServerEnvSpecs(): ServerEnvVariableSpec[] {
  return [
    {
      name: 'VIGOR_CATALYST_AUTH_MODE',
      requiredInExternalOAuth: false,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'hosted_native',
      purpose: "Selects 'hosted_native' (zcAuth.init inside Catalyst Advanced I/O) or 'external_oauth' (CatalystAdminAppProvider)",
    },
    {
      name: 'VIGOR_CORS_MODE',
      requiredInExternalOAuth: false,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'platform_managed',
      purpose: "Selects 'express_enforced' (Express emits CORS headers) or 'platform_managed' (CloudScale Authorized Domains emits CORS headers; Express suppresses duplicate Access-Control-* while enforcing fail-closed Origin/CSRF)",
    },
    {
      name: 'VIGORCORE_CATALYST_PROJECT_ID',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: '<VIGORCORE_CATALYST_PROJECT_ID>',
      purpose: 'Catalyst Project ID pinned for BaaS calls and x-zc-projectid anti-spoofing check (non-reserved replacement for CATALYST_PROJECT_ID)',
    },
    {
      name: 'CATALYST_PROJECT_KEY',
      requiredInExternalOAuth: true,
      requiredInHostedNative: false,
      secret: true,
      exampleValue: '<CATALYST_PROJECT_KEY>',
      purpose: 'Catalyst Project Key sent in HTTP header PROJECT_ID by @zcatalyst/auth-admin (in hosted_native may be supplied by edge x-zc-project-key or pinned)',
    },
    {
      name: 'VIGORCORE_DEPLOYMENT_ENVIRONMENT',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'Development',
      purpose: 'Custom VigorCore deployment selector (Development | Production); avoids Catalyst reserved keyword CATALYST_ENVIRONMENT and matches VIGOR_ENVIRONMENT + x-zc-environment policy',
    },
    {
      name: 'VIGOR_ENVIRONMENT',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'development',
      purpose: 'Enforces HMAC key & Catalyst environment isolation',
    },
    {
      name: 'VIGORCORE_CATALYST_API_DOMAIN',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'https://api.catalyst.zoho.com',
      purpose: 'Pinned regional Zoho Catalyst API origin (non-reserved replacement for CATALYST_API_DOMAIN; prevents zc-api-domain header injection)',
    },
    {
      name: 'VIGORCORE_CATALYST_ACCOUNTS_URL',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'https://accounts.zoho.com',
      purpose: 'Pinned regional Zoho Accounts origin (non-reserved replacement for CATALYST_ACCOUNTS_URL; required for external OAuth and domain pinning)',
    },
    {
      name: 'CATALYST_ADMIN_CLIENT_ID',
      requiredInExternalOAuth: true,
      requiredInHostedNative: false,
      secret: false,
      exampleValue: '<OAUTH_CLIENT_ID>',
      purpose: 'Server-only Zoho OAuth client ID (REQUIRED only in external_oauth / CLI mode; NOT needed in hosted_native)',
    },
    {
      name: 'CATALYST_ADMIN_CLIENT_SECRET',
      requiredInExternalOAuth: true,
      requiredInHostedNative: false,
      secret: true,
      exampleValue: '<OAUTH_CLIENT_SECRET>',
      purpose: 'Server-only Zoho OAuth client secret (REQUIRED only in external_oauth / CLI mode; NOT needed in hosted_native)',
    },
    {
      name: 'CATALYST_ADMIN_REFRESH_TOKEN',
      requiredInExternalOAuth: true,
      requiredInHostedNative: false,
      secret: true,
      exampleValue: '<OAUTH_REFRESH_TOKEN>',
      purpose: 'Server-only Zoho OAuth refresh token (REQUIRED only in external_oauth / CLI mode; NOT needed in hosted_native)',
    },
    {
      name: 'VIGOR_SESSION_HMAC_SECRET',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: true,
      exampleValue: '<BASE64URL_32_BYTES_CSPRNG>',
      purpose: '256-bit Base64URL secret signing __Host-vigor_session and X-Vigor-CSRF tokens',
    },
    {
      name: 'VIGOR_SESSION_ACTIVE_KID',
      requiredInExternalOAuth: false,
      requiredInHostedNative: false,
      secret: false,
      exampleValue: 'k1',
      purpose: 'Active HMAC key identifier for zero-downtime secret rotation',
    },
    {
      name: 'VIGOR_SESSION_PREVIOUS_SECRETS_JSON',
      requiredInExternalOAuth: false,
      requiredInHostedNative: false,
      secret: true,
      exampleValue: '[]',
      purpose: 'Optional JSON array of previous { kid, secret } objects during key rotation',
    },
    {
      name: 'VIGOR_ALLOWED_ORIGINS',
      requiredInExternalOAuth: true,
      requiredInHostedNative: true,
      secret: false,
      exampleValue: 'https://app.vigorcore.lat',
      purpose: 'Explicit CORS allowlist (zero wildcards permitted)',
    },
  ];
}
