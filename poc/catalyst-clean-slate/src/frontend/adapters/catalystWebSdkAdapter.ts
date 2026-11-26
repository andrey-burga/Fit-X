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

/**
 * Dynamically resolves Catalyst Web SDK (`@zcatalyst/auth/web`) in memory without importing it
 * eagerly at module startup (prevents unwanted `/__catalyst/sdk/init` fetches in `/` mock mode).
 */
export function createBrowserCatalystWebAuthSdk(
  customLoader?: () => Promise<ICatalystWebAuthSdk | null>
): ICatalystWebAuthSdk {
  let cachedPromise: Promise<ICatalystWebAuthSdk> | null = null;

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

  return {
    async init(): Promise<void> {
      const sdk = await ensureSdk();
      await sdk.init();
    },
    async hostedSignIn(redirectUrl?: string): Promise<void> {
      const sdk = await ensureSdk();
      await sdk.hostedSignIn(redirectUrl);
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
}
