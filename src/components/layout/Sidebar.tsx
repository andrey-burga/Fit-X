import React from 'react';
import { useApp } from '../../context/AppContext';
import { NavigationPath } from '../../types';
import { UserAvatar } from './UserAvatar';
import { formatUserRoleLabel } from '../../utils/roleDisplay';

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
  { id: 'planificador-mesociclo', label: 'Planificador & Mesociclos', icon: 'event_note' },
  { id: 'rutina-de-entrenamiento', label: 'Rutina de Entrenamiento', icon: 'fitness_center' },
  { id: 'registro-de-entrenamiento', label: 'Registro de Entrenamiento', icon: 'format_list_bulleted' },
  { id: 'cardio-y-hiit', label: 'Cardio y HIIT', icon: 'directions_run' },
  { id: 'progreso-del-entrenamiento', label: 'Progreso del Entrenamiento', icon: 'trending_up' },
];

const accountNav: NavItem[] = [
  { id: 'perfil-atleta', label: 'Perfil del Atleta', icon: 'account_circle' },
];

export const Sidebar: React.FC = () => {
  const {
    currentPath,
    navigate,
    isMobileSidebarOpen,
    closeMobileSidebar,
    currentUser,
    currentUserRole,
    isAuthenticated,
    isDemoMode,
    openAuthModal,
    logout,
    isLoggingOut,
  } = useApp();

  const handleNavClick = (path: NavigationPath) => {
    navigate(path);
  };

  const renderNavSection = (title: string, items: NavItem[], icon?: string) => (
    <>
      <div className="px-space-sm pt-space-md pb-space-xs font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold flex items-center gap-1.5">
        {icon && <span className="material-symbols-outlined text-sm text-primary">{icon}</span>}
        <span>{title}</span>
      </div>
      {items.map(item => {
        const isActive = currentPath === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => handleNavClick(item.id)}
            className={`w-full text-left px-space-sm py-2.5 rounded-lg font-body-md text-body-md transition-colors flex items-center gap-space-sm cursor-pointer ${
              isActive
                ? 'bg-primary text-on-primary font-semibold shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            {item.icon && (
              <span className={`material-symbols-outlined text-lg ${isActive ? 'text-on-primary' : 'text-on-surface-variant'}`}>
                {item.icon}
              </span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </>
  );

  const content = (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-col">
        {/* Brand Lockup aligned with Public Landing */}
        <div className="px-space-lg py-space-md flex items-center justify-between border-b border-surface-container/60">
          <button
            type="button"
            onClick={() => handleNavClick('dashboard-nutricional')}
            className="flex items-center gap-space-sm text-left cursor-pointer rounded-lg py-1 pr-2 hover:opacity-90 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold shadow-xs shrink-0">
              <span className="material-symbols-outlined text-xl">vital_signs</span>
            </div>
            <div className="flex flex-col">
              <span className="font-landing-display text-base text-on-surface font-bold tracking-tight leading-tight">
                VigorCore
              </span>
              <span className="text-[11px] text-on-surface-variant font-normal leading-tight">
                Nutrición y fuerza
              </span>
            </div>
          </button>
        </div>

        {/* Account Context & Return to Landing */}
        <div className="mx-space-lg mt-space-md mb-space-xs p-space-sm bg-surface-container-low rounded-xl border border-surface-container/60 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-on-surface font-medium flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-primary">
                {isDemoMode ? 'science' : 'cloud_done'}
              </span>
              <span>{isDemoMode ? 'Demostración local' : 'Cuenta sincronizada'}</span>
            </span>
            <span className="text-[11px] font-mono text-on-surface-variant">UTC-5</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-surface-container/70">
            <span className="text-[11px] text-on-surface-variant">Bogotá · Datos en SI</span>
            <button
              type="button"
              onClick={() => handleNavClick('landing')}
              className="text-[11px] font-semibold text-primary hover:underline cursor-pointer flex items-center gap-0.5 shrink-0"
            >
              <span>Inicio público</span>
              <span className="material-symbols-outlined text-xs">north_east</span>
            </button>
          </div>
        </div>

        {/* Navigation Lists */}
        <nav aria-label="Navegación privada principal" className="flex flex-col px-space-md gap-0.5 pb-4">
          {renderNavSection('Nutrición', nutritionNav)}
          {renderNavSection('Entrenamiento', workoutNav)}
          {renderNavSection('Cuenta y perfil', accountNav)}

          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') &&
            renderNavSection(
              'Administración',
              [{ id: 'admin-usuarios', label: 'Gestión de Usuarios', icon: 'manage_accounts' }],
              'shield_person'
            )}
        </nav>
      </div>

      {/* User Footer Profile */}
      <div className="p-space-md m-space-sm bg-surface-container-low rounded-xl flex items-center justify-between border border-surface-container/60 gap-2">
        <button
          type="button"
          onClick={() => {
            if (isAuthenticated) {
              navigate('perfil-atleta');
            } else {
              openAuthModal();
            }
          }}
          className="flex items-center gap-space-sm overflow-hidden text-left cursor-pointer hover:opacity-85 transition-opacity min-w-0 flex-1 rounded-lg"
          title={isAuthenticated ? `Abrir perfil de ${currentUser?.name}` : 'Acceder a tu cuenta'}
        >
          {isAuthenticated && currentUser ? (
            <>
              <UserAvatar
                name={currentUser.name}
                avatarUrl={currentUser.avatarUrl}
                sizeClassName="w-9 h-9"
              />
              <div className="flex flex-col truncate min-w-0">
                <span className="font-label-md text-label-md font-semibold text-on-surface truncate">
                  {currentUser.name}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {formatUserRoleLabel(currentUser.role)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0">
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
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              if (isAuthenticated) {
                navigate('perfil-atleta');
              } else {
                openAuthModal();
              }
            }}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-colors cursor-pointer"
            type="button"
            aria-label="Gestión de perfil"
            title="Gestión de perfil"
          >
            <span className="material-symbols-outlined text-lg">manage_accounts</span>
          </button>
          <button
            onClick={logout}
            disabled={isLoggingOut}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-error-container/30 hover:text-error transition-colors disabled:opacity-50 cursor-pointer"
            type="button"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-72 bg-surface-container-lowest border-r border-surface-container/60 z-50 flex-col overflow-y-auto">
        {content}
      </aside>

      {/* Mobile Drawer Backdrop and Drawer */}
      {isMobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Menú de navegación">
          <div
            className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
            onClick={closeMobileSidebar}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-surface-container-lowest shadow-xl z-10 overflow-y-auto">
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={closeMobileSidebar}
                aria-label="Cerrar menú de navegación"
                className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container cursor-pointer"
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
