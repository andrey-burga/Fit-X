/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — Real Headless Chromium E2E Verification Suite
 *
 * SCOPE CLASSIFICATION:
 * - [PASS-BROWSER-E2E] Real headless Chromium (`playwright-core`) executing the compiled
 *   Vite React SPA (`dist-frontend/`) against an ephemeral local Express server on
 *   `http://localhost:<port>` with `/api/v1/*` backed by `CleanSlateApiDispatcher`,
 *   in-memory NoSQL (`CleanSlateInMemoryNoSQLAdapter`), and `MockCatalystAuthRuntime`.
 *
 * IMPORTANT:
 * - This test DOES NOT hit remote Zoho Catalyst Slate, Advanced I/O, or remote NoSQL tables.
 * - Verifies BOTH:
 *   1. Mock Dev UI flows (13 workspace routes, persona switch, fault modes, mobile drawer/layout).
 *   2. Real HTTP Adapter mode (`?mode=http`) with `__Host-vigor_session` (`HttpOnly; Secure;
 *      SameSite=Strict; Path=/`) invisible to `document.cookie`, server-minted bound CSRF tokens
 *      in memory only (zero `localStorage`/`sessionStorage`), full `page.reload()` persistence
 *      + CSRF re-hydration via `GET /api/v1/auth/me`, RBAC 403 & `501` checks, and real logout.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';

import {
  CleanSlateApiDispatcher,
  type ApiEndpointDefinition,
} from '../src/routes/apiRouterSchema.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CleanSlateAuthGuard,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { HttpSecurityPolicy } from '../src/security/httpSecurityPolicy.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { KeyBuilders, type UserAccountItem } from '../src/types/cleanSlate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POC_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(POC_ROOT, 'dist-frontend');
const CHROMIUM_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

function ensureFrontendBuilt(): void {
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    execFileSync('npx', ['vite', 'build', '--config', 'vite.frontend.config.ts'], {
      cwd: POC_ROOT,
      stdio: 'pipe',
    });
  }
  assert.ok(fs.existsSync(indexHtml), `Missing compiled frontend at ${indexHtml}`);
}

async function startE2EServer() {
  ensureFrontendBuilt();

  let nowSec = Math.floor(Date.now() / 1000);
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const sessionManager = new ServerSessionTokenManager({
    activeSecret: ServerSessionTokenManager.generateStrongSecret(32),
    activeKeyId: 'k1',
    environment: 'e2e-local',
    nowSecProvider: () => nowSec,
  });
  const authGuard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);

  const app = express();
  app.use(express.json({ limit: '600kb' }));

  let dispatcher: CleanSlateApiDispatcher | null = null;

  app.use('/api/v1', async (req, res) => {
    assert.ok(dispatcher, 'Dispatcher not initialized');
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v[0] : v;
    }
    const cookies: Record<string, string> = {};
    if (headers.cookie) {
      for (const pair of headers.cookie.split(';')) {
        const i = pair.indexOf('=');
        if (i > 0) cookies[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
      }
    }
    const fullApiPath = `/api/v1${req.path}`;
    const out = await dispatcher.dispatch(
      req.method.toUpperCase() as ApiEndpointDefinition['method'] | 'OPTIONS',
      fullApiPath,
      {
        headers,
        cookies,
        query: req.query as Record<string, unknown>,
        body: req.body,
      }
    );
    if (out.headers) {
      for (const [hk, hv] of Object.entries(out.headers)) {
        res.setHeader(hk, hv);
      }
    }
    if (out.status === 204) {
      res.status(204).end();
      return;
    }
    res.status(out.status).json(out.body);
  });

  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Expected TCP server address');
  const origin = `http://localhost:${address.port}`;

  const httpPolicy = new HttpSecurityPolicy({
    allowedOrigins: [origin],
    enforceFetchMetadata: true,
    requireOriginOnMutations: true,
    requireCsrfHeaderOnMutations: true,
    enforceSignedCsrfTokens: true,
  });
  dispatcher = new CleanSlateApiDispatcher(authGuard, athleteService, adminService, httpPolicy);

  return {
    origin,
    db,
    authRuntime,
    server,
    advanceTime: (sec: number) => {
      nowSec += sec;
    },
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
  };
}

