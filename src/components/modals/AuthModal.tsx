import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export const AuthModal: React.FC = () => {
  const {
    currentUser,
    isAuthenticated,
    isDemoMode,
    loginWithGoogle,
    startDemoMode,
    logout,
    isAuthModalOpen,
    closeAuthModal,
    showToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'Atleta Pro' | 'Coach' | 'Nutricionista'>('Atleta Pro');
  const [rememberMe, setRememberMe] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const result = await loginWithGoogle();
    setIsLoading(false);
    if (result.success) {
      closeAuthModal();
    } else {
      setErrorMessage(result.error || 'Error al autenticar con Google');
    }
  };

  if (!isAuthModalOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }

    setIsLoading(true);
    startDemoMode('Atleta Pro', email.split('@')[0], email);
    setIsLoading(false);
    showToast('Sesión local iniciada (Para persistencia en la nube usa Google OAuth)', 'info');
    closeAuthModal();
    setEmail('');
    setPassword('');
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
      setErrorMessage('Debes aceptar los términos del protocolo de salud.');
      return;
    }

    setIsLoading(true);
    startDemoMode(role, fullName.trim(), email.trim());
    setIsLoading(false);
    showToast(`Cuenta local (${role}) creada en Sandbox`, 'info');
    closeAuthModal();
    setFullName('');
    setEmail('');
    setPassword('');
  };

  const handleFillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrorMessage(null);
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
                {isAuthenticated ? 'Perfil de Usuario' : 'Acceso a Vigor Core'}
              </h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {isAuthenticated
                  ? 'Gestión de credenciales y sesión'
                  : 'Sincronización segura con Cloud Firestore'}
              </p>
            </div>
          </div>
          <button
            onClick={closeAuthModal}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
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
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  className="w-16 h-16 rounded-full object-cover ring-2 ring-primary"
                />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-headline-sm text-lg font-bold text-on-surface">
                      {currentUser.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-fixed text-on-primary-fixed">
                      {currentUser.role}
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
                    Persistencia Base de Datos
                  </span>
                  {isDemoMode ? (
                    <span className="text-xs font-semibold text-amber-700 flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs">storage</span>
                      Sandbox Local (Demo)
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-primary flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs">cloud_done</span>
                      Cloud Firestore Live
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
                    Tus cambios se guardan localmente en tu navegador. Conecta tu cuenta de Google para persistir en Cloud Firestore con seguridad Zero-Trust.
                  </div>
                </div>
              ) : (
                <div className="p-space-sm bg-primary-container/10 border border-primary/20 rounded-xl text-xs text-on-surface-variant flex items-start gap-2">
                  <span className="material-symbols-outlined text-primary text-base shrink-0 mt-0.5">
                    security
                  </span>
                  <span>
                    Autenticado con Firebase Auth. Tus registros están protegidos con reglas ABAC aisladas por tu UID único.
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-2">
                {isDemoMode && (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-base">cloud_sync</span>
                    Conectar con Google (Activar Firestore)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeAuthModal();
                    showToast('Ventana de ajustes nutricionales abierta');
                  }}
                  className="w-full py-2.5 px-4 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">tune</span>
                  Ver Ajustes Nutricionales
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                  }}
                  className="w-full py-2.5 px-4 bg-error-container/20 hover:bg-error-container/40 text-error rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  Cerrar Sesión
                </button>
              </div>
            </div>
          ) : (
            /* Unauthenticated Login / Register Flow */
            <div>
              {/* Tab Selector */}
              <div className="flex p-1 bg-surface-container-low rounded-xl mb-space-md">
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

              {/* 1-Click Google Sign-In */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="w-full mb-space-md py-2.5 px-3 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl border border-surface-container font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
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
                <span>Continuar con Google</span>
              </button>

              <div className="flex items-center gap-2 mb-space-md">
                <div className="flex-1 h-[1px] bg-surface-container" />
                <span className="text-[10px] uppercase font-bold text-on-surface-variant/70 tracking-wider">
                  O ingresa con credenciales
                </span>
                <div className="flex-1 h-[1px] bg-surface-container" />
              </div>

              {/* Error feedback */}
              {errorMessage && (
                <div className="mb-space-md p-space-sm bg-error-container/30 border border-error/30 rounded-xl text-error text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* LOGIN FORM */}
              {activeTab === 'login' && (
                <form onSubmit={handleLogin} className="flex flex-col gap-space-md">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Correo Electrónico
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-on-surface-variant">
                        mail
                      </span>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="tu@correo.com"
                        className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Contraseña
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-on-surface-variant">
                        lock
                      </span>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-on-surface-variant select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => setRememberMe(e.target.checked)}
                        className="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
                      />
                      Recordar credenciales
                    </label>
                    <button
                      type="button"
                      onClick={() => showToast('Enlace de recuperación enviado al correo')}
                      className="text-primary hover:underline font-medium"
                    >
                      ¿Olvidaste tu clave?
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                        <span>Verificando...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">login</span>
                        <span>Iniciar Sesión</span>
                      </>
                    )}
                  </button>

                  {/* Demo shortcut pills */}
                  <div className="pt-2 border-t border-surface-container/60">
                    <span className="text-[11px] text-on-surface-variant font-medium block mb-2 text-center">
                      Explorar en Modo Demostración (Sandbox Local):
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          startDemoMode('Atleta Pro', 'Camilo R. (Demo)', 'camilo@vigor.co');
                          closeAuthModal();
                        }}
                        className="py-1.5 px-2 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs rounded-lg border border-surface-container transition-colors text-left cursor-pointer"
                      >
                        <div className="font-semibold truncate">Camilo R.</div>
                        <div className="text-[10px] text-amber-700 font-medium">Atleta Pro (Sandbox)</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          startDemoMode('Nutricionista', 'Dra. Sofía M. (Demo)', 'sofia@vigor.co');
                          closeAuthModal();
                        }}
                        className="py-1.5 px-2 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs rounded-lg border border-surface-container transition-colors text-left cursor-pointer"
                      >
                        <div className="font-semibold truncate">Dra. Sofía M.</div>
                        <div className="text-[10px] text-amber-700 font-medium">Nutricionista (Sandbox)</div>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* REGISTER FORM */}
              {activeTab === 'register' && (
                <form onSubmit={handleRegister} className="flex flex-col gap-space-md">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Nombre Completo
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-on-surface-variant">
                        person
                      </span>
                      <input
                        type="text"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        placeholder="Ej. Andrés Morales"
                        className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Correo Electrónico
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-on-surface-variant">
                        mail
                      </span>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="andres@ejemplo.com"
                        className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Perfil / Rol
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['Atleta Pro', 'Coach', 'Nutricionista'] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`py-1.5 px-2 text-xs rounded-lg font-medium border text-center transition-all ${
                            role === r
                              ? 'bg-primary text-on-primary border-primary font-semibold'
                              : 'bg-surface-container-low text-on-surface-variant border-surface-container hover:bg-surface-container'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-semibold text-on-surface-variant">
                        Contraseña (mínimo 6 car.)
                      </label>
                      <span className="text-[10px] font-medium text-on-surface-variant">
                        Seguridad: <span className="font-semibold">{strength.label}</span>
                      </span>
                    </div>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-on-surface-variant">
                        lock
                      </span>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                        required
                      />
                    </div>
                    {/* Password bar */}
                    <div className="w-full h-1.5 bg-surface-container rounded-full mt-2 overflow-hidden">
                      <div
                        className={`h-full ${strength.color} transition-all duration-300`}
                        style={{ width: `${strength.percent}%` }}
                      />
                    </div>
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer text-xs text-on-surface-variant select-none">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={e => setAgreeTerms(e.target.checked)}
                      className="mt-0.5 rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
                      required
                    />
                    <span>
                      Acepto el almacenamiento local seguro y el protocolo de seguimiento nutricional y de fuerza de 180 días.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-semibold text-sm transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                        <span>Registrando cuenta...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">person_add</span>
                        <span>Crear Cuenta Gratuita</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
