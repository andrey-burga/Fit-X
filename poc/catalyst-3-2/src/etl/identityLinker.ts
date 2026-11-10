/**
 * VigorCore — ETL Identity Linker & Proof of Possession Engine
 * Resolves F-ID-01: Secure Identity Linking between Zoho Catalyst and Firebase Auth
 * 
 * Invariants:
 * 1. Catalyst Identity != Firebase Identity.
 * 2. Email match alone is NEVER sufficient for linking.
 * 3. Proof of Possession (PoP) of historical Firebase account is strictly validated server-side.
 * 4. 1:1 Bi-directional bijection: One Catalyst user <-> Exactly One Firebase UID.
 * 5. Idempotent re-linking with same tuple; fail-closed rejection on collisions or overwrites.
 * 6. Catalyst account must be active AND confirmed (is_confirmed === true).
 */

import crypto from 'node:crypto';

export interface CatalystSessionContext {
  userId: string;          // Catalyst numeric ID (e.g. "1583000000123456")
  email: string;
  isConfirmed: boolean;    // Must be true
  status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED';
}

export interface FirebaseTokenClaims {
  iss: string;             // Must match https://securetoken.google.com/<projectId>
  aud: string;             // Must match <projectId>
  sub: string;             // Firebase UID (never from client parameter!)
  email?: string;
  email_verified?: boolean;
  auth_time: number;       // Unix epoch seconds
  exp: number;             // Unix epoch seconds
  iat: number;
}

export interface FirebaseTokenValidator {
  verifyIdToken(tokenString: string): Promise<{ valid: boolean; claims?: FirebaseTokenClaims; error?: string }>;
}

export interface IdentityBridgeRecord {
  pk: string;                  // 'USER#' + sourceUid
  sk: 'PROFILE';
  sourceUid: string;           // Firebase UID
  catalystUserId: string;      // Catalyst user_id
  emailNormalized: string;
  linkStatus: 'MIGRATED_UNLINKED' | 'LINKED_ACTIVE' | 'DISPUTED_LOCKED';
  linkedAt?: number;
  linkedMethod: 'PROOF_OF_POSSESSION_TOKEN' | 'ADMINISTRATIVE_OVERRIDE';
  tokenAuthTime?: number;
  version: number;
}

export interface IdentityLinkResult {
  success: boolean;
  status: 'LINKED' | 'ALREADY_LINKED' | 'REJECTED_UNCONFIRMED' | 'REJECTED_INVALID_PROOF' | 'REJECTED_COLLISION' | 'REJECTED_SUSPENDED' | 'REJECTED_TAMPERED';
  sourceUid?: string;
  catalystUserId?: string;
  error?: string;
}

export interface IdentityStorageStore {
  getMappingBySourceUid(sourceUid: string): Promise<IdentityBridgeRecord | null>;
  getMappingByCatalystUserId(catalystUserId: string): Promise<IdentityBridgeRecord | null>;
  getMappingByEmail(emailNormalized: string): Promise<IdentityBridgeRecord | null>;
  saveMapping(record: IdentityBridgeRecord): Promise<void>;
  updateMappingConditional(record: IdentityBridgeRecord, expectedVersion: number): Promise<boolean>;
}

/**
 * In-memory deterministic storage for identity bindings
 */
export class InMemoryIdentityStore implements IdentityStorageStore {
  private bySourceUid = new Map<string, IdentityBridgeRecord>();
  private byCatalystId = new Map<string, IdentityBridgeRecord>();
  private byEmail = new Map<string, IdentityBridgeRecord>();

