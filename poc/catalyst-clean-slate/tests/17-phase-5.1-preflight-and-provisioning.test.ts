/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.1 — Test Suite 17:
 * 5-Table / 8-GSI / 41-Route Reconciliation, Configuration Preflight Validator,
 * Secret Redaction, Strictly Read-Only CLI, and Real SDK Loopback Provisioning Verifier.
 *
 * NOTE ON VERIFICATION SCOPE:
 * - Zero remote Catalyst requests. Zero remote tables, indexes, or users created.
 * - All HTTP probes in this file run exclusively against `127.0.0.1:0` loopback mocks.
 * - Tests assert `[PASS-UNIT]`, `[PASS-SDK-CONTRACT]`, or `[PASS-LOOPBACK]`.
 * - Remote infrastructure (`INT-01..INT-08`, Zoho Support items) remain `PENDING-LIVE-VERIFICATION`.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ServerSessionTokenManager } from '../src/auth/cleanSlateAuthGuard.js';
import { createTableProviders } from '../src/nosql/providers/index.js';
import { CleanSlateInMemoryNoSQLAdapter } from '../src/nosql/cleanSlateEngine.js';
import {
  CATALYST_ENV_VAR_CATALOG,
  inferCatalystRegionFromApiDomain,
  runCatalystConfigPreflight,
} from '../src/provisioning/catalystConfigPreflight.js';
import {
  createReadOnlyEnvironmentFromProvider,
  EXPECTED_TABLES_ORDERED,
  probeCleanSlateEmptyAndContracts,
  runOfflineSelfCheck,
  type RealNoSQLTableMeta,
} from '../src/provisioning/postProvisioningVerifier.js';
import {
  EIGHT_GSI_COVERAGE_AUDIT,
  ROUTE_TO_SCHEMA_MAPPING,
  verifyReconciliationCompleteness,
} from '../src/provisioning/schemaReconciliationAudit.js';
import { ROUTE_CONTRACT_SPECS } from '../src/routes/routeContracts.js';
import { CatalystAdminAppProvider } from '../src/sdk/catalystSdkBridge.js';
import { TABLE_SCHEMA_REGISTRY, type TableName } from '../src/types/cleanSlate.js';
import { runVerifierCli } from '../scripts/verify-clean-slate-provisioning.js';

function buildValidEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    CATALYST_PROJECT_ID: 'proj_51_dev_9001',
    CATALYST_PROJECT_KEY: 'projkey_secret_9001_alpha_bravo',
    VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    VIGOR_ENVIRONMENT: 'development',
    CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.com',
    CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    CATALYST_ADMIN_CLIENT_ID: '1000.TESTCLIENTID51',
    CATALYST_ADMIN_CLIENT_SECRET: 'secret_oauth_51_charlie_delta',
    CATALYST_ADMIN_REFRESH_TOKEN: '1000.refresh_51_echo_foxtrot_99',
    VIGOR_SESSION_HMAC_SECRET: ServerSessionTokenManager.generateStrongSecret(32),
    VIGOR_SESSION_ACTIVE_KID: 'k1',
    VIGOR_ALLOWED_ORIGINS: 'https://fit-x-bhnatsxl.onslate.com',
    ZAID: 'zaid_public_web_app_only_01',
    ...overrides,
  };
}

function buildCanonicalMetaForProject(
  projectId: string,
  options: { mutate?: (tables: RealNoSQLTableMeta[]) => void } = {}
): RealNoSQLTableMeta[] {
  const tables: RealNoSQLTableMeta[] = EXPECTED_TABLES_ORDERED.map((name, idx) => {
    const spec = TABLE_SCHEMA_REGISTRY[name];
    return {
      id: `tbl_${100 + idx}`,
      name: spec.tableName,
      status: 'ONLINE',
      project_details: {
        id: projectId,
        project_name: 'vigorcore-clean-slate-dev',
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
        id: `gsi_${100 + idx}_${gIdx}`,
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
      })) as any,
    };
  });
  options.mutate?.(tables);
  return tables;
}

