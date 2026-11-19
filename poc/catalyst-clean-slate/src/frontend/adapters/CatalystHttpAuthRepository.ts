/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — Clean-Slate HTTP Auth & Session Lifecycle Adapter
 *
 * Implements the Modelo B Refinado client boundary:
 * - Pre-session exchange (`/bootstrap-profile`, `/exchange`) uses `preSessionExchange: true`
 *   (`X-Vigor-Requested-With` CORS preflight under strict allowlisted Origin + `credentials: 'include'`)
 *   and captures the server-issued HMAC-bound `csrfToken` into memory (`ServerCsrfTokenProvider`).
 * - Post-session mutations (`/refresh`, `/logout`, `/revoke`) automatically send the server-issued
 *   `X-Vigor-CSRF` bound to `(sid, sub, ep)` and rotate/clear it in memory only.
 */

import { CleanSlateRepositoryError } from '../contracts/repositories';
import {
  CatalystHttpTransport,
  type HttpTransportConfig,
  type ServerCsrfTokenProvider,
} from './httpTransport';

export interface HttpAuthSessionResult {
  actor: Record<string, unknown>;
  sid: string;
  expiresAt?: string;
  expiresAtEpochSec: number;
  absoluteExpiresAtEpochSec: number;
  csrfToken: string;
}

export interface HttpAuthMeResult {
  actor: Record<string, unknown>;
  csrfToken?: string;
}

export class CatalystHttpAuthRepository {
  private readonly transport: CatalystHttpTransport;
  private readonly csrfStore?: ServerCsrfTokenProvider;

  constructor(
    configOrTransport: HttpTransportConfig | CatalystHttpTransport,
    csrfStore?: ServerCsrfTokenProvider
  ) {
    this.transport =
      configOrTransport instanceof CatalystHttpTransport
        ? configOrTransport
        : new CatalystHttpTransport(configOrTransport);
    this.csrfStore = csrfStore;
  }

  private captureCsrf(headers: Headers, data: { csrfToken?: unknown } | null): string {
    const fromHeader = headers.get('x-vigor-csrf-token')?.trim();
    const fromBody = typeof data?.csrfToken === 'string' ? data.csrfToken.trim() : '';
    const token = fromHeader || fromBody;
    if (!token) {
      throw new CleanSlateRepositoryError(
        'MISSING_SERVER_CSRF_TOKEN',
        'El servidor no emitió un token CSRF válido al establecer la sesión.',
        502,
        { origin: 'client_synthetic' }
      );
    }
    this.csrfStore?.setToken(token);
    return token;
  }

