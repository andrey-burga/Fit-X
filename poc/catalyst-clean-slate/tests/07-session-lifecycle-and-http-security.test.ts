/**
 * Classification: PASS-UNIT / PASS-MOCK
 * Covers Phase 4.0.4 & Phase 4.0.5 — Session Lifecycle, 256-bit HMAC Entropy,
 * Timeout/Lost-Response Recovery, All 4 CSRF HTTP Methods (POST/PUT/PATCH/DELETE),
 * CORS Allowlist, and SameSite=Strict / Cross-Site / Subdomain Same-Site Evaluation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  assertStrongHmacSecret,
  CleanSlateAuthGuard,
  decodeAndValidateHmacSecret,
  MockCatalystAuthRuntime,
  ServerSessionTokenManager,
  SIGNED_SESSION_COOKIE_NAME,
} from '../src/auth/cleanSlateAuthGuard.js';
import {
  assertStrictCookieAttributes,
  evaluateBrowserCookieCompatibility,
  extractRegistrableDomain,
  HttpSecurityPolicy,
} from '../src/security/httpSecurityPolicy.js';
import { AthleteDataService } from '../src/services/athleteDataService.js';
import { AdminGovernanceService } from '../src/services/adminGovernanceService.js';
import { CleanSlateApiDispatcher, type EndpointResponse } from '../src/routes/apiRouterSchema.js';

const SLATE_ORIGIN = 'https://fit-x-bhnatsxl.onslate.com';
const EVIL_ORIGIN = 'https://attacker.evil.example';

function extractCookieValue(res: EndpointResponse): string {
  const setCookie = res.headers?.['Set-Cookie'] || '';
  assertStrictCookieAttributes(setCookie);
  const match = setCookie.match(new RegExp(`^${SIGNED_SESSION_COOKIE_NAME}=([^;]*)`));
  assert.ok(match);
  return match[1];
}

function createFixture(nowSec = 1_760_000_000, env = 'staging') {
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);
  const authRuntime = new MockCatalystAuthRuntime();
  const activeSecret = ServerSessionTokenManager.generateStrongSecret();
  const sessionManager = new ServerSessionTokenManager({
    activeSecret,
    activeKeyId: 'k2',
    previousSecrets: [{ kid: 'k1', secret: ServerSessionTokenManager.generateStrongSecret() }],
    issuer: 'vigorcore-auth',
    audience: 'vigorcore-api',
    environment: env,
    nowSecProvider: () => nowSec,
  });
  const guard = new CleanSlateAuthGuard(authRuntime, db, sessionManager);
  const athleteService = new AthleteDataService(db);
  const adminService = new AdminGovernanceService(db, authRuntime, () => nowSec * 1000);
  const httpPolicy = new HttpSecurityPolicy({ allowedOrigins: [SLATE_ORIGIN] });
  const api = new CleanSlateApiDispatcher(guard, athleteService, adminService, httpPolicy);
  return {
    db,
    authRuntime,
    activeSecret,
    sessionManager,
    guard,
    adminService,
    httpPolicy,
    api,
    advanceTime: (sec: number) => {
      nowSec += sec;
    },
    getNowSec: () => nowSec,
  };
}

test('[PASS-UNIT] Phase 4.0.5 Objective 2: 256-bit HMAC entropy validation, decoded byte length >= 32, multi-instance & env isolation', () => {
  // 1. generateStrongSecret produces >= 32 cryptographic random bytes in canonical Base64URL
  const generated = ServerSessionTokenManager.generateStrongSecret();
  const decodedGenerated = decodeAndValidateHmacSecret(generated);
  assert.ok(decodedGenerated.length >= 32, 'Generated secret must decode to >= 32 bytes (256 bits)');
  assert.equal(decodedGenerated.toString('base64url'), generated);
  assert.throws(() => ServerSessionTokenManager.generateStrongSecret(16), /INVALID_KEY_LENGTH/);

  // 2. Rejects 32-character Base64URL string that decodes to ONLY 24 bytes!
  const thirtyTwoCharOnly24Bytes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'; // 32 chars -> 24 bytes
  assert.equal(thirtyTwoCharOnly24Bytes.length, 32);
  assert.equal(Buffer.from(thirtyTwoCharOnly24Bytes, 'base64url').length, 24);
  assert.throws(() => assertStrongHmacSecret(thirtyTwoCharOnly24Bytes), /SESSION_SECRET_INSUFFICIENT_BYTES/);

  // 3. Rejects malformed, padded, whitespace, or low-entropy repetitive secrets
  assert.throws(() => assertStrongHmacSecret('short'), /SESSION_SECRET_NON_CANONICAL/);
  assert.throws(() => assertStrongHmacSecret('ABCD'), /SESSION_SECRET_INSUFFICIENT_BYTES/);
  assert.throws(() => assertStrongHmacSecret('a'.repeat(64)), /SESSION_SECRET_LOW_ENTROPY/);
  assert.throws(() => assertStrongHmacSecret(`${generated}==`), /SESSION_SECRET_MALFORMED/);
  assert.throws(() => assertStrongHmacSecret(` ${generated}`), /SESSION_SECRET_MALFORMED/);

  // 4. Rejects missing env secret in production & staging
  assert.throws(
    () => ServerSessionTokenManager.fromEnvironment({ NODE_ENV: 'production' }),
    /MISSING_SESSION_HMAC_SECRET/
  );

  // 5. Same secret across multiple instances in the same environment validates cleanly
  const sharedProdSecret = ServerSessionTokenManager.generateStrongSecret();
  const instanceA = ServerSessionTokenManager.fromEnvironment({
    NODE_ENV: 'production',
    VIGOR_SESSION_HMAC_SECRET: sharedProdSecret,
    VIGOR_SESSION_ACTIVE_KID: 'prod-k2',
  });
  const instanceB = ServerSessionTokenManager.fromEnvironment({
    NODE_ENV: 'production',
    VIGOR_SESSION_HMAC_SECRET: sharedProdSecret,
    VIGOR_SESSION_ACTIVE_KID: 'prod-k2',
  });
  const prodToken = instanceA.issueToken('uid_shared', 1);
  assert.equal(instanceB.verifyToken(prodToken, 'uid_shared').sub, 'uid_shared');

  // 6. Absolute separation between development and production environments
  const devInstance = ServerSessionTokenManager.fromEnvironment({
    NODE_ENV: 'development',
    VIGOR_SESSION_HMAC_SECRET: sharedProdSecret, // even with same env var mistake in misconfigured test, env claim blocks cross-env!
  });
  assert.throws(() => devInstance.verifyToken(prodToken, 'uid_shared'), /failed security validation/);
});

test('[PASS-UNIT] Scenarios 2-6: HMAC signature tampering, length mismatch, future iat, excessive TTL, rotation & zero secret leaks', () => {
  let nowSec = 1_760_000_000;
  const oldSecret = ServerSessionTokenManager.generateStrongSecret();
  const activeSecret = ServerSessionTokenManager.generateStrongSecret();

  const oldMgr = new ServerSessionTokenManager({
    activeSecret: oldSecret,
    activeKeyId: 'k1',
    environment: 'production',
    nowSecProvider: () => nowSec,
  });

  const rotatedMgr = new ServerSessionTokenManager({
    activeSecret,
    activeKeyId: 'k2',
    previousSecrets: [{ kid: 'k1', secret: oldSecret }],
    environment: 'production',
    maxTtlSec: 12 * 3600,
    nowSecProvider: () => nowSec,
  });

  const oldToken = oldMgr.issueToken('uid_rot', 1);
  assert.equal(rotatedMgr.verifyToken(oldToken, 'uid_rot').kid, 'k1');

  const validToken = rotatedMgr.issueToken('uid_1', 1);
  const [payloadB64, sigB64] = validToken.split('.');

  const flippedChar = sigB64[0] === 'A' ? 'B' : 'A';
  assert.throws(
    () => rotatedMgr.verifyToken(`${payloadB64}.${flippedChar}${sigB64.slice(1)}`, 'uid_1'),
    /Invalid or tampered/
  );
  assert.throws(() => rotatedMgr.verifyToken(`${payloadB64}.${sigB64.slice(0, 20)}`, 'uid_1'), /signature length/);
  assert.throws(() => rotatedMgr.verifyToken(`${payloadB64}.${sigB64}AAAA`, 'uid_1'), /signature length/);
  assert.throws(() => rotatedMgr.verifyToken(`${payloadB64}.invalid+base64/==`, 'uid_1'), /Non-canonical base64url/);

  const rawActiveKey = Buffer.from(activeSecret, 'base64url');
  const futureClaims = {
    v: 1,
    kid: 'k2',
    iss: 'vigorcore-auth',
    aud: 'vigorcore-api',
    env: 'production',
    sub: 'uid_1',
    ep: 1,
    sid: 'sid_future_1234567890',
    iat: nowSec + 600,
    exp: nowSec + 3600,
  };
  const futurePayload = Buffer.from(JSON.stringify(futureClaims), 'utf8').toString('base64url');
  const futureSig = crypto.createHmac('sha256', rawActiveKey).update(futurePayload, 'utf8').digest('base64url');
  assert.throws(() => rotatedMgr.verifyToken(`${futurePayload}.${futureSig}`, 'uid_1'), /clock skew/);

  const excessClaims = { ...futureClaims, iat: nowSec, exp: nowSec + 365 * 24 * 3600 };
  const excessPayload = Buffer.from(JSON.stringify(excessClaims), 'utf8').toString('base64url');
  const excessSig = crypto.createHmac('sha256', rawActiveKey).update(excessPayload, 'utf8').digest('base64url');
  assert.throws(() => rotatedMgr.verifyToken(`${excessPayload}.${excessSig}`, 'uid_1'), /lifetime bounds/);

  assert.throws(() => rotatedMgr.verifyToken(validToken, 'uid_other'), /failed security validation/);

  try {
    rotatedMgr.verifyToken(`${payloadB64}.${flippedChar}${sigB64.slice(1)}`, 'uid_1');
  } catch (err) {
    const msg = (err as Error).message;
    assert.equal(msg.includes(activeSecret), false);
    assert.equal(msg.includes(sigB64), false);
  }

  nowSec += 13 * 3600;
  assert.throws(() => rotatedMgr.verifyToken(validToken, 'uid_1'), /expired/);
});

test('[PASS-MOCK] Phase 4.0.5 Objective 4: Lifecycle consistency, timeout recovery, explicit expiresAtEpochSec ignoring TTL lag, and single-owner sid', async () => {
  const { api, authRuntime, db, sessionManager, advanceTime, getNowSec } = createFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_multi',
    user_id: 'cat_multi_01',
    email_id: 'multi@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  // Device A registers & persists SESSION#<sidA> BEFORE emitting Set-Cookie
  const bootA = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  const cookieA = extractCookieValue(bootA);
  const sidA = String(bootA.body.sid);
  const persistedA = await db.fetchItem<any>('SystemControl', { pk: `SESSION#${sidA}` }, { consistent_read: true });
  assert.equal(persistedA?.ownerUserId, 'cat_multi_01');
  assert.equal(persistedA?.status, 'active');

  // Device B exchanges Catalyst session -> independent sidB
  const exchB = await api.dispatch('POST', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN },
  });
  const cookieB = extractCookieValue(exchB);
  const sidB = String(exchB.body.sid);
  assert.notEqual(sidA, sidB);

  // Another user CANNOT reuse sidA even if signed token were somehow forged for them
  authRuntime.setCurrentUser({
    zuid: 'z_intruder',
    user_id: 'cat_intruder_99',
    email_id: 'intruder@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', { headers: { origin: SLATE_ORIGIN } });
  const craftedIntruderClaims = {
    v: 1,
    kid: 'k2',
    iss: 'vigorcore-auth',
    aud: 'vigorcore-api',
    env: 'staging',
    sub: 'cat_intruder_99',
    ep: 1,
    sid: sidA, // Attempting to point to cat_multi_01's SESSION#<sidA>
    iat: getNowSec(),
    exp: getNowSec() + 3600,
  };
  // Even if missing/different owner in SystemControl -> strictly denied!
  const fakePayloadB64 = Buffer.from(JSON.stringify(craftedIntruderClaims), 'utf8').toString('base64url');
  const rawK2 = Buffer.from((sessionManager as any).activeKey.keyBytes);
  const fakeSig = crypto.createHmac('sha256', rawK2).update(fakePayloadB64, 'utf8').digest('base64url');
  const crossOwnerRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: `${fakePayloadB64}.${fakeSig}` },
  });
  assert.equal(crossOwnerRes.status, 401);
  assert.equal(crossOwnerRes.body.error, 'INVALID_SIGNED_SESSION');

  // Switch back to cat_multi_01
  authRuntime.setCurrentUser({
    zuid: 'z_multi',
    user_id: 'cat_multi_01',
    email_id: 'multi@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });

  // Scenario 8: Revoke Device A only; Device B remains active
  const revokeARes = await api.dispatch('POST', '/api/v1/auth/session/revoke', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieB },
    body: { scope: 'individual', sid: sidA, reason: 'lost_phone' },
  });
  assert.equal(revokeARes.status, 200);
  const reuseA = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieA },
  });
  assert.equal(reuseA.status, 401);
  assert.equal((await api.dispatch('GET', '/api/v1/athlete/workspace', { cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieB } })).status, 200);

  // Timeout recovery during refreshSignedSession (`TIMEOUT_AFTER_APPLY` -> old session revoked, refuses dual-minting on retry!)
  db.injectNextUpdateFault('SystemControl', 'TIMEOUT_AFTER_APPLY');
  const timeoutRefresh = await api.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieB },
  });
  assert.equal(timeoutRefresh.status, 401);
  assert.equal(timeoutRefresh.body.error, 'SESSION_REVOKED_REAUTH_REQUIRED');
  // Confirm old cookieB is strictly unusable afterward
  const replayB = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieB },
  });
  assert.equal(replayB.status, 401);

  // Timeout recovery during logoutSession (`TIMEOUT_AFTER_APPLY` -> confirms clean idempotent logout + clear cookie!)
  const exchC = await api.dispatch('POST', '/api/v1/auth/session/exchange', { headers: { origin: SLATE_ORIGIN } });
  const cookieC = extractCookieValue(exchC);
  db.injectNextUpdateFault('SystemControl', 'TIMEOUT_AFTER_APPLY');
  const logoutTimeoutC = await api.dispatch('POST', '/api/v1/auth/session/logout', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieC },
  });
  assert.equal(logoutTimeoutC.status, 200);
  assert.equal(logoutTimeoutC.body.loggedOut, true);
  assert.ok(logoutTimeoutC.headers?.['Set-Cookie']?.includes('Max-Age=0'));

  // Missing SESSION#<sid> record -> strictly denied even with cryptographically valid HMAC token
  const exchD = await api.dispatch('POST', '/api/v1/auth/session/exchange', { headers: { origin: SLATE_ORIGIN } });
  const cookieD = extractCookieValue(exchD);
  const sidD = String(exchD.body.sid);
  await db.deleteItem('SystemControl', { pk: `SESSION#${sidD}` });
  const missingRecordRes = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieD },
  });
  assert.equal(missingRecordRes.status, 401);
  assert.equal(missingRecordRes.body.error, 'INVALID_SIGNED_SESSION');

  // Verify expiration is enforced via `expiresAtEpochSec` EVEN WHILE TTL record STILL EXISTS (`ttlEpochSec > nowSec`)
  const exchE = await api.dispatch('POST', '/api/v1/auth/session/exchange', { headers: { origin: SLATE_ORIGIN } });
  const cookieE = extractCookieValue(exchE);
  const sidE = String(exchE.body.sid);
  // Advance past 12h session expiry, but BEFORE +24h TTL purge (`ttlEpochSec` is still in future!)
  advanceTime(12 * 3600 + 5);
  const stillInDb = await db.fetchItem<any>('SystemControl', { pk: `SESSION#${sidE}` }, { consistent_read: true });
  assert.ok(stillInDb, 'Record still exists in SystemControl prior to async TTL purge');
  const expiredDespiteTtlNotPurged = await api.dispatch('GET', '/api/v1/athlete/workspace', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: cookieE },
  });
  assert.equal(expiredDespiteTtlNotPurged.status, 401);
});

test('[PASS-MOCK] Complete 12-Step Lifecycle, Global Revocation & Role Change', async () => {
  const { api, authRuntime, db } = createFixture();
  authRuntime.setCurrentUser({
    zuid: 'z_life',
    user_id: 'cat_life_01',
    email_id: 'life@vigor.co',
    status: 'ACTIVE',
    is_confirmed: false,
  });
  const unconfirmed = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(unconfirmed.status, 403);

  authRuntime.setCurrentUser({
    zuid: 'z_life',
    user_id: 'cat_life_01',
    email_id: 'life@vigor.co',
    status: 'ACTIVE',
    is_confirmed: true,
  });
  const boot = await api.dispatch('POST', '/api/v1/auth/session/bootstrap-profile', {
    headers: { origin: SLATE_ORIGIN },
  });
  const c1 = extractCookieValue(boot);

  const me = await api.dispatch('GET', '/api/v1/auth/me', {
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: c1 },
  });
  assert.equal(me.status, 200);

  const ref = await api.dispatch('POST', '/api/v1/auth/session/refresh', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: c1 },
  });
  assert.equal(ref.status, 200);
  const c2 = extractCookieValue(ref);
  assert.equal((await api.dispatch('GET', '/api/v1/athlete/workspace', { cookies: { [SIGNED_SESSION_COOKIE_NAME]: c1 } })).status, 401);

  // Two active sessions then global revocation via POST /session/revoke { scope: 'all' }
  const exchExtra = await api.dispatch('POST', '/api/v1/auth/session/exchange', { headers: { origin: SLATE_ORIGIN } });
  const cExtra = extractCookieValue(exchExtra);
  const revokeAll = await api.dispatch('POST', '/api/v1/auth/session/revoke', {
    headers: { origin: SLATE_ORIGIN },
    cookies: { [SIGNED_SESSION_COOKIE_NAME]: c2 },
    body: { scope: 'all' },
  });
  assert.equal(revokeAll.status, 200);
  assert.equal(revokeAll.body.revokedAll, true);
  assert.equal(revokeAll.body.newSessionEpoch, 2);
  assert.equal((await api.dispatch('GET', '/api/v1/athlete/workspace', { cookies: { [SIGNED_SESSION_COOKIE_NAME]: c2 } })).status, 401);
  assert.equal((await api.dispatch('GET', '/api/v1/athlete/workspace', { cookies: { [SIGNED_SESSION_COOKIE_NAME]: cExtra } })).status, 401);

  // Reauthenticate and verify immediate role change drops session
  await db.updateItem('Users', { pk: 'USER#cat_life_01' }, { role: 'admin', roleVersion: 2 });
  const cAdmin = extractCookieValue(
    await api.dispatch('POST', '/api/v1/auth/session/exchange', { headers: { origin: SLATE_ORIGIN } })
  );
  await db.updateItem('Users', { pk: 'USER#cat_life_01' }, { role: 'athlete', roleVersion: 3, sessionEpoch: 3 });
  assert.equal((await api.dispatch('GET', '/api/v1/admin/users', { cookies: { [SIGNED_SESSION_COOKIE_NAME]: cAdmin } })).status, 401);
});

test('[PASS-UNIT / PASS-MOCK] Phase 4.0.5 Objective 3 & 5: CORS Credentials, All 4 CSRF Methods (POST/PUT/PATCH/DELETE), Cookie Attrs & Domain Topology Matrix', async () => {
  const { api } = createFixture();

  assert.throws(() => new HttpSecurityPolicy({ allowedOrigins: ['*'] }), /INVALID_CORS_CONFIG/);

  const preflightOk = await api.dispatch('OPTIONS', '/api/v1/auth/session/exchange', {
    headers: { origin: SLATE_ORIGIN },
  });
  assert.equal(preflightOk.status, 204);
  assert.equal(preflightOk.headers?.['Access-Control-Allow-Origin'], SLATE_ORIGIN);
  assert.equal(preflightOk.headers?.['Access-Control-Allow-Credentials'], 'true');
  assert.equal(preflightOk.headers?.['Vary'], 'Origin');

  assert.equal((await api.dispatch('GET', '/api/v1/auth/me', { headers: { origin: EVIL_ORIGIN } })).status, 403);

  // CSRF tested across ALL 4 mutating methods: POST, PUT, PATCH, DELETE
  const csrfMatrix: Array<{ method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }> = [
    { method: 'POST', path: '/api/v1/auth/session/bootstrap-profile' },
    { method: 'POST', path: '/api/v1/auth/session/exchange' },
    { method: 'POST', path: '/api/v1/auth/session/refresh' },
    { method: 'POST', path: '/api/v1/auth/session/logout' },
    { method: 'POST', path: '/api/v1/auth/session/revoke' },
    { method: 'PUT', path: '/api/v1/athlete/groceries/sync' },
    { method: 'PATCH', path: '/api/v1/athlete/profile' },
    { method: 'DELETE', path: '/api/v1/athlete/recipes/r1' },
  ];

  for (const target of csrfMatrix) {
    assert.equal((await api.dispatch(target.method, target.path, {})).body.error, 'CSRF_ORIGIN_REQUIRED');
    assert.equal(
      (
        await api.dispatch(target.method, target.path, {
          headers: { origin: SLATE_ORIGIN, 'sec-fetch-site': 'cross-site' },
        })
      ).body.error,
      'CSRF_CROSS_SITE_REJECTED'
    );
    assert.equal(
      (
        await api.dispatch(target.method, target.path, {
          headers: { referer: `${EVIL_ORIGIN}/csrf.html` },
        })
      ).body.error,
      'CSRF_ORIGIN_REJECTED'
    );
  }

  // Cookie attribute enforcement
  assert.doesNotThrow(() =>
    assertStrictCookieAttributes(`${SIGNED_SESSION_COOKIE_NAME}=abc.def; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`)
  );
  assert.throws(() => assertStrictCookieAttributes(`${SIGNED_SESSION_COOKIE_NAME}=abc.def; Secure; SameSite=Strict; Path=/`), /Missing HttpOnly/);
  assert.throws(() => assertStrictCookieAttributes(`${SIGNED_SESSION_COOKIE_NAME}=abc.def; HttpOnly; SameSite=Strict; Path=/`), /Missing Secure/);
  assert.throws(() => assertStrictCookieAttributes(`${SIGNED_SESSION_COOKIE_NAME}=abc.def; HttpOnly; Secure; SameSite=None; Path=/`), /Missing SameSite=Strict/);
  assert.throws(() => assertStrictCookieAttributes(`${SIGNED_SESSION_COOKIE_NAME}=abc.def; HttpOnly; Secure; SameSite=Strict; Path=/; Domain=onslate.com`), /MUST NOT define a Domain/);

  // Domain & Same-Site evaluation across Catalyst default, subdomain same-site (Alternative A), and same-origin proxy (Alternative C)
  assert.equal(extractRegistrableDomain('fit-x-bhnatsxl.onslate.com'), 'onslate.com');
  assert.equal(extractRegistrableDomain('vigor.catalystserverless.com'), 'catalystserverless.com');

  const pendingEval = evaluateBrowserCookieCompatibility(SLATE_ORIGIN, null);
  assert.equal(pendingEval.relationship, 'PENDING_BACKEND_ORIGIN');
  assert.equal(pendingEval.browserVerificationStatus, 'PENDING_LIVE_VERIFICATION');

  const catalystDefaultEval = evaluateBrowserCookieCompatibility(
    SLATE_ORIGIN,
    'https://project_domain_name.catalystserverless.com'
  );
  assert.equal(catalystDefaultEval.relationship, 'cross-site');
  assert.equal(catalystDefaultEval.sameSiteStrictSentByBrowser, false);
  assert.equal(catalystDefaultEval.topologyAlternative, 'INCOMPATIBLE_DEFAULT_CATALYST_CROSS_SITE');

  const sameSiteSubdomainEval = evaluateBrowserCookieCompatibility(
    'https://app.vigorcore.example',
    'https://api.vigorcore.example'
  );
  assert.equal(sameSiteSubdomainEval.relationship, 'same-site');
  assert.equal(sameSiteSubdomainEval.frontendRegistrableDomain, 'vigorcore.example');
  assert.equal(sameSiteSubdomainEval.sameSiteStrictSentByBrowser, true);
  assert.equal(sameSiteSubdomainEval.topologyAlternative, 'A_CUSTOM_DOMAIN_SAME_SITE');
  assert.equal(sameSiteSubdomainEval.browserVerificationStatus, 'PENDING_LIVE_VERIFICATION');

  const sameOriginProxyEval = evaluateBrowserCookieCompatibility(SLATE_ORIGIN, SLATE_ORIGIN);
  assert.equal(sameOriginProxyEval.relationship, 'same-origin');
  assert.equal(sameOriginProxyEval.sameSiteStrictSentByBrowser, true);
  assert.equal(sameOriginProxyEval.topologyAlternative, 'C_DEDICATED_REVERSE_PROXY');
});
