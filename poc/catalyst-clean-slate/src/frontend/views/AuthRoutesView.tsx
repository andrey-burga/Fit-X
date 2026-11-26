/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Dedicated `/auth/login` and `/auth/callback` Views
 *
 * Enforces:
 * - Zero fabricated auth state and zero token storage in `localStorage`/`sessionStorage`/`IndexedDB`.
 * - Top-level Catalyst Hosted Login redirect (`hostedSignIn('/auth/callback')`), iFrame blocked.
 * - Explicit visible UI states for unauthenticated, cancelled, unconfirmed email, disabled/suspended,
 *   missing VigorCore `Users` profile (`USER_PROFILE_NOT_REGISTERED` -> opt-in `/bootstrap-profile`),
 *   expired/invalid invitation redemption, backend/network failures, and authenticated workspace entry.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  DEFAULT_HOSTED_LOGIN_CALLBACK_PATH,
  NATIVE_HOSTED_AUTH_PROFILE,
} from '../adapters/CatalystHostedAuthBridge';
import { PRE_SESSION_CREDENTIAL_CONTRACT } from '../adapters/catalystWebSdkAdapter';
import { CleanSlateRepositoryError } from '../contracts/repositories';
import { buildPathWithPreservedMode, type ParsedAppRoute } from '../routing/authRouting';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard } from '../components/UiPrimitives';

type CallbackStep =
  | 'validating'
  | 'authenticated'
  | 'cancelled'
  | 'unconfirmed_email'
  | 'disabled_user'
  | 'needs_bootstrap'
  | 'invitation_error'
  | 'backend_error';

interface CallbackFailureInfo {
  code: string;
  message: string;
  statusCode?: number;
}

function toFailureInfo(err: unknown): CallbackFailureInfo {
  if (err instanceof CleanSlateRepositoryError) {
    return {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
    };
  }
  return {
    code: 'AUTH_CALLBACK_ERROR',
    message: err instanceof Error ? err.message : 'Error inesperado validando la sesión.',
  };
}

export const AuthRoutesView: React.FC<{ route: ParsedAppRoute }> = ({ route }) => {
  if (route.routeId === 'auth-login') {
    return <AuthLoginView route={route} />;
  }
  return <AuthCallbackView route={route} />;
};

const AuthHeader: React.FC<{ subtitle: string }> = ({ subtitle }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
    <div className="flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shrink-0">
        <Activity className="w-5 h-5" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-lg font-bold text-ink tracking-tight">VigorCore · Autenticación Catalyst</h1>
        <p className="text-xs text-ink-muted">{subtitle}</p>
      </div>
    </div>
    <span className="text-xs font-mono px-2.5 py-1 rounded-md border border-border bg-surface-alt text-ink-muted">
      Hosted Login · Strict Cookie
    </span>
  </div>
);