  async bootstrapProfile(displayName?: string): Promise<HttpAuthSessionResult> {
    const res = await this.transport.request<{
      actor?: Record<string, unknown>;
      sid?: string;
      expiresAt?: string;
      expiresAtEpochSec?: number;
      absoluteExpiresAtEpochSec?: number;
      csrfToken?: string;
    }>({
      method: 'POST',
      path: '/api/v1/auth/session/bootstrap-profile',
      preSessionExchange: true,
      body: displayName ? { displayName } : {},
    });

    if (!res.data?.actor || !res.data.sid) {
      throw new CleanSlateRepositoryError(
        'INVALID_SESSION_RESPONSE',
        'POST /api/v1/auth/session/bootstrap-profile no devolvió actor ni sid.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    const csrfToken = this.captureCsrf(res.headers, res.data);
    return {
      actor: res.data.actor,
      sid: res.data.sid,
      expiresAt: res.data.expiresAt,
      expiresAtEpochSec: Number(res.data.expiresAtEpochSec ?? 0),
      absoluteExpiresAtEpochSec: Number(res.data.absoluteExpiresAtEpochSec ?? 0),
      csrfToken,
    };
  }

  async exchangeSession(): Promise<HttpAuthSessionResult> {
    const res = await this.transport.request<{
      actor?: Record<string, unknown>;
      sid?: string;
      expiresAt?: string;
      expiresAtEpochSec?: number;
      absoluteExpiresAtEpochSec?: number;
      csrfToken?: string;
    }>({
      method: 'POST',
      path: '/api/v1/auth/session/exchange',
      preSessionExchange: true,
      body: {},
    });

    if (!res.data?.actor || !res.data.sid) {
      throw new CleanSlateRepositoryError(
        'INVALID_SESSION_RESPONSE',
        'POST /api/v1/auth/session/exchange no devolvió actor ni sid.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    const csrfToken = this.captureCsrf(res.headers, res.data);
    return {
      actor: res.data.actor,
      sid: res.data.sid,
      expiresAt: res.data.expiresAt,
      expiresAtEpochSec: Number(res.data.expiresAtEpochSec ?? 0),
      absoluteExpiresAtEpochSec: Number(res.data.absoluteExpiresAtEpochSec ?? 0),
      csrfToken,
    };
  }

  async refreshSession(): Promise<HttpAuthSessionResult> {
    const res = await this.transport.request<{
      actor?: Record<string, unknown>;
      sid?: string;
      expiresAt?: string;
      expiresAtEpochSec?: number;
      absoluteExpiresAtEpochSec?: number;
      csrfToken?: string;
    }>({
      method: 'POST',
      path: '/api/v1/auth/session/refresh',
      body: {},
    });

    if (!res.data?.actor || !res.data.sid) {
      throw new CleanSlateRepositoryError(
        'INVALID_SESSION_RESPONSE',
        'POST /api/v1/auth/session/refresh no devolvió sesión rotada.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    const csrfToken = this.captureCsrf(res.headers, res.data);
    return {
      actor: res.data.actor,
      sid: res.data.sid,
      expiresAt: res.data.expiresAt,
      expiresAtEpochSec: Number(res.data.expiresAtEpochSec ?? 0),
      absoluteExpiresAtEpochSec: Number(res.data.absoluteExpiresAtEpochSec ?? 0),
      csrfToken,
    };
  }

  async getMe(): Promise<HttpAuthMeResult> {
    const res = await this.transport.request<{
      actor?: Record<string, unknown>;
      csrfToken?: string;
    }>({
      method: 'GET',
      path: '/api/v1/auth/me',
    });

    if (!res.data?.actor) {
      throw new CleanSlateRepositoryError(
        'INVALID_AUTH_ME_RESPONSE',
        'GET /api/v1/auth/me no devolvió actor.',
        502,
        { origin: 'client_synthetic' }
      );
    }

    const headerToken = res.headers.get('x-vigor-csrf-token')?.trim();
    const bodyToken = typeof res.data.csrfToken === 'string' ? res.data.csrfToken.trim() : '';
    const csrfToken = headerToken || bodyToken || undefined;
    if (csrfToken) {
      this.csrfStore?.setToken(csrfToken);
    }
    return {
      actor: res.data.actor,
      csrfToken,
    };
  }

  async logout(): Promise<{ loggedOut: boolean; revokedSid: string }> {
    const res = await this.transport.request<{
      loggedOut?: boolean;
      revokedSid?: string;
    }>({
      method: 'POST',
      path: '/api/v1/auth/session/logout',
      body: {},
    });
    this.csrfStore?.clear();
    return {
      loggedOut: Boolean(res.data?.loggedOut),
      revokedSid: String(res.data?.revokedSid ?? ''),
    };
  }

  async revokeSession(input: {
    scope?: 'individual' | 'all';
    sid?: string;
    targetUid?: string;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    const res = await this.transport.request<Record<string, unknown>>({
      method: 'POST',
      path: '/api/v1/auth/session/revoke',
      body: input,
    });
    if (input.scope === 'all' && !input.targetUid) {
      this.csrfStore?.clear();
    }
    return (res.data ?? {}) as Record<string, unknown>;
  }
}
