import {
  NoSQL,
  NoSQLTable,
  NoSQLItem,
  NoSQLEnum,
  NoSQLMarshall,
  NoSQLUnMarshall,
  NoSQLUpdateOperationType,
} from '@zcatalyst/nosql';
import type {
  INoSQLInsertItem,
  INoSQLUpdateItem,
  INoSQLDeleteItem,
  INoSQLFetchItem,
  INoSQLQuery,
  INoSQLCondition,
  TNoSQLValues,
} from '@zcatalyst/nosql/dist-types/utils/types.js';
import { loadEnvConfig } from '../config/env.js';
import { getAuthClient } from '../auth/catalystAuth.js';

export {
  NoSQL,
  NoSQLTable,
  NoSQLItem,
  NoSQLEnum,
  NoSQLMarshall,
  NoSQLUnMarshall,
  NoSQLUpdateOperationType,
};

export interface INoSQLStorageAdapter {
  insertItems(table: string, ...items: Array<INoSQLInsertItem>): Promise<{ success: boolean; count: number; durationMs: number; error?: string }>;
  fetchItem(table: string, fetchParam: INoSQLFetchItem): Promise<{ success: boolean; item: Record<string, TNoSQLValues> | null; durationMs: number; error?: string }>;
  updateItems(table: string, ...items: Array<INoSQLUpdateItem>): Promise<{ success: boolean; count: number; durationMs: number; error?: string }>;
  deleteItems(table: string, ...items: Array<INoSQLDeleteItem>): Promise<{ success: boolean; count: number; durationMs: number; error?: string }>;
  queryTable(table: string, query: INoSQLQuery): Promise<{ success: boolean; items: Array<Record<string, TNoSQLValues>>; durationMs: number; error?: string }>;
}

/**
 * In-memory high-fidelity NoSQL engine simulating Catalyst NoSQL condition evaluation,
 * atomic updates, fencing tokens, and conditional expressions for deterministic testing.
 */
export class InMemoryNoSQLAdapter implements INoSQLStorageAdapter {
  private tables: Map<string, Map<string, Record<string, TNoSQLValues>>> = new Map();

  private getTableMap(tableName: string): Map<string, Record<string, TNoSQLValues>> {
    let t = this.tables.get(tableName);
    if (!t) {
      t = new Map();
      this.tables.set(tableName, t);
    }
    return t;
  }

  private getItemKey(item: Record<string, TNoSQLValues>): string {
    const pk = String(item.pk || item.id || item.part_key || '');
    const sk = item.sk ? `#${String(item.sk)}` : '';
    return `${pk}${sk}`;
  }

