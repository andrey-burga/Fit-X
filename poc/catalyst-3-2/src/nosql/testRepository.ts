import {
  NoSQLItem,
  NoSQLEnum,
  getStorageAdapter,
} from './catalystNosql.js';
import type {
  INoSQLInsertItem,
  INoSQLUpdateItem,
  INoSQLDeleteItem,
  INoSQLCondition,
  TNoSQLValues,
} from '@zcatalyst/nosql/dist-types/utils/types.js';
import { loadEnvConfig } from '../config/env.js';

export interface OperationLog {
  operationName: string;
  result: 'SUCCESS' | 'FAILURE';
  errorCode?: string;
  responseDurationMs: number;
  itemsCount: number;
  environment: string;
}

export class TestRepository {
  private logs: OperationLog[] = [];
  private tableName: string;

  constructor(tableName?: string) {
    const env = loadEnvConfig();
    this.tableName = tableName || env.CATALYST_NOSQL_TABLE;
  }

  getLogs(): OperationLog[] {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }

  private recordLog(
    operationName: string,
    success: boolean,
    durationMs: number,
    itemsCount: number,
    errorCode?: string
  ) {
    const env = loadEnvConfig();
    this.logs.push({
      operationName,
      result: success ? 'SUCCESS' : 'FAILURE',
      errorCode,
      responseDurationMs: Number(durationMs.toFixed(2)),
      itemsCount,
      environment: env.IS_MOCK_MODE ? 'LOCAL_MOCK_ENGINE' : 'CATALYST_REMOTE_NOSQL',
    });
  }

  /**
   * 1. Insert a fictional item with prefix POC#3.2#
   */
  async insertFictionalItem(
    pk: string,
    sk: string,
    attributes: Record<string, TNoSQLValues>,
    condition?: INoSQLCondition
  ): Promise<{ success: boolean; durationMs: number; error?: string }> {
    if (!pk.startsWith('POC#3.2#')) {
      throw new Error(`Forbidden key: Partition key must begin with 'POC#3.2#' for isolation.`);
    }

    const adapter = getStorageAdapter();
    const itemData = {
      pk,
      sk,
      ...attributes,
      createdAt: Date.now(),
    };

    const insertSpec: INoSQLInsertItem = {
      item: NoSQLItem.from(itemData),
      condition,
    };

    const res = await adapter.insertItems(this.tableName, insertSpec);
    this.recordLog('INSERT_ITEM', res.success, res.durationMs, res.count, res.error ? 'CONDITIONAL_CHECK_FAILED' : undefined);
    return res;
  }

  /**
   * 2. Read item by key
   */
  async fetchFictionalItem(
    pk: string,
    sk?: string
  ): Promise<{ success: boolean; item: Record<string, TNoSQLValues> | null; durationMs: number }> {
    const adapter = getStorageAdapter();
    const keyData: Record<string, TNoSQLValues> = { pk };
    if (sk) keyData.sk = sk;

    const res = await adapter.fetchItem(this.tableName, {
      keys: NoSQLItem.from(keyData),
      consistent_read: true,
    });

    this.recordLog('FETCH_ITEM', res.success, res.durationMs, res.item ? 1 : 0);
    return res;
  }

  /**
   * 3. Update item conditionally
   */
  async updateFictionalItemConditional(
    pk: string,
    sk: string,
    updates: Array<{ attribute: string; value: string | number | boolean }>,
    condition?: INoSQLCondition
  ): Promise<{ success: boolean; durationMs: number; error?: string }> {
    const adapter = getStorageAdapter();
    const keyData = { pk, sk };

    const updateAttributes = updates.map((u) => {
      let updateValue: Record<string, string | boolean> = {};
      if (typeof u.value === 'string') updateValue = { S: u.value };
      else if (typeof u.value === 'number') updateValue = { N: String(u.value) };
      else if (typeof u.value === 'boolean') updateValue = { BOOL: String(u.value) };

      return {
        operation_type: NoSQLEnum.NoSQLUpdateOperationType.PUT,
        attribute_path: [u.attribute],
        update_value: updateValue,
      };
    });

    const updateSpec: INoSQLUpdateItem = {
      keys: NoSQLItem.from(keyData),
      condition,
      update_attributes: updateAttributes,
    };

    const res = await adapter.updateItems(this.tableName, updateSpec);
    this.recordLog('UPDATE_ITEM', res.success, res.durationMs, res.count, res.error ? 'CONDITIONAL_CHECK_FAILED' : undefined);
    return res;
  }

  /**
   * 4. Delete item conditionally
   */
  async deleteFictionalItemConditional(
    pk: string,
    sk: string,
    condition?: INoSQLCondition
  ): Promise<{ success: boolean; durationMs: number; error?: string }> {
    const adapter = getStorageAdapter();
    const keyData = { pk, sk };

    const delSpec: INoSQLDeleteItem = {
      keys: NoSQLItem.from(keyData),
      condition,
    };

    const res = await adapter.deleteItems(this.tableName, delSpec);
    this.recordLog('DELETE_ITEM', res.success, res.durationMs, res.count, res.error ? 'CONDITIONAL_CHECK_FAILED' : undefined);
    return res;
  }

