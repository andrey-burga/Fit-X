/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2.3 — Session Lifecycle & Bound CSRF Adversarial Test Suite
 *
 * SCOPE CLASSIFICATION:
 * - [PASS-UNIT] Direct HMAC token & bound CSRF cryptographic checks (`ServerSessionTokenManager`, `HttpSecurityPolicy`).
 * - [PASS-MOCK / LOOPBACK HTTP] Adversarial dispatch & Express loopback checks against in-memory NoSQL +
 *   `MockCatalystAuthRuntime` covering Phase 4.1.5 lifecycle & first-exchange CSRF guarantees.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CleanSlateApiDispatcher } from '../src/routes/apiRouterSchema.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  AuthGuardError,
  CleanSlateAuthGuard,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import { HttpSecurityPolicy } from '../src/security/httpSecurityPolicy.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { KeyBuilders, type SessionRecordItem } from '../src/types/cleanSlate.js';

const SLATE_ORIGIN = 'https://fit-x-bhnatsxl.onslate.com';
const EVIL_ORIGIN = 'https://attacker.example.com';

function createAdversarialFixture(initialNowSec = 1_760_300_000) {
  let nowSec = initialNowSec;
  const secret = ServerSessionTokenManager.generateStrongSecret(32);
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const sessionManager = new ServerSessionTokenManager({
    activeSecret: secret,
    activeKeyId: 'k1',
    environment: 'test',
    nowSecProvider: () => nowSec,
  });
  const authGuard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);
  const httpPolicy = new HttpSecurityPolicy({
    allowedOrigins: [SLATE_ORIGIN],
    enforceFetchMetadata: true,
    requireOriginOnMutations: true,
    requireCsrfHeaderOnMutations: true,
    enforceSignedCsrfTokens: true,
  });
  const dispatcher = new CleanSlateApiDispatcher(authGuard, athleteService, adminService, httpPolicy);

  return {
    secret,
    db,
    authRuntime,
    authGuard,
    sessionManager,
    httpPolicy,
    dispatcher,
    getNowSec: () => nowSec,
    advanceTime: (sec: number) => {
      nowSec += sec;
    },
  };
}

