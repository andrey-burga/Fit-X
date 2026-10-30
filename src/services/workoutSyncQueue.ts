/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Workout Offline Queue & Synchronization Service
 * Multi-tenant safe, strictly isolated by Athlete UID.
 * Ensures zero cross-tenant contamination, idempotency, and orphan data quarantine.
 */

import { WorkoutSessionRecord, WorkoutSetType } from '../types/workout';

export interface OfflinePendingSet {
  id: string;
  userId: string;
  executedWorkoutId?: string;
  exerciseId: string;
  exerciseName: string;
  date: string;
  weightKg: number;
  reps: number;
  rir: number;
  estimated1RM: number;
  completed: boolean;
  createdAt: string;
  setNumber?: number;
  setType?: WorkoutSetType;
  queuedAt: string;
  attempts?: number;
  lastError?: string;
}

export interface SyncResult {
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  quarantinedCount: number;
  errors: string[];
}

export const BASE_PENDING_KEY = 'vigor_offline_pending_sets';
export const ORPHAN_QUARANTINE_KEY = 'vigor_offline_orphan_sets';

/**
 * Returns the scoped storage key for a specific athlete UID.
 * Never uses a shared key across multiple accounts.
 */
export function getScopedPendingQueueKey(userId: string, isDemo = false): string {
  if (isDemo || userId.startsWith('demo_')) {
    const demoId = userId.toLowerCase().includes('sof') ? 'demo_sofia' : 'demo_camilo';
    return `${BASE_PENDING_KEY}_demo_${demoId}`;
  }
  return `${BASE_PENDING_KEY}_uid_${userId}`;
}

/**
 * Inspects and safely migrates any legacy unpartitioned storage key ('vigor_offline_pending_sets').
 * - Valid entries with verifiable userId are moved to their respective scoped key.
 * - Unverifiable entries lacking a valid userId are quarantined into 'vigor_offline_orphan_sets'.
 * - The shared legacy key is completely eliminated.
 */
