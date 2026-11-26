/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.5.1 Automated Verification:
 * Public Landing Page (Spanish Localization), Brand Footer,
 * Routing Separation, Access-Control Preservation & Claim Honesty
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  PRIVATE_NAVIGATION_PATHS,
  PUBLIC_NAVIGATION_PATHS,
  isPrivatePath,
} from '../src/types';

function readProjectFile(relPath: string): string {
  const fullPath = path.resolve(process.cwd(), relPath);
  return fs.readFileSync(fullPath, 'utf8');
}

function runLandingAndRoutingTests() {
  console.log('========================================================================');
  console.log(' VIGORCORE — PHASE 5.5.1 VERIFICATION: SPANISH LANDING & ROUTING');
  console.log('========================================================================\n');

  // 1. Navigation path classification
  assert.ok(
    PUBLIC_NAVIGATION_PATHS.includes('landing'),
    'PUBLIC_NAVIGATION_PATHS must include "landing".'
  );
  assert.equal(
    isPrivatePath('landing'),
    false,
    'isPrivatePath("landing") must return false.'
  );

  const expectedPrivatePaths = [
    'onboarding',
    'perfil-atleta',
    'dashboard-nutricional',
    'configuracion-nutricional',
    'menu-semanal',
    'registro-de-comidas',
    'registro-diario',
    'lista-de-compras',
    'sustituciones',
    'guia-y-ajustes',
    'rutina-de-entrenamiento',
    'registro-de-entrenamiento',
    'cardio-y-hiit',
    'progreso-del-entrenamiento',
    'planificador-mesociclo',
    'admin-usuarios',
  ] as const;

  for (const p of expectedPrivatePaths) {
    assert.ok(
      PRIVATE_NAVIGATION_PATHS.includes(p),
      `PRIVATE_NAVIGATION_PATHS must preserve "${p}".`
    );
    assert.equal(isPrivatePath(p), true, `isPrivatePath("${p}") must be true.`);
    assert.equal(
      PUBLIC_NAVIGATION_PATHS.includes(p),
      false,
      `Private route "${p}" must never appear in PUBLIC_NAVIGATION_PATHS.`
    );
  }
  console.log('[PASS] 1. Public/private route partition preserved (landing is public; 16 private paths enforced).');

  // 2. AppContext default route & listener guards
  const appContextSrc = readProjectFile('src/context/AppContext.tsx');
  assert.match(
    appContextSrc,
    /if \(!hash\)\s*\{\s*return 'landing';\s*\}\s*[\s\S]*?return 'landing';\s*\};/,
    'getInitialPath must default empty hash "/" to "landing".'
  );
  assert.match(
    appContextSrc,
    /if \(!rawHash\)\s*\{\s*setCurrentPath\('landing'\);\s*return;\s*\}/,
    'handleHashChange must resolve empty hash back to "landing".'
  );
  assert.match(
    appContextSrc,
    /window\.location\.hash\s*=\s*path === 'landing' \? '#\/' : `#\/\$\{path\}`;/,
    'navigate("landing") must map cleanly to "#/" without triggering login.'
  );
  assert.match(
    appContextSrc,
    /if \(!activeUid \|\| isDemoMode \|\| authStatus !== 'authenticated'\)\s*\{\s*return;\s*\}/,
    'Private Firestore listeners must remain strictly gated behind authStatus === "authenticated".'
  );
  console.log('[PASS] 2. Default root route resolves to "landing" and Firestore subscriptions stay gated.');

  // 3. App.tsx renders LandingView publicly before ProtectedRoute/initializing gate
  const appSrc = readProjectFile('src/App.tsx');
  const landingBranchIdx = appSrc.indexOf("if (currentPath === 'landing')");
  const initializingBranchIdx = appSrc.indexOf("if (authStatus === 'initializing')");
  const unauthBranchIdx = appSrc.indexOf("authStatus === 'unauthenticated'");
  assert.ok(landingBranchIdx > -1, 'App.tsx must handle currentPath === "landing".');
  assert.ok(initializingBranchIdx > landingBranchIdx, 'LandingView must render without blocking on authStatus === "initializing".');
  assert.ok(unauthBranchIdx > landingBranchIdx, 'LandingView must render without redirecting unauthenticated users to LoginView.');
  assert.match(appSrc, /<LandingView\s*\/>/, 'App.tsx must render <LandingView />.');
  console.log('[PASS] 3. App.tsx renders LandingView publicly without auto-redirecting to LoginView.');

  // 4. HTML document language & Spanish metadata
  const indexHtmlSrc = readProjectFile('index.html');
  assert.match(indexHtmlSrc, /<html lang="es">/, 'index.html must declare lang="es".');
  assert.equal(/Personal Health SaaS/i.test(indexHtmlSrc), false, 'index.html must not contain English SaaS boilerplate.');
  assert.match(indexHtmlSrc, /Nutrición Estructurada y Entrenamiento de Fuerza/, 'index.html title/meta must be in Spanish.');
  console.log('[PASS] 4. index.html language and metadata localized in Spanish.');

  // 5. Mandatory AWD S.A.S. copyright footer & reusable PublicFooter
  const footerSrc = readProjectFile('src/components/layout/PublicFooter.tsx');
  const loginSrc = readProjectFile('src/views/LoginView.tsx');
  const exactCopyright = '© 2026 AWD S.A.S. — Todos los derechos reservados.';
  assert.ok(footerSrc.includes(exactCopyright), 'PublicFooter must contain exact copyright notice.');
  assert.ok(loginSrc.includes(exactCopyright), 'LoginView must contain exact copyright notice.');
  assert.match(loginSrc, /navigate\('landing'\)/, 'LoginView must expose return navigation to public landing page.');
  console.log('[PASS] 5. Reusable PublicFooter and exact AWD S.A.S. copyright verified.');

  // 6. LandingView Spanish localization, structure, CTAs, honesty & design discipline
  const landingSrc = readProjectFile('src/views/LandingView.tsx');
  assert.match(landingSrc, /Entrenamiento y nutrición, conectados con tu progreso\./, 'LandingView must render Spanish headline.');
  assert.match(landingSrc, /Descubrir VigorCore/, 'LandingView must include Spanish primary CTA "Descubrir VigorCore".');
  assert.match(landingSrc, /Ya tengo acceso · Iniciar sesión/, 'LandingView must include Spanish secondary CTA "Ya tengo acceso · Iniciar sesión".');
  assert.match(landingSrc, /<PublicFooter\b/, 'LandingView must render reusable PublicFooter.');
  assert.match(landingSrc, /id="resumen"/, 'LandingView must include Hero section (#resumen).');
  assert.match(landingSrc, /id="modulos"/, 'LandingView must include Product Modules section (#modulos).');
  assert.match(landingSrc, /id="confianza"/, 'LandingView must include Trust & Transparency section (#confianza).');
  assert.match(landingSrc, /id="como-funciona"/, 'LandingView must include How It Works section (#como-funciona).');
  assert.match(landingSrc, /id="acceso"/, 'LandingView must include Final CTA section (#acceso).');

  // Ensure zero leftover English UI copy in LandingView
  const forbiddenEnglishUiCopy = [
    /Explore VigorCore/,
    /Already have access\? Sign in/,
    /Workspace UI Preview/,
    /Implemented Modules/,
    /Trust &amp; Access Transparency/,
    /How It Works/,
    /Access Model/,
    /Workspace Entry/,
    /Open Workspace/,
    /Meal Moment Distribution/,
    /Daily Target/,
    /Illustrative sample profile/,
    /Private athlete records load strictly/,
  ];
  for (const pattern of forbiddenEnglishUiCopy) {
    assert.equal(
      pattern.test(landingSrc),
      false,
      `LandingView must not retain English UI string matching ${pattern}`
    );
  }

  // Ensure no public signup / request-access form or banned design shortcuts
  assert.equal(/<form\b/i.test(landingSrc), false, 'LandingView must not include public signup or fake access-request forms.');
  assert.equal(/animate-(pulse|ping|bounce)/.test(landingSrc), false, 'LandingView must not contain decorative pulsing/bouncing animations.');
  assert.equal(/rounded-full/.test(landingSrc), false, 'LandingView must obey zero-pill discipline (no rounded-full badge/pill clusters).');
  assert.equal(/window\.(alert|open)/.test(landingSrc), false, 'LandingView must not call window.alert or window.open.');

  // Ensure no fabricated claims, certifications, testimonials, or unimplemented integrations
  const forbiddenClaims = [
    /SOC\s*2/i,
    /HIPAA/i,
    /ISO\s*27001/i,
    /GDPR\s*certified/i,
    /\bAI\s+coach\b|\bcoach\s+de\s+IA\b/i,
    /\bescáner\s+de\s+códigos\b|\bbarcode\s+scanner\b/i,
    /\b10\.000\+|\b50\.000\+|atletas\s+activos\s+en\s+todo\s+el\s+mundo/i,
    /\b4\.9\s*\/\s*5\b|★{3,}/i,
    /\bFitbit\b|\bGarmin\b|\bWhoop\b|\bOura\b/i,
    /\bNIT\b/i,
  ];
  for (const pattern of forbiddenClaims) {
    assert.equal(
      pattern.test(landingSrc),
      false,
      `LandingView must not contain unsupported or fabricated claim matching ${pattern}`
    );
  }
  console.log('[PASS] 6. Full Spanish localization, zero leftover English strings, and claim honesty verified.');

  console.log('\n========================================================================');
  console.log(' RESULT: PHASE 5.5.1 LANDING & ROUTING VERIFICATION PASSED (6/6 CHECKS)');
  console.log('========================================================================\n');
}

runLandingAndRoutingTests();
