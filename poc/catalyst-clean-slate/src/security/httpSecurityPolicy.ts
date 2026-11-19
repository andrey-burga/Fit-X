/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.4 HTTP Security Policy: CORS, Origin Allowlist, Fetch Metadata CSRF Guard & Cookie Verification
 *
 * Enforces:
 * 1. Strict Origin allowlist (default: `https://fit-x-bhnatsxl.onslate.com`) — NEVER `*` with credentials.
 * 2. Exact `Access-Control-Allow-Origin` reflection only for allowlisted origins + `Access-Control-Allow-Credentials: true` + `Vary: Origin`.
 * 3. CSRF validation on all state-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`),
 *    specifically protecting `/auth/session/bootstrap-profile`, `/auth/session/exchange`,
 *    `/auth/session/refresh`, `/auth/session/logout`, and `/auth/session/revoke`.
 * 4. Fetch Metadata (`Sec-Fetch-Site`) rejection when `cross-site` is reported.
 * 5. `__Host-vigor_session` strict cookie attribute verification (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain=`).
 * 6. Honest browser/Slate vs Catalyst Advanced I/O origin/site topology evaluator.
 */

import { SIGNED_SESSION_COOKIE_NAME, type IncomingHttpRequest } from '../auth/cleanSlateAuthGuard.js';

export const DEFAULT_ALLOWED_ORIGINS = ['https://fit-x-bhnatsxl.onslate.com'] as const;

export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class HttpSecurityError extends Error {
  constructor(
    public readonly statusCode: 400 | 403,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpSecurityError';
  }
}

export type CorsHandlingMode = 'express_enforced' | 'platform_managed';

export interface HttpSecurityPolicyConfig {
  allowedOrigins: string[];
  corsMode?: CorsHandlingMode;
  requireOriginOnMutations?: boolean;
  enforceFetchMetadata?: boolean;
  requireCsrfHeaderOnMutations?: boolean;
  enforceSignedCsrfTokens?: boolean;
}

function readHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  targetName: string
): string | undefined {
  if (!headers) return undefined;
  const lower = targetName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && typeof v === 'string' && v.trim() !== '') {
      return v.trim();
    }
  }
  return undefined;
}

function hasHeaderKeyCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  targetName: string
): boolean {
  if (!headers) return false;
  const lower = targetName.toLowerCase();
  return Object.keys(headers).some(k => k.toLowerCase() === lower && headers[k] !== undefined);
}

export function extractCanonicalOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export type RouteCsrfPolicyKind =
  | 'pre_session_catalyst_exchange'
  | 'signed_session_bound'
  | 'none_safe_get';

export class HttpSecurityPolicy {
  private readonly allowedOriginSet: Set<string>;
  private readonly corsMode: CorsHandlingMode;
  private readonly requireOriginOnMutations: boolean;
  private readonly enforceFetchMetadata: boolean;
  private readonly requireCsrfHeaderOnMutations: boolean;
  private readonly enforceSignedCsrfTokens: boolean;

