/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — AcceptInvitationView (Increment 7D)
 * Secure redemption view for administrative and athlete invitations.
 * Enforces email verification and exact email matching against the SHA-256 token.
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { acceptInvitation } from '../services/adminUserService';

export const AcceptInvitationView: React.FC = () => {
  const {
    currentUser,
    isAuthenticated,
    openAuthModal,
    navigate,
    refreshUserClaims,
    showToast,
  } = useApp();

  const [inviteId, setInviteId] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [redeemedRole, setRedeemedRole] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extract params from hash or query
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      const queryIdx = hash.indexOf('?');
      let params: URLSearchParams;
      if (queryIdx !== -1) {
        params = new URLSearchParams(hash.substring(queryIdx + 1));
      } else {
        params = new URLSearchParams(window.location.search);
      }

      const inv = params.get('inviteId') || '';
      const tok = params.get('token') || '';
      setInviteId(inv);
      setToken(tok);
    }
  }, []);

  const handleRedeem = async () => {
    if (!inviteId || !token) {
      setErrorMessage('Enlace de invitación incompleto o inválido.');
      return;
    }
    if (!isAuthenticated || !currentUser) {
      openAuthModal();
      return;
    }
    if (!currentUser.emailVerified) {
      setErrorMessage('Tu correo electrónico no se encuentra verificado. Por políticas de seguridad, confirma tu correo antes de canjear la invitación.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await acceptInvitation(inviteId, token);
      setRedeemedRole(result.assignedRole);
      showToast(result.message, 'success');
      await refreshUserClaims();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al canjear la invitación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-space-md text-on-surface">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-2xl p-space-xl border border-surface-container shadow-xl flex flex-col gap-space-lg text-center">
        {/* Brand Lockup */}
        <div className="flex flex-col items-center gap-space-xs">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-on-primary font-bold shadow-md">
            <span className="material-symbols-outlined text-2xl">mark_email_read</span>
          </div>
          <h1 className="font-headline-md text-headline-md font-bold tracking-tight mt-2">
            Invitación a VigorCore
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Has recibido una invitación para unirte con credenciales autorizadas a la plataforma.
          </p>
        </div>

        {/* State Banners */}
        {errorMessage && (
          <div className="p-space-md rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs text-left dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300">
            <span className="font-bold block mb-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">error</span>
              No se pudo canjear la invitación
            </span>
            {errorMessage}
          </div>
        )}

        {redeemedRole ? (
          <div className="flex flex-col gap-space-md items-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center dark:bg-emerald-950/50 dark:text-emerald-400">
              <span className="material-symbols-outlined text-3xl">verified</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">¡Invitación Canjeada con Éxito!</h2>
              <p className="text-xs text-on-surface-variant mt-1">
                Se te ha asignado el rol oficial de <span className="font-bold text-primary">[{redeemedRole}]</span>.
              </p>
            </div>
            <button
              onClick={() => navigate(redeemedRole === 'athlete' ? 'dashboard-nutricional' : 'admin-usuarios')}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-body-md shadow-sm hover:bg-primary/90 transition-all mt-2"
            >
              Ir a mi Panel
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-space-md">
            {/* Parameters verification */}
            <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container flex flex-col gap-1 text-left text-xs">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">ID de Invitación:</span>
                <span className="font-mono text-on-surface">{inviteId || '(no detectado)'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Estado del Token:</span>
                <span className={token ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'}>
                  {token ? 'Token presente' : 'Token faltante'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Sesión actual:</span>
                <span className="font-semibold text-on-surface">
                  {isAuthenticated && currentUser ? currentUser.email : 'Sin iniciar sesión'}
                </span>
              </div>
            </div>

            {!isAuthenticated ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-on-surface-variant">
                  Debes iniciar sesión con el correo al que fue enviada la invitación para validarla.
                </p>
                <button
                  onClick={openAuthModal}
                  className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-body-md shadow-sm hover:bg-primary/90 transition-all"
                >
                  Iniciar Sesión para Canjear
                </button>
              </div>
            ) : !currentUser?.emailVerified ? (
              <div className="p-space-md rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs text-left dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300">
                <span className="font-bold block mb-1">Verificación requerida</span>
                Para evitar suplantación de identidad, debes verificar tu correo ({currentUser?.email}) antes de canjear privilegios. Revisa tu buzón de entrada.
              </div>
            ) : (
              <button
                onClick={handleRedeem}
                disabled={loading || !inviteId || !token}
                className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-semibold text-body-md shadow-sm hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                    Validando token con backend...
                  </>
                ) : (
                  'Aceptar y Canjear Invitación'
                )}
              </button>
            )}

            <button
              onClick={() => navigate('dashboard-nutricional')}
              className="text-xs text-on-surface-variant hover:text-on-surface underline mt-1"
            >
              Volver a la página principal
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
