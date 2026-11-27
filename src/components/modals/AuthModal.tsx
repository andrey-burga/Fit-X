import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../layout/UserAvatar';
import { formatUserRoleLabel } from '../../utils/roleDisplay';
import { authBridge } from '../../services/catalystClient';

const EMBEDDED_CONTAINER_ID = 'vigor-catalyst-auth-container';

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
    completeCatalystSession,
    logout,
    isLoggingOut,
    isAuthModalOpen,
    closeAuthModal,
    navigate,
  } = useApp();

  const [isMounting, setIsMounting] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mountNonce, setMountNonce] = useState(0);
  const isInIframe = useMemo(() => detectIframeHost(), []);

  const handleEmbeddedSuccess = useCallback(async () => {
    setIsExchanging(true);
    setErrorMessage(null);
    const res = await completeCatalystSession();
    setIsExchanging(false);
    if (res.success) {
      closeAuthModal();
    } else {
      setErrorMessage(res.error || 'No se pudo completar el inicio de sesión en Catalyst.');
    }
  }, [closeAuthModal, completeCatalystSession]);

  useEffect(() => {
    if (!isAuthModalOpen || (isAuthenticated && !isDemoMode)) {
      return;
    }

    let active = true;
    const mountWidget = async () => {
      setIsMounting(true);
      setErrorMessage(null);
      try {
        await authBridge.mountEmbeddedSignIn(
          EMBEDDED_CONTAINER_ID,
          async () => {
            if (!active) return;
            await handleEmbeddedSuccess();
          },
          '/auth/callback'
        );
      } catch (err: any) {
        if (!active) return;
        setErrorMessage(
          err?.message || 'No se pudo inicializar el acceso embebido de Zoho Catalyst.'
        );
      } finally {
        if (active) {
          setIsMounting(false);
        }
      }
    };

    void mountWidget();
    return () => {
      active = false;
    };
  }, [isAuthModalOpen, isAuthenticated, isDemoMode, handleEmbeddedSuccess, mountNonce]);

  if (!isAuthModalOpen) return null;

  const handleHostedFallback = async () => {
    setErrorMessage(null);
    try {
      await authBridge.startHostedLogin('/auth/callback');
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'No se pudo iniciar la redirección con Zoho Catalyst.'
      );
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
      <div className="relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container overflow-hidden z-10 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-space-lg pb-space-md border-b border-surface-container/40 flex items-start justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold shadow-sm">
              <span className="material-symbols-outlined text-2xl">vital_signs</span>
            </div>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                {isAuthenticated && !isDemoMode ? 'Perfil de Usuario' : 'Acceso a VigorCore'}
              </h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {isAuthenticated && !isDemoMode
                  ? 'Gestión de credenciales y sesión'
                  : 'Inicio de sesión embebido con Zoho Catalyst'}
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
        <div className="p-space-lg overflow-y-auto space-y-4">
          {isAuthenticated && currentUser && (
            <div className="flex flex-col gap-space-md">
              <div className="flex items-center gap-space-md p-space-md bg-surface-container-low rounded-xl border border-surface-container">
                <UserAvatar
                  name={currentUser.name}
                  avatarUrl={currentUser.avatarUrl}
                  sizeClassName="w-14 h-14"
                  className="rounded-full ring-2 ring-primary"
                />
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-headline-sm text-base font-bold text-on-surface truncate">
                      {currentUser.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-fixed text-on-primary-fixed shrink-0">
                      {formatUserRoleLabel(currentUser.role)}
                    </span>
                  </div>
                  <span className="text-body-sm text-on-surface-variant truncate">{currentUser.email}</span>
                  <span className="text-label-sm text-on-surface-variant/80 mt-0.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-primary">
                      {isDemoMode ? 'science' : 'cloud_done'}
                    </span>
                    {isDemoMode ? 'Demostración local' : 'Zoho Catalyst NoSQL'}
                  </span>
                </div>
              </div>

              {!isDemoMode && (
                <>
                  <div className="p-space-sm bg-primary-container/10 border border-primary/20 rounded-xl text-xs text-on-surface-variant flex items-start gap-2">
                    <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">
                      security
                    </span>
                    <span>
                      Autenticado con Zoho Catalyst. Sesión cifrada HttpOnly y datos aislados por tu UID.
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
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
                </>
              )}
            </div>
          )}

          {/* Embedded Sign-In for unauthenticated or Demo upgrade */}
          {(!isAuthenticated || isDemoMode) && (
            <div className="space-y-4">
              {errorMessage && (
                <div className="p-3 bg-error-container/25 border border-error/30 rounded-xl text-error text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-base shrink-0 mt-0.5">error</span>
                    <span className="font-medium">{errorMessage}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => setMountNonce(n => n + 1)}
                      className="px-2.5 py-1 rounded-lg bg-surface-container-lowest border border-surface-container text-on-surface font-semibold text-[11px] cursor-pointer"
                    >
                      Reintentar
                    </button>
                    {isInIframe ? (
                      <button
                        type="button"
                        onClick={handleOpenInNewTab}
                        className="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold text-[11px] cursor-pointer"
                      >
                        Abrir en pestaña nueva
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleHostedFallback}
                        className="px-2.5 py-1 rounded-lg bg-primary text-on-primary font-semibold text-[11px] cursor-pointer"
                      >
                        Usar Hosted Login
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="relative rounded-2xl bg-surface-container-low/60 border border-surface-container overflow-hidden min-h-[400px]">
                {(isMounting || isExchanging) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-surface-container-lowest/85 backdrop-blur-xs p-4 text-center">
                    <span className="material-symbols-outlined text-2xl text-primary animate-spin">
                      progress_activity
                    </span>
                    <span className="text-xs font-semibold text-on-surface">
                      {isExchanging
                        ? 'Activando sesión cifrada...'
                        : 'Cargando acceso embebido...'}
                    </span>
                  </div>
                )}
                <div
                  id={EMBEDDED_CONTAINER_ID}
                  className="w-full min-h-[400px]"
                />
              </div>

              <div className="pt-2 border-t border-surface-container/60 flex flex-col gap-2">
                <p className="text-[11px] text-on-surface-variant text-center">
                  Acceso exclusivo por invitación o cuenta autorizada de VigorCore.
                </p>
                {!isDemoMode && (
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
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