  constructor(config?: Partial<HttpSecurityPolicyConfig>) {
    const rawList = config?.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS];
    if (rawList.includes('*')) {
      throw new Error('INVALID_CORS_CONFIG: Wildcard `*` origin is strictly prohibited with credentialed cookies.');
    }
    this.allowedOriginSet = new Set(
      rawList
        .map(o => extractCanonicalOrigin(o))
        .filter((o): o is string => Boolean(o))
    );
    if (this.allowedOriginSet.size === 0) {
      throw new Error('INVALID_CORS_CONFIG: At least one valid explicit origin must be configured.');
    }
    this.corsMode = config?.corsMode ?? 'express_enforced';
    this.requireOriginOnMutations = config?.requireOriginOnMutations ?? true;
    this.enforceFetchMetadata = config?.enforceFetchMetadata ?? true;
    this.requireCsrfHeaderOnMutations = config?.requireCsrfHeaderOnMutations ?? false;
    this.enforceSignedCsrfTokens = config?.enforceSignedCsrfTokens ?? false;
  }

  getCorsMode(): CorsHandlingMode {
    return this.corsMode;
  }

  isSignedCsrfEnforced(): boolean {
    return this.enforceSignedCsrfTokens;
  }

  isOriginAllowed(originHeader: string): boolean {
    const canonical = extractCanonicalOrigin(originHeader);
    return Boolean(canonical && this.allowedOriginSet.has(canonical));
  }

  /**
   * Validates CORS `Origin` and builds credentialed response headers.
   * - In `express_enforced`: emits explicit ACAO/ACAC/ACAM/ACAH/ACEH + `Vary: Origin`.
   * - In `platform_managed` (Catalyst Whitelisting > Authorized Domains): still rejects untrusted
   *   `Origin` values fail-closed (403) while emitting ONLY `Vary: Origin` so Edge CORS headers are NEVER duplicated.
   * NEVER emits `Access-Control-Allow-Origin: *` and NEVER reflects unallowlisted origins.
   */
  buildCorsHeaders(req: IncomingHttpRequest): Record<string, string> {
    const originHeader = readHeaderCaseInsensitive(req.headers, 'origin');
    if (!originHeader) {
      return { Vary: 'Origin' };
    }

    const canonical = extractCanonicalOrigin(originHeader);
    if (!canonical || !this.allowedOriginSet.has(canonical)) {
      throw new HttpSecurityError(
        403,
        'CORS_ORIGIN_REJECTED',
        `Origin '${originHeader}' is not in the explicit VigorCore allowlist.`
      );
    }

    if (this.corsMode === 'platform_managed') {
      return { Vary: 'Origin' };
    }

    return {
      'Access-Control-Allow-Origin': canonical,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Vigor-CSRF, X-Vigor-Requested-With',
      'Access-Control-Expose-Headers': 'X-Vigor-CSRF-Token',
      Vary: 'Origin',
    };
  }

  /**
   * Enforces CSRF protection for state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`),
   * distinguishing pre-session Catalyst exchange vs post-session signed CSRF tokens.
   */
  assertCsrfAndOriginForRequest(
    method: string,
    req: IncomingHttpRequest,
    csrfPolicy?: RouteCsrfPolicyKind
  ): Record<string, string> {
    const corsHeaders = this.buildCorsHeaders(req);
    const upperMethod = method.toUpperCase();

    if (!STATE_CHANGING_METHODS.has(upperMethod)) {
      return corsHeaders;
    }

    // 1. Fetch Metadata verification when present (`Sec-Fetch-Site`)
    if (this.enforceFetchMetadata) {
      const secFetchSite = readHeaderCaseInsensitive(req.headers, 'sec-fetch-site')?.toLowerCase();
      if (secFetchSite === 'cross-site') {
        throw new HttpSecurityError(
          403,
          'CSRF_CROSS_SITE_REJECTED',
          `Cross-site state-changing request rejected by Fetch Metadata (Sec-Fetch-Site: ${secFetchSite}).`
        );
      }
      if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site' && secFetchSite !== 'none') {
        throw new HttpSecurityError(
          403,
          'CSRF_FETCH_METADATA_REJECTED',
          `Untrusted Sec-Fetch-Site '${secFetchSite}' on ${upperMethod} request.`
        );
      }
    }

    // 2. Explicit Origin (or Referer fallback) verification against allowlist
    const originHeader = readHeaderCaseInsensitive(req.headers, 'origin');
    const refererHeader = readHeaderCaseInsensitive(req.headers, 'referer');
    const candidateOrigin = originHeader ?? (refererHeader ? extractCanonicalOrigin(refererHeader) ?? undefined : undefined);

    if (!candidateOrigin) {
      if (this.requireOriginOnMutations) {
        throw new HttpSecurityError(
          403,
          'CSRF_ORIGIN_REQUIRED',
          `State-changing ${upperMethod} request must include an allowlisted Origin or Referer.`
        );
      }
      return corsHeaders;
    }

    if (!this.isOriginAllowed(candidateOrigin)) {
      throw new HttpSecurityError(
        403,
        'CSRF_ORIGIN_REJECTED',
        `Unauthorized mutation origin '${candidateOrigin}'.`
      );
    }

    // 3. Validate X-Vigor-CSRF & X-Vigor-Requested-With headers
    const csrfVal = readHeaderCaseInsensitive(req.headers, 'x-vigor-csrf');
    if (hasHeaderKeyCaseInsensitive(req.headers, 'x-vigor-csrf') && (!csrfVal || /[\r\n]/.test(csrfVal))) {
      throw new HttpSecurityError(
        403,
        'CSRF_TOKEN_INVALID',
        `Empty or malformed X-Vigor-CSRF header on ${upperMethod} request.`
      );
    }

    const reqWithVal = readHeaderCaseInsensitive(req.headers, 'x-vigor-requested-with');
    if (hasHeaderKeyCaseInsensitive(req.headers, 'x-vigor-requested-with') && (!reqWithVal || /[\r\n]/.test(reqWithVal))) {
      throw new HttpSecurityError(
        403,
        'CSRF_TOKEN_INVALID',
        `Empty or malformed X-Vigor-Requested-With header on ${upperMethod} request.`
      );
    }

    const isPreSessionExchange = csrfPolicy === 'pre_session_catalyst_exchange';

    if (this.enforceSignedCsrfTokens) {
      if (isPreSessionExchange) {
        // Pre-session bootstrap endpoints accept CORS-preflighted X-Vigor-Requested-With
        // without requiring a pre-existing bound session CSRF token (eliminates chicken-and-egg).
        if (!reqWithVal && !csrfVal) {
          throw new HttpSecurityError(
            403,
            'CSRF_TOKEN_MISSING',
            `Pre-session ${upperMethod} exchange requires X-Vigor-Requested-With header under strict allowlisted Origin.`
          );
        }
      } else if (!csrfVal) {
        throw new HttpSecurityError(
          403,
          'CSRF_TOKEN_MISSING',
          `State-changing ${upperMethod} request requires a valid server-issued X-Vigor-CSRF header.`
        );
      }
      return corsHeaders;
    }

    if (this.requireCsrfHeaderOnMutations && !csrfVal) {
      if (!(isPreSessionExchange && reqWithVal)) {
        throw new HttpSecurityError(
          403,
          'CSRF_TOKEN_MISSING',
          `State-changing ${upperMethod} request requires a non-empty X-Vigor-CSRF header.`
        );
      }
    }

    return corsHeaders;
  }
}

