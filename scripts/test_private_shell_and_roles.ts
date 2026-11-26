import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatUserRoleLabel, PRIVATE_ROUTE_META } from '../src/utils/roleDisplay';
import { PRIVATE_NAVIGATION_PATHS, PUBLIC_NAVIGATION_PATHS, isPrivatePath } from '../src/types';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
  passed++;
}

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

console.log('\n=== VigorCore Phase 5.6 Private Shell & Role Display Tests ===\n');

test('formatUserRoleLabel displays Entrenador for internal Coach key without mutating key', () => {
  assert.equal(formatUserRoleLabel('Coach'), 'Entrenador');
  assert.equal(formatUserRoleLabel('Atleta Pro'), 'Atleta Pro');
  assert.equal(formatUserRoleLabel('Nutricionista'), 'Nutricionista');
  assert.equal(formatUserRoleLabel('admin'), 'Administrador');
  assert.equal(formatUserRoleLabel('superadmin'), 'Superadministrador');
  assert.equal(formatUserRoleLabel('athlete'), 'Atleta');
  assert.equal(formatUserRoleLabel(undefined), 'Atleta');
});

test('all 16 PRIVATE_NAVIGATION_PATHS have metadata and are classified as private', () => {
  assert.equal(PRIVATE_NAVIGATION_PATHS.length, 16);
  for (const route of PRIVATE_NAVIGATION_PATHS) {
    assert.equal(isPrivatePath(route), true, `Expected ${route} to be private`);
    assert.ok(PRIVATE_ROUTE_META[route], `Missing PRIVATE_ROUTE_META entry for ${route}`);
    assert.ok(PRIVATE_ROUTE_META[route]!.title.length > 0);
  }
  for (const pub of PUBLIC_NAVIGATION_PATHS) {
    assert.equal(isPrivatePath(pub), false, `Public path ${pub} must not be classified as private`);
  }
});

test('LoginView and AuthModal preserve internal Coach role value and render formatUserRoleLabel', () => {
  const loginSrc = readSrc('src/views/LoginView.tsx');
  const authModalSrc = readSrc('src/components/modals/AuthModal.tsx');
  assert.ok(loginSrc.includes("(['Atleta Pro', 'Coach', 'Nutricionista'] as const)"));
  assert.ok(loginSrc.includes('{formatUserRoleLabel(r)}'));
  assert.ok(authModalSrc.includes("(['Atleta Pro', 'Coach', 'Nutricionista'] as const)"));
  assert.ok(authModalSrc.includes('{formatUserRoleLabel(r)}'));
  assert.ok(authModalSrc.includes('formatUserRoleLabel(currentUser.role)'));
});

test('Sidebar enforces admin role gating and provides return-to-landing navigation', () => {
  const sidebarSrc = readSrc('src/components/layout/Sidebar.tsx');
  assert.ok(sidebarSrc.includes("currentUserRole === 'admin' || currentUserRole === 'superadmin'"));
  assert.ok(sidebarSrc.includes("'admin-usuarios'"));
  assert.ok(sidebarSrc.includes("handleNavClick('landing')"));
  assert.ok(sidebarSrc.includes('Inicio público'));
  assert.ok(sidebarSrc.includes('aria-current={isActive'));
  assert.ok(!sidebarSrc.includes('Online Telemetry'));
  assert.ok(!sidebarSrc.includes('Personal Health SaaS'));
  assert.ok(!sidebarSrc.includes('Firestore Live'));
  assert.ok(!sidebarSrc.includes('animate-pulse'));
});

test('Header displays active route context, Spanish mobile workout label, and mapped role label', () => {
  const headerSrc = readSrc('src/components/layout/Header.tsx');
  assert.ok(headerSrc.includes('activeRouteMeta.section'));
  assert.ok(headerSrc.includes('activeRouteMeta.title'));
  assert.ok(headerSrc.includes('Entreno'));
  assert.ok(headerSrc.includes('formatUserRoleLabel(currentUser.role)'));
  assert.ok(!headerSrc.includes('>Gym<'));
  assert.ok(!headerSrc.includes('Auditoría Temporal'));
  assert.ok(!headerSrc.includes('animate-pulse'));
});

test('NutritionalDashboardView fixes amber contrast and includes grounded training/ACWR overview', () => {
  const dashSrc = readSrc('src/views/NutritionalDashboardView.tsx');
  assert.ok(dashSrc.includes('computeConsolidatedAnalytics'));
  assert.ok(dashSrc.includes('Entrenamiento y Carga Reciente'));
  assert.ok(dashSrc.includes('Tonelaje Efectivo'));
  assert.ok(dashSrc.includes('Índice de Carga (ACWR)'));
  assert.ok(!dashSrc.includes('text-amber-200'));
  assert.ok(!dashSrc.includes('text-amber-300'));
  assert.ok(!dashSrc.includes('Hoja: Menu_Semanal'));
  assert.ok(!dashSrc.includes('Sincronizar Cloud Firestore'));
});

test('Private views remove misleading fabricated device, Supabase, Excel, and English labels', () => {
  const cardioSrc = readSrc('src/views/CardioHiitView.tsx');
  assert.ok(!cardioSrc.includes('Polar H10 Conectado'));
  assert.ok(!cardioSrc.includes('Apple Watch Ultra Sincronizado'));
  assert.ok(!cardioSrc.includes('Canal 2 Supabase Sync'));
  assert.ok(!cardioSrc.includes('Max Effort'));
  assert.ok(cardioSrc.includes('Registro manual'));

  const configSrc = readSrc('src/views/NutritionalConfigView.tsx');
  assert.ok(!configSrc.includes('Restablecer Excel'));
  assert.ok(!configSrc.includes('Mapeo Excel &amp; Supabase'));
  assert.ok(!configSrc.includes('Config_Nutricion_Master.xlsx'));

  const mealLogSrc = readSrc('src/views/MealLogView.tsx');
  assert.ok(!mealLogSrc.includes('924 registros almacenados'));
  assert.ok(!mealLogSrc.includes('simulada: 12 filas'));

  const guideSrc = readSrc('src/views/GuideSettingsView.tsx');
  assert.ok(!guideSrc.includes('tabla de Supabase'));
  assert.ok(!guideSrc.includes('este SaaS'));

  const dailySrc = readSrc('src/views/DailyLogView.tsx');
  assert.ok(!dailySrc.includes('Auditoría Temporal Telemetría'));
  assert.ok(!dailySrc.includes('Supabase Ready'));

  const progressSrc = readSrc('src/views/TrainingProgressView.tsx');
  assert.ok(!progressSrc.includes('Warmup Excluido'));
  assert.ok(progressSrc.includes('Calentamiento excluido del tonelaje'));

  const routineSrc = readSrc('src/views/WorkoutRoutineView.tsx');
  assert.ok(!routineSrc.includes('Iniciar Gym Mode'));
  assert.ok(!routineSrc.includes('text-amber-400'));
});

console.log(`\n✓ Passed ${passed} Phase 5.6 private shell & role display tests.\n`);
