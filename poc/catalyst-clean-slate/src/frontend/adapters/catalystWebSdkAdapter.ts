/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.4.1 — Evidence-Backed Catalyst Web SDK Adapter & Pre-Session Contract
 *
 * SDK Inspection Findings (`node_modules/@zcatalyst/*`):
 * - `@zcatalyst/auth@1.0.0` (`dist-es/web.js`, `internal/token-manager.js`):
 *   - `zcAuth.hostedSignIn(redirectUrl)` sets top-level `window.location.href` to
 *     `/__catalyst/auth/login?redirect_url=...`.
 *   - `zcAuth.isUserAuthenticated()` queries `GET /baas/v1/project/{projectId}/project-user/current`
 *     using browser session context (`ZcrfTokenProtocol` / `credentials: 'include'`).
 *   - `zcAuth.generateAuthToken('functions')` calls
 *     `GET /baas/v1/project/{projectId}/authentication/custom-token?feature=functions` followed by
 *     `POST {IAM_DOMAIN}/clientoauth/v2/{zaid}/remote/auth` (`response_type=remote_token`), returning
 *     `{ access_token, expires_in_sec }` strictly in memory (RAM).
 * - `@zcatalyst/auth-admin@1.1.0` (`dist-es/credential.js`, `dist-es/index.js`):
 *   - `ZCAuth.init({ headers }, { type: 'advancedio', scope: 'user' })` reads ONLY Catalyst Edge-injected
 *     `x-zc-user-type`, `x-zc-user-cred-type`, `x-zc-user-cred-token`, and `x-zc-cookie` (`ZD_CSRF_TOKEN`).
 *   - It NEVER parses raw HTTP `Authorization` from `req.headers`, and throws `AUTH_ERROR` when
 *     `x-zc-user-type === 'admin'`.
 *
 * Contract Decision:
 *   OPTION A — Native Catalyst Edge User-Context Forwarding.
 *   Browser code MUST NEVER fabricate `x-zc-*` headers and MUST NEVER persist tokens in Web Storage
 *   or IndexedDB. The pre-session adapter dynamically loads `@zcatalyst/auth/web` only when auth
 *   operations execute (avoiding spurious `/__catalyst/sdk/init` requests on local mock routes).
 */

import type {
  CatalystGeneratedAuthToken,
  CatalystWebUserSnapshot,
  ICatalystWebAuthSdk,
} from './CatalystHostedAuthBridge';
import { CleanSlateRepositoryError } from '../contracts/repositories';

export const PRE_SESSION_CREDENTIAL_CONTRACT = {
  selectedOption: 'OPTION_A_NATIVE_CATALYST_EDGE_USER_CONTEXT_FORWARDING',
  backendUserRuntime: 'HostedNativeCatalystAuthRuntime (ZCAuth scope: user)',
  clientEphemeralMethod: "zcAuth.generateAuthToken('functions')",
  forbidsClientXzcHeaders: true,
  forbidsWebStorageTokens: true,
  forbidsBackendRawAuthDecoding: true,
  missingLiveEvidence: [
    'Whether Catalyst Edge translates browser Authorization (raw vs Zoho-oauthtoken) or Catalyst session cookies into x-zc-user-type=user + x-zc-user-cred-token / x-zc-cookie on cross-origin API Gateway custom domain vs same-origin app proxy.',
    'Whether HttpSecurityPolicy in express_enforced mode requires Authorization in Access-Control-Allow-Headers if API Gateway delegates CORS preflight to Express for cross-domain generateAuthToken("functions").',
  ],
} as const;

type CatalystWebModule = {
  zcAuth?: ICatalystWebAuthSdk;
};

type CatalystAuthClientModule = {
  ConfigStore?: {
    get(key: string): string;
    set(key: string, value: string): void;
  };
  setDefaultProjectConfig?: () => void;
  syncProjectSession?: (credentials: Record<string, string>) => boolean;
};

function readViteEnv(): Record<string, string | undefined> {
  try {
    return (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env) || {};
  } catch {
    return {};
  }
}

