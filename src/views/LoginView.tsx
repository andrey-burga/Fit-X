/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Dedicated Public Authentication View (LoginView.tsx)
 * Embedded Zoho Catalyst Sign-In widget (`signIn(elementId)`) + HMAC Session Exchange,
 * Hosted Login secondary fallback, and Local Demo Mode.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { authBridge } from '../services/catalystClient';

const EMBEDDED_CONTAINER_ID = 'vigor-catalyst-auth-container';

function detectIframeHost(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export const LoginView: React.FC = () => {
  const {
    startDemoMode,
    completeCatalystSession,
    redirectPath,
    authError,
    showToast,
    navigate,
  } = useApp();

  const [isMounting, setIsMounting] = useState(true);
  const [isExchanging, setIsExchanging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mountNonce, setMountNonce] = useState(0);
  const isInIframe = useMemo(() => detectIframeHost(), []);

  const callbackTarget = useMemo(() => {
    if (redirectPath && redirectPath !== 'landing' && redirectPath !== 'login') {
      return `/auth/callback?next=${encodeURIComponent(`/${redirectPath}`)}`;
    }
    return '/auth/callback';
  }, [redirectPath]);

  const handleEmbeddedSuccess = useCallback(async () => {
    setIsExchanging(true);
    setErrorMessage(null);
    const res = await completeCatalystSession();
    if (!res.success) {
      setErrorMessage(res.error || 'No se pudo completar la sesión en Zoho Catalyst.');
      setIsExchanging(false);
    }
  }, [completeCatalystSession]);

  useEffect(() => {
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
          callbackTarget
        );
      } catch (err: any) {
        if (!active) return;
        setErrorMessage(
          err?.message || 'No se pudo inicializar el formulario embebido de Zoho Catalyst.'
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
  }, [callbackTarget, handleEmbeddedSuccess, mountNonce]);

  const handleHostedFallback = async () => {
    setErrorMessage(null);
    try {
      await authBridge.startHostedLogin(callbackTarget);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al redirigir a Hosted Login.');
    }
  };

  const handleOpenInNewTab = () => {
    if (typeof window === 'undefined') return;
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const handleLaunchDemo = () => {
    setErrorMessage(null);
    startDemoMode('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co');
    showToast('Modo Demostración activado como Camilo R.', 'success');
  };

  const visibleError = errorMessage || authError;

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 antialiased">
      {/* Background radial accent */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex items-center justify-center opacity-30">
        <div className="w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="mb-4 flex items-center justify-start">
          <button
            type="button"
            onClick={() => navigate('landing')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span>Volver a la página principal</span>
          </button>
        </div>

        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-on-primary shadow-lg shadow-primary/25 mb-3">
            <span className="material-symbols-outlined text-3xl">vital_signs</span>
          </div>
          <h1 className="font-headline-sm text-2xl sm:text-3xl font-black tracking-tight text-on-surface">
            VIGOR<span className="text-primary">CORE</span>
          </h1>
          <p className="font-label-sm text-sm text-on-surface-variant mt-1">
            Plataforma Privada de Alto Rendimiento, Nutrición y Fuerza
          </p>
        </div>

        {/* Redirect Notice Banner */}
        {redirectPath && (
          <div className="mb-4 p-3.5 bg-primary-container/15 border border-primary/30 rounded-xl text-xs text-on-surface flex items-center gap-2.5 shadow-xs">
            <span className="material-symbols-outlined text-primary text-lg shrink-0">lock</span>
            <div>
              <span className="font-semibold block text-primary">Acceso Restringido</span>
              Inicia sesión para continuar hacia la vista solicitada.
            </div>
          </div>
        )}

        {/* Error Alert */}
        {visibleError && (
          <div className="mb-4 p-3.5 bg-error-container/20 border border-error/30 rounded-xl text-xs text-error space-y-2.5">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-error text-lg shrink-0 mt-0.5">error</span>
              <div className="flex-1 font-medium">{visibleError}</div>
            </div>
            <div className="flex flex-wrap gap-2 pl-7">
              <button
                type="button"
                onClick={() => setMountNonce(n => n + 1)}
                className="px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-surface-container text-on-surface font-semibold text-[11px] hover:bg-surface-container transition-colors cursor-pointer"
              >
                Reintentar widget
              </button>
              {isInIframe ? (
                <button
                  type="button"
                  onClick={handleOpenInNewTab}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold text-[11px] hover:bg-amber-700 transition-colors cursor-pointer"
                >
                  Abrir en pestaña nueva
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleHostedFallback}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-semibold text-[11px] hover:bg-primary-container transition-colors cursor-pointer"
                >
                  Usar Hosted Login
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-surface-container shadow-xl overflow-hidden p-5 sm:p-7 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-lg">verified_user</span>
              </div>
              <div>
                <h2 className="text-sm font-bold text-on-surface">
                  Iniciar Sesión con Zoho Catalyst
                </h2>
                <p className="text-[11px] text-on-surface-variant">
                  Acceso directo embebido · Sesión HMAC HttpOnly
                </p>
              </div>
            </div>
            {!isInIframe && (
              <button
                type="button"
                onClick={handleHostedFallback}
                className="text-[11px] font-semibold text-primary hover:underline shrink-0 cursor-pointer"
              >
                Portal externo
              </button>
            )}
          </div>

          {/* Embedded Catalyst Sign-In Container */}
          <div className="relative rounded-2xl bg-surface-container-low/60 border border-surface-container overflow-hidden min-h-[410px]">
            {(isMounting || isExchanging) && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-container-lowest/85 backdrop-blur-xs p-6 text-center">
                <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                  progress_activity
                </span>
                <p className="text-xs font-semibold text-on-surface">
                  {isExchanging
                    ? 'Verificando sesión e hidratando tu espacio...'
                    : 'Cargando acceso seguro de Zoho Catalyst...'}
                </p>
              </div>
            )}
            <div
              id={EMBEDDED_CONTAINER_ID}
              className="w-full min-h-[410px]"
            />
          </div>

          {/* Demo Mode Quick Access */}
          <div className="pt-4 border-t border-surface-container/60 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[11px] text-on-surface-variant leading-snug text-center sm:text-left">
              Acceso exclusivo por invitación o cuenta autorizada de VigorCore.
            </p>
            <button
              type="button"
              onClick={handleLaunchDemo}
              disabled={isExchanging}
              className="w-full sm:w-auto shrink-0 py-2 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm text-primary">science</span>
              <span>Explorar en Modo Demo</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 text-center text-[11px] text-on-surface-variant/85">
          © 2026 AWD S.A.S. — VigorCore Performance Platform.
        </div>
      </div>
    </div>
  );
};
