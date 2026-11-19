/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — React UI SSR Rendering, HTTP Adapter UI State & Static Safety Tests
 *
 * SCOPE CLASSIFICATION:
 * - Renders React UI trees via `react-dom/server` (`renderToStaticMarkup`) for deterministic SSR snapshot verification.
 *   (Interactive real Chromium browser E2E runs in `tests/14-browser-e2e.test.ts`.)
 * - Verifies SSR markup, state transitions (`loading` / `error` / `empty` / `ready`), RBAC visibility,
 *   reconciled 41-endpoint contract table, local simulated catalog wording, and non-fallback UI when
 *   an HTTP adapter is injected instead of `InMemoryCleanSlateRepository`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CLEAN_SLATE_UI_ENDPOINT_MAP,
  type ViewId,
} from '../src/frontend/contracts/cleanSlateModels.js';
import { InMemoryCleanSlateRepository } from '../src/frontend/mocks/InMemoryCleanSlateRepository.js';
import {
  CatalystHttpAdminRepository,
  CatalystHttpAthleteRepository,
} from '../src/frontend/adapters/index.js';
import { CleanSlateApp } from '../src/frontend/CleanSlateApp.js';

const ALL_VIEWS: ViewId[] = [
  'dashboard',
  'profile-biometrics',
  'nutrition-log',
  'meal-plan',
  'recipes-substitutions',
  'shopping-list',
  'routines-mesocycle',
  'live-workout',
  'training-progress',
  'cardio-hiit',
  'notifications',
  'admin-console',
  'preauth-contracts',
];

function collectFrontendFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFrontendFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

test('UI SSR RENDER: Renders Loading, Error (zero silent fallback), Empty Workspace & Repository Mode Banners', async () => {
  const repo = new InMemoryCleanSlateRepository({ delayMs: 0 });
  const athleteSnap = await repo.hydrateWorkspace('usr_athlete_01');

  const loadingHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialLoadStatus: 'loading',
    })
  );
  assert.ok(loadingHtml.includes('Cargando espacio de trabajo local'));

  const errorHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialLoadStatus: 'error',
      initialLoadError: 'HTTP 401 SIGNED_SESSION_REQUIRED',
    })
  );
  assert.ok(errorHtml.includes('HTTP 401 SIGNED_SESSION_REQUIRED'));
  assert.ok(errorHtml.includes('Reintentar carga'));

  // When an HTTP adapter is injected, AppShell MUST display HTTP adapter mode and MUST NOT expose mock fault controls
  const httpConfig = {
    baseUrl: 'https://api.example.test',
    fetchImpl: (async () => new Response('{}', { status: 401 })) as typeof fetch,
  };
  const httpAthleteRepo = new CatalystHttpAthleteRepository(httpConfig);
  const httpAdminRepo = new CatalystHttpAdminRepository(httpConfig);
  const httpErrorHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: httpAthleteRepo,
      adminRepository: httpAdminRepo,
      initialLoadStatus: 'error',
      initialLoadError: 'Fallo HTTP real sin fallback a mock',
    })
  );
  assert.ok(httpErrorHtml.includes('Adaptador HTTP Clean-Slate'));
  assert.ok(httpErrorHtml.includes('Fallo HTTP real sin fallback a mock'));
  assert.ok(!httpErrorHtml.includes('Simular estado de repositorio'));

  repo.setFaultMode('empty_workspace');
  const emptySnap = await repo.hydrateWorkspace('usr_athlete_01');
  const emptyDashHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'dashboard',
      initialWorkspaceSnapshot: emptySnap,
    })
  );
  assert.ok(emptyDashHtml.includes('Espacio de trabajo sin configurar'));

  const readyDashHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'dashboard',
      initialWorkspaceSnapshot: athleteSnap,
    })
  );
  assert.ok(readyDashHtml.includes('Entorno Mock Local'));
  assert.ok(readyDashHtml.includes('memoria RAM'));
  assert.ok(readyDashHtml.includes('Camilo'));
});

