/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 4.0.3 Real `@zcatalyst/nosql@1.0.0` Modular SDK Adapter & Payload Compiler
 *
 * Verified directly against `node_modules/@zcatalyst/nosql/dist-types/*` and `dist-es/*`:
 * 1. Exact parameter name for strong reads is `consistent_read: boolean` on
 *    `INoSQLFetchItem` (`fetchItem`) and `INoSQLQuery` (`queryTable`, `queryIndex`).
 * 2. `NoSQLUpdateOperationType` ONLY supports `'PUT'` and `'DELETE'`.
 *    Atomic increments/decrements MUST use `operation_type: NoSQLUpdateOperationType.PUT`
 *    combined with `update_function: { function_name: 'add' | 'subtract', args: [...] }`.
 * 3. `INoSQLUpdateItem.keys` is a single `NoSQLItem | TNoSQLItem` (NOT an array),
 *    `update_attributes[*].update_value` is a marshalled `TNoSQLAttribute` (`NoSQLMarshall`),
 *    and `return` is `'NEW' | 'OLD' | 'NULL'`.
 * 4. `NoSQLOperator` enum values are lowercase (`'equals'`, `'greater_than'`, etc.).
 * 5. `INoSQLConditionFunction` only accepts `'attribute_exists' | 'attribute_type'`;
 *    attribute non-existence MUST use `{ function: { function_name: 'attribute_exists', ... }, negate: true }`.
 * 6. `NoSQLTable.updateItems()` resolves to `NoSQLResponse` with `update: Array<NoSQLData>`,
 *    where each entry carries `status: 'Success' | 'ConditionMismatch' | 'CriteriaMismatch'`.
 */

import {
  NoSQLItem,
  NoSQLMarshall,
  NoSQLEnum,
  NoSQLTable,
  NoSQLUpdateOperationType,
} from '@zcatalyst/nosql';
import type { TableName } from '../types/cleanSlate.js';

export type RealNoSQLUpdateItem = Parameters<NoSQLTable['updateItems']>[0];
export type RealNoSQLFetchItem = Parameters<NoSQLTable['fetchItem']>[0];
export type RealNoSQLQuery = Parameters<NoSQLTable['queryTable']>[0];
export type RealNoSQLInsertItem = Parameters<NoSQLTable['insertItems']>[0];
export type RealNoSQLDeleteItem = Parameters<NoSQLTable['deleteItems']>[0];
export type RealNoSQLCondition = NonNullable<RealNoSQLUpdateItem['condition']>;
export type RealNoSQLUpdateAttrOp = RealNoSQLUpdateItem['update_attributes'][number];
export type RealNoSQLResponse = Awaited<ReturnType<NoSQLTable['updateItems']>>;
export type RealNoSQLAttribute = ReturnType<typeof NoSQLMarshall.make>;

export {
  NoSQLItem,
  NoSQLMarshall,
  NoSQLEnum,
  NoSQLTable,
  NoSQLUpdateOperationType,
};

export type ConditionExpr =
  | { type: 'attribute_not_exists'; attr: string }
  | { type: 'attribute_exists'; attr: string }
  | { type: 'equals'; attr: string; value: unknown }
  | { type: 'not_equals'; attr: string; value: unknown }
  | { type: 'lt'; attr: string; value: number }
  | { type: 'lte'; attr: string; value: number }
  | { type: 'gt'; attr: string; value: number }
  | { type: 'gte'; attr: string; value: number }
  | { type: 'between'; attr: string; low: string | number; high: string | number }
  | { type: 'begins_with'; attr: string; prefix: string }
  | { type: 'in'; attr: string; values: unknown[] }
  | { type: 'and'; conditions: ConditionExpr[] }
  | { type: 'or'; conditions: ConditionExpr[] };

export interface TableKey {
  pk: string;
  sk?: string;
}

export interface QueryTableSpec {
  partitionKeyValue: string;
  sortKeyPrefix?: string;
  sortKeyBetween?: [string, string];
  sortKeyEquals?: string;
  limit?: number;
  startKey?: Record<string, unknown> | string;
  consistent_read?: boolean;
  scanDescending?: boolean;
}

export interface QueryIndexSpec extends QueryTableSpec {
  indexName: string;
}

/**
 * Recursively strips `undefined` properties before passing plain JS objects into
 * `NoSQLMarshall.make()` / `NoSQLItem.from()` (avoids SDK `makeMap` edge case).
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter(v => v !== undefined)
      .map(v => stripUndefinedDeep(v)) as unknown as T;
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = stripUndefinedDeep(v);
    }
  }
  return out as T;
}

export function marshallNativeValue(val: unknown): RealNoSQLAttribute {
  return NoSQLMarshall.make(stripUndefinedDeep(val) as any, { removeUndefinedValues: true });
}

export function toRealNoSQLItem(obj: Record<string, unknown>): NoSQLItem {
  const clean = stripUndefinedDeep(obj);
  return NoSQLItem.from(clean as Record<string, any>, { removeUndefinedValues: true });
}

/**
 * Compiles internal `ConditionExpr` strictly into `@zcatalyst/nosql`'s real `INoSQLCondition` contract.
 */
