import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createPocServer } from '../src/server.js';
import { setAuthClientForTesting, MockCatalystAuthClient, type ICatalystUser } from '../src/auth/catalystAuth.js';
import { TestRepository } from '../src/nosql/testRepository.js';
import { InMemoryNoSQLAdapter, setStorageAdapterForTesting } from '../src/nosql/catalystNosql.js';

describe('Prueba 7 — Privacidad e Invariante de Aislamiento entre Atletas', () => {
  let mockClient: MockCatalystAuthClient;
  let repository: TestRepository;
  const app = createPocServer();

  const athleteA: ICatalystUser = {
    user_id: 'POC_ATHLETE_A',
    zuid: 'zuid_a',
    org_id: 'org_main',
    email_id: 'atleta_a@fictional.local',
    first_name: 'Fictional',
    last_name: 'Athlete A',
    status: 'ACTIVE',
    is_confirmed: true,
    created_time: '2026-11-08T10:00:00Z',
    modified_time: '2026-11-08T10:00:00Z',
    invited_time: '2026-11-08T10:00:00Z',
    role_details: { role_id: 'role_athlete', role_name: 'athlete' },
  };

  const athleteB: ICatalystUser = {
    user_id: 'POC_ATHLETE_B',
    zuid: 'zuid_b',
    org_id: 'org_main',
    email_id: 'atleta_b@fictional.local',
    first_name: 'Fictional',
    last_name: 'Athlete B',
    status: 'ACTIVE',
    is_confirmed: true,
    created_time: '2026-11-08T10:00:00Z',
    modified_time: '2026-11-08T10:00:00Z',
    invited_time: '2026-11-08T10:00:00Z',
    role_details: { role_id: 'role_athlete', role_name: 'athlete' },
  };

  beforeEach(async () => {
    const memoryAdapter = new InMemoryNoSQLAdapter();
    setStorageAdapterForTesting(memoryAdapter);
    repository = new TestRepository('VigorCorePoc');
    mockClient = new MockCatalystAuthClient();
    setAuthClientForTesting(mockClient);

    // Seed fictional private records for Athlete A and Athlete B
    await repository.insertFictionalItem('POC#3.2#ATHLETE#POC_ATHLETE_A', 'RECORD#REC_A_1', {
      ownerUid: 'POC_ATHLETE_A',
      fictionalMetric: 'Fictional Heart Rate',
      fictionalValue: 65,
    });

    await repository.insertFictionalItem('POC#3.2#ATHLETE#POC_ATHLETE_B', 'RECORD#REC_B_1', {
      ownerUid: 'POC_ATHLETE_B',
      fictionalMetric: 'Fictional Heart Rate',
      fictionalValue: 72,
    });
  });

  it('debe permitir que el Atleta A acceda a su propio registro privado', async () => {
    mockClient.setMockUser(athleteA);

    const res = await request(app).get('/poc/nosql/athlete/record/REC_A_1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ownerUid).toBe('POC_ATHLETE_A');
    expect(res.body.data.fictionalValue).toBe(65);
  });

  it('debe permitir que el Atleta B acceda a su propio registro privado', async () => {
    mockClient.setMockUser(athleteB);

    const res = await request(app).get('/poc/nosql/athlete/record/REC_B_1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ownerUid).toBe('POC_ATHLETE_B');
    expect(res.body.data.fictionalValue).toBe(72);
  });

  it('debe impedir que el Atleta A acceda al registro del Atleta B', async () => {
    mockClient.setMockUser(athleteA);

    // Athlete A attempts to request REC_B_1
    const res = await request(app).get('/poc/nosql/athlete/record/REC_B_1');
    // Because partitions are scoped by authenticated session UID (POC#3.2#ATHLETE#POC_ATHLETE_A), REC_B_1 does not exist in A's partition
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RECORD_NOT_FOUND');
  });

  it('debe rechazar con 403 si un cliente intenta manipular el ownerUid mediante query parameter', async () => {
    mockClient.setMockUser(athleteA);

    // Attempting query parameter injection (?ownerUid=POC_ATHLETE_B)
    const res = await request(app).get('/poc/nosql/athlete/record/REC_A_1?ownerUid=POC_ATHLETE_B');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UID_MANIPULATION_ATTEMPT_REJECTED');
  });
});