test('UI SSR RENDER: All 13 Clean-Slate views render, reconcile 30 endpoints, label local catalogs, and enforce RBAC visibility', async () => {
  const repo = new InMemoryCleanSlateRepository({ delayMs: 0 });
  const athleteSnap = await repo.hydrateWorkspace('usr_athlete_01');
  const adminSnap = await repo.hydrateWorkspace('usr_admin_01');

  for (const view of ALL_VIEWS) {
    const snap = view === 'admin-console' ? adminSnap : athleteSnap;
    const persona = view === 'admin-console' ? 'usr_admin_01' : 'usr_athlete_01';
    const html = renderToStaticMarkup(
      React.createElement(CleanSlateApp, {
        athleteRepository: repo,
        adminRepository: repo,
        initialView: view,
        initialPersonaUid: persona,
        initialWorkspaceSnapshot: snap,
      })
    );
    assert.ok(html.length > 500, `Expected substantial rendered markup for view ${view}`);
  }

  // Athlete role navigating directly to admin-console MUST be blocked cleanly with 403 UI
  const athleteAdminHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'admin-console',
      initialPersonaUid: 'usr_athlete_01',
      initialWorkspaceSnapshot: athleteSnap,
    })
  );
  assert.ok(athleteAdminHtml.includes('Acceso Restringido'));
  assert.ok(!athleteAdminHtml.includes('>Administración<'));

  // Admin navigation sidebar MUST show Administration item & mock disclaimer
  const adminHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'admin-console',
      initialPersonaUid: 'usr_admin_01',
      initialWorkspaceSnapshot: adminSnap,
    })
  );
  assert.ok(adminHtml.includes('Consola Administrativa en Mock Local'));
  assert.ok(adminHtml.includes('Administración'));

  // Recipes & Nutrition Log must explicitly identify local static simulated catalogs (no live external USDA calls)
  const recipesHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'recipes-substitutions',
      initialWorkspaceSnapshot: athleteSnap,
    })
  );
  assert.ok(recipesHtml.includes('catálogo nutricional estático simulado'));
  assert.ok(recipesHtml.includes('catálogo local simulado'));

  // Technical guide view must contain 41 reconciled endpoints, dispatcher statuses, 501 admin listInvitations note, and zero Supabase
  assert.equal(CLEAN_SLATE_UI_ENDPOINT_MAP.length, 41);
  const guideHtml = renderToStaticMarkup(
    React.createElement(CleanSlateApp, {
      athleteRepository: repo,
      adminRepository: repo,
      initialView: 'preauth-contracts',
      initialWorkspaceSnapshot: athleteSnap,
    })
  );
  assert.ok(guideHtml.includes('Presupuesto Catalyst NoSQL'));
  assert.ok(guideHtml.includes('(41 endpoints)'));
  assert.ok(guideHtml.includes('41/41 paridad exacta'));
  assert.ok(guideHtml.includes('Dispatcher OK'));
  assert.ok(!guideHtml.includes('Desfase path'));
  assert.ok(!guideHtml.includes('Pendiente Dispatcher'));
  assert.ok(guideHtml.includes('UNSUPPORTED_CONTRACT_ENDPOINT'));
  assert.ok(guideHtml.includes('adminRepo.listInvitations'));
  assert.ok(guideHtml.includes('PartialBatchSyncError'));
  assert.ok(guideHtml.includes('/api/v1/auth/session/revoke'));
  assert.ok(guideHtml.includes('/api/v1/auth/me'));
  assert.ok(guideHtml.includes('/api/v1/athlete/meals'));
  assert.ok(guideHtml.includes('/api/v1/athlete/biometrics'));
  assert.ok(guideHtml.includes('/api/v1/athlete/preferences'));
  assert.ok(guideHtml.includes('/api/v1/athlete/notifications/read-all'));
  assert.ok(!guideHtml.toLowerCase().includes('supabase'));
  assert.ok(!guideHtml.toLowerCase().includes('firestore live'));
});

test('STATIC FRONTEND ISOLATION: Zero Firebase/Firestore/Supabase/secret leaks or vigorcore.lat defaults in src/frontend/', () => {
  const frontendDir = fs.existsSync(path.resolve('src/frontend'))
    ? path.resolve('src/frontend')
    : path.resolve('poc/catalyst-clean-slate/src/frontend');
  const files = collectFrontendFiles(frontendDir);
  assert.ok(files.length >= 23);

  const forbiddenTerms = [
    'firebase/firestore',
    'firebase/auth',
    'supabase',
    'Firestore Live',
    'vigorcore.lat',
    'VIGOR_SESSION_HMAC_SECRET',
    'Zoho-Catalyst-',
    '../../../src/',
    '../../../../../src/',
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const term of forbiddenTerms) {
      assert.ok(
        !content.includes(term),
        `Forbidden term '${term}' detected in clean-slate frontend file ${file}`
      );
    }
  }
});