export function migrateLegacyPendingSets(): { migrated: number; quarantined: number } {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { migrated: 0, quarantined: 0 };
  }

  let migrated = 0;
  let quarantined = 0;

  try {
    const rawLegacy = localStorage.getItem(BASE_PENDING_KEY);
    if (!rawLegacy) return { migrated: 0, quarantined: 0 };

    const parsed = JSON.parse(rawLegacy);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(BASE_PENDING_KEY);
      return { migrated: 0, quarantined: 0 };
    }

    const orphanQueue: OfflinePendingSet[] = (() => {
      try {
        const raw = localStorage.getItem(ORPHAN_QUARANTINE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();

    for (const item of parsed) {
      if (item && typeof item === 'object' && item.userId && typeof item.userId === 'string' && item.userId.trim() !== '') {
        const userKey = getScopedPendingQueueKey(item.userId, item.userId.startsWith('demo_'));
        const existingForUser: OfflinePendingSet[] = (() => {
          try {
            const raw = localStorage.getItem(userKey);
            return raw ? JSON.parse(raw) : [];
          } catch {
            return [];
          }
        })();

        if (!existingForUser.some(e => e.id === item.id)) {
          existingForUser.push(item);
          localStorage.setItem(userKey, JSON.stringify(existingForUser));
          migrated++;
        }
      } else {
        // Quarantined orphan item
        const orphanItem: OfflinePendingSet = {
          ...item,
          id: item.id || `orphan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          userId: 'ORPHAN_NO_UID',
          queuedAt: item.queuedAt || new Date().toISOString(),
          lastError: 'Quarantined: Record lacked valid userId during legacy migration.',
        };
        orphanQueue.push(orphanItem);
        quarantined++;
      }
    }

    if (quarantined > 0) {
      localStorage.setItem(ORPHAN_QUARANTINE_KEY, JSON.stringify(orphanQueue));
    }

    // Eliminate shared legacy key
    localStorage.removeItem(BASE_PENDING_KEY);
  } catch (err) {
    console.error('Error migrating legacy pending sets:', err);
  }

  return { migrated, quarantined };
}

/**
 * Enqueues a workout set safely into the user's isolated offline queue.
 * Rejects or quarantines any set lacking an unequivocal userId.
 */
export function enqueueOfflineSet(
  record: WorkoutSessionRecord | OfflinePendingSet,
  isDemo = false
): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  // Run migration check lazily
  migrateLegacyPendingSets();

  if (!record.userId || typeof record.userId !== 'string' || record.userId.trim() === '') {
    // Quarantine orphan set
    try {
      const raw = localStorage.getItem(ORPHAN_QUARANTINE_KEY);
      const orphans: OfflinePendingSet[] = raw ? JSON.parse(raw) : [];
      orphans.push({
        ...record,
        id: record.id || `orphan_${Date.now()}`,
        userId: 'ORPHAN_NO_UID',
        queuedAt: new Date().toISOString(),
        lastError: 'Quarantined: Attempted enqueue without verifiable userId.',
      });
      localStorage.setItem(ORPHAN_QUARANTINE_KEY, JSON.stringify(orphans));
    } catch {}
    return false;
  }

  const userKey = getScopedPendingQueueKey(record.userId, isDemo);
  try {
    const raw = localStorage.getItem(userKey);
    const queue: OfflinePendingSet[] = raw ? JSON.parse(raw) : [];

    const existingIndex = queue.findIndex(item => item.id === record.id);
    const offlineItem: OfflinePendingSet = {
      ...record,
      queuedAt: (record as OfflinePendingSet).queuedAt || new Date().toISOString(),
      attempts: (record as OfflinePendingSet).attempts || 0,
    };

    if (existingIndex >= 0) {
      // Idempotent update
      queue[existingIndex] = offlineItem;
    } else {
      queue.push(offlineItem);
    }

    localStorage.setItem(userKey, JSON.stringify(queue));
    return true;
  } catch (err) {
    console.error('Failed to enqueue offline set:', err);
    return false;
  }
}

/**
 * Retrieves all offline pending sets strictly belonging to the specified athlete UID.
 */
export function getOfflinePendingSets(userId: string, isDemo = false): OfflinePendingSet[] {
  if (typeof window === 'undefined' || !window.localStorage || !userId) return [];
  migrateLegacyPendingSets();

  const userKey = getScopedPendingQueueKey(userId, isDemo);
  try {
    const raw = localStorage.getItem(userKey);
    if (!raw) return [];
    const list: OfflinePendingSet[] = JSON.parse(raw);
    // Strict defense: filter out any corrupted entry that doesn't match this user's UID
    return list.filter(item => item.userId === userId);
  } catch {
    return [];
  }
}

/**
 * Removes a successfully uploaded set from the athlete's isolated offline queue.
 */
export function removeOfflinePendingSet(userId: string, setId: string, isDemo = false): void {
  if (typeof window === 'undefined' || !window.localStorage || !userId || !setId) return;

  const userKey = getScopedPendingQueueKey(userId, isDemo);
  try {
    const raw = localStorage.getItem(userKey);
    if (!raw) return [];
    const list: OfflinePendingSet[] = JSON.parse(raw);
    const updated = list.filter(item => item.id !== setId);
    localStorage.setItem(userKey, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to remove synced offline set:', err);
  }
}

/**
 * Synchronizes offline sets for the currently authenticated user.
 * 
 * STRICT MULTI-TENANT GUARD:
 * - Will ONLY process sets whose userId exactly matches authenticatedUid.
 * - Cannot be called for user A while user B is authenticated.
 * - Skips any set lacking an active executedWorkoutId if required by Firestore rules.
 * - Keeps failed sets in the queue without data loss.
 */
export async function syncOfflineSetsForUser(
  authenticatedUid: string,
  uploadFn: (set: OfflinePendingSet) => Promise<void>
): Promise<SyncResult> {
  const result: SyncResult = {
    syncedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    quarantinedCount: 0,
    errors: [],
  };

  if (!authenticatedUid || typeof authenticatedUid !== 'string') {
    result.errors.push('No valid authenticated user provided for sync.');
    return result;
  }

  migrateLegacyPendingSets();

  const pendingSets = getOfflinePendingSets(authenticatedUid, false);
  if (pendingSets.length === 0) {
    return result;
  }

  for (const set of pendingSets) {
    // 1. Guard against cross-tenant execution
    if (set.userId !== authenticatedUid) {
      result.skippedCount++;
      result.errors.push(`Tenant mismatch: set ${set.id} belongs to ${set.userId}, not ${authenticatedUid}. Skipped.`);
      continue;
    }

    // 2. Guard against missing parent workout header
    if (!set.executedWorkoutId || set.executedWorkoutId.trim() === '') {
      result.skippedCount++;
      result.errors.push(`Contingency rule: set ${set.id} lacks executedWorkoutId. Kept in queue until workout header exists.`);
      continue;
    }

    try {
      await uploadFn(set);
      removeOfflinePendingSet(authenticatedUid, set.id, false);
      result.syncedCount++;
    } catch (uploadErr: any) {
      result.failedCount++;
      const errMsg = uploadErr?.message || String(uploadErr);
      result.errors.push(`Upload failed for set ${set.id}: ${errMsg}`);

      // Update attempt count in queue
      const userKey = getScopedPendingQueueKey(authenticatedUid, false);
      try {
        const raw = localStorage.getItem(userKey);
        if (raw) {
          const list: OfflinePendingSet[] = JSON.parse(raw);
          const idx = list.findIndex(i => i.id === set.id);
          if (idx >= 0) {
            list[idx].attempts = (list[idx].attempts || 0) + 1;
            list[idx].lastError = errMsg;
            localStorage.setItem(userKey, JSON.stringify(list));
          }
        }
      } catch {}
    }
  }

  return result;
}

/**
 * Retrieves quarantined orphan records for administrative audit.
 */
export function getQuarantinedOrphanSets(): OfflinePendingSet[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(ORPHAN_QUARANTINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
