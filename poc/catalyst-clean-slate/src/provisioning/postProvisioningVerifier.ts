/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.1 Strictly Read-Only Provisioning Verification Engine
 *
 * STRICT SAFETY INVARIANTS:
 * 1. STRICTLY READ-ONLY: Only invokes `getAllTable()`, `fetchItem()`, `queryTable()`,
 *    `queryIndex()`, and optional `UserManagement.getAllUsers()`. NEVER exposes or calls
 *    any table mutation, batch write, bootstrap, or user mutation operations.
 * 2. HONEST SDK CAPABILITIES: Built strictly against verified `@zcatalyst/nosql@1.0.0`
 *    (`INoSQLTable`, `INoSQLIndex`, `DataType`, `AttribType`) and `@zcatalyst/auth@1.0.0`
 *    (`ICatalystUser`), instantiated safely through `CatalystAdminAppProvider` (`SDK-01`
 *    mitigation).
 * 3. EXPLICIT MATRICES & LIMITS: Emits explicit per-table (5) and per-index (8) verification
 *    matrices, cross-checks `project_details.id` when returned by Catalyst, derives target region
 *    from `CATALYST_API_DOMAIN`, and flags checks requiring visual Catalyst Console confirmation
 *    (such as `ttlEpochSec` column type = `Number`).
 */

import type { UserManagement } from '@zcatalyst/auth';
import type { NoSQLTable } from '@zcatalyst/nosql';
import {
  buildRealFetchItemPayload,
  buildRealQueryPayload,
  type RealNoSQLFetchItem,
  type RealNoSQLQuery,
} from '../nosql/catalystModularAdapter.js';
import type { CatalystAdminAppProvider } from '../sdk/catalystSdkBridge.js';
import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  KeyBuilders,
  TABLE_SCHEMA_REGISTRY,
  type SecondaryIndexProjection,
  type TableName,
  type TableSchemaSpec,
} from '../types/cleanSlate.js';
import { inferCatalystRegionFromApiDomain } from './catalystConfigPreflight.js';

export type RealNoSQLTableMeta = ReturnType<NoSQLTable['toJSON']>;
export type RealNoSQLIndexMeta = RealNoSQLTableMeta['global_index'][number];
export type RealNoSQLKeyColumnMeta = RealNoSQLTableMeta['partition_key'];
export type RealCatalystAuthUser = Awaited<ReturnType<UserManagement['getAllUsers']>>[number];

export interface ReadOnlyNoSQLResponseLike {
  get?: Array<{ status?: string; item?: { to(): Record<string, unknown> } }>;
  size?: number;
}

export interface IReadOnlyNoSQLTableProbe {
  toJSON(): RealNoSQLTableMeta;
  fetchItem(value: RealNoSQLFetchItem): Promise<ReadOnlyNoSQLResponseLike>;
  queryTable(query: RealNoSQLQuery): Promise<ReadOnlyNoSQLResponseLike>;
  queryIndex(indexId: string, query: RealNoSQLQuery): Promise<ReadOnlyNoSQLResponseLike>;
}

export interface IReadOnlyAuthProbe {
  getAllUsers(): Promise<Array<Pick<RealCatalystAuthUser, 'user_id' | 'email_id' | 'status' | 'is_confirmed'>>>;
}

export interface IReadOnlyProvisioningEnvironment {
  nosql: {
    getAllTable(): Promise<IReadOnlyNoSQLTableProbe[]>;
  };
  auth?: IReadOnlyAuthProbe;
}

export interface VerificationCheckEntry {
  id: string;
  table: TableName | 'ALL' | 'AUTH';
  category:
    | 'SCHEMA'
    | 'INDEX'
    | 'PROJECTION'
    | 'TTL'
    | 'EMPTY_PROBE'
    | 'AUTH_USERS'
    | 'ADAPTER_CONTRACT'
    | 'PROJECT_CONTEXT';
  passed: boolean;
  detail: string;
}

export interface TableVerificationMatrixEntry {
  tableName: TableName;
  exists: boolean;
  status: string | null;
  partitionKeyOk: boolean;
  sortKeyOk: boolean;
  additionalSortKeysOk: boolean;
  ttlOk: boolean;
  projectDetailsMatch: boolean | 'NOT_REPORTED';
  metricsItemCount: number | null;
  emptyProbePassed: boolean;
  discrepancies: string[];
}

export interface IndexVerificationMatrixEntry {
  tableName: TableName;
  indexName: string;
  exists: boolean;
  status: string | null;
  partitionKeyOk: boolean;
  sortKeyOk: boolean;
  projectionOk: boolean;
  includeColumnsOk: boolean;
  emptyProbePassed: boolean;
  discrepancies: string[];
}

export interface ProvisioningTargetContext {
  projectId: string | null;
  catalystEnvironment: string | null;
  apiDomain: string | null;
  inferredRegion: string;
  databaseEngine: 'Zoho Catalyst NoSQL';
}

export interface PostProvisioningVerificationReport {
  phase: '5.1';
  mode: 'OFFLINE_SELF_CHECK' | 'READONLY_LIVE_OR_MOCK_PROBE';
  verdict: 'PASS_SELF_CHECK' | 'PASS_READONLY_CLEAN_SLATE' | 'FAIL_SCHEMA_MISMATCH' | 'FAIL_NON_EMPTY_STATE';
  writeOperationsExecuted: 0;
  targetContext: ProvisioningTargetContext;
  tablesExpected: TableName[];
  tablesFound: string[];
  extraTablesFound: string[];
  tableMatrix: TableVerificationMatrixEntry[];
  indexMatrix: IndexVerificationMatrixEntry[];
  readProbesExecuted: number;
  authUsersCount: number | null;
  checks: VerificationCheckEntry[];
  discrepancies: string[];
  manualConsoleChecksRequired: string[];
  sdkLimitations: string[];
}

