/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.2, Stage 2 — Reconciled Hosted Login & Modelo B Exchange Bridge
 *
 * Reconciled against Zoho Catalyst Console (`Development`) applied Native Auth posture:
 * - Native Catalyst Authentication: Hosted Login ONLY (`hostedSignIn(redirectUrl)`).
 * - Public Signup: Disabled | Social Login: Disabled | Third-party Auth: Unconfigured.
 * - Custom User Validation: Disabled -> bridge enforces `is_confirmed` and `status === 'ACTIVE'` fail-closed.
 * - iFrame: Disabled -> refuses embedded login paths and rejects execution if top-level window is framed.
 * - CORS: Enabled & Authorized Domain configured for the Slate app origin (`expectedOrigin` supplied dynamically
 *   at runtime; backend API custom domain mapping stays outside Stage 2 Native Auth scope).
 * - Route separation: `/auth/login` acts strictly as login initiator / post-logout target; `/auth/callback` is
 *   the sole Hosted Login return callback (`redirect_url`).
 * - Acquires an ephemeral `generateAuthToken('functions')` token strictly in local RAM for the
 *   single pre-session exchange (`/bootstrap-profile` or `/exchange`) and wipes it in `finally`.
 * - NEVER writes access tokens, refresh tokens, or session tokens to browser persistent storage.
 */

import { CleanSlateRepositoryError } from '../contracts/repositories';
import type {
  CatalystHttpAuthRepository,
  HttpAuthSessionResult,
} from './CatalystHttpAuthRepository';

export const DEFAULT_HOSTED_LOGIN_CALLBACK_PATH = '/auth/callback';
export const DEFAULT_POST_LOGOUT_PATH = '/auth/login';

export const NATIVE_HOSTED_AUTH_PROFILE = {
  authMode: 'hosted_login',
  publicSignup: 'disabled',
  socialLogin: 'disabled',
  thirdPartyAuth: 'unconfigured',
  customUserValidation: 'disabled',
  cors: 'enabled',
  iframe: 'disabled',
  initiatorPath: DEFAULT_POST_LOGOUT_PATH,
  callbackPath: DEFAULT_HOSTED_LOGIN_CALLBACK_PATH,
} as const;

export interface CatalystGeneratedAuthToken {
  access_token?: string;
  expires_in_sec?: number | string;
}

export interface CatalystWebUserSnapshot {
  user_id?: string;
  zuid?: string;
  email_id?: string;
  status?: string;
  is_confirmed?: boolean;
  [key: string]: unknown;
}

/**
 * Minimal structural subset of `@zcatalyst/auth@1.0.0` (`Authentication` in `dist-es/web.js`).
 * Intentionally omits Embedded `signIn()` and Public `signUp()`.
 */
export interface ICatalystWebAuthSdk {
  init(): Promise<void>;
  hostedSignIn(redirectUrl?: string): Promise<void>;
  signIn?(elementId: string, config?: Record<string, unknown>): Promise<unknown>;
  mountEmbeddedSignIn?(
    containerId: string,
    onSuccess?: () => void | Promise<void>,
    options?: { redirectUrl?: string }
  ): Promise<void>;
  generateAuthToken(feature: 'functions'): Promise<CatalystGeneratedAuthToken>;
  isUserAuthenticated(orgId?: string): Promise<CatalystWebUserSnapshot | false>;
  signOut(redirectUrl?: string): Promise<void>;
}

export type PreSessionAuthorizationFormat = 'raw' | 'zoho_oauthtoken' | 'none';

export interface CatalystHostedAuthBridgeConfig {
  sdk: ICatalystWebAuthSdk;
  authRepo: CatalystHttpAuthRepository;
  expectedOrigin?: string;
  defaultCallbackPath?: string;
  defaultLogoutPath?: string;
  authorizationFormat?: PreSessionAuthorizationFormat;
}

export interface EstablishVigorSessionOptions {
  mode: 'bootstrap' | 'exchange';
  displayName?: string;
}

function resolveRuntimeOriginFallback(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return typeof loc?.origin === 'string' ? loc.origin : '';
}

