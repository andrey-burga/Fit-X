/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 Express Adapter & Runtime Wiring for Zoho Catalyst Advanced I/O
 *
 * Security & Architectural Guarantees:
 * - Binds all 41 canonical `ROUTE_DEFINITIONS` via `CleanSlateApiDispatcher` (`ROUTE_CONTRACT_SPECS` parity).
 * - Normalizes Catalyst Advanced I/O mount prefixes (`/server/<functionName>/api/v1/...` -> `/api/v1/...`).
 * - Rejects path traversal (`..`, encoded `%2e%2e`, backslashes, null bytes) with `400 INVALID_REQUEST_PATH`.
 * - Enforces `HttpSecurityPolicy` (`allowedOrigins` explicit, zero `*`, `OPTIONS` preflight, Fetch Metadata, dual CSRF).
 * - Validates `__Host-vigor_session` `Set-Cookie` attributes before transmitting any session cookie.
 * - Redacts OAuth secrets, HMAC secrets, cookies, and authorization headers from HTTP errors and logs.
 * - NEVER automatically binds `app.listen()` on module import (compatible with Catalyst Advanced I/O).
 */

import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  AuthGuardError,
  CleanSlateAuthGuard,
  ServerSessionTokenManager,
  type ICatalystAuthRuntime,
  type IncomingHttpRequest,
} from '../auth/cleanSlateAuthGuard.js';
import type { ICleanSlateNoSQLAdapter } from '../nosql/cleanSlateEngine.js';
import { createTableProviders, type CatalystTableProvidersRegistry } from '../nosql/providers/index.js';
import {
  CleanSlateApiDispatcher,
  ROUTE_DEFINITIONS,
  type ApiEndpointDefinition,
} from '../routes/apiRouterSchema.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  HostedNativeCatalystAuthRuntime,
  redactSecretsFromString,
  type CatalystRuntimeAuthMode,
} from '../sdk/catalystSdkBridge.js';
import {
  assertStrictCookieAttributes,
  DEFAULT_ALLOWED_ORIGINS,
  HttpSecurityError,
  HttpSecurityPolicy,
  type CorsHandlingMode,
} from '../security/httpSecurityPolicy.js';
import { AdminGovernanceService } from '../services/adminGovernanceService.js';
import { AthleteDataService } from '../services/athleteDataService.js';

export class InvalidRequestPathError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INVALID_REQUEST_PATH';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestPathError';
  }
}

/**
 * Strips Catalyst Advanced I/O `/server/<fnName>` prefix if present and rejects traversal attempts.
 */
export function normalizeCatalystPath(rawPath: string): string {
  const pathOnly = (rawPath || '/').split('?')[0] || '/';
  if (pathOnly.includes('\0') || pathOnly.includes('\\')) {
    throw new InvalidRequestPathError('Request path contains prohibited characters.');
  }

  let decodedForCheck: string;
  try {
    decodedForCheck = decodeURIComponent(pathOnly);
  } catch {
    throw new InvalidRequestPathError('Request path contains malformed percent-encoding.');
  }

  if (decodedForCheck.includes('\0') || decodedForCheck.includes('\\')) {
    throw new InvalidRequestPathError('Decoded request path contains prohibited characters.');
  }

  const rawSegments = pathOnly.split('/').filter(Boolean);
  const decodedSegments = decodedForCheck.split('/').filter(Boolean);
  if (
    rawSegments.some(s => s === '.' || s === '..') ||
    decodedSegments.some(s => s === '.' || s === '..')
  ) {
    throw new InvalidRequestPathError('Path traversal segments are strictly prohibited.');
  }

  // Strip Catalyst Advanced I/O prefix `/server/<functionName>` -> `/...`
  if (decodedSegments[0] === 'server' && decodedSegments.length >= 2) {
    const fnName = decodedSegments[1];
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(fnName)) {
      throw new InvalidRequestPathError('Invalid Catalyst Advanced I/O function prefix.');
    }
    const rest = rawSegments.slice(2);
    return rest.length > 0 ? `/${rest.join('/')}` : '/';
  }

  return rawSegments.length > 0 ? `/${rawSegments.join('/')}` : '/';
}

export function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawCookieHeader) return out;
  for (const part of rawCookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name && val) {
      out[name] = val;
    }
  }
  return out;
}

function normalizeIncomingHeaders(
  headers: Request['headers']
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') {
      out[k.toLowerCase()] = v;
    } else if (Array.isArray(v) && v.length > 0) {
      out[k.toLowerCase()] = v.join(', ');
    }
  }
  return out;
}

export interface RedactedRequestLogEntry {
  method: string;
  normalizedPath: string;
  status: number;
  durationMs: number;
  errorCode?: string;
}

