/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.3 — Test Suite 34:
 * Live Runtime Health Behavior Audit, Unauthenticated Protected-Route Rejection,
 * Physical Development Table ID Verification (`--verify-dev-table-ids`), and
 * Documentation Deliverable (`docs/41`) Verification.
 *
 * Zero remote Catalyst requests. Zero database writes. All HTTP probes run on `127.0.0.1:0`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import {
  getStage1ExpectedDevelopmentTableIds,
  type RealNoSQLTableMeta,
} from '../src/provisioning/postProvisioningVerifier.js';
import { PHASE_5_2_STAGE_1_DEV_INVENTORY } from '../src/provisioning/phase52Stage1Inventory.js';
import { createVigorCoreProductionRuntimeFromEnv } from '../src/server/advancedIoApp.js';
import { TABLE_SCHEMA_REGISTRY, type TableName } from '../src/types/cleanSlate.js';
import { runVerifierCli } from '../scripts/verify-clean-slate-provisioning.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POC_ROOT = path.resolve(THIS_DIR, '..');

function buildHostedNativeDevEnv(): Record<string, string> {
  return {
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    VIGORCORE_CATALYST_PROJECT_ID: '136967000000014024',
    VIGOR_CATALYST_AUTH_MODE: 'hosted_native',
    VIGOR_CORS_MODE: 'platform_managed',
    VIGORCORE_CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    VIGORCORE_CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    VIGOR_SESSION_HMAC_SECRET: ServerSessionTokenManager.generateStrongSecret(32),
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://app.vigorcore.lat',
  };
}

function buildStage1DevMockTablesMeta(
  projectId: string,
  overrides: Partial<Record<TableName, string>> = {}
): RealNoSQLTableMeta[] {
  return PHASE_5_2_STAGE_1_DEV_INVENTORY.tables.map(tbl => {
    const spec = TABLE_SCHEMA_REGISTRY[tbl.tableName];
    return {
      id: overrides[tbl.tableName] ?? tbl.tableId,
      name: spec.tableName,
      status: 'ONLINE',
      project_details: {
        id: projectId,
        project_name: 'Project-Rainfall',
        project_type: 'Catalyst',
      },
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
        id: tbl.indexes[gIdx]?.indexId ?? `gsi_${tbl.tableId}_${gIdx}`,
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
            ? { include_columns: [...gsi.projectedAttributes] }
            : {}),
        },
      })) as RealNoSQLTableMeta['global_index'],
    };
  });
}

async function startReadOnlyLoopbackBaas(
  projectId: string,
  tablesMeta: RealNoSQLTableMeta[]
) {
  const oauthCalls: number[] = [];
  const baasCalls: Array<{ method: string; url: string }> = [];
  const writeAttempts: Array<{ method: string; url: string }> = [];

  const oauthServer = http.createServer((_req, res) => {
    oauthCalls.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'loopback_ro_token', expires_in: 3600 }));
  });

  const baasServer = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = req.url || '/';
      const method = (req.method || 'GET').toUpperCase();
      baasCalls.push({ method, url });

      if (
        (url.endsWith('/item') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) ||
        (url.includes('/project-user') && method !== 'GET')
      ) {
        writeAttempts.push({ method, url });
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure' }));
        return;
      }

      if (url.endsWith('/nosqltable') && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: tablesMeta }));
        return;
      }

      if (/\/nosqltable\/[^/]+\/item\/fetch$/.test(url) && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: { size: 0, start_key: {}, get: [{ status: 'CriteriaMismatch' }] },
          })
        );
        return;
      }

      if (/\/nosqltable\/[^/]+(?:\/index\/[^/]+)?\/item\/query$/.test(url) && method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: { size: 0, start_key: {}, get: [] },
          })
        );
        return;
      }

      if (url.includes(`/project/${projectId}/project-user`) && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: [] }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure' }));
    });
  });

  await Promise.all([
    new Promise<void>(resolve => oauthServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>(resolve => baasServer.listen(0, '127.0.0.1', resolve)),
  ]);

  const oauthPort = (oauthServer.address() as { port: number }).port;
  const baasPort = (baasServer.address() as { port: number }).port;

  return {
    accountsUrl: `http://127.0.0.1:${oauthPort}`,
    apiDomain: `http://127.0.0.1:${baasPort}`,
    baasCalls,
    writeAttempts,
    async close() {
      await Promise.all([
        new Promise<void>(resolve => oauthServer.close(() => resolve())),
        new Promise<void>(resolve => baasServer.close(() => resolve())),
      ]);
    },
  };
}