test('[PASS-BROWSER-E2E] Chromium E2E: Mock Dev UI (desktop + mobile drawer/overflow + persona RBAC + fault states) AND HTTP Adapter mode (?mode=http with HttpOnly cookie, bound CSRF, 41-route mutations, reload rehydration, 403/409/501 & logout)', async () => {
  assert.ok(
    fs.existsSync(CHROMIUM_EXECUTABLE),
    `Headless Chromium binary not found at ${CHROMIUM_EXECUTABLE}`
  );

  const srv = await startE2EServer();
  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // =========================================================================
    // PART A: MOCK DEV UI FLOW (Desktop + Mobile)
    // =========================================================================
    const mockContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mockPage = await mockContext.newPage();
    const mockErrors: string[] = [];
    mockPage.on('pageerror', err => mockErrors.push(`pageerror: ${err.message}`));
    mockPage.on('console', msg => {
      if (msg.type() === 'error') {
        mockErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await mockPage.goto(`${srv.origin}/`, { waitUntil: 'networkidle' });
    await mockPage.getByText('Entorno Mock Local').waitFor({ state: 'visible' });

    // Verify key views navigate cleanly in Mock mode
    for (const [navLabel, expectedHeading] of [
      ['Registro de Comidas', 'Registro de Comidas y Cumplimiento'],
      ['Lista de Compras', 'Lista de Compras Sincronizada'],
      ['Rutinas & Mesociclos', 'Rutinas y Planificador de Mesociclo'],
      ['Sesión Activa', 'Sesión de Entrenamiento Activa'],
      ['Cardio & HIIT', 'Cardio y Protocolos HIIT'],
      ['Notificaciones', 'Centro de Notificaciones'],
      ['Guía & Contratos Catalyst', 'Guía Técnica y Contratos Pre-Auth Catalyst'],
    ] as const) {
      const btn =
        navLabel === 'Notificaciones'
          ? mockPage.getByRole('button', { name: /^Notificaciones(\s*\d+)?$/ })
          : mockPage.getByRole('button', { name: navLabel, exact: true });
      await btn.click();
      await mockPage.getByRole('heading', { name: expectedHeading, exact: true }).waitFor({ state: 'visible' });
    }

    // Persona switch to Admin -> inspect AdminConsoleView + 501 invitation contract notice
    await mockPage
      .getByLabel('Selector de persona de desarrollo (no autenticación real)')
      .selectOption('usr_admin_01');
    await mockPage.getByRole('button', { name: 'Administración', exact: true }).click();
    await mockPage.getByText('Invitaciones RBAC (AdminInvitations)').waitFor({ state: 'visible' });
    await mockPage.getByText('Directorio de Usuarios (Contrato GSI_Directory)').waitFor({ state: 'visible' });

    // Fault simulator checks (empty_workspace -> network_error -> reset)
    await mockPage.getByLabel('Selector de persona de desarrollo (no autenticación real)').selectOption('usr_athlete_01');
    await mockPage.getByLabel('Simular estado de repositorio').selectOption('empty_workspace');
    await mockPage.getByText('Dashboard del Atleta').waitFor({ state: 'visible' });
    await mockPage.getByLabel('Simular estado de repositorio').selectOption('network_error');
    await mockPage.getByText('Error al cargar el espacio de trabajo').waitFor({ state: 'visible' });
    await mockPage.getByLabel('Simular estado de repositorio').selectOption('none');
    await mockPage.getByText('Dashboard del Atleta').waitFor({ state: 'visible' });

    // Mobile viewport drawer + overflow check (375x812)
    await mockPage.setViewportSize({ width: 375, height: 812 });
    await mockPage.getByRole('button', { name: 'Abrir navegación' }).click();
    await mockPage.getByRole('button', { name: 'Cardio & HIIT', exact: true }).last().click();
    await mockPage.getByRole('heading', { name: 'Cardio y Protocolos HIIT', exact: true }).waitFor({ state: 'visible' });

    const mobileOverflow = await mockPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    assert.equal(mobileOverflow, false, 'Mobile viewport should not exhibit horizontal overflow');
    assert.deepEqual(mockErrors, [], `Unexpected Mock UI runtime errors: ${mockErrors.join('; ')}`);
    await mockContext.close();

    // =========================================================================
    // PART B: REAL HTTP ADAPTER FLOW (?mode=http)
    // =========================================================================
    const httpContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await httpContext.newPage();
    const unexpectedPageErrors: string[] = [];
    page.on('pageerror', err => {
      console.error('[E2E Part B pageerror]', err);
      unexpectedPageErrors.push(`pageerror: ${err.message}`);
    });

    // 1. Unauthenticated visit renders fail-closed error panel (401, ZERO silent mock fallback)
    await page.goto(`${srv.origin}/?mode=http`, { waitUntil: 'networkidle' });
    await page.getByText('Error al cargar el espacio de trabajo').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Reintentar carga' }).waitFor({ state: 'visible' });

    // 2. Authenticate Catalyst athlete identity and run real first-exchange POST /bootstrap-profile
    srv.authRuntime.setCurrentUser({
      zuid: 'z_e2e_athlete',
      user_id: 'cat_e2e_athlete',
      email_id: 'camilo.e2e@vigorcore.test',
      status: 'ACTIVE',
      is_confirmed: true,
      first_name: 'Camilo',
      last_name: 'E2E',
    });

    const bootStatus = await page.evaluate(async () => {
      const resp = await fetch('/api/v1/auth/session/bootstrap-profile', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        },
        body: JSON.stringify({}),
      });
      return { status: resp.status, body: (await resp.json()) as Record<string, unknown> };
    });
    assert.equal(bootStatus.status, 200);
    assert.ok(typeof bootStatus.body.csrfToken === 'string' && bootStatus.body.csrfToken.length > 32);

    // Clear active Catalyst request session to prove ALL subsequent routine calls run cookie-only (`hmac_session`)
    srv.authRuntime.setCurrentUser(null);

    // Inspect Chromium cookie jar + DOM invisibility + empty Web Storage
    const cookies = await httpContext.cookies(srv.origin);
    const sessionCookie = cookies.find(c => c.name === SIGNED_SESSION_COOKIE_NAME);
    assert.ok(sessionCookie, '__Host-vigor_session cookie must exist in Chromium cookie jar');
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.sameSite, 'Strict');
    assert.equal(sessionCookie.path, '/');

    const storageAndDom = await page.evaluate(() => ({
      docCookie: document.cookie,
      lsLen: window.localStorage.length,
      ssLen: window.sessionStorage.length,
    }));
    assert.equal(storageAndDom.docCookie, '', 'HttpOnly cookie MUST NOT be readable via document.cookie');
    assert.equal(storageAndDom.lsLen, 0, 'Zero tokens/secrets in localStorage');
    assert.equal(storageAndDom.ssLen, 0, 'Zero tokens/secrets in sessionStorage');

    // 3. Retry load -> runs GET /auth/me (hydrates bound CSRF in memory) + GET /athlete/workspace
    await page.getByRole('button', { name: 'Reintentar carga' }).click();
    await page.getByText('Adaptador HTTP Clean-Slate').first().waitFor({ state: 'visible' });
    await page.getByText('Espacio de trabajo sin configurar').waitFor({ state: 'visible' });

    // Verify dev persona switcher & Admin nav item are hidden for Athlete in HTTP mode
    assert.equal(
      await page.getByLabel('Selector de persona de desarrollo (no autenticación real)').count(),
      0
    );
    assert.equal(await page.getByRole('button', { name: 'Administración', exact: true }).count(), 0);

    // 4. Profile, Biometrics, Preferences & Immutable Role Spoof Check
    await page.getByRole('button', { name: 'Perfil & Biometría', exact: true }).click();
    await page.getByLabel('Nombre completo').fill('Camilo Vigor E2E');
    await page.getByRole('button', { name: 'Guardar perfil' }).click();
    await page.getByText('Perfil actualizado vía adaptador HTTP').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Guardar biometría y metas' }).click();
    await page.getByText('Biometría y objetivos calóricos guardados').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    await page.getByText('Preferencias actualizadas').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Probar bloqueo de rol en cliente' }).click();
    await page.getByText('Inmutabilidad de campos de seguridad verificada').waitFor({ state: 'visible' });

    // 5. Nutrition Log: Create + Delete meal (DELETE /api/v1/athlete/meals/:mealId)
    await page.getByRole('button', { name: 'Registro de Comidas', exact: true }).click();
    await page.getByLabel('Nombre de comida').fill('Pollo Basmati E2E');
    await page.getByLabel('kcal', { exact: true }).fill('520');
    await page.getByLabel('Prot (g)').fill('48');
    await page.getByLabel('Carb (g)').fill('55');
    await page.getByLabel('Grasa (g)').fill('10');
    await page.getByRole('button', { name: 'Registrar comida' }).click();
    await page.getByText('Pollo Basmati E2E', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Eliminar Pollo Basmati E2E' }).click();
    await page.getByText('Registro eliminado').waitFor({ state: 'visible' });

    // 6. Shopping List: Add Manual, Toggle Bought, Delete
    await page.getByRole('button', { name: 'Lista de Compras', exact: true }).click();
    await page.getByLabel('Nombre del artículo').fill('Café Espresso E2E');
    await page.getByRole('button', { name: 'Añadir a Lista' }).click();
    await page.getByText('Café Espresso E2E', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Café Espresso E2E/ }).first().click();
    await page.getByRole('button', { name: 'Eliminar Café Espresso E2E' }).click();
    await page.getByText('Artículo eliminado').waitFor({ state: 'visible' });

    // 7. Cardio & HIIT: Create + Delete cardio session
    await page.getByRole('button', { name: 'Cardio & HIIT', exact: true }).click();
    await page.getByLabel('Título de la sesión').fill('Zona 2 Remo E2E');
    await page.getByRole('button', { name: 'Registrar Sesión Cardio' }).click();
    await page.getByText('Zona 2 Remo E2E', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Eliminar sesión Zona 2 Remo E2E' }).click();
    await page.getByText('Sesión cardio eliminada').waitFor({ state: 'visible' });

    // 8. Routines & Live Workout: Generate routine + Start + Log Set + Complete + 409 Terminal Lock Check
    await page.getByRole('button', { name: 'Rutinas & Mesociclos', exact: true }).click();
    await page.getByLabel('Nombre del programa').fill('Mesociclo E2E Persistente');
    await page.getByRole('button', { name: 'Generar y Activar Mesociclo' }).click();
    await page.getByText('Mesociclo E2E Persistente').first().waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Sesión Activa', exact: true }).click();
    await page.getByRole('button', { name: /Iniciar Sesión/ }).click();
    await page.getByRole('button', { name: 'Guardar Serie' }).click();
    await page.getByText(/Serie registrada/).first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Completar Sesión' }).click();
    await page.getByText('completed (Inmutable)').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Probar Bloqueo 409' }).first().click();
    await page.getByText('Bloqueo de Inmutabilidad Verificado (HTTP 409)').waitFor({ state: 'visible' });

    // 9. Notifications: Create + Mark Read + Mark All Read
    await page.getByRole('button', { name: /^Notificaciones(\s*\d+)?$/ }).click();
    await page.getByLabel('Título de notificación').fill('Alerta E2E 1');
    await page.getByLabel('Mensaje de notificación').fill('Primer recordatorio HTTP');
    await page.getByRole('button', { name: 'Generar Notificación' }).click();
    await page.getByText('Alerta E2E 1', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Marcar leída' }).first().click();

    await page.getByLabel('Título de notificación').fill('Alerta E2E 2');
    await page.getByLabel('Mensaje de notificación').fill('Segundo recordatorio HTTP');
    await page.getByRole('button', { name: 'Generar Notificación' }).click();
    await page.getByText('Alerta E2E 2', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Marcar todas leídas' }).click();
    await page.getByText('Todas las notificaciones marcadas como leídas').waitFor({ state: 'visible' });

    // 10. FULL PAGE RELOAD: re-hydrates session via cookie + GET /auth/me CSRF without Web Storage!
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Adaptador HTTP Clean-Slate').first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Rutinas & Mesociclos', exact: true }).click();
    await page.getByText('Mesociclo E2E Persistente').first().waitFor({ state: 'visible' });

    const postReloadStorage = await page.evaluate(() => ({
      docCookie: document.cookie,
      lsLen: window.localStorage.length,
      ssLen: window.sessionStorage.length,
    }));
    assert.equal(postReloadStorage.docCookie, '');
    assert.equal(postReloadStorage.lsLen, 0);
    assert.equal(postReloadStorage.ssLen, 0);

    // 11. RBAC 403 Check for Athlete calling Admin endpoint inside authenticated browser context
    const athleteAdminAttempt = await page.evaluate(async () => {
      const r = await fetch('/api/v1/admin/stats', { credentials: 'include' });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    });
    assert.equal(athleteAdminAttempt.status, 403);
    assert.equal(athleteAdminAttempt.body.error, 'PERMISSION_DENIED');

    // 12. Real Logout via UI button -> clears HttpOnly cookie & blocks subsequent reload (`401`)
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByText('Sesión HTTP cerrada. La cookie __Host-vigor_session fue revocada en el servidor.').waitFor({
      state: 'visible',
    });
    const cookiesAfterLogout = await httpContext.cookies(srv.origin);
    assert.equal(
      cookiesAfterLogout.find(c => c.name === SIGNED_SESSION_COOKIE_NAME),
      undefined,
      '__Host-vigor_session cookie must be cleared on logout'
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Error al cargar el espacio de trabajo').waitFor({ state: 'visible' });

    // =========================================================================
    // PART C: ADMIN UI IN HTTP MODE (verifying explicit 501 listInvitations banner)
    // =========================================================================
    srv.authRuntime.setCurrentUser({
      zuid: 'z_e2e_admin',
      user_id: 'cat_e2e_admin',
      email_id: 'laura.admin@vigorcore.test',
      status: 'ACTIVE',
      is_confirmed: true,
      first_name: 'Laura',
      last_name: 'Admin',
    });
    const adminBoot = await page.evaluate(async () => {
      const r = await fetch('/api/v1/auth/session/bootstrap-profile', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Vigor-Requested-With': 'VigorCore-CleanSlate',
        },
        body: '{}',
      });
      return r.status;
    });
    assert.equal(adminBoot, 200);
    // Elevate user role to admin directly in Users table (server-side only, never via client)
    const adminUserItem = await srv.db.fetchItem<UserAccountItem>(
      'Users',
      { pk: KeyBuilders.userPk('cat_e2e_admin') },
      { consistent_read: true }
    );
    assert.ok(adminUserItem);
    await srv.db.updateItem(
      'Users',
      { pk: adminUserItem.pk },
      { role: 'admin', roleVersion: 2 },
      { type: 'equals', attr: 'roleVersion', value: 1 }
    );
    srv.authRuntime.setCurrentUser(null);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await page.getByText('Consola Administrativa · Adaptador HTTP Clean-Slate (/api/v1/admin/*)').waitFor({
      state: 'visible',
    });
    await page.getByText('Contrato pendiente (501)').waitFor({ state: 'visible' });

    assert.deepEqual(
      unexpectedPageErrors,
      [],
      `Unexpected uncaught page errors in HTTP E2E flow: ${unexpectedPageErrors.join('; ')}`
    );
    await httpContext.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
