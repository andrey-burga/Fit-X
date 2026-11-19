/**
 * Classification: PASS-UNIT / PASS-MOCK
 * Phase 4.1 Read-Only Post-Provisioning Verification Suite.
 * Zero remote Catalyst calls. Zero write operations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeCleanSlateEmptyAndContracts,
  runOfflineSelfCheck,
  verifySchemaAgainstRegistry,
  type IReadOnlyNoSQLTableProbe,
  type IReadOnlyProvisioningEnvironment,
  type ReadOnlyNoSQLResponseLike,
  type RealNoSQLTableMeta,
} from '../src/provisioning/postProvisioningVerifier.js';
import { runVerifierCli } from '../scripts/verify-clean-slate-provisioning.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import { KeyBuilders, TABLE_SCHEMA_REGISTRY, type TableName } from '../src/types/cleanSlate.js';

function buildCanonicalMockTableMeta(): RealNoSQLTableMeta[] {
  return (Object.keys(TABLE_SCHEMA_REGISTRY) as TableName[]).map((name, idx) => {
    const spec = TABLE_SCHEMA_REGISTRY[name];
    return {
      id: String(1000 + idx),
      name: spec.tableName,
      status: 'ONLINE',
      partition_key: {
        column_name: spec.partitionKey,
        data_type: spec.partitionKeyType === 'String' ? 'S' : 'N',
      },
      ...(spec.sortKey
        ? {
            sort_key: {
              column_name: spec.sortKey,
              data_type: 'S',
            },
          }
        : {}),
      additional_sort_keys: spec.additionalSortKeys.map(k => ({
        column_name: k.name,
        data_type: k.type === 'String' ? 'S' : 'N',
      })),
      ttl_enabled: Boolean(spec.ttlAttribute),
      ...(spec.ttlAttribute ? { ttl_attribute: spec.ttlAttribute.name } : {}),
      metrics: { item_count: 0 },
      global_index: spec.secondaryIndexes.map((gsi, gIdx) => ({
        id: `${1000 + idx}-gsi-${gIdx}`,
        name: gsi.indexName,
        status: 'ONLINE',
        partition_key: {
          column_name: gsi.partitionKey,
          data_type: gsi.partitionKeyType === 'String' ? 'S' : 'N',
        },
        ...(gsi.sortKey
          ? {
              sort_key: {
                column_name: gsi.sortKey,
                data_type: gsi.sortKeyType === 'Number' ? 'N' : 'S',
              },
            }
          : {}),
        projected_attributes: {
          type:
            gsi.projection === 'SPECIFIC_ATTRIBUTES'
              ? 'include'
              : gsi.projection === 'KEYS_ONLY'
                ? 'keys_only'
                : 'all',
          ...(gsi.projectedAttributes
            ? { include_columns: new Set(gsi.projectedAttributes) }
            : {}),
        },
      })),
    };
  });
}

function buildReadOnlyEnvFromInMemory(
  tablesMeta: RealNoSQLTableMeta[],
  adapter: CleanSlateInMemoryNoSQLAdapter,
  authUsers: Array<{ user_id: string; email_id: string; status: string; is_confirmed: boolean }> = []
): IReadOnlyProvisioningEnvironment {
  return {
    nosql: {
      async getAllTable(): Promise<IReadOnlyNoSQLTableProbe[]> {
        return tablesMeta.map(meta => ({
          toJSON: () => meta,
          async fetchItem(req): Promise<ReadOnlyNoSQLResponseLike> {
            const firstKeyObj = Array.isArray(req.keys) ? req.keys[0] : req.keys;
            const rawKey = typeof (firstKeyObj as any).to === 'function' ? (firstKeyObj as any).to() : firstKeyObj;
            const item = await adapter.fetchItem(meta.name as TableName, { pk: rawKey.pk, sk: rawKey.sk }, {
              consistent_read: req.consistent_read,
            });
            return {
              get: item ? [{ status: 'Success', item: { to: () => item } }] : [],
            };
          },
          async queryTable(q): Promise<ReadOnlyNoSQLResponseLike> {
            const pkAttrCond = q.key_condition.group
              ? q.key_condition.group.find(c => Boolean(c.value))
              : q.key_condition;
            const pkRaw = pkAttrCond?.value?.S ?? '';
            const res = await adapter.queryTable(meta.name as TableName, {
              partitionKeyValue: pkRaw,
              consistent_read: q.consistent_read,
              limit: q.limit,
            });
            return {
              get: res.items.map(it => ({ status: 'Success', item: { to: () => it } })),
            };
          },
          async queryIndex(indexId, q): Promise<ReadOnlyNoSQLResponseLike> {
            const pkAttrCond = q.key_condition.group
              ? q.key_condition.group.find(c => Boolean(c.value))
              : q.key_condition;
            const pkRaw = pkAttrCond?.value?.S ?? '';
            const res = await adapter.queryIndex(meta.name as TableName, {
              indexName: indexId,
              partitionKeyValue: pkRaw,
              consistent_read: q.consistent_read,
              limit: q.limit,
            });
            return {
              get: res.items.map(it => ({ status: 'Success', item: { to: () => it } })),
            };
          },
        }));
      },
    },
    auth: {
      async getAllUsers() {
        return authUsers;
      },
    },
  };
}

test('[PASS-UNIT] runOfflineSelfCheck validates 5-table freeze, 8 GSIs, Catalyst limits, consistent_read=true & 0 writes', () => {
  const report = runOfflineSelfCheck();
  assert.equal(report.verdict, 'PASS_SELF_CHECK');
  assert.equal(report.writeOperationsExecuted, 0);
  assert.equal(report.tablesExpected.length, 5);
  assert.equal(report.discrepancies.length, 0);
  assert.ok(report.checks.length >= 14);
  assert.ok(report.checks.every(c => c.passed));
  assert.ok(report.manualConsoleChecksRequired.length >= 4);
  assert.ok(report.sdkLimitations.length >= 2);
});

test('[PASS-MOCK] probeCleanSlateEmptyAndContracts passes on valid empty 5-table cluster + 0 auth users with ZERO writes', async () => {
  const adapter = new CleanSlateInMemoryNoSQLAdapter();
  const meta = buildCanonicalMockTableMeta();
  const env = buildReadOnlyEnvFromInMemory(meta, adapter, []);

  const report = await probeCleanSlateEmptyAndContracts(env, {
    now: new Date('2026-11-14T10:00:00.000Z'),
  });

  assert.equal(report.verdict, 'PASS_READONLY_CLEAN_SLATE');
  assert.equal(report.writeOperationsExecuted, 0);
  assert.equal(adapter.updatePayloadAuditTrail.length, 0);
  assert.equal(report.authUsersCount, 0);
  assert.ok(report.readProbesExecuted >= 20);
  assert.equal(report.discrepancies.length, 0);
  assert.ok(report.checks.every(c => c.passed));
  assert.ok(adapter.fetchAuditTrail.every(f => f.consistent_read === true));
  assert.ok(adapter.queryAuditTrail.every(q => q.consistent_read === true));
});

test('[PASS-MOCK] verifySchemaAgainstRegistry accepts JSON-deserialized array include_columns and detects schema/TTL/GSI/extra-table drift', () => {
  // Valid with Array include_columns (matching JSON over transport)
  const validArrMeta = buildCanonicalMockTableMeta();
  const usersMeta = validArrMeta.find(t => t.name === 'Users')!;
  const dirGsi = usersMeta.global_index.find(g => g.name === 'GSI_Directory')!;
  (dirGsi.projected_attributes as any).include_columns = Array.from(
    dirGsi.projected_attributes.include_columns!
  );
  const okRes = verifySchemaAgainstRegistry(validArrMeta);
  assert.equal(okRes.discrepancies.length, 0);

  // Missing table + extra table
  const missingAndExtra = buildCanonicalMockTableMeta().filter(t => t.name !== 'AuditLogs');
  missingAndExtra.push({
    ...buildCanonicalMockTableMeta()[0],
    id: '9999',
    name: 'LegacyMigratedTable',
  });
  const missingRes = verifySchemaAgainstRegistry(missingAndExtra);
  assert.ok(missingRes.discrepancies.some(d => d.includes('LegacyMigratedTable')));
  assert.ok(missingRes.discrepancies.some(d => d.includes('AuditLogs')));

  // Wrong TTL on SystemControl and unexpected SK on Users
  const driftMeta = buildCanonicalMockTableMeta();
  const sysMeta = driftMeta.find(t => t.name === 'SystemControl')!;
  sysMeta.ttl_attribute = 'validAfterSec';
  const usrMeta = driftMeta.find(t => t.name === 'Users')!;
  usrMeta.sort_key = { column_name: 'sk', data_type: 'S' };
  usrMeta.global_index.find(g => g.name === 'GSI_Directory')!.projected_attributes.include_columns = new Set([
    'pk',
    'uid',
  ]);

  const driftRes = verifySchemaAgainstRegistry(driftMeta);
  assert.ok(driftRes.discrepancies.some(d => d.includes('SystemControl') && d.includes('TTL')));
  assert.ok(driftRes.discrepancies.some(d => d.includes('Users') && d.includes('sort_key')));
  assert.ok(driftRes.discrepancies.some(d => d.includes('GSI_Directory') && d.includes('projection')));
});

test('[PASS-MOCK] probeCleanSlateEmptyAndContracts fails closed on any non-empty record, CTRL#BOOTSTRAP, non-zero metrics, or existing Auth users', async () => {
  // 1. Pre-existing item in SystemControl (CTRL#BOOTSTRAP)
  {
    const adapter = new CleanSlateInMemoryNoSQLAdapter();
    await adapter.insertItem('SystemControl', {
      pk: KeyBuilders.bootstrapLockPk(),
      status: 'CLAIMED',
    });
    const env = buildReadOnlyEnvFromInMemory(buildCanonicalMockTableMeta(), adapter, []);
    const report = await probeCleanSlateEmptyAndContracts(env);
    assert.equal(report.verdict, 'FAIL_NON_EMPTY_STATE');
    assert.ok(report.discrepancies.some(d => d.includes('CTRL#BOOTSTRAP')));
  }

  // 2. Pre-existing user in Users shard
  {
    const adapter = new CleanSlateInMemoryNoSQLAdapter();
    await adapter.insertItem('Users', {
      pk: KeyBuilders.userPk('u1'),
      uid: 'u1',
      directorySegment: KeyBuilders.directorySegment('u1'),
      role: 'athlete',
      accountStatus: 'active',
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    const env = buildReadOnlyEnvFromInMemory(buildCanonicalMockTableMeta(), adapter, []);
    const report = await probeCleanSlateEmptyAndContracts(env);
    assert.equal(report.verdict, 'FAIL_NON_EMPTY_STATE');
    assert.ok(report.discrepancies.some(d => d.includes('Users')));
  }

  // 3. Non-zero Catalyst Auth user count
  {
    const adapter = new CleanSlateInMemoryNoSQLAdapter();
    const env = buildReadOnlyEnvFromInMemory(buildCanonicalMockTableMeta(), adapter, [
      { user_id: 'usr_123', email_id: 'test@example.com', status: 'ACTIVE', is_confirmed: true },
    ]);
    const report = await probeCleanSlateEmptyAndContracts(env);
    assert.equal(report.verdict, 'FAIL_NON_EMPTY_STATE');
    assert.equal(report.authUsersCount, 1);
    assert.ok(report.discrepancies.some(d => d.includes('Catalyst Authentication')));
  }

  // 4. Non-zero table metrics
  {
    const adapter = new CleanSlateInMemoryNoSQLAdapter();
    const meta = buildCanonicalMockTableMeta();
    meta.find(t => t.name === 'UserData')!.metrics = { item_count: 3 };
    const env = buildReadOnlyEnvFromInMemory(meta, adapter, []);
    const report = await probeCleanSlateEmptyAndContracts(env);
    assert.equal(report.verdict, 'FAIL_NON_EMPTY_STATE');
    assert.ok(report.discrepancies.some(d => d.includes('UserData') && d.includes('item_count=3')));
  }
});

test('[PASS-UNIT] CLI verifier defaults to offline self-check and blocks --live without --confirm-readonly', async () => {
  const selfReport = await runVerifierCli([]);
  assert.equal(selfReport.verdict, 'PASS_SELF_CHECK');
  assert.equal(selfReport.mode, 'OFFLINE_SELF_CHECK');

  await assert.rejects(
    () => runVerifierCli(['--live']),
    /READONLY_CONFIRMATION_REQUIRED/
  );
});