export function resolveSafeSameOriginRedirect(
  requestedPath: string | undefined,
  expectedOrigin = resolveRuntimeOriginFallback(),
  fallbackPath = DEFAULT_HOSTED_LOGIN_CALLBACK_PATH
): string {
  const candidate = (requestedPath ?? fallbackPath).trim();
  if (!candidate || /[\r\n\0\\]/.test(candidate)) {
    throw new CleanSlateRepositoryError(
      'INVALID_AUTH_REDIRECT',
      'La ruta de redirección de Hosted Login contiene caracteres prohibidos o está vacía.',
      400,
      { origin: 'client_synthetic' }
    );
  }

  if (candidate.startsWith('//')) {
    throw new CleanSlateRepositoryError(
      'OPEN_REDIRECT_BLOCKED',
      'Redirección protocol-relative bloqueada en Hosted Login.',
      400,
      { origin: 'client_synthetic' }
    );
  }

  let parsedOrigin: URL;
  try {
    if (!expectedOrigin.trim()) {
      throw new Error('empty origin');
    }
    parsedOrigin = new URL(expectedOrigin);
  } catch {
    throw new CleanSlateRepositoryError(
      'INVALID_AUTH_ORIGIN',
      'El origen configurado para Hosted Login debe especificarse explícitamente y ser una URL válida.',
      400,
      { origin: 'client_synthetic' }
    );
  }

  if (candidate.startsWith('/')) {
    const resolved = new URL(candidate, parsedOrigin.origin);
    if (resolved.origin !== parsedOrigin.origin) {
      throw new CleanSlateRepositoryError(
        'OPEN_REDIRECT_BLOCKED',
        'La ruta de callback de Hosted Login salió del origen permitido.',
        400,
        { origin: 'client_synthetic' }
      );
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  }

  let parsedCandidate: URL;
  try {
    parsedCandidate = new URL(candidate);
  } catch {
    throw new CleanSlateRepositoryError(
      'INVALID_AUTH_REDIRECT',
      'La URL de redirección de Hosted Login tiene formato inválido.',
      400,
      { origin: 'client_synthetic' }
    );
  }

  const isLoopback =
    parsedCandidate.hostname === '127.0.0.1' || parsedCandidate.hostname === 'localhost';
  if (parsedCandidate.protocol !== 'https:' && !(isLoopback && parsedCandidate.protocol === 'http:')) {
    throw new CleanSlateRepositoryError(
      'INSECURE_AUTH_REDIRECT',
      'La redirección de Hosted Login requiere HTTPS estricto.',
      400,
      { origin: 'client_synthetic' }
    );
  }

  if (parsedCandidate.origin !== parsedOrigin.origin) {
    throw new CleanSlateRepositoryError(
      'OPEN_REDIRECT_BLOCKED',
      `Redirección externa bloqueada (${parsedCandidate.origin} != ${parsedOrigin.origin}).`,
      400,
      { origin: 'client_synthetic' }
    );
  }

  return `${parsedCandidate.pathname}${parsedCandidate.search}${parsedCandidate.hash}`;
}

export class CatalystHostedAuthBridge {
  private readonly sdk: ICatalystWebAuthSdk;
  private readonly authRepo: CatalystHttpAuthRepository;
  private readonly expectedOrigin: string;
  private readonly defaultCallbackPath: string;
  private readonly defaultLogoutPath: string;
  private readonly authorizationFormat: PreSessionAuthorizationFormat;

  constructor(config: CatalystHostedAuthBridgeConfig) {
    const resolvedOrigin = (config.expectedOrigin ?? resolveRuntimeOriginFallback()).trim();
    if (!resolvedOrigin) {
      throw new CleanSlateRepositoryError(
        'MISSING_AUTH_ORIGIN',
        'Se requiere configurar expectedOrigin explícitamente fuera de un navegador.',
        400,
        { origin: 'client_synthetic' }
      );
    }
    this.sdk = config.sdk;
    this.authRepo = config.authRepo;
    this.expectedOrigin = resolvedOrigin;
    this.defaultCallbackPath = config.defaultCallbackPath ?? DEFAULT_HOSTED_LOGIN_CALLBACK_PATH;
    this.defaultLogoutPath = config.defaultLogoutPath ?? DEFAULT_POST_LOGOUT_PATH;
    this.authorizationFormat = config.authorizationFormat ?? 'raw';
  }

  async startHostedLogin(redirectPath?: string): Promise<string> {
    const win = (globalThis as { window?: { self?: unknown; top?: unknown } }).window;
    if (win && win.top !== undefined && win.self !== win.top) {
      throw new CleanSlateRepositoryError(
        'HOSTED_LOGIN_IFRAME_FORBIDDEN',
        'Hosted Login requiere navegación top-level (iFrame está deshabilitado en Catalyst Authentication).',
        403,
        { origin: 'client_synthetic' }
      );
    }

    const safeCallbackPath = resolveSafeSameOriginRedirect(
      redirectPath,
      this.expectedOrigin,
      this.defaultCallbackPath
    );
    const parsedCallback = new URL(safeCallbackPath, this.expectedOrigin);
    if (parsedCallback.pathname === this.defaultLogoutPath) {
      throw new CleanSlateRepositoryError(
        'INVALID_HOSTED_CALLBACK_PATH',
        `La ruta '${this.defaultLogoutPath}' corresponde al iniciador/post-logout y no debe usarse como callback post-login (use '${this.defaultCallbackPath}').`,
        400,
        { origin: 'client_synthetic' }
      );
    }

    await this.sdk.init();
    await this.sdk.hostedSignIn(safeCallbackPath);
    return safeCallbackPath;
  }

  async mountEmbeddedSignIn(
    containerId: string,
    onSuccess?: () => void | Promise<void>,
    redirectPath?: string
  ): Promise<string> {
    const safeCallbackPath = resolveSafeSameOriginRedirect(
      redirectPath,
      this.expectedOrigin,
      this.defaultCallbackPath
    );
    if (!this.sdk.mountEmbeddedSignIn) {
      throw new CleanSlateRepositoryError(
        'EMBEDDED_SIGNIN_UNSUPPORTED',
        'El adaptador SDK actual no implementa mountEmbeddedSignIn().',
        501,
        { origin: 'client_synthetic' }
      );
    }
    await this.sdk.mountEmbeddedSignIn(containerId, onSuccess, {
      redirectUrl: safeCallbackPath,
    });
    return safeCallbackPath;
  }

  async establishVigorSession(options: EstablishVigorSessionOptions): Promise<HttpAuthSessionResult> {
    await this.sdk.init();

    const userSnapshot = await this.sdk.isUserAuthenticated();
    if (!userSnapshot) {
      throw new CleanSlateRepositoryError(
        'CATALYST_USER_NOT_AUTHENTICATED',
        'No existe una sesión nativa activa en Catalyst Authentication para intercambiar.',
        401,
        { origin: 'client_synthetic' }
      );
    }

    if (userSnapshot.is_confirmed === false) {
      throw new CleanSlateRepositoryError(
        'EMAIL_VERIFICATION_REQUIRED',
        'La cuenta de Catalyst Authentication aún no ha confirmado su correo electrónico.',
        403,
        { origin: 'client_synthetic' }
      );
    }

    if (typeof userSnapshot.status === 'string' && userSnapshot.status.toUpperCase() !== 'ACTIVE') {
      throw new CleanSlateRepositoryError(
        'CATALYST_ACCOUNT_NOT_ACTIVE',
        `La cuenta de Catalyst Authentication no está activa (${userSnapshot.status}).`,
        403,
        { origin: 'client_synthetic' }
      );
    }

    let ephemeralFunctionsToken: string | null = null;
    try {
      if (this.authorizationFormat !== 'none') {
        const tokenPayload = await this.sdk.generateAuthToken('functions');
        const rawToken =
          typeof tokenPayload?.access_token === 'string' ? tokenPayload.access_token.trim() : '';
        if (!rawToken || /[\r\n]/.test(rawToken)) {
          throw new CleanSlateRepositoryError(
            'EPHEMERAL_AUTH_TOKEN_UNAVAILABLE',
            'generateAuthToken("functions") no devolvió un token efímero válido.',
            401,
            { origin: 'client_synthetic' }
          );
        }
        ephemeralFunctionsToken = rawToken;
      }

      const preSessionHeaders: Record<string, string> | undefined = ephemeralFunctionsToken
        ? {
            Authorization:
              this.authorizationFormat === 'zoho_oauthtoken'
                ? `Zoho-oauthtoken ${ephemeralFunctionsToken}`
                : ephemeralFunctionsToken,
          }
        : undefined;

      if (options.mode === 'bootstrap') {
        return await this.authRepo.bootstrapProfile(options.displayName, {
          headers: preSessionHeaders,
        });
      }
      return await this.authRepo.exchangeSession({
        headers: preSessionHeaders,
      });
    } finally {
      // Garantiza cero permanencia del token efímero tras el intercambio Modelo B
      ephemeralFunctionsToken = null;
    }
  }

  async logoutAll(redirectPath?: string): Promise<string> {
    const safeRedirectPath = resolveSafeSameOriginRedirect(
      redirectPath,
      this.expectedOrigin,
      this.defaultLogoutPath
    );
    await this.authRepo.logout();
    await this.sdk.signOut(safeRedirectPath);
    return safeRedirectPath;
  }
}
