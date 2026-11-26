/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Isolated Vite Browser Mount Entry
 *
 * Activates real HTTP + CatalystHostedAuthBridge mode on:
 * - `/auth/login` and `/auth/callback` auth routes
 * - `/?mode=http` Chromium E2E / operator HTTP verification
 *
 * Preserves `/` (without `?mode=http`) in Local Mock Dev mode (`InMemoryCleanSlateRepository`).
 * Zero tokens or secrets are ever written to `localStorage`, `sessionStorage`, or `IndexedDB`.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { CleanSlateApp } from '../src/frontend/CleanSlateApp';
import {
  CatalystHostedAuthBridge,
  CatalystHttpAdminRepository,
  CatalystHttpAthleteRepository,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  createBrowserCatalystWebAuthSdk,
  ServerCsrfTokenProvider,
} from '../src/frontend/adapters';
import { parseAppRoute } from '../src/frontend/routing/authRouting';

function resolveConfiguredApiBaseUrl(): string {
  const envObj = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = envObj?.VITE_VIGOR_API_BASE_URL?.trim();
  if (configured) return configured;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function buildRootElement(): React.ReactElement {
  const parsedRoute =
    typeof window !== 'undefined' ? parseAppRoute(window.location) : null;

  if (parsedRoute?.isHttpModeRequested) {
    const apiBaseUrl = resolveConfiguredApiBaseUrl();
    const csrfProvider = new ServerCsrfTokenProvider();
    const transport = new CatalystHttpTransport({
      baseUrl: apiBaseUrl,
      csrfProvider,
    });
    const authRepo = new CatalystHttpAuthRepository(transport, csrfProvider);
    const athleteRepo = new CatalystHttpAthleteRepository(transport);
    const adminRepo = new CatalystHttpAdminRepository(transport);
    const authBridge = new CatalystHostedAuthBridge({
      sdk: createBrowserCatalystWebAuthSdk(),
      authRepo,
      expectedOrigin: window.location.origin,
    });

    return (
      <CleanSlateApp
        authRepository={authRepo}
        authBridge={authBridge}
        athleteRepository={athleteRepo}
        adminRepository={adminRepo}
      />
    );
  }

  return <CleanSlateApp />;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>{buildRootElement()}</React.StrictMode>
  );
}