function normalizeCatalystDomainUrl(rawDomain: string | undefined): string {
  const trimmed = (rawDomain || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  return `https://${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function formatCredentialInitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Error desconocido');
  if (
    /Unexpected end of JSON input|Unexpected token|JSON\.parse|is not valid JSON/i.test(raw)
  ) {
    return 'El endpoint /__catalyst/sdk/init devolvió una respuesta vacía o no JSON. Configura el proxy /__catalyst en Vite o define VITE_CATALYST_PROJECT_ID y VITE_CATALYST_DOMAIN.';
  }
  return raw;
}

/**
 * Dynamically resolves Catalyst Web SDK (`@zcatalyst/auth/web`) in memory without importing it
 * eagerly at module startup (prevents unwanted `/__catalyst/sdk/init` fetches in `/` mock mode).
 */
export function createBrowserCatalystWebAuthSdk(
  customLoader?: () => Promise<ICatalystWebAuthSdk | null>
): ICatalystWebAuthSdk {
  let cachedPromise: Promise<ICatalystWebAuthSdk> | null = null;
  let fallbackConfigApplied = false;

  const ensureSdk = async (): Promise<ICatalystWebAuthSdk> => {
    if (!cachedPromise) {
      cachedPromise = (async () => {
        if (customLoader) {
          const custom = await customLoader();
          if (custom) return custom;
        }
        try {
          const mod = (await import('@zcatalyst/auth/web')) as unknown as CatalystWebModule;
          if (!mod?.zcAuth) {
            throw new Error('zcAuth export missing from @zcatalyst/auth/web');
          }
          return mod.zcAuth;
        } catch (err) {
          cachedPromise = null;
          throw new CleanSlateRepositoryError(
            'CATALYST_WEB_SDK_UNAVAILABLE',
            `No fue posible inicializar @zcatalyst/auth/web en el navegador: ${err instanceof Error ? err.message : 'error desconocido'}`,
            503,
            { origin: 'client_synthetic' }
          );
        }
      })();
    }
    return cachedPromise;
  };

  const applyEnvFallbackConfig = async (): Promise<boolean> => {
    const env = readViteEnv();
    const projectId = (env.VITE_CATALYST_PROJECT_ID || '').trim();
    const domainUrl = normalizeCatalystDomainUrl(env.VITE_CATALYST_DOMAIN);
    if (!projectId || !domainUrl) {
      return false;
    }
    try {
      const clientMod = (await import('@zcatalyst/auth-client')) as unknown as CatalystAuthClientModule;
      clientMod.setDefaultProjectConfig?.();
      const zaid = (env.VITE_CATALYST_ZAID || '10137226527').trim();
      const iamDomain =
        normalizeCatalystDomainUrl(env.VITE_CATALYST_IAM_DOMAIN) || 'https://accounts.zohoportal.com';
      const environment = (env.VITE_CATALYST_ENVIRONMENT || 'development').trim();
      const strippedDomainHost = domainUrl.replace(/^https?:\/\//i, '');

      clientMod.ConfigStore?.set('PROJECT_ID', projectId);
      clientMod.ConfigStore?.set('ZAID', zaid);
      clientMod.ConfigStore?.set('PROJECT_DOMAIN', domainUrl);
      clientMod.ConfigStore?.set('CATALYST_DOMAIN', domainUrl);
      clientMod.ConfigStore?.set('IAM_DOMAIN', iamDomain);
      clientMod.ConfigStore?.set('ENVIRONMENT', environment);
      clientMod.ConfigStore?.set('INITIALIZED', 'true');
      clientMod.syncProjectSession?.({
        project_id: projectId,
        zaid,
        project_domain: domainUrl,
        environment,
      });
      fallbackConfigApplied = true;
      return true;
    } catch {
      return false;
    }
  };

  const sdkInstance: ICatalystWebAuthSdk = {
    async init(): Promise<void> {
      const sdk = await ensureSdk();
      try {
        await sdk.init();
      } catch (err) {
        const applied = await applyEnvFallbackConfig();
        if (applied) {
          return;
        }
        throw new CleanSlateRepositoryError(
          'CATALYST_SDK_INIT_FAILED',
          formatCredentialInitError(err),
          503,
          { origin: 'client_synthetic' }
        );
      }
    },
    async hostedSignIn(redirectUrl?: string): Promise<void> {
      const sdk = await ensureSdk();
      if (fallbackConfigApplied && typeof window !== 'undefined') {
        const env = readViteEnv();
        const domainUrl = normalizeCatalystDomainUrl(env.VITE_CATALYST_DOMAIN);
        const safeRedirect = redirectUrl || '/auth/callback';
        const loginUrl =
          domainUrl && !domainUrl.includes('accounts.zoho.')
            ? `${domainUrl}/__catalyst/auth/login?redirect_url=${encodeURIComponent(
                new URL(safeRedirect, window.location.origin).toString()
              )}`
            : `/__catalyst/auth/login?redirect_url=${encodeURIComponent(safeRedirect)}`;
        window.location.assign(loginUrl);
        return;
      }
      try {
        await sdk.hostedSignIn(redirectUrl);
      } catch (err) {
        const applied = await applyEnvFallbackConfig();
        if (applied && typeof window !== 'undefined') {
          const safeRedirect = redirectUrl || '/auth/callback';
          window.location.assign(`/__catalyst/auth/login?redirect_url=${encodeURIComponent(safeRedirect)}`);
          return;
        }
        throw new CleanSlateRepositoryError(
          'CATALYST_HOSTED_LOGIN_FAILED',
          formatCredentialInitError(err),
          503,
          { origin: 'client_synthetic' }
        );
      }
    },
    async mountEmbeddedSignIn(
      containerId: string,
      onSuccess?: () => void | Promise<void>,
      options?: { redirectUrl?: string }
    ): Promise<void> {
      if (typeof document === 'undefined') return;
      const container = document.getElementById(containerId);
      if (!container) {
        throw new CleanSlateRepositoryError(
          'EMBEDDED_SIGNIN_CONTAINER_MISSING',
          `No se encontró el contenedor DOM #${containerId} para montar el acceso de Zoho Catalyst.`,
          400,
          { origin: 'client_synthetic' }
        );
      }

      const sdk = await ensureSdk();
      await sdkInstance.init();

      const existingUser = await sdk.isUserAuthenticated().catch(() => false);
      if (existingUser) {
        if (typeof existingUser === 'object' && existingUser.is_confirmed === false) {
          throw new CleanSlateRepositoryError(
            'EMAIL_VERIFICATION_REQUIRED',
            'Tu cuenta aún requiere confirmar el correo electrónico en Zoho Catalyst.',
            403,
            { origin: 'client_synthetic' }
          );
        }
        if (onSuccess) {
          await onSuccess();
          return;
        }
      }

      if (typeof sdk.signIn !== 'function') {
        throw new CleanSlateRepositoryError(
          'EMBEDDED_SIGNIN_UNAVAILABLE',
          'La función signIn() no está disponible en @zcatalyst/auth/web.',
          501,
          { origin: 'client_synthetic' }
        );
      }

      const redirectUrl = options?.redirectUrl || '/auth/callback';
      try {
        await sdk.signIn(containerId, {
          redirectUrl,
          serviceUrl: redirectUrl,
          signinButtonLabel: 'Continuar con Zoho Catalyst',
        });

        const iframeEl = container.querySelector('iframe') as HTMLIFrameElement | null;
        if (iframeEl) {
          iframeEl.style.width = '100%';
          iframeEl.style.minHeight = '400px';
          iframeEl.style.border = 'none';
          iframeEl.style.borderRadius = '12px';
        }

        const authedAfterMount = await sdk.isUserAuthenticated().catch(() => false);
        if (authedAfterMount && onSuccess) {
          await onSuccess();
        }
      } catch (err) {
        const message = formatCredentialInitError(err);
        const spanishMsg = /popup|iframe|blocked|not allowed/i.test(message)
          ? 'El navegador o el preview en iFrame bloqueó el widget embebido de Zoho Catalyst. Abre en pestaña nueva o usa Hosted Login.'
          : message || 'No se pudo cargar el acceso embebido de Zoho Catalyst.';
        throw new CleanSlateRepositoryError('EMBEDDED_SIGNIN_FAILED', spanishMsg, 503, {
          origin: 'client_synthetic',
        });
      }
    },
    async generateAuthToken(feature: 'functions'): Promise<CatalystGeneratedAuthToken> {
      const sdk = await ensureSdk();
      return sdk.generateAuthToken(feature);
    },
    async isUserAuthenticated(orgId?: string): Promise<CatalystWebUserSnapshot | false> {
      const sdk = await ensureSdk();
      return sdk.isUserAuthenticated(orgId);
    },
    async signOut(redirectUrl?: string): Promise<void> {
      const sdk = await ensureSdk();
      await sdk.signOut(redirectUrl);
    },
  };

  return sdkInstance;
}

export async function mountEmbeddedSignIn(
  containerId: string,
  onSuccess?: () => void | Promise<void>
): Promise<void> {
  const sdk = createBrowserCatalystWebAuthSdk();
  await sdk.mountEmbeddedSignIn?.(containerId, onSuccess, { redirectUrl: '/auth/callback' });
}