export interface VigorCoreExpressAppDependencies {
  dispatcher: CleanSlateApiDispatcher;
  httpPolicy?: HttpSecurityPolicy;
  wrapDispatch?: (
    headers: Record<string, string | undefined>,
    fn: () => Promise<void>
  ) => Promise<void>;
  redactMessage?: (msg: string) => string;
  logger?: (entry: RedactedRequestLogEntry) => void;
  jsonBodyLimit?: string;
  serviceName?: string;
}

const SUPPORTED_DISPATCH_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

export function createVigorCoreExpressApp(
  deps: VigorCoreExpressAppDependencies
): Application {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const redact = deps.redactMessage ?? ((msg: string) => redactSecretsFromString(msg));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.use(express.json({ limit: deps.jsonBodyLimit ?? '1mb' }));

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!err) {
      next();
      return;
    }
    const errObj = err as { type?: string; status?: number; message?: string };
    if (errObj.type === 'entity.too.large' || errObj.status === 413) {
      res.status(413).json({
        success: false,
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request JSON body exceeds maximum permitted size.',
      });
      return;
    }
    if (err instanceof SyntaxError || errObj.type === 'entity.parse.failed' || errObj.status === 400) {
      res.status(400).json({
        success: false,
        error: 'INVALID_JSON_BODY',
        message: 'Malformed JSON request body.',
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: redact(errObj.message || 'Internal request parsing failure.'),
    });
  });

  app.use(async (req: Request, res: Response) => {
    const startMs = Date.now();
    let normalizedPath = req.path || '/';
    try {
      normalizedPath = normalizeCatalystPath(req.originalUrl || req.url || req.path || '/');
    } catch (err) {
      if (err instanceof InvalidRequestPathError) {
        deps.logger?.({
          method: req.method,
          normalizedPath: '[INVALID_PATH]',
          status: 400,
          durationMs: Date.now() - startMs,
          errorCode: err.code,
        });
        res.status(400).json({
          success: false,
          error: err.code,
          message: err.message,
        });
        return;
      }
      throw err;
    }

    // Minimal health probe strictly reporting non-sensitive metadata (no secrets/env)
    if (
      req.method === 'GET' &&
      (normalizedPath === '/health' || normalizedPath === '/api/v1/health')
    ) {
      res.status(200).json({
        success: true,
        service: deps.serviceName ?? 'vigorcore-advanced-io',
        routeCount: ROUTE_DEFINITIONS.length,
        status: 'ok',
      });
      return;
    }

    const upperMethod = req.method.toUpperCase();
    if (!SUPPORTED_DISPATCH_METHODS.has(upperMethod)) {
      res.status(405).json({
        success: false,
        error: 'METHOD_NOT_ALLOWED',
        message: `HTTP method '${upperMethod}' is not supported.`,
      });
      return;
    }

    const headers = normalizeIncomingHeaders(req.headers);
    const cookies = parseCookieHeader(headers.cookie);

    const incomingReq: IncomingHttpRequest = {
      headers,
      cookies,
      query: req.query as Record<string, unknown>,
      body: req.body,
    };

    const executeDispatch = async () => {
      const result = await deps.dispatcher.dispatch(
        upperMethod as ApiEndpointDefinition['method'] | 'OPTIONS',
        normalizedPath,
        incomingReq
      );

      if (result.headers) {
        for (const [hdrName, hdrVal] of Object.entries(result.headers)) {
          if (hdrName.toLowerCase() === 'set-cookie') {
            assertStrictCookieAttributes(hdrVal);
          }
          res.setHeader(hdrName, hdrVal);
        }
      }

      const safeBody: Record<string, unknown> =
        result.body && typeof result.body === 'object'
          ? {
              ...result.body,
              ...(typeof result.body.message === 'string'
                ? { message: redact(result.body.message) }
                : {}),
            }
          : result.body;

      deps.logger?.({
        method: upperMethod,
        normalizedPath,
        status: result.status,
        durationMs: Date.now() - startMs,
        ...(typeof safeBody.error === 'string' ? { errorCode: safeBody.error } : {}),
      });

      if (result.status === 204) {
        res.status(204).end();
        return;
      }
      res.status(result.status).json(safeBody);
    };

    try {
      if (deps.wrapDispatch && upperMethod !== 'OPTIONS') {
        await deps.wrapDispatch(headers, executeDispatch);
      } else {
        await executeDispatch();
      }
    } catch (err) {
      let corsHeaders: Record<string, string> = {};
      if (deps.httpPolicy && headers.origin) {
        try {
          corsHeaders = deps.httpPolicy.buildCorsHeaders(incomingReq);
        } catch {
          corsHeaders = {};
        }
      }
      for (const [hdrName, hdrVal] of Object.entries(corsHeaders)) {
        res.setHeader(hdrName, hdrVal);
      }

      if (err instanceof AuthGuardError || err instanceof HttpSecurityError) {
        const safeMsg = redact(err.message);
        deps.logger?.({
          method: upperMethod,
          normalizedPath,
          status: err.statusCode,
          durationMs: Date.now() - startMs,
          errorCode: err.code,
        });
        res.status(err.statusCode).json({
          success: false,
          error: err.code,
          message: safeMsg,
        });
        return;
      }

      const safeMsg = redact(err instanceof Error ? err.message : 'Internal server error.');
      deps.logger?.({
        method: upperMethod,
        normalizedPath,
        status: 500,
        durationMs: Date.now() - startMs,
        errorCode: 'INTERNAL_ERROR',
      });
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: safeMsg,
      });
    }
  });

  return app;
}