  private evaluateCondition(
    existing: Record<string, TNoSQLValues> | undefined,
    condition?: INoSQLCondition
  ): boolean {
    if (!condition) return true;

    // Negate check helper
    const applyNegate = (result: boolean) => (condition.negate ? !result : result);

    // Group condition (AND / OR)
    if (condition.group && condition.group.length > 0) {
      if (condition.group_operator === NoSQLEnum.NoSQLConditionGroupOperator.OR) {
        const orResult = condition.group.some((sub) => this.evaluateCondition(existing, sub));
        return applyNegate(orResult);
      } else {
        const andResult = condition.group.every((sub) => this.evaluateCondition(existing, sub));
        return applyNegate(andResult);
      }
    }

    // Function check: attribute_exists
    if (condition.function) {
      if (condition.function.function_name === 'attribute_exists') {
        const firstArg = condition.function.args[0];
        const attrPath = 'attribute_path' in firstArg ? firstArg.attribute_path : undefined;
        const attrName = Array.isArray(attrPath) ? attrPath[0] : (attrPath as string);
        const exists = Boolean(existing && attrName && existing[attrName] !== undefined);
        return applyNegate(exists);
      }
    }

    // Attribute comparison: EQUALS, GREATER_THAN, LESS_THAN, etc.
    if (condition.attribute && condition.operator) {
      const attrName = Array.isArray(condition.attribute) ? condition.attribute[0] : condition.attribute;
      const currentVal = existing ? existing[attrName] : undefined;

      // Extract raw target value
      let targetVal: unknown;
      if (condition.value) {
        if ('S' in condition.value) targetVal = condition.value.S;
        else if ('N' in condition.value) targetVal = Number(condition.value.N);
        else if ('BOOL' in condition.value) targetVal = condition.value.BOOL === 'true';
      }

      if (currentVal === undefined) {
        return applyNegate(false);
      }

      let opResult = false;
      switch (condition.operator) {
        case NoSQLEnum.NoSQLOperator.EQUALS:
          opResult = currentVal === targetVal;
          break;
        case NoSQLEnum.NoSQLOperator.NOT_EQUALS:
          opResult = currentVal !== targetVal;
          break;
        case NoSQLEnum.NoSQLOperator.GREATER_THAN:
          opResult = Number(currentVal) > Number(targetVal);
          break;
        case NoSQLEnum.NoSQLOperator.GREATER_EQUAL:
          opResult = Number(currentVal) >= Number(targetVal);
          break;
        case NoSQLEnum.NoSQLOperator.LESS_THAN:
          opResult = Number(currentVal) < Number(targetVal);
          break;
        case NoSQLEnum.NoSQLOperator.LESS_EQUAL:
          opResult = Number(currentVal) <= Number(targetVal);
          break;
        default:
          opResult = false;
      }
      return applyNegate(opResult);
    }

    return true;
  }

  async insertItems(
    table: string,
    ...items: Array<INoSQLInsertItem>
  ): Promise<{ success: boolean; count: number; durationMs: number; error?: string }> {
    const start = performance.now();
    const tableMap = this.getTableMap(table);

    for (const insert of items) {
      const raw = insert.item instanceof NoSQLItem ? insert.item.to() : (insert.item as Record<string, TNoSQLValues>);
      const key = this.getItemKey(raw);
      const existing = tableMap.get(key);

      if (insert.condition && !this.evaluateCondition(existing, insert.condition)) {
        return {
          success: false,
          count: 0,
          durationMs: performance.now() - start,
          error: 'CONDITIONAL_CHECK_FAILED: Insert condition was not satisfied.',
        };
      }

      tableMap.set(key, { ...raw });
    }

    return {
      success: true,
      count: items.length,
      durationMs: performance.now() - start,
    };
  }

  async fetchItem(
    table: string,
    fetchParam: INoSQLFetchItem
  ): Promise<{ success: boolean; item: Record<string, TNoSQLValues> | null; durationMs: number; error?: string }> {
    const start = performance.now();
    const tableMap = this.getTableMap(table);

    const keyObj = Array.isArray(fetchParam.keys)
      ? fetchParam.keys[0] instanceof NoSQLItem
        ? fetchParam.keys[0].to()
        : fetchParam.keys[0]
      : fetchParam.keys instanceof NoSQLItem
        ? fetchParam.keys.to()
        : fetchParam.keys;

    const key = this.getItemKey(keyObj as Record<string, TNoSQLValues>);
    const found = tableMap.get(key);

    return {
      success: true,
      item: found ? { ...found } : null,
      durationMs: performance.now() - start,
    };
  }

