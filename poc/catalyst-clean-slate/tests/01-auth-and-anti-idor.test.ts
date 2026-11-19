/**
 * Classification: PASS-MOCK
 * Covers Phase 4.0.3 Blocker 1 & Phase 4.0.4 Session Continuity — Untrusted Headers Eliminated & Honest Session/Privilege Enforcement:
 * 1. Client modifies `x-vigor-session-epoch` -> rejected (`IDENTITY_SPOOFING_REJECTED`), cannot bypass revocation.
 * 2. Client sends artificially high `roleVersion` (header/query/body) -> rejected (`IDENTITY_SPOOFING_REJECTED`).
 * 3. Client omits both custom headers -> `consistent_read: true` on `Users` drops privilege immediately AND
 *    signed cookie validates `sessionEpoch` + `SESSION#<sid>` without needing custom client headers.
 * 4. User with changed role -> privilege dropped immediately (`403 PERMISSION_DENIED`).
 * 5. Disabled user (`USER_STATUS.DISABLE` / `accountStatus: 'suspended'`) -> rejected (`403`).
 * 6. Missing `Users` record -> rejected (`403 USER_PROFILE_NOT_REGISTERED`, deny-by-default).
 * 7. Authenticated token whose `Users` state does not authorize action (athlete calling admin endpoint) -> rejected (`403`).
 * 8. Invalid, forged, tampered, expired, or missing server-signed HMAC-SHA256 session cookie -> rejected (`401`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_STATUS } from '@zcatalyst/auth';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CleanSlateAuthGuard,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { CleanSlateApiDispatcher, type EndpointResponse } from '../src/routes/apiRouterSchema.js';

const SLATE_ORIGIN = 'https://fit-x-bhnatsxl.onslate.com';

function extractCookieValue(res: EndpointResponse): string {
  const setCookie = res.headers?.['Set-Cookie'] || '';
  const match = setCookie.match(new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`));
  assert.ok(match && match[1], `Missing ${SIGNED_SESSION_COOKIE_NAME} in Set-Cookie`);
  return match[1];
}

function createFixture(nowSec = 1_760_000_000) {
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const sessionManager = new ServerSessionTokenManager(
    {
      activeSecret: ServerSessionTokenManager.generateStrongSecret(),
      nowSecProvider: () => nowSec,
    }
  );
  const guard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);
  const api = new CleanSlateApiDispatcher(guard, athleteService, adminService);
  return { db, authRuntime, sessionManager, guard, athleteService, adminService, api, advanceTime: (sec: number) => { nowSec += sec; } };
}

test('[PASS-MOCK] Scenario 1 & 2: Client manipulating x-vigor-session-epoch or roleVersion (header/query/body) is STRICTLY REJECTED', async () => {
  const { api, authRuntime, db } = createFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_spoof',
    user_id: 'cat_spoof_01',
    email_id: 'spoof@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(boot.status, 200);
  assert.equal((boot.body as any).signedSessionCookie, undefined);
  const validCookie = extractCookieValue(boot);

  await db.updateItem('Users', { pk: 'USER#cat_spoof_01' }, { role: 'athlete', sessionEpoch: 10, roleVersion: 10 });

  // Case 1: Client tampers/sends `x-vigor-session-epoch: 9999` -> rejected (403 IDENTITY_SPOOFING_REJECTED)
  const modEpochRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: {
      'x-vigor-session-epoch': '9999',
      cookie: `${SIGNED_SESSION_COOKIE_NAME}=${validCookie}`,
    },
  });
  assert.equal(modEpochRes.status, 403);
  assert.equal(modEpochRes.body.error, 'IDENTITY_SPOOFING_REJECTED');

  // Case 2: Client sends artificially high `roleVersion` or `x-vigor-role-version` -> rejected (403 IDENTITY_SPOOFING_REJECTED)
  const highRoleVectors = [
    { headers: { origin: SLATE_ORIGIN, 'x-vigor-role-version': '99999', cookie: `${SIGNED_SESSION_COOKIE_NAME}=${validCookie}` } },
    { headers: { origin: SLATE_ORIGIN }, query: { roleVersion: '99999' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
    { headers: { origin: SLATE_ORIGIN }, body: { roleVersion: 99999, displayName: 'Fake' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
    { headers: { origin: SLATE_ORIGIN }, body: { clientRoleVersion: 99999, displayName: 'Fake' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
    { headers: { origin: SLATE_ORIGIN }, body: { clientSessionEpoch: 99999, displayName: 'Fake' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
    { headers: { origin: SLATE_ORIGIN }, body: { role: 'superadmin', displayName: 'Fake' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
    { headers: { origin: SLATE_ORIGIN }, body: { accountStatus: 'active', displayName: 'Fake' }, cookies: { [SIGNED_SESSION_COOKIE_NAME]: validCookie } },
  ];

  for (const vec of highRoleVectors) {
    const res = await api.dispatch('PATCH', '/api/v1/athlete/profile', vec);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'IDENTITY_SPOOFING_REJECTED');
  }
});

test('[PASS-MOCK] Scenario 3 & 4: Omitting headers still enforces consistent_read role & revoked server-signed session immediately', async () => {
  const { api, authRuntime, db } = createFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_demote',
    user_id: 'cat_adm_01',
    email_id: 'admin1@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  await db.updateItem('Users', { pk: 'USER#cat_adm_01' }, { role: 'admin', roleVersion: 2, sessionEpoch: 2 });

  // Issue authentic server-signed cookie bound to (cat_adm_01, ep=2)
  const exch = await api.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(exch.status, 200);
  assert.ok(exch.headers?.['Set-Cookie']?.includes('HttpOnly'));
  assert.ok(exch.headers?.['Set-Cookie']?.includes('SameSite=Strict'));
  const adminCookie = extractCookieValue(exch);

  // Sanity: Admin succeeds with ONLY signed HttpOnly cookie (zero custom epoch/role headers!)
  db.fetchAuditTrail.length = 0;
  const okAdmin = await api.dispatch('GET', '/api/v1/admin/stats', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: adminCookie },
  });
  assert.equal(okAdmin.status, 200);
  // Prove `Users` & `SystemControl` (`SESSION#<sid>`) fetches used exact `consistent_read: true`
  assert.ok(
    db.fetchAuditTrail.some(f => f.table === 'Users' && f.pk === 'USER#cat_adm_01' && f.consistent_read === true)
  );
  assert.ok(
    db.fetchAuditTrail.some(f => f.table === 'SystemControl' && f.pk.startsWith('SESSION#') && f.consistent_read === true)
  );

  // Case 4a: Role changed in Users from 'admin' -> 'athlete' WITHOUT bumping sessionEpoch yet:
  // Consistent read on Users STILL drops privilege immediately -> 403 PERMISSION_DENIED
  await db.updateItem('Users', { pk: 'USER#cat_adm_01' }, { role: 'athlete', roleVersion: 3 });
  const droppedPrivilegeRes = await api.dispatch('GET', '/api/v1/admin/users', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: adminCookie },
  });
  assert.equal(droppedPrivilegeRes.status, 403);
  assert.equal(droppedPrivilegeRes.body.error, 'PERMISSION_DENIED');

  // Case 4b: Server bumps sessionEpoch -> stale server-signed cookie (ep=2 < Users.sessionEpoch=3) is revoked immediately (401)
  await db.updateItem('Users', { pk: 'USER#cat_adm_01' }, { sessionEpoch: 3 });
  const revokedSessionRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: adminCookie },
  });
  assert.equal(revokedSessionRes.status, 401);
  assert.equal(revokedSessionRes.body.error, 'SESSION_REVOKED_REAUTH_REQUIRED');
});

test('[PASS-MOCK] Scenario 5: Disabled user (USER_STATUS.DISABLE & accountStatus=suspended) is rejected immediately', async () => {
  const { api, authRuntime, db } = createFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_dis',
    user_id: 'cat_dis_1',
    email_id: 'disabled@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  const cookie = extractCookieValue(boot);

  // 1) Suspended in Users
  await db.updateItem('Users', { pk: 'USER#cat_dis_1' }, { accountStatus: 'suspended', sessionEpoch: 2 });
  const suspendedRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
  });
  assert.equal(suspendedRes.status, 403);
  assert.equal(suspendedRes.body.error, 'ACCOUNT_SUSPENDED');

  // 2) Disabled in Catalyst Auth via real USER_STATUS.DISABLE enum
  await authRuntime.updateUserStatus('cat_dis_1', USER_STATUS.DISABLE);
  const disabledRes = await api.dispatch('GET', '/api/v1/auth/me', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
  });
  assert.equal(disabledRes.status, 403);
  assert.equal(disabledRes.body.error, 'CATALYST_USER_DISABLED');
});

test('[PASS-MOCK] Scenario 6 & 7: Missing Users profile denied by default & authorized token lacking Users role rejected', async () => {
  const { api, authRuntime } = createFixture();

  // 6) Valid Catalyst identity, but NO Users profile -> 403 USER_PROFILE_NOT_REGISTERED
  authRuntime.setCurrentUser({
    zuid: 'z_missing',
    user_id: 'cat_missing_user',
    email_id: 'ghost@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const meRes = await api.dispatch('GET', '/api/v1/auth/me', {});
  assert.equal(meRes.status, 403);
  assert.equal(meRes.body.error, 'USER_PROFILE_NOT_REGISTERED');

  const wsRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {});
  assert.equal(wsRes.status, 403);
  assert.equal(wsRes.body.error, 'USER_PROFILE_NOT_REGISTERED');

  // 7) Valid signed athlete session attempts admin action -> 403 PERMISSION_DENIED
  const boot = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  const athCookie = extractCookieValue(boot);
  const athCallingAdmin = await api.dispatch('POST', '/api/v1/admin/invitations', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: athCookie },
    body: { targetEmail: 'hacker@vigor.co', targetRole: 'admin' },
  });
  assert.equal(athCallingAdmin.status, 403);
  assert.equal(athCallingAdmin.body.error, 'PERMISSION_DENIED');
});

test('[PASS-MOCK] Scenario 8: Invalid, forged, tampered, wrong-subject, expired, or missing server-signed session token is rejected (401)', async () => {
  const { api, authRuntime, sessionManager, advanceTime } = createFixture(1_760_000_000);
  authRuntime.setCurrentUser({
    zuid: 'z_tok',
    user_id: 'cat_tok_01',
    email_id: 'tok@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  const genuineToken = extractCookieValue(boot);

  // Missing signed cookie on protected route -> 401 SIGNED_SESSION_REQUIRED
  const missingRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {});
  assert.equal(missingRes.status, 401);
  assert.equal(missingRes.body.error, 'SIGNED_SESSION_REQUIRED');

  // Forged payload trying to bump `ep` with stolen/old signature -> 401 INVALID_SIGNED_SESSION
  const [, genuineSig] = genuineToken.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({
      v: 1,
      kid: 'k1',
      iss: 'vigorcore-auth',
      aud: 'vigorcore-api',
      env: 'development',
      sub: 'cat_tok_01',
      ep: 9999,
      sid: 'forged_sid_123456',
      iat: 1_760_000_000,
      exp: 1_900_000_000,
    }),
    'utf8'
  ).toString('base64url');
  const tamperedRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: `${forgedPayload}.${genuineSig}` },
  });
  assert.equal(tamperedRes.status, 401);
  assert.equal(tamperedRes.body.error, 'INVALID_SIGNED_SESSION');

  // Signed by wrong secret -> 401 INVALID_SIGNED_SESSION
  const rogueSigner = new ServerSessionTokenManager(
    ServerSessionTokenManager.generateStrongSecret(),
    () => 1_760_000_000
  );
  const rogueToken = rogueSigner.issueToken('cat_tok_01', 1);
  const rogueRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: rogueToken },
  });
  assert.equal(rogueRes.status, 401);
  assert.equal(rogueRes.body.error, 'INVALID_SIGNED_SESSION');

  // Signed for wrong user_id -> 401 INVALID_SIGNED_SESSION
  const otherUserToken = sessionManager.issueToken('cat_victim_99', 1);
  const wrongSubRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: otherUserToken },
  });
  assert.equal(wrongSubRes.status, 401);
  assert.equal(wrongSubRes.body.error, 'INVALID_SIGNED_SESSION');

  // Expired server-signed cookie -> 401 INVALID_SIGNED_SESSION
  advanceTime(24 * 3600);
  const expiredRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: genuineToken },
  });
  assert.equal(expiredRes.status, 401);
  assert.equal(expiredRes.body.error, 'INVALID_SIGNED_SESSION');
});

test('[PASS-MOCK] Non-unique GSI_Email fails closed if duplicate email anomaly exists across different user_id values', async () => {
  const { api, authRuntime, db } = createFixture();
  await db.insertItem('Users', {
    pk: 'USER#cat_first',
    uid: 'cat_first',
    email: 'shared@vigor.co',
    normalizedEmail: 'shared@vigor.co',
    displayName: 'First User',
    role: 'athlete',
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active',
    emailVerified: true,
    authProvider: 'catalyst_auth',
    directorySegment: 'USER_SEG#0',
    onboardingCompleted: false,
    onboardingStep: 1,
    createdAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z',
    lastSignInAt: '2026-11-13T00:00:00Z',
  });

  authRuntime.setCurrentUser({
    zuid: 'z_dup',
    user_id: 'cat_second',
    email_id: 'Shared@Vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  const res = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'DUPLICATE_EMAIL_ANOMALY');
});
