import { zcAuth, UserManagement, USER_STATUS } from '@zcatalyst/auth';
import { loadEnvConfig, validateLiveEnv } from '../config/env.js';

export { zcAuth, UserManagement, USER_STATUS };

export interface ICatalystUser {
  zuid: string;
  zaaid?: string;
  org_id: string;
  status: string;
  user_id: string;
  is_confirmed: boolean;
  email_id: string;
  first_name: string;
  last_name: string;
  created_time: string;
  modified_time: string;
  invited_time: string;
  role_details: {
    role_id: string;
    role_name: string;
  };
}

export interface ICatalystAuthClient {
  initApp(): Promise<unknown>;
  getCurrentUser(req?: unknown): Promise<ICatalystUser | null>;
}

class LiveCatalystAuthClient implements ICatalystAuthClient {
  private appInstance: unknown = null;

  async initApp(): Promise<unknown> {
    if (this.appInstance) return this.appInstance;

    const env = loadEnvConfig();
    const validation = validateLiveEnv(env);
    if (!validation.isValid) {
      throw new Error(`Cannot initialize live Catalyst Auth. Missing: ${validation.missing.join(', ')}`);
    }

    this.appInstance = await zcAuth.init(
      {
        projectId: String(env.ZC_PROJECT_ID),
        environment: 'Development',
        client_id: env.ZC_CLIENT_ID!,
        client_secret: env.ZC_CLIENT_SECRET!,
        refresh_token: env.ZC_REFRESH_TOKEN!,
      },
      {
        appName: env.CATALYST_APP_NAME,
        scope: 'admin',
      }
    );

    return this.appInstance;
  }

  async getCurrentUser(req?: unknown): Promise<ICatalystUser | null> {
    const app = await this.initApp();
    const userManagement = new UserManagement(app);
    try {
      const user = await userManagement.getCurrentUser();
      return (user as unknown as ICatalystUser) || null;
    } catch {
      return null;
    }
  }
}

export class MockCatalystAuthClient implements ICatalystAuthClient {
  private mockUser: ICatalystUser | null = null;
  private shouldThrowError = false;

  setMockUser(user: ICatalystUser | null, shouldThrow = false) {
    this.mockUser = user;
    this.shouldThrowError = shouldThrow;
  }

  async initApp(): Promise<unknown> {
    return { name: 'mock-catalyst-app' };
  }

  async getCurrentUser(_req?: unknown): Promise<ICatalystUser | null> {
    if (this.shouldThrowError) {
      throw new Error('Catalyst session token expired or invalid');
    }
    return this.mockUser;
  }
}

// Singleton provider allowing runtime mock injection for tests
let authClientInstance: ICatalystAuthClient = new MockCatalystAuthClient();

export function setAuthClientForTesting(client: ICatalystAuthClient) {
  authClientInstance = client;
}

export function getAuthClient(): ICatalystAuthClient {
  const env = loadEnvConfig();
  if (!env.IS_MOCK_MODE && !(authClientInstance instanceof LiveCatalystAuthClient)) {
    authClientInstance = new LiveCatalystAuthClient();
  }
  return authClientInstance;
}