async function startReadOnlyLoopbackBaas(
  projectId: string,
  tablesMeta: RealNoSQLTableMeta[],
  options: {
    nonEmptyTableName?: TableName;
    authUsers?: Array<{ user_id: string; email_id: string; status: string; is_confirmed: boolean }>;
  } = {}
) {
  const oauthCalls: Array<{ method: string; url: string }> = [];
  const baasCalls: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }> = [];
  const writeAttempts: Array<{ method: string; url: string }> = [];

  const oauthServer = http.createServer((req, res) => {
    oauthCalls.push({ method: req.method || 'POST', url: req.url || '/' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: 'loopback_readonly_access_token_xyz',
        expires_in: 3600,
        token_type: 'Bearer',
      })
    );
  });

  const metaByIdOrName = new Map<string, RealNoSQLTableMeta>();
  for (const t of tablesMeta) {
    metaByIdOrName.set(String(t.id), t);
    metaByIdOrName.set(t.name, t);
  }

  const baasServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = req.url || '/';
      const method = (req.method || 'GET').toUpperCase();
      baasCalls.push({ method, url, headers: req.headers });

      // Record any mutation endpoint if ever invoked
      if (
        (url.endsWith('/item') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) ||
        (url.includes('/project-user') && method !== 'GET')
      ) {
        writeAttempts.push({ method, url });
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'failure', data: { error_code: 'WRITE_FORBIDDEN' } }));
        return;
      }

      if (url.endsWith('/nosqltable') && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: tablesMeta }));
        return;
      }

      const fetchMatch = url.match(/\/nosqltable\/([^/]+)\/item\/fetch$/);
      if (fetchMatch && method === 'POST') {
        const tMeta = metaByIdOrName.get(fetchMatch[1]);
        const injectNonEmpty = options.nonEmptyTableName && tMeta?.name === options.nonEmptyTableName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              size: injectNonEmpty ? 1 : 0,
              start_key: {},
              get: injectNonEmpty
                ? [{ status: 'Success', item: { pk: { S: 'UNEXPECTED_ROW' } } }]
                : [{ status: 'CriteriaMismatch' }],
            },
          })
        );
        return;
      }

      const queryMatch = url.match(/\/nosqltable\/([^/]+)(?:\/index\/([^/]+))?\/item\/query$/);
      if (queryMatch && method === 'POST') {
        const tMeta = metaByIdOrName.get(queryMatch[1]);
        const injectNonEmpty = options.nonEmptyTableName && tMeta?.name === options.nonEmptyTableName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              size: injectNonEmpty ? 1 : 0,
              start_key: {},
              get: injectNonEmpty
                ? [{ status: 'Success', item: { pk: { S: 'UNEXPECTED_ROW' } } }]
                : [],
            },
          })
        );
        return;
      }

      if (url.includes(`/project/${projectId}/project-user`) && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: options.authUsers ?? [] }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failure', message: `Unhandled loopback path: ${method} ${url}` }));
    });
  });

  await Promise.all([
    new Promise<void>(resolve => oauthServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>(resolve => baasServer.listen(0, '127.0.0.1', resolve)),
  ]);

  const oauthPort = (oauthServer.address() as any).port;
  const baasPort = (baasServer.address() as any).port;

  return {
    accountsUrl: `http://127.0.0.1:${oauthPort}`,
    apiDomain: `http://127.0.0.1:${baasPort}`,
    oauthCalls,
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

test('Phase 5.1 [PASS-UNIT] Reconciles 5 frozen tables, 8 GSIs, Phase 5.0 providers, and all 41 canonical routes with zero drift', () => {
  const completeness = verifyReconciliationCompleteness();
  assert.equal(completeness.tableCount, 5);
  assert.equal(completeness.gsiCount, 8);
  assert.equal(completeness.routeCount, ROUTE_CONTRACT_SPECS.length);
  assert.equal(completeness.routeCount, 41);
  assert.equal(completeness.mappedCount, 41);
  assert.deepEqual(completeness.missingRouteIds, []);
  assert.deepEqual(completeness.extraRouteIds, []);
  assert.deepEqual(completeness.missingGsis, []);

  // Verify Phase 5.0 table providers cover all 5 frozen tables and TTL/index contracts
  const providers = createTableProviders(new CleanSlateInMemoryNoSQLAdapter());
  assert.equal(providers.users.tableName, 'Users');
  assert.equal(providers.userData.tableName, 'UserData');
  assert.equal(providers.adminInvitations.tableName, 'AdminInvitations');
  assert.equal(providers.auditLogs.tableName, 'AuditLogs');
  assert.equal(providers.systemControl.tableName, 'SystemControl');

  // Verify exact GSI metadata alignment including Users.GSI_Directory 11 INCLUDE columns & Admin/SystemControl TTL
  assert.equal(EIGHT_GSI_COVERAGE_AUDIT.length, 8);
  const gsiDir = TABLE_SCHEMA_REGISTRY.Users.secondaryIndexes.find(g => g.indexName === 'GSI_Directory')!;
  assert.equal(gsiDir.projection, 'SPECIFIC_ATTRIBUTES');
  assert.equal(gsiDir.projectedAttributes?.length, 11);

  assert.equal(TABLE_SCHEMA_REGISTRY.AdminInvitations.ttlAttribute?.name, 'ttlEpochSec');
  assert.equal(TABLE_SCHEMA_REGISTRY.AdminInvitations.ttlAttribute?.type, 'Number');
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.ttlAttribute?.name, 'ttlEpochSec');
  assert.equal(TABLE_SCHEMA_REGISTRY.SystemControl.ttlAttribute?.type, 'Number');
  assert.equal(TABLE_SCHEMA_REGISTRY.Users.ttlAttribute, undefined);
  assert.equal(TABLE_SCHEMA_REGISTRY.UserData.ttlAttribute, undefined);
  assert.equal(TABLE_SCHEMA_REGISTRY.AuditLogs.ttlAttribute, undefined);

  // Confirm all mapped route IDs exist cleanly and reference valid tables
  const validTableSet = new Set(EXPECTED_TABLES_ORDERED);
  for (const row of ROUTE_TO_SCHEMA_MAPPING) {
    assert.ok(row.primaryTables.length >= 1);
    for (const tbl of row.primaryTables) {
      assert.ok(validTableSet.has(tbl), `Unknown table '${tbl}' on route '${row.routeId}'`);
    }
  }
});

test('Phase 5.1 [PASS-UNIT] Preflight validator validates canonical env vars, separates public vs secret vs ZAID, infers all 8 regions & redacts all secrets', () => {
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.com'), 'us');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.eu'), 'eu');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.in'), 'in');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.com.au'), 'au');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zohocloud.ca'), 'ca');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.sa'), 'sa');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.jp'), 'jp');
  assert.equal(inferCatalystRegionFromApiDomain('https://api.catalyst.zoho.ae'), 'uae');

  const env = buildValidEnv();
  const report = runCatalystConfigPreflight(env, {
    scope: 'full_server_runtime',
    expectedProjectId: 'proj_51_dev_9001',
    expectedRegion: 'us',
  });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.networkCallsExecuted, 0);
  assert.equal(report.writeOperationsExecuted, 0);
  assert.equal(report.inferredRegion, 'us');
  assert.equal(report.authModeDetected, 'refresh_token');
  assert.equal(report.targetSummary.projectId, 'proj_51_dev_9001');
  assert.equal(report.targetSummary.clientAppZaidPresent, true);
  assert.equal(report.failures.length, 0);

  // Check ZAID classification explicitly separated from server admin credentials
  const zaidCatalog = CATALYST_ENV_VAR_CATALOG.find(e => e.name === 'ZAID')!;
  assert.equal(zaidCatalog.classification, 'CLIENT_ONLY_PUBLIC');
  const zaidCheck = report.checks.find(c => c.key === 'ZAID')!;
  assert.equal(zaidCheck.classification, 'CLIENT_ONLY_PUBLIC');
  assert.equal(zaidCheck.passed, true);

  // Verify ZERO raw secrets leak anywhere in serialized report
  const serialized = JSON.stringify(report);
  for (const secretVal of [
    env.CATALYST_PROJECT_KEY!,
    env.CATALYST_ADMIN_CLIENT_SECRET!,
    env.CATALYST_ADMIN_REFRESH_TOKEN!,
    env.VIGOR_SESSION_HMAC_SECRET!,
  ]) {
    assert.equal(serialized.includes(secretVal), false, `Secret leaked in preflight report!`);
  }
});