/**
 * Verifies that any emitted session `Set-Cookie` header obeys strict `__Host-vigor_session` attributes.
 */
export function assertStrictCookieAttributes(setCookieHeader: string): void {
  const parts = setCookieHeader.split(';').map(p => p.trim());
  const [nameVal, ...attrs] = parts;
  if (!nameVal || !nameVal.startsWith(`${SIGNED_SESSION_COOKIE_NAME}=`)) {
    throw new Error(`INVALID_COOKIE_NAME: Must use host-bound prefix '${SIGNED_SESSION_COOKIE_NAME}'.`);
  }

  const lowerAttrs = new Set(attrs.map(a => a.toLowerCase()));
  if (!lowerAttrs.has('httponly')) {
    throw new Error('INVALID_COOKIE_ATTR: Missing HttpOnly.');
  }
  if (!lowerAttrs.has('secure')) {
    throw new Error('INVALID_COOKIE_ATTR: Missing Secure.');
  }
  if (!lowerAttrs.has('samesite=strict')) {
    throw new Error('INVALID_COOKIE_ATTR: Missing SameSite=Strict.');
  }
  if (!lowerAttrs.has('path=/')) {
    throw new Error('INVALID_COOKIE_ATTR: Missing Path=/.');
  }
  if (attrs.some(a => a.toLowerCase().startsWith('domain='))) {
    throw new Error('INVALID_COOKIE_ATTR: __Host- cookies MUST NOT define a Domain attribute.');
  }
}

export interface BrowserCompatibilityEvaluation {
  frontendOrigin: string;
  backendOrigin: string | null;
  frontendRegistrableDomain: string;
  backendRegistrableDomain: string | null;
  relationship: 'PENDING_BACKEND_ORIGIN' | 'same-origin' | 'same-site' | 'cross-site';
  sameSiteStrictSentByBrowser: boolean | 'PENDING_LIVE_VERIFICATION';
  requiresCredentialsInclude: boolean;
  browserVerificationStatus: 'PENDING_LIVE_VERIFICATION';
  topologyAlternative: 'A_CUSTOM_DOMAIN_SAME_SITE' | 'B_MANAGED_GATEWAY_OR_PROXY' | 'C_DEDICATED_REVERSE_PROXY' | 'INCOMPATIBLE_DEFAULT_CATALYST_CROSS_SITE' | 'PENDING';
  deploymentRecommendation: string;
}

const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'com.br',
  'com.mx',
  'com.ar',
  'co.jp',
]);

