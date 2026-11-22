/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.2 Stage 1 Reconciled NoSQL Inventory Registry (Development)
 *
 * Documentary & local validation registry ONLY:
 * - Zero remote API calls, zero CLI executions, zero mutations.
 * - Records operator-provisioned Catalyst NoSQL Table IDs (5) and Index IDs (8) in
 *   Project-Rainfall (136967000000014024), DC US, environment `Development`.
 * - Strictly differentiates visual Console observations, operator-reported settings,
 *   and local code validations against `TABLE_SCHEMA_REGISTRY`.
 */

import {
  TABLE_SCHEMA_REGISTRY,
  type SecondaryIndexProjection,
  type TableName,
} from '../types/cleanSlate.js';

export type EvidenceOriginTag =
  | 'CONSOLE_VISUAL_OBSERVED_BY_OPERATOR'
  | 'OPERATOR_REPORTED_CONFIG'
  | 'LOCAL_CODE_VALIDATION';

export interface ProvisionedIndexRecord {
  readonly indexName: string;
  readonly indexId: string;
  readonly partitionKey: string;
  readonly partitionKeyType: 'String' | 'Number';
  readonly sortKey: string | null;
  readonly sortKeyType: 'String' | 'Number' | null;
  readonly projection: SecondaryIndexProjection;
  readonly projectedAttributes: readonly string[] | null;
  readonly reportedStatus: 'Active';
  readonly reportedItems: 0;
  readonly reportedBytes: 0;
}

export interface ProvisionedTableRecord {
  readonly order: number;
  readonly tableName: TableName;
  readonly tableId: string;
  readonly partitionKey: string;
  readonly partitionKeyType: 'String' | 'Number';
  readonly sortKey: string | null;
  readonly sortKeyType: 'String' | null;
  readonly additionalSortKeys: ReadonlyArray<{ name: string; type: 'String' | 'Number' }>;
  readonly ttlEnabled: boolean;
  readonly ttlAttributeName: 'ttlEpochSec' | null;
  readonly ttlAttributeType: 'Number' | null;
  readonly ttlApplicationRestriction?: string;
  readonly ttlTypeEvidenceOrigin: EvidenceOriginTag;
  readonly reportedRows: 0;
  readonly reportedBytes: 0;
  readonly indexes: readonly ProvisionedIndexRecord[];
}

export interface Phase52Stage1NoSQLInventory {
  readonly phase: '5.2-stage-1';
  readonly stageTitle: 'NoSQL Development Provisioning Closure';
  readonly projectName: 'Project-Rainfall';
  readonly catalystProjectId: '136967000000014024';
  readonly slateDnsHostnameId: '16391000000005003';
  readonly dataCenter: 'US';
  readonly accountsUrl: 'https://accounts.zoho.com';
  readonly catalystEnvironment: 'Development';
  readonly verdict: 'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED';
  readonly stage2AuthStatus: 'PENDING_INDEPENDENT_AUTHORIZATION';
  readonly productionPromotionStatus: 'NOT_PROMOTED';
  readonly remoteOperationsExecutedDuringClosure: 0;
  readonly automatedRemoteQueriesExecuted: false;
  readonly evidenceClassification: {
    readonly consoleObservedByOperator: readonly string[];
    readonly operatorReportedConfiguration: readonly string[];
    readonly localCodeValidations: readonly string[];
    readonly notExecutedInThisClosure: readonly string[];
  };
  readonly tables: readonly ProvisionedTableRecord[];
}