export function parseAllowedOriginsEnv(
  rawOrigins: string | undefined,
  allowLoopbackOrigins = false
): string[] {
  const sourceList =
    rawOrigins && rawOrigins.trim()
      ? rawOrigins
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [...DEFAULT_ALLOWED_ORIGINS];

  if (sourceList.includes('*')) {
    throw new Error('INVALID_CORS_CONFIG: Wildcard `*` is strictly prohibited.');
  }

  for (const origin of sourceList) {
    const parsed = new URL(origin);
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !(allowLoopbackOrigins && isLoopback)) {
      throw new Error(`INSECURE_CORS_ORIGIN: Allowed origin '${origin}' must use HTTPS.`);
    }
  }
  return sourceList;
}

export function resolveCatalystRuntimeAuthMode(
  rawMode: string | undefined
): CatalystRuntimeAuthMode {
  const trimmed = (rawMode || '').trim();
  if (!trimmed || trimmed === 'external_oauth') {
    return 'external_oauth';
  }
  if (trimmed === 'hosted_native') {
    return 'hosted_native';
  }
  throw new Error(
    `INVALID_CATALYST_AUTH_MODE: Expected 'external_oauth' or 'hosted_native', got '${trimmed}'.`
  );
}

export function resolveCorsHandlingMode(
  rawMode: string | undefined
): CorsHandlingMode {
  const trimmed = (rawMode || '').trim();
  if (!trimmed || trimmed === 'express_enforced') {
    return 'express_enforced';
  }
  if (trimmed === 'platform_managed') {
    return 'platform_managed';
  }
  throw new Error(
    `INVALID_CORS_MODE: Expected 'express_enforced' or 'platform_managed', got '${trimmed}'.`
  );
}

export interface VigorCoreRuntimeBundle {
  app: Application;
  catalystAuthMode: CatalystRuntimeAuthMode;
  corsMode: CorsHandlingMode;
  adminProvider?: CatalystAdminAppProvider;
  hostedRuntime?: HostedNativeCatalystAuthRuntime;
  providers: CatalystTableProvidersRegistry;
  authRuntime: ICatalystAuthRuntime;
  sessionTokens: ServerSessionTokenManager;
  authGuard: CleanSlateAuthGuard;
  athleteService: AthleteDataService;
  adminService: AdminGovernanceService;
  httpPolicy: HttpSecurityPolicy;
  dispatcher: CleanSlateApiDispatcher;
}

