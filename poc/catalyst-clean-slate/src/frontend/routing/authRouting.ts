/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Minimal URL Pathname Router for `/auth/login` and `/auth/callback`
 *
 * Uses standard Web History API (`window.location.pathname` + `pushState`/`popstate`) with
 * zero additional routing dependencies. Enforces same-origin redirect validation and explicitly
 * discards untrusted identity/role/session query parameters.
 */

import { resolveSafeSameOriginRedirect } from '../adapters/CatalystHostedAuthBridge';

export type AppRouteId = 'workspace' | 'auth-login' | 'auth-callback';

export interface ParsedAppRoute {
  routeId: AppRouteId;
  pathname: string;
  search: string;
  isHttpModeRequested: boolean;
  safeNextPath: string;
  rejectedUnsafeRedirect: boolean;
  cancelled: boolean;
  loggedOut: boolean;
  catalystErrorCode: string | null;
  catalystErrorMessage: string | null;
  ignoredUntrustedParams: string[];
}

export const ROUTE_CHANGE_EVENT = 'vigorcore:routechange';

const UNTRUSTED_IDENTITY_QUERY_KEYS: ReadonlySet<string> = new Set([
  'uid',
  'user_id',
  'userid',
  'role',
  'userrole',
  'roleversion',
  'sessionepoch',
  'ep',
  'sid',
  'accountstatus',
  'isconfirmed',
  'emailverified',
  'token',
  'access_token',
  'id_token',
  'csrf',
  'csrftoken',
]);

function normalizePathname(rawPathname: string): string {
  const trimmed = (rawPathname || '/').trim() || '/';
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.replace(/\/+$/, '') || '/';
  }
  return trimmed;
}

export function resolveRouteIdFromPathname(rawPathname: string): AppRouteId {
  const pathname = normalizePathname(rawPathname);
  if (pathname === '/auth/login') return 'auth-login';
  if (pathname === '/auth/callback') return 'auth-callback';
  return 'workspace';
}

export function parseAppRoute(locationLike?: {
  pathname?: string;
  search?: string;
  origin?: string;
}): ParsedAppRoute {
  const loc =
    locationLike ??
    (typeof window !== 'undefined'
      ? window.location
      : { pathname: '/', search: '', origin: 'http://localhost' });

  const pathname = normalizePathname(loc.pathname ?? '/');
  const search = typeof loc.search === 'string' ? loc.search : '';
  const origin =
    typeof loc.origin === 'string' && loc.origin.trim() ? loc.origin : 'http://localhost';
  const params = new URLSearchParams(search);
  const routeId = resolveRouteIdFromPathname(pathname);

  const ignoredUntrustedParams: string[] = [];
  for (const key of Array.from(params.keys())) {
    if (UNTRUSTED_IDENTITY_QUERY_KEYS.has(key.toLowerCase())) {
      ignoredUntrustedParams.push(key);
    }
  }

  let safeNextPath = '/';
  let rejectedUnsafeRedirect = false;
  const rawNext = params.get('next');
  if (rawNext !== null && rawNext.trim() !== '') {
    try {
      const candidate = resolveSafeSameOriginRedirect(rawNext, origin, '/');
      const candidateUrl = new URL(candidate, origin);
      if (candidateUrl.pathname === '/auth/login' || candidateUrl.pathname === '/auth/callback') {
        safeNextPath = '/';
      } else {
        safeNextPath = candidate;
      }
    } catch {
      rejectedUnsafeRedirect = true;
      safeNextPath = '/';
    }
  }

  const rawRedirect = params.get('redirect');
  if (rawRedirect !== null && rawRedirect.trim() !== '') {
    try {
      resolveSafeSameOriginRedirect(rawRedirect, origin, '/');
    } catch {
      rejectedUnsafeRedirect = true;
    }
  }

  const rawError = params.get('error')?.trim() || '';
  const rawErrorDesc = params.get('error_description')?.trim() || '';
  const cancelled =
    params.get('cancelled') === '1' ||
    rawError.toLowerCase() === 'access_denied' ||
    rawError.toLowerCase() === 'user_cancelled' ||
    rawError.toLowerCase() === 'cancelled';

  const loggedOut = params.get('loggedOut') === '1';
  const explicitHttpParam = params.get('mode') === 'http';
  const isHttpModeRequested =
    explicitHttpParam || routeId === 'auth-login' || routeId === 'auth-callback';

  return {
    routeId,
    pathname,
    search,
    isHttpModeRequested,
    safeNextPath,
    rejectedUnsafeRedirect,
    cancelled,
    loggedOut,
    catalystErrorCode: rawError ? rawError.slice(0, 80) : null,
    catalystErrorMessage: rawErrorDesc ? rawErrorDesc.slice(0, 240) : null,
    ignoredUntrustedParams,
  };
}

export function buildPathWithPreservedMode(
  targetPathname: string,
  currentSearch = '',
  extraQuery: Record<string, string | undefined> = {}
): string {
  const cleanTarget = targetPathname.startsWith('/') ? targetPathname : `/${targetPathname}`;
  const [basePath, rawTargetQuery] = cleanTarget.split('?');
  const targetParams = new URLSearchParams(rawTargetQuery ?? '');
  const currentParams = new URLSearchParams(currentSearch);

  if (currentParams.get('mode') === 'http' && !targetParams.has('mode')) {
    targetParams.set('mode', 'http');
  }
  for (const [k, v] of Object.entries(extraQuery)) {
    if (typeof v === 'string' && v.trim() !== '') {
      targetParams.set(k, v.trim());
    }
  }
  const qs = targetParams.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function navigateBrowserPath(
  targetPath: string,
  options: { replace?: boolean } = {}
): void {
  if (typeof window === 'undefined' || typeof window.history === 'undefined') {
    return;
  }
  if (options.replace) {
    window.history.replaceState({}, '', targetPath);
  } else {
    window.history.pushState({}, '', targetPath);
  }
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}