test('Phase 5.1 [PASS-UNIT] Preflight fails closed on missing, placeholder, mismatched env/project/region, weak HMAC, wildcard CORS & ZC_SECURE=override', () => {
  // 1. Placeholders / all-zeros rejected
  const placeholderRes = runCatalystConfigPreflight(
    buildValidEnv({
      CATALYST_PROJECT_ID: '00000000000',
      CATALYST_PROJECT_KEY: '<CATALYST_PROJECT_KEY>',
      CATALYST_ADMIN_REFRESH_TOKEN: 'YOUR_REFRESH_TOKEN',
    }),
    { scope: 'provisioning_readonly' }
  );
  assert.equal(placeholderRes.verdict, 'FAIL');
  assert.ok(placeholderRes.failures.some(f => f.key === 'CATALYST_PROJECT_ID'));
  assert.ok(placeholderRes.failures.some(f => f.key === 'CATALYST_PROJECT_KEY'));
  assert.ok(placeholderRes.failures.some(f => f.key === 'CATALYST_ADMIN_REFRESH_TOKEN'));

  // 2. Wrong project & wrong region
  const mismatchTarget = runCatalystConfigPreflight(buildValidEnv(), {
    expectedProjectId: 'proj_OTHER_999',
    expectedRegion: 'eu',
  });
  assert.equal(mismatchTarget.verdict, 'FAIL');
  assert.ok(mismatchTarget.failures.some(f => f.code === 'WRONG_PROJECT_TARGET'));
  assert.ok(mismatchTarget.failures.some(f => f.code === 'WRONG_CATALYST_REGION'));

  // 3. API domain / Accounts URL region mismatch
  const regionMismatch = runCatalystConfigPreflight(
    buildValidEnv({
      CATALYST_API_DOMAIN: 'https://api.catalyst.zoho.eu',
      CATALYST_ACCOUNTS_URL: 'https://accounts.zoho.com',
    })
  );
  assert.equal(regionMismatch.verdict, 'FAIL');
  assert.ok(regionMismatch.failures.some(f => f.code === 'REGION_ACCOUNTS_MISMATCH'));

  // 4. Environment separation (production <-> Development rejected)
  const prodCrossEnv = runCatalystConfigPreflight(
    buildValidEnv({
      VIGOR_ENVIRONMENT: 'production',
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
    })
  );
  assert.equal(prodCrossEnv.verdict, 'FAIL');
  assert.ok(prodCrossEnv.failures.some(f => f.code === 'ENVIRONMENT_SEPARATION_VIOLATION'));

  // 5. ZC_SECURE=override TLS bypass rejected, non-HTTPS rejected, wildcard CORS & weak HMAC rejected
  const insecureCfg = runCatalystConfigPreflight(
    buildValidEnv({
      ZC_SECURE: 'override',
      CATALYST_API_DOMAIN: 'http://api.catalyst.zoho.com',
      VIGOR_SESSION_HMAC_SECRET: 'too_short_not_base64url',
      VIGOR_ALLOWED_ORIGINS: '*',
    }),
    { scope: 'full_server_runtime' }
  );
  assert.equal(insecureCfg.verdict, 'FAIL');
  assert.ok(insecureCfg.failures.some(f => f.code === 'INSECURE_TLS_OVERRIDE_FORBIDDEN'));
  assert.ok(insecureCfg.failures.some(f => f.code === 'INSECURE_CATALYST_URL'));
  assert.ok(insecureCfg.failures.some(f => f.code === 'INVALID_SESSION_HMAC_SECRET'));
  assert.ok(insecureCfg.failures.some(f => f.code === 'INVALID_ALLOWED_ORIGINS'));

  // 6. Ephemeral access token forbidden in prod full_server_runtime
  const prodAccessToken = runCatalystConfigPreflight(
    buildValidEnv({
      VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Production',
      VIGOR_ENVIRONMENT: 'production',
      CATALYST_ADMIN_REFRESH_TOKEN: '',
      CATALYST_ADMIN_ACCESS_TOKEN: 'ephemeral_access_token_sample_12345',
    }),
    { scope: 'full_server_runtime' }
  );
  assert.equal(prodAccessToken.verdict, 'FAIL');
  assert.ok(prodAccessToken.failures.some(f => f.code === 'EPHEMERAL_ACCESS_TOKEN_FORBIDDEN_IN_PROD'));
});

