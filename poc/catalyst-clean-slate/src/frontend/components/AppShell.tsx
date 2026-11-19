/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Responsive Decoupled Application Shell
 * Features:
 * - Collapsible 256px sidebar with grouped domain navigation
 * - Single-row 56px top bar with breadcrumb, search trigger, dev persona selector, fault-mode preview & theme toggle
 * - Explicit non-persistent local mock indicator
 */

import React, { useState } from 'react';
import {
  Activity,
  Bell,
  CalendarDays,
  ChefHat,
  Dumbbell,
  FileCode2,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sun,
  TrendingUp,
  UserCheck,
  Utensils,
  X,
} from 'lucide-react';
import type { ViewId } from '../contracts/cleanSlateModels';
import type { MockFaultMode } from '../contracts/repositories';
import { useWorkspace, type DevPersonaKey } from '../state/WorkspaceContext';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { InlineAlert, StatePanel } from './UiPrimitives';

interface NavGroup {
  label: string;
  items: Array<{ id: ViewId; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Resumen',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'profile-biometrics', label: 'Perfil & Biometría', icon: UserCheck },
    ],
  },
  {
    label: 'Nutrición',
    items: [
      { id: 'nutrition-log', label: 'Registro de Comidas', icon: Utensils },
      { id: 'meal-plan', label: 'Menú & Periodización', icon: CalendarDays },
      { id: 'recipes-substitutions', label: 'Recetas & Sustituciones', icon: ChefHat },
      { id: 'shopping-list', label: 'Lista de Compras', icon: ShoppingCart },
    ],
  },
  {
    label: 'Entrenamiento',
    items: [
      { id: 'routines-mesocycle', label: 'Rutinas & Mesociclos', icon: Dumbbell },
      { id: 'live-workout', label: 'Sesión Activa', icon: Play },
      { id: 'training-progress', label: 'Progreso & ACWR', icon: TrendingUp },
      { id: 'cardio-hiit', label: 'Cardio & HIIT', icon: HeartPulse },
    ],
  },
  {
    label: 'Sistema & Gobierno',
    items: [
      { id: 'notifications', label: 'Notificaciones', icon: Bell },
      { id: 'admin-console', label: 'Administración', icon: ShieldCheck, adminOnly: true },
      { id: 'preauth-contracts', label: 'Guía & Contratos Catalyst', icon: FileCode2 },
    ],
  },
];