export const PHASE_5_2_STAGE_1_DEV_INVENTORY: Phase52Stage1NoSQLInventory = {
  phase: '5.2-stage-1',
  stageTitle: 'NoSQL Development Provisioning Closure',
  projectName: 'Project-Rainfall',
  catalystProjectId: '136967000000014024',
  slateDnsHostnameId: '16391000000005003',
  dataCenter: 'US',
  accountsUrl: 'https://accounts.zoho.com',
  catalystEnvironment: 'Development',
  verdict: 'PHASE_5_2_STAGE_1_NOSQL_PROVISIONING_COMPLETED',
  stage2AuthStatus: 'PENDING_INDEPENDENT_AUTHORIZATION',
  productionPromotionStatus: 'NOT_PROMOTED',
  remoteOperationsExecutedDuringClosure: 0,
  automatedRemoteQueriesExecuted: false,
  evidenceClassification: {
    consoleObservedByOperator: [
      'Las 5 tablas muestran 0 registros y 0 bytes de almacenamiento en Catalyst Console (Development).',
      'Los 8 índices secundarios globales figuran en estado Active con 0 elementos y 0 bytes reportados.',
      'Los 5 Table IDs y 8 Index IDs fueron registrados desde las propiedades de tabla e índice en Catalyst Console.',
    ],
    operatorReportedConfiguration: [
      'El operador confirmó la creación sin datos de prueba.',
      'El operador confirmó que TTL en AdminInvitations y SystemControl fue configurado con atributo ttlEpochSec y tipo Number.',
      'Las definiciones de Partition Key, Sort Key, Additional Sort Keys y proyecciones coinciden con lo comunicado.',
    ],
    localCodeValidations: [
      'Conciliación exacta 1:1 de las 5 tablas, 8 GSIs, 11 columnas de Users.GSI_Directory y reglas TTL contra TABLE_SCHEMA_REGISTRY.',
      'Verificación de unicidad sin duplicaciones ni colisiones entre los 5 Table IDs, 8 Index IDs, VIGORCORE_CATALYST_PROJECT_ID (136967000000014024) y el ID DNS de Slate (16391000000005003).',
      'Compilación TypeScript/Vite y suite completa de pruebas locales sin llamadas remotas.',
    ],
    notExecutedInThisClosure: [
      'No se ejecutaron consultas remotas automatizadas (`verify-clean-slate-provisioning.ts --live --confirm-readonly`) en este cierre documental.',
      'No se configuró Native Catalyst Authentication (Etapa 2 pendiente de autorización independiente).',
      'No se promovieron recursos a Production.',
    ],
  },
  tables: [
    {
      order: 1,
      tableName: 'Users',
      tableId: '136967000000065001',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: null,
      sortKeyType: null,
      additionalSortKeys: [],
      ttlEnabled: false,
      ttlAttributeName: null,
      ttlAttributeType: null,
      ttlTypeEvidenceOrigin: 'OPERATOR_REPORTED_CONFIG',
      reportedRows: 0,
      reportedBytes: 0,
      indexes: [
        {
          indexName: 'GSI_Email',
          indexId: '136967000000065003',
          partitionKey: 'normalizedEmail',
          partitionKeyType: 'String',
          sortKey: null,
          sortKeyType: null,
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
        {
          indexName: 'GSI_Directory',
          indexId: '136967000000067001',
          partitionKey: 'directorySegment',
          partitionKeyType: 'String',
          sortKey: 'createdAt',
          sortKeyType: 'String',
          projection: 'SPECIFIC_ATTRIBUTES',
          projectedAttributes: [
            'pk',
            'uid',
            'email',
            'displayName',
            'role',
            'roleVersion',
            'accountStatus',
            'emailVerified',
            'directorySegment',
            'createdAt',
            'lastSignInAt',
          ],
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
        {
          indexName: 'GSI_RoleStatus',
          indexId: '136967000000067004',
          partitionKey: 'role',
          partitionKeyType: 'String',
          sortKey: 'accountStatus',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
      ],
    },
    {
      order: 2,
      tableName: 'UserData',
      tableId: '136967000000067007',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: 'sk',
      sortKeyType: 'String',
      additionalSortKeys: [
        { name: 'entityType', type: 'String' },
        { name: 'updatedAt', type: 'String' },
      ],
      ttlEnabled: false,
      ttlAttributeName: null,
      ttlAttributeType: null,
      ttlTypeEvidenceOrigin: 'OPERATOR_REPORTED_CONFIG',
      reportedRows: 0,
      reportedBytes: 0,
      indexes: [
        {
          indexName: 'GSI_UserEntityDate',
          indexId: '136967000000067011',
          partitionKey: 'pk',
          partitionKeyType: 'String',
          sortKey: 'entityDateKey',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
      ],
    },
    {
      order: 3,
      tableName: 'AdminInvitations',
      tableId: '136967000000067014',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: null,
      sortKeyType: null,
      additionalSortKeys: [],
      ttlEnabled: true,
      ttlAttributeName: 'ttlEpochSec',
      ttlAttributeType: 'Number',
      ttlTypeEvidenceOrigin: 'OPERATOR_REPORTED_CONFIG',
      reportedRows: 0,
      reportedBytes: 0,
      indexes: [
        {
          indexName: 'GSI_InviteEmailStatus',
          indexId: '136967000000067016',
          partitionKey: 'emailNormalized',
          partitionKeyType: 'String',
          sortKey: 'status',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
      ],
    },
    {
      order: 4,
      tableName: 'AuditLogs',
      tableId: '136967000000067021',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: 'sk',
      sortKeyType: 'String',
      additionalSortKeys: [
        { name: 'action', type: 'String' },
        { name: 'timestamp', type: 'String' },
      ],
      ttlEnabled: false,
      ttlAttributeName: null,
      ttlAttributeType: null,
      ttlTypeEvidenceOrigin: 'OPERATOR_REPORTED_CONFIG',
      reportedRows: 0,
      reportedBytes: 0,
      indexes: [
        {
          indexName: 'GSI_AuditActor',
          indexId: '136967000000067025',
          partitionKey: 'actorUid',
          partitionKeyType: 'String',
          sortKey: 'timestamp',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
        {
          indexName: 'GSI_AuditTarget',
          indexId: '136967000000067028',
          partitionKey: 'targetUid',
          partitionKeyType: 'String',
          sortKey: 'timestamp',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
        {
          indexName: 'GSI_GlobalChronology',
          indexId: '136967000000067031',
          partitionKey: 'auditPeriodBucket',
          partitionKeyType: 'String',
          sortKey: 'globalChronologyKey',
          sortKeyType: 'String',
          projection: 'ALL',
          projectedAttributes: null,
          reportedStatus: 'Active',
          reportedItems: 0,
          reportedBytes: 0,
        },
      ],
    },
    {
      order: 5,
      tableName: 'SystemControl',
      tableId: '136967000000067034',
      partitionKey: 'pk',
      partitionKeyType: 'String',
      sortKey: null,
      sortKeyType: null,
      additionalSortKeys: [],
      ttlEnabled: true,
      ttlAttributeName: 'ttlEpochSec',
      ttlAttributeType: 'Number',
      ttlApplicationRestriction:
        'TTL permitido exclusivamente en CTRL#SAGA#<idempotencyKey> y SESSION#<sid>; prohibido en CTRL#BOOTSTRAP y CTRL#SUPERADMIN_COUNT.',
      ttlTypeEvidenceOrigin: 'OPERATOR_REPORTED_CONFIG',
      reportedRows: 0,
      reportedBytes: 0,
      indexes: [],
    },
  ],
};

export interface Stage1InventoryValidationResult {
  readonly passed: boolean;
  readonly tableCount: number;
  readonly indexCount: number;
  readonly uniqueResourceIdCount: number;
  readonly mismatches: readonly string[];
}

export function validatePhase52Stage1Inventory(
  inventory: Phase52Stage1NoSQLInventory = PHASE_5_2_STAGE_1_DEV_INVENTORY
): Stage1InventoryValidationResult {
  const mismatches: string[] = [];
  const seenIds = new Map<string, string>([
    [inventory.catalystProjectId, 'VIGORCORE_CATALYST_PROJECT_ID'],
    [inventory.slateDnsHostnameId, 'SLATE_DNS_ID'],
  ]);

  const registerId = (id: string, label: string) => {
    if (!/^1369670000000\d{5}$/.test(id)) {
      mismatches.push(`Resource '${label}' ID '${id}' does not match Project-Rainfall 18-digit prefix 1369670000000*.`);
    }
    const existing = seenIds.get(id);
    if (existing) {
      mismatches.push(`Duplicate Catalyst ID '${id}' between '${existing}' and '${label}'.`);
    } else {
      seenIds.set(id, label);
    }
  };

  if (inventory.tables.length !== 5) {
    mismatches.push(`Expected 5 tables, got ${inventory.tables.length}.`);
  }

  let totalIndexes = 0;
  const expectedOrder: TableName[] = [
    'Users',
    'UserData',
    'AdminInvitations',
    'AuditLogs',
    'SystemControl',
  ];

  if (JSON.stringify(inventory.tables.map(t => t.tableName)) !== JSON.stringify(expectedOrder)) {
    mismatches.push(`Table order mismatch against canonical order [${expectedOrder.join(', ')}].`);
  }

  for (const tbl of inventory.tables) {
    registerId(tbl.tableId, `Table:${tbl.tableName}`);
    const ref = TABLE_SCHEMA_REGISTRY[tbl.tableName];
    if (!ref) {
      mismatches.push(`Unknown table '${tbl.tableName}' not present in TABLE_SCHEMA_REGISTRY.`);
      continue;
    }

    if (tbl.partitionKey !== ref.partitionKey || tbl.partitionKeyType !== ref.partitionKeyType) {
      mismatches.push(`Table '${tbl.tableName}' PK mismatch.`);
    }
    if (tbl.sortKey !== ref.sortKey || (tbl.sortKey ? tbl.sortKeyType !== ref.sortKeyType : tbl.sortKeyType !== null)) {
      mismatches.push(`Table '${tbl.tableName}' primary SK mismatch.`);
    }
    if (JSON.stringify(tbl.additionalSortKeys) !== JSON.stringify(ref.additionalSortKeys)) {
      mismatches.push(`Table '${tbl.tableName}' additionalSortKeys mismatch.`);
    }

    const expectedTtl = Boolean(ref.ttlAttribute);
    if (
      tbl.ttlEnabled !== expectedTtl ||
      (expectedTtl
        ? tbl.ttlAttributeName !== ref.ttlAttribute?.name || tbl.ttlAttributeType !== ref.ttlAttribute?.type
        : tbl.ttlAttributeName !== null || tbl.ttlAttributeType !== null)
    ) {
      mismatches.push(`Table '${tbl.tableName}' TTL mismatch.`);
    }

    if (tbl.reportedRows !== 0 || tbl.reportedBytes !== 0) {
      mismatches.push(`Table '${tbl.tableName}' is not empty (${tbl.reportedRows} rows, ${tbl.reportedBytes} bytes).`);
    }

    if (tbl.indexes.length !== ref.secondaryIndexes.length) {
      mismatches.push(`Table '${tbl.tableName}' index count mismatch.`);
    }

    for (const idx of tbl.indexes) {
      totalIndexes++;
      registerId(idx.indexId, `Index:${tbl.tableName}.${idx.indexName}`);
      const refIdx = ref.secondaryIndexes.find(g => g.indexName === idx.indexName);
      if (!refIdx) {
        mismatches.push(`Index '${tbl.tableName}.${idx.indexName}' missing in TABLE_SCHEMA_REGISTRY.`);
        continue;
      }
      if (
        idx.partitionKey !== refIdx.partitionKey ||
        idx.partitionKeyType !== refIdx.partitionKeyType ||
        idx.sortKey !== (refIdx.sortKey ?? null) ||
        idx.sortKeyType !== (refIdx.sortKeyType ?? null) ||
        idx.projection !== refIdx.projection ||
        JSON.stringify(idx.projectedAttributes ?? null) !== JSON.stringify(refIdx.projectedAttributes ?? null)
      ) {
        mismatches.push(`Index '${tbl.tableName}.${idx.indexName}' definition mismatch against TABLE_SCHEMA_REGISTRY.`);
      }
      if (idx.reportedStatus !== 'Active' || idx.reportedItems !== 0 || idx.reportedBytes !== 0) {
        mismatches.push(`Index '${tbl.tableName}.${idx.indexName}' status/emptiness check failed.`);
      }
    }
  }

  if (totalIndexes !== 8) {
    mismatches.push(`Expected 8 GSIs, found ${totalIndexes}.`);
  }

  return {
    passed: mismatches.length === 0,
    tableCount: inventory.tables.length,
    indexCount: totalIndexes,
    uniqueResourceIdCount: seenIds.size - 2, // excluding project + slate reference IDs -> 13 NoSQL IDs
    mismatches,
  };
}