  async updateItems(
    table: string,
    ...items: Array<INoSQLUpdateItem>
  ): Promise<{ success: boolean; count: number; durationMs: number; error?: string }> {
    const start = performance.now();
    const tableMap = this.getTableMap(table);

    for (const update of items) {
      const keyObj = update.keys instanceof NoSQLItem ? update.keys.to() : (update.keys as Record<string, TNoSQLValues>);
      const key = this.getItemKey(keyObj);
      const existing = tableMap.get(key);

      if (update.condition && !this.evaluateCondition(existing, update.condition)) {
        return {
          success: false,
          count: 0,
          durationMs: performance.now() - start,
          error: 'CONDITIONAL_CHECK_FAILED: The conditional expression evaluated to false.',
        };
      }

      const itemCopy = existing ? { ...existing } : { ...keyObj };

      for (const attrOp of update.update_attributes) {
        const attrName = attrOp.attribute_path[0];

        if (attrOp.operation_type === NoSQLEnum.NoSQLUpdateOperationType.DELETE) {
          delete itemCopy[attrName];
          continue;
        }

        // Handle update functions (subtract / add / if_not_exists)
        if (attrOp.update_function) {
          const fn = attrOp.update_function.function_name;
          if (fn === 'subtract') {
            const secondArg = attrOp.update_function.args[1];
            const subtrahend = secondArg && typeof secondArg === 'object' && 'N' in secondArg ? Number(secondArg.N) : 1;
            const currentNum = Number(itemCopy[attrName] ?? 0);
            itemCopy[attrName] = currentNum - subtrahend;
          } else if (fn === 'add') {
            const secondArg = attrOp.update_function.args[1];
            const addend = secondArg && typeof secondArg === 'object' && 'N' in secondArg ? Number(secondArg.N) : 1;
            const currentNum = Number(itemCopy[attrName] ?? 0);
            itemCopy[attrName] = currentNum + addend;
          }
          continue;
        }

        // Handle direct PUT value
        if (attrOp.update_value) {
          if ('S' in attrOp.update_value) itemCopy[attrName] = attrOp.update_value.S!;
          else if ('N' in attrOp.update_value) itemCopy[attrName] = Number(attrOp.update_value.N);
          else if ('BOOL' in attrOp.update_value) itemCopy[attrName] = attrOp.update_value.BOOL === 'true';
          else if ('NULL' in attrOp.update_value) itemCopy[attrName] = null;
          else itemCopy[attrName] = attrOp.update_value as unknown as TNoSQLValues;
        }
      }

      tableMap.set(key, itemCopy);
    }

    return {
      success: true,
      count: items.length,
      durationMs: performance.now() - start,
    };
  }

  async deleteItems(
    table: string,
    ...items: Array<INoSQLDeleteItem>
  ): Promise<{ success: boolean; count: number; durationMs: number; error?: string }> {
    const start = performance.now();
    const tableMap = this.getTableMap(table);

    for (const del of items) {
      const keyObj = del.keys instanceof NoSQLItem ? del.keys.to() : (del.keys as Record<string, TNoSQLValues>);
      const key = this.getItemKey(keyObj);
      const existing = tableMap.get(key);

      if (del.condition && !this.evaluateCondition(existing, del.condition)) {
        return {
          success: false,
          count: 0,
          durationMs: performance.now() - start,
          error: 'CONDITIONAL_CHECK_FAILED: Delete condition was not satisfied.',
        };
      }

      tableMap.delete(key);
    }

    return {
      success: true,
      count: items.length,
      durationMs: performance.now() - start,
    };
  }

  async queryTable(
    table: string,
    query: INoSQLQuery
  ): Promise<{ success: boolean; items: Array<Record<string, TNoSQLValues>>; durationMs: number; error?: string }> {
    const start = performance.now();
    const tableMap = this.getTableMap(table);
    const results: Array<Record<string, TNoSQLValues>> = [];

    for (const val of tableMap.values()) {
      if (this.evaluateCondition(val, query.key_condition)) {
        if (!query.other_condition || this.evaluateCondition(val, query.other_condition)) {
          results.push({ ...val });
          if (query.limit && results.length >= query.limit) break;
        }
      }
    }

    return {
      success: true,
      items: results,
      durationMs: performance.now() - start,
    };
  }

  clearTable(table: string) {
    this.tables.delete(table);
  }
}

// Singleton storage adapter
let storageAdapterInstance: INoSQLStorageAdapter = new InMemoryNoSQLAdapter();

export function setStorageAdapterForTesting(adapter: INoSQLStorageAdapter) {
  storageAdapterInstance = adapter;
}

export function getStorageAdapter(): INoSQLStorageAdapter {
  return storageAdapterInstance;
}
