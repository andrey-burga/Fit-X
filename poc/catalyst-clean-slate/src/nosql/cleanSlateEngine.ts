/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.3 Catalyst NoSQL Engine, Live Modular SDK Adapter & In-Memory Contract Harness
 *
 * Verified `@zcatalyst/nosql@1.0.0` Contracts:
 * 1. Exact parameter name for strong reads is `consistent_read: boolean` (snake_case)
 *    on `INoSQLFetchItem`, `INoSQLQuery` (`queryTable` and `queryIndex`).
 * 2. Single-item conditional `updateItems` executes atomically using:
 *    - `keys`: single `NoSQLItem`
 *    - `update_attributes`: `NoSQLUpdateOperationType.PUT` | `DELETE`, and numeric increments/decrements
 *      via `PUT` + `update_function: { function_name: 'add' | 'subtract', args: [...] }`.
 * 3. Outcome MUST be inspected via `NoSQLResponse.update[0].status` (`'Success' | 'ConditionMismatch' | 'CriteriaMismatch'`),
 *    NEVER solely HTTP status 200.
 * 4. Timeouts force `consistent_read: true` recovery read BEFORE any retry.
 */

import {
  CATALYST_PLATFORM_LIMITS,
  TABLE_SCHEMA_REGISTRY,
  type TableName,
} from '../types/cleanSlate.js';
import {
  buildRealDeleteItemPayload,
  buildRealFetchItemPayload,
  buildRealInsertItemPayload,
  buildRealNoSQLUpdateResponse,
  buildRealQueryPayload,
  buildRealUpdateItemPayload,
  compileRealCatalystCondition,
  NoSQLTable,
  type ConditionExpr,
  type QueryIndexSpec,
  type QueryTableSpec,
  type RealNoSQLFetchItem,
  type RealNoSQLQuery,
  type RealNoSQLResponse,
  type RealNoSQLUpdateItem,
  type TableKey,
} from './catalystModularAdapter.js';

export type { ConditionExpr, QueryIndexSpec, QueryTableSpec, TableKey };
export {
  buildRealUpdateItemPayload,
  buildRealFetchItemPayload,
  buildRealQueryPayload,
  compileRealCatalystCondition,
};

export type CatalystUpdateItemStatus = 'Success' | 'ConditionMismatch' | 'CriteriaMismatch';

export type InjectedUpdateFault =
  | 'HTTP_200_CONDITION_MISMATCH'
  | 'HTTP_200_CRITERIA_MISMATCH'
  | 'TIMEOUT_BEFORE_APPLY'
  | 'TIMEOUT_AFTER_APPLY';

export class CatalystTimeoutError extends Error {
  public readonly isTimeout = true;
  constructor(message = 'CATALYST_OPERATION_TIMEOUT: Remote outcome ambiguous; execute consistent_read before retry.') {
    super(message);
    this.name = 'CatalystTimeoutError';
  }
}

export interface QueryPageResult<T> {
  items: T[];
  nextStartKey?: string;
}

export interface UpdateItemResult<T> {
  updated: boolean;
  status: CatalystUpdateItemStatus;
  httpStatus: 200;
  response: RealNoSQLResponse;
  payload: RealNoSQLUpdateItem;
  item?: T;
  error?: string;
}

export interface ICleanSlateNoSQLAdapter {
  fetchItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    options?: { consistent_read?: boolean }
  ): Promise<T | null>;

  insertItem<T extends Record<string, any>>(
    table: TableName,
    item: T,
    condition?: ConditionExpr
  ): Promise<{ inserted: boolean; conditionIgnoredBecauseAbsent?: boolean; error?: string }>;

  insertBatch<T extends Record<string, any>>(
    table: TableName,
    items: T[]
  ): Promise<{ count: number; batchCalls: number }>;

  updateItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    updates: Partial<T>,
    condition?: ConditionExpr,
    increments?: Record<string, number>
  ): Promise<UpdateItemResult<T>>;

  deleteItem(
    table: TableName,
    key: TableKey,
    condition?: ConditionExpr
  ): Promise<{ deleted: boolean; error?: string }>;

  deleteBatch(
    table: TableName,
    keys: TableKey[]
  ): Promise<{ count: number; batchCalls: number }>;

  queryTable<T extends Record<string, any>>(
    table: TableName,
    spec: QueryTableSpec
  ): Promise<QueryPageResult<T>>;

  queryIndex<T extends Record<string, any>>(
    table: TableName,
    spec: QueryIndexSpec
  ): Promise<QueryPageResult<T>>;
}

