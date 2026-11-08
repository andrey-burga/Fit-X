import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createPocServer } from '../src/server.js';
import { setAuthClientForTesting, MockCatalystAuthClient, type ICatalystUser } from '../src/auth/catalystAuth.js';

describe('Prueba 2 — Authentication Endpoint GET /poc/me', () => {
  let mockClient: MockCatalystAuthClient;
  const app = createPocServer();

  beforeEach(() => {
    mockClient = new MockCatalystAuthClient();
    setAuthClientForTesting(mockClient);
  });

  it('debe responder 401 si no hay sesión activa (usuario null)', async () => {
    mockClient.setMockUser(null);

    const res = await request(app).get('/poc/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('debe responder 200 con datos no sensibles si el usuario está activo y confirmado', async () => {
    const validUser: ICatalystUser = {
      user_id: 'user_active_123',
      zuid: 'zuid_active',
      org_id: 'org_main',
      email_id: 'atleta@vigorcore.local',
      first_name: 'Fictional',
      last_name: 'User',
      status: 'ACTIVE',
      is_confirmed: true,
      created_time: '2026-11-08T10:00:00Z',
      modified_time: '2026-11-08T10:00:00Z',
      invited_time: '2026-11-08T10:00:00Z',
      role_details: {
        role_id: 'role_athlete',
        role_name: 'athlete',
      },
    };

    mockClient.setMockUser(validUser);

    const res = await request(app).get('/poc/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe('user_active_123');
    expect(res.body.data.email).toBe('atleta@vigorcore.local');
    expect(res.body.data.role).toBe('athlete');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.isConfirmed).toBe(true);
    // Security check: Never expose internal zuid, org_id, etc.
    expect(res.body.data.zuid).toBeUndefined();
    expect(res.body.data.org_id).toBeUndefined();
  });

  it('debe rechazar con 403 si el usuario está deshabilitado (status !== ACTIVE)', async () => {
    const disabledUser: ICatalystUser = {
      user_id: 'user_disabled_456',
      zuid: 'zuid_disabled',
      org_id: 'org_main',
      email_id: 'deshabilitado@vigorcore.local',
      first_name: 'Disabled',
      last_name: 'User',
      status: 'DISABLED',
      is_confirmed: true,
      created_time: '2026-11-08T10:00:00Z',
      modified_time: '2026-11-08T10:00:00Z',
      invited_time: '2026-11-08T10:00:00Z',
      role_details: {
        role_id: 'role_athlete',
        role_name: 'athlete',
      },
    };

    mockClient.setMockUser(disabledUser);

    const res = await request(app).get('/poc/me');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('ACCOUNT_DISABLED');
  });

  it('debe rechazar con 403 si la cuenta no está confirmada (is_confirmed: false) independientemente del status', async () => {
    const unconfirmedUser: ICatalystUser = {
      user_id: 'user_unconfirmed_789',
      zuid: 'zuid_unconfirmed',
      org_id: 'org_main',
      email_id: 'noconfirmado@vigorcore.local',
      first_name: 'Unconfirmed',
      last_name: 'User',
      status: 'ACTIVE',
      is_confirmed: false, // Pending email confirmation
      created_time: '2026-11-08T10:00:00Z',
      modified_time: '2026-11-08T10:00:00Z',
      invited_time: '2026-11-08T10:00:00Z',
      role_details: {
        role_id: 'role_athlete',
        role_name: 'athlete',
      },
    };

    mockClient.setMockUser(unconfirmedUser);

    const res = await request(app).get('/poc/me');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('ACCOUNT_UNCONFIRMED');
  });

  it('debe rechazar inmediatamente cualquier intento de suplantación mediante cabecera x-user-id', async () => {
    const res = await request(app)
      .get('/poc/me')
      .set('x-user-id', 'attacker_arbitrary_uid');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('IDENTITY_SPOOFING_REJECTED');
  });

  it('debe responder 401 si el cliente de autenticación lanza una excepción', async () => {
    mockClient.setMockUser(null, true);

    const res = await request(app).get('/poc/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('AUTH_VERIFICATION_FAILED');
  });
});