export function extractRegistrableDomain(hostname: string): string {
  const clean = hostname.toLowerCase().replace(/\.$/, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Evaluates browser cookie transmission semantics for `__Host-vigor_session` (`SameSite=Strict`).
 * NEVER invents a Catalyst Advanced I/O URL; NEVER switches `SameSite=Strict` to `SameSite=None`.
 * Browser compatibility always stays `PENDING_LIVE_VERIFICATION` until tested in real Chromium/WebKit.
 */
export function evaluateBrowserCookieCompatibility(
  frontendOrigin: string,
  backendOrigin: string | null
): BrowserCompatibilityEvaluation {
  const feUrl = new URL(frontendOrigin);
  const feRegistrable = extractRegistrableDomain(feUrl.hostname);

  if (!backendOrigin) {
    return {
      frontendOrigin: feUrl.origin,
      backendOrigin: null,
      frontendRegistrableDomain: feRegistrable,
      backendRegistrableDomain: null,
      relationship: 'PENDING_BACKEND_ORIGIN',
      sameSiteStrictSentByBrowser: 'PENDING_LIVE_VERIFICATION',
      requiresCredentialsInclude: true,
      browserVerificationStatus: 'PENDING_LIVE_VERIFICATION',
      topologyAlternative: 'PENDING',
      deploymentRecommendation:
        'Pending deployed backend origin. Catalyst Advanced I/O default (`https://<project_domain>.catalystserverless.com/server/<fn>/`) is cross-site relative to `' +
        feUrl.origin +
        '` and WILL NOT transport `SameSite=Strict` cookies. Operator must select Alternative A (same-site custom domain), B (officially supported same-site gateway), or C (dedicated reverse proxy) and run INT-06/INT-07.',
    };
  }

  const beUrl = new URL(backendOrigin);
  const beRegistrable = extractRegistrableDomain(beUrl.hostname);

  if (feUrl.origin === beUrl.origin && feUrl.protocol === 'https:') {
    return {
      frontendOrigin: feUrl.origin,
      backendOrigin: beUrl.origin,
      frontendRegistrableDomain: feRegistrable,
      backendRegistrableDomain: beRegistrable,
      relationship: 'same-origin',
      sameSiteStrictSentByBrowser: true,
      requiresCredentialsInclude: false,
      browserVerificationStatus: 'PENDING_LIVE_VERIFICATION',
      topologyAlternative: 'C_DEDICATED_REVERSE_PROXY',
      deploymentRecommendation:
        'Same-origin proxy topology: optimal compatibility for `__Host-vigor_session` (`SameSite=Strict`); still requires live Chromium & Safari verification (INT-07).',
    };
  }

  const isSameSite = feRegistrable === beRegistrable && feUrl.protocol === 'https:' && beUrl.protocol === 'https:';

  if (isSameSite) {
    return {
      frontendOrigin: feUrl.origin,
      backendOrigin: beUrl.origin,
      frontendRegistrableDomain: feRegistrable,
      backendRegistrableDomain: beRegistrable,
      relationship: 'same-site',
      sameSiteStrictSentByBrowser: true,
      requiresCredentialsInclude: true,
      browserVerificationStatus: 'PENDING_LIVE_VERIFICATION',
      topologyAlternative: 'A_CUSTOM_DOMAIN_SAME_SITE',
      deploymentRecommendation:
        'Same-site custom domain topology (`' +
        feRegistrable +
        '`): requires `fetch(..., { credentials: "include" })` + exact CORS `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`. Must be verified in Chromium & Safari/WebKit (INT-06/INT-07).',
    };
  }

  return {
    frontendOrigin: feUrl.origin,
    backendOrigin: beUrl.origin,
    frontendRegistrableDomain: feRegistrable,
    backendRegistrableDomain: beRegistrable,
    relationship: 'cross-site',
    sameSiteStrictSentByBrowser: false,
    requiresCredentialsInclude: true,
    browserVerificationStatus: 'PENDING_LIVE_VERIFICATION',
    topologyAlternative: 'INCOMPATIBLE_DEFAULT_CATALYST_CROSS_SITE',
    deploymentRecommendation:
      'BLOCKED BY SAMESITE=STRICT: `' +
      feUrl.origin +
      '` (`' +
      feRegistrable +
      '`) <-> `' +
      beUrl.origin +
      '` (`' +
      beRegistrable +
      '`) is cross-site. Browsers withhold `SameSite=Strict` cookies on cross-site `fetch()`. Keep `SameSite=Strict` intact and deploy via Alternative A, B, or C.',
  };
}