export function assertCatalystItemSize(item: unknown): { bytes: number; withinBudget: boolean } {
  const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
  if (bytes > CATALYST_PLATFORM_LIMITS.MAX_ITEM_BYTES) {
    throw new Error(
      `CATALYST_ITEM_SIZE_EXCEEDED: Item size (${bytes} bytes) exceeds 400 KB Catalyst NoSQL hard limit (${CATALYST_PLATFORM_LIMITS.MAX_ITEM_BYTES} bytes).`
    );
  }
  return {
    bytes,
    withinBudget: bytes <= CATALYST_PLATFORM_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES,
  };
}

export function validateSchemaRegistryContracts(): void {
  for (const [name, spec] of Object.entries(TABLE_SCHEMA_REGISTRY)) {
    const primarySkCount = spec.sortKey ? 1 : 0;
    const totalSortKeys = primarySkCount + spec.additionalSortKeys.length;
    if (totalSortKeys > CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE) {
      throw new Error(
        `Schema contract violation in ${name}: ${totalSortKeys} sort keys exceed Catalyst limit of ${CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE}.`
      );
    }
    if (spec.secondaryIndexes.length > CATALYST_PLATFORM_LIMITS.MAX_SECONDARY_INDEXES_PER_TABLE) {
      throw new Error(
        `Schema contract violation in ${name}: ${spec.secondaryIndexes.length} secondary indexes exceed Catalyst limit of ${CATALYST_PLATFORM_LIMITS.MAX_SECONDARY_INDEXES_PER_TABLE}.`
      );
    }
  }
}

function encodeLiveStartKey(startKeyItem: { toJSON(): Record<string, unknown> } | undefined): string | undefined {
  if (!startKeyItem) return undefined;
  const raw = startKeyItem.toJSON();
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(raw), 'utf8').toString('base64url');
}

export function normalizeCatalystSdkError(err: unknown): Error {
  if (err instanceof CatalystTimeoutError) {
    return err;
  }
  if (err && typeof err === 'object') {
    const obj = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    const codeStr = typeof obj.code === 'string' ? obj.code.toUpperCase() : '';
    const msgStr = typeof obj.message === 'string' ? obj.message : '';
    const statusNum = typeof obj.statusCode === 'number' ? obj.statusCode : undefined;
    if (
      statusNum === 408 ||
      statusNum === 504 ||
      codeStr === 'ETIMEDOUT' ||
      codeStr === 'ESOCKETTIMEDOUT' ||
      codeStr === 'ECONNABORTED' ||
      /ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|timed out|timeout/i.test(msgStr)
    ) {
      return new CatalystTimeoutError(
        `CATALYST_OPERATION_TIMEOUT: ${msgStr || codeStr || 'Remote request timed out; execute consistent_read before retry.'}`
      );
    }
    if (err instanceof Error) {
      return err;
    }
    const sanitizedMsg = msgStr || (codeStr ? `Catalyst SDK error (${codeStr})` : 'Catalyst SDK error');
    const wrapped = new Error(statusNum ? `${sanitizedMsg} [HTTP ${statusNum}]` : sanitizedMsg);
    (wrapped as { statusCode?: number; code?: string }).statusCode = statusNum;
    (wrapped as { code?: string }).code = typeof obj.code === 'string' ? obj.code : undefined;
    return wrapped;
  }
  return new Error(String(err || 'Unknown Catalyst SDK error'));
}

/**
 * Live `@zcatalyst/nosql@1.0.0` `NoSQLTable` Adapter (for PASS-SDK-CONTRACT & PASS-INTEGRATION).
 */
export class CatalystLiveNoSQLAdapter implements ICleanSlateNoSQLAdapter {
  constructor(private getTableClient: (table: TableName) => NoSQLTable) {
    validateSchemaRegistryContracts();
  }