export function compileRealCatalystCondition(cond: ConditionExpr): RealNoSQLCondition {
  switch (cond.type) {
    case 'attribute_exists':
      return {
        function: {
          function_name: 'attribute_exists',
          args: [{ attribute_path: [cond.attr] }],
        },
      };
    case 'attribute_not_exists':
      // Real SDK `INoSQLConditionFunction.function_name` only supports 'attribute_exists' | 'attribute_type'
      return {
        function: {
          function_name: 'attribute_exists',
          args: [{ attribute_path: [cond.attr] }],
        },
        negate: true,
      };
    case 'equals':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.EQUALS,
        value: marshallNativeValue(cond.value),
      };
    case 'not_equals':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.NOT_EQUALS,
        value: marshallNativeValue(cond.value),
      };
    case 'lt':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.LESS_THAN,
        value: NoSQLMarshall.makeNumber(cond.value),
      };
    case 'lte':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.LESS_EQUAL,
        value: NoSQLMarshall.makeNumber(cond.value),
      };
    case 'gt':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.GREATER_THAN,
        value: NoSQLMarshall.makeNumber(cond.value),
      };
    case 'gte':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.GREATER_EQUAL,
        value: NoSQLMarshall.makeNumber(cond.value),
      };
    case 'between':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.BETWEEN,
        value: NoSQLMarshall.makeList([cond.low, cond.high]),
      };
    case 'begins_with':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.BEGINS_WITH,
        value: NoSQLMarshall.makeString(cond.prefix),
      };
    case 'in':
      return {
        attribute: [cond.attr],
        operator: NoSQLEnum.NoSQLOperator.IN,
        value: NoSQLMarshall.makeList(cond.values as any[]),
      };
    case 'and':
      return {
        group_operator: NoSQLEnum.NoSQLConditionGroupOperator.AND,
        group: cond.conditions.map(compileRealCatalystCondition),
      };
    case 'or':
      return {
        group_operator: NoSQLEnum.NoSQLConditionGroupOperator.OR,
        group: cond.conditions.map(compileRealCatalystCondition),
      };
  }
}

/**
 * Builds an exact `@zcatalyst/nosql` `INoSQLUpdateItem` payload for a single-item write.
 * - Rejects multi-key conditional attempts before hitting Catalyst.
 * - Uses `NoSQLItem` for `keys` (NOT an array).
 * - Uses `NoSQLUpdateOperationType.PUT` + `update_function` (`'add' | 'subtract'`) for numeric deltas.
 */
export function buildRealUpdateItemPayload(
  table: TableName,
  keys: TableKey[],
  updates: Record<string, unknown>,
  condition?: ConditionExpr,
  increments?: Record<string, number>
): RealNoSQLUpdateItem {
  if (keys.length !== 1) {
    throw new Error(
      `SINGLE_ITEM_CONDITION_VIOLATION: Conditional updateItems on '${table}' MUST target exactly 1 key (received ${keys.length}).`
    );
  }
  const singleKey = keys[0];
  const updateAttributes: RealNoSQLUpdateAttrOp[] = [];

  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) {
      updateAttributes.push({
        operation_type: NoSQLUpdateOperationType.DELETE,
        attribute_path: [k],
      });
    } else {
      updateAttributes.push({
        operation_type: NoSQLUpdateOperationType.PUT,
        attribute_path: [k],
        update_value: marshallNativeValue(v),
      });
    }
  }

  if (increments) {
    for (const [k, delta] of Object.entries(increments)) {
      if (!Number.isFinite(delta) || delta === 0) {
        throw new Error(`INVALID_NUMERIC_DELTA: Increment/decrement on '${k}' must be non-zero finite number.`);
      }
      updateAttributes.push({
        operation_type: NoSQLUpdateOperationType.PUT,
        attribute_path: [k],
        update_function: {
          function_name: delta > 0 ? 'add' : 'subtract',
          args: [{ attribute_path: [k] }, NoSQLMarshall.makeNumber(Math.abs(delta))],
        },
      });
    }
  }

  return {
    keys: toRealNoSQLItem(singleKey as unknown as Record<string, unknown>),
    update_attributes: updateAttributes,
    ...(condition ? { condition: compileRealCatalystCondition(condition) } : {}),
    return: 'NEW',
  };
}

