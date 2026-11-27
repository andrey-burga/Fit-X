import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../layout/UserAvatar';
import { formatUserRoleLabel } from '../../utils/roleDisplay';
import { authBridge } from '../../services/catalystClient';

function detectIframeHost(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export const AuthModal: React.FC = () => {
  const {
    currentUser,
    isAuthenticated,
    isDemoMode,
    startDemoMode,
    logout,
    isLoggingOut,
    isAuthModalOpen,
    closeAuthModal,
    navigate,
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isInIframe = useMemo(() => detectIframeHost(), []);

  if (!isAuthModalOpen) return null;

  const handleCatalystHostedLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await authBridge.startHostedLogin('/auth/callback');
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'No se pudo iniciar la autenticación con Zoho Catalyst.'
      );
      setIsLoading(false);
    }
  };

  const handleOpenInNewTab = () => {
    if (typeof window === 'undefined') return;
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-inverse-surface/50 backdrop-blur-xs transition-opacity"
        onClick={closeAuthModal}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container overflow-hidden z-10 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-space-lg pb-space-md border-b border-surface-container/40 flex items-start justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold shadow-sm">
              <span className="material-symbols-outlined text-2xl">vital_signs</span>
            </div>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {isAuthenticated ? 'Perfil de Usuario' : 'Acceso a VigorCore'}
              </h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {isAuthenticated
                  ? 'Gestión de credenciales y sesión'
                  : 'Autenticación oficial con Zoho Catalyst'}
              </p>
            </div>
          </div>
          <button
            onClick={closeAuthModal}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            title="Cerrar"
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-space-lg overflow-y-auto">
          {isAuthenticated && currentUser ? (
            /* Authenticated User Profile Summary */
            <div className="flex flex-col gap-space-md">
              <div className="flex items-center gap-space-md p-space-md bg-surface-container-low rounded-xl border border-surface-container">
                <UserAvatar
                  name={currentUser.name}
                  avatarUrl={currentUser.avatarUrl}
                  sizeClassName="w-16 h-16"
                  className="rounded-full ring-2 ring-primary"
                />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-headline-sm text-lg font-bold text-on-surface">
                      {currentUser.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-fixed text-on-primary-fixed">
                      {formatUserRoleLabel(currentUser.role)}
                    </span>
                  </div>
                  <span className="text-body-sm text-on-surface-variant">{currentUser.email}</span>
                  <span className="text-label-sm text-on-surface-variant/80 mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-primary">verified</span>
                    Miembro desde {currentUser.joinedDate}
                  </span>
                </div>
              </div>

              {/* Status details */}
              <div className="grid grid-cols-2 gap-space-sm text-left">
                <div className="p-space-sm bg-surface-container-low rounded-lg">
                  <span className="text-[11px] text-on-surface-variant uppercase tracking-wider block font-semibold">
                    Zona Horaria
                  </span>
                  <span className="text-sm font-semibold text-on-surface flex items-center gap-1 mt-0.5">
                    <span className="material-symbols-outlined text-xs text-on-surface-variant">schedule</span>
                    {currentUser.location}
                  </span>
                </div>
                <div className="p-space-sm bg-surface-container-low rounded-lg">
                  <span className="text-[11px] text-on-surface-variant uppercase tracking-wider block font-semibold">
                    Persistencia
                  </span>
                  {isDemoMode ? (
                    <span className="text-xs font-semibold text-amber-700 flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs">storage</span>
                      Demostración local
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-primary flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs">cloud_done</span>
                      Zoho Catalyst NoSQL
                    </span>
                  )}
                </div>
              </div>

              {isDemoMode ? (
                <div className="p-space-sm bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-700 text-base shrink-0 mt-0.5">
                    info
                  </span>
                  <div>
                    <span className="font-semibold block mb-0.5">Sesión en Modo Demostración</span>
                    Tus cambios se guardan localmente en este navegador. Inicia sesión con Zoho Catalyst para sincronizar en la nube.
                  </div>
                </div>
              ) : (
                <div className="p-space-sm bg-primary-container/10 border border-primary/20 rounded-xl text-xs text-on-surface-variant flex items-start gap-2">
                  <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">
                    security
                  </span>
                  <span>
                    Autenticado con Zoho Catalyst Hosted Login. Sesión cifrada HttpOnly y datos aislados por tu UID.
                  </span>
                </div>
              )}

              {errorMessage && (
                <div className="p-space-sm bg-error-container/30 border border-error/30 rounded-xl text-error text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-2">
                {isDemoMode && isInIframe && (
                  <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-medium text-xs transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                    <span>Abrir en pestaña nueva para iniciar sesión</span>
                  </button>
                )}
                {isDemoMode && (
                  <button
                    type="button"
                    onClick={handleCatalystHostedLogin}
                    disabled={isLoading || isInIframe}
                    className="w-full py-2.5 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">cloud_sync</span>
                    <span>{isLoading ? 'Redirigiendo...' : 'Continuar con Zoho Catalyst'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeAuthModal();
                    navigate('perfil-atleta');
                  }}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-xs"
                >
                  <span className="material-symbols-outlined text-base">account_circle</span>
                  Gestionar Perfil &amp; Preferencias
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeAuthModal();
                    navigate('configuracion-nutricional');
                  }}
                  className="w-full py-2.5 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">tune</span>
                  Ver Ajustes Nutricionales
                </button>
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={async () => {
                    const res = await logout();
                    if (res.success) {
                      closeAuthModal();
                    }
                  }}
                  className="w-full py-2.5 px-4 bg-error-container/20 hover:bg-error-container/40 text-error rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  {isLoggingOut ? 'Cerrando sesión...' : 'Cerrar Sesión'}
                </button>
              </div>
            </div>
          ) : (
            /* Unauthenticated Zoho Catalyst Hosted Login Flow */
            <div className="flex flex-col gap-space-md">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Inicia sesión mediante el portal oficial de Zoho Catalyst Authentication para acceder a tus registros y sincronización en la nube.
              </p>

              {isInIframe && (
                <div className="p-space-sm bg-amber-500/10 border border-amber-500/35 rounded-xl text-xs text-on-surface space-y-2.5">
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-amber-600 text-base shrink-0 mt-0.5">
                      open_in_new
                    </span>
                    <div>
                      <span className="font-semibold block text-amber-800">
                        Preview en iFrame bloqueado por Zoho
                      </span>
                      <span className="text-on-surface-variant">
                        Hosted Login requiere navegación top-level fuera del iframe.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    <span>Abrir en pestaña nueva para iniciar sesión</span>
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="p-space-sm bg-error-container/30 border border-error/30 rounded-xl text-error text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleCatalystHostedLogin}
                disabled={isLoading || isInIframe}
                className="w-full py-3 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <span className={`material-symbols-outlined text-base ${isLoading ? 'animate-spin' : ''}`}>
                  {isLoading ? 'progress_activity' : 'passkey'}
                </span>
                <span>
                  {isLoading ? 'Redirigiendo...' : 'Continuar con Zoho Catalyst'}
                </span>
              </button>

              {/* Demo shortcut */}
              <div className="pt-3 border-t border-surface-container/60 space-y-2.5">
                <span className="text-[11px] text-on-surface-variant font-medium block text-center">
                  ¿Probando dentro del preview? Usa el sandbox local:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    startDemoMode('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co');
                    closeAuthModal();
                  }}
                  className="w-full py-2.5 px-3 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold rounded-xl border border-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-primary">science</span>
                  <span>Explorar en Modo Demo</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
