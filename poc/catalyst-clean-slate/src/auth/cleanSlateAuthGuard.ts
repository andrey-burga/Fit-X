/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.5 Pre-Provisioning Hardened Authentication, Session Lifecycle & HMAC Entropy Guard
 *
 * Security & Lifecycle Guarantees (Phases 4.0.3 – 4.0.5):
 * 1. ZERO TRUST IN CLIENT-CONTROLLED HEADERS OR EPOCHS:
 *    - Any request sending `x-vigor-session-epoch`, `x-vigor-role-version`, `role`,
 *      `roleVersion`, `sessionEpoch`, `accountStatus`, `uid`, `userId`, etc. is rejected (`403 IDENTITY_SPOOFING_REJECTED`).
 * 2. HYBRID REVOCATION MODEL (`Users.sessionEpoch` GLOBAL + `SystemControl` `SESSION#<sid>` INDIVIDUAL):
 *    - A. Privilege & Global Revocation (`Users`, `consistent_read: true`):
 *         Role/status changes take effect on the very next request; bumping `Users.sessionEpoch`
 *         performs O(1) GLOBAL revocation across ALL devices.
 *    - B. Individual Session Registry (`SystemControl` `SESSION#<sid>`, `consistent_read: true`):
 *         `issueSignedSession()` persists `SESSION#<sid>` BEFORE returning `Set-Cookie`.
 *         `authenticate()` verifies `sessionRec.sid === claims.sid`, `ownerUserId === user_id`,
 *         `status === 'active'`, `!revokedAt`, and explicit `expiresAtEpochSec > nowSec`
 *         (never delegates expiration enforcement to async TTL garbage collection).
 *         `logoutSession()` and `refreshSignedSession()` conditionally revoke `SESSION#<sid>`
 *         with timeout `consistent_read: true` recovery BEFORE confirming logout or minting a rotated cookie.
 * 3. HARDENED 256-BIT HMAC-SHA256 ENGINE (`ServerSessionTokenManager`):
 *    - `generateStrongSecret(byteLength >= 32)` uses CSPRNG `crypto.randomBytes(32).toString('base64url')`.
 *    - `decodeAndValidateHmacSecret()` enforces canonical Base64URL, decoded key length >= 32 bytes (256 bits),
 *      entropy check (`>= 16` distinct byte values), zero hardcoded defaults, and absolute environment separation (`env`).
 *    - Controlled rotation via `activeKeyId` + `previousSecrets` using constant-time `crypto.timingSafeEqual`
 *      on raw 32-byte digests prior to parsing/trusting any JSON claims.
 */

import crypto from 'node:crypto';
import { USER_STATUS, type UserManagement } from '@zcatalyst/auth';
import {
  KeyBuilders,
  type AuthoritativeActor,
  type SessionRecordItem,
  type UserAccountItem,
  type UserRole,
} from '../types/cleanSlate.js';
import { CatalystTimeoutError, type ICleanSlateNoSQLAdapter } from '../nosql/cleanSlateEngine.js';

export type RealCatalystUser = Awaited<ReturnType<UserManagement['getCurrentUser']>>;
export type CatalystIdentitySnapshot = Pick<
  RealCatalystUser,
  'zuid' | 'user_id' | 'status' | 'is_confirmed' | 'email_id'
> &
  Partial<Pick<RealCatalystUser, 'org_id' | 'first_name' | 'last_name' | 'role_details'>>;

export { USER_STATUS };

export const SIGNED_SESSION_COOKIE_NAME = '__Host-vigor_session';

export interface IncomingHttpRequest {
  headers?: Record<string, string | undefined>;
  cookies?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
}

export interface SignedSessionClaims {
  v: 1;
  kid: string;
  iss: string;
  aud: string;
  env: string;
  sub: string;
  ep: number;
  sid: string;
  iat: number;
  exp: number;
}

export interface SignedCsrfClaims {
  v: 1;
  typ: 'csrf';
  kid: string;
  iss: string;
  aud: string;
  env: string;
  sub: string;
  ep: number;
  sid: string;
  iat: number;
  exp: number;
}

export interface PreviousHmacKey {
  kid: string;
  secret: string;
}

export interface SessionTokenManagerConfig {
  activeSecret: string;
  activeKeyId?: string;
  previousSecrets?: PreviousHmacKey[];
  issuer?: string;
  audience?: string;
  environment?: string;
  defaultTtlSec?: number;
  maxTtlSec?: number;
  clockSkewSec?: number;
  nowSecProvider?: () => number;
}

const CANONICAL_BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SHA256_DIGEST_BYTES = 32;
const MIN_HMAC_KEY_BYTES = 32;

let processTestSecretCache: string | null = null;
function getProcessScopedTestSecret(): string {
  if (!processTestSecretCache) {
    processTestSecretCache = ServerSessionTokenManager.generateStrongSecret(32);
  }
  return processTestSecretCache;
}

/**
 * Decodes and validates a canonical Base64URL cryptographic HMAC secret:
 * - Strictly canonical Base64URL (`^[A-Za-z0-9_-]+$` and exact round-trip).
 * - Decoded byte length >= 32 bytes (256 bits) — rejects 32-char strings that only decode to 24 bytes.
 * - Rejects low-entropy / repetitive byte patterns.
 */
export function decodeAndValidateHmacSecret(secret: string, label = 'activeSecret'): Buffer {
  if (typeof secret !== 'string' || !secret || !CANONICAL_BASE64URL_RE.test(secret)) {
    throw new Error(
      `SESSION_SECRET_MALFORMED: '${label}' must be a canonical Base64URL string (no padding or whitespace).`
    );
  }
  const keyBytes = Buffer.from(secret, 'base64url');
  if (keyBytes.toString('base64url') !== secret) {
    throw new Error(
      `SESSION_SECRET_NON_CANONICAL: '${label}' failed canonical Base64URL round-trip validation.`
    );
  }
  if (keyBytes.length < MIN_HMAC_KEY_BYTES) {
    throw new Error(
      `SESSION_SECRET_INSUFFICIENT_BYTES: '${label}' decodes to ${keyBytes.length} bytes; minimum is ${MIN_HMAC_KEY_BYTES} bytes (256 bits).`
    );
  }
  const distinctBytes = new Set(keyBytes).size;
  if (distinctBytes < 16) {
    throw new Error(
      `SESSION_SECRET_LOW_ENTROPY: '${label}' lacks cryptographic byte diversity.`
    );
  }
  return keyBytes;
}

export function assertStrongHmacSecret(secret: string, label = 'activeSecret'): void {
  decodeAndValidateHmacSecret(secret, label);
}

interface VerifiedHmacKey {
  kid: string;
  keyBytes: Buffer;
}

export class ServerSessionTokenManager {
  private readonly activeKey: VerifiedHmacKey;
  private readonly verificationKeys: VerifiedHmacKey[];
  private readonly issuer: string;
  private readonly audience: string;
  private readonly environment: string;
  private readonly defaultTtlSec: number;
  private readonly maxTtlSec: number;
  private readonly clockSkewSec: number;
  private readonly nowSecProvider: () => number;

  static generateStrongSecret(byteLength = 32): string {
    if (!Number.isInteger(byteLength) || byteLength < MIN_HMAC_KEY_BYTES) {
      throw new Error(`INVALID_KEY_LENGTH: byteLength must be an integer >= ${MIN_HMAC_KEY_BYTES}.`);
    }
    return crypto.randomBytes(byteLength).toString('base64url');
  }

  static fromEnvironment(
    envMap: Record<string, string | undefined> = process.env
  ): ServerSessionTokenManager {
    const environment = (envMap.VIGOR_ENVIRONMENT || envMap.NODE_ENV || 'development').trim();
    const activeSecret = envMap.VIGOR_SESSION_HMAC_SECRET || '';
    if (!activeSecret) {
      throw new Error(
        `MISSING_SESSION_HMAC_SECRET: VIGOR_SESSION_HMAC_SECRET is required for environment '${environment}'.`
      );
    }

    let previousSecrets: PreviousHmacKey[] = [];
    if (envMap.VIGOR_SESSION_PREVIOUS_SECRETS_JSON) {
      const parsed = JSON.parse(envMap.VIGOR_SESSION_PREVIOUS_SECRETS_JSON) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('INVALID_PREVIOUS_SECRETS: VIGOR_SESSION_PREVIOUS_SECRETS_JSON must be a JSON array.');
      }
      previousSecrets = parsed.map(item => ({
        kid: String((item as PreviousHmacKey).kid || ''),
        secret: String((item as PreviousHmacKey).secret || ''),
      }));
    }