  async fetchItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    options?: { consistent_read?: boolean }
  ): Promise<T | null> {
    const payload = buildRealFetchItemPayload(key, options);
    try {
      const resp = await this.getTableClient(table).fetchItem(payload);
      const entry = resp.get?.[0];
      if (!entry || entry.status !== 'Success' || !entry.item) {
        return null;
      }
      return entry.item.to() as T;
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
  }

  async insertItem<T extends Record<string, any>>(
    table: TableName,
    item: T,
    condition?: ConditionExpr
  ): Promise<{ inserted: boolean; error?: string }> {
    assertCatalystItemSize(item);
    const payload = buildRealInsertItemPayload(item, condition);
    try {
      const resp = await this.getTableClient(table).insertItems(payload);
      const entry = resp.create?.[0];
      const ok = entry?.status === 'Success';
      return ok ? { inserted: true } : { inserted: false, error: entry?.status || 'InsertFailed' };
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
  }

  async insertBatch<T extends Record<string, any>>(
    table: TableName,
    items: T[]
  ): Promise<{ count: number; batchCalls: number }> {
    let count = 0;
    let batchCalls = 0;
    const tableClient = this.getTableClient(table);
    for (let i = 0; i < items.length; i += CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS) {
      const chunk = items.slice(i, i + CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS);
      chunk.forEach(item => assertCatalystItemSize(item));
      batchCalls++;
      try {
        const resp = await tableClient.insertItems(...chunk.map(item => buildRealInsertItemPayload(item)));
        for (const row of resp.create ?? []) {
          if (row.status === 'Success') count++;
        }
      } catch (err) {
        throw normalizeCatalystSdkError(err);
      }
    }
    return { count, batchCalls };
  }

  async updateItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    updates: Partial<T>,
    condition?: ConditionExpr,
    increments?: Record<string, number>
  ): Promise<UpdateItemResult<T>> {
    const payload = buildRealUpdateItemPayload(table, [key], updates as Record<string, unknown>, condition, increments);
    let resp: RealNoSQLResponse;
    try {
      resp = await this.getTableClient(table).updateItems(payload);
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
    const entry = resp.update?.[0];
    const rawStatus = entry?.status;
    const status: CatalystUpdateItemStatus =
      rawStatus === 'Success' || rawStatus === 'ConditionMismatch' || rawStatus === 'CriteriaMismatch'
        ? rawStatus
        : 'ConditionMismatch';
    if (status !== 'Success') {
      return {
        updated: false,
        status,
        httpStatus: 200,
        response: resp,
        payload,
        error: status,
      };
    }
    return {
      updated: true,
      status: 'Success',
      httpStatus: 200,
      response: resp,
      payload,
      item: entry?.item ? (entry.item.to() as T) : undefined,
    };
  }

  async deleteItem(
    table: TableName,
    key: TableKey,
    condition?: ConditionExpr
  ): Promise<{ deleted: boolean; error?: string }> {
    const payload = buildRealDeleteItemPayload(key, condition);
    try {
      const resp = await this.getTableClient(table).deleteItems(payload);
      const entry = resp.delete?.[0];
      return entry?.status === 'Success'
        ? { deleted: true }
        : { deleted: false, error: entry?.status || 'DeleteFailed' };
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
  }

  async deleteBatch(table: TableName, keys: TableKey[]): Promise<{ count: number; batchCalls: number }> {
    let count = 0;
    let batchCalls = 0;
    const tableClient = this.getTableClient(table);
    for (let i = 0; i < keys.length; i += CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS) {
      const chunk = keys.slice(i, i + CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS);
      batchCalls++;
      try {
        const resp = await tableClient.deleteItems(...chunk.map(k => buildRealDeleteItemPayload(k)));
        for (const row of resp.delete ?? []) {
          if (row.status === 'Success') count++;
        }
      } catch (err) {
        throw normalizeCatalystSdkError(err);
      }
    }
    return { count, batchCalls };
  }

  async queryTable<T extends Record<string, any>>(
    table: TableName,
    spec: QueryTableSpec
  ): Promise<QueryPageResult<T>> {
    const schema = TABLE_SCHEMA_REGISTRY[table];
    if (!spec.partitionKeyValue || spec.partitionKeyValue.trim() === '') {
      throw new Error(`FORBIDDEN_TABLE_SCAN: queryTable('${table}') requires an exact partition key value.`);
    }
    const clampedSpec: QueryTableSpec = {
      ...spec,
      limit: Math.min(
        spec.limit && spec.limit > 0 ? spec.limit : CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
      ),
    };
    const queryPayload = buildRealQueryPayload(schema.partitionKey, schema.sortKey ?? undefined, clampedSpec);
    try {
      const resp = await this.getTableClient(table).queryTable(queryPayload);
      const items = (resp.get ?? []).filter(r => r.item).map(r => r.item!.to() as T);
      const nextStartKey = encodeLiveStartKey(resp.start_key);
      return { items, nextStartKey };
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
  }

  async queryIndex<T extends Record<string, any>>(
    table: TableName,
    spec: QueryIndexSpec
  ): Promise<QueryPageResult<T>> {
    const schema = TABLE_SCHEMA_REGISTRY[table];
    if (!spec.partitionKeyValue || spec.partitionKeyValue.trim() === '') {
      throw new Error(`FORBIDDEN_INDEX_SCAN: queryIndex('${table}', '${spec.indexName}') requires a partition key value.`);
    }
    const idx = schema.secondaryIndexes.find(i => i.indexName === spec.indexName);
    if (!idx) {
      throw new Error(`UNDEFINED_SECONDARY_INDEX: Index '${spec.indexName}' is not defined on '${table}'.`);
    }
    const clampedSpec: QueryIndexSpec = {
      ...spec,
      limit: Math.min(
        spec.limit && spec.limit > 0 ? spec.limit : CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
        CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
      ),
    };
    const queryPayload = buildRealQueryPayload(idx.partitionKey, idx.sortKey, clampedSpec);
    try {
      const resp = await this.getTableClient(table).queryIndex(idx.indexName, queryPayload);
      const items = (resp.get ?? []).filter(r => r.item).map(r => r.item!.to() as T);
      const nextStartKey = encodeLiveStartKey(resp.start_key);
      return { items, nextStartKey };
    } catch (err) {
      throw normalizeCatalystSdkError(err);
    }
  }
}

/**
 * In-Memory Contract Simulator for offline unit & mock tests.
 * Compiles EVERY fetch/query/update through the real `@zcatalyst/nosql@1.0.0` payload builders
 * and records every serialized SDK payload in audit trails for strict contract inspection.
 */
export class CleanSlateInMemoryNoSQLAdapter implements ICleanSlateNoSQLAdapter {
  private stores: Map<TableName, Map<string, Record<string, any>>> = new Map();
  public queryAuditTrail: Array<{
    table: TableName;
    op: 'queryTable' | 'queryIndex';
    indexName?: string;
    pk: string;
    consistent_read: boolean;
    sdkPayload: RealNoSQLQuery;
  }> = [];
  public fetchAuditTrail: Array<{
    table: TableName;
    pk: string;
    consistent_read: boolean;
    sdkPayload: RealNoSQLFetchItem;
  }> = [];
  public updatePayloadAuditTrail: Array<{
    table: TableName;
    sdkPayload: RealNoSQLUpdateItem;
  }> = [];
  private faultQueue: Array<{ table: TableName; fault: InjectedUpdateFault }> = [];

  constructor(private nowEpochSecProvider: () => number = () => Math.floor(Date.now() / 1000)) {
    validateSchemaRegistryContracts();
  }

  public injectNextUpdateFault(table: TableName, fault: InjectedUpdateFault): void {
    this.faultQueue.push({ table, fault });
  }

  private consumeUpdateFault(table: TableName): InjectedUpdateFault | undefined {
    const idx = this.faultQueue.findIndex(f => f.table === table);
    if (idx === -1) return undefined;
    const [entry] = this.faultQueue.splice(idx, 1);
    return entry.fault;
  }

  private getStore(table: TableName): Map<string, Record<string, any>> {
    let store = this.stores.get(table);
    if (!store) {
      store = new Map();
      this.stores.set(table, store);
    }
    return store;
  }

  private buildCompositeKey(table: TableName, key: TableKey): string {
    const schema = TABLE_SCHEMA_REGISTRY[table];
    if (!key.pk) {
      throw new Error(`MISSING_PK: Partition key '${schema.partitionKey}' is required for '${table}'.`);
    }
    if (schema.sortKey === null) {
      return key.pk;
    }
    if (!key.sk) {
      throw new Error(`MISSING_SK: Sort key '${schema.sortKey}' is required for '${table}'.`);
    }
    return `${key.pk}\u0000${key.sk}`;
  }

  private isExpiredByTtl(table: TableName, item: Record<string, any>): boolean {
    const ttlField = TABLE_SCHEMA_REGISTRY[table].ttlAttribute?.name;
    if (!ttlField) return false;
    const ttlVal = item[ttlField];
    if (typeof ttlVal === 'number' && ttlVal <= this.nowEpochSecProvider()) {
      return true;
    }
    return false;
  }

  private evaluateCondition(existing: Record<string, any> | undefined, cond?: ConditionExpr): boolean {
    if (!cond) return true;
    switch (cond.type) {
      case 'attribute_exists':
        return Boolean(existing && existing[cond.attr] !== undefined);
      case 'attribute_not_exists':
        return !existing || existing[cond.attr] === undefined;
      case 'equals':
        return Boolean(existing && existing[cond.attr] === cond.value);
      case 'not_equals':
        return Boolean(existing && existing[cond.attr] !== cond.value);
      case 'lt':
        return Boolean(existing && typeof existing[cond.attr] === 'number' && existing[cond.attr] < cond.value);
      case 'lte':
        return Boolean(existing && typeof existing[cond.attr] === 'number' && existing[cond.attr] <= cond.value);
      case 'gt':
        return Boolean(existing && typeof existing[cond.attr] === 'number' && existing[cond.attr] > cond.value);
      case 'gte':
        return Boolean(existing && typeof existing[cond.attr] === 'number' && existing[cond.attr] >= cond.value);
      case 'between':
        return Boolean(
          existing &&
            existing[cond.attr] !== undefined &&
            existing[cond.attr] >= cond.low &&
            existing[cond.attr] <= cond.high
        );
      case 'begins_with':
        return Boolean(
          existing &&
            typeof existing[cond.attr] === 'string' &&
            String(existing[cond.attr]).startsWith(cond.prefix)
        );
      case 'in':
        return Boolean(existing && cond.values.includes(existing[cond.attr]));
      case 'and':
        return cond.conditions.every(c => this.evaluateCondition(existing, c));
      case 'or':
        return cond.conditions.some(c => this.evaluateCondition(existing, c));
      default:
        return false;
    }
  }

  async fetchItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    options?: { consistent_read?: boolean }
  ): Promise<T | null> {
    const sdkPayload = buildRealFetchItemPayload(key, options);
    this.fetchAuditTrail.push({
      table,
      pk: key.pk,
      consistent_read: Boolean(sdkPayload.consistent_read),
      sdkPayload,
    });
    const store = this.getStore(table);
    const raw = store.get(this.buildCompositeKey(table, key));
    if (!raw) return null;
    if (this.isExpiredByTtl(table, raw)) return null;
    return structuredClone(raw) as T;
  }

  async insertItem<T extends Record<string, any>>(
    table: TableName,
    item: T,
    condition?: ConditionExpr
  ): Promise<{ inserted: boolean; conditionIgnoredBecauseAbsent?: boolean; error?: string }> {
    assertCatalystItemSize(item);
    buildRealInsertItemPayload(item, condition);

    const schema = TABLE_SCHEMA_REGISTRY[table];
    const pk = String(item[schema.partitionKey] || '');
    const sk = schema.sortKey ? String(item[schema.sortKey] || '') : undefined;
    const compositeKey = this.buildCompositeKey(table, { pk, sk });

    const store = this.getStore(table);
    const existing = store.get(compositeKey);
    const activeExisting = existing && !this.isExpiredByTtl(table, existing) ? existing : undefined;

    if (!activeExisting) {
      store.set(compositeKey, structuredClone(item));
      return {
        inserted: true,
        conditionIgnoredBecauseAbsent: Boolean(condition),
      };
    }

    if (condition && !this.evaluateCondition(activeExisting, condition)) {
      return { inserted: false, error: 'ConditionMismatch' };
    }

    store.set(compositeKey, structuredClone(item));
    return { inserted: true };
  }

  async insertBatch<T extends Record<string, any>>(
    table: TableName,
    items: T[]
  ): Promise<{ count: number; batchCalls: number }> {
    let count = 0;
    let batchCalls = 0;
    for (let i = 0; i < items.length; i += CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS) {
      const chunk = items.slice(i, i + CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS);
      batchCalls++;
      for (const item of chunk) {
        const res = await this.insertItem(table, item);
        if (res.inserted) count++;
      }
    }
    return { count, batchCalls };
  }

  async updateItem<T extends Record<string, any>>(
    table: TableName,
    key: TableKey,
    updates: Partial<T>,
    condition?: ConditionExpr,
    increments?: Record<string, number>
  ): Promise<UpdateItemResult<T>> {
    const sdkPayload = buildRealUpdateItemPayload(
      table,
      [key],
      updates as Record<string, unknown>,
      condition,
      increments
    );
    this.updatePayloadAuditTrail.push({ table, sdkPayload });

    const fault = this.consumeUpdateFault(table);
    if (fault === 'TIMEOUT_BEFORE_APPLY') {
      throw new CatalystTimeoutError('Simulated timeout before applying remote update.');
    }
    if (fault === 'HTTP_200_CONDITION_MISMATCH') {
      return {
        updated: false,
        status: 'ConditionMismatch',
        httpStatus: 200,
        response: await buildRealNoSQLUpdateResponse(table, sdkPayload, 'ConditionMismatch'),
        payload: sdkPayload,
        error: 'ConditionMismatch',
      };
    }
    if (fault === 'HTTP_200_CRITERIA_MISMATCH') {
      return {
        updated: false,
        status: 'CriteriaMismatch',
        httpStatus: 200,
        response: await buildRealNoSQLUpdateResponse(table, sdkPayload, 'CriteriaMismatch'),
        payload: sdkPayload,
        error: 'CriteriaMismatch',
      };
    }

    const store = this.getStore(table);
    const compositeKey = this.buildCompositeKey(table, key);
    const existing = store.get(compositeKey);
    const activeExisting = existing && !this.isExpiredByTtl(table, existing) ? existing : undefined;

    if (!activeExisting) {
      return {
        updated: false,
        status: 'CriteriaMismatch',
        httpStatus: 200,
        response: await buildRealNoSQLUpdateResponse(table, sdkPayload, 'CriteriaMismatch'),
        payload: sdkPayload,
        error: 'CriteriaMismatch',
      };
    }

    if (condition && !this.evaluateCondition(activeExisting, condition)) {
      return {
        updated: false,
        status: 'ConditionMismatch',
        httpStatus: 200,
        response: await buildRealNoSQLUpdateResponse(table, sdkPayload, 'ConditionMismatch'),
        payload: sdkPayload,
        error: 'ConditionMismatch',
      };
    }

    const nextItem: Record<string, any> = structuredClone(activeExisting);

    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) {
        delete nextItem[k];
      } else {
        nextItem[k] = structuredClone(v);
      }
    }

    if (increments) {
      for (const [k, delta] of Object.entries(increments)) {
        nextItem[k] = Number(nextItem[k] ?? 0) + delta;
      }
    }

    assertCatalystItemSize(nextItem);
    store.set(compositeKey, nextItem);

    if (fault === 'TIMEOUT_AFTER_APPLY') {
      throw new CatalystTimeoutError('Simulated timeout AFTER remote write succeeded.');
    }

    const cloned = structuredClone(nextItem) as T;
    return {
      updated: true,
      status: 'Success',
      httpStatus: 200,
      response: await buildRealNoSQLUpdateResponse(table, sdkPayload, 'Success', cloned, activeExisting),
      payload: sdkPayload,
      item: cloned,
    };
  }

  async deleteItem(
    table: TableName,
    key: TableKey,
    condition?: ConditionExpr
  ): Promise<{ deleted: boolean; error?: string }> {
    buildRealDeleteItemPayload(key, condition);
    const store = this.getStore(table);
    const compositeKey = this.buildCompositeKey(table, key);
    const existing = store.get(compositeKey);
    if (condition && !this.evaluateCondition(existing, condition)) {
      return { deleted: false, error: 'ConditionMismatch' };
    }
    const existed = store.delete(compositeKey);
    return { deleted: existed };
  }

  async deleteBatch(
    table: TableName,
    keys: TableKey[]
  ): Promise<{ count: number; batchCalls: number }> {
    let count = 0;
    let batchCalls = 0;
    for (let i = 0; i < keys.length; i += CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS) {
      const chunk = keys.slice(i, i + CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS);
      batchCalls++;
      for (const k of chunk) {
        const res = await this.deleteItem(table, k);
        if (res.deleted) count++;
      }
    }
    return { count, batchCalls };
  }

  async queryTable<T extends Record<string, any>>(
    table: TableName,
    spec: QueryTableSpec
  ): Promise<QueryPageResult<T>> {
    const schema = TABLE_SCHEMA_REGISTRY[table];
    if (!spec.partitionKeyValue || spec.partitionKeyValue.trim() === '') {
      throw new Error(`FORBIDDEN_TABLE_SCAN: queryTable('${table}') requires an exact partition key value.`);
    }

    const sdkPayload = buildRealQueryPayload(schema.partitionKey, schema.sortKey ?? undefined, spec);
    this.queryAuditTrail.push({
      table,
      op: 'queryTable',
      pk: spec.partitionKeyValue,
      consistent_read: Boolean(sdkPayload.consistent_read),
      sdkPayload,
    });
    return this.executeQuery(table, schema.partitionKey, schema.sortKey ?? undefined, spec);
  }

  async queryIndex<T extends Record<string, any>>(
    table: TableName,
    spec: QueryIndexSpec
  ): Promise<QueryPageResult<T>> {
    const schema = TABLE_SCHEMA_REGISTRY[table];
    if (!spec.partitionKeyValue || spec.partitionKeyValue.trim() === '') {
      throw new Error(`FORBIDDEN_INDEX_SCAN: queryIndex('${table}', '${spec.indexName}') requires a partition key value.`);
    }

    const idx = schema.secondaryIndexes.find(i => i.indexName === spec.indexName);
    if (!idx) {
      throw new Error(`UNDEFINED_SECONDARY_INDEX: Index '${spec.indexName}' is not defined on table '${table}'.`);
    }

    const sdkPayload = buildRealQueryPayload(idx.partitionKey, idx.sortKey, spec);
    this.queryAuditTrail.push({
      table,
      op: 'queryIndex',
      indexName: idx.indexName,
      pk: spec.partitionKeyValue,
      consistent_read: Boolean(sdkPayload.consistent_read),
      sdkPayload,
    });

    const page = this.executeQuery<T>(table, idx.partitionKey, idx.sortKey, spec);

    if (idx.projection === 'SPECIFIC_ATTRIBUTES' && idx.projectedAttributes) {
      const allowed = new Set(idx.projectedAttributes);
      page.items = page.items.map(item => {
        const projected: Record<string, any> = {};
        for (const k of Object.keys(item)) {
          if (allowed.has(k)) projected[k] = item[k];
        }
        return projected as T;
      });
    }

    return page;
  }

  private executeQuery<T extends Record<string, any>>(
    table: TableName,
    pkAttr: string,
    skAttr: string | undefined,
    spec: QueryTableSpec
  ): QueryPageResult<T> {
    const store = this.getStore(table);
    const matches: Record<string, any>[] = [];

    for (const item of store.values()) {
      if (this.isExpiredByTtl(table, item)) continue;
      if (String(item[pkAttr] ?? '') !== spec.partitionKeyValue) continue;

      if (skAttr && item[skAttr] !== undefined) {
        const skVal = String(item[skAttr]);
        if (spec.sortKeyEquals !== undefined && skVal !== spec.sortKeyEquals) continue;
        if (spec.sortKeyPrefix !== undefined && !skVal.startsWith(spec.sortKeyPrefix)) continue;
        if (
          spec.sortKeyBetween !== undefined &&
          (skVal < spec.sortKeyBetween[0] || skVal > spec.sortKeyBetween[1])
        ) {
          continue;
        }
      } else if (
        spec.sortKeyEquals !== undefined ||
        spec.sortKeyPrefix !== undefined ||
        spec.sortKeyBetween !== undefined
      ) {
        continue;
      }

      matches.push(structuredClone(item));
    }

    if (skAttr) {
      matches.sort((a, b) => {
        const sa = String(a[skAttr] ?? '');
        const sb = String(b[skAttr] ?? '');
        return spec.scanDescending ? sb.localeCompare(sa) : sa.localeCompare(sb);
      });
    }

    const offset = typeof spec.startKey === 'string' ? Number(spec.startKey) : 0;
    const effectiveLimit = Math.min(
      spec.limit && spec.limit > 0 ? spec.limit : CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS,
      CATALYST_PLATFORM_LIMITS.MAX_QUERY_READ_ITEMS
    );

    const sliced = matches.slice(offset, offset + effectiveLimit);
    const nextStartKey = offset + effectiveLimit < matches.length ? String(offset + effectiveLimit) : undefined;

    return {
      items: sliced as T[],
      nextStartKey,
    };
  }
}