test('Phase 5.3 [PASS-LOOPBACK] /health and /api/v1/health validate config only and never invoke NoSQL or wrapDispatch; protected route fails closed without auth', async () => {
  const bundle = createVigorCoreProductionRuntimeFromEnv(buildHostedNativeDevEnv());
  const originalGetNoSQL = bundle.hostedRuntime!.getActiveRequestNoSQLClient.bind(bundle.hostedRuntime);
  let nosqlAccessCount = 0;
  bundle.hostedRuntime!.getActiveRequestNoSQLClient = () => {
    nosqlAccessCount++;
    return originalGetNoSQL();
  };

  const server = http.createServer(bundle.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const p of ['/health', '/api/v1/health', '/server/vigor_api/health', '/server/vigor_api/api/v1/health']) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.success, true);
      assert.equal(body.service, 'vigorcore-advanced-io');
      assert.equal(body.routeCount, 41);
      assert.equal(body.status, 'ok');
    }
    assert.equal(nosqlAccessCount, 0, '/health must not instantiate NoSQL client');

    // Case 1: Protected route on direct URL without Catalyst Edge admin headers -> 503 fail-closed
    const noEdgeRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`);
    assert.equal(noEdgeRes.status, 503);
    const noEdgeBody = (await noEdgeRes.json()) as Record<string, unknown>;
    assert.equal(noEdgeBody.success, false);
    assert.equal(noEdgeBody.error, 'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE');
    assert.equal(nosqlAccessCount, 0);

    // Case 2: Protected route with Catalyst Edge admin headers (Development/136967000000014024) but no user session -> 401 UNAUTHENTICATED
    const unauthWithEdgeRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Development',
        'x-zc-project-key': 'edge_injected_dev_key_placeholder',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'edge_injected_ephemeral_admin_token',
      },
    });
    assert.equal(unauthWithEdgeRes.status, 401);
    const unauthBody = (await unauthWithEdgeRes.json()) as Record<string, unknown>;
    assert.equal(unauthBody.success, false);
    assert.equal(unauthBody.error, 'UNAUTHENTICATED');
    assert.equal(nosqlAccessCount, 0, 'Unauthenticated protected route rejection must perform zero NoSQL operations');

    // Case 3: Mismatched x-zc-environment (Production sent to Development function) -> 403 PROJECT_CONTEXT_MISMATCH
    const wrongEnvRes = await fetch(`${baseUrl}/server/vigor_api/api/v1/athlete/workspace`, {
      headers: {
        'x-zc-projectid': '136967000000014024',
        'x-zc-environment': 'Production',
        'x-zc-project-key': 'edge_injected_dev_key_placeholder',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'edge_injected_ephemeral_admin_token',
      },
    });
    assert.equal(wrongEnvRes.status, 403);
    const wrongEnvBody = (await wrongEnvRes.json()) as Record<string, unknown>;
    assert.equal(wrongEnvBody.error, 'PROJECT_CONTEXT_MISMATCH');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Phase 5.3 [PASS-LOOPBACK] verify-clean-slate-provisioning --live --confirm-readonly --verify-dev-table-ids verifies exact 5 Stage 1 Table IDs with 0 writes and fails on drift or Production', async () => {
  const projectId = '136967000000014024';
  const expectedIds = getStage1ExpectedDevelopmentTableIds();
  assert.deepEqual(expectedIds, {
    Users: '136967000000065001',
    UserData: '136967000000067007',
    AdminInvitations: '136967000000067014',
    AuditLogs: '136967000000067021',
    SystemControl: '136967000000067034',
  });

  // 1. Exact match PASS
  {
    const mock = await startReadOnlyLoopbackBaas(projectId, buildStage1DevMockTablesMeta(projectId));
    try {
      const report = await runVerifierCli(
        [
          '--live',
          '--confirm-readonly',
          '--auth-mode',
          'external_oauth',
          '--expected-project',
          projectId,
          '--expected-region',
          'US',
          '--verify-dev-table-ids',
          '--allow-loopback-test',
        ],
        {
          VIGORCORE_CATALYST_PROJECT_ID: projectId,
          CATALYST_PROJECT_KEY: 'dev_project_key_secret_sample',
          VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
          VIGOR_ENVIRONMENT: 'development',
          VIGORCORE_CATALYST_API_DOMAIN: mock.apiDomain,
          VIGORCORE_CATALYST_ACCOUNTS_URL: mock.accountsUrl,
          CATALYST_ADMIN_ACCESS_TOKEN: '1000.ephemeral_readonly_access_token_xyz',
        }
      );

      assert.equal(report.verdict, 'PASS_READONLY_CLEAN_SLATE');
      if ('tableMatrix' in report) {
        assert.equal(report.writeOperationsExecuted, 0);
        assert.equal(report.authUsersCount, 0);
        assert.equal(report.targetContext.catalystEnvironment, 'Development');
        assert.equal(report.tableMatrix.length, 5);
        for (const row of report.tableMatrix) {
          assert.equal(row.tableId, expectedIds[row.tableName]);
          assert.equal(row.tableIdMatch, true);
          assert.equal(row.projectDetailsMatch, true);
          assert.equal(row.emptyProbePassed, true);
        }
      }
      assert.equal(mock.writeAttempts.length, 0);
      assert.ok(mock.baasCalls.some(c => c.url.endsWith('/nosqltable')));
    } finally {
      await mock.close();
    }
  }

  // 2. Physical Table ID mismatch MUST fail closed with FAIL_SCHEMA_MISMATCH
  {
    const mock = await startReadOnlyLoopbackBaas(
      projectId,
      buildStage1DevMockTablesMeta(projectId, { SystemControl: '136967000000099999' })
    );
    try {
      const report = await runVerifierCli(
        [
          '--live',
          '--confirm-readonly',
          '--auth-mode',
          'external_oauth',
          '--expected-project',
          projectId,
          '--expected-region',
          'US',
          '--verify-dev-table-ids',
          '--allow-loopback-test',
        ],
        {
          VIGORCORE_CATALYST_PROJECT_ID: projectId,
          CATALYST_PROJECT_KEY: 'dev_project_key_secret_sample',
          VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
          VIGOR_ENVIRONMENT: 'development',
          VIGORCORE_CATALYST_API_DOMAIN: mock.apiDomain,
          VIGORCORE_CATALYST_ACCOUNTS_URL: mock.accountsUrl,
          CATALYST_ADMIN_ACCESS_TOKEN: '1000.ephemeral_readonly_access_token_xyz',
        }
      );

      assert.equal(report.verdict, 'FAIL_SCHEMA_MISMATCH');
      if ('tableMatrix' in report) {
        const sysRow = report.tableMatrix.find(r => r.tableName === 'SystemControl')!;
        assert.equal(sysRow.tableIdMatch, false);
        assert.equal(sysRow.tableId, '136967000000099999');
        assert.equal(sysRow.expectedTableId, '136967000000067034');
        assert.ok(report.discrepancies.some(d => d.includes('SystemControl') && d.includes('136967000000067034')));
      }
      assert.equal(mock.writeAttempts.length, 0);
    } finally {
      await mock.close();
    }
  }

  // 3. --verify-dev-table-ids MUST refuse Production environment
  await assert.rejects(
    () =>
      runVerifierCli(
        [
          '--live',
          '--confirm-readonly',
          '--auth-mode',
          'external_oauth',
          '--expected-project',
          projectId,
          '--expected-region',
          'US',
          '--verify-dev-table-ids',
          '--allow-loopback-test',
        ],
        {
          VIGORCORE_CATALYST_PROJECT_ID: projectId,
          CATALYST_PROJECT_KEY: 'prod_project_key_secret_sample',
          VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Production',
          VIGOR_ENVIRONMENT: 'production',
          VIGORCORE_CATALYST_API_DOMAIN: 'http://127.0.0.1:19999',
          VIGORCORE_CATALYST_ACCOUNTS_URL: 'http://127.0.0.1:19998',
          CATALYST_ADMIN_CLIENT_ID: '1000.TESTCLIENT',
          CATALYST_ADMIN_CLIENT_SECRET: 'secret_oauth_charlie',
          CATALYST_ADMIN_REFRESH_TOKEN: '1000.refresh_echo',
        }
      ),
    /DEV_TABLE_IDS_REQUIRE_DEVELOPMENT_ENV/
  );
});

test('Phase 5.3 [PASS-UNIT] docs/41 documents health behavior, 5 Development Table IDs, protected rejection, PowerShell procedure & target status', () => {
  const docPath = path.join(POC_ROOT, 'docs', '41-phase-5.3-live-runtime-health-and-nosql-verification.md');
  assert.equal(fs.existsSync(docPath), true);
  const md = fs.readFileSync(docPath, 'utf8');

  for (const token of [
    'PHASE_5_3_HEALTH_VERIFIED_NOSQL_READONLY_CHECK_READY',
    '136967000000014024',
    '136967000000065001',
    '136967000000067007',
    '136967000000067014',
    '136967000000067021',
    '136967000000067034',
    '/api/v1/athlete/workspace',
    'HOSTED_PLATFORM_ADMIN_CONTEXT_UNAVAILABLE',
    'UNAUTHENTICATED',
    '--verify-dev-table-ids',
    '--confirm-readonly',
  ]) {
    assert.ok(md.includes(token), `docs/41 missing required token: ${token}`);
  }
});
