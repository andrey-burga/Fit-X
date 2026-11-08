import { describe, it, expect, beforeEach } from 'vitest';
import {
  zcAuth,
  UserManagement,
  USER_STATUS,
  getAuthClient,
  setAuthClientForTesting,
  MockCatalystAuthClient,
  type ICatalystUser,
} from '../src/auth/catalystAuth.js';
import { validateLiveEnv } from '../src/config/env.js';

describe('Prueba 1 — Compatibilidad Real del SDK (@zcatalyst/auth)', () => {
  let mockClient: MockCatalystAuthClient;

  beforeEach(() => {
    mockClient = new MockCatalystAuthClient();
    setAuthClientForTesting(mockClient);
  });

  it('debe verificar los exports oficiales del SDK modular @zcatalyst/auth', () => {
    expect(zcAuth).toBeDefined();
    expect(UserManagement).toBeDefined();
    expect(USER_STATUS).toBeDefined();
    expect(USER_STATUS.ENABLE).toBe('enable');
    expect(USER_STATUS.DISABLE).toBe('disable');
  });

  it('debe validar la detección de variables ausentes para credenciales Catalyst', () => {
    const invalidEnv = {
      NODE_ENV: 'test',
      PORT: 3001,
      IS_MOCK_MODE: false,
      CATALYST_APP_NAME: 'vigorcore-poc',
      CATALYST_NOSQL_TABLE: 'VigorCorePoc',
      GCP_PROJECT_ID: 'gen-lang-client-0041212770',
      FIRESTORE_DATABASE_ID: 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
    };

    const validation = validateLiveEnv(invalidEnv);
    expect(validation.isValid).toBe(false);
    expect(validation.missing).toContain('ZC_PROJECT_ID');
    expect(validation.missing).toContain('ZC_CLIENT_ID');
    expect(validation.missing).toContain('ZC_CLIENT_SECRET');
    expect(validation.missing).toContain('ZC_REFRESH_TOKEN');
  });

  it('debe obtener el usuario actual desde el cliente de autenticación', async () => {
    const fictionalUser: ICatalystUser = {
      user_id: '1000000000000001',
      zuid: 'zuid_1001',
      org_id: 'org_1001',
      email_id: 'atleta_poc@vigorcore.local',
      first_name: 'Test',
      last_name: 'Athlete',
      status: 'ACTIVE',
      is_confirmed: true,
      created_time: '2026-11-08T10:00:00Z',
      modified_time: '2026-11-08T10:00:00Z',
      invited_time: '2026-11-08T10:00:00Z',
      role_details: {
        role_id: 'role_athlete_1',
        role_name: 'athlete',
      },
    };

    mockClient.setMockUser(fictionalUser);
    const authClient = getAuthClient();
    const currentUser = await authClient.getCurrentUser();

    expect(currentUser).not.toBeNull();
    expect(currentUser?.user_id).toBe('1000000000000001');
    expect(currentUser?.status).toBe('ACTIVE');
    expect(currentUser?.is_confirmed).toBe(true);
    expect(currentUser?.role_details.role_name).toBe('athlete');
  });

  it('debe manejar adecuadamente sesiones no autenticadas o nulas', async () => {
    mockClient.setMockUser(null);
    const authClient = getAuthClient();
    const currentUser = await authClient.getCurrentUser();
    expect(currentUser).toBeNull();
  });
});