export function buildRealFetchItemPayload(
  key: TableKey,
  options?: { consistent_read?: boolean; required_attributes?: Array<Array<string>> }
): RealNoSQLFetchItem {
  return {
    keys: [toRealNoSQLItem(key as unknown as Record<string, unknown>)],
    consistent_read: Boolean(options?.consistent_read),
    ...(options?.required_attributes ? { required_attributes: options.required_attributes } : {}),
  };
}

export function buildRealQueryPayload(
  pkAttr: string,
  skAttr: string | undefined,
  spec: QueryTableSpec
): RealNoSQLQuery {
  const pkCond: ConditionExpr = { type: 'equals', attr: pkAttr, value: spec.partitionKeyValue };
  const conditions: ConditionExpr[] = [pkCond];

  if (skAttr) {
    if (spec.sortKeyEquals !== undefined) {
      conditions.push({ type: 'equals', attr: skAttr, value: spec.sortKeyEquals });
    } else if (spec.sortKeyPrefix !== undefined) {
      conditions.push({ type: 'begins_with', attr: skAttr, prefix: spec.sortKeyPrefix });
    } else if (spec.sortKeyBetween !== undefined) {
      conditions.push({
        type: 'between',
        attr: skAttr,
        low: spec.sortKeyBetween[0],
        high: spec.sortKeyBetween[1],
      });
    }
  }

  const keyCondition: RealNoSQLCondition =
    conditions.length === 1
      ? compileRealCatalystCondition(conditions[0])
      : compileRealCatalystCondition({ type: 'and', conditions });

  const payload: RealNoSQLQuery = {
    key_condition: keyCondition,
    consistent_read: Boolean(spec.consistent_read),
    forward_scan: spec.scanDescending === undefined ? true : !spec.scanDescending,
    ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
  };

  if (spec.startKey && typeof spec.startKey === 'object') {
    payload.start_key = toRealNoSQLItem(spec.startKey);
  } else if (typeof spec.startKey === 'string') {
    const trimmed = spec.startKey.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      let decodedJson: unknown;
      try {
        decodedJson = trimmed.startsWith('{')
          ? JSON.parse(trimmed)
          : JSON.parse(Buffer.from(trimmed, 'base64url').toString('utf8'));
      } catch {
        throw new Error('INVALID_PAGINATION_CURSOR: startKey cursor must be valid JSON or Base64URL-encoded JSON.');
      }
      if (!decodedJson || typeof decodedJson !== 'object' || Array.isArray(decodedJson)) {
        throw new Error('INVALID_PAGINATION_CURSOR: Decoded startKey cursor must be an object.');
      }
      const rawObj = decodedJson as Record<string, unknown>;
      const entries = Object.entries(rawObj);
      if (entries.length > 0) {
        const looksAlreadyMarshalled = entries.every(([, v]) => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
          const keys = Object.keys(v as Record<string, unknown>);
          return (
            keys.length === 1 &&
            ['S', 'N', 'B', 'BOOL', 'NULL', 'L', 'M', 'SS', 'SN', 'SB'].includes(keys[0])
          );
        });
        payload.start_key = looksAlreadyMarshalled
          ? new NoSQLItem(rawObj as Record<string, any>)
          : toRealNoSQLItem(rawObj);
      }
    }
  }

  return payload;
}

export function buildRealInsertItemPayload(
  item: Record<string, unknown>,
  condition?: ConditionExpr
): RealNoSQLInsertItem {
  return {
    item: toRealNoSQLItem(item),
    ...(condition ? { condition: compileRealCatalystCondition(condition) } : {}),
  };
}

export function buildRealDeleteItemPayload(
  key: TableKey,
  condition?: ConditionExpr
): RealNoSQLDeleteItem {
  return {
    keys: toRealNoSQLItem(key as unknown as Record<string, unknown>),
    ...(condition ? { condition: compileRealCatalystCondition(condition) } : {}),
  };
}

export async function buildRealNoSQLUpdateResponse(
  table: TableName,
  payload: RealNoSQLUpdateItem,
  status: 'Success' | 'ConditionMismatch' | 'CriteriaMismatch',
  item?: Record<string, unknown>,
  oldItem?: Record<string, unknown>
): Promise<RealNoSQLResponse> {
  const rawItem = item ? toRealNoSQLItem(item).toJSON() : undefined;
  const rawOld = oldItem ? toRealNoSQLItem(oldItem).toJSON() : undefined;
  const stubTable = new NoSQLTable(
    {
      async send() {
        return {
          data: {
            data: {
              size: rawItem ? Buffer.byteLength(JSON.stringify(rawItem), 'utf8') : 0,
              operation: NoSQLEnum.NoSQLCrudOperation.UPDATE,
              start_key: {},
              update: [
                {
                  status,
                  ...(rawItem ? { item: rawItem } : {}),
                  ...(rawOld ? { old_item: rawOld } : {}),
                },
              ],
            },
          },
        };
      },
    } as any,
    { tableId: table }
  );
  return stubTable.updateItems(payload);
}