const AuthLoginView: React.FC<{ route: ParsedAppRoute }> = ({ route }) => {
  const { authBridge, authRepository, navigateToPath, reloadWorkspace } = useWorkspace();
  const [checkingExisting, setCheckingExisting] = useState<boolean>(Boolean(authRepository));
  const [existingActorEmail, setExistingActorEmail] = useState<string | null>(null);
  const [startingLogin, setStartingLogin] = useState(false);
  const [loginError, setLoginError] = useState<CallbackFailureInfo | null>(null);

  useEffect(() => {
    let active = true;
    if (!authRepository) {
      setCheckingExisting(false);
      return;
    }
    void (async () => {
      try {
        const me = await authRepository.getMe();
        if (!active) return;
        const email = typeof me.actor?.email === 'string' ? me.actor.email : null;
        setExistingActorEmail(email ?? 'Sesión verificada');
      } catch {
        if (!active) return;
        setExistingActorEmail(null);
      } finally {
        if (active) setCheckingExisting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authRepository]);

  const handleStartHostedLogin = async () => {
    setLoginError(null);
    if (!authBridge) {
      setLoginError({
        code: 'AUTH_BRIDGE_NOT_CONFIGURED',
        message: 'El adaptador CatalystHostedAuthBridge no está configurado en esta vista.',
      });
      return;
    }
    setStartingLogin(true);
    try {
      const callbackPath = buildPathWithPreservedMode(
        DEFAULT_HOSTED_LOGIN_CALLBACK_PATH,
        route.search,
        route.safeNextPath && route.safeNextPath !== '/' ? { next: route.safeNextPath } : {}
      );
      await authBridge.startHostedLogin(callbackPath);
    } catch (err) {
      setLoginError(toFailureInfo(err));
      setStartingLogin(false);
    }
  };

  const handleEnterWorkspace = async () => {
    await reloadWorkspace();
    const target = buildPathWithPreservedMode(route.safeNextPath || '/', route.search);
    navigateToPath(target, { replace: true });
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl bg-surface border border-border rounded-2xl p-6 space-y-5 shadow-sm">
        <AuthHeader subtitle="Ruta /auth/login · Iniciador exclusivo top-level (sin iFrame ni registro público)" />

        {route.loggedOut && (
          <InlineAlert tone="info" title="Sesión cerrada">
            Tu sesión VigorCore (__Host-vigor_session) y el token CSRF en memoria fueron revocados.
          </InlineAlert>
        )}

        {route.cancelled && (
          <InlineAlert tone="warning" title="Inicio de sesión cancelado">
            El flujo de Zoho Catalyst Hosted Login fue cancelado antes de completarse.
          </InlineAlert>
        )}

        {route.rejectedUnsafeRedirect && (
          <InlineAlert tone="warning" title="Redirección bloqueada por seguridad">
            Se descartó un destino de redirección fuera del origen permitido.
          </InlineAlert>
        )}

        {loginError && (
          <InlineAlert tone="error" title={`Error (${loginError.code})`}>
            {loginError.message}
          </InlineAlert>
        )}

        {checkingExisting ? (
          <div className="flex items-center gap-2.5 text-sm text-ink-muted py-3">
            <Loader2 className="w-4 h-4 animate-spin text-brand" aria-hidden="true" />
            <span>Verificando sesión activa en el servidor (/api/v1/auth/me)...</span>
          </div>
        ) : existingActorEmail ? (
          <SectionCard
            title="Sesión VigorCore verificada"
            subtitle={`Actor autenticado: ${existingActorEmail}`}
          >
            <p className="text-sm text-ink-muted">
              Ya cuentas con una cookie HMAC __Host-vigor_session válida emitida por el backend.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void handleEnterWorkspace()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer"
              >
                <span>Ir al Espacio de Trabajo</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void handleStartHostedLogin()}
                disabled={startingLogin}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" aria-hidden="true" />
                <span>Reautenticar con Catalyst</span>
              </button>
            </div>
          </SectionCard>
        ) : (
          <SectionCard
            title="Acceso exclusivo para usuarios invitados"
            subtitle="Estado actual: No autenticado"
          >
            <p className="text-sm text-ink-muted leading-relaxed">
              VigorCore utiliza Zoho Catalyst Hosted Login (navegación top-level hacia{' '}
              <code className="font-mono text-xs bg-surface-alt px-1.5 py-0.5 rounded">
                /__catalyst/auth/login
              </code>
              ) con retorno obligatorio en{' '}
              <code className="font-mono text-xs bg-surface-alt px-1.5 py-0.5 rounded">
                {NATIVE_HOSTED_AUTH_PROFILE.callbackPath}
              </code>
              .
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-ink-muted bg-surface-alt/70 border border-border rounded-lg p-3">
              <div>Registro público: deshabilitado</div>
              <div>iFrame embebido: bloqueado</div>
              <div>Contrato Edge: {PRE_SESSION_CREDENTIAL_CONTRACT.selectedOption}</div>
              <div>Web Storage / IDB: 0 tokens</div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void handleStartHostedLogin()}
                disabled={startingLogin}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {startingLogin ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                )}
                <span>
                  {startingLogin ? 'Redirigiendo a Catalyst Hosted Login...' : 'Iniciar sesión con Catalyst'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => navigateToPath(buildPathWithPreservedMode('/', route.search))}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-ink text-sm font-medium cursor-pointer"
              >
                <span>Volver al inicio</span>
              </button>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
};

const AuthCallbackView: React.FC<{ route: ParsedAppRoute }> = ({ route }) => {
  const { authBridge, authRepository, navigateToPath, reloadWorkspace } = useWorkspace();
  const [attemptId, setAttemptId] = useState(1);
  const [step, setStep] = useState<CallbackStep>('validating');
  const [failure, setFailure] = useState<CallbackFailureInfo | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [inviteIdInput, setInviteIdInput] = useState('');
  const [inviteTokenInput, setInviteTokenInput] = useState('');
  const [submittingBootstrap, setSubmittingBootstrap] = useState(false);

  // StrictMode guard: prevents duplicate concurrent `/exchange` requests per attempt
  // while keeping state updates active after StrictMode's synchronous remount.
  const executedAttemptRef = useRef<string>('');
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loginPath = buildPathWithPreservedMode('/auth/login', route.search);
  const workspaceTargetPath = buildPathWithPreservedMode(route.safeNextPath || '/', route.search);
  const attemptKey = `${attemptId}|${route.pathname}|${route.search}`;

  useEffect(() => {
    if (executedAttemptRef.current === attemptKey) {
      return;
    }
    executedAttemptRef.current = attemptKey;

    if (route.cancelled) {
      setStep('cancelled');
      setFailure({
        code: route.catalystErrorCode ?? 'HOSTED_LOGIN_CANCELLED',
        message:
          route.catalystErrorMessage ??
          'El inicio de sesión en Zoho Catalyst fue cancelado por el usuario.',
      });
      return;
    }

    if (route.catalystErrorCode) {
      setStep('backend_error');
      setFailure({
        code: route.catalystErrorCode,
        message:
          route.catalystErrorMessage ??
          `Catalyst Hosted Login devolvió el error '${route.catalystErrorCode}'.`,
      });
      return;
    }

    if (!authBridge || !authRepository) {
      setStep('backend_error');
      setFailure({
        code: 'AUTH_BRIDGE_NOT_CONFIGURED',
        message: 'El adaptador HTTP/Catalyst no está disponible para completar /auth/callback.',
      });
      return;
    }

    setStep('validating');
    setFailure(null);

    void (async () => {
      try {
        const session = await authBridge.establishVigorSession({ mode: 'exchange' });
        if (!mountedRef.current) return;
        setVerifiedEmail(typeof session.actor?.email === 'string' ? session.actor.email : null);
        await reloadWorkspace();
        if (!mountedRef.current) return;
        setStep('authenticated');
        navigateToPath(workspaceTargetPath, { replace: true });
      } catch (err) {
        if (!mountedRef.current) return;
        const info = toFailureInfo(err);
        setFailure(info);
        if (info.code === 'CATALYST_USER_NOT_AUTHENTICATED' || info.statusCode === 401) {
          setStep('cancelled');
        } else if (info.code === 'EMAIL_VERIFICATION_REQUIRED') {
          setStep('unconfirmed_email');
        } else if (
          info.code === 'CATALYST_ACCOUNT_NOT_ACTIVE' ||
          info.code === 'CATALYST_USER_DISABLED' ||
          info.code === 'ACCOUNT_SUSPENDED'
        ) {
          setStep('disabled_user');
        } else if (info.code === 'USER_PROFILE_NOT_REGISTERED') {
          setStep('needs_bootstrap');
        } else {
          setStep('backend_error');
        }
      }
    })();
  }, [attemptKey, authBridge, authRepository, navigateToPath, reloadWorkspace, route, workspaceTargetPath]);

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authBridge || !authRepository) return;
    setSubmittingBootstrap(true);
    setFailure(null);
    try {
      const cleanedName = displayName.trim();
      const session = await authBridge.establishVigorSession({
        mode: 'bootstrap',
        displayName: cleanedName || undefined,
      });
      setVerifiedEmail(typeof session.actor?.email === 'string' ? session.actor.email : null);

      const trimmedInviteId = inviteIdInput.trim();
      const trimmedInviteTok = inviteTokenInput.trim();
      if (trimmedInviteId || trimmedInviteTok) {
        if (!authRepository.redeemInvitation) {
          throw new CleanSlateRepositoryError(
            'REDEEM_ADAPTER_UNAVAILABLE',
            'El adaptador de redención de invitaciones no está disponible.',
            500,
            { origin: 'client_synthetic' }
          );
        }
        try {
          await authRepository.redeemInvitation(trimmedInviteId, trimmedInviteTok);
        } catch (invErr) {
          setFailure(toFailureInfo(invErr));
          setStep('invitation_error');
          setSubmittingBootstrap(false);
          return;
        }
      }

      await reloadWorkspace();
      setStep('authenticated');
      navigateToPath(workspaceTargetPath, { replace: true });
    } catch (err) {
      const info = toFailureInfo(err);
      setFailure(info);
      if (info.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setStep('unconfirmed_email');
      } else if (
        info.code === 'CATALYST_ACCOUNT_NOT_ACTIVE' ||
        info.code === 'CATALYST_USER_DISABLED' ||
        info.code === 'ACCOUNT_SUSPENDED'
      ) {
        setStep('disabled_user');
      } else if (info.code === 'DUPLICATE_EMAIL_ANOMALY') {
        setStep('backend_error');
      }
    } finally {
      setSubmittingBootstrap(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl bg-surface border border-border rounded-2xl p-6 space-y-5 shadow-sm">
        <AuthHeader subtitle="Ruta /auth/callback · Validación de identidad Catalyst e intercambio de sesión HMAC" />

        {route.ignoredUntrustedParams.length > 0 && (
          <InlineAlert tone="info" title="Parámetros de identidad ignorados">
            Se ignoraron parámetros no confiables en URL ({route.ignoredUntrustedParams.join(', ')}).
            Toda identidad se resuelve exclusivamente en el backend.
          </InlineAlert>
        )}

        {step === 'validating' && (
          <div className="py-6 flex flex-col items-center text-center gap-3" role="status">
            <Loader2 className="w-8 h-8 text-brand animate-spin" aria-hidden="true" />
            <h2 className="text-base font-semibold text-ink">
              Validando identidad verificada e iniciando sesión VigorCore...
            </h2>
            <p className="text-xs text-ink-muted max-w-md">
              Ejecutando POST /api/v1/auth/session/exchange con credencial efímera en RAM y cookie
              estricta __Host-vigor_session.
            </p>
          </div>
        )}

        {step === 'authenticated' && (
          <div className="py-6 flex flex-col items-center text-center gap-3" role="status">
            <CheckCircle2 className="w-8 h-8 text-brand" aria-hidden="true" />
            <h2 className="text-base font-semibold text-ink">Sesión verificada correctamente</h2>
            <p className="text-xs text-ink-muted">
              {verifiedEmail ? `Cuenta: ${verifiedEmail}. ` : ''}Redirigiendo al espacio de trabajo...
            </p>
            <button
              type="button"
              onClick={() => navigateToPath(workspaceTargetPath, { replace: true })}
              className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
            >
              Continuar al Dashboard
            </button>
          </div>
        )}

        {step === 'cancelled' && (
          <SectionCard
            title="Autenticación no completada"
            subtitle={failure?.code ?? 'CATALYST_USER_NOT_AUTHENTICATED'}
          >
            <InlineAlert tone="warning" title="Sin sesión activa en Catalyst">
              {failure?.message ??
                'El inicio de sesión fue cancelado o no hay una sesión válida en Catalyst Authentication.'}
            </InlineAlert>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => navigateToPath(loginPath)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer"
              >
                <LogIn className="w-4 h-4" aria-hidden="true" />
                <span>Volver a /auth/login</span>
              </button>
            </div>
          </SectionCard>
        )}

        {step === 'unconfirmed_email' && (
          <SectionCard
            title="Confirmación de correo requerida"
            subtitle="EMAIL_VERIFICATION_REQUIRED"
          >
            <InlineAlert tone="error" title="Correo aún no confirmado">
              {failure?.message ??
                'Debes confirmar tu correo electrónico mediante el enlace enviado por Zoho Catalyst antes de acceder.'}
            </InlineAlert>
            <button
              type="button"
              onClick={() => navigateToPath(loginPath)}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer"
            >
              <span>Volver a /auth/login</span>
            </button>
          </SectionCard>
        )}

        {step === 'disabled_user' && (
          <SectionCard
            title="Cuenta deshabilitada o suspendida"
            subtitle={failure?.code ?? 'ACCOUNT_DISABLED'}
          >
            <InlineAlert tone="error" title="Acceso bloqueado por seguridad">
              {failure?.message ??
                'Esta cuenta se encuentra deshabilitada o suspendida y no puede emitir una sesión HMAC.'}
            </InlineAlert>
            <button
              type="button"
              onClick={() => navigateToPath(loginPath)}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer"
            >
              <span>Volver a /auth/login</span>
            </button>
          </SectionCard>
        )}

        {step === 'needs_bootstrap' && (
          <SectionCard
            title="Alta inicial de perfil VigorCore"
            subtitle="USER_PROFILE_NOT_REGISTERED — Registro explícito requerido"
          >
            <InlineAlert tone="info" title="Primer inicio de sesión detectado">
              Tu identidad Catalyst fue verificada, pero aún no existe un registro en la tabla{' '}
              <code className="font-mono text-xs">Users</code>. Al confirmar, el servidor asignará
              exclusivamente el rol de menor privilegio (<code className="font-mono text-xs">athlete</code>).
            </InlineAlert>

            {failure && failure.code !== 'USER_PROFILE_NOT_REGISTERED' && (
              <InlineAlert tone="error" title={`Error (${failure.code})`}>
                {failure.message}
              </InlineAlert>
            )}

            <form onSubmit={e => void handleBootstrapSubmit(e)} className="space-y-4">
              <div>
                <label htmlFor="bootstrap-display-name" className="block text-xs font-medium text-ink mb-1">
                  Nombre visible (opcional)
                </label>
                <input
                  id="bootstrap-display-name"
                  type="text"
                  maxLength={80}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Ej. Camilo Vigor"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                />
              </div>

              <div className="rounded-lg border border-border bg-surface-alt/60 p-3 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <KeyRound className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                  <span>Invitación administrativa opcional (se valida en POST /api/v1/invitations/redeem)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="bootstrap-invite-id" className="block text-[11px] text-ink-muted mb-1">
                      Invite ID
                    </label>
                    <input
                      id="bootstrap-invite-id"
                      type="text"
                      value={inviteIdInput}
                      onChange={e => setInviteIdInput(e.target.value)}
                      placeholder="inv_..."
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="bootstrap-invite-token" className="block text-[11px] text-ink-muted mb-1">
                      Token de invitación
                    </label>
                    <input
                      id="bootstrap-invite-token"
                      type="password"
                      autoComplete="off"
                      value={inviteTokenInput}
                      onChange={e => setInviteTokenInput(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="submit"
                  disabled={submittingBootstrap}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {submittingBootstrap ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserPlus className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>
                    {submittingBootstrap ? 'Creando perfil atleta...' : 'Crear perfil atleta y entrar'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToPath(loginPath)}
                  className="px-4 py-2.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-ink text-sm font-medium cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </SectionCard>
        )}

        {step === 'invitation_error' && (
          <SectionCard
            title="Invitación expirada o inválida"
            subtitle={failure?.code ?? 'INVITATION_INVALID'}
          >
            <InlineAlert tone="error" title="No se pudo redimir la invitación">
              {failure?.message ??
                'La invitación ha expirado, pertenece a otro correo o tiene un token inválido. No se aplicaron cambios de rol.'}
            </InlineAlert>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={async () => {
                  await reloadWorkspace();
                  navigateToPath(workspaceTargetPath, { replace: true });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                <span>Continuar como atleta</span>
              </button>
              <button
                type="button"
                onClick={() => navigateToPath(loginPath)}
                className="px-4 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer"
              >
                Volver a /auth/login
              </button>
            </div>
          </SectionCard>
        )}

        {step === 'backend_error' && (
          <SectionCard
            title="No se pudo completar el intercambio de sesión"
            subtitle={`${failure?.code ?? 'BACKEND_ERROR'}${failure?.statusCode ? ` (HTTP ${failure.statusCode})` : ''}`}
          >
            <InlineAlert tone="error" title="Error en autenticación o red">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {failure?.message ??
                    'El backend rechazó la solicitud o ocurrió un fallo de red / topología de cookies.'}
                </span>
              </span>
            </InlineAlert>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setAttemptId(prev => prev + 1)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-semibold cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                <span>Reintentar validación</span>
              </button>
              <button
                type="button"
                onClick={() => navigateToPath(loginPath)}
                className="px-4 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer"
              >
                Volver a /auth/login
              </button>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
};
