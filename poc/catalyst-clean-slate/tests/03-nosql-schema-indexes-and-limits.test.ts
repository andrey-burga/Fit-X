/**
 * Classification: PASS-UNIT / PASS-MOCK
 * Covers Phase 4.0.3 Blocker 2 & Blocker 3 — Real `@zcatalyst/nosql@1.0.0` Modular SDK Contracts:
 * - Scenario 9: Valid conditional `updateItems` -> real `NoSQLResponse` with `update[0].status === 'Success'`.
 * - Scenario 10: HTTP 200 with `ConditionMismatch` in `NoSQLResponse.update[0].status` aborts cleanly.
 * - Scenario 11: HTTP 200 with `CriteriaMismatch` in `NoSQLResponse.update[0].status` aborts cleanly.
 * - Scenario 12: HTTP 200 where write was not applied -> `assertCatalystUpdateApplied` rejects cleanly.
 * - Scenario 13: Serialized update payload typed & inspected directly against real `NoSQLTable['updateItems']`
 *   parameter signature (`keys` is `NoSQLItem`, `NoSQLUpdateOperationType.PUT` + `update_function: 'add' | 'subtract'`,
 *   `NoSQLOperator` lowercase enums, `negate: true` on `attribute_exists`, `return: 'NEW'`).
 * - Scenario 14: Exact `consistent_read: true` verified in serialized `NoSQLTable.fetchItem`, `queryTable`, and
 *   `queryIndex` request payloads passing through a genuine `NoSQLTable` instance from `@zcatalyst/nosql`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NoSQLItem,
  NoSQLEnum,
  NoSQLMarshall,
  NoSQLTable,
  NoSQLUpdateOperationType,
} from '@zcatalyst/nosql';
import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  KeyBuilders,
  TABLE_SCHEMA_REGISTRY,
} from '../src/types/cleanSlate.js';
import {
  buildRealFetchItemPayload,
  buildRealQueryPayload,
  buildRealUpdateItemPayload,
  CatalystLiveNoSQLAdapter,
  CleanSlateInMemoryNoSQLAdapter,
  compileRealCatalystCondition,
  validateSchemaRegistryContracts,
} from '../src/nosql/cleanSlateEngine.js';
import { assertCatalystUpdateApplied, AdminGovernanceService } from '../src/services/adminGovernanceService.js';

test('[PASS-UNIT] Physical 5-table schema freeze obeys Catalyst limits', () => {
  assert.doesNotThrow(() => validateSchemaRegistryContracts());
  assert.equal(TABLE_SCHEMA_REGISTRY.Users.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.AdminInvitations.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.sortKey, null);
  assert.equal(TABLE_SCHEMA_REGISTRY.UserData.sortKey, 'sk');
  assert.equal(TABLE_SCHEMA_REGISTRY.AuditLogs.sortKey, 'sk');

  for (const spec of Object.values(TABLE_SCHEMA_REGISTRY)) {
    const primarySk = spec.sortKey ? 1 : 0;
    const totalSk = primarySk + spec.additionalSortKeys.length;
    assert.ok(totalSk <= CATALYST_PLATFORM_LIMITS.MAX_SORT_KEYS_PER_TABLE);
    assert.ok(spec.secondaryIndexes.length <= CATALYST_PLATFORM_LIMITS.MAX_SECONDARY_INDEXES_PER_TABLE);
  }
});

test('[PASS-UNIT] Scenario 13: Real @zcatalyst/nosql INoSQLUpdateItem payload uses NoSQLItem keys, PUT+update_function, NoSQLMarshall & NoSQLOperator', () => {
  // Compile condition using real @zcatalyst/nosql types
  const compiledCond: Parameters<NoSQLTable['updateItems']>[0]['condition'] = compileRealCatalystCondition({
    type: 'and',
    conditions: [
      { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
      { type: 'equals', attr: 'version', value: 3 },
      { type: 'attribute_not_exists', attr: 'lockExpired' },
    ],
  });

  assert.equal(compiledCond.group_operator, NoSQLEnum.NoSQLConditionGroupOperator.AND);
  assert.equal(compiledCond.group?.[0].operator, NoSQLEnum.NoSQLOperator.GREATER_THAN);
  assert.deepEqual(compiledCond.group?.[0].value, NoSQLMarshall.makeNumber(1));
  assert.equal(compiledCond.group?.[1].operator, NoSQLEnum.NoSQLOperator.EQUALS);
  assert.deepEqual(compiledCond.group?.[1].value, NoSQLMarshall.makeNumber(3));
  // Real SDK has NO 'attribute_not_exists'; must emit attribute_exists + negate: true
  assert.equal(compiledCond.group?.[2].function?.function_name, 'attribute_exists');
  assert.equal(compiledCond.group?.[2].negate, true);

  // Build real INoSQLUpdateItem payload (tightly typed against NoSQLTable['updateItems'])
  const updatePayload: Parameters<NoSQLTable['updateItems']>[0] = buildRealUpdateItemPayload(
    'SystemControl',
    [{ pk: 'CTRL#SUPERADMIN_COUNT' }],
    { updatedAt: '2026-11-13T12:00:00Z' },
    {
      type: 'and',
      conditions: [
        { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
        { type: 'equals', attr: 'version', value: 3 },
      ],
    },
    { activeSuperadminCount: -1, version: 1 }
  );

  // `keys` must be a single NoSQLItem (NOT an array)
  assert.ok(updatePayload.keys instanceof NoSQLItem);
  assert.deepEqual(updatePayload.keys.toJSON(), { pk: { S: 'CTRL#SUPERADMIN_COUNT' } });
  assert.equal(updatePayload.return, 'NEW');

  // PUT update_value uses NoSQLMarshall
  assert.equal(updatePayload.update_attributes[0].operation_type, NoSQLUpdateOperationType.PUT);
  assert.deepEqual(updatePayload.update_attributes[0].attribute_path, ['updatedAt']);
  assert.deepEqual(updatePayload.update_attributes[0].update_value, NoSQLMarshall.makeString('2026-11-13T12:00:00Z'));

  // Decrement uses PUT + update_function: 'subtract' (NO invalid 'ADD' operation_type!)
  assert.equal(updatePayload.update_attributes[1].operation_type, NoSQLUpdateOperationType.PUT);
  assert.equal(updatePayload.update_attributes[1].update_function?.function_name, 'subtract');
  assert.deepEqual(updatePayload.update_attributes[1].update_function?.args[0], {
    attribute_path: ['activeSuperadminCount'],
  });
  assert.deepEqual(updatePayload.update_attributes[1].update_function?.args[1], NoSQLMarshall.makeNumber(1));

  // Increment uses PUT + update_function: 'add'
  assert.equal(updatePayload.update_attributes[2].operation_type, NoSQLUpdateOperationType.PUT);
  assert.equal(updatePayload.update_attributes[2].update_function?.function_name, 'add');

  // Multi-key conditional updateItems is strictly rejected
  assert.throws(
    () =>
      buildRealUpdateItemPayload(
        'SystemControl',
        [{ pk: 'CTRL#1' }, { pk: 'CTRL#2' }],
        { activeSuperadminCount: 1 }
      ),
    /SINGLE_ITEM_CONDITION_VIOLATION/
  );
});

test('[PASS-MOCK] Scenario 9, 10, 11 & 12: Real NoSQLResponse outcome inspection (Success, ConditionMismatch, CriteriaMismatch, HTTP 200 non-applied)', async () => {
  const db = new CleanSlateInMemoryNoSQLAdapter();
  await db.insertItem('SystemControl', { pk: 'CTRL#SUPERADMIN_COUNT', activeSuperadminCount: 2, version: 1 });

  // 9) Valid conditional update -> real NoSQLResponse instance with update[0].status === 'Success'
  const ok = await db.updateItem<{ pk: string; activeSuperadminCount: number; version: number }>(
    'SystemControl',
    { pk: 'CTRL#SUPERADMIN_COUNT' },
    { updatedAt: '2026-11-13T12:00:00Z' } as any,
    {
      type: 'and',
      conditions: [
        { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
        { type: 'equals', attr: 'version', value: 1 },
      ],
    },
    { activeSuperadminCount: -1, version: 1 }
  );
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.response.constructor.name, 'NoSQLResponse');
  assert.equal(ok.response.getResponseData()[0].status, 'Success');
  assert.equal(ok.response.update?.[0].status, 'Success');
  assert.equal(assertCatalystUpdateApplied(ok).applied, true);
  assert.equal(ok.item?.activeSuperadminCount, 1);
  assert.equal(ok.item?.version, 2);

  // 10) ConditionMismatch with HTTP 200 -> aborts cleanly
  const condFail = await db.updateItem<{ pk: string; activeSuperadminCount: number; version: number }>(
    'SystemControl',
    { pk: 'CTRL#SUPERADMIN_COUNT' },
    { updatedAt: '2026-11-13T12:01:00Z' } as any,
    { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
    { activeSuperadminCount: -1, version: 1 }
  );
  assert.equal(condFail.httpStatus, 200);
  assert.equal(condFail.response.constructor.name, 'NoSQLResponse');
  assert.equal(condFail.response.update?.[0].status, 'ConditionMismatch');
  assert.equal(assertCatalystUpdateApplied(condFail).applied, false);

  // 11) CriteriaMismatch with HTTP 200 -> aborts cleanly
  const critFail = await db.updateItem(
    'SystemControl',
    { pk: 'CTRL#NON_EXISTENT' },
    { status: 'CLAIMED' } as any
  );
  assert.equal(critFail.httpStatus, 200);
  assert.equal(critFail.response.update?.[0].status, 'CriteriaMismatch');
  assert.equal(assertCatalystUpdateApplied(critFail).applied, false);

  // 12) Injected HTTP 200 where remote write was NOT applied -> aborts cleanly
  db.injectNextUpdateFault('SystemControl', 'HTTP_200_CONDITION_MISMATCH');
  const injectedCond = await db.updateItem('SystemControl', { pk: 'CTRL#SUPERADMIN_COUNT' }, { updatedAt: 'x' } as any);
  assert.equal(injectedCond.httpStatus, 200);
  assert.equal(assertCatalystUpdateApplied(injectedCond).applied, false);
  assert.equal(assertCatalystUpdateApplied(injectedCond).status, 'ConditionMismatch');

  db.injectNextUpdateFault('SystemControl', 'HTTP_200_CRITERIA_MISMATCH');
  const injectedCrit = await db.updateItem('SystemControl', { pk: 'CTRL#SUPERADMIN_COUNT' }, { updatedAt: 'x' } as any);
  assert.equal(injectedCrit.httpStatus, 200);
  assert.equal(assertCatalystUpdateApplied(injectedCrit).applied, false);
  assert.equal(assertCatalystUpdateApplied(injectedCrit).status, 'CriteriaMismatch');
});

test('[PASS-MOCK] Scenario 14: Real NoSQLTable transport serialization passes exact `consistent_read: true` & valid INoSQLUpdateItem body', async () => {
  const capturedRequests: Array<{ method: string; path: string; data: unknown }> = [];
  const fakeHandler = {
    async send(req: { method: string; path: string; data: unknown }) {
      capturedRequests.push(structuredClone(req));
      if (req.path.endsWith('/item/fetch')) {
        return {
          data: {
            data: {
              size: 1,
              get: [{ status: 'Success', item: { pk: { S: 'USER#cat_1' }, role: { S: 'superadmin' } } }],
            },
          },
        };
      }
      if (req.path.endsWith('/item/query')) {
        return {
          data: {
            data: {
              size: 1,
              get: [{ status: 'Success', item: { pk: { S: 'USER#cat_1' }, role: { S: 'superadmin' } } }],
            },
          },
        };
      }
      return {
        data: {
          data: {
            size: 1,
            update: [{ status: 'Success', item: { pk: { S: 'CTRL#SUPERADMIN_COUNT' }, activeSuperadminCount: { N: '1' }, version: { N: '2' } } }],
          },
        },
      };
    },
  };

  // Instantiate REAL `NoSQLTable` from `@zcatalyst/nosql@1.0.0`!
  const usersTable = new NoSQLTable(fakeHandler as any, { tableId: 'Users' });
  const controlTable = new NoSQLTable(fakeHandler as any, { tableId: 'SystemControl' });
  const liveAdapter = new CatalystLiveNoSQLAdapter(name => (name === 'Users' ? usersTable : controlTable));

  const fetched = await liveAdapter.fetchItem('Users', { pk: 'USER#cat_1' }, { consistent_read: true });
  assert.equal(fetched?.role, 'superadmin');

  const queriedTable = await liveAdapter.queryTable('Users', { partitionKeyValue: 'USER#cat_1', consistent_read: true });
  assert.equal(queriedTable.items.length, 1);

  const queriedIdx = await liveAdapter.queryIndex('Users', {
    indexName: 'GSI_RoleStatus',
    partitionKeyValue: 'superadmin',
    sortKeyEquals: 'active',
    consistent_read: true,
  });
  assert.equal(queriedIdx.items.length, 1);

  const upd = await liveAdapter.updateItem(
    'SystemControl',
    { pk: 'CTRL#SUPERADMIN_COUNT' },
    { updatedAt: '2026-11-13T12:00:00Z' },
    { type: 'gt', attr: 'activeSuperadminCount', value: 1 },
    { activeSuperadminCount: -1, version: 1 }
  );
  assert.equal(upd.status, 'Success');
  assert.equal(upd.response.constructor.name, 'NoSQLResponse');

  // Inspect exact HTTP bodies serialized by `@zcatalyst/nosql` `NoSQLTable`
  const fetchReqBody = capturedRequests[0].data as Parameters<NoSQLTable['fetchItem']>[0];
  const queryTableReqBody = capturedRequests[1].data as Parameters<NoSQLTable['queryTable']>[0];
  const queryIndexReqBody = capturedRequests[2].data as Parameters<NoSQLTable['queryIndex']>[1];
  const updateReqBody = (capturedRequests[3].data as Array<Parameters<NoSQLTable['updateItems']>[0]>)[0];

  assert.equal(fetchReqBody.consistent_read, true);
  assert.equal((fetchReqBody as any).consistentRead, undefined);
  assert.equal(queryTableReqBody.consistent_read, true);
  assert.equal((queryTableReqBody as any).consistentRead, undefined);
  assert.equal(queryIndexReqBody.consistent_read, true);
  assert.equal(updateReqBody.update_attributes[1].operation_type, NoSQLUpdateOperationType.PUT);
  assert.equal(updateReqBody.update_attributes[1].update_function?.function_name, 'subtract');
});

test('[PASS-UNIT] Direct payload builders verify consistent_read snake_case field', () => {
  const fetchPayload: Parameters<NoSQLTable['fetchItem']>[0] = buildRealFetchItemPayload(
    { pk: 'USER#u1' },
    { consistent_read: true }
  );
  assert.equal(fetchPayload.consistent_read, true);

  const queryPayload: Parameters<NoSQLTable['queryTable']>[0] = buildRealQueryPayload('pk', 'sk', {
    partitionKeyValue: 'USER#u1',
    consistent_read: true,
  });
  assert.equal(queryPayload.consistent_read, true);
});

test('[PASS-MOCK] Proves Blocker 1 root cause: Catalyst insertItems IGNORES condition when no existing data is present', async () => {
  const db = new CleanSlateInMemoryNoSQLAdapter();

  const r1 = await db.insertItem(
    'SystemControl',
    { pk: KeyBuilders.bootstrapLockPk(), claimant: 'node_A' },
    { type: 'attribute_not_exists', attr: 'pk' }
  );
  assert.equal(r1.inserted, true);
  assert.equal(r1.conditionIgnoredBecauseAbsent, true);
});

test('[PASS-MOCK] GSI_Directory 4-segment distribution & shared monthly AuditLogs + cross-quarter GSI_GlobalChronology', async () => {
  const db = new CleanSlateInMemoryNoSQLAdapter();
  const admin = new AdminGovernanceService(db, undefined, () => Date.parse('2026-11-15T00:00:00Z'));

  const seenSegments = new Set<string>();
  for (let i = 1; i <= 24; i++) {
    const uid = `u_seg_${i}`;
    const seg = KeyBuilders.directorySegment(uid);
    seenSegments.add(seg);
    await db.insertItem('Users', {
      pk: `USER#${uid}`,
      uid,
      email: `${uid}@vigor.co`,
      normalizedEmail: `${uid}@vigor.co`,
      displayName: `User ${i}`,
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      directorySegment: seg,
      createdAt: `2026-11-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      secretInternalOnly: 'should_not_project',
    });
  }
  assert.equal(seenSegments.size, DIRECTORY_SEGMENTS.length);

  const actor = {
    catalystUserId: 'cat_adm',
    email: 'adm@vigor.co',
    normalizedEmail: 'adm@vigor.co',
    displayName: 'Admin',
    role: 'admin' as const,
    roleVersion: 1,
    sessionEpoch: 1,
    accountStatus: 'active' as const,
    isConfirmed: true,
  };

  const dirPage1 = await admin.listDirectoryUsers(actor, { limit: 10 });
  assert.equal(dirPage1.items.length, 10);
  assert.ok(dirPage1.nextStartKey);
  assert.equal((dirPage1.items[0] as any).secretInternalOnly, undefined);
  assert.ok(dirPage1.items[0].createdAt >= dirPage1.items[9].createdAt);

  const dirPage2 = await admin.listDirectoryUsers(actor, { limit: 10, startKey: dirPage1.nextStartKey });
  assert.equal(dirPage2.items.length, 10);
  assert.ok(dirPage1.items[9].createdAt >= dirPage2.items[0].createdAt);

  const timestamps = [
    '2026-09-10T10:00:00.000Z',
    '2026-11-05T10:00:00.000Z',
    '2026-11-22T14:00:00.000Z',
    '2027-01-08T09:00:00.000Z',
  ];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const id = `ev_${i}`;
    await db.insertItem('AuditLogs', {
      pk: KeyBuilders.auditPk(ts),
      sk: KeyBuilders.auditSk(Date.parse(ts), id),
      auditPeriodBucket: KeyBuilders.auditPeriodBucket(ts),
      globalChronologyKey: `${ts}#${id}`,
      eventId: id,
      action: 'role_changed',
      actorUid: 'cat_sa',
      actorRole: 'superadmin',
      actorEmail: 'sa@vigor.co',
      targetUid: `u_${i}`,
      timestamp: ts,
    });
  }

  const novShared = await admin.listAuditLogs(actor, { month: '2026-11' });
  assert.equal(novShared.items.length, 2);
  assert.equal(novShared.items[0].timestamp, '2026-11-22T14:00:00.000Z');

  const globalCross = await admin.listAuditLogs(actor, {
    dateRangeIso: ['2026-09-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'],
    limit: 3,
  });
  assert.equal(globalCross.items.length, 3);
  assert.ok(globalCross.nextStartKey);
});

test('[PASS-MOCK] Engine enforces 400 KB hard limit and TTL expiry filtering', async () => {
  let nowSec = 1_760_000_000;
  const db = new CleanSlateInMemoryNoSQLAdapter(() => nowSec);

  await assert.rejects(
    () =>
      db.insertItem('UserData', {
        pk: KeyBuilders.userPk('u_big'),
        sk: KeyBuilders.routineSk('rt_big'),
        payload: 'X'.repeat(405 * 1024),
      }),
    /CATALYST_ITEM_SIZE_EXCEEDED/
  );

  await db.insertItem('AdminInvitations', {
    pk: KeyBuilders.invitePk('inv_ttl'),
    inviteId: 'inv_ttl',
    emailNormalized: 'coach@vigor.co',
    targetRole: 'admin',
    status: 'pending',
    tokenHash: 'hash',
    ttlEpochSec: nowSec + 100,
  });

  assert.ok(await db.fetchItem('AdminInvitations', { pk: 'INVITE#inv_ttl' }, { consistent_read: true }));
  nowSec += 200;
  assert.equal(await db.fetchItem('AdminInvitations', { pk: 'INVITE#inv_ttl' }, { consistent_read: true }), null);
});
