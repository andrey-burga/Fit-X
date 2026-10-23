import React from 'react';
import { useApp } from '../../context/AppContext';
import { NavigationPath } from '../../types';

interface NavItem {
  id: NavigationPath;
  label: string;
  icon?: string;
}

const nutritionNav: NavItem[] = [
  { id: 'dashboard-nutricional', label: 'Dashboard Nutricional', icon: 'analytics' },
  { id: 'configuracion-nutricional', label: 'Configuración', icon: 'tune' },
  { id: 'menu-semanal', label: 'Menú Semanal', icon: 'calendar_view_week' },
  { id: 'registro-de-comidas', label: 'Registro de Comidas', icon: 'restaurant' },
  { id: 'registro-diario', label: 'Registro Diario', icon: 'edit_calendar' },
  { id: 'lista-de-compras', label: 'Lista de Compras', icon: 'shopping_cart' },
  { id: 'sustituciones', label: 'Sustituciones', icon: 'swap_horiz' },
  { id: 'guia-y-ajustes', label: 'Guía y Ajustes', icon: 'menu_book' },
];

const workoutNav: NavItem[] = [
  { id: 'rutina-de-entrenamiento', label: 'Rutina de Entrenamiento', icon: 'fitness_center' },
  { id: 'registro-de-entrenamiento', label: 'Registro de Entrenamiento', icon: 'format_list_bulleted' },
  { id: 'cardio-y-hiit', label: 'Cardio y HIIT', icon: 'directions_run' },
  { id: 'progreso-del-entrenamiento', label: 'Progreso del Entrenamiento', icon: 'trending_up' },
];

export const Sidebar: React.FC = () => {
  const { currentPath, navigate, isMobileSidebarOpen, closeMobileSidebar, currentUser, isAuthenticated, isDemoMode, openAuthModal } = useApp();

  const handleNavClick = (path: NavigationPath) => {
    navigate(path);
  };

  const content = (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-col">
        {/* Brand Lockup */}
        <div className="p-space-lg flex items-center justify-between border-b border-surface-container/40">
          <div className="flex items-center gap-space-sm cursor-pointer" onClick={() => handleNavClick('dashboard-nutricional')}>
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold shadow-sm">
              <span className="material-symbols-outlined text-xl">vital_signs</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
                Vigor Core
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant font-normal">
                Personal Health SaaS
              </span>
            </div>
          </div>
          <span className="flex h-2 w-2 rounded-full bg-primary ring-4 ring-primary-fixed" title="Online Telemetry" />
        </div>

        {/* Database & Timezone Status */}
        <div className="mx-space-lg my-space-md p-space-sm bg-surface-container-low rounded-lg flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-sm text-primary">sync_saved_locally</span>
              {isDemoMode ? 'Sandbox' : 'Conectado'}
            </span>
            {isDemoMode ? (
              <span className="font-label-sm text-[11px] bg-amber-100 text-amber-900 border border-amber-300 px-space-xs py-0.5 rounded-full font-semibold shadow-xs flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Demo (Local)
              </span>
            ) : (
              <span className="font-label-sm text-[11px] bg-surface-container-lowest text-primary px-space-xs py-0.5 rounded-full font-semibold shadow-xs flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Firestore Live
              </span>
            )}
          </div>
          <span className="font-label-sm text-label-sm text-on-surface-variant/80 flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-xs text-on-surface-variant">schedule</span>
            Bogotá (UTC-5)
          </span>
        </div>

        {/* Navigation Lists */}
        <nav className="flex flex-col px-space-md gap-space-xs pb-4">
          <div className="px-space-sm pt-space-sm pb-space-xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Nutrición
          </div>
          {nutritionNav.map(item => {
            const isActive = currentPath === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full text-left px-space-sm py-2 rounded-lg font-body-md text-body-md transition-all flex items-center gap-space-sm ${
                  isActive
                    ? 'bg-primary text-on-primary font-medium shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                {item.icon && (
                  <span className={`material-symbols-outlined text-lg ${isActive ? 'text-on-primary' : 'text-on-surface-variant'}`}>
                    {item.icon}
                  </span>
                )}
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="px-space-sm pt-space-md pb-space-xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Entrenamiento
          </div>
          {workoutNav.map(item => {
            const isActive = currentPath === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full text-left px-space-sm py-2 rounded-lg font-body-md text-body-md transition-all flex items-center gap-space-sm ${
                  isActive
                    ? 'bg-primary text-on-primary font-medium shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                {item.icon && (
                  <span className={`material-symbols-outlined text-lg ${isActive ? 'text-on-primary' : 'text-on-surface-variant'}`}>
                    {item.icon}
                  </span>
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* User Footer Profile */}
      <div className="p-space-md m-space-sm bg-surface-container-low rounded-xl flex items-center justify-between border border-surface-container/50">
        <div
          className="flex items-center gap-space-sm overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
          onClick={openAuthModal}
          title="Ver perfil y cambiar usuario"
        >
          {isAuthenticated && currentUser ? (
            <>
              <img
                alt={currentUser.name}
                className="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-primary"
                src={currentUser.avatarUrl}
              />
              <div className="flex flex-col truncate">
                <span className="font-label-md text-label-md font-semibold text-on-surface truncate">
                  {currentUser.name}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {currentUser.email}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-xl">account_circle</span>
              </div>
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  Iniciar Sesión
                </span>
                <span className="font-label-sm text-[11px] text-on-surface-variant">
                  Acceder a tu cuenta
                </span>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={openAuthModal}
          className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-colors"
          type="button"
          title="Gestión de cuenta"
        >
          <span className="material-symbols-outlined text-lg">manage_accounts</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-72 bg-surface-container-lowest shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-50 flex-col overflow-y-auto">
        {content}
      </aside>

      {/* Mobile Drawer Backdrop and Drawer */}
      {isMobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
            onClick={closeMobileSidebar}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-surface-container-lowest shadow-xl z-10 overflow-y-auto">
            <div className="absolute top-2 right-2">
              <button
                onClick={closeMobileSidebar}
                className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {content}
          </div>
        </div>
      )}
    </>
  );
};