test('Phase 5.1 [PASS-LOOPBACK] Real CatalystAdminAppProvider + NoSQL SDK read-only verifier validates 5-table/8-GSI matrices, project_details.id, 0 writes, and catches non-empty/wrong-project drift', async () => {
  const projectId = 'proj_51_loopback_01';
  const canonicalMeta = buildCanonicalMetaForProject(projectId);
  const baas = await startReadOnlyLoopbackBaas(projectId, canonicalMeta);

  try {
    const envMap = buildValidEnv({
      CATALYST_PROJECT_ID: projectId,
      CATALYST_API_DOMAIN: baas.apiDomain,
      CATALYST_ACCOUNTS_URL: baas.accountsUrl,
    });

    const adminProvider = CatalystAdminAppProvider.fromEnvironment(envMap, {
      allowInsecureLoopbackForTest: true,
    });
    const readOnlyEnv = createReadOnlyEnvironmentFromProvider(adminProvider);

    // Ensure no write methods are exposed on read-only wrapper
    const probedTables = await readOnlyEnv.nosql.getAllTable();
    assert.equal(probedTables.length, 5);
    for (const tbl of probedTables) {
      assert.equal((tbl as any).insertItems, undefined);
      assert.equal((tbl as any).updateItems, undefined);
      assert.equal((tbl as any).deleteItems, undefined);
    }

    const report = await probeCleanSlateEmptyAndContracts(readOnlyEnv, {
      expectedProjectId: projectId,
      catalystEnvironment: adminProvider.getEnvironment(),
      apiDomain: adminProvider.getApiDomain(),
      now: new Date('2026-11-17T12:00:00.000Z'),
    });

    assert.equal(report.phase, '5.1');
    assert.equal(report.verdict, 'PASS_READONLY_CLEAN_SLATE');
    assert.equal(report.writeOperationsExecuted, 0);
    assert.equal(baas.writeAttempts.length, 0);
    assert.equal(report.tableMatrix.length, 5);
    assert.equal(report.indexMatrix.length, 8);
    assert.equal(report.targetContext.projectId, projectId);
    assert.equal(report.targetContext.databaseEngine, 'Zoho Catalyst NoSQL');
    assert.equal(report.authUsersCount, 0);
    assert.equal(report.discrepancies.length, 0);
    assert.ok(report.tableMatrix.every(t => t.exists && t.partitionKeyOk && t.sortKeyOk && t.additionalSortKeysOk && t.ttlOk && t.projectDetailsMatch === true && t.emptyProbePassed));
    assert.ok(report.indexMatrix.every(i => i.exists && i.partitionKeyOk && i.sortKeyOk && i.projectionOk && i.includeColumnsOk && i.emptyProbePassed));

    // Confirm HTTP calls sent real PROJECT_ID header (projectKey) & Zoho-oauthtoken, ZERO mutations
    assert.ok(baas.oauthCalls.length >= 1);
    assert.ok(baas.baasCalls.some(c => c.url.endsWith('/nosqltable') && c.method === 'GET'));
    assert.ok(baas.baasCalls.some(c => c.url.includes('/project-user') && c.method === 'GET'));
    assert.ok(
      baas.baasCalls
        .filter(c => c.url.includes('/nosqltable'))
        .every(c => c.headers.project_id === envMap.CATALYST_PROJECT_KEY)
    );

    // Wrong project_details.id detection
    const wrongProjectReport = await probeCleanSlateEmptyAndContracts(readOnlyEnv, {
      expectedProjectId: 'proj_EXPECTED_DIFFERENT',
      catalystEnvironment: adminProvider.getEnvironment(),
      apiDomain: adminProvider.getApiDomain(),
    });
    assert.equal(wrongProjectReport.verdict, 'FAIL_SCHEMA_MISMATCH');
    assert.ok(wrongProjectReport.discrepancies.some(d => d.includes('project_details.id')));
    assert.ok(wrongProjectReport.tableMatrix.every(t => t.projectDetailsMatch === false));
  } finally {
    await baas.close();
  }

  // Non-empty table rejection over real SDK loopback
  const dirtyBaas = await startReadOnlyLoopbackBaas(projectId, canonicalMeta, {
    nonEmptyTableName: 'SystemControl',
  });
  try {
    const provider = CatalystAdminAppProvider.fromEnvironment(
      buildValidEnv({
        CATALYST_PROJECT_ID: projectId,
        CATALYST_API_DOMAIN: dirtyBaas.apiDomain,
        CATALYST_ACCOUNTS_URL: dirtyBaas.accountsUrl,
      }),
      { allowInsecureLoopbackForTest: true }
    );
    const dirtyReport = await probeCleanSlateEmptyAndContracts(
      createReadOnlyEnvironmentFromProvider(provider),
      { expectedProjectId: projectId }
    );
    assert.equal(dirtyReport.verdict, 'FAIL_NON_EMPTY_STATE');
    assert.equal(dirtyBaas.writeAttempts.length, 0);
    const sysRow = dirtyReport.tableMatrix.find(r => r.tableName === 'SystemControl')!;
    assert.equal(sysRow.emptyProbePassed, false);
  } finally {
    await dirtyBaas.close();
  }
});