  async getMappingBySourceUid(sourceUid: string): Promise<IdentityBridgeRecord | null> {
    const r = this.bySourceUid.get(sourceUid);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async getMappingByCatalystUserId(catalystUserId: string): Promise<IdentityBridgeRecord | null> {
    const r = this.byCatalystId.get(catalystUserId);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async getMappingByEmail(emailNormalized: string): Promise<IdentityBridgeRecord | null> {
    const r = this.byEmail.get(emailNormalized.toLowerCase().trim());
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async saveMapping(record: IdentityBridgeRecord): Promise<void> {
    const clone = JSON.parse(JSON.stringify(record));
    this.bySourceUid.set(clone.sourceUid, clone);
    if (clone.catalystUserId) {
      this.byCatalystId.set(clone.catalystUserId, clone);
    }
    this.byEmail.set(clone.emailNormalized.toLowerCase().trim(), clone);
  }

  async updateMappingConditional(record: IdentityBridgeRecord, expectedVersion: number): Promise<boolean> {
    const existing = this.bySourceUid.get(record.sourceUid);
    if (!existing || existing.version !== expectedVersion) {
      return false;
    }
    const updated: IdentityBridgeRecord = {
      ...record,
      version: expectedVersion + 1,
    };
    this.bySourceUid.set(updated.sourceUid, updated);
    if (updated.catalystUserId) {
      this.byCatalystId.set(updated.catalystUserId, updated);
    }
    this.byEmail.set(updated.emailNormalized.toLowerCase().trim(), updated);
    return true;
  }

  clear() {
    this.bySourceUid.clear();
    this.byCatalystId.clear();
    this.byEmail.clear();
  }
}

/**
 * Secure Identity Linking Coordinator
 */
export class SecureIdentityLinker {
  constructor(
    private expectedGcpProjectId: string,
    private tokenValidator: FirebaseTokenValidator,
    private store: IdentityStorageStore,
    private maxTokenAgeSeconds = 300 // Token must be minted within 5 mins for linking
  ) {}

  /**
   * Link an active Catalyst session to a historical Firebase account with cryptographic Proof of Possession.
   */
  async linkWithProofOfPossession(
    catalystSession: CatalystSessionContext,
    firebaseProofToken: string
  ): Promise<IdentityLinkResult> {
    // 1. Validate Catalyst Account Context (Fail-closed)
    if (!catalystSession.userId || !catalystSession.email) {
      return { success: false, status: 'REJECTED_INVALID_PROOF', error: 'MISSING_CATALYST_IDENTITY' };
    }

    if (catalystSession.status !== 'ACTIVE') {
      return {
        success: false,
        status: 'REJECTED_SUSPENDED',
        error: `CATALYST_ACCOUNT_NOT_ACTIVE: Status is ${catalystSession.status}`,
      };
    }

    if (catalystSession.isConfirmed !== true) {
      return {
        success: false,
        status: 'REJECTED_UNCONFIRMED',
        error: 'CATALYST_ACCOUNT_UNCONFIRMED: Email verification is required before linking historical data.',
      };
    }

    // 2. Validate Firebase Proof Token server-side
    if (!firebaseProofToken || typeof firebaseProofToken !== 'string') {
      return {
        success: false,
        status: 'REJECTED_INVALID_PROOF',
        error: 'MISSING_FIREBASE_PROOF_TOKEN: Proof of possession token is mandatory.',
      };
    }

    const verification = await this.tokenValidator.verifyIdToken(firebaseProofToken);
    if (!verification.valid || !verification.claims) {
      return {
        success: false,
        status: 'REJECTED_INVALID_PROOF',
        error: `INVALID_FIREBASE_PROOF: ${verification.error || 'Token verification failed'}`,
      };
    }

    const claims = verification.claims;
    const nowSec = Math.floor(Date.now() / 1000);

    // Verify Project Audience and Issuer
    const expectedIss = `https://securetoken.google.com/${this.expectedGcpProjectId}`;
    if (claims.iss !== expectedIss || claims.aud !== this.expectedGcpProjectId) {
      return {
        success: false,
        status: 'REJECTED_TAMPERED',
        error: `PROJECT_MISMATCH: Token aud (${claims.aud}) or iss (${claims.iss}) does not match expected project ${this.expectedGcpProjectId}`,
      };
    }

    // Verify Expiration
    if (claims.exp <= nowSec) {
      return {
        success: false,
        status: 'REJECTED_INVALID_PROOF',
        error: 'FIREBASE_TOKEN_EXPIRED: Proof token has expired.',
      };
    }

    // Verify Freshness (PoP must be recent)
    if (claims.auth_time && (nowSec - claims.auth_time) > this.maxTokenAgeSeconds) {
      return {
        success: false,
        status: 'REJECTED_INVALID_PROOF',
        error: `STALE_PROOF_TOKEN: Token auth_time is older than ${this.maxTokenAgeSeconds}s. Recent re-authentication required.`,
      };
    }

    // Extract historical UID strictly from verified claims.sub
    const historicalUid = claims.sub;
    if (!historicalUid || typeof historicalUid !== 'string' || historicalUid.length < 5) {
      return {
        success: false,
        status: 'REJECTED_INVALID_PROOF',
        error: 'MALFORMED_FIREBASE_UID: Claims sub is missing or invalid.',
      };
    }

    // 3. Lookup existing mapping by historical Firebase UID
    const existingBySource = await this.store.getMappingBySourceUid(historicalUid);

    // 4. Lookup existing mapping by Catalyst User ID
    const existingByCatalyst = await this.store.getMappingByCatalystUserId(catalystSession.userId);

    // Scenario A: Catalyst user already linked to ANOTHER Firebase UID -> Reject collision
    if (existingByCatalyst && existingByCatalyst.sourceUid !== historicalUid) {
      return {
        success: false,
        status: 'REJECTED_COLLISION',
        error: `CATALYST_ALREADY_LINKED: Catalyst user ${catalystSession.userId} is already linked to sourceUid ${existingByCatalyst.sourceUid}. Multiple bindings forbidden.`,
      };
    }

    // Scenario B: Firebase UID already linked to ANOTHER Catalyst user -> Reject collision
    if (existingBySource && existingBySource.catalystUserId && existingBySource.catalystUserId !== catalystSession.userId) {
      return {
        success: false,
        status: 'REJECTED_COLLISION',
        error: `FIREBASE_UID_ALREADY_CLAIMED: Firebase UID ${historicalUid} is already linked to catalystUserId ${existingBySource.catalystUserId}. Cross-tenant takeover forbidden.`,
      };
    }

    // Scenario C: Already linked to this exact same tuple -> Idempotent Success
    if (existingBySource && existingBySource.catalystUserId === catalystSession.userId) {
      return {
        success: true,
        status: 'ALREADY_LINKED',
        sourceUid: historicalUid,
        catalystUserId: catalystSession.userId,
      };
    }

    // Scenario D: Pre-migrated record exists (status MIGRATED_UNLINKED) -> Atomic Link
    if (existingBySource) {
      const updated: IdentityBridgeRecord = {
        ...existingBySource,
        catalystUserId: catalystSession.userId,
        linkStatus: 'LINKED_ACTIVE',
        linkedAt: Date.now(),
        linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
        tokenAuthTime: claims.auth_time,
      };

      const updatedOk = await this.store.updateMappingConditional(updated, existingBySource.version);
      if (!updatedOk) {
        return {
          success: false,
          status: 'REJECTED_COLLISION',
          error: 'CONCURRENT_LINK_CONFLICT: State modified concurrently during link operation.',
        };
      }

      return {
        success: true,
        status: 'LINKED',
        sourceUid: historicalUid,
        catalystUserId: catalystSession.userId,
      };
    }

    // Scenario E: No pre-existing record -> Create new verified link
    const newRecord: IdentityBridgeRecord = {
      pk: `USER#${historicalUid}`,
      sk: 'PROFILE',
      sourceUid: historicalUid,
      catalystUserId: catalystSession.userId,
      emailNormalized: catalystSession.email.toLowerCase().trim(),
      linkStatus: 'LINKED_ACTIVE',
      linkedAt: Date.now(),
      linkedMethod: 'PROOF_OF_POSSESSION_TOKEN',
      tokenAuthTime: claims.auth_time,
      version: 1,
    };

    await this.store.saveMapping(newRecord);

    return {
      success: true,
      status: 'LINKED',
      sourceUid: historicalUid,
      catalystUserId: catalystSession.userId,
    };
  }
}
