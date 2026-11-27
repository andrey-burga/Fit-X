/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Dedicated Public Authentication View (LoginView.tsx)
 * Zoho Catalyst Hosted Login (top-level), iFrame detection break-out, and Local Demo Mode.
 */

import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { authBridge } from '../services/catalystClient';

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
    redirectPath,
    authError,
    showToast,
    navigate,
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isInIframe = useMemo(() => detectIframeHost(), []);

  const handleCatalystHostedLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextTarget =
        redirectPath && redirectPath !== 'landing' && redirectPath !== 'login'
          ? `/auth/callback?next=${encodeURIComponent(`/${redirectPath}`)}`
          : '/auth/callback';
      await authBridge.startHostedLogin(nextTarget);
    } catch (err: any) {
      setErrorMessage(
        err?.message || 'No se pudo iniciar la redirección segura con Zoho Catalyst.'
      );
      setIsLoading(false);
    }
  };

  const handleOpenInNewTab = () => {
    if (typeof window === 'undefined') return;
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const handleLaunchDemo = (
    demoRole: 'Atleta Pro' | 'Nutricionista',
    name: string,
    demoEmail: string
  ) => {
    setIsLoading(true);
    setErrorMessage(null);
    setTimeout(() => {
      startDemoMode(demoRole, name, demoEmail);
      setIsLoading(false);
      showToast(`Modo Demostración activado como ${name}`, 'success');
    }, 150);
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
              La ruta solicitada requiere autenticación. Inicia sesión para continuar hacia tu destino.
            </div>
          </div>
        )}

        {/* Error Alert */}
        {visibleError && (
          <div className="mb-4 p-3.5 bg-error-container/20 border border-error/30 rounded-xl text-xs text-error flex items-start gap-2.5">
            <span className="material-symbols-outlined text-error text-lg shrink-0 mt-0.5">error</span>
            <div className="flex-1 font-medium">{visibleError}</div>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-surface-container shadow-xl overflow-hidden p-6 sm:p-8 space-y-6">
          {/* Hosted Login Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-xl">verified_user</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-on-surface">
                  Acceso Seguro con Zoho Catalyst
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                  Serás redirigido al portal oficial de autenticación de VigorCore para validar tu cuenta y emitir una sesión cifrada.
                </p>
              </div>
            </div>

            {isInIframe && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/35 rounded-xl text-xs text-on-surface space-y-3">
                <div className="flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">
                    open_in_new
                  </span>
                  <div>
                    <span className="font-bold block text-amber-800">
                      Vista previa en iFrame detectada
                    </span>
                    <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                      Por seguridad, Zoho Catalyst Authentication bloquea el inicio de sesión dentro de iframes embebidos. Abre la aplicación en una pestaña nueva para iniciar sesión, o usa el Modo Demo aquí mismo.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenInNewTab}
                  className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                  <span>Abrir en pestaña nueva para iniciar sesión</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCatalystHostedLogin}
              disabled={isLoading || isInIframe}
              className="w-full py-3.5 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
            >
              <span className="material-symbols-outlined text-lg">
                {isLoading ? 'progress_activity' : 'passkey'}
              </span>
              <span>
                {isLoading ? 'Redirigiendo a Zoho Catalyst...' : 'Continuar con Zoho Catalyst'}
              </span>
            </button>

            <div className="flex items-center gap-1.5 justify-center text-[11px] text-on-surface-variant font-medium">
              <span className="material-symbols-outlined text-xs text-primary">shield_lock</span>
              <span>Hosted Login oficial · Navegación top-level · Sesión HMAC HttpOnly</span>
            </div>
          </div>

          {/* Local Demo Mode Section */}
          <div className="pt-5 border-t border-surface-container/60">
            <div className="p-4 bg-surface-container-low rounded-xl border border-surface-container space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm">science</span>
                </div>
                <span className="font-semibold text-xs text-on-surface">
                  Entorno de demostración local (compatible con iFrame)
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Explora todas las vistas privadas (nutrición, rutinas, analítica ACWR y registro en vivo) sin salir del preview. Los datos permanecen en la memoria de este navegador.
              </p>

              <button
                type="button"
                onClick={() => handleLaunchDemo('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co')}
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-surface-container-lowest hover:bg-surface-container text-on-surface rounded-xl text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
              >
                <span className="material-symbols-outlined text-base text-primary">play_circle</span>
                <span>Explorar en Modo Demo</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLaunchDemo('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co')}
                  disabled={isLoading}
                  className="py-2 px-3 bg-surface-container-lowest hover:bg-surface-container text-on-surface rounded-lg text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <span className="material-symbols-outlined text-xs text-primary">person</span>
                  <span>Camilo (Atleta)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLaunchDemo('Nutricionista', 'Dra. Sofía V. (Demo)', 'sofia@vigor.co')}
                  disabled={isLoading}
                  className="py-2 px-3 bg-surface-container-lowest hover:bg-surface-container text-on-surface rounded-lg text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <span className="material-symbols-outlined text-xs text-secondary">medical_services</span>
                  <span>Sofía (Especialista)</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-[11px] text-on-surface-variant/85 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-primary">verified_user</span>
              Acceso protegido por sesión
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-primary">database</span>
              Aislamiento de datos por cuenta
            </span>
          </div>
          <p className="text-on-surface-variant">
            © 2026 AWD S.A.S. — Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  );
};
