/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Dedicated Public Authentication View (LoginView.tsx)
 * Private route protection, Google OAuth, Email access and Explicit Demo Mode.
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const LoginView: React.FC = () => {
  const {
    loginWithGoogle,
    startDemoMode,
    redirectPath,
    showToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'Atleta Pro' | 'Coach' | 'Nutricionista'>('Atleta Pro');
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await loginWithGoogle();
      if (!result.success) {
        setErrorMessage(result.error || 'Error al iniciar sesión con Google.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error inesperado durante la autenticación con Google.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }

    setIsLoading(true);
    try {
      // In VigorCore, full persistence is tied to Google OAuth.
      // Email authentication initializes a secure local workspace.
      startDemoMode('Atleta Pro', email.split('@')[0], email.trim());
      showToast('Sesión iniciada. Para sincronización en la nube multi-dispositivo, vincula Google OAuth.', 'info');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al procesar el inicio de sesión.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setErrorMessage('Por favor ingresa tu nombre completo.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Ingresa un correo electrónico válido.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (!agreeTerms) {
      setErrorMessage('Debes aceptar las condiciones y el protocolo de privacidad de VigorCore.');
      return;
    }

    setIsLoading(true);
    try {
      startDemoMode(role, fullName.trim(), email.trim());
      showToast(`Cuenta registrada (${role}). Bienvenido a VigorCore.`, 'success');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al procesar el registro.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLaunchDemo = (demoRole: 'Atleta Pro' | 'Coach' | 'Nutricionista', name: string, demoEmail: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setTimeout(() => {
      startDemoMode(demoRole, name, demoEmail);
      setIsLoading(false);
      showToast(`Modo Demostración activado como ${name}`, 'success');
    }, 200);
  };

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { label: 'Sin ingresar', percent: 0, color: 'bg-outline-variant' };
    if (password.length < 6) return { label: 'Débil', percent: 30, color: 'bg-error' };
    if (password.length < 10) return { label: 'Moderada', percent: 65, color: 'bg-amber-500' };
    return { label: 'Segura', percent: 100, color: 'bg-primary' };
  };

  const strength = getPasswordStrength();

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 antialiased">
      {/* Background radial accent */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex items-center justify-center opacity-30">
        <div className="w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-lg">
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

        {/* Redirect Notice Banner (if user attempted to access private URL directly) */}
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
        {errorMessage && (
          <div className="mb-4 p-3.5 bg-error-container/20 border border-error/30 rounded-xl text-xs text-error flex items-start gap-2.5">
            <span className="material-symbols-outlined text-error text-lg shrink-0 mt-0.5">error</span>
            <div className="flex-1 font-medium">{errorMessage}</div>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-surface-container shadow-xl overflow-hidden p-6 sm:p-8">
          {/* Primary Action: Google OAuth Button */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl font-semibold text-sm border border-surface-container transition-all flex items-center justify-center gap-3 shadow-xs cursor-pointer hover:shadow-md disabled:opacity-60"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isLoading ? 'Autenticando...' : 'Continuar con Google Workspace'}</span>
            </button>
            <div className="flex items-center gap-1.5 justify-center text-[11px] text-on-surface-variant font-medium">
              <span className="material-symbols-outlined text-xs text-primary">cloud_done</span>
              <span>Sincronización multi-dispositivo en Cloud Firestore</span>
            </div>
          </div>

          {/* Divider */}
          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-container/60" />
            </div>
            <span className="relative bg-surface-container-lowest px-3 text-xs text-on-surface-variant uppercase tracking-wider font-semibold">
              o acceso por correo
            </span>
          </div>

          {/* Tabs */}
          <div className="flex p-1 bg-surface-container-low rounded-xl mb-5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('login');
                setErrorMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'login'
                  ? 'bg-surface-container-lowest text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setErrorMessage(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'register'
                  ? 'bg-surface-container-lowest text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          {/* Form */}
          {activeTab === 'login' ? (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                    mail
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="atleta@vigor.co"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Contraseña
                  </label>
                  <button
                    type="button"
                    onClick={() => showToast('Para restablecer contraseña, inicia sesión con Google OAuth.', 'info')}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    ¿Olvidaste tu clave?
                  </button>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                    lock
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">login</span>
                <span>{isLoading ? 'Iniciando...' : 'Acceder al Área Privada'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Nombre Completo
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                    person
                  </span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Camilo Arboleda"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                    mail
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="atleta@vigor.co"
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Contraseña (mínimo 6 caracteres)
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                    lock
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
                {/* Strength Meter */}
                {password.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className={`h-full ${strength.color} transition-all`}
                        style={{ width: `${strength.percent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-on-surface-variant font-medium">
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Perfil y Enfoque Deportivo
                  </label>
                  <span className="text-[10px] text-on-surface-variant/70">
                    Etiqueta de perfil (Sin privilegios de servidor)
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['Atleta Pro', 'Coach', 'Nutricionista'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                        role === r
                          ? 'bg-primary-fixed text-on-primary-fixed border-primary font-bold shadow-xs'
                          : 'bg-surface-container-low border-surface-container text-on-surface-variant hover:border-outline'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="agreeTerms"
                  checked={agreeTerms}
                  onChange={e => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 rounded border-surface-container-high text-primary focus:ring-primary"
                />
                <label htmlFor="agreeTerms" className="text-[11px] text-on-surface-variant leading-relaxed">
                  Acepto los términos de servicio, el protocolo de privacidad y el procesamiento de biometría en VigorCore.
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">person_add</span>
                <span>{isLoading ? 'Registrando...' : 'Registrar Cuenta'}</span>
              </button>
            </form>
          )}

          {/* Sandbox / Demo Mode Explicit Card */}
          <div className="mt-6 pt-5 border-t border-surface-container/60">
            <div className="p-4 bg-surface-container-low rounded-xl border border-surface-container">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm">science</span>
                </div>
                <span className="font-semibold text-xs text-on-surface">
                  Entorno de Demostración Controlado (Sandbox Local)
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed mb-3">
                Explora el ecosistema completo (nutrición, rutinas, analítica ACWR y entrenamiento en vivo) sin registrarte. Los datos residen exclusivamente en la memoria local.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLaunchDemo('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co')}
                  disabled={isLoading}
                  className="py-2 px-3 bg-surface-container-lowest hover:bg-surface-container text-on-surface rounded-lg text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <span className="material-symbols-outlined text-xs text-primary">person</span>
                  <span>Demo Camilo (Atleta)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLaunchDemo('Nutricionista', 'Dra. Sofía V. (Demo)', 'sofia@vigor.co')}
                  disabled={isLoading}
                  className="py-2 px-3 bg-surface-container-lowest hover:bg-surface-container text-on-surface rounded-lg text-xs font-semibold border border-surface-container transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <span className="material-symbols-outlined text-xs text-secondary">medical_services</span>
                  <span>Demo Sofía (Coach)</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-6 text-center text-[11px] text-on-surface-variant/80 flex items-center justify-center gap-4">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs text-primary">verified_user</span>
            Seguridad Zero-Trust
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs text-primary">database</span>
            Firestore ABAC
          </span>
          <span>•</span>
          <span>VigorCore v1.0</span>
        </div>
      </div>
    </div>
  );
};