test('Phase 5.1 [PASS-LOOPBACK] CLI supports zero-network --preflight, aborts invalid --live before HTTP, and passes read-only --live --confirm-readonly against loopback BaaS', async () => {
  const validEnv = buildValidEnv();

  // 1. Offline self-check (0 network, 0 writes)
  const offline = await runVerifierCli([], {});
  assert.equal(offline.verdict, 'PASS_SELF_CHECK');
  assert.equal(offline.writeOperationsExecuted, 0);
  if ('tableMatrix' in offline) {
    assert.equal(offline.tableMatrix.length, 5);
    assert.equal(offline.indexMatrix.length, 8);
  }

  // 2. --preflight pass (0 network, 0 writes, secrets redacted)
  const prePass = await runVerifierCli(['--preflight', '--full-runtime'], validEnv);
  assert.equal(prePass.verdict, 'PASS');
  assert.equal(prePass.writeOperationsExecuted, 0);
  if ('networkCallsExecuted' in prePass) {
    assert.equal(prePass.networkCallsExecuted, 0);
  }

  // 3. --preflight fail on placeholder config (0 network)
  const preFail = await runVerifierCli(['--preflight'], { CATALYST_PROJECT_ID: '00000000000' });
  assert.equal(preFail.verdict, 'FAIL');

  // 4. --live without --confirm-readonly fails closed
  await assert.rejects(() => runVerifierCli(['--live'], validEnv), /READONLY_CONFIRMATION_REQUIRED/);

  // 5. --live --confirm-readonly with bad config aborts cleanly at preflight (0 network hits!)
  const projectId = 'proj_cli_loopback_51';
  const baas = await startReadOnlyLoopbackBaas(projectId, buildCanonicalMetaForProject(projectId));
  try {
    await assert.rejects(
      () =>
        runVerifierCli(
          ['--live', '--confirm-readonly', '--allow-loopback-test'],
          buildValidEnv({
            CATALYST_PROJECT_ID: projectId,
            CATALYST_PROJECT_KEY: '<CATALYST_PROJECT_KEY>',
            CATALYST_API_DOMAIN: baas.apiDomain,
            CATALYST_ACCOUNTS_URL: baas.accountsUrl,
          })
        ),
      /PREFLIGHT_FAILED/
    );
    assert.equal(baas.baasCalls.length, 0);
    assert.equal(baas.oauthCalls.length, 0);

    // 6. --live --confirm-readonly with valid env connects strictly read-only via CatalystAdminAppProvider
    const liveReport = await runVerifierCli(
      ['--live', '--confirm-readonly', '--allow-loopback-test', '--expected-project', projectId],
      buildValidEnv({
        CATALYST_PROJECT_ID: projectId,
        CATALYST_API_DOMAIN: baas.apiDomain,
        CATALYST_ACCOUNTS_URL: baas.accountsUrl,
      })
    );
    assert.equal(liveReport.verdict, 'PASS_READONLY_CLEAN_SLATE');
    assert.equal(liveReport.writeOperationsExecuted, 0);
    assert.equal(baas.writeAttempts.length, 0);
  } finally {
    await baas.close();
  }
});

test('Phase 5.1 [PASS-UNIT] Offline runOfflineSelfCheck validates 5-table/8-GSI matrices cleanly', () => {
  const self = runOfflineSelfCheck();
  assert.equal(self.verdict, 'PASS_SELF_CHECK');
  assert.equal(self.tableMatrix.length, 5);
  assert.equal(self.indexMatrix.length, 8);
  assert.equal(self.writeOperationsExecuted, 0);
});
