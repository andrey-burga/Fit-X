/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Email Verification Required View (EmailVerificationScreen.tsx)
 * Blocks private Firestore storage access until athlete verifies email address.
 * Conforms to Cloud Firestore ABAC security rules (request.auth.token.email_verified == true).
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export const EmailVerificationScreen: React.FC = () => {
  const {
    unverifiedEmail,
    checkEmailVerification,
    sendVerificationEmail,
    logout,
    startDemoMode,
    isLoggingOut,
  } = useApp();

  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleCheck = async () => {
    setIsChecking(true);
    setFeedback(null);
    try {
      const res = await checkEmailVerification();
      if (!res.verified) {
        setFeedback({
          type: 'info',
          message: res.error || 'Aún no detectamos la verificación. Por favor revisa tu bandeja de entrada o carpeta de spam y haz clic en el enlace.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Error al comprobar estado de verificación.',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setIsResending(true);
    setFeedback(null);
    try {
      const res = await sendVerificationEmail();
      if (res.success) {
        setFeedback({
          type: 'success',
          message: '¡Correo de verificación reenviado! Revisa tu bandeja de entrada y spam.',
        });
        setResendCooldown(30);
        const timer = setInterval(() => {
          setResendCooldown(prev => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'No se pudo reenviar el correo.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Error al reenviar correo.',
      });
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 antialiased text-on-surface">
      {/* Background radial accent */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex items-center justify-center opacity-30">
        <div className="w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-on-primary shadow-lg shadow-primary/25 mb-3">
            <span className="material-symbols-outlined text-3xl">mark_email_unread</span>
          </div>
          <h1 className="font-headline-sm text-2xl font-black tracking-tight text-on-surface">
            VIGOR<span className="text-primary">CORE</span>
          </h1>
          <p className="font-label-sm text-xs text-on-surface-variant mt-1">
            Plataforma Privada de Rendimiento y Nutrición
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-surface-container shadow-xl overflow-hidden p-6 sm:p-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-container/20 border border-primary/30 text-primary text-[11px] font-semibold mb-4">
            <span className="material-symbols-outlined text-sm">security</span>
            <span>Verificación de Identidad Requerida</span>
          </div>

          <h2 className="text-xl font-bold text-on-surface mb-2 tracking-tight">
            Confirma tu correo electrónico
          </h2>

          <p className="text-xs text-on-surface-variant leading-relaxed mb-4">
            Hemos enviado un enlace de confirmación a tu dirección de correo electrónico:
          </p>

          <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container mb-4 flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-lg shrink-0">mail</span>
            <span className="text-sm font-bold text-on-surface truncate">
              {unverifiedEmail || 'tu@correo.com'}
            </span>
          </div>

          <div className="p-3.5 bg-surface-container-low/70 rounded-xl border border-surface-container/60 text-[11px] text-on-surface-variant leading-relaxed mb-5">
            <span className="font-semibold text-on-surface block mb-1">
              Seguridad Zero-Trust y Cloud Firestore ABAC:
            </span>
            Las reglas de seguridad de VigorCore exigen que tu correo esté verificado antes de aprovisionar tu base de datos privada en Cloud Firestore (<code className="text-primary font-mono text-[10px]">users/&#123;uid&#125;</code>). Esto garantiza que únicamente tú puedas leer o escribir tus registros deportivos.
          </div>

          {/* Feedback alert */}
          {feedback && (
            <div
              className={`mb-4 p-3 rounded-xl text-xs flex items-start gap-2 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
                  : feedback.type === 'error'
                  ? 'bg-error-container/20 border-error/30 text-error'
                  : 'bg-primary-container/20 border-primary/30 text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-base shrink-0 mt-0.5">
                {feedback.type === 'success' ? 'check_circle' : feedback.type === 'error' ? 'error' : 'info'}
              </span>
              <div className="flex-1 font-medium">{feedback.message}</div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleCheck}
              disabled={isChecking}
              className="w-full py-3 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              id="btn-check-email-verification"
            >
              <span className={`material-symbols-outlined text-lg ${isChecking ? 'animate-spin' : ''}`}>
                {isChecking ? 'progress_activity' : 'verified'}
              </span>
              <span>{isChecking ? 'Comprobando estado...' : 'Ya verifiqué mi correo (Comprobar)'}</span>
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || resendCooldown > 0}
              className="w-full py-2.5 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl font-semibold text-xs border border-surface-container transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              id="btn-resend-verification-email"
            >
              <span className={`material-symbols-outlined text-sm ${isResending ? 'animate-spin' : ''}`}>
                {isResending ? 'progress_activity' : 'forward_to_inbox'}
              </span>
              <span>
                {resendCooldown > 0
                  ? `Reenviar disponible en ${resendCooldown}s`
                  : 'Reenviar correo de verificación'}
              </span>
            </button>

            <div className="pt-2 border-t border-surface-container/60 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => logout()}
                disabled={isLoggingOut}
                className="text-on-surface-variant hover:text-error transition-colors flex items-center gap-1 font-medium"
              >
                <span className="material-symbols-outlined text-sm">logout</span>
                <span>Cerrar sesión</span>
              </button>

              <button
                type="button"
                onClick={() => startDemoMode('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co')}
                className="text-primary hover:underline font-medium flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">science</span>
                <span>Explorar en Modo Demo</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 text-center text-[11px] text-on-surface-variant/70 flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-xs text-primary">lock</span>
          <span>Aislamiento Criptográfico Cloud Firestore</span>
        </div>
      </div>
    </div>
  );
};