    return new ServerSessionTokenManager({
      activeSecret,
      activeKeyId: envMap.VIGOR_SESSION_ACTIVE_KID || 'k1',
      previousSecrets,
      environment,
    });
  }

  constructor(
    configOrSecret: string | SessionTokenManagerConfig,
    legacyNowSecProvider?: () => number,
    legacyDefaultTtlSec?: number
  ) {
    const cfg: SessionTokenManagerConfig =
      typeof configOrSecret === 'string'
        ? {
            activeSecret: configOrSecret,
            nowSecProvider: legacyNowSecProvider,
            defaultTtlSec: legacyDefaultTtlSec,
          }
        : configOrSecret;

    const activeKeyBytes = decodeAndValidateHmacSecret(cfg.activeSecret, 'activeSecret');
    const activeKeyId = (cfg.activeKeyId ?? 'k1').trim();
    if (!activeKeyId) {
      throw new Error('INVALID_KEY_ID: activeKeyId must be non-empty.');
    }

    const seenKids = new Set<string>([activeKeyId]);
    const prevKeys: VerifiedHmacKey[] = [];
    for (const prev of cfg.previousSecrets ?? []) {
      const kid = prev.kid.trim();
      if (!kid || seenKids.has(kid)) {
        throw new Error(`INVALID_ROTATION_KEY_ID: Duplicate or empty previous key id '${prev.kid}'.`);
      }
      const prevKeyBytes = decodeAndValidateHmacSecret(prev.secret, `previousSecrets[${kid}]`);
      seenKids.add(kid);
      prevKeys.push({ kid, keyBytes: prevKeyBytes });
    }

    this.activeKey = { kid: activeKeyId, keyBytes: activeKeyBytes };
    this.verificationKeys = [this.activeKey, ...prevKeys];
    this.issuer = cfg.issuer ?? 'vigorcore-auth';
    this.audience = cfg.audience ?? 'vigorcore-api';
    this.environment = cfg.environment ?? 'development';
    this.maxTtlSec = cfg.maxTtlSec ?? 24 * 3600;
    this.defaultTtlSec = cfg.defaultTtlSec ?? 12 * 3600;
    this.clockSkewSec = cfg.clockSkewSec ?? 60;
    this.nowSecProvider = cfg.nowSecProvider ?? (() => Math.floor(Date.now() / 1000));

    if (this.defaultTtlSec <= 0 || this.defaultTtlSec > this.maxTtlSec) {
      throw new Error('INVALID_TTL_CONFIG: defaultTtlSec must be > 0 and <= maxTtlSec.');
    }
  }

  getNowSec(): number {
    return this.nowSecProvider();
  }

  getEnvironment(): string {
    return this.environment;
  }

  issueTokenWithClaims(
    userId: string,
    sessionEpoch: number,
    ttlSec = this.defaultTtlSec
  ): { token: string; claims: SignedSessionClaims } {
    if (!userId || userId.includes('#')) {
      throw new Error('INVALID_SUBJECT: Cannot mint session token for empty or invalid subject.');
    }
    if (!Number.isInteger(sessionEpoch) || sessionEpoch < 1) {
      throw new Error('INVALID_EPOCH: sessionEpoch must be an integer >= 1.');
    }
    if (!Number.isFinite(ttlSec) || ttlSec <= 0 || ttlSec > this.maxTtlSec) {
      throw new Error(`INVALID_TOKEN_TTL: Requested ttlSec (${ttlSec}) exceeds allowed maxTtlSec (${this.maxTtlSec}).`);
    }

    const iat = this.nowSecProvider();
    const claims: SignedSessionClaims = {
      v: 1,
      kid: this.activeKey.kid,
      iss: this.issuer,
      aud: this.audience,
      env: this.environment,
      sub: userId,
      ep: sessionEpoch,
      sid: crypto.randomBytes(16).toString('hex'),
      iat,
      exp: iat + ttlSec,
    };

    const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const digest = crypto
      .createHmac('sha256', this.activeKey.keyBytes)
      .update(encodedPayload, 'utf8')
      .digest();
    const sig = digest.toString('base64url');
    return { token: `${encodedPayload}.${sig}`, claims };
  }

  issueToken(userId: string, sessionEpoch: number, ttlSec = this.defaultTtlSec): string {
    return this.issueTokenWithClaims(userId, sessionEpoch, ttlSec).token;
  }

  buildHttpOnlySetCookieHeader(token: string, ttlSec = this.defaultTtlSec): string {
    return `${SIGNED_SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttlSec}`;
  }

  buildLogoutClearCookieHeader(): string {
    return `${SIGNED_SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  issueCsrfToken(
    userId: string,
    sessionId: string,
    sessionEpoch: number,
    sessionExpSec?: number
  ): string {
    if (!userId || userId.includes('#')) {
      throw new Error('INVALID_SUBJECT: Cannot mint CSRF token for empty or invalid subject.');
    }
    if (!sessionId || sessionId.length < 16 || sessionId.includes('#')) {
      throw new Error('INVALID_SESSION_ID: Cannot mint CSRF token without valid sid.');
    }
    if (!Number.isInteger(sessionEpoch) || sessionEpoch < 1) {
      throw new Error('INVALID_EPOCH: sessionEpoch must be an integer >= 1.');
    }

    const iat = this.nowSecProvider();
    const rawExp = sessionExpSec !== undefined ? Math.min(iat + this.defaultTtlSec, sessionExpSec) : iat + this.defaultTtlSec;
    if (rawExp <= iat) {
      throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Cannot issue CSRF token for expired session.');
    }
    const claims: SignedCsrfClaims = {
      v: 1,
      typ: 'csrf',
      kid: this.activeKey.kid,
      iss: this.issuer,
      aud: this.audience,
      env: this.environment,
      sub: userId,
      ep: sessionEpoch,
      sid: sessionId,
      iat,
      exp: rawExp,
    };

    const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const digest = crypto
      .createHmac('sha256', this.activeKey.keyBytes)
      .update(encodedPayload, 'utf8')
      .digest();
    return `${encodedPayload}.${digest.toString('base64url')}`;
  }

  private verifySignedCompactPayload<T extends { v: number; kid: string; iss: string; aud: string; env: string; iat: number; exp: number }>(
    rawToken: string,
    failureStatus: 401 | 403,
    invalidCode: string,
    invalidPrefix: string
  ): { parsed: T; matchedKey: VerifiedHmacKey } {
    if (typeof rawToken !== 'string' || rawToken.length > 4096) {
      throw new AuthGuardError(failureStatus, invalidCode, `Malformed ${invalidPrefix} token.`);
    }

    const parts = rawToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new AuthGuardError(failureStatus, invalidCode, `Malformed ${invalidPrefix} token.`);
    }

    const [encodedPayload, providedSig] = parts;
    if (!CANONICAL_BASE64URL_RE.test(encodedPayload) || !CANONICAL_BASE64URL_RE.test(providedSig)) {
      throw new AuthGuardError(failureStatus, invalidCode, `Non-canonical base64url ${invalidPrefix} token.`);
    }

    const providedDigest = Buffer.from(providedSig, 'base64url');
    if (
      providedDigest.length !== SHA256_DIGEST_BYTES ||
      providedDigest.toString('base64url') !== providedSig
    ) {
      throw new AuthGuardError(
        failureStatus,
        invalidCode,
        `Invalid ${invalidPrefix} signature length or encoding.`
      );
    }

    // Constant-time raw digest verification BEFORE trusting any JSON payload fields
    let matchedKey: VerifiedHmacKey | null = null;
    for (const candidateKey of this.verificationKeys) {
      const expectedDigest = crypto
        .createHmac('sha256', candidateKey.keyBytes)
        .update(encodedPayload, 'utf8')
        .digest();
      if (
        expectedDigest.length === providedDigest.length &&
        crypto.timingSafeEqual(providedDigest, expectedDigest)
      ) {
        matchedKey = candidateKey;
        break;
      }
    }

    if (!matchedKey) {
      throw new AuthGuardError(
        failureStatus,
        invalidCode,
        `Invalid or tampered ${invalidPrefix} signature.`
      );
    }

    let parsed: T;
    try {
      const payloadBuf = Buffer.from(encodedPayload, 'base64url');
      if (payloadBuf.toString('base64url') !== encodedPayload) {
        throw new Error('NON_CANONICAL_PAYLOAD');
      }
      parsed = JSON.parse(payloadBuf.toString('utf8')) as T;
    } catch {
      throw new AuthGuardError(failureStatus, invalidCode, `Corrupt ${invalidPrefix} payload.`);
    }

    return { parsed, matchedKey };
  }

  verifyToken(rawToken: string, expectedUserId?: string): SignedSessionClaims {
    const { parsed, matchedKey } = this.verifySignedCompactPayload<SignedSessionClaims & { typ?: string }>(
      rawToken,
      401,
      'INVALID_SIGNED_SESSION',
      'server session'
    );

    if (
      !parsed ||
      parsed.v !== 1 ||
      parsed.typ === 'csrf' ||
      parsed.kid !== matchedKey.kid ||
      parsed.iss !== this.issuer ||
      parsed.aud !== this.audience ||
      parsed.env !== this.environment ||
      typeof parsed.sub !== 'string' ||
      !parsed.sub.trim() ||
      parsed.sub.includes('#') ||
      (expectedUserId !== undefined && parsed.sub !== expectedUserId) ||
      typeof parsed.sid !== 'string' ||
      parsed.sid.length < 16 ||
      parsed.sid.includes('#') ||
      !Number.isInteger(parsed.ep) ||
      parsed.ep < 1 ||
      !Number.isInteger(parsed.iat) ||
      !Number.isInteger(parsed.exp)
    ) {
      throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Session claims failed security validation.');
    }

    const nowSec = this.nowSecProvider();
    if (parsed.iat > nowSec + this.clockSkewSec) {
      throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Session issued timestamp exceeds allowed clock skew.');
    }

    if (parsed.exp <= parsed.iat || parsed.exp - parsed.iat > this.maxTtlSec) {
      throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Session lifetime bounds are invalid.');
    }

    if (parsed.exp <= nowSec) {
      throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Server-signed session token expired.');
    }

    return parsed;
  }

  verifyCsrfToken(
    rawCsrfToken: string,
    expected: { userId: string; sessionId: string; sessionEpoch: number }
  ): SignedCsrfClaims {
    const { parsed, matchedKey } = this.verifySignedCompactPayload<SignedCsrfClaims>(
      rawCsrfToken,
      403,
      'CSRF_TOKEN_INVALID',
      'CSRF'
    );

    if (
      !parsed ||
      parsed.v !== 1 ||
      parsed.typ !== 'csrf' ||
      parsed.kid !== matchedKey.kid ||
      parsed.iss !== this.issuer ||
      parsed.aud !== this.audience ||
      parsed.env !== this.environment ||
      typeof parsed.sub !== 'string' ||
      typeof parsed.sid !== 'string' ||
      parsed.sid.length < 16 ||
      parsed.sid.includes('#') ||
      !Number.isInteger(parsed.ep) ||
      parsed.ep < 1 ||
      !Number.isInteger(parsed.iat) ||
      !Number.isInteger(parsed.exp)
    ) {
      throw new AuthGuardError(403, 'CSRF_TOKEN_INVALID', 'CSRF claims failed security validation.');
    }

    const nowSec = this.nowSecProvider();
    if (parsed.iat > nowSec + this.clockSkewSec) {
      throw new AuthGuardError(403, 'CSRF_TOKEN_INVALID', 'CSRF token timestamp exceeds allowed clock skew.');
    }
    if (parsed.exp <= parsed.iat || parsed.exp - parsed.iat > this.maxTtlSec) {
      throw new AuthGuardError(403, 'CSRF_TOKEN_INVALID', 'CSRF token lifetime bounds are invalid.');
    }
    if (parsed.exp <= nowSec) {
      throw new AuthGuardError(403, 'CSRF_TOKEN_EXPIRED', 'Server-issued CSRF token expired.');
    }
    if (
      parsed.sub !== expected.userId ||
      parsed.sid !== expected.sessionId ||
      parsed.ep !== expected.sessionEpoch
    ) {
      throw new AuthGuardError(
        403,
        'CSRF_TOKEN_SESSION_MISMATCH',
        'CSRF token is not bound to the active authenticated session.'
      );
    }

    return parsed;
  }
}

export interface ICatalystAuthRuntime {
  /**
   * Optional pre-check distinguishing requests carrying independently recognized
   * Catalyst end-user credentials (`x-zc-user-cred-token` or sanitized Catalyst
   * project-user cookies in `x-zc-cookie`) from HMAC-only requests.
   */
  hasRequestCatalystUserCredential?(req: IncomingHttpRequest): boolean;
  /**
   * Live SDK integration:
   *   const catalystApp = zcAuth.init(req);
   *   return await catalystApp.userManagement().getCurrentUser();
   */
  getCurrentUserFromRequest(req: IncomingHttpRequest): Promise<CatalystIdentitySnapshot | null>;
  getUserDetails?(userId: string): Promise<CatalystIdentitySnapshot | null>;
  updateUserStatus(userId: string, status: USER_STATUS): Promise<boolean>;
  sendPasswordReset?(email: string): Promise<void>;
}

export class MockCatalystAuthRuntime implements ICatalystAuthRuntime {
  private currentSessionUser: CatalystIdentitySnapshot | null = null;
  private simulateError: string | null = null;
  private detailsError: string | null = null;
  private detailsDelayMs = 0;
  public usersById: Map<string, CatalystIdentitySnapshot> = new Map();
  public disabledUserIds: Set<string> = new Set();
  public deletedUserIds: Set<string> = new Set();
  public passwordResetRequests: string[] = [];
  public userDetailsCallCount = 0;

  seedUserDetails(user: CatalystIdentitySnapshot) {
    this.deletedUserIds.delete(user.user_id);
    this.usersById.set(user.user_id, user);
  }

  setCurrentUser(user: CatalystIdentitySnapshot | null, errorMsg: string | null = null) {
    this.currentSessionUser = user;
    this.simulateError = errorMsg;
    if (user && user.user_id) {
      this.deletedUserIds.delete(user.user_id);
      this.usersById.set(user.user_id, user);
    }
  }

  setUserDeleted(userId: string, deleted = true) {
    if (deleted) {
      this.deletedUserIds.add(userId);
    } else {
      this.deletedUserIds.delete(userId);
    }
  }

  setDetailsError(errorMsg: string | null) {
    this.detailsError = errorMsg;
  }

  setDetailsDelayMs(delayMs: number) {
    this.detailsDelayMs = Math.max(0, Math.floor(delayMs));
  }

  async getCurrentUserFromRequest(_req: IncomingHttpRequest): Promise<CatalystIdentitySnapshot | null> {
    if (this.simulateError) {
      throw new Error(this.simulateError);
    }
    if (!this.currentSessionUser) return null;
    if (this.deletedUserIds.has(this.currentSessionUser.user_id)) {
      return null;
    }
    const base = this.usersById.get(this.currentSessionUser.user_id) ?? this.currentSessionUser;
    if (this.disabledUserIds.has(base.user_id)) {
      return { ...base, status: 'DISABLED' };
    }
    return base;
  }

  async getUserDetails(userId: string): Promise<CatalystIdentitySnapshot | null> {
    this.userDetailsCallCount++;
    if (this.detailsDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.detailsDelayMs));
    }
    if (this.detailsError) {
      throw new Error(this.detailsError);
    }
    if (this.deletedUserIds.has(userId)) {
      return null;
    }
    const base = this.usersById.get(userId);
    if (!base) {
      return null;
    }
    if (this.disabledUserIds.has(userId)) {
      return { ...base, status: 'DISABLED' };
    }
    return base;
  }

  async updateUserStatus(userId: string, status: USER_STATUS): Promise<boolean> {
    if (status === USER_STATUS.DISABLE) {
      this.disabledUserIds.add(userId);
    } else {
      this.disabledUserIds.delete(userId);
    }
    return true;
  }

  async sendPasswordReset(email: string): Promise<void> {
    this.passwordResetRequests.push(email);
  }
}

export class AuthGuardError extends Error {
  constructor(
    public readonly statusCode: 401 | 403 | 404 | 409 | 503,
    public readonly code: string,
    message: string,
    public readonly clearCookieHeader?: string
  ) {
    super(message);
    this.name = 'AuthGuardError';
  }
}

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'userid',
  'user_id',
  'uid',
  'pk',
  'partitionkey',
  'partition_key',
  'sourceuid',
  'source_uid',
  'catalystuserid',
  'catalyst_user_id',
  'role',
  'authoritativerole',
  'sessionepoch',
  'roleversion',
  'clientsessionepoch',
  'clientroleversion',
  'xvigorsessionepoch',
  'xvigorroleversion',
  'accountstatus',
]);

export interface AntiSpoofingOptions {
  allowTargetUidForAdmin?: boolean;
  allowRoleFilterInQuery?: boolean;
  allowAccountStatusFilterInQuery?: boolean;
}

export function assertNoIdentitySpoofing(
  req: IncomingHttpRequest,
  allowTargetUidOrOptions: boolean | AntiSpoofingOptions = false
): void {
  const opts: AntiSpoofingOptions =
    typeof allowTargetUidOrOptions === 'boolean'
      ? { allowTargetUidForAdmin: allowTargetUidOrOptions }
      : allowTargetUidOrOptions;
  const allowTargetUidForAdmin = Boolean(opts.allowTargetUidForAdmin);
  const allowRoleFilterInQuery = Boolean(opts.allowRoleFilterInQuery);
  const allowAccountStatusFilterInQuery = Boolean(opts.allowAccountStatusFilterInQuery);

  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      const normalized = k.toLowerCase().replace(/[-_]/g, '');
      if (
        FORBIDDEN_IDENTITY_KEYS.has(normalized) ||
        normalized.startsWith('xuser') ||
        normalized.startsWith('xauth') ||
        normalized.startsWith('xactor') ||
        normalized.startsWith('xrole') ||
        normalized.startsWith('xvigorsession') ||
        normalized.startsWith('xvigorrole')
      ) {
        throw new AuthGuardError(
          403,
          'IDENTITY_SPOOFING_REJECTED',
          `Prohibited client-controlled header '${k}'. Identity, role, and session state are strictly server-verified.`
        );
      }
    }
  }

  if (req.query) {
    for (const k of Object.keys(req.query)) {
      const normalized = k.toLowerCase().replace(/[-_]/g, '');
      if (allowRoleFilterInQuery && normalized === 'role') {
        continue;
      }
      if (allowAccountStatusFilterInQuery && normalized === 'accountstatus') {
        continue;
      }
      if (FORBIDDEN_IDENTITY_KEYS.has(normalized) || (!allowTargetUidForAdmin && normalized === 'targetuid')) {
        throw new AuthGuardError(
          403,
          'IDENTITY_SPOOFING_REJECTED',
          `Prohibited query parameter '${k}'.`
        );
      }
    }
  }

  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const k of Object.keys(req.body as Record<string, unknown>)) {
      const normalized = k.toLowerCase().replace(/[-_]/g, '');
      if (FORBIDDEN_IDENTITY_KEYS.has(normalized) || (!allowTargetUidForAdmin && normalized === 'targetuid')) {
        throw new AuthGuardError(
          403,
          'IDENTITY_SPOOFING_REJECTED',
          `Prohibited body field '${k}'.`
        );
      }
    }
  }
}

function extractSignedSessionCookie(req: IncomingHttpRequest): string | undefined {
  if (req.cookies && typeof req.cookies[SIGNED_SESSION_COOKIE_NAME] === 'string') {
    const val = req.cookies[SIGNED_SESSION_COOKIE_NAME]?.trim();
    return val ? val : undefined;
  }
  const rawCookieHeader = req.headers?.cookie ?? req.headers?.Cookie;
  if (!rawCookieHeader) return undefined;
  for (const part of rawCookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name === SIGNED_SESSION_COOKIE_NAME && val) {
      return val;
    }
  }
  return undefined;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof CatalystTimeoutError || Boolean((err as { isTimeout?: boolean })?.isTimeout);
}

export class CleanSlateAuthGuard {
  public readonly sessionTokens: ServerSessionTokenManager;
  public static readonly CATALYST_REVALIDATION_INTERVAL_SEC = 15 * 60; // 15 minutes
  public static readonly ROTATED_SESSION_GRACE_SEC = 5; // 5s concurrent-read grace
  private readonly inFlightCatalystChecks = new Map<string, Promise<CatalystIdentitySnapshot | null>>();

  constructor(
    private authRuntime: ICatalystAuthRuntime,
    private db: ICleanSlateNoSQLAdapter,
    sessionManager?: ServerSessionTokenManager
  ) {
    if (sessionManager) {
      this.sessionTokens = sessionManager;
    } else {
      const envName = (process.env.VIGOR_ENVIRONMENT || process.env.NODE_ENV || 'development').trim();
      const envSecret = process.env.VIGOR_SESSION_HMAC_SECRET;
      if (!envSecret && (envName === 'production' || envName === 'staging')) {
        throw new Error(
          `MISSING_ENV_SESSION_SECRET: VIGOR_SESSION_HMAC_SECRET must be explicitly provisioned for '${envName}'.`
        );
      }
      this.sessionTokens = new ServerSessionTokenManager({
        activeSecret: envSecret || getProcessScopedTestSecret(),
        environment: envName,
      });
    }
  }

  private assertValidCatalystSnapshot(
    user: CatalystIdentitySnapshot | null,
    missingCode: 'UNAUTHENTICATED' | 'CATALYST_USER_DELETED' = 'UNAUTHENTICATED',
    clearCookieOnInvalid?: string
  ): CatalystIdentitySnapshot {
    if (!user || !user.user_id) {
      throw new AuthGuardError(
        401,
        missingCode,
        missingCode === 'CATALYST_USER_DELETED'
          ? 'Usuario eliminado o inexistente en Catalyst Auth.'
          : 'Valid Catalyst Auth session required.',
        clearCookieOnInvalid
      );
    }

    if (String(user.status || '').toUpperCase() !== 'ACTIVE') {
      throw new AuthGuardError(
        403,
        'CATALYST_USER_DISABLED',
        `Catalyst user status is '${user.status}', expected ACTIVE.`,
        clearCookieOnInvalid
      );
    }

    if (user.is_confirmed !== true) {
      throw new AuthGuardError(
        403,
        'EMAIL_VERIFICATION_REQUIRED',
        'Email verification (is_confirmed === true) is required.',
        clearCookieOnInvalid
      );
    }

    if (!user.email_id || !user.email_id.includes('@')) {
      throw new AuthGuardError(
        403,
        'MISSING_EMAIL',
        'Authenticated Catalyst user lacks a valid email.',
        clearCookieOnInvalid
      );
    }

    return user;
  }

  private async resolveVerifiedCatalystIdentity(req: IncomingHttpRequest): Promise<CatalystIdentitySnapshot> {
    let user: CatalystIdentitySnapshot | null;
    try {
      user = await this.authRuntime.getCurrentUserFromRequest(req);
    } catch (err) {
      if (err instanceof AuthGuardError) {
        throw err;
      }
      throw new AuthGuardError(
        401,
        'AUTH_SESSION_INVALID',
        err instanceof Error ? err.message : 'Catalyst Auth verification failed.'
      );
    }
    return this.assertValidCatalystSnapshot(user, 'UNAUTHENTICATED');
  }

  private async bumpUserSessionEpochOnSecurityViolation(
    userId: string,
    knownEpoch: number
  ): Promise<void> {
    const userPk = KeyBuilders.userPk(userId);
    const nowIso = new Date(this.sessionTokens.getNowSec() * 1000).toISOString();
    try {
      const upd = await this.db.updateItem<UserAccountItem>(
        'Users',
        { pk: userPk },
        { sessionEpoch: knownEpoch + 1, updatedAt: nowIso },
        { type: 'equals', attr: 'sessionEpoch', value: knownEpoch }
      );
      if (upd.updated) return;
    } catch {
      // Fallback consistent read + retry once
    }
    const freshUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: userPk }, { consistent_read: true });
    if (freshUser && freshUser.sessionEpoch <= knownEpoch) {
      await this.db.updateItem<UserAccountItem>(
        'Users',
        { pk: userPk },
        { sessionEpoch: freshUser.sessionEpoch + 1, updatedAt: nowIso },
        { type: 'equals', attr: 'sessionEpoch', value: freshUser.sessionEpoch }
      ).catch(() => undefined);
    }
  }

  private async coalesceCatalystUserDetailsCheck(
    userId: string,
    sid: string
  ): Promise<CatalystIdentitySnapshot | null> {
    if (typeof this.authRuntime.getUserDetails !== 'function') {
      return null;
    }
    const key = `${userId}:${sid}`;
    const existingPromise = this.inFlightCatalystChecks.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const checkPromise = this.authRuntime.getUserDetails(userId).finally(() => {
      if (this.inFlightCatalystChecks.get(key) === checkPromise) {
        this.inFlightCatalystChecks.delete(key);
      }
    });
    this.inFlightCatalystChecks.set(key, checkPromise);
    return checkPromise;
  }

  private async enforceCatalystLiveRevalidation(
    userId: string,
    sid: string,
    sessionEpoch: number,
    nowSec: number,
    isRefreshRequest: boolean
  ): Promise<void> {
    if (typeof this.authRuntime.getUserDetails !== 'function') {
      return;
    }

    let freshCatalystUser: CatalystIdentitySnapshot | null;
    try {
      freshCatalystUser = await this.coalesceCatalystUserDetailsCheck(userId, sid);
    } catch (err) {
      // Fail-closed with 503: keep cookie intact and do NOT extend lastCatalystCheckAtEpochSec
      throw new AuthGuardError(
        503,
        'CATALYST_REVALIDATION_UNAVAILABLE',
        err instanceof Error
          ? `Fallo al revalidar cuenta con Zoho Catalyst: ${err.message}`
          : 'Servicio de identidad Zoho Catalyst temporalmente no disponible.'
      );
    }

    const clearCookie = this.sessionTokens.buildLogoutClearCookieHeader();
    try {
      this.assertValidCatalystSnapshot(freshCatalystUser, 'CATALYST_USER_DELETED', clearCookie);
    } catch (err) {
      // Account deleted, disabled, or unconfirmed -> revoke session, bump epoch & clear cookie
      await this.revokeActiveSessionWithTimeoutRecovery(
        sid,
        'catalyst_revalidation_rejected',
        true
      ).catch(() => undefined);
      await this.bumpUserSessionEpochOnSecurityViolation(userId, sessionEpoch);
      throw err;
    }

    if (!isRefreshRequest) {
      // Conditionally update SESSION#<sid>.lastCatalystCheckAtEpochSec (race-safe with concurrent logout/rotation)
      const sessionPk = KeyBuilders.sessionPk(sid);
      const upd = await this.db.updateItem<SessionRecordItem>(
        'SystemControl',
        { pk: sessionPk },
        { lastCatalystCheckAtEpochSec: nowSec },
        { type: 'equals', attr: 'status', value: 'active' }
      );

      if (!upd.updated || upd.status !== 'Success') {
        const consistentRec = await this.db.fetchItem<SessionRecordItem>(
          'SystemControl',
          { pk: sessionPk },
          { consistent_read: true }
        );
        if (!consistentRec || consistentRec.status !== 'active' || consistentRec.revokedAt) {
          if (consistentRec?.revocationReason === 'session_rotated') {
            const graceEligible =
              typeof consistentRec.rotatedAtEpochSec === 'number' &&
              nowSec - consistentRec.rotatedAtEpochSec <= CleanSlateAuthGuard.ROTATED_SESSION_GRACE_SEC;
            if (graceEligible) {
              throw new AuthGuardError(
                401,
                'SESSION_ROTATED_RETRY',
                'Sesión rotada recientemente por otra petición concurrente; reintente con la nueva cookie.'
              );
            }
            await this.bumpUserSessionEpochOnSecurityViolation(userId, sessionEpoch);
            throw new AuthGuardError(
              401,
              'SESSION_REPLAY_DETECTED',
              'Reutilización de sesión rotada detectada fuera de la ventana de gracia.',
              clearCookie
            );
          }
          throw new AuthGuardError(
            401,
            'SESSION_REVOKED_REAUTH_REQUIRED',
            'La sesión fue revocada concurrentemente durante la revalidación.'
          );
        }
      }
    }
  }

  /**
   * Authenticates and authorizes an existing registered VigorCore user on EVERY backend request.
   * - Supports cookie-only `hmac_session` authentication (no Catalyst header required on routine API requests).
   * - Enforces `Users` (`consistent_read: true`) + `SystemControl` (`SESSION#<sid>`, `consistent_read: true`).
   * - Enforces 12h idle, 24h absolute ceiling, <= 5s rotated-session grace vs replay detection (`sessionEpoch++`),
   *   and <= 15 min Catalyst live revalidation with request coalescing.
   */
  async authenticate(
    req: IncomingHttpRequest,
    options: {
      allowTargetUidForAdmin?: boolean;
      allowRoleFilterInQuery?: boolean;
      allowAccountStatusFilterInQuery?: boolean;
      requireSignedSession?: boolean;
      authPolicy?: 'catalyst_exchange' | 'hmac_session' | 'catalyst_or_hmac_inspect';
      requiresCatalystLiveCheck?: boolean;
      skipCatalystLiveRevalidation?: boolean;
      isRefreshRequest?: boolean;
    } = {}
  ): Promise<AuthoritativeActor> {
    assertNoIdentitySpoofing(req, {
      allowTargetUidForAdmin: Boolean(options.allowTargetUidForAdmin),
      allowRoleFilterInQuery: Boolean(options.allowRoleFilterInQuery),
      allowAccountStatusFilterInQuery: Boolean(options.allowAccountStatusFilterInQuery),
    });

    const signedCookie = extractSignedSessionCookie(req);
    const authPolicy = options.authPolicy ?? (options.requireSignedSession ? 'hmac_session' : 'catalyst_or_hmac_inspect');

    // Path 1: Pre-session Catalyst exchange (`catalyst_exchange`) MUST verify Catalyst session
    if (authPolicy === 'catalyst_exchange') {
      const sessionUser = await this.resolveVerifiedCatalystIdentity(req);
      const userItem = await this.db.fetchItem<UserAccountItem>(
        'Users',
        { pk: KeyBuilders.userPk(sessionUser.user_id) },
        { consistent_read: true }
      );
      if (!userItem) {
        throw new AuthGuardError(
          403,
          'USER_PROFILE_NOT_REGISTERED',
          'Usuario autenticado en Catalyst pero sin perfil registrado en Users. Debe completar alta explícita de perfil.'
        );
      }
      if (userItem.accountStatus !== 'active') {
        throw new AuthGuardError(403, 'ACCOUNT_SUSPENDED', 'Cuenta suspendida en Users. Acceso denegado.');
      }
      return {
        catalystUserId: sessionUser.user_id,
        email: userItem.email,
        normalizedEmail: userItem.normalizedEmail,
        displayName: userItem.displayName,
        role: userItem.role,
        roleVersion: userItem.roleVersion,
        sessionEpoch: userItem.sessionEpoch,
        accountStatus: userItem.accountStatus,
        isConfirmed: true,
      };
    }

    // Path 2: No signed cookie present -> allow Catalyst inspection if available (preserving deny-by-default & SIGNED_SESSION_REQUIRED)
    if (signedCookie === undefined) {
      const sessionUser = await this.resolveVerifiedCatalystIdentity(req);
      const userItem = await this.db.fetchItem<UserAccountItem>(
        'Users',
        { pk: KeyBuilders.userPk(sessionUser.user_id) },
        { consistent_read: true }
      );
      if (!userItem) {
        throw new AuthGuardError(
          403,
          'USER_PROFILE_NOT_REGISTERED',
          'Usuario autenticado en Catalyst pero sin perfil registrado en Users. Debe completar alta explícita de perfil.'
        );
      }
      if (userItem.accountStatus !== 'active') {
        throw new AuthGuardError(403, 'ACCOUNT_SUSPENDED', 'Cuenta suspendida en Users. Acceso denegado.');
      }
      if (options.requireSignedSession) {
        throw new AuthGuardError(
          401,
          'SIGNED_SESSION_REQUIRED',
          'Se requiere cookie de sesión firmada por el servidor (__Host-vigor_session).'
        );
      }
      return {
        catalystUserId: sessionUser.user_id,
        email: userItem.email,
        normalizedEmail: userItem.normalizedEmail,
        displayName: userItem.displayName,
        role: userItem.role,
        roleVersion: userItem.roleVersion,
        sessionEpoch: userItem.sessionEpoch,
        accountStatus: userItem.accountStatus,
        isConfirmed: true,
      };
    }

    // Path 3: `__Host-vigor_session` cookie present -> verify cryptographically FIRST (works in cookie-only browser requests)
    const claims = this.sessionTokens.verifyToken(signedCookie);

    // Cross-check Catalyst identity ONLY when using a test double without pre-check
    // OR when an independently recognized Catalyst end-user credential is present.
    // On HMAC-only requests (even with Catalyst Edge `x-zc-user-type=admin` or Zoho Console cookies),
    // UserManagement.getCurrentUser() is NEVER called.
    const shouldInspectOptionalCatalystUser =
      typeof this.authRuntime.hasRequestCatalystUserCredential === 'function'
        ? this.authRuntime.hasRequestCatalystUserCredential(req)
        : true;

    let optionalCatalystUser: CatalystIdentitySnapshot | null = null;
    if (shouldInspectOptionalCatalystUser) {
      try {
        optionalCatalystUser = await this.authRuntime.getCurrentUserFromRequest(req);
      } catch (err) {
        if (err instanceof AuthGuardError) {
          throw err;
        }
        throw new AuthGuardError(
          401,
          'AUTH_SESSION_INVALID',
          err instanceof Error ? err.message : 'Catalyst Auth verification failed.'
        );
      }
      if (optionalCatalystUser && optionalCatalystUser.user_id) {
        if (optionalCatalystUser.user_id !== claims.sub) {
          throw new AuthGuardError(
            401,
            'INVALID_SIGNED_SESSION',
            'Session subject does not match active Catalyst identity.'
          );
        }
        this.assertValidCatalystSnapshot(
          optionalCatalystUser,
          'UNAUTHENTICATED',
          this.sessionTokens.buildLogoutClearCookieHeader()
        );
      }
    }

    const userPk = KeyBuilders.userPk(claims.sub);
    const userItem = await this.db.fetchItem<UserAccountItem>(
      'Users',
      { pk: userPk },
      { consistent_read: true }
    );
    if (!userItem) {
      throw new AuthGuardError(
        403,
        'USER_PROFILE_NOT_REGISTERED',
        'Usuario sin perfil registrado en Users. Acceso denegado.'
      );
    }
    if (userItem.accountStatus !== 'active') {
      throw new AuthGuardError(
        403,
        'ACCOUNT_SUSPENDED',
        'Cuenta suspendida en Users. Acceso denegado.'
      );
    }

    // Individual session validation in SystemControl (`SESSION#<sid>`, `consistent_read: true`)
    const sessionRec = await this.db.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: KeyBuilders.sessionPk(claims.sid) },
      { consistent_read: true }
    );
    const nowSec = this.sessionTokens.getNowSec();
    const clearCookie = this.sessionTokens.buildLogoutClearCookieHeader();

    if (
      !sessionRec ||
      sessionRec.sid !== claims.sid ||
      sessionRec.ownerUserId !== claims.sub
    ) {
      throw new AuthGuardError(
        401,
        'INVALID_SIGNED_SESSION',
        'La sesión no posee registro activo válido en SystemControl.'
      );
    }

    // Rotated session reuse check: <=5s concurrent grace vs security replay detection
    if (sessionRec.status === 'revoked' && sessionRec.revocationReason === 'session_rotated') {
      const graceEligible =
        !options.isRefreshRequest &&
        typeof sessionRec.rotatedAtEpochSec === 'number' &&
        nowSec - sessionRec.rotatedAtEpochSec <= CleanSlateAuthGuard.ROTATED_SESSION_GRACE_SEC;
      if (graceEligible) {
        throw new AuthGuardError(
          401,
          'SESSION_ROTATED_RETRY',
          'La sesión fue rotada hace menos de 5 segundos por una petición concurrente.'
        );
      }
      await this.bumpUserSessionEpochOnSecurityViolation(claims.sub, userItem.sessionEpoch);
      throw new AuthGuardError(
        401,
        'SESSION_REPLAY_DETECTED',
        'Reutilización anómala de sesión rotada detectada; sesiones revocadas globalmente.',
        clearCookie
      );
    }

    if (claims.ep < userItem.sessionEpoch || sessionRec.sessionEpoch < userItem.sessionEpoch) {
      throw new AuthGuardError(
        401,
        'SESSION_REVOKED_REAUTH_REQUIRED',
        'La sesión firmada fue revocada globalmente (sessionEpoch obsoleto). Reautenticación requerida.'
      );
    }

    if (sessionRec.status !== 'active' || sessionRec.revokedAt) {
      throw new AuthGuardError(
        401,
        'SESSION_REVOKED_REAUTH_REQUIRED',
        'La sesión individual fue cerrada o revocada.'
      );
    }

    if (sessionRec.expiresAtEpochSec <= nowSec) {
      throw new AuthGuardError(
        401,
        'INVALID_SIGNED_SESSION',
        'La sesión expiró según marca explícita del servidor (expiresAtEpochSec).'
      );
    }

    if (
      typeof sessionRec.absoluteExpiresAtEpochSec === 'number' &&
      sessionRec.absoluteExpiresAtEpochSec <= nowSec
    ) {
      throw new AuthGuardError(
        401,
        'SESSION_MAX_LIFETIME_REACHED',
        'La sesión alcanzó su vida absoluta máxima (24h). Reautenticación requerida.'
      );
    }

    // Catalyst live revalidation: critical routes OR elapsed >= 15 minutes (900s)
    const lastCheck = sessionRec.lastCatalystCheckAtEpochSec;
    const staleCatalystWindow =
      typeof lastCheck !== 'number' ||
      nowSec - lastCheck >= CleanSlateAuthGuard.CATALYST_REVALIDATION_INTERVAL_SEC;

    if (
      !options.skipCatalystLiveRevalidation &&
      (options.requiresCatalystLiveCheck || staleCatalystWindow)
    ) {
      await this.enforceCatalystLiveRevalidation(
        claims.sub,
        claims.sid,
        userItem.sessionEpoch,
        nowSec,
        Boolean(options.isRefreshRequest)
      );
    }

    return {
      catalystUserId: claims.sub,
      email: userItem.email,
      normalizedEmail: userItem.normalizedEmail,
      displayName: userItem.displayName,
      role: userItem.role,
      roleVersion: userItem.roleVersion,
      sessionEpoch: userItem.sessionEpoch,
      accountStatus: userItem.accountStatus,
      isConfirmed: true,
      sessionId: claims.sid,
      sessionExpiresAtEpochSec: claims.exp,
    };
  }

  /**
   * Mints a signed session cookie AND persists `SESSION#<sid>` in `SystemControl`
   * BEFORE delivering the cookie. Recovers deterministically via `consistent_read: true` on timeout.
   */
  async issueSignedSession(
    actor: AuthoritativeActor,
    options: { initialAuthAtEpochSec?: number; absoluteExpiresAtEpochSec?: number } = {}
  ): Promise<{
    token: string;
    sid: string;
    expiresAt: string;
    expiresAtEpochSec: number;
    absoluteExpiresAtEpochSec: number;
    setCookieHeader: string;
    csrfToken: string;
  }> {
    const nowSec = this.sessionTokens.getNowSec();
    const initialAuthAtEpochSec = options.initialAuthAtEpochSec ?? nowSec;
    const absoluteExpiresAtEpochSec =
      options.absoluteExpiresAtEpochSec ?? initialAuthAtEpochSec + 24 * 3600;
    const remainingAbsSec = absoluteExpiresAtEpochSec - nowSec;
    if (remainingAbsSec <= 0) {
      throw new AuthGuardError(
        401,
        'SESSION_MAX_LIFETIME_REACHED',
        'La sesión alcanzó su vida absoluta máxima (24h). Reautenticación requerida.'
      );
    }
    const requestedTtlSec = Math.min(12 * 3600, remainingAbsSec);

    const { token, claims } = this.sessionTokens.issueTokenWithClaims(
      actor.catalystUserId,
      actor.sessionEpoch,
      requestedTtlSec
    );
    const issuedAt = new Date(claims.iat * 1000).toISOString();
    const expiresAt = new Date(claims.exp * 1000).toISOString();
    const sessionPk = KeyBuilders.sessionPk(claims.sid);

    const sessionRecord: SessionRecordItem = {
      pk: sessionPk,
      sid: claims.sid,
      ownerUserId: actor.catalystUserId,
      sessionEpoch: actor.sessionEpoch,
      issuedAt,
      issuedAtEpochSec: claims.iat,
      initialAuthAtEpochSec,
      expiresAt,
      expiresAtEpochSec: claims.exp,
      absoluteExpiresAtEpochSec,
      lastCatalystCheckAtEpochSec: nowSec,
      status: 'active',
      // TTL is asynchronous storage cleanup ONLY; expiration security uses `expiresAtEpochSec` directly.
      ttlEpochSec: absoluteExpiresAtEpochSec + 24 * 3600,
    };

    try {
      const ins = await this.db.insertItem('SystemControl', sessionRecord, {
        type: 'attribute_not_exists',
        attr: 'pk',
      });
      if (!ins.inserted) {
        throw new AuthGuardError(
          409,
          'SESSION_PERSISTENCE_FAILED',
          'No se pudo registrar SESSION#<sid> en SystemControl.'
        );
      }
    } catch (err) {
      if (!isTimeoutError(err)) throw err;
      const consistentCheck = await this.db.fetchItem<SessionRecordItem>(
        'SystemControl',
        { pk: sessionPk },
        { consistent_read: true }
      );
      if (
        !consistentCheck ||
        consistentCheck.sid !== claims.sid ||
        consistentCheck.ownerUserId !== actor.catalystUserId ||
        consistentCheck.status !== 'active'
      ) {
        throw new AuthGuardError(
          409,
          'SESSION_PERSISTENCE_FAILED',
          'Timeout al registrar sesión; lectura consistente confirma que no existe registro activo.'
        );
      }
    }

    const csrfToken = this.sessionTokens.issueCsrfToken(
      actor.catalystUserId,
      claims.sid,
      actor.sessionEpoch,
      claims.exp
    );

    return {
      token,
      sid: claims.sid,
      expiresAt,
      expiresAtEpochSec: claims.exp,
      absoluteExpiresAtEpochSec,
      setCookieHeader: this.sessionTokens.buildHttpOnlySetCookieHeader(token, claims.exp - claims.iat),
      csrfToken,
    };
  }

  private async revokeActiveSessionWithTimeoutRecovery(
    sid: string,
    reason: string,
    allowAlreadyRevokedWithSameReason: boolean
  ): Promise<void> {
    const sessionPk = KeyBuilders.sessionPk(sid);
    const nowSec = this.sessionTokens.getNowSec();
    const nowIso = new Date(nowSec * 1000).toISOString();
    const patch: Partial<SessionRecordItem> = {
      status: 'revoked',
      revokedAt: nowIso,
      revocationReason: reason,
      ...(reason === 'session_rotated' ? { rotatedAtEpochSec: nowSec } : {}),
    };
    const attemptUpdate = () =>
      this.db.updateItem<SessionRecordItem>(
        'SystemControl',
        { pk: sessionPk },
        patch,
        { type: 'equals', attr: 'status', value: 'active' }
      );

    try {
      const upd = await attemptUpdate();
      if (!upd.updated || upd.status !== 'Success') {
        throw new AuthGuardError(
          401,
          'SESSION_REVOKED_REAUTH_REQUIRED',
          'La sesión ya había sido cerrada o revocada.'
        );
      }
    } catch (err) {
      if (!isTimeoutError(err)) throw err;
      const consistentRec = await this.db.fetchItem<SessionRecordItem>(
        'SystemControl',
        { pk: sessionPk },
        { consistent_read: true }
      );
      if (!consistentRec) {
        throw new AuthGuardError(401, 'INVALID_SIGNED_SESSION', 'Registro de sesión inexistente tras timeout.');
      }
      if (consistentRec.status === 'revoked') {
        if (allowAlreadyRevokedWithSameReason && consistentRec.revocationReason === reason) {
          return;
        }
        throw new AuthGuardError(
          401,
          'SESSION_REVOKED_REAUTH_REQUIRED',
          'La sesión fue revocada durante o antes del timeout; reautenticación requerida.'
        );
      }
      const retryUpd = await attemptUpdate();
      if (!retryUpd.updated || retryUpd.status !== 'Success') {
        throw new AuthGuardError(
          401,
          'SESSION_REVOKED_REAUTH_REQUIRED',
          'Reintento de revocación rechazado.'
        );
      }
    }
  }

  /**
   * Rotates an active signed session (`SESSION#<oldSid>` -> `revoked`, then issues fresh `SESSION#<newSid>`).
   * Prevents reuse of old sessions and avoids dual-active sessions on lost responses or timeouts.
   */
  async refreshSignedSession(
    req: IncomingHttpRequest
  ): Promise<{
    actor: AuthoritativeActor;
    token: string;
    sid: string;
    expiresAt: string;
    expiresAtEpochSec: number;
    absoluteExpiresAtEpochSec: number;
    setCookieHeader: string;
    csrfToken: string;
  }> {
    const actor = await this.authenticate(req, {
      requireSignedSession: true,
      authPolicy: 'hmac_session',
      requiresCatalystLiveCheck: true,
      isRefreshRequest: true,
    });
    if (!actor.sessionId) {
      throw new AuthGuardError(401, 'SIGNED_SESSION_REQUIRED', 'Se requiere sid de sesión activo para renovar.');
    }

    const oldRec = await this.db.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: KeyBuilders.sessionPk(actor.sessionId) },
      { consistent_read: true }
    );
    const nowSec = this.sessionTokens.getNowSec();
    const initialAuthAtEpochSec = oldRec?.initialAuthAtEpochSec ?? oldRec?.issuedAtEpochSec ?? nowSec;
    const absoluteExpiresAtEpochSec = oldRec?.absoluteExpiresAtEpochSec ?? initialAuthAtEpochSec + 24 * 3600;
    if (absoluteExpiresAtEpochSec <= nowSec) {
      throw new AuthGuardError(
        401,
        'SESSION_MAX_LIFETIME_REACHED',
        'La sesión alcanzó su límite absoluto de 24 horas. Reautenticación Catalyst requerida.'
      );
    }

    await this.revokeActiveSessionWithTimeoutRecovery(actor.sessionId, 'session_rotated', false);

    const issued = await this.issueSignedSession(actor, {
      initialAuthAtEpochSec,
      absoluteExpiresAtEpochSec,
    });
    return {
      actor: {
        ...actor,
        sessionId: issued.sid,
        sessionExpiresAtEpochSec: issued.expiresAtEpochSec,
      },
      ...issued,
    };
  }

  /**
   * Closes the caller's current individual session (`SESSION#<sid>`) BEFORE confirming logout.
   * Subsequent replay fails `401 SESSION_REVOKED_REAUTH_REQUIRED`.
   */
  async logoutSession(
    req: IncomingHttpRequest
  ): Promise<{ loggedOut: boolean; revokedSid: string; clearCookieHeader: string }> {
    const actor = await this.authenticate(req, {
      requireSignedSession: true,
      skipCatalystLiveRevalidation: true,
    });
    if (!actor.sessionId) {
      throw new AuthGuardError(401, 'SIGNED_SESSION_REQUIRED', 'Se requiere sesión activa para cerrar sesión.');
    }

    await this.revokeActiveSessionWithTimeoutRecovery(actor.sessionId, 'user_logout', true);

    return {
      loggedOut: true,
      revokedSid: actor.sessionId,
      clearCookieHeader: this.sessionTokens.buildLogoutClearCookieHeader(),
    };
  }

  /**
   * Revokes ONE specific session (`SESSION#<targetSid>`) without affecting the user's other active sessions.
   */
  async revokeIndividualSession(
    actor: AuthoritativeActor,
    targetSid: string,
    reason = 'individual_session_revoked'
  ): Promise<{ revoked: boolean; sid: string; ownerUserId: string }> {
    const sessionPk = KeyBuilders.sessionPk(targetSid);
    const existing = await this.db.fetchItem<SessionRecordItem>(
      'SystemControl',
      { pk: sessionPk },
      { consistent_read: true }
    );
    if (!existing) {
      throw new AuthGuardError(404, 'SESSION_NOT_FOUND', `Sesión '${targetSid}' no encontrada.`);
    }

    const isSelf = existing.ownerUserId === actor.catalystUserId;
    const isAdmin = actor.role === 'admin' || actor.role === 'superadmin';
    if (!isSelf && !isAdmin) {
      throw new AuthGuardError(403, 'INSUFFICIENT_PRIVILEGES', 'No autorizado a revocar sesión de otro usuario.');
    }

    if (!isSelf && actor.role === 'admin') {
      const targetUser = await this.db.fetchItem<UserAccountItem>(
        'Users',
        { pk: KeyBuilders.userPk(existing.ownerUserId) },
        { consistent_read: true }
      );
      if (targetUser?.role === 'superadmin') {
        throw new AuthGuardError(403, 'SUPERADMIN_TARGET_PROTECTED', 'Un admin no puede revocar sesiones de superadmin.');
      }
    }

    const nowIso = new Date(this.sessionTokens.getNowSec() * 1000).toISOString();
    const upd = await this.db.updateItem<SessionRecordItem>(
      'SystemControl',
      { pk: sessionPk },
      { status: 'revoked', revokedAt: nowIso, revocationReason: reason },
      { type: 'equals', attr: 'status', value: 'active' }
    );
    if (!upd.updated || upd.status !== 'Success') {
      throw new AuthGuardError(409, 'SESSION_ALREADY_REVOKED', 'La sesión objetivo ya estaba revocada.');
    }

    return { revoked: true, sid: targetSid, ownerUserId: existing.ownerUserId };
  }

  /**
   * Revokes ALL sessions of a user globally by incrementing `Users.sessionEpoch`.
   */
  async revokeAllUserSessionsGlobally(
    actor: AuthoritativeActor,
    targetUid: string
  ): Promise<{ revokedAll: boolean; targetUid: string; newSessionEpoch: number }> {
    const isSelf = targetUid === actor.catalystUserId;
    const isAdmin = actor.role === 'admin' || actor.role === 'superadmin';
    if (!isSelf && !isAdmin) {
      throw new AuthGuardError(403, 'INSUFFICIENT_PRIVILEGES', 'No autorizado a revocar sesiones globales de otro usuario.');
    }

    const targetPk = KeyBuilders.userPk(targetUid);
    const targetUser = await this.db.fetchItem<UserAccountItem>('Users', { pk: targetPk }, { consistent_read: true });
    if (!targetUser) {
      throw new AuthGuardError(404, 'USER_NOT_FOUND', 'Usuario objetivo no encontrado.');
    }
    if (!isSelf && actor.role === 'admin' && targetUser.role === 'superadmin') {
      throw new AuthGuardError(403, 'SUPERADMIN_TARGET_PROTECTED', 'Un admin no puede revocar sesiones globales de superadmin.');
    }

    const nextEpoch = targetUser.sessionEpoch + 1;
    const upd = await this.db.updateItem<UserAccountItem>(
      'Users',
      { pk: targetPk },
      {
        sessionEpoch: nextEpoch,
        updatedAt: new Date(this.sessionTokens.getNowSec() * 1000).toISOString(),
      },
      { type: 'equals', attr: 'sessionEpoch', value: targetUser.sessionEpoch }
    );
    if (!upd.updated || upd.status !== 'Success') {
      throw new AuthGuardError(409, 'GLOBAL_REVOKE_CONFLICT', 'Conflicto concurrente al incrementar sessionEpoch.');
    }

    return { revokedAll: true, targetUid, newSessionEpoch: nextEpoch };
  }

  /**
   * Explicit Clean-Slate registration endpoint (`POST /api/v1/auth/session/bootstrap-profile`).
   */
  async bootstrapAuthenticatedProfile(
    req: IncomingHttpRequest
  ): Promise<
    AuthoritativeActor & {
      signedSessionCookie: string;
      setCookieHeader: string;
      sid: string;
      expiresAt: string;
      expiresAtEpochSec: number;
      absoluteExpiresAtEpochSec: number;
      csrfToken: string;
    }
  > {
    assertNoIdentitySpoofing(req, false);
    const sessionUser = await this.resolveVerifiedCatalystIdentity(req);

    const pk = KeyBuilders.userPk(sessionUser.user_id);
    const existing = await this.db.fetchItem<UserAccountItem>(
      'Users',
      { pk },
      { consistent_read: true }
    );

    if (existing) {
      if (existing.accountStatus !== 'active') {
        throw new AuthGuardError(403, 'ACCOUNT_SUSPENDED', 'Cuenta suspendida en Users. Acceso denegado.');
      }
      const actor: AuthoritativeActor = {
        catalystUserId: existing.uid,
        email: existing.email,
        normalizedEmail: existing.normalizedEmail,
        displayName: existing.displayName,
        role: existing.role,
        roleVersion: existing.roleVersion,
        sessionEpoch: existing.sessionEpoch,
        accountStatus: existing.accountStatus,
        isConfirmed: true,
      };
      const issued = await this.issueSignedSession(actor);
      return {
        ...actor,
        sessionId: issued.sid,
        sessionExpiresAtEpochSec: issued.expiresAtEpochSec,
        sid: issued.sid,
        expiresAt: issued.expiresAt,
        expiresAtEpochSec: issued.expiresAtEpochSec,
        absoluteExpiresAtEpochSec: issued.absoluteExpiresAtEpochSec,
        signedSessionCookie: issued.token,
        setCookieHeader: issued.setCookieHeader,
        csrfToken: issued.csrfToken,
      };
    }

    const normalizedEmail = sessionUser.email_id.toLowerCase().trim();
    const emailMatches = await this.db.queryIndex<UserAccountItem>('Users', {
      indexName: 'GSI_Email',
      partitionKeyValue: normalizedEmail,
      consistent_read: true,
    });

    if (emailMatches.items.some(u => u.uid !== sessionUser.user_id)) {
      throw new AuthGuardError(
        409,
        'DUPLICATE_EMAIL_ANOMALY',
        `Correo '${normalizedEmail}' ya vinculado a otro user_id distinto. Intervención administrativa requerida.`
      );
    }

    const nowIso = new Date(this.sessionTokens.getNowSec() * 1000).toISOString();
    const displayName =
      [sessionUser.first_name, sessionUser.last_name].filter(Boolean).join(' ').trim() ||
      normalizedEmail.split('@')[0];

    const newProfile: UserAccountItem = {
      pk,
      uid: sessionUser.user_id,
      email: sessionUser.email_id,
      normalizedEmail,
      displayName,
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth',
      directorySegment: KeyBuilders.directorySegment(sessionUser.user_id),
      onboardingCompleted: false,
      onboardingStep: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    };

    await this.db.insertItem('Users', newProfile);

    const actor: AuthoritativeActor = {
      catalystUserId: newProfile.uid,
      email: newProfile.email,
      normalizedEmail: newProfile.normalizedEmail,
      displayName: newProfile.displayName,
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      isConfirmed: true,
    };
    const issued = await this.issueSignedSession(actor);
    return {
      ...actor,
      sessionId: issued.sid,
      sessionExpiresAtEpochSec: issued.expiresAtEpochSec,
      sid: issued.sid,
      expiresAt: issued.expiresAt,
      expiresAtEpochSec: issued.expiresAtEpochSec,
      absoluteExpiresAtEpochSec: issued.absoluteExpiresAtEpochSec,
      signedSessionCookie: issued.token,
      setCookieHeader: issued.setCookieHeader,
      csrfToken: issued.csrfToken,
    };
  }

  requireRole(actor: AuthoritativeActor, allowedRoles: UserRole[]): void {
    if (!allowedRoles.includes(actor.role)) {
      throw new AuthGuardError(
        403,
        'INSUFFICIENT_PRIVILEGES',
        `Acceso denegado: Se requiere rol [${allowedRoles.join(', ')}]. Actual: '${actor.role}'.`
      );
    }
  }
}