export const EXPECTED_TABLES_ORDERED: TableName[] = [
  'Users',
  'UserData',
  'AdminInvitations',
  'AuditLogs',
  'SystemControl',
];

export const SDK_KNOWN_LIMITATIONS: string[] = [
  'INoSQLTable.ttl_attribute (`@zcatalyst/nosql@1.0.0`) returns only the attribute name (`string | undefined`), NOT the column data type (`Number`). Operator MUST confirm `ttlEpochSec` type = `Number` in Catalyst Console.',
  'Catalyst NoSQL exposes NO full-table `SCAN` endpoint in `@zcatalyst/nosql@1.0.0`; emptiness outside `Users.GSI_Directory` shards (`USER_SEG#0..3`), `Users.GSI_RoleStatus`, `SystemControl` control keys, and current `AuditLogs` month/quarter partitions must be corroborated via table `metrics` (if populated) and Catalyst Console Data Browser.',
  'Catalyst NoSQL secondary indexes (`INoSQLIndex`) do NOT support UNIQUE constraints; `Users.GSI_Email` duplicate prevention relies on backend `consistent_read: true` checks and Catalyst Auth (`INT-03` pending).',
  'INoSQLTable (`@zcatalyst/nosql@1.0.0`) exposes `project_details` (`id`, `project_name`, `project_type`) but does NOT return Catalyst cloud region or storage engine version directly; region must be verified via `CATALYST_API_DOMAIN` against `CATALYST_DATA_CENTERS` and Catalyst Console.',
];

export const MANDATORY_MANUAL_CONSOLE_CHECKS: string[] = [
  'Confirm visually in Catalyst Console -> NoSQL that ONLY the 5 expected tables exist (`Users`, `UserData`, `AdminInvitations`, `AuditLogs`, `SystemControl`) and all show status ONLINE.',
  'Confirm visually in `AdminInvitations` and `SystemControl` TTL settings that attribute name is exactly `ttlEpochSec` and data type is `Number` (Unix epoch seconds).',
  'Confirm visually in `Users`, `UserData`, and `AuditLogs` that TTL is completely DISABLED.',
  'Confirm visually in `Users.GSI_Directory` that Projected Attributes mode is Specific/Include Attributes containing the exact 11 columns (`pk`, `uid`, `email`, `displayName`, `role`, `roleVersion`, `accountStatus`, `emailVerified`, `directorySegment`, `createdAt`, `lastSignInAt`).',
  'Confirm visually in Catalyst Console Data Browser that item count is 0 across all 5 tables and Catalyst Authentication -> Users list is empty (0 created app users).',
];

/**
 * Wraps a validated `CatalystAdminAppProvider` into an explicitly READ-ONLY environment.
 * Exposes ONLY `getAllTable`, `fetchItem`, `queryTable`, `queryIndex`, and `getAllUsers`.
 */
export function createReadOnlyEnvironmentFromProvider(
  adminProvider: CatalystAdminAppProvider
): IReadOnlyProvisioningEnvironment {
  const nosqlClient = adminProvider.createNoSQLClient();
  const userMgmt = adminProvider.createUserManagementAdmin();

  return {
    nosql: {
      async getAllTable(): Promise<IReadOnlyNoSQLTableProbe[]> {
        const tables = await nosqlClient.getAllTable();
        return tables.map((t): IReadOnlyNoSQLTableProbe => ({
          toJSON: () => t.toJSON(),
          fetchItem: payload => t.fetchItem(payload),
          queryTable: payload => t.queryTable(payload),
          queryIndex: (indexId, payload) => t.queryIndex(indexId, payload),
        }));
      },
    },
    auth: {
      async getAllUsers() {
        return userMgmt.getAllUsers();
      },
    },
  };
}

function normalizeKeyType(rawType: string | undefined): 'String' | 'Number' | string {
  if (!rawType) return 'UNKNOWN';
  const upper = String(rawType).toUpperCase();
  if (upper === 'S' || upper === 'STRING') return 'String';
  if (upper === 'N' || upper === 'NUMBER') return 'Number';
  return String(rawType);
}

function normalizeProjectionType(rawType: string | undefined): SecondaryIndexProjection | string {
  if (!rawType) return 'UNKNOWN';
  const lower = String(rawType).toLowerCase();
  if (lower === 'all') return 'ALL';
  if (lower === 'keys_only') return 'KEYS_ONLY';
  if (lower === 'include' || lower === 'specific_attributes') return 'SPECIFIC_ATTRIBUTES';
  return String(rawType);
}

function extractIncludeColumns(idx: RealNoSQLIndexMeta): string[] {
  const cols = idx.projected_attributes?.include_columns;
  if (!cols) return [];
  if (cols instanceof Set) {
    return Array.from(cols).sort();
  }
  if (Array.isArray(cols)) {
    return [...(cols as unknown as string[])].sort();
  }
  return [];
}

function sameKeyColumn(
  actual: RealNoSQLKeyColumnMeta | undefined,
  expectedName: string | undefined,
  expectedType: 'String' | 'Number' | undefined
): boolean {
  if (!expectedName) {
    return !actual || !actual.column_name;
  }
  if (!actual) return false;
  return (
    actual.column_name === expectedName &&
    normalizeKeyType(actual.data_type) === expectedType
  );
}

function extractMetricsItemCount(meta: RealNoSQLTableMeta): number | null {
  if (!meta.metrics || typeof meta.metrics !== 'object') return null;
  for (const field of ['item_count', 'items_count', 'record_count', 'row_count', 'total_items']) {
    const val = meta.metrics[field];
    if (typeof val === 'number') {
      return val;
    }
  }
  return null;
}

