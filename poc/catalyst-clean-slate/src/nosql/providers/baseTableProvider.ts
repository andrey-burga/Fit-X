/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 Base Per-Table Catalyst NoSQL Provider & Real SDK Factory
 */

import { NoSQL, type NoSQLTable } from '@zcatalyst/nosql';
import type { CatalystApp } from '@zcatalyst/auth-admin';
import {
  CATALYST_PLATFORM_LIMITS,
  TABLE_SCHEMA_REGISTRY,
  type TableName,
  type TableSchemaSpec,
} from '../../types/cleanSlate.js';
import {
  assertCatalystItemSize,
  CatalystLiveNoSQLAdapter,
  CatalystTimeoutError,
  validateSchemaRegistryContracts,
  type ConditionExpr,
  type ICleanSlateNoSQLAdapter,
  type QueryIndexSpec,
  type QueryPageResult,
  type QueryTableSpec,
  type TableKey,
  type UpdateItemResult,
} from '../cleanSlateEngine.js';

/**
 * Wraps a real `@zcatalyst/nosql` `NoSQL` client, `CatalystApp`, or per-request resolver
 * into `CatalystLiveNoSQLAdapter` bound strictly to the 5 frozen Clean-Slate tables.
 */
export function createCatalystLiveNoSQLAdapter(
  nosqlOrApp: NoSQL | CatalystApp | (() => NoSQL | CatalystApp),
  tableIdResolver?: (table: TableName) => string
): CatalystLiveNoSQLAdapter {
  const resolveClient = (): NoSQL => {
    const resolved = typeof nosqlOrApp === 'function' ? nosqlOrApp() : nosqlOrApp;
    return resolved instanceof NoSQL ? resolved : new NoSQL(resolved);
  };
  return new CatalystLiveNoSQLAdapter((table: TableName): NoSQLTable => {
    const physicalId = tableIdResolver ? tableIdResolver(table) : table;
    return resolveClient().table(physicalId);
  });
}

export class BaseCatalystTableProvider<TItem extends Record<string, any>> {
  public readonly schema: TableSchemaSpec;

  constructor(
    public readonly tableName: TableName,
    protected readonly adapter: ICleanSlateNoSQLAdapter
  ) {
    validateSchemaRegistryContracts();
    this.schema = TABLE_SCHEMA_REGISTRY[tableName];
  }

  getSchema(): TableSchemaSpec {
    return this.schema;
  }

  protected validateKeyShape(key: TableKey): TableKey {
    if (!key.pk || !key.pk.trim()) {
      throw new Error(`MISSING_PK: '${this.tableName}' requires non-empty partition key '${this.schema.partitionKey}'.`);
    }
    if (this.schema.sortKey && (!key.sk || !key.sk.trim())) {
      throw new Error(`MISSING_SK: '${this.tableName}' requires non-empty sort key '${this.schema.sortKey}'.`);
    }
    if (!this.schema.sortKey && key.sk !== undefined) {
      throw new Error(`UNEXPECTED_SK: '${this.tableName}' is PK-only and forbids sort key '${key.sk}'.`);
    }
    return key;
  }

  protected validateItemContract(item: TItem): void {
    const pkVal = item[this.schema.partitionKey];
    if (typeof pkVal !== 'string' || !pkVal.trim()) {
      throw new Error(`INVALID_ITEM_PK: Item for '${this.tableName}' missing '${this.schema.partitionKey}'.`);
    }
    if (this.schema.sortKey) {
      const skVal = item[this.schema.sortKey];
      if (typeof skVal !== 'string' || !skVal.trim()) {
        throw new Error(`INVALID_ITEM_SK: Item for '${this.tableName}' missing '${this.schema.sortKey}'.`);
      }
    }
    assertCatalystItemSize(item);
  }

  async fetchByKey(
    key: TableKey,
    options?: { consistent_read?: boolean }
  ): Promise<TItem | null> {
    this.validateKeyShape(key);
    return this.adapter.fetchItem<TItem>(this.tableName, key, {
      consistent_read: options?.consistent_read ?? true,
    });
  }

  async insertItem(
    item: TItem,
    condition?: ConditionExpr
  ): Promise<{ inserted: boolean; conditionIgnoredBecauseAbsent?: boolean; error?: string }> {
    this.validateItemContract(item);
    return this.adapter.insertItem<TItem>(this.tableName, item, condition);
  }

  async insertBatch(items: TItem[]): Promise<{ count: number; batchCalls: number }> {
    for (const item of items) {
      this.validateItemContract(item);
    }
    return this.adapter.insertBatch<TItem>(this.tableName, items);
  }

  async updateItem(
    key: TableKey,
    updates: Partial<TItem>,
    condition?: ConditionExpr,
    increments?: Record<string, number>
  ): Promise<UpdateItemResult<TItem>> {
    this.validateKeyShape(key);
    return this.adapter.updateItem<TItem>(this.tableName, key, updates, condition, increments);
  }

  async deleteByKey(
    key: TableKey,
    condition?: ConditionExpr
  ): Promise<{ deleted: boolean; error?: string }> {
    this.validateKeyShape(key);
    return this.adapter.deleteItem(this.tableName, key, condition);
  }

  async deleteBatch(keys: TableKey[]): Promise<{ count: number; batchCalls: number }> {
    for (const key of keys) {
      this.validateKeyShape(key);
    }
    return this.adapter.deleteBatch(this.tableName, keys);
  }

  async queryByPartition(spec: QueryTableSpec): Promise<QueryPageResult<TItem>> {
    const clamped: QueryTableSpec = {
      ...spec,
      limit: Math.min(
        spec.limit && spec.limit > 0 ? spec.limit : CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
      ),
    };
    return this.adapter.queryTable<TItem>(this.tableName, clamped);
  }

  async queryBySecondaryIndex(spec: QueryIndexSpec): Promise<QueryPageResult<TItem>> {
    const idx = this.schema.secondaryIndexes.find(s => s.indexName === spec.indexName);
    if (!idx) {
      throw new Error(
        `UNDEFINED_SECONDARY_INDEX: '${spec.indexName}' is not registered on '${this.tableName}'.`
      );
    }
    const clamped: QueryIndexSpec = {
      ...spec,
      limit: Math.min(
        spec.limit && spec.limit > 0 ? spec.limit : CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
      ),
    };
    return this.adapter.queryIndex<TItem>(this.tableName, clamped);
  }

  /**
   * Deterministic timeout-recovery helper: catches `CatalystTimeoutError`, performs
   * `consistent_read: true` lookup via `onTimeoutConsistentCheck()`, and resolves
   * unambiguously without blind duplicate writes.
   */
  async withTimeoutRecovery<R>(
    operation: () => Promise<R>,
    onTimeoutConsistentCheck: () => Promise<R>
  ): Promise<R> {
    try {
      return await operation();
    } catch (err) {
      if (err instanceof CatalystTimeoutError || (err as { isTimeout?: boolean })?.isTimeout) {
        return await onTimeoutConsistentCheck();
      }
      throw err;
    }
  }
}
