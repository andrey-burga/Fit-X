/**
 * VigorCore — Safe, Non-Destructive Rollback & Recovery Engine
 * Resolves F-ROL-01: Elimination of Destructive Blind Deletion
 * 
 * Rules:
 * 1. Conservative Rollback Policy: Automatic batch deletion is strictly forbidden
 *    once user writes are enabled (Post-Cutover).
 * 2. Never delete by secondary attribute match (no 'DELETE WHERE batchId').
 * 3. Content Integrity Guard: Even if 'updatedAt == _migratedAt', if the content
 *    has changed (hash mismatch), the document MUST NOT be deleted.
 * 4. Discrepancies are isolated into a quarantined audit report, never deleted.
 */

import { computeCanonicalSha256 } from './serializationPrecision.js';

export interface MigrationManifestItem {
  pk: string;
  sk: string;
  sourceUid: string;
  sourcePath: string;
  transformedHash: string; // Original canonical hash at import time
  migratedAt: number;      // Epoch ms
  migrationBatchId: string;
}

export interface RollbackTargetStore {
  fetchItem(table: string, pk: string, sk: string): Promise<Record<string, unknown> | null>;
  deleteItem(table: string, pk: string, sk: string, condition?: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
}

export interface RollbackSafetyConfig {
  userWritesEnabled: boolean; // Flag indicating if application is live
  allowForcedAdminOverride?: boolean;
}

export interface QuarantinedRollbackItem {
  pk: string;
  sk: string;
  reason: 'POST_MIGRATION_USER_MUTATION' | 'CONTENT_HASH_MISMATCH' | 'TIMESTAMP_DIVERGENCE' | 'CONCURRENT_MUTATION_RACE' | 'UNKNOWN_STATE';
  currentHash?: string;
  expectedHash: string;
  currentUpdatedAt?: number;
  migratedAt: number;
}

export interface RollbackSafetyReport {
  status: 'COMPLETED_CLEAN' | 'ABORTED_USER_WRITES_ACTIVE' | 'COMPLETED_WITH_QUARANTINE' | 'FAILED';
  totalExamined: number;
  deletedCount: number;
  preservedUserCount: number;
  quarantinedCount: number;
  quarantinedItems: QuarantinedRollbackItem[];
  errors: Array<{ pk: string; sk: string; error: string }>;
  executionDurationMs: number;
}

export class SafeRollbackEngine {
  constructor(private store: RollbackTargetStore) {}

  /**
   * Executes conservative, non-destructive rollback.
   * Guarantees that no legitimate post-migration user mutation is ever deleted.
   */
  async executeSafeRollback(
    tableName: string,
    manifestItems: MigrationManifestItem[],
    config: RollbackSafetyConfig
  ): Promise<RollbackSafetyReport> {
    const start = performance.now();

    // 1. Conservative Policy Check: Post-Cutover Guard
    if (config.userWritesEnabled && !config.allowForcedAdminOverride) {
      return {
        status: 'ABORTED_USER_WRITES_ACTIVE',
        totalExamined: manifestItems.length,
        deletedCount: 0,
        preservedUserCount: 0,
        quarantinedCount: 0,
        quarantinedItems: [],
        errors: [
          {
            pk: 'ALL',
            sk: 'ALL',
            error: 'SAFETY_HALT: Automatic rollback is prohibited because user writes are active in production. Manual triage required.',
          },
        ],
        executionDurationMs: performance.now() - start,
      };
    }

    let deletedCount = 0;
    let preservedUserCount = 0;
    const quarantinedItems: QuarantinedRollbackItem[] = [];
    const errors: Array<{ pk: string; sk: string; error: string }> = [];

    // 2. Iterate each manifest item individually with strict pre-conditions
    for (const manifestItem of manifestItems) {
      const { pk, sk, transformedHash, migratedAt, migrationBatchId } = manifestItem;

      try {
        const current = await this.store.fetchItem(tableName, pk, sk);

        // Scenario A: Item already removed or does not exist
        if (!current) {
          continue;
        }

        // Scenario B: Item belongs to a different migration batch
        if (current._migrationBatchId && current._migrationBatchId !== migrationBatchId) {
          quarantinedItems.push({
            pk,
            sk,
            reason: 'POST_MIGRATION_USER_MUTATION',
            expectedHash: transformedHash,
            migratedAt,
          });
          preservedUserCount++;
          continue;
        }

        // Scenario C: Explicit post-migration mutation flag
        if (current._userMutatedAfterMigration === true) {
          quarantinedItems.push({
            pk,
            sk,
            reason: 'POST_MIGRATION_USER_MUTATION',
            expectedHash: transformedHash,
            migratedAt,
          });
          preservedUserCount++;
          continue;
        }

        // Scenario D: Timestamp check
        const currentUpdatedAt = Number(current.updatedAt || current._updatedAt || 0);
        if (currentUpdatedAt > migratedAt) {
          quarantinedItems.push({
            pk,
            sk,
            reason: 'TIMESTAMP_DIVERGENCE',
            expectedHash: transformedHash,
            currentUpdatedAt,
            migratedAt,
          });
          preservedUserCount++;
          continue;
        }

        // Scenario E: Deep Content Hash Check (Catches mutations where updatedAt was not bumped!)
        const currentContentHash = computeCanonicalSha256(current);
        if (currentContentHash !== transformedHash) {
          quarantinedItems.push({
            pk,
            sk,
            reason: 'CONTENT_HASH_MISMATCH',
            currentHash: currentContentHash,
            expectedHash: transformedHash,
            currentUpdatedAt,
            migratedAt,
          });
          preservedUserCount++;
          continue;
        }

        // Scenario F: State is proven 100% identical to import -> Safe conditional deletion
        const deleteRes = await this.store.deleteItem(tableName, pk, sk, {
          expectedHash: transformedHash,
          batchId: migrationBatchId,
        });

        if (deleteRes.success) {
          deletedCount++;
        } else {
          errors.push({ pk, sk, error: deleteRes.error || 'DELETE_FAILED' });
        }
      } catch (err: any) {
        errors.push({ pk, sk, error: err.message || 'UNEXPECTED_ERROR' });
      }
    }

    const duration = performance.now() - start;
    const finalStatus =
      errors.length > 0
        ? 'FAILED'
        : quarantinedItems.length > 0
          ? 'COMPLETED_WITH_QUARANTINE'
          : 'COMPLETED_CLEAN';

    return {
      status: finalStatus,
      totalExamined: manifestItems.length,
      deletedCount,
      preservedUserCount,
      quarantinedCount: quarantinedItems.length,
      quarantinedItems,
      errors,
      executionDurationMs: duration,
    };
  }
}