export function createVigorCoreProductionRuntimeFromEnv(
  envMap: Record<string, string | undefined> = process.env,
  overrides: {
    allowInsecureLoopbackForTest?: boolean;
    catalystAuthMode?: CatalystRuntimeAuthMode;
    corsMode?: CorsHandlingMode;
    adapterOverride?: ICleanSlateNoSQLAdapter;
    authRuntimeOverride?: ICatalystAuthRuntime;
    hostedAuthRuntimeOverride?: HostedNativeCatalystAuthRuntime;
    nowMsProvider?: () => number;
    nowSecProvider?: () => number;
    logger?: (entry: RedactedRequestLogEntry) => void;
    liveAtomicityVerifiedForSuperadminMutations?: boolean;
  } = {}
): VigorCoreRuntimeBundle {
  const allowLoopback = Boolean(overrides.allowInsecureLoopbackForTest);
  const catalystAuthMode =
    overrides.catalystAuthMode ?? resolveCatalystRuntimeAuthMode(envMap.VIGOR_CATALYST_AUTH_MODE);
  const corsMode = overrides.corsMode ?? resolveCorsHandlingMode(envMap.VIGOR_CORS_MODE);

  let adminProvider: CatalystAdminAppProvider | undefined;
  let hostedRuntime: HostedNativeCatalystAuthRuntime | undefined;
  let providers: CatalystTableProvidersRegistry;
  let authRuntime: ICatalystAuthRuntime;

  if (catalystAuthMode === 'hosted_native') {
    hostedRuntime =
      overrides.hostedAuthRuntimeOverride ??
      HostedNativeCatalystAuthRuntime.fromEnvironment(envMap, {
        allowInsecureLoopbackForTest: allowLoopback,
      });
    providers = overrides.adapterOverride
      ? createTableProviders(overrides.adapterOverride)
      : createTableProviders(() => hostedRuntime!.getActiveRequestNoSQLClient());
    authRuntime = overrides.authRuntimeOverride ?? hostedRuntime;
  } else {
    adminProvider = CatalystAdminAppProvider.fromEnvironment(envMap, {
      allowInsecureLoopbackForTest: allowLoopback,
    });
    providers = overrides.adapterOverride
      ? createTableProviders(overrides.adapterOverride)
      : createTableProviders(adminProvider.createNoSQLClient());
    authRuntime =
      overrides.authRuntimeOverride ??
      new CatalystSeparatedAuthRuntime({
        adminProvider,
        requireLiveInt08ForPasswordReset:
          envMap.VIGOR_ALLOW_RESET_WITHOUT_INT08 !== 'true',
      });
  }

  const baseSessionTokens = ServerSessionTokenManager.fromEnvironment(envMap);
  const sessionTokens = overrides.nowSecProvider
    ? new ServerSessionTokenManager({
        activeSecret: envMap.VIGOR_SESSION_HMAC_SECRET || '',
        activeKeyId: envMap.VIGOR_SESSION_ACTIVE_KID || 'k1',
        environment: baseSessionTokens.getEnvironment(),
        nowSecProvider: overrides.nowSecProvider,
      })
    : baseSessionTokens;

  const authGuard = new CleanSlateAuthGuard(
    authRuntime,
    providers.adapter,
    sessionTokens
  );

  const athleteService = new AthleteDataService(providers.adapter);
  const adminService = new AdminGovernanceService(
    providers.adapter,
    authRuntime,
    overrides.nowMsProvider ?? (() => Date.now()),
    {
      liveAtomicityVerifiedForSuperadminMutations:
        overrides.liveAtomicityVerifiedForSuperadminMutations ?? false,
    }
  );

  const allowedOrigins = parseAllowedOriginsEnv(
    envMap.VIGOR_ALLOWED_ORIGINS,
    allowLoopback
  );

  const httpPolicy = new HttpSecurityPolicy({
    allowedOrigins,
    corsMode,
    requireOriginOnMutations: true,
    enforceFetchMetadata: true,
    requireCsrfHeaderOnMutations: true,
    enforceSignedCsrfTokens: true,
  });

  const dispatcher = new CleanSlateApiDispatcher(
    authGuard,
    athleteService,
    adminService,
    httpPolicy
  );

  const extraHmacSecrets: string[] = [];
  if (envMap.VIGOR_SESSION_HMAC_SECRET) {
    extraHmacSecrets.push(envMap.VIGOR_SESSION_HMAC_SECRET);
  }
  if (envMap.VIGOR_SESSION_PREVIOUS_SECRETS_JSON) {
    try {
      const parsedPrev = JSON.parse(envMap.VIGOR_SESSION_PREVIOUS_SECRETS_JSON);
      if (Array.isArray(parsedPrev)) {
        for (const item of parsedPrev) {
          if (item && typeof item.secret === 'string') {
            extraHmacSecrets.push(item.secret);
          }
        }
      }
    } catch {
      // ignore invalid JSON here; ServerSessionTokenManager validates it
    }
  }

  const app = createVigorCoreExpressApp({
    dispatcher,
    httpPolicy,
    wrapDispatch:
      catalystAuthMode === 'hosted_native' && hostedRuntime
        ? (hdrs, fn) => hostedRuntime!.runWithRequestContext(hdrs, fn)
        : undefined,
    redactMessage: msg => {
      const baseRedacted = adminProvider
        ? adminProvider.redactErrorMessage(msg)
        : hostedRuntime
          ? hostedRuntime.redactErrorMessage(msg)
          : msg;
      return redactSecretsFromString(baseRedacted, extraHmacSecrets);
    },
    logger: overrides.logger,
    serviceName: envMap.CATALYST_FUNCTION_NAME || 'vigorcore-advanced-io',
  });

  return {
    app,
    catalystAuthMode,
    corsMode,
    ...(adminProvider ? { adminProvider } : {}),
    ...(hostedRuntime ? { hostedRuntime } : {}),
    providers,
    authRuntime,
    sessionTokens,
    authGuard,
    athleteService,
    adminService,
    httpPolicy,
    dispatcher,
  };
}
