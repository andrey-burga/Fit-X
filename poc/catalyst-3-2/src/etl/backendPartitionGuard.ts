/**
 * VigorCore — Backend Partition Guard & Anti-IDOR Enforcement Engine
 * Resolves F-ID-02: Mandatory Server-Side Partition Derivation
 * 
 * Rules:
 * 1. The client NEVER chooses its partition key (pk).
 * 2. Partition key (USER#<sourceUid>) is derived strictly by looking up the authenticated
 *    Catalyst user session against the persisted identity mapping store.
 * 3. Any client-supplied 'sourceUid', 'userId', 'pk', or 'user_id' in body, query, path,
 *    or custom headers is strictly rejected or stripped.
 * 4. The data repository accepts ONLY an AuthenticatedPartitionContext.
 */

import type { IdentityStorageStore, IdentityBridgeRecord } from './identityLinker.js';

export interface AuthenticatedPartitionContext {
  catalystUserId: string;
  sourceUid: string;
  partitionKey: string;  // Exactly "USER#" + sourceUid
  email: string;
  role: 'athlete' | 'admin' | 'superadmin';
  resolvedAt: number;
}

export interface ClientRequestPayload {
  headers?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface PartitionResolutionResult {
  authorized: boolean;
  context?: AuthenticatedPartitionContext;
  errorCode?: 'UNAUTHENTICATED' | 'SPOOFING_ATTEMPT_DETECTED' | 'UNCONFIRMED_ACCOUNT' | 'IDENTITY_MAPPING_NOT_FOUND' | 'IDENTITY_MAPPING_DISABLED' | 'INSUFFICIENT_ADMIN_PERMISSIONS';
  errorMessage?: string;
}

export class BackendPartitionGuard {
  constructor(private identityStore: IdentityStorageStore) {}

  /**
   * Resolves the verified partition context and detects client-side IDOR spoofing attempts.
   */
  async resolvePartition(
    authenticatedCatalystUser: { userId: string; email: string; isConfirmed: boolean; status: string; role?: string } | null,
    incomingRequest: ClientRequestPayload,
    requiredRole?: 'athlete' | 'admin' | 'superadmin'
  ): Promise<PartitionResolutionResult> {
    // 1. Session verification
    if (!authenticatedCatalystUser || !authenticatedCatalystUser.userId) {
      return {
        authorized: false,
        errorCode: 'UNAUTHENTICATED',
        errorMessage: 'Missing valid Catalyst authentication session.',
      };
    }

    if (authenticatedCatalystUser.status !== 'ACTIVE') {
      return {
        authorized: false,
        errorCode: 'IDENTITY_MAPPING_DISABLED',
        errorMessage: 'Catalyst user account is not active.',
      };
    }

    if (authenticatedCatalystUser.isConfirmed !== true) {
      return {
        authorized: false,
        errorCode: 'UNCONFIRMED_ACCOUNT',
        errorMessage: 'Catalyst account email is unconfirmed.',
      };
    }

    // 2. Anti-Spoofing & IDOR Detection: Inspect headers, query, path, and body
    const forbiddenKeys = ['sourceuid', 'source_uid', 'targetuid', 'target_uid', 'targetuserid', 'user_id', 'userid', 'pk', 'partition_key'];

    // Check Headers
    if (incomingRequest.headers) {
      for (const [k, v] of Object.entries(incomingRequest.headers)) {
        if (!v) continue;
        const lowerK = k.toLowerCase().replace(/[-_]/g, '');
        if (forbiddenKeys.includes(lowerK) || lowerK.startsWith('xuser') || lowerK.startsWith('xauth') || lowerK.startsWith('xactor')) {
          return {
            authorized: false,
            errorCode: 'SPOOFING_ATTEMPT_DETECTED',
            errorMessage: `Security violation: Forbidden identity header '${k}' is prohibited. Client cannot supply tenant identity.`,
          };
        }
      }
    }

    // Check Query Parameters
    if (incomingRequest.query) {
      for (const k of Object.keys(incomingRequest.query)) {
        const lowerK = k.toLowerCase().replace(/[-_]/g, '');
        if (forbiddenKeys.includes(lowerK)) {
          return {
            authorized: false,
            errorCode: 'SPOOFING_ATTEMPT_DETECTED',
            errorMessage: `Security violation: Forbidden query parameter '${k}'. Client cannot override tenant partition.`,
          };
        }
      }
    }

    // Check Path / Params
    if (incomingRequest.params) {
      for (const [k, v] of Object.entries(incomingRequest.params)) {
        const lowerK = k.toLowerCase().replace(/[-_]/g, '');
        if (forbiddenKeys.includes(lowerK) && v && v !== authenticatedCatalystUser.userId) {
          // If the path contains an explicit userId parameter that does not match authenticated user, and not admin
          if (!requiredRole || requiredRole === 'athlete') {
            return {
              authorized: false,
              errorCode: 'SPOOFING_ATTEMPT_DETECTED',
              errorMessage: `Security violation: Path parameter '${k}' attempts cross-tenant access.`,
            };
          }
        }
      }
    }

    // Check Body
    if (incomingRequest.body && typeof incomingRequest.body === 'object') {
      for (const k of Object.keys(incomingRequest.body)) {
        const lowerK = k.toLowerCase().replace(/[-_]/g, '');
        if (forbiddenKeys.includes(lowerK)) {
          // Client tried to inject tenant ID in body
          return {
            authorized: false,
            errorCode: 'SPOOFING_ATTEMPT_DETECTED',
            errorMessage: `Security violation: Body attribute '${k}' attempts to specify partition identity.`,
          };
        }
      }
    }

    // 3. Resolve persisted identity mapping from server store
    const mapping = await this.identityStore.getMappingByCatalystUserId(authenticatedCatalystUser.userId);

    if (!mapping) {
      return {
        authorized: false,
        errorCode: 'IDENTITY_MAPPING_NOT_FOUND',
        errorMessage: `No historical identity bridge found for Catalyst user ${authenticatedCatalystUser.userId}. Account must complete identity linking.`,
      };
    }

    if (mapping.linkStatus !== 'LINKED_ACTIVE') {
      return {
        authorized: false,
        errorCode: 'IDENTITY_MAPPING_DISABLED',
        errorMessage: `Identity mapping status is ${mapping.linkStatus}. Partition access is suspended.`,
      };
    }

    // 4. Role Authorization check
    const rawRole = (authenticatedCatalystUser.role || 'athlete').toLowerCase();
    const effectiveRole: 'athlete' | 'admin' | 'superadmin' =
      rawRole === 'superadmin' ? 'superadmin' : rawRole === 'admin' ? 'admin' : 'athlete';

    if (requiredRole && requiredRole !== 'athlete') {
      if (effectiveRole !== requiredRole && effectiveRole !== 'superadmin') {
        return {
          authorized: false,
          errorCode: 'INSUFFICIENT_ADMIN_PERMISSIONS',
          errorMessage: `Operation requires role '${requiredRole}'. Current role is '${effectiveRole}'.`,
        };
      }
    }

    // 5. Construct verified immutable context
    const context: AuthenticatedPartitionContext = {
      catalystUserId: authenticatedCatalystUser.userId,
      sourceUid: mapping.sourceUid,
      partitionKey: `USER#${mapping.sourceUid}`,
      email: authenticatedCatalystUser.email,
      role: effectiveRole,
      resolvedAt: Date.now(),
    };

    return {
      authorized: true,
      context,
    };
  }
}