const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard del Atleta',
  'profile-biometrics': 'Perfil, Biometría y Onboarding',
  'nutrition-log': 'Registro de Comidas y Cumplimiento',
  'meal-plan': 'Menú Semanal y Periodización Nutricional',
  'recipes-substitutions': 'Recetas y Calculadora de Sustituciones',
  'shopping-list': 'Lista de Compras Sincronizada',
  'routines-mesocycle': 'Rutinas y Planificador de Mesociclo',
  'live-workout': 'Sesión de Entrenamiento Activa',
  'training-progress': 'Analítica de Carga, ACWR y Autorregulación',
  'cardio-hiit': 'Cardio y Protocolos HIIT',
  notifications: 'Centro de Notificaciones',
  'admin-console': 'Consola Administrativa (Mock RBAC)',
  'preauth-contracts': 'Guía Técnica y Contratos Pre-Auth Catalyst',
};

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeView,
    navigate,
    theme,
    toggleTheme,
    activePersonaUid,
    switchDevPersona,
    loadStatus,
    loadError,
    reloadWorkspace,
    faultMode,
    setSimulatedFaultMode,
    resetMockSeed,
    workspace,
    unreadNotificationsCount,
    toast,
    dismissToast,
    isLocalDevMock,
    repositoryModeLabel,
    logoutSession,
  } = useWorkspace();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const currentRole = workspace?.profile.role ?? 'athlete';
  const isAdmin = currentRole === 'admin' || currentRole === 'superadmin';

  const handleSelectNav = (view: ViewId) => {
    navigate(view);
    setMobileMenuOpen(false);
  };

  const renderSidebarBody = () => (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-col">
        <div className="h-14 px-4 flex items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => handleSelectNav('dashboard')}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center">
              <Activity className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-ink tracking-tight">VigorCore</span>
              <span className="block text-[11px] text-ink-muted">Clean-Slate Frontend</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt cursor-pointer"
            aria-label="Cerrar menú lateral"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="p-3 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  if (item.adminOnly && !isAdmin) return null;
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectNav(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-brand text-white font-medium'
                          : 'text-ink-muted hover:bg-surface-alt hover:text-ink'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === 'notifications' && unreadNotificationsCount > 0 && (
                        <span
                          className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-white/20 text-white' : 'bg-surface-alt text-ink'
                          }`}
                        >
                          {unreadNotificationsCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Explicit active repository mode footer */}
      <div className="p-3 border-t border-border bg-surface-alt/50 space-y-2 text-xs">
        <div className="font-semibold text-ink">
          {isLocalDevMock ? 'Entorno Mock Local' : 'Adaptador HTTP Clean-Slate'}
        </div>
        <p className="text-ink-muted leading-snug">
          {isLocalDevMock
            ? 'Estado en memoria RAM (no persiste al recargar), sin cookies reales ni conexión a Zoho Catalyst / Firebase.'
            : repositoryModeLabel}
        </p>
        {isLocalDevMock && (
          <div className="flex items-center gap-1.5 pt-1">
            <select
              aria-label="Simular estado de repositorio"
              value={faultMode}
              onChange={e => void setSimulatedFaultMode(e.target.value as MockFaultMode)}
              className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs text-ink"
            >
              <option value="none">Estado: Datos mock</option>
              <option value="empty_workspace">Estado: Vacío (Empty)</option>
              <option value="network_error">Estado: Error de red</option>
            </select>
            <button
              type="button"
              onClick={() => void resetMockSeed()}
              title="Restaurar datos mock iniciales"
              aria-label="Restaurar datos mock iniciales"
              className="p-1.5 rounded border border-border bg-surface hover:bg-surface-alt text-ink cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-surface border-r border-border z-30">
        {renderSidebarBody()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="fixed inset-0 bg-ink/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-surface border-r border-border h-full z-50">
            {renderSidebarBody()}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 h-14 bg-surface border-b border-border px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegación"
              className="lg:hidden p-1.5 rounded-lg border border-border text-ink hover:bg-surface-alt cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-ink-muted hidden sm:block">
                {isLocalDevMock
                  ? 'VigorCore · Modo Desarrollo Local (Memoria RAM)'
                  : 'VigorCore · Adaptador HTTP Clean-Slate (/api/v1/*)'}
              </div>
              <h1 className="text-sm sm:text-base font-semibold text-ink truncate">
                {VIEW_TITLES[activeView]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Buscar en VigorCore"
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-xs text-ink-muted cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Buscar...</span>
            </button>

            {isLocalDevMock ? (
              <select
                aria-label="Selector de persona de desarrollo (no autenticación real)"
                value={activePersonaUid}
                onChange={e => switchDevPersona(e.target.value as DevPersonaKey)}
                className="bg-canvas border border-border rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink"
              >
                <option value="usr_athlete_01">Vista: Atleta (Camilo)</option>
                <option value="usr_admin_01">Vista: Admin (Laura)</option>
                <option value="usr_superadmin_01">Vista: Superadmin (Mateo)</option>
              </select>
            ) : (
              logoutSession &&
              loadStatus === 'ready' && (
                <button
                  type="button"
                  onClick={() => void logoutSession()}
                  aria-label="Cerrar sesión"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-xs font-medium text-ink cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Cerrar sesión</span>
                </button>
              )
            )}

            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'}
              className="p-1.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-ink cursor-pointer"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-5">
          {loadStatus === 'loading' && (
            <StatePanel
              mode="loading"
              title="Cargando espacio de trabajo local..."
              description={
                isLocalDevMock
                  ? 'Hidratando contratos Clean-Slate desde el repositorio mock en memoria.'
                  : 'Hidratando contratos Clean-Slate mediante GET /api/v1/athlete/workspace.'
              }
            />
          )}

          {loadStatus === 'error' && (
            <StatePanel
              mode="error"
              title="Error al cargar el espacio de trabajo"
              description={loadError ?? 'No se pudo obtener respuesta del repositorio.'}
              actionLabel="Reintentar carga"
              onAction={() => void reloadWorkspace()}
            />
          )}

          {loadStatus === 'ready' && workspace && (
            <>
              {workspace.profile.accountStatus === 'suspended' && (
                <InlineAlert tone="warning" title="Cuenta marcada como suspendida en mock">
                  En producción, Catalyst Auth bloquearía las mutaciones mediante sessionEpoch.
                </InlineAlert>
              )}
              {children}
            </>
          )}
        </main>
      </div>

      {/* Toast Notice */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-sm bg-surface border border-border rounded-xl shadow-lg px-4 py-3 flex items-center justify-between gap-3 text-sm"
        >
          <span
            className={
              toast.tone === 'error'
                ? 'text-danger font-medium'
                : toast.tone === 'info'
                  ? 'text-info font-medium'
                  : 'text-brand font-medium'
            }
          >
            {toast.message}
          </span>
          <button
            type="button"
            onClick={dismissToast}
            aria-label="Cerrar notificación"
            className="text-ink-muted hover:text-ink cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <GlobalSearchDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
};
