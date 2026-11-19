/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — Isolated Vite Browser Mount Entry
 * Supports `?mode=http` for Chromium E2E verification against local Express dispatcher
 * using HttpOnly cookies and server-issued memory-only CSRF tokens.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { CleanSlateApp } from '../src/frontend/CleanSlateApp';
import {
  CatalystHttpAdminRepository,
  CatalystHttpAthleteRepository,
  CatalystHttpAuthRepository,
  CatalystHttpTransport,
  ServerCsrfTokenProvider,
} from '../src/frontend/adapters';

function buildRootElement(): React.ReactElement {
  const isHttpMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mode') === 'http';

  if (isHttpMode) {
    const csrfProvider = new ServerCsrfTokenProvider();
    const transport = new CatalystHttpTransport({
      baseUrl: window.location.origin,
      csrfProvider,
    });
    const authRepo = new CatalystHttpAuthRepository(transport, csrfProvider);
    const athleteRepo = new CatalystHttpAthleteRepository(transport);
    const adminRepo = new CatalystHttpAdminRepository(transport);
    return (
      <CleanSlateApp
        authRepository={authRepo}
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
