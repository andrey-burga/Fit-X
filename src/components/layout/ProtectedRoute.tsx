/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Reusable ProtectedRoute Guard Component
 * Enforces authentication before rendering private views.
 * Shows loading spinner during Firebase auth initialization.
 * Automatically preserves intended redirect path upon unauthenticated access.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { LoginView } from '../../views/LoginView';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { authStatus, authError, isAuthenticated, logout, isLoggingOut } = useApp();

  // 1. Initializing state: Do not reveal ANY private content while checking session
  if (authStatus === 'initializing') {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-on-surface antialiased">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-on-primary shadow-lg shadow-primary/20 animate-pulse">
            <span className="material-symbols-outlined text-4xl">vital_signs</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">VIGOR CORE</h1>
            <p className="text-xs text-on-surface-variant mt-1">Verificando sesión segura y credenciales...</p>
          </div>
          <div className="w-48 h-1 bg-surface-container-high rounded-full overflow-hidden mt-2">
            <div className="w-full h-full bg-primary animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // 2. Fatal Auth Error / Failed Sign-Out Lockdown
  if (authStatus === 'error') {
    const isLogoutFailure = authError?.toLowerCase().includes('cerrar sesión') || false;

    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-on-surface antialiased">
        <div className="p-6 max-w-md w-full bg-surface-container-lowest border border-error/30 rounded-2xl shadow-xl text-center">
          <div className="w-12 h-12 rounded-xl bg-error-container/20 text-error flex items-center justify-center mx-auto mb-3">
            <span className="material-symbols-outlined text-2xl">
              {isLogoutFailure ? 'lock' : 'error'}
            </span>
          </div>
          <h2 className="text-lg font-bold text-on-surface">
            {isLogoutFailure ? 'Bloqueo Preventivo: Cierre de Sesión Incompleto' : 'Error de Autenticación'}
          </h2>
          <p className="text-xs text-on-surface-variant mt-2 mb-4 leading-relaxed">
            {authError || 'No se pudo verificar el estado de la sesión de Firebase.'}
          </p>

          <div className="flex flex-col gap-2">
            {isLogoutFailure ? (
              <>
                <button
                  type="button"
                  onClick={() => logout()}
                  disabled={isLoggingOut}
                  className="w-full py-2.5 px-4 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:bg-primary-container transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  id="btn-retry-logout"
                >
                  <span className={`material-symbols-outlined text-sm ${isLoggingOut ? 'animate-spin' : ''}`}>
                    {isLoggingOut ? 'progress_activity' : 'lock_reset'}
                  </span>
                  {isLoggingOut ? 'Cerrando sesión en Firebase...' : 'Reintentar Cierre de Sesión'}
                </button>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="w-full py-2 px-4 bg-surface-container-high text-on-surface text-xs font-semibold rounded-lg hover:bg-surface-container-highest transition-colors"
                >
                  Recargar Aplicación
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full py-2 px-4 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:bg-primary-container transition-colors"
              >
                Reintentar Conexión
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. Unauthenticated: Render dedicated public LoginView
  if (authStatus === 'unauthenticated' || !isAuthenticated) {
    return <LoginView />;
  }

  // 4. Authenticated: Render protected private view
  return <>{children}</>;
};
