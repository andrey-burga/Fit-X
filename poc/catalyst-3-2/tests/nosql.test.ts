import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryNoSQLAdapter,
  setStorageAdapterForTesting,
  NoSQLEnum,
} from '../src/nosql/catalystNosql.js';
import { TestRepository } from '../src/nosql/testRepository.js';

describe('Prueba 3 — Operaciones NoSQL Reales con prefijo POC#3.2#', () => {
  let memoryAdapter: InMemoryNoSQLAdapter;
  let repository: TestRepository;

  beforeEach(() => {
    memoryAdapter = new InMemoryNoSQLAdapter();
    setStorageAdapterForTesting(memoryAdapter);
    repository = new TestRepository('VigorCorePoc');
  });

  it('1. debe insertar un registro ficticio correctamente', async () => {
    const pk = 'POC#3.2#ITEM#001';
    const sk = 'METRIC#BENCH';

    const res = await repository.insertFictionalItem(pk, sk, {
      fictionalName: 'Fictional Metric',
      fictionalValue: 100,
    });

    expect(res.success).toBe(true);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('debe rechazar claves que no comiencen con el prefijo seguro POC#3.2#', async () => {
    await expect(
      repository.insertFictionalItem('UNSAFE#KEY', 'DATA', { test: true })
    ).rejects.toThrow(/Forbidden key/);
  });

  it('2. debe leer el registro por clave exacta', async () => {
    const pk = 'POC#3.2#ITEM#002';
    const sk = 'METRIC#SQUAT';

    await repository.insertFictionalItem(pk, sk, {
      fictionalName: 'Fictional Squat',
      fictionalValue: 140,
    });

    const res = await repository.fetchFictionalItem(pk, sk);
    expect(res.success).toBe(true);
    expect(res.item).not.toBeNull();
    expect(res.item?.fictionalName).toBe('Fictional Squat');
    expect(res.item?.fictionalValue).toBe(140);
  });

  it('3. debe realizar una actualización condicionada exitosa cuando la condición se cumple', async () => {
    const pk = 'POC#3.2#ITEM#003';
    const sk = 'CONFIG';

    await repository.insertFictionalItem(pk, sk, {
      version: 1,
      status: 'active',
    });

    // Condition: status == 'active'
    const condition = {
      attribute: ['status'],
      operator: NoSQLEnum.NoSQLOperator.EQUALS,
      value: { S: 'active' },
    };

    const res = await repository.updateFictionalItemConditional(
      pk,
      sk,
      [{ attribute: 'version', value: 2 }],
      condition
    );

    expect(res.success).toBe(true);

    const fetched = await repository.fetchFictionalItem(pk, sk);
    expect(fetched.item?.version).toBe(2);
  });

  it('4. debe rechazar una actualización cuando la condición es falsa', async () => {
    const pk = 'POC#3.2#ITEM#004';
    const sk = 'CONFIG';

    await repository.insertFictionalItem(pk, sk, {
      version: 1,
      status: 'pending',
    });

    // Condition: status == 'active' (which is false, current is 'pending')
    const condition = {
      attribute: ['status'],
      operator: NoSQLEnum.NoSQLOperator.EQUALS,
      value: { S: 'active' },
    };

    const res = await repository.updateFictionalItemConditional(
      pk,
      sk,
      [{ attribute: 'version', value: 99 }],
      condition
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('CONDITIONAL_CHECK_FAILED');

    // Verify item was not modified
    const fetched = await repository.fetchFictionalItem(pk, sk);
    expect(fetched.item?.version).toBe(1);
  });

  it('5. debe eliminar condicionalmente el registro', async () => {
    const pk = 'POC#3.2#ITEM#005';
    const sk = 'EPHEMERAL';

    await repository.insertFictionalItem(pk, sk, {
      canDelete: true,
    });

    // Condition: canDelete == true
    const condition = {
      attribute: ['canDelete'],
      operator: NoSQLEnum.NoSQLOperator.EQUALS,
      value: { BOOL: 'true' },
    };

    const res = await repository.deleteFictionalItemConditional(pk, sk, condition);
    expect(res.success).toBe(true);

    const fetched = await repository.fetchFictionalItem(pk, sk);
    expect(fetched.item).toBeNull();
  });

  it('6. debe registrar métricas y logs de auditoría para cada operación NoSQL', async () => {
    repository.clearLogs();
    const pk = 'POC#3.2#ITEM#LOG_TEST';
    const sk = 'DATA';

    await repository.insertFictionalItem(pk, sk, { val: 1 });
    await repository.fetchFictionalItem(pk, sk);

    const logs = repository.getLogs();
    expect(logs.length).toBe(2);

    expect(logs[0].operationName).toBe('INSERT_ITEM');
    expect(logs[0].result).toBe('SUCCESS');
    expect(logs[0].itemsCount).toBe(1);
    expect(logs[0].environment).toBe('LOCAL_MOCK_ENGINE');

    expect(logs[1].operationName).toBe('FETCH_ITEM');
    expect(logs[1].result).toBe('SUCCESS');
  });
});