function inspectTableMetricsForNonZeroCount(meta: RealNoSQLTableMeta): string | null {
  const count = extractMetricsItemCount(meta);
  if (typeof count === 'number' && count > 0) {
    return `Table '${meta.name}' reported non-zero metrics item_count=${count}.`;
  }
  return null;
}

export function verifySchemaAgainstRegistry(
  tablesMeta: RealNoSQLTableMeta[],
  options: { failOnExtraTables?: boolean; expectedProjectId?: string } = {}
): {
  checks: VerificationCheckEntry[];
  discrepancies: string[];
  extraTablesFound: string[];
  tablesFound: string[];
  tableMatrix: TableVerificationMatrixEntry[];
  indexMatrix: IndexVerificationMatrixEntry[];
} {
  const failOnExtraTables = options.failOnExtraTables ?? true;
  const checks: VerificationCheckEntry[] = [];
  const discrepancies: string[] = [];
  const tableMatrix: TableVerificationMatrixEntry[] = [];
  const indexMatrix: IndexVerificationMatrixEntry[] = [];
  const byName = new Map<string, RealNoSQLTableMeta>();

  for (const meta of tablesMeta) {
    byName.set(meta.name, meta);
  }

  const tablesFound = tablesMeta.map(t => t.name).sort();
  const expectedSet = new Set<string>(EXPECTED_TABLES_ORDERED);
  const extraTablesFound = tablesFound.filter(n => !expectedSet.has(n));

  if (extraTablesFound.length > 0 && failOnExtraTables) {
    const msg = `Unexpected extra tables present in Catalyst project: ${extraTablesFound.join(', ')}`;
    discrepancies.push(msg);
    checks.push({
      id: 'SCHEMA-EXTRA-TABLES',
      table: 'ALL',
      category: 'SCHEMA',
      passed: false,
      detail: msg,
    });
  } else {
    checks.push({
      id: 'SCHEMA-NO-EXTRA-TABLES',
      table: 'ALL',
      category: 'SCHEMA',
      passed: true,
      detail: `Exact clean-slate 5-table boundary respected (extraTablesFound=${extraTablesFound.length}).`,
    });
  }

  for (const tableName of EXPECTED_TABLES_ORDERED) {
    const spec: TableSchemaSpec = TABLE_SCHEMA_REGISTRY[tableName];
    const meta = byName.get(tableName);
    const tableDiscrepancies: string[] = [];

    if (!meta) {
      const msg = `Missing required Clean-Slate table '${tableName}'.`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
      checks.push({
        id: `SCHEMA-${tableName}-EXISTS`,
        table: tableName,
        category: 'SCHEMA',
        passed: false,
        detail: msg,
      });

      tableMatrix.push({
        tableName,
        exists: false,
        status: null,
        partitionKeyOk: false,
        sortKeyOk: false,
        additionalSortKeysOk: false,
        ttlOk: false,
        projectDetailsMatch: 'NOT_REPORTED',
        metricsItemCount: null,
        emptyProbePassed: false,
        discrepancies: tableDiscrepancies,
      });

      for (const idxSpec of spec.secondaryIndexes) {
        const idxMsg = `Missing GSI '${idxSpec.indexName}' because parent table '${tableName}' is missing.`;
        indexMatrix.push({
          tableName,
          indexName: idxSpec.indexName,
          exists: false,
          status: null,
          partitionKeyOk: false,
          sortKeyOk: false,
          projectionOk: false,
          includeColumnsOk: false,
          emptyProbePassed: false,
          discrepancies: [idxMsg],
        });
      }
      continue;
    }

    const statusOk = meta.status === 'ONLINE';
    if (!statusOk) {
      const msg = `Table '${tableName}' status is '${meta.status}' instead of 'ONLINE'.`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
    }
    checks.push({
      id: `SCHEMA-${tableName}-STATUS`,
      table: tableName,
      category: 'SCHEMA',
      passed: statusOk,
      detail: `Table '${tableName}' status=${meta.status}`,
    });

    // Optional remote project_details.id verification against expectedProjectId
    let projectDetailsMatch: boolean | 'NOT_REPORTED' = 'NOT_REPORTED';
    const reportedProjectId = meta.project_details?.id ? String(meta.project_details.id) : undefined;
    if (options.expectedProjectId && reportedProjectId) {
      projectDetailsMatch = reportedProjectId === options.expectedProjectId;
      if (!projectDetailsMatch) {
        const msg = `Table '${tableName}' project_details.id '${reportedProjectId}' mismatches expected project '${options.expectedProjectId}'.`;
        discrepancies.push(msg);
        tableDiscrepancies.push(msg);
      }
      checks.push({
        id: `PROJECT-${tableName}`,
        table: tableName,
        category: 'PROJECT_CONTEXT',
        passed: projectDetailsMatch,
        detail: `Table '${tableName}' project_details.id=${reportedProjectId} (expected=${options.expectedProjectId})`,
      });
    }

    const pkOk = sameKeyColumn(meta.partition_key, spec.partitionKey, spec.partitionKeyType);
    if (!pkOk) {
      const msg = `Table '${tableName}' partition_key mismatch: expected ${spec.partitionKey}(${spec.partitionKeyType}), found ${meta.partition_key?.column_name}(${meta.partition_key?.data_type}).`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
    }
    checks.push({
      id: `SCHEMA-${tableName}-PK`,
      table: tableName,
      category: 'SCHEMA',
      passed: pkOk,
      detail: `PK expected ${spec.partitionKey}(${spec.partitionKeyType}), found ${meta.partition_key?.column_name}(${meta.partition_key?.data_type})`,
    });

    const skOk =
      spec.sortKey === null
        ? !meta.sort_key || !meta.sort_key.column_name
        : sameKeyColumn(meta.sort_key, spec.sortKey, spec.sortKeyType);
    if (!skOk) {
      const msg = `Table '${tableName}' primary sort_key mismatch: expected ${spec.sortKey ?? 'OMITTED'}, found ${meta.sort_key?.column_name ?? 'OMITTED'}.`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
    }
    checks.push({
      id: `SCHEMA-${tableName}-SK`,
      table: tableName,
      category: 'SCHEMA',
      passed: skOk,
      detail: `SK expected ${spec.sortKey ?? 'OMITTED'}, found ${meta.sort_key?.column_name ?? 'OMITTED'}`,
    });

    const actualAddlSks = (meta.additional_sort_keys ?? []).map(
      k => `${k.column_name}:${normalizeKeyType(k.data_type)}`
    ).sort();
    const expectedAddlSks = spec.additionalSortKeys.map(k => `${k.name}:${k.type}`).sort();
    const totalSortKeys = (spec.sortKey ? 1 : 0) + actualAddlSks.length;
    const addlOk =
      totalSortKeys <= CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE &&
      JSON.stringify(actualAddlSks) === JSON.stringify(expectedAddlSks);
    if (!addlOk) {
      const msg = `Table '${tableName}' additional_sort_keys mismatch: expected [${expectedAddlSks.join(', ')}], found [${actualAddlSks.join(', ')}].`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
    }
    checks.push({
      id: `SCHEMA-${tableName}-ADDL-SK`,
      table: tableName,
      category: 'SCHEMA',
      passed: addlOk,
      detail: `Additional SKs expected [${expectedAddlSks.join(', ')}], found [${actualAddlSks.join(', ')}] (totalSortKeys=${totalSortKeys}/5)`,
    });

    // TTL Verification
    const expectedTtlEnabled = Boolean(spec.ttlAttribute);
    const expectedTtlAttr = spec.ttlAttribute?.name;
    const ttlOk = expectedTtlEnabled
      ? meta.ttl_enabled === true && meta.ttl_attribute === expectedTtlAttr
      : meta.ttl_enabled === false && (!meta.ttl_attribute || meta.ttl_attribute === '');
    if (!ttlOk) {
      const msg = `Table '${tableName}' TTL mismatch: expected enabled=${expectedTtlEnabled} attr=${expectedTtlAttr ?? 'NONE'}, found enabled=${meta.ttl_enabled} attr=${meta.ttl_attribute ?? 'NONE'}.`;
      discrepancies.push(msg);
      tableDiscrepancies.push(msg);
    }
    checks.push({
      id: `TTL-${tableName}`,
      table: tableName,
      category: 'TTL',
      passed: ttlOk,
      detail: `TTL expected enabled=${expectedTtlEnabled}${expectedTtlAttr ? `(${expectedTtlAttr})` : ''}, found enabled=${meta.ttl_enabled}(${meta.ttl_attribute ?? 'NONE'})`,
    });

    tableMatrix.push({
      tableName,
      exists: true,
      status: meta.status ?? null,
      partitionKeyOk: pkOk,
      sortKeyOk: skOk,
      additionalSortKeysOk: addlOk,
      ttlOk,
      projectDetailsMatch,
      metricsItemCount: extractMetricsItemCount(meta),
      emptyProbePassed: true,
      discrepancies: tableDiscrepancies,
    });

    // Secondary Index Verification
    const actualGsis = meta.global_index ?? [];
    const actualGsiMap = new Map(actualGsis.map(g => [g.name, g]));
    const expectedGsiNames = new Set(spec.secondaryIndexes.map(g => g.indexName));
    const unexpectedGsis = actualGsis.filter(g => !expectedGsiNames.has(g.name)).map(g => g.name);

    if (unexpectedGsis.length > 0) {
      const msg = `Table '${tableName}' has unexpected GSIs: ${unexpectedGsis.join(', ')}.`;
      discrepancies.push(msg);
      checks.push({
        id: `INDEX-${tableName}-NO-EXTRA`,
        table: tableName,
        category: 'INDEX',
        passed: false,
        detail: msg,
      });
    }

    for (const idxSpec of spec.secondaryIndexes) {
      const actualIdx = actualGsiMap.get(idxSpec.indexName);
      const idxDiscrepancies: string[] = [];

      if (!actualIdx) {
        const msg = `Missing GSI '${idxSpec.indexName}' on table '${tableName}'.`;
        discrepancies.push(msg);
        idxDiscrepancies.push(msg);
        checks.push({
          id: `INDEX-${tableName}-${idxSpec.indexName}`,
          table: tableName,
          category: 'INDEX',
          passed: false,
          detail: msg,
        });
        indexMatrix.push({
          tableName,
          indexName: idxSpec.indexName,
          exists: false,
          status: null,
          partitionKeyOk: false,
          sortKeyOk: false,
          projectionOk: false,
          includeColumnsOk: false,
          emptyProbePassed: false,
          discrepancies: idxDiscrepancies,
        });
        continue;
      }

      const idxPkOk = sameKeyColumn(actualIdx.partition_key, idxSpec.partitionKey, idxSpec.partitionKeyType);
      const idxSkOk = sameKeyColumn(actualIdx.sort_key, idxSpec.sortKey, idxSpec.sortKeyType);
      const idxKeysOk = actualIdx.status === 'ONLINE' && idxPkOk && idxSkOk;

      if (!idxKeysOk) {
        const msg = `GSI '${tableName}.${idxSpec.indexName}' status/key mismatch: status=${actualIdx.status}, PK=${actualIdx.partition_key?.column_name}(${actualIdx.partition_key?.data_type}), SK=${actualIdx.sort_key?.column_name ?? 'NONE'}.`;
        discrepancies.push(msg);
        idxDiscrepancies.push(msg);
      }
      checks.push({
        id: `INDEX-${tableName}-${idxSpec.indexName}`,
        table: tableName,
        category: 'INDEX',
        passed: idxKeysOk,
        detail: `GSI ${idxSpec.indexName} status=${actualIdx.status}, PK=${actualIdx.partition_key?.column_name}, SK=${actualIdx.sort_key?.column_name ?? 'NONE'}`,
      });

      const normProj = normalizeProjectionType(actualIdx.projected_attributes?.type);
      const projTypeOk = normProj === idxSpec.projection;
      let includeColsOk = true;
      if (idxSpec.projection === 'SPECIFIC_ATTRIBUTES' && idxSpec.projectedAttributes) {
        const actualCols = extractIncludeColumns(actualIdx);
        const expectedCols = [...idxSpec.projectedAttributes].sort();
        includeColsOk = JSON.stringify(actualCols) === JSON.stringify(expectedCols);
      }
      const projOk = projTypeOk && includeColsOk;
      if (!projOk) {
        const msg = `GSI '${tableName}.${idxSpec.indexName}' projection mismatch: expected ${idxSpec.projection}${idxSpec.projectedAttributes ? `(${idxSpec.projectedAttributes.length} cols)` : ''}, found ${normProj}(${extractIncludeColumns(actualIdx).join(',')}).`;
        discrepancies.push(msg);
        idxDiscrepancies.push(msg);
      }
      checks.push({
        id: `PROJ-${tableName}-${idxSpec.indexName}`,
        table: tableName,
        category: 'PROJECTION',
        passed: projOk,
        detail: `Projection expected=${idxSpec.projection}, found=${normProj}`,
      });

      indexMatrix.push({
        tableName,
        indexName: idxSpec.indexName,
        exists: true,
        status: actualIdx.status ?? null,
        partitionKeyOk: idxPkOk,
        sortKeyOk: idxSkOk,
        projectionOk: projTypeOk,
        includeColumnsOk: includeColsOk,
        emptyProbePassed: true,
        discrepancies: idxDiscrepancies,
      });
    }
  }

  return { checks, discrepancies, extraTablesFound, tablesFound, tableMatrix, indexMatrix };
}