function extractCookieValue(headers: Record<string, string> | undefined): string {
  const raw = headers?.['Set-Cookie'] ?? '';
  const m = raw.match(new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]+)`));
  assert.ok(m && m[1], `Expected non-empty Set-Cookie, got '${raw}'`);
  return m[1];
}

test('[PASS-UNIT / MOCK] Pre-session exchange CSRF policy rejects missing Origin, cross-site Fetch Metadata & missing X-Vigor-Requested-With, and emits no dummy /csrf route', async () => {
  const { dispatcher, authRuntime } = createAdversarialFixture();

  authRuntime.setCurrentUser({
    zuid: 'z_adv_1',
    user_id: 'cat_adv_1',
    email_id: 'adv1@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
    first_name: 'Adv',
    last_name: 'User',
  });

  // 1. Ensure dummy /api/v1/auth/csrf endpoint DOES NOT EXIST
  const dummyCsrf = await dispatcher.dispatch('GET', '/api/v1/auth/csrf', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(dummyCsrf.status, 404);
  assert.equal(dummyCsrf.body.error, 'ROUTE_NOT_FOUND');

  // 2. Missing Origin + Referer -> 403 CSRF_ORIGIN_REQUIRED
  const noOrigin = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.body.error, 'CSRF_ORIGIN_REQUIRED');

  // 3. Unallowlisted Origin -> 403 CORS_ORIGIN_REJECTED
  const badOrigin = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: EVIL_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.body.error, 'CORS_ORIGIN_REJECTED');

  // 4. Cross-site Sec-Fetch-Site -> 403 CSRF_CROSS_SITE_REJECTED
  const crossSite = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: {
      origin: SLATE_ORIGIN,
      'sec-fetch-site': 'cross-site',
      'x-vigor-requested-with': 'VigorCore-CleanSlate',
    },
    body: {},
  });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.body.error, 'CSRF_CROSS_SITE_REJECTED');

  // 5. Missing X-Vigor-Requested-With -> 403 CSRF_TOKEN_MISSING
  const missingReqWith = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN, 'sec-fetch-site': 'same-site' },
    body: {},
  });
  assert.equal(missingReqWith.status, 403);
  assert.equal(missingReqWith.body.error, 'CSRF_TOKEN_MISSING');

  // 6. Malformed header CRLF injection -> 403 CSRF_TOKEN_INVALID
  const badReqWith = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: {
      origin: SLATE_ORIGIN,
      'sec-fetch-site': 'same-site',
      'x-vigor-requested-with': 'Vigor\r\nEvil: 1',
    },
    body: {},
  });
  assert.equal(badReqWith.status, 403);
  assert.equal(badReqWith.body.error, 'CSRF_TOKEN_INVALID');

  // 7. Valid first-exchange succeeds, binds CSRF token to (sub, sid, ep) and exposes header + body
  const okBoot = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: {
      origin: SLATE_ORIGIN,
      'sec-fetch-site': 'same-site',
      'x-vigor-requested-with': 'VigorCore-CleanSlate',
    },
    body: {},
  });
  assert.equal(okBoot.status, 200);
  const csrfToken = String(okBoot.body.csrfToken);
  assert.ok(csrfToken.length > 40);
  assert.equal(okBoot.headers?.['X-Vigor-CSRF-Token'], csrfToken);
  assert.ok((okBoot.headers?.['Access-Control-Expose-Headers'] ?? '').includes('X-Vigor-CSRF-Token'));
  assert.ok((okBoot.headers?.['Access-Control-Allow-Headers'] ?? '').includes('X-Vigor-Requested-With'));

  const cookie = extractCookieValue(okBoot.headers);

  // 8. Pre-session /exchange also works cleanly with X-Vigor-Requested-With & returns fresh bound CSRF
  const okExch = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: {
      origin: SLATE_ORIGIN,
      'sec-fetch-site': 'same-site',
      'x-vigor-requested-with': 'VigorCore-CleanSlate',
    },
    body: {},
  });
  assert.equal(okExch.status, 200);
  assert.notEqual(okExch.body.csrfToken, csrfToken);
  assert.notEqual(extractCookieValue(okExch.headers), cookie);
});

test('[PASS-MOCK] Bound CSRF adversarial matrix: wrong secret, mismatch (sub/sid/ep), expired CSRF, token-type confusion, and pre-revocation guard on /refresh & /logout', async () => {
  const fx = createAdversarialFixture();
  const { dispatcher, authRuntime, db, sessionManager, secret, getNowSec, advanceTime } = fx;

  authRuntime.setCurrentUser({
    zuid: 'z_csrf_u1',
    user_id: 'cat_csrf_u1',
    email_id: 'csrf1@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  const boot1 = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(boot1.status, 200);
  const cookie1 = extractCookieValue(boot1.headers);
  const sid1 = String(boot1.body.sid);
  const csrf1 = String(boot1.body.csrfToken);

  // Switch to cookie-only routine mode (no Catalyst request context)
  authRuntime.setCurrentUser(null);

  // 1. Missing X-Vigor-CSRF on routine mutation -> 403 CSRF_TOKEN_MISSING
  const missingCsrf = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: { displayName: 'Should Fail' },
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.error, 'CSRF_TOKEN_MISSING');

  // 2. Forged CSRF signed by attacker secret -> 403 CSRF_TOKEN_INVALID
  const attackerMgr = new ServerSessionTokenManager({
    activeSecret: ServerSessionTokenManager.generateStrongSecret(32),
    environment: 'test',
    nowSecProvider: getNowSec,
  });
  const forgedCsrf = attackerMgr.issueCsrfToken('cat_csrf_u1', sid1, 1);
  const badSig = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': forgedCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: { displayName: 'Forged' },
  });
  assert.equal(badSig.status, 403);
  assert.equal(badSig.body.error, 'CSRF_TOKEN_INVALID');

  // 3. Token-type confusion: passing CSRF token inside session cookie -> 401 INVALID_SIGNED_SESSION
  const csrfAsCookie = await dispatcher.dispatch('GET', '/api/v1/auth/me', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: csrf1 },
  });
  assert.equal(csrfAsCookie.status, 401);
  assert.equal(csrfAsCookie.body.error, 'INVALID_SIGNED_SESSION');

  // 4. Token-type confusion: passing session cookie inside X-Vigor-CSRF header -> 403 CSRF_TOKEN_INVALID
  const cookieAsCsrf = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': cookie1 },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: { displayName: 'Confused' },
  });
  assert.equal(cookieAsCsrf.status, 403);
  assert.equal(cookieAsCsrf.body.error, 'CSRF_TOKEN_INVALID');

  // 5. Foreign subject / foreign sid / stale sessionEpoch -> 403 CSRF_TOKEN_SESSION_MISMATCH
  for (const mismatchedToken of [
    sessionManager.issueCsrfToken('cat_other_user', sid1, 1),
    sessionManager.issueCsrfToken('cat_csrf_u1', '0123456789abcdef0123456789abcdef', 1),
    sessionManager.issueCsrfToken('cat_csrf_u1', sid1, 2),
  ]) {
    const mismatchRes = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
      headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': mismatchedToken },
      cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
      body: { displayName: 'Mismatch' },
    });
    assert.equal(mismatchRes.status, 403);
    assert.equal(mismatchRes.body.error, 'CSRF_TOKEN_SESSION_MISMATCH');
  }

  // 6. Expired CSRF token while session cookie is still active -> 403 CSRF_TOKEN_EXPIRED
  const shortCsrfMgr = new ServerSessionTokenManager({
    activeSecret: secret,
    activeKeyId: 'k1',
    environment: 'test',
    defaultTtlSec: 30,
    nowSecProvider: getNowSec,
  });
  const shortCsrf = shortCsrfMgr.issueCsrfToken('cat_csrf_u1', sid1, 1);
  advanceTime(31);
  const expiredCsrfRes = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': shortCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: { displayName: 'ExpiredCsrf' },
  });
  assert.equal(expiredCsrfRes.status, 403);
  assert.equal(expiredCsrfRes.body.error, 'CSRF_TOKEN_EXPIRED');

  // 7. CRITICAL: /refresh and /logout reject bad CSRF BEFORE revoking oldSid!
  const badRefresh = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': forgedCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: {},
  });
  assert.equal(badRefresh.status, 403);
  assert.equal(badRefresh.body.error, 'CSRF_TOKEN_INVALID');

  const badLogout = await dispatcher.dispatch('POST', '/api/v1/auth/session/logout', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': shortCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: {},
  });
  assert.equal(badLogout.status, 403);
  assert.equal(badLogout.body.error, 'CSRF_TOKEN_EXPIRED');

  // Prove sid1 is STILL active in SystemControl and works with genuine csrf1
  const sessRecBefore = await db.fetchItem<SessionRecordItem>(
    'SystemControl',
    { pk: KeyBuilders.sessionPk(sid1) },
    { consistent_read: true }
  );
  assert.equal(sessRecBefore?.status, 'active');

  const validPatch = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrf1 },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: { displayName: 'Csrf Verified Athlete' },
  });
  assert.equal(validPatch.status, 200);

  // 8. Refresh rotates sid AND invalidates old CSRF token for new session cookie
  const refreshed = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrf1 },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie1 },
    body: {},
  });
  assert.equal(refreshed.status, 200);
  const cookie2 = extractCookieValue(refreshed.headers);
  const csrf2 = String(refreshed.body.csrfToken);
  assert.notEqual(csrf2, csrf1);

  const staleCsrfOnNewCookie = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrf1 },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
    body: { displayName: 'OldCsrfOnNewCookie' },
  });
  assert.equal(staleCsrfOnNewCookie.status, 403);
  assert.equal(staleCsrfOnNewCookie.body.error, 'CSRF_TOKEN_SESSION_MISMATCH');

  // 9. GET /auth/me re-hydrates a valid bound CSRF token in both body & header
  const meRes = await dispatcher.dispatch('GET', '/api/v1/auth/me', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
  });
  assert.equal(meRes.status, 200);
  const meCsrf = String(meRes.body.csrfToken);
  assert.equal(meRes.headers?.['X-Vigor-CSRF-Token'], meCsrf);

  const patchAfterMe = await dispatcher.dispatch('PATCH', '/api/v1/athlete/profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': meCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
    body: { displayName: 'Hydrated From Me' },
  });
  assert.equal(patchAfterMe.status, 200);
});

test('[PASS-MOCK] Phase 4.1.5 Session Lifecycle: 12h idle expiry, 24h absolute ceiling clamping, <=5s rotated grace vs >5s/refresh replay escalation', async () => {
  const fx = createAdversarialFixture(1_760_400_000);
  const { dispatcher, authRuntime, advanceTime } = fx;

  authRuntime.setCurrentUser({
    zuid: 'z_life_1',
    user_id: 'cat_life_1',
    email_id: 'life1@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  // A. Idle 12h (43200s) expiration without refresh
  const bootIdle = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(bootIdle.status, 200);
  const idleCookie = extractCookieValue(bootIdle.headers);
  const initialAuthAt = Number(bootIdle.body.expiresAtEpochSec) - 12 * 3600;
  assert.equal(Number(bootIdle.body.absoluteExpiresAtEpochSec), initialAuthAt + 24 * 3600);

  advanceTime(12 * 3600 - 1);
  const stillAlive = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: idleCookie },
  });
  assert.equal(stillAlive.status, 200);

  advanceTime(2); // now >= 12h
  const idleExpired = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: idleCookie },
  });
  assert.equal(idleExpired.status, 401);
  assert.equal(idleExpired.body.error, 'INVALID_SIGNED_SESSION');

  // B. 24h absolute ceiling clamping across refreshes
  const boot24 = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(boot24.status, 200);
  const start24 = fx.getNowSec();
  let curCookie = extractCookieValue(boot24.headers);
  let curCsrf = String(boot24.body.csrfToken);

  // Switch to cookie-only routine calls (authRuntime.usersById retains user for getUserDetails)
  authRuntime.setCurrentUser(null);

  // Advance +10h -> refresh -> expiresAtEpochSec should be +22h (<= 24h)
  advanceTime(10 * 3600);
  const ref1 = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': curCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: curCookie },
    body: {},
  });
  assert.equal(ref1.status, 200);
  assert.equal(Number(ref1.body.expiresAtEpochSec), start24 + 22 * 3600);
  assert.equal(Number(ref1.body.absoluteExpiresAtEpochSec), start24 + 24 * 3600);

  // Save ref1 cookie to test >5s replay after ref2 later
  const ref1Cookie = extractCookieValue(ref1.headers);
  const ref1Csrf = String(ref1.body.csrfToken);

  // Advance another +10h (now t = start + 20h) -> refresh -> MUST clamp expiresAtEpochSec to start + 24h!
  advanceTime(10 * 3600);
  const ref2 = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': ref1Csrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: ref1Cookie },
    body: {},
  });
  assert.equal(ref2.status, 200);
  assert.equal(Number(ref2.body.expiresAtEpochSec), start24 + 24 * 3600);
  assert.equal(Number(ref2.body.absoluteExpiresAtEpochSec), start24 + 24 * 3600);
  const ref2Cookie = extractCookieValue(ref2.headers);

  // C. <= 5s rotated grace on safe read does NOT escalate sessionEpoch
  advanceTime(3);
  const graceRead = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: ref1Cookie },
  });
  assert.equal(graceRead.status, 401);
  assert.equal(graceRead.body.error, 'SESSION_ROTATED_RETRY');
  assert.equal(graceRead.headers?.['Set-Cookie'], undefined);

  // New cookie ref2 still works!
  const ref2Works = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: ref2Cookie },
  });
  assert.equal(ref2Works.status, 200);

  // D. > 5s replay of rotated ref1Cookie triggers SESSION_REPLAY_DETECTED, bumps sessionEpoch & emits Max-Age=0, revoking ref2!
  advanceTime(4); // 3 + 4 = 7s > 5s
  const replayDetected = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: ref1Cookie },
  });
  assert.equal(replayDetected.status, 401);
  assert.equal(replayDetected.body.error, 'SESSION_REPLAY_DETECTED');
  assert.match(replayDetected.headers?.['Set-Cookie'] ?? '', /Max-Age=0/);

  // ref2 is now globally revoked via sessionEpoch++
  const ref2AfterReplay = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: ref2Cookie },
  });
  assert.equal(ref2AfterReplay.status, 401);
  assert.equal(ref2AfterReplay.body.error, 'SESSION_REVOKED_REAUTH_REQUIRED');

  // E. Re-login and verify /refresh with a rotated cookie EVEN at <= 5s escalates immediately!
  authRuntime.setCurrentUser({
    zuid: 'z_life_1',
    user_id: 'cat_life_1',
    email_id: 'life1@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const bootReplayRef = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  const cOld = extractCookieValue(bootReplayRef.headers);
  const csrfOld = String(bootReplayRef.body.csrfToken);
  authRuntime.setCurrentUser(null);

  const refValid = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrfOld },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cOld },
    body: {},
  });
  assert.equal(refValid.status, 200);
  const cNew = extractCookieValue(refValid.headers);

  advanceTime(1); // Only 1s, well within 5s read grace — but /refresh replay MUST NEVER get grace!
  const replayOnRefresh = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrfOld },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cOld },
    body: {},
  });
  assert.equal(replayOnRefresh.status, 401);
  assert.equal(replayOnRefresh.body.error, 'SESSION_REPLAY_DETECTED');
  assert.match(replayOnRefresh.headers?.['Set-Cookie'] ?? '', /Max-Age=0/);

  const cNewRevoked = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cNew },
  });
  assert.equal(cNewRevoked.status, 401);
  assert.equal(cNewRevoked.body.error, 'SESSION_REVOKED_REAUTH_REQUIRED');

  // F. Exceeding 24h ceiling denies refresh with SESSION_MAX_LIFETIME_REACHED or INVALID_SIGNED_SESSION
  authRuntime.setCurrentUser({
    zuid: 'z_life_1',
    user_id: 'cat_life_1',
    email_id: 'life1@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const bootCeil = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  curCookie = extractCookieValue(bootCeil.headers);
  curCsrf = String(bootCeil.body.csrfToken);
  authRuntime.setCurrentUser(null);

  advanceTime(24 * 3600 + 1);
  const over24h = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': curCsrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: curCookie },
    body: {},
  });
  assert.equal(over24h.status, 401);
  assert.ok(
    over24h.body.error === 'INVALID_SIGNED_SESSION' ||
      over24h.body.error === 'SESSION_MAX_LIFETIME_REACHED'
  );
});

test('[PASS-MOCK] Catalyst getUserDetails <=15m revalidation throttle, request coalescing, 503 fail-closed, disable/delete revocation & concurrent logout race safety', async () => {
  const fx = createAdversarialFixture(1_760_500_000);
  const { dispatcher, authRuntime, advanceTime } = fx;

  authRuntime.setCurrentUser({
    zuid: 'z_cat_reval',
    user_id: 'cat_reval_1',
    email_id: 'reval@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  const boot = await dispatcher.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(boot.status, 200);
  const cookie = extractCookieValue(boot.headers);
  let csrf = String(boot.body.csrfToken);
  const initialChecks = authRuntime.userDetailsCallCount;

  // Routine cookie-only mode
  authRuntime.setCurrentUser(null);

  // 1. Within 15m (899s): zero extra getUserDetails calls on routine GETs
  advanceTime(899);
  const r899 = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
  });
  assert.equal(r899.status, 200);
  assert.equal(authRuntime.userDetailsCallCount, initialChecks);

  // 2. Mandatory live check on critical route (`/auth/session/revoke` / `/refresh`) even < 15m
  const refreshBefore15 = await dispatcher.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie },
    body: {},
  });
  assert.equal(refreshBefore15.status, 200);
  assert.equal(authRuntime.userDetailsCallCount, initialChecks + 1);
  const cookie2 = extractCookieValue(refreshBefore15.headers);
  csrf = String(refreshBefore15.body.csrfToken);

  // 3. After >= 15m (900s), 5 concurrent parallel requests coalesce to ONLY 1 getUserDetails call
  advanceTime(900);
  authRuntime.setDetailsDelayMs(35);
  const beforeCoalesce = authRuntime.userDetailsCallCount;
  const parallelResults = await Promise.all(
    Array.from({ length: 5 }, () =>
      dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
        headers: { origin: SLATE_ORIGIN },
        cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
      })
    )
  );
  authRuntime.setDetailsDelayMs(0);
  for (const r of parallelResults) {
    assert.equal(r.status, 200);
  }
  assert.equal(authRuntime.userDetailsCallCount, beforeCoalesce + 1);

  // 4. Transient Catalyst outage -> 503 fail-closed, preserves cookie, does NOT advance window
  advanceTime(900);
  authRuntime.setDetailsError('Catalyst HTTP 503 Upstream Timeout');
  const outageRes = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
  });
  assert.equal(outageRes.status, 503);
  assert.equal(outageRes.body.error, 'CATALYST_REVALIDATION_UNAVAILABLE');
  assert.equal(outageRes.headers?.['Set-Cookie'], undefined);

  // Recover Catalyst immediately (no extra time advanced): next call MUST still revalidate & succeed!
  authRuntime.setDetailsError(null);
  const beforeRecover = authRuntime.userDetailsCallCount;
  const recoveredRes = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
  });
  assert.equal(recoveredRes.status, 200);
  assert.equal(authRuntime.userDetailsCallCount, beforeRecover + 1);

  // 5. Race-safety: concurrent logout revokes SESSION#<sid> WHILE delayed getUserDetails is in-flight
  advanceTime(900);
  authRuntime.setDetailsDelayMs(50);
  const inflightGet = dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  // Trigger logout immediately while getUserDetails is delayed
  const concurrentLogout = await dispatcher.dispatch('POST', '/api/v1/auth/session/logout', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-csrf': csrf },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie2 },
    body: {},
  });
  assert.equal(concurrentLogout.status, 200);
  assert.match(concurrentLogout.headers?.['Set-Cookie'] ?? '', /Max-Age=0/);

  const inflightRes = await inflightGet;
  authRuntime.setDetailsDelayMs(0);
  assert.equal(inflightRes.status, 401);
  assert.equal(inflightRes.body.error, 'SESSION_REVOKED_REAUTH_REQUIRED');

  // 6. Catalyst disabled -> 403 CATALYST_USER_DISABLED + sessionEpoch++ + Max-Age=0
  authRuntime.setCurrentUser({
    zuid: 'z_cat_reval',
    user_id: 'cat_reval_1',
    email_id: 'reval@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot3 = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  assert.equal(boot3.status, 200);
  const cookie3 = extractCookieValue(boot3.headers);
  authRuntime.setCurrentUser(null);

  advanceTime(900);
  authRuntime.disabledUserIds.add('cat_reval_1');
  const disabledRes = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie3 },
  });
  assert.equal(disabledRes.status, 403);
  assert.equal(disabledRes.body.error, 'CATALYST_USER_DISABLED');
  assert.match(disabledRes.headers?.['Set-Cookie'] ?? '', /Max-Age=0/);

  // Re-enabling Catalyst still blocks cookie3 because sessionEpoch bumped and sid3 revoked!
  authRuntime.disabledUserIds.delete('cat_reval_1');
  const cookie3AfterEnable = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie3 },
  });
  assert.equal(cookie3AfterEnable.status, 401);
  assert.ok(
    cookie3AfterEnable.body.error === 'SESSION_REVOKED_REAUTH_REQUIRED',
    `Expected SESSION_REVOKED_REAUTH_REQUIRED, got ${cookie3AfterEnable.body.error}`
  );

  // 7. Catalyst deleted -> 401 CATALYST_USER_DELETED + Max-Age=0
  authRuntime.setCurrentUser({
    zuid: 'z_cat_reval',
    user_id: 'cat_reval_1',
    email_id: 'reval@vigorcore.test',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot4 = await dispatcher.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN, 'x-vigor-requested-with': 'VigorCore-CleanSlate' },
    body: {},
  });
  const cookie4 = extractCookieValue(boot4.headers);
  authRuntime.setCurrentUser(null);

  advanceTime(900);
  authRuntime.setUserDeleted('cat_reval_1', true);
  const deletedRes = await dispatcher.dispatch('GET', '/api/v1/athlete/workspace', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookie4 },
  });
  assert.equal(deletedRes.status, 401);
  assert.equal(deletedRes.body.error, 'CATALYST_USER_DELETED');
  assert.match(deletedRes.headers?.['Set-Cookie'] ?? '', /Max-Age=0/);

  // Verify AuthGuardError direct export usage sanity
  assert.ok(new AuthGuardError(403, 'CSRF_TOKEN_INVALID', 'test') instanceof AuthGuardError);
});
