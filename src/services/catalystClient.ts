/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Catalyst HTTP Client & Auth Bridge Singleton
 * Connects the main frontend (`src/`) directly to the verified Phase 5.7 / 5.8
 * Zoho Catalyst HTTP adapters in `poc/catalyst-clean-slate/src/frontend/`.
 */

export * from '../../poc/catalyst-clean-slate/src/frontend/adapters/index.ts';
export * from '../../poc/catalyst-clean-slate/src/frontend/contracts/repositories.ts';
export * from '../../poc/catalyst-clean-slate/src/frontend/routing/authRouting.ts';

import {
  CatalystHostedAuthBridge,
  CatalystHttpAdminRepository,
  CatalystHttpAthleteRepository,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  ServerCsrfTokenProvider,
  createBrowserCatalystWebAuthSdk,
} from '../../poc/catalyst-clean-slate/src/frontend/adapters/index.ts';

export const DEFAULT_REMOTE_VIGOR_API_URL =
  'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api/api/v1';

/**
 * Resolves the Catalyst API base origin (without trailing `/api/v1`) required by
 * `CatalystHttpTransport` (all transport paths begin with `/api/v1/*`).
 * - Uses `VITE_VIGOR_API_BASE_URL` when explicitly defined.
 * - Keeps `/api/v1` when running on `localhost` so Vite's same-origin proxy handles dev traffic.
 * - Defaults to the live Catalyst Development API Gateway URL on deployed/remote origins (e.g. `app.vigorcore.lat`).
 */
export function resolveCatalystApiBaseUrl(): string {
  const isLocalhost =
    typeof window !== 'undefined' && window.location?.hostname === 'localhost';
  const configuredEnv = (import.meta.env.VITE_VIGOR_API_BASE_URL || '').trim();
  const configured =
    configuredEnv || (isLocalhost ? '/api/v1' : DEFAULT_REMOTE_VIGOR_API_URL);
  const stripped = configured.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');

  if (stripped && /^https?:\/\//i.test(stripped)) {
    return stripped;
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:3000';

  if (!stripped || stripped === '/') {
    return origin;
  }

  return new URL(stripped, origin).toString().replace(/\/+$/, '');
}

const resolvedBaseUrl = resolveCatalystApiBaseUrl();
const expectedOrigin =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:3000';

export const csrfProvider = new ServerCsrfTokenProvider();

export const httpTransport = new CatalystHttpTransport({
  baseUrl: resolvedBaseUrl,
  csrfProvider,
});

export const authRepo = new CatalystHttpAuthRepository(httpTransport, csrfProvider);
export const athleteRepo = new CatalystHttpAthleteRepository(httpTransport);
export const adminRepo = new CatalystHttpAdminRepository(httpTransport);

export const authBridge = new CatalystHostedAuthBridge({
  sdk: createBrowserCatalystWebAuthSdk(),
  authRepo,
  expectedOrigin,
});

export const catalystClient = {
  baseUrl: resolvedBaseUrl,
  csrfProvider,
  httpTransport,
  authRepo,
  athleteRepo,
  adminRepo,
  authBridge,
} as const;

export async function checkBackendHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const startedAt = now();

  const probeJsonHealth = async (path: '/health' | '/api/v1/health'): Promise<boolean> => {
    try {
      const response = await fetch(`${resolvedBaseUrl}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        return false;
      }
      const data = (await response.json()) as { status?: string; success?: boolean } | null;
      return Boolean(data && (data.status === 'ok' || data.success === true));
    } catch {
      return false;
    }
  };

  if (await probeJsonHealth('/health')) {
    return { ok: true, latencyMs: Math.max(1, Math.round(now() - startedAt)) };
  }

  if (await probeJsonHealth('/api/v1/health')) {
    return { ok: true, latencyMs: Math.max(1, Math.round(now() - startedAt)) };
  }

  try {
    await authRepo.getMe();
    return { ok: true, latencyMs: Math.max(1, Math.round(now() - startedAt)) };
  } catch (err) {
    const serverResponded =
      typeof err === 'object' &&
      err !== null &&
      'origin' in err &&
      (err as { origin?: string }).origin === 'http_server';
    return {
      ok: serverResponded,
      latencyMs: Math.max(1, Math.round(now() - startedAt)),
    };
  }
}