/**
 * Compiles local adapter read-only payloads across all 5 frozen tables and all 8 GSIs
 * without executing any network traffic.
 */
export function runOfflineSelfCheck(): PostProvisioningVerificationReport {
  const checks: VerificationCheckEntry[] = [];
  const discrepancies: string[] = [];
  const tableMatrix: TableVerificationMatrixEntry[] = [];
  const indexMatrix: IndexVerificationMatrixEntry[] = [];

  const registryNames = Object.keys(TABLE_SCHEMA_REGISTRY).sort();
  const expectedSorted = [...EXPECTED_TABLES_ORDERED].sort();
  const exactFive = JSON.stringify(registryNames) === JSON.stringify(expectedSorted);
  if (!exactFive) {
    discrepancies.push(`Expected exact 5 tables, found: ${registryNames.join(', ')}`);
  }
  checks.push({
    id: 'SELFCHECK-5-TABLES',
    table: 'ALL',
    category: 'SCHEMA',
    passed: exactFive,
    detail: `Frozen registry contains exact 5 tables: ${registryNames.join(', ')}`,
  });

  for (const tableName of EXPECTED_TABLES_ORDERED) {
    const spec = TABLE_SCHEMA_REGISTRY[tableName];
    const totalSks = (spec.sortKey ? 1 : 0) + spec.additionalSortKeys.length;
    const withinSkLimit = totalSks <= CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE;
    const withinGsiLimit = spec.secondaryIndexes.length <= CATALYST_PLATFORM_LIMITS.MAX_SECONDARY_INDEXES_PER_TABLE;

    const fetchPayload = buildRealFetchItemPayload(
      spec.sortKey ? { pk: '__SELFCHECK_PK__', sk: '__SELFCHECK_SK__' } : { pk: '__SELFCHECK_PK__' },
      { consistent_read: true }
    );
    const queryTablePayload = buildRealQueryPayload(spec.partitionKey, spec.sortKey ?? undefined, {
      partitionKeyValue: '__SELFCHECK_PK__',
      consistent_read: true,
      limit: 5,
    });

    const adapterOk =
      withinSkLimit &&
      withinGsiLimit &&
      fetchPayload.consistent_read === true &&
      queryTablePayload.consistent_read === true;

    const tableDisc: string[] = [];
    if (!adapterOk) {
      const msg = `Adapter/limit check failed on table '${tableName}'.`;
      discrepancies.push(msg);
      tableDisc.push(msg);
    }
    checks.push({
      id: `ADAPTER-${tableName}`,
      table: tableName,
      category: 'ADAPTER_CONTRACT',
      passed: adapterOk,
      detail: `SortKeys=${totalSks}/5, GSIs=${spec.secondaryIndexes.length}/20, consistent_read=true verified`,
    });

    tableMatrix.push({
      tableName,
      exists: true,
      status: 'LOCAL_CONTRACT_ONLY',
      partitionKeyOk: adapterOk,
      sortKeyOk: adapterOk,
      additionalSortKeysOk: withinSkLimit,
      ttlOk: true,
      projectDetailsMatch: 'NOT_REPORTED',
      metricsItemCount: null,
      emptyProbePassed: true,
      discrepancies: tableDisc,
    });

    for (const idx of spec.secondaryIndexes) {
      const idxPayload = buildRealQueryPayload(idx.partitionKey, idx.sortKey, {
        partitionKeyValue: '__SELFCHECK_GSI_PK__',
        consistent_read: true,
        limit: 5,
      });
      const idxOk = idxPayload.consistent_read === true;
      const idxDisc: string[] = [];
      if (!idxOk) {
        const msg = `Index adapter check failed on '${tableName}.${idx.indexName}'.`;
        discrepancies.push(msg);
        idxDisc.push(msg);
      }
      checks.push({
        id: `ADAPTER-${tableName}-${idx.indexName}`,
        table: tableName,
        category: 'ADAPTER_CONTRACT',
        passed: idxOk,
        detail: `GSI query payload compiled against @zcatalyst/nosql contract with consistent_read=true`,
      });
      indexMatrix.push({
        tableName,
        indexName: idx.indexName,
        exists: true,
        status: 'LOCAL_CONTRACT_ONLY',
        partitionKeyOk: idxOk,
        sortKeyOk: idxOk,
        projectionOk: true,
        includeColumnsOk: true,
        emptyProbePassed: true,
        discrepancies: idxDisc,
      });
    }
  }

  return {
    phase: '5.1',
    mode: 'OFFLINE_SELF_CHECK',
    verdict: discrepancies.length === 0 ? 'PASS_SELF_CHECK' : 'FAIL_SCHEMA_MISMATCH',
    writeOperationsExecuted: 0,
    targetContext: {
      projectId: null,
      catalystEnvironment: null,
      apiDomain: null,
      inferredRegion: 'LOCAL_OFFLINE',
      databaseEngine: 'Zoho Catalyst NoSQL',
    },
    tablesExpected: EXPECTED_TABLES_ORDERED,
    tablesFound: registryNames,
    extraTablesFound: [],
    tableMatrix,
    indexMatrix,
    readProbesExecuted: 0,
    authUsersCount: null,
    checks,
    discrepancies,
    manualConsoleChecksRequired: MANDATORY_MANUAL_CONSOLE_CHECKS,
    sdkLimitations: SDK_KNOWN_LIMITATIONS,
  };
}

