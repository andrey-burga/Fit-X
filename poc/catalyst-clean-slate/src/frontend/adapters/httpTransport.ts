/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.2 — Hardened Clean-Slate HTTP Transport Layer
 *
 * Guarantees:
 * - Requires explicit injectable `baseUrl` (NO hardcoded remote domain fallback).
 * - Validates requests are strictly scoped under `/api/v1/`.
 * - Sends `credentials: 'include'` on all requests for `__Host-vigor_session` compatibility.
 * - Fails CLOSED on mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) if `csrfProvider`
 *   is missing or returns an empty/malformed token (`403 CSRF_TOKEN_MISSING` before `fetch`).
 * - Explicitly distinguishes synthetic client errors (`origin: 'client_synthetic'`) from
 *   real server HTTP errors (`origin: 'http_server'`, `httpStatusReceived`).
 * - Supports safe idempotent retries ONLY on `GET`, `PUT`, or `idempotent: true` for
 *   transient faults (`NETWORK_ERROR`, `429`, `502`, `503`, `504`), with clean `AbortSignal`
 *   cancellation including during retry backoff.
 */

import { CleanSlateRepositoryError } from '../contracts/repositories';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ICsrfTokenProvider {
  getCsrfToken(method: HttpMethod, path: string): Promise<string | null> | string | null;
  setToken?: (token: string | null) => void;
  clear?: () => void;
}

/**
 * Memory-only CSRF token store populated exclusively from server responses
 * (`X-Vigor-CSRF-Token` / `{ csrfToken }`).
 * NEVER generates synthetic CSRF tokens on the client and NEVER writes to Storage/cookies.
 */
export class ServerCsrfTokenProvider implements ICsrfTokenProvider {
  private token: string | null = null;

  getCsrfToken(): string | null {
    return this.token;
  }

  hasToken(): boolean {
    return Boolean(this.token && this.token.trim());
  }

  setToken(token: string | null): void {
    const cleaned = typeof token === 'string' ? token.trim() : '';
    this.token = cleaned && !/[\r\n]/.test(cleaned) ? cleaned : null;
  }

  clear(): void {
    this.token = null;
  }
}

export interface HttpTransportConfig {
  /**
   * Required explicit base URL (e.g. from test server or environment configuration).
   * Never defaults to an unverified remote domain.
   */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  csrfProvider?: ICsrfTokenProvider;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface HttpRequestOptions<TBody = unknown> {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: TBody;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  idempotent?: boolean;
  maxRetries?: number;
  preSessionExchange?: boolean;
}

export interface HttpResponseEnvelope<TData> {
  status: number;
  headers: Headers;
  data: TData | null;
}

const MUTATING_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PRE_SESSION_EXCHANGE_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/session/bootstrap-profile',
  '/api/v1/auth/session/exchange',
]);
const SESSION_INVALIDATING_401_CODES: ReadonlySet<string> = new Set([
  'UNAUTHENTICATED',
  'SIGNED_SESSION_REQUIRED',
  'INVALID_SIGNED_SESSION',
  'SESSION_REVOKED_REAUTH_REQUIRED',
  'SESSION_REPLAY_DETECTED',
  'SESSION_MAX_LIFETIME_REACHED',
  'CATALYST_USER_DELETED',
]);
const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

function mapStatusToDefaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'HTTP_BAD_REQUEST';
    case 401:
      return 'HTTP_UNAUTHORIZED';
    case 403:
      return 'HTTP_FORBIDDEN';
    case 404:
      return 'HTTP_NOT_FOUND';
    case 409:
      return 'HTTP_CONFLICT';
    case 413:
      return 'HTTP_PAYLOAD_TOO_LARGE';
    case 429:
      return 'HTTP_RATE_LIMITED';
    default:
      return status >= 500 ? 'HTTP_SERVER_ERROR' : 'HTTP_REQUEST_FAILED';
  }
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new CleanSlateRepositoryError(
        'REQUEST_ABORTED',
        'La solicitud HTTP fue abortada antes del reintento.',
        408,
        { origin: 'client_synthetic' }
      )
    );
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(
        new CleanSlateRepositoryError(
          'REQUEST_ABORTED',
          'La solicitud HTTP fue abortada durante el backoff de reintento.',
          408,
          { origin: 'client_synthetic' }
        )
      );
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class CatalystHttpTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly csrfProvider?: ICsrfTokenProvider;
  private readonly timeoutMs?: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: HttpTransportConfig) {
    const trimmed = (config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
      throw new CleanSlateRepositoryError(
        'MISSING_BASE_URL',
        'Se requiere configurar baseUrl explícitamente antes de instanciar el adaptador HTTP.',
        400,
        { origin: 'client_synthetic' }
      );
    }
    this.baseUrl = trimmed;
    const resolvedFetch = config.fetchImpl ?? globalThis.fetch;
    if (typeof resolvedFetch !== 'function') {
      throw new CleanSlateRepositoryError(
        'FETCH_UNAVAILABLE',
        'No existe implementación fetch disponible en el entorno actual.',
        500,
        { origin: 'client_synthetic' }
      );
    }
    this.fetchImpl = (input: RequestInfo | URL, init?: RequestInit) =>
      resolvedFetch.call(globalThis, input, init);
    this.csrfProvider = config.csrfProvider;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = Math.max(0, Math.floor(config.maxRetries ?? 0));
    this.retryDelayMs = Math.max(0, Math.floor(config.retryDelayMs ?? 25));
    this.defaultHeaders = { ...(config.defaultHeaders ?? {}) };
  }

  getConfiguredBaseUrl(): string {
    return this.baseUrl;
  }

  private buildUrl(path: string, query?: HttpRequestOptions['query']): string {
    if (!path.startsWith('/api/v1/')) {
      throw new CleanSlateRepositoryError(
        'INVALID_CONTRACT_PATH',
        `Toda ruta del adaptador HTTP debe pertenecer a '/api/v1/*'. Recibido: '${path}'.`,
        400,
        { origin: 'client_synthetic' }
      );
    }
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== '') {
          url.searchParams.set(key, String(val));
        }
      }
    }
    return url.toString();
  }

  private isSafeToRetry<TBody>(options: HttpRequestOptions<TBody>, err: CleanSlateRepositoryError): boolean {
    if (err.code === 'REQUEST_ABORTED' || err.code === 'CSRF_TOKEN_MISSING') {
      return false;
    }
    const idempotentAllowed =
      options.method === 'GET' || options.method === 'PUT' || options.idempotent === true;
    if (!idempotentAllowed) {
      return false;
    }
    if (err.origin === 'client_synthetic') {
      return err.code === 'NETWORK_ERROR';
    }
    return typeof err.httpStatusReceived === 'number' && RETRYABLE_HTTP_STATUSES.has(err.httpStatusReceived);
  }

  async request<TResponse = Record<string, unknown>, TBody = unknown>(
    options: HttpRequestOptions<TBody>
  ): Promise<HttpResponseEnvelope<TResponse>> {
    const url = this.buildUrl(options.path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...(options.headers ?? {}),
    };

    let serializedBody: string | undefined;
    if (options.body !== undefined) {
      serializedBody = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    if (MUTATING_METHODS.has(options.method)) {
      if (options.preSessionExchange) {
        if (options.method !== 'POST' || !PRE_SESSION_EXCHANGE_PATHS.has(options.path)) {
          throw new CleanSlateRepositoryError(
            'PRE_SESSION_EXCHANGE_NOT_ALLOWED',
            `preSessionExchange solo está permitido para /api/v1/auth/session/bootstrap-profile y /exchange. Recibido: ${options.method} ${options.path}.`,
            403,
            { origin: 'client_synthetic' }
          );
        }
        headers['X-Vigor-Requested-With'] = 'VigorCore-CleanSlate';
      } else {
        if (!this.csrfProvider) {
          throw new CleanSlateRepositoryError(
            'CSRF_TOKEN_MISSING',
            `La operación mutante ${options.method} ${options.path} requiere csrfProvider y header X-Vigor-CSRF (fail-closed).`,
            403,
            { origin: 'client_synthetic' }
          );
        }
        const rawToken = await this.csrfProvider.getCsrfToken(options.method, options.path);
        const token = typeof rawToken === 'string' ? rawToken.trim() : '';
        if (!token || /[\r\n]/.test(token)) {
          throw new CleanSlateRepositoryError(
            'CSRF_TOKEN_MISSING',
            `Token CSRF ausente o inválido para ${options.method} ${options.path}.`,
            403,
            { origin: 'client_synthetic' }
          );
        }
        headers['X-Vigor-CSRF'] = token;
      }
    }

    const retryBudget = Math.max(0, Math.floor(options.maxRetries ?? this.maxRetries));

    for (let attempt = 0; attempt <= retryBudget; attempt++) {
      if (options.signal?.aborted) {
        throw new CleanSlateRepositoryError(
          'REQUEST_ABORTED',
          `La solicitud HTTP hacia ${options.path} fue abortada antes de ejecutarse.`,
          408,
          { origin: 'client_synthetic' }
        );
      }

      try {
        return await this.executeSingleAttempt<TResponse>(url, options, headers, serializedBody);
      } catch (err) {
        const repoErr =
          err instanceof CleanSlateRepositoryError
            ? err
            : new CleanSlateRepositoryError(
                'NETWORK_ERROR',
                `Fallo inesperado en ${options.path}: ${err instanceof Error ? err.message : 'Error'}`,
                503,
                { origin: 'client_synthetic' }
              );

        if (attempt < retryBudget && this.isSafeToRetry(options, repoErr)) {
          await waitWithAbort(this.retryDelayMs * (attempt + 1), options.signal);
          continue;
        }
        throw repoErr;
      }
    }

    throw new CleanSlateRepositoryError(
      'NETWORK_ERROR',
      `Se agotaron los reintentos para ${options.path}.`,
      503,
      { origin: 'client_synthetic' }
    );
  }

  private async executeSingleAttempt<TResponse>(
    url: string,
    options: HttpRequestOptions<unknown>,
    headers: Record<string, string>,
    serializedBody: string | undefined
  ): Promise<HttpResponseEnvelope<TResponse>> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutController =
      !options.signal && this.timeoutMs && this.timeoutMs > 0 ? new AbortController() : null;
    if (timeoutController && this.timeoutMs) {
      timeoutHandle = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: serializedBody,
        credentials: 'include',
        signal: options.signal ?? timeoutController?.signal,
      });
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (err instanceof CleanSlateRepositoryError) throw err;
      const errName = (err as { name?: string })?.name;
      if (errName === 'AbortError') {
        throw new CleanSlateRepositoryError(
          'REQUEST_ABORTED',
          `La solicitud HTTP hacia ${options.path} fue abortada o excedió el tiempo de espera.`,
          408,
          { origin: 'client_synthetic' }
        );
      }
      throw new CleanSlateRepositoryError(
        'NETWORK_ERROR',
        `Fallo de red al conectar con ${options.path}: ${err instanceof Error ? err.message : 'Error desconocido'}`,
        503,
        { origin: 'client_synthetic' }
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const parsedBody = await this.parseResponseBodySafely(response, options.path);

    if (!response.ok) {
      const errRecord =
        parsedBody && typeof parsedBody === 'object' ? (parsedBody as Record<string, unknown>) : {};
      const code =
        typeof errRecord.error === 'string' && errRecord.error.trim()
          ? errRecord.error
          : typeof errRecord.code === 'string' && errRecord.code.trim()
            ? errRecord.code
            : mapStatusToDefaultCode(response.status);
      const message =
        typeof errRecord.message === 'string' && errRecord.message.trim()
          ? errRecord.message
          : `Error HTTP ${response.status} en ${options.method} ${options.path}`;
      if (response.status === 401 && SESSION_INVALIDATING_401_CODES.has(code)) {
        this.csrfProvider?.clear?.();
      }
      throw new CleanSlateRepositoryError(code, message, response.status, {
        origin: 'http_server',
        httpStatusReceived: response.status,
      });
    }

    if (options.path === '/api/v1/auth/session/logout') {
      this.csrfProvider?.clear?.();
    } else if (this.csrfProvider?.setToken) {
      const headerCsrf = response.headers.get('x-vigor-csrf-token');
      const bodyCsrf =
        parsedBody && typeof parsedBody === 'object'
          ? (parsedBody as { csrfToken?: unknown }).csrfToken
          : undefined;
      const nextCsrf =
        typeof headerCsrf === 'string' && headerCsrf.trim()
          ? headerCsrf.trim()
          : typeof bodyCsrf === 'string' && bodyCsrf.trim()
            ? bodyCsrf.trim()
            : null;
      if (nextCsrf) {
        this.csrfProvider.setToken(nextCsrf);
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      data: parsedBody as TResponse | null,
    };
  }

  private async parseResponseBodySafely(response: Response, path: string): Promise<unknown | null> {
    if (response.status === 204 || response.status === 205) {
      return null;
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      return null;
    }
    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      return null;
    }
    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      if (!response.ok) {
        return { message: rawText.slice(0, 300) };
      }
      throw new CleanSlateRepositoryError(
        'INVALID_JSON_RESPONSE',
        `La respuesta HTTP ${response.status} de ${path} no contiene JSON válido.`,
        502,
        { origin: 'client_synthetic', httpStatusReceived: response.status }
      );
    }
  }
}