  /**
   * 5. Concurrency: Acquire Lease Lock with Fencing Token
   * Condition: attribute_not_exists(pk) OR leaseExpiresAt < now
   */
  async acquireLeaseLock(
    resourceId: string,
    holderId: string,
    leaseDurationMs = 5000
  ): Promise<{ success: boolean; fencingToken?: number; error?: string }> {
    const pk = `POC#3.2#LOCK#${resourceId}`;
    const sk = 'LEASE';
    const now = Date.now();
    const leaseExpiresAt = now + leaseDurationMs;

    // Check existing lock to determine monotonic fencing token
    const current = await this.fetchFictionalItem(pk, sk);
    const prevToken = current.item ? Number(current.item.fencingToken || 0) : 0;
    const nextFencingToken = prevToken + 1;

    // Official conditional expression in modular SDK:
    // (attribute_not_exists(pk)) OR (leaseExpiresAt < now)
    const condition: INoSQLCondition = {
      group_operator: NoSQLEnum.NoSQLConditionGroupOperator.OR,
      group: [
        {
          function: {
            function_name: 'attribute_exists',
            args: [{ attribute_path: ['pk'] }],
          },
          negate: true, // attribute_not_exists
        },
        {
          attribute: ['leaseExpiresAt'],
          operator: NoSQLEnum.NoSQLOperator.LESS_THAN,
          value: { N: String(now) },
        },
      ],
    };

    // If item doesn't exist, we insert; if it exists but expired, we update
    if (!current.item) {
      const insertRes = await this.insertFictionalItem(
        pk,
        sk,
        {
          holderId,
          fencingToken: nextFencingToken,
          leaseExpiresAt,
          acquiredAt: now,
        },
        condition
      );

      if (insertRes.success) {
        return { success: true, fencingToken: nextFencingToken };
      }
      return { success: false, error: insertRes.error || 'LOCK_ACQUISITION_FAILED' };
    }

    const updateRes = await this.updateFictionalItemConditional(
      pk,
      sk,
      [
        { attribute: 'holderId', value: holderId },
        { attribute: 'fencingToken', value: nextFencingToken },
        { attribute: 'leaseExpiresAt', value: leaseExpiresAt },
        { attribute: 'acquiredAt', value: now },
      ],
      condition
    );

    if (updateRes.success) {
      return { success: true, fencingToken: nextFencingToken };
    }
    return { success: false, error: updateRes.error || 'LOCK_ACQUISITION_FAILED' };
  }

  /**
   * 6. Concurrency: Release Lease Lock conditionally
   * Condition: holderId == myId AND fencingToken == myToken
   */
  async releaseLeaseLock(
    resourceId: string,
    holderId: string,
    fencingToken: number
  ): Promise<{ success: boolean; error?: string }> {
    const pk = `POC#3.2#LOCK#${resourceId}`;
    const sk = 'LEASE';

    const condition: INoSQLCondition = {
      group_operator: NoSQLEnum.NoSQLConditionGroupOperator.AND,
      group: [
        {
          attribute: ['holderId'],
          operator: NoSQLEnum.NoSQLOperator.EQUALS,
          value: { S: holderId },
        },
        {
          attribute: ['fencingToken'],
          operator: NoSQLEnum.NoSQLOperator.EQUALS,
          value: { N: String(fencingToken) },
        },
      ],
    };

    const res = await this.deleteFictionalItemConditional(pk, sk, condition);
    return res;
  }

  /**
   * 7. Superadmin Counter: Atomic conditional decrement
   * Target: POC#3.2#SUPERADMIN_COUNT
   * Condition: activeSuperadminCount > 1
   */
  async decrementSuperadminCounterAtomic(): Promise<{
    success: boolean;
    newCount?: number;
    error?: string;
  }> {
    const pk = 'POC#3.2#SUPERADMIN_COUNT';
    const sk = 'SINGLETON';

    const current = await this.fetchFictionalItem(pk, sk);
    if (!current.item) {
      return { success: false, error: 'SUPERADMIN_COUNTER_NOT_INITIALIZED' };
    }

    const currentCount = Number(current.item.activeSuperadminCount);

    // Atomic Condition: activeSuperadminCount > 1
    const condition: INoSQLCondition = {
      attribute: ['activeSuperadminCount'],
      operator: NoSQLEnum.NoSQLOperator.GREATER_THAN,
      value: { N: '1' },
    };

    // Atomic update with conditional check
    const updateRes = await this.updateFictionalItemConditional(
      pk,
      sk,
      [
        { attribute: 'activeSuperadminCount', value: currentCount - 1 },
        { attribute: 'version', value: Number(current.item.version || 0) + 1 },
        { attribute: 'lastUpdated', value: Date.now() },
      ],
      condition
    );

    if (updateRes.success) {
      return { success: true, newCount: currentCount - 1 };
    }

    return {
      success: false,
      error: 'CANNOT_DEMOTE_LAST_SUPERADMIN: activeSuperadminCount would fall to 0 or below.',
    };
  }

  /**
   * Helper: initialize superadmin counter with initial value
   */
  async initializeSuperadminCounter(initialCount = 2): Promise<void> {
    const pk = 'POC#3.2#SUPERADMIN_COUNT';
    const sk = 'SINGLETON';
    await this.insertFictionalItem(pk, sk, {
      activeSuperadminCount: initialCount,
      version: 1,
      lastUpdated: Date.now(),
    });
  }
}