/**
 * Executes STRICTLY READ-ONLY verification against a provisioned Zoho Catalyst project
 * (or mock equivalent). Zero write operations exist in this module.
 */
export async function probeCleanSlateEmptyAndContracts(
  env: IReadOnlyProvisioningEnvironment,
  options: {
    now?: Date;
    failOnExtraTables?: boolean;
    expectedProjectId?: string;
    catalystEnvironment?: string;
    apiDomain?: string;
  } = {}
): Promise<PostProvisioningVerificationReport> {
  const now = options.now ?? new Date();
  const tableProbes = await env.nosql.getAllTable();
  const tablesMeta = tableProbes.map(t => t.toJSON());
  const byName = new Map<string, IReadOnlyNoSQLTableProbe>();
  for (const probe of tableProbes) {
    byName.set(probe.toJSON().name, probe);
  }

  const schemaResult = verifySchemaAgainstRegistry(tablesMeta, {
    failOnExtraTables: options.failOnExtraTables ?? true,
    expectedProjectId: options.expectedProjectId,
  });
  const checks: VerificationCheckEntry[] = [...schemaResult.checks];
  const discrepancies: string[] = [...schemaResult.discrepancies];
  const tableMatrixMap = new Map(schemaResult.tableMatrix.map(row => [row.tableName, row]));
  const indexMatrixMap = new Map(
    schemaResult.indexMatrix.map(row => [`${row.tableName}.${row.indexName}`, row])
  );

  let hasSchemaFailure = discrepancies.length > 0;
  let hasNonEmptyFailure = false;
  let readProbesExecuted = 0;

  for (const meta of tablesMeta) {
    const metricsErr = inspectTableMetricsForNonZeroCount(meta);
    if (metricsErr) {
      hasNonEmptyFailure = true;
      discrepancies.push(metricsErr);
      const tRow = tableMatrixMap.get(meta.name as TableName);
      if (tRow) {
        tRow.emptyProbePassed = false;
        tRow.discrepancies.push(metricsErr);
      }
      checks.push({
        id: `METRICS-EMPTY-${meta.name}`,
        table: (EXPECTED_TABLES_ORDERED.includes(meta.name as TableName) ? meta.name : 'ALL') as TableName | 'ALL',
        category: 'EMPTY_PROBE',
        passed: false,
        detail: metricsErr,
      });
    }
  }

  const recordProbeCount = (
    id: string,
    table: TableName,
    detailPrefix: string,
    resp: ReadOnlyNoSQLResponseLike,
    indexName?: string
  ) => {
    readProbesExecuted++;
    const items = (resp.get ?? []).filter(r => r.item);
    const empty = items.length === 0;
    if (!empty) {
      hasNonEmptyFailure = true;
      const msg = `${detailPrefix} returned ${items.length} unexpected document(s); clean-slate must be empty.`;
      discrepancies.push(msg);
      const tRow = tableMatrixMap.get(table);
      if (tRow) {
        tRow.emptyProbePassed = false;
        tRow.discrepancies.push(msg);
      }
      if (indexName) {
        const iRow = indexMatrixMap.get(`${table}.${indexName}`);
        if (iRow) {
          iRow.emptyProbePassed = false;
          iRow.discrepancies.push(msg);
        }
      }
    }
    checks.push({
      id,
      table,
      category: 'EMPTY_PROBE',
      passed: empty,
      detail: `${detailPrefix}: items=${items.length}`,
    });
  };

  // 1. Users Read-Only Empty & GSI Probes
  const usersProbe = byName.get('Users');
  if (usersProbe) {
    const usersSpec = TABLE_SCHEMA_REGISTRY.Users;
    recordProbeCount(
      'PROBE-USERS-SENTINEL',
      'Users',
      'Users fetchItem(USER#__clean_slate_probe__)',
      await usersProbe.fetchItem(
        buildRealFetchItemPayload({ pk: 'USER#__clean_slate_probe__' }, { consistent_read: true })
      )
    );

    const gsiEmail = usersSpec.secondaryIndexes.find(i => i.indexName === 'GSI_Email')!;
    recordProbeCount(
      'PROBE-USERS-GSI-EMAIL',
      'Users',
      'Users queryIndex(GSI_Email, sentinel)',
      await usersProbe.queryIndex(
        gsiEmail.indexName,
        buildRealQueryPayload(gsiEmail.partitionKey, gsiEmail.sortKey, {
          partitionKeyValue: '__clean_slate_probe__@invalid.local',
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiEmail.indexName
    );

    const gsiDir = usersSpec.secondaryIndexes.find(i => i.indexName === 'GSI_Directory')!;
    for (const seg of DIRECTORY_SEGMENTS) {
      recordProbeCount(
        `PROBE-USERS-GSI-DIR-${seg}`,
        'Users',
        `Users queryIndex(GSI_Directory, ${seg})`,
        await usersProbe.queryIndex(
          gsiDir.indexName,
          buildRealQueryPayload(gsiDir.partitionKey, gsiDir.sortKey, {
            partitionKeyValue: seg,
            consistent_read: true,
            limit: 5,
          })
        ),
        gsiDir.indexName
      );
    }

    const gsiRole = usersSpec.secondaryIndexes.find(i => i.indexName === 'GSI_RoleStatus')!;
    for (const role of ['superadmin', 'admin', 'athlete'] as const) {
      for (const accountStatus of ['active', 'suspended'] as const) {
        recordProbeCount(
          `PROBE-USERS-GSI-ROLE-${role}-${accountStatus}`,
          'Users',
          `Users queryIndex(GSI_RoleStatus, ${role}/${accountStatus})`,
          await usersProbe.queryIndex(
            gsiRole.indexName,
            buildRealQueryPayload(gsiRole.partitionKey, gsiRole.sortKey, {
              partitionKeyValue: role,
              sortKeyEquals: accountStatus,
              consistent_read: true,
              limit: 5,
            })
          ),
          gsiRole.indexName
        );
      }
    }
  }

  // 2. UserData Read-Only Probes
  const userDataProbe = byName.get('UserData');
  if (userDataProbe) {
    const udSpec = TABLE_SCHEMA_REGISTRY.UserData;
    recordProbeCount(
      'PROBE-USERDATA-SENTINEL',
      'UserData',
      'UserData queryTable(USER#__clean_slate_probe__)',
      await userDataProbe.queryTable(
        buildRealQueryPayload(udSpec.partitionKey, udSpec.sortKey ?? undefined, {
          partitionKeyValue: 'USER#__clean_slate_probe__',
          consistent_read: true,
          limit: 5,
        })
      )
    );
    const gsiUd = udSpec.secondaryIndexes[0];
    recordProbeCount(
      'PROBE-USERDATA-GSI-DATE',
      'UserData',
      'UserData queryIndex(GSI_UserEntityDate, sentinel)',
      await userDataProbe.queryIndex(
        gsiUd.indexName,
        buildRealQueryPayload(gsiUd.partitionKey, gsiUd.sortKey, {
          partitionKeyValue: 'USER#__clean_slate_probe__',
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiUd.indexName
    );
  }

  // 3. AdminInvitations Read-Only Probes
  const inviteProbe = byName.get('AdminInvitations');
  if (inviteProbe) {
    const invSpec = TABLE_SCHEMA_REGISTRY.AdminInvitations;
    recordProbeCount(
      'PROBE-INVITES-SENTINEL',
      'AdminInvitations',
      'AdminInvitations fetchItem(INVITE#__clean_slate_probe__)',
      await inviteProbe.fetchItem(
        buildRealFetchItemPayload({ pk: 'INVITE#__clean_slate_probe__' }, { consistent_read: true })
      )
    );
    const gsiInv = invSpec.secondaryIndexes[0];
    recordProbeCount(
      'PROBE-INVITES-GSI',
      'AdminInvitations',
      'AdminInvitations queryIndex(GSI_InviteEmailStatus, sentinel)',
      await inviteProbe.queryIndex(
        gsiInv.indexName,
        buildRealQueryPayload(gsiInv.partitionKey, gsiInv.sortKey, {
          partitionKeyValue: '__clean_slate_probe__@invalid.local',
          sortKeyEquals: 'pending',
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiInv.indexName
    );
  }

  // 4. AuditLogs Read-Only Probes
  const auditProbe = byName.get('AuditLogs');
  if (auditProbe) {
    const auditSpec = TABLE_SCHEMA_REGISTRY.AuditLogs;
    const currentAuditPk = KeyBuilders.auditPk(now);
    const currentQuarter = KeyBuilders.auditPeriodBucket(now);

    recordProbeCount(
      'PROBE-AUDIT-CURRENT-MONTH',
      'AuditLogs',
      `AuditLogs queryTable(${currentAuditPk})`,
      await auditProbe.queryTable(
        buildRealQueryPayload(auditSpec.partitionKey, auditSpec.sortKey ?? undefined, {
          partitionKeyValue: currentAuditPk,
          consistent_read: true,
          limit: 5,
        })
      )
    );

    const gsiActor = auditSpec.secondaryIndexes.find(i => i.indexName === 'GSI_AuditActor')!;
    recordProbeCount(
      'PROBE-AUDIT-GSI-ACTOR',
      'AuditLogs',
      'AuditLogs queryIndex(GSI_AuditActor, sentinel)',
      await auditProbe.queryIndex(
        gsiActor.indexName,
        buildRealQueryPayload(gsiActor.partitionKey, gsiActor.sortKey, {
          partitionKeyValue: '__clean_slate_probe__',
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiActor.indexName
    );

    const gsiTarget = auditSpec.secondaryIndexes.find(i => i.indexName === 'GSI_AuditTarget')!;
    recordProbeCount(
      'PROBE-AUDIT-GSI-TARGET',
      'AuditLogs',
      'AuditLogs queryIndex(GSI_AuditTarget, sentinel)',
      await auditProbe.queryIndex(
        gsiTarget.indexName,
        buildRealQueryPayload(gsiTarget.partitionKey, gsiTarget.sortKey, {
          partitionKeyValue: '__clean_slate_probe__',
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiTarget.indexName
    );

    const gsiChron = auditSpec.secondaryIndexes.find(i => i.indexName === 'GSI_GlobalChronology')!;
    recordProbeCount(
      'PROBE-AUDIT-GSI-CHRON',
      'AuditLogs',
      `AuditLogs queryIndex(GSI_GlobalChronology, ${currentQuarter})`,
      await auditProbe.queryIndex(
        gsiChron.indexName,
        buildRealQueryPayload(gsiChron.partitionKey, gsiChron.sortKey, {
          partitionKeyValue: currentQuarter,
          consistent_read: true,
          limit: 5,
        })
      ),
      gsiChron.indexName
    );
  }

  // 5. SystemControl Read-Only Probes
  const sysProbe = byName.get('SystemControl');
  if (sysProbe) {
    recordProbeCount(
      'PROBE-SYS-BOOTSTRAP',
      'SystemControl',
      'SystemControl fetchItem(CTRL#BOOTSTRAP)',
      await sysProbe.fetchItem(
        buildRealFetchItemPayload({ pk: KeyBuilders.bootstrapLockPk() }, { consistent_read: true })
      )
    );
    recordProbeCount(
      'PROBE-SYS-COUNTER',
      'SystemControl',
      'SystemControl fetchItem(CTRL#SUPERADMIN_COUNT)',
      await sysProbe.fetchItem(
        buildRealFetchItemPayload({ pk: KeyBuilders.superadminCountPk() }, { consistent_read: true })
      )
    );
    recordProbeCount(
      'PROBE-SYS-SAGA-SENTINEL',
      'SystemControl',
      'SystemControl fetchItem(CTRL#SAGA#__clean_slate_probe__)',
      await sysProbe.fetchItem(
        buildRealFetchItemPayload({ pk: KeyBuilders.sagaPk('__clean_slate_probe__') }, { consistent_read: true })
      )
    );
    recordProbeCount(
      'PROBE-SYS-SESSION-SENTINEL',
      'SystemControl',
      'SystemControl fetchItem(SESSION#__clean_slate_probe__)',
      await sysProbe.fetchItem(
        buildRealFetchItemPayload({ pk: KeyBuilders.sessionPk('__clean_slate_probe__') }, { consistent_read: true })
      )
    );
  }

  // 6. Catalyst Auth Users Check (MUST be 0 app users in clean-slate)
  let authUsersCount: number | null = null;
  if (env.auth) {
    const authUsers = await env.auth.getAllUsers();
    authUsersCount = authUsers.length;
    const authEmpty = authUsers.length === 0;
    if (!authEmpty) {
      hasNonEmptyFailure = true;
      discrepancies.push(
        `Catalyst Authentication has ${authUsers.length} existing user(s); clean-slate pre-bootstrap expects 0 app users.`
      );
    }
    checks.push({
      id: 'AUTH-ZERO-USERS',
      table: 'AUTH',
      category: 'AUTH_USERS',
      passed: authEmpty,
      detail: `UserManagement.getAllUsers() returned ${authUsers.length} user(s)`,
    });
  }

  let verdict: PostProvisioningVerificationReport['verdict'] = 'PASS_READONLY_CLEAN_SLATE';
  if (hasSchemaFailure) {
    verdict = 'FAIL_SCHEMA_MISMATCH';
  } else if (hasNonEmptyFailure) {
    verdict = 'FAIL_NON_EMPTY_STATE';
  }

  return {
    phase: '5.1',
    mode: 'READONLY_LIVE_OR_MOCK_PROBE',
    verdict,
    writeOperationsExecuted: 0,
    targetContext: {
      projectId: options.expectedProjectId ?? tablesMeta[0]?.project_details?.id ?? null,
      catalystEnvironment: options.catalystEnvironment ?? null,
      apiDomain: options.apiDomain ?? null,
      inferredRegion: options.apiDomain
        ? inferCatalystRegionFromApiDomain(options.apiDomain)
        : 'UNKNOWN',
      databaseEngine: 'Zoho Catalyst NoSQL',
    },
    tablesExpected: EXPECTED_TABLES_ORDERED,
    tablesFound: schemaResult.tablesFound,
    extraTablesFound: schemaResult.extraTablesFound,
    tableMatrix: schemaResult.tableMatrix,
    indexMatrix: schemaResult.indexMatrix,
    readProbesExecuted,
    authUsersCount,
    checks,
    discrepancies,
    manualConsoleChecksRequired: MANDATORY_MANUAL_CONSOLE_CHECKS,
    sdkLimitations: SDK_KNOWN_LIMITATIONS,
  };
}
