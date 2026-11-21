/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 5.0 — Test Suite 15:
 * Catalyst SDK Bridge, Admin/User Separation, Real `@zcatalyst/nosql` Loopback Providers & Security Checks
 *
 * NOTE ON VERIFICATION SCOPE:
 * - All network calls in this file target localhost (`127.0.0.1:0`) mocks ONLY.
 * - Tests assert `[PASS-UNIT]`, `[PASS-SDK-CONTRACT]`, or `[PASS-LOOPBACK]`.
 * - Live remote Zoho Catalyst verification (`INT-01..INT-08`) remains `PENDING-LIVE-VERIFICATION`.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { USER_STATUS } from '@zcatalyst/auth';
import { AuthGuardError } from '../src/auth/cleanSlateAuthGuard.js';
import { CatalystTimeoutError } from '../src/nosql/cleanSlateEngine.js';
import { createTableProviders } from '../src/nosql/providers/index.js';
import {
  CatalystAdminAppProvider,
  CatalystSeparatedAuthRuntime,
  inspectInstalledCatalystSdkCompatibility,
  redactSecretsFromString,
  redactSensitiveObject,
} from '../src/sdk/catalystSdkBridge.js';
import {
  CATALYST_PLATFORM_LIMITS,
  DIRECTORY_SEGMENTS,
  KeyBuilders,
  type AdminInvitationItem,
  type AuditLogItem,
  type SessionRecordItem,
  type UserAccountItem,
  type UserDataItem,
} from '../src/types/cleanSlate.js';

interface RecordedBaasCall {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function unmarshallAttr(attr: any): any {
  if (!attr || typeof attr !== 'object') return attr;
  if ('S' in attr) return attr.S;
  if ('N' in attr) return Number(attr.N);
  if ('BOOL' in attr) return Boolean(attr.BOOL);
  if ('NULL' in attr) return null;
  if ('L' in attr) return (attr.L as any[]).map(unmarshallAttr);
  if ('M' in attr) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(attr.M)) {
      out[k] = unmarshallAttr(v);
    }
    return out;
  }
  return attr;
}

function unmarshallItem(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = unmarshallAttr(v);
  }
  return out;
}

function marshallPlainValue(v: any): any {
  if (v === null) return { NULL: true };
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(marshallPlainValue) };
  if (typeof v === 'object') {
    const m: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) m[k] = marshallPlainValue(val);
    }
    return { M: m };
  }
  return { S: String(v) };
}

function marshallItem(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = marshallPlainValue(v);
  }
  return out;
}

async function startLocalMockCatalystServers() {
  const oauthRequests: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const baasCalls: RecordedBaasCall[] = [];
  const tableStores = new Map<string, Map<string, Record<string, any>>>();
  const mockUsers = new Map<string, Record<string, any>>();
  let forceNextNoSqlStatus: number | null = null;
  let forceNextUserDetailsStatus: number | null = null;

  const getStore = (table: string) => {
    let s = tableStores.get(table);
    if (!s) {
      s = new Map();
      tableStores.set(table, s);
    }
    return s;
  };

  const compositeKey = (table: string, item: Record<string, any>) =>
    table === 'UserData' || table === 'AuditLogs'
      ? `${item.pk}\u0000${item.sk}`
      : String(item.pk);

  const oauthServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      oauthRequests.push({ url: req.url || '', headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'mock_oauth_access_token_xyz_123456',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );
    });
  });

  const baasServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: any = undefined;
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
      const url = req.url || '';
      baasCalls.push({ method: req.method || 'GET', url, headers: req.headers, body });

      if (url.includes('/nosqltable/')) {
        if (forceNextNoSqlStatus !== null) {
          const st = forceNextNoSqlStatus;
          forceNextNoSqlStatus = null;
          res.writeHead(st, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'failure', data: { error_code: 'FORCED_ERROR', message: 'Forced error' } }));
          return;
        }

        const authHdr = String(req.headers.authorization || '');
        if (!authHdr.startsWith('Zoho-oauthtoken ')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { error_code: 'UNAUTHORIZED', message: 'Missing Zoho-oauthtoken' } }));
          return;
        }

        const match = url.match(/\/nosqltable\/([^/]+)(\/.*)?$/);
        const table = match?.[1] || '';
        const suffix = match?.[2] || '';
        const store = getStore(table);

        // Fetch item(s)
        if (suffix === '/item/fetch') {
          const keys = (body.keys || []) as Array<Record<string, any>>;
          const results = keys.map(k => {
            const plainKey = unmarshallItem(k);
            const found = store.get(compositeKey(table, plainKey));
            return found
              ? { status: 'Success', item: marshallItem(found) }
              : { status: 'CriteriaMismatch' };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'success',
              data: { size: results.length, start_key: {}, get: results },
            })
          );
          return;
        }

        // Insert items
        if (req.method === 'POST' && suffix === '/item') {
          const rows = Array.isArray(body) ? body : [body];
          const create = rows.map((entry: any) => {
            const plain = unmarshallItem(entry.item);
            const ck = compositeKey(table, plain);
            if (entry.condition?.function?.function_name === 'attribute_exists' && entry.condition.negate && store.has(ck)) {
              return { status: 'ConditionMismatch' };
            }
            store.set(ck, plain);
            return { status: 'Success', item: marshallItem(plain) };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: { size: create.length, start_key: {}, create } }));
          return;
        }

        // Update items
        if (req.method === 'PUT' && suffix === '/item') {
          const rows = Array.isArray(body) ? body : [body];
          const update = rows.map((entry: any) => {
            const plainKey = unmarshallItem(entry.keys);
            const ck = compositeKey(table, plainKey);
            const existing = store.get(ck);
            if (!existing) {
              return { status: 'CriteriaMismatch' };
            }
            const next = { ...existing };
            for (const op of entry.update_attributes || []) {
              const attr = op.attribute_path?.[0];
              if (!attr) continue;
              if (op.operation_type === 'DELETE') {
                delete next[attr];
              } else if (op.update_function) {
                const fn = op.update_function.function_name;
                const delta = Number(unmarshallAttr(op.update_function.args[1]));
                next[attr] = Number(next[attr] ?? 0) + (fn === 'subtract' ? -delta : delta);
              } else if (op.update_value !== undefined) {
                next[attr] = unmarshallAttr(op.update_value);
              }
            }
            // Check simple equality conditions for contract fidelity
            if (entry.condition?.operator === 'equals') {
              const attr = entry.condition.attribute?.[0];
              const expected = unmarshallAttr(entry.condition.value);
              if (existing[attr] !== expected) {
                return { status: 'ConditionMismatch' };
              }
            } else if (entry.condition?.group_operator === 'and') {
              for (const sub of entry.condition.group || []) {
                if (sub.operator === 'equals') {
                  const attr = sub.attribute?.[0];
                  const expected = unmarshallAttr(sub.value);
                  if (existing[attr] !== expected) return { status: 'ConditionMismatch' };
                }
                if (sub.operator === 'greater_than') {
                  const attr = sub.attribute?.[0];
                  const minVal = Number(unmarshallAttr(sub.value));
                  if (Number(existing[attr] ?? 0) <= minVal) return { status: 'ConditionMismatch' };
                }
              }
            }
            store.set(ck, next);
            return { status: 'Success', item: marshallItem(next), old_item: marshallItem(existing) };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: { size: update.length, start_key: {}, update } }));
          return;
        }

        // Delete items
        if (req.method === 'DELETE' && suffix === '/item') {
          const rows = Array.isArray(body) ? body : [body];
          const del = rows.map((entry: any) => {
            const plainKey = unmarshallItem(entry.keys);
            const existed = store.delete(compositeKey(table, plainKey));
            return { status: existed ? 'Success' : 'CriteriaMismatch' };
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: { size: del.length, start_key: {}, delete: del } }));
          return;
        }

        // Query table or secondary index
        if (suffix === '/item/query' || suffix.startsWith('/index/')) {
          const indexMatch = suffix.match(/^\/index\/([^/]+)\/item\/query$/);
          const indexName = indexMatch?.[1];
          const allItems = Array.from(store.values());

          // Extract PK equals & optional SK condition from key_condition
          let pkAttr = 'pk';
          let pkVal: string | undefined;
          let skAttr: string | undefined;
          let skOp: string | undefined;
          let skVal: any;

          const kc = body.key_condition;
          const clauses = kc?.group ? kc.group : kc ? [kc] : [];
          for (const c of clauses) {
            const attr = c.attribute?.[0];
            if (!pkVal) {
              pkAttr = attr;
              pkVal = String(unmarshallAttr(c.value));
            } else {
              skAttr = attr;
              skOp = c.operator;
              skVal = unmarshallAttr(c.value);
            }
          }

          let matches = allItems.filter(it => String(it[pkAttr] ?? '') === String(pkVal ?? ''));
          if (skAttr && skOp) {
            matches = matches.filter(it => {
              const v = String(it[skAttr!] ?? '');
              if (skOp === 'equals') return v === String(skVal);
              if (skOp === 'begins_with') return v.startsWith(String(skVal));
              if (skOp === 'between' && Array.isArray(skVal)) return v >= String(skVal[0]) && v <= String(skVal[1]);
              return true;
            });
          }

          // Emulate GSI_Directory SPECIFIC_ATTRIBUTES projection
          if (table === 'Users' && indexName === 'GSI_Directory') {
            const projected = [
              'pk', 'uid', 'email', 'displayName', 'role', 'roleVersion',
              'accountStatus', 'emailVerified', 'directorySegment', 'createdAt', 'lastSignInAt',
            ];
            matches = matches.map(m => {
              const p: Record<string, any> = {};
              for (const col of projected) {
                if (m[col] !== undefined) p[col] = m[col];
              }
              return p;
            });
          }

          matches.sort((a, b) => compositeKey(table, a).localeCompare(compositeKey(table, b)));
          let startIdx = 0;
          if (body.start_key) {
            const skPlain = unmarshallItem(body.start_key);
            const idx = matches.findIndex(m => compositeKey(table, m) === compositeKey(table, skPlain));
            if (idx >= 0) startIdx = idx + 1;
          }
          const limit = Number(body.limit || 100);
          const slice = matches.slice(startIdx, startIdx + limit);
          const hasMore = startIdx + slice.length < matches.length;
          const nextCursorObj = hasMore
            ? marshallItem({
                pk: slice[slice.length - 1].pk,
                ...(slice[slice.length - 1].sk ? { sk: slice[slice.length - 1].sk } : {}),
              })
            : {};

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'success',
              data: {
                size: slice.length,
                start_key: nextCursorObj,
                get: slice.map(item => ({ status: 'Success', item: marshallItem(item) })),
              },
            })
          );
          return;
        }
      }

      // UserManagement endpoints
      if (url.endsWith('/project-user/current')) {
        const u = Array.from(mockUsers.values())[0];
        if (!u) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { error_code: 'NO_USER', message: 'Not found' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: u }));
        return;
      }

      const userMatch = url.match(/\/project-user\/([^/?]+)(?:\/(enable|disable))?$/);
      if (userMatch) {
        const uid = userMatch[1];
        const action = userMatch[2];
        if (forceNextUserDetailsStatus !== null && !action) {
          const st = forceNextUserDetailsStatus;
          forceNextUserDetailsStatus = null;
          res.writeHead(st, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { error_code: 'BAAS_ERROR', message: 'Forced BaaS error' } }));
          return;
        }
        const user = mockUsers.get(uid);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: { error_code: 'NOT_FOUND', message: 'User not found' } }));
          return;
        }
        if (action) {
          user.status = action === 'disable' ? 'DISABLED' : 'ACTIVE';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', data: user }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: user }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { error_code: 'UNKNOWN_ROUTE', message: url } }));
    });
  });

  await new Promise<void>(resolve => oauthServer.listen(0, '127.0.0.1', () => resolve()));
  await new Promise<void>(resolve => baasServer.listen(0, '127.0.0.1', () => resolve()));

  const oauthAddr = oauthServer.address() as { port: number };
  const baasAddr = baasServer.address() as { port: number };

  return {
    oauthOrigin: `http://127.0.0.1:${oauthAddr.port}`,
    baasOrigin: `http://127.0.0.1:${baasAddr.port}`,
    oauthRequests,
    baasCalls,
    mockUsers,
    tableStores,
    setForceNextNoSqlStatus: (s: number) => {
      forceNextNoSqlStatus = s;
    },
    setForceNextUserDetailsStatus: (s: number) => {
      forceNextUserDetailsStatus = s;
    },
    close: async () => {
      await Promise.all([
        new Promise<void>(r => oauthServer.close(() => r())),
        new Promise<void>(r => baasServer.close(() => r())),
      ]);
    },
  };
}

test('Phase 5.0 [PASS-SDK-CONTRACT] Verifies installed SDK defect vs CatalystAdminAppProvider OAuth injection', async () => {
  const report = inspectInstalledCatalystSdkCompatibility();
  assert.equal(report.packages['@zcatalyst/auth-admin'], '1.1.0');
  assert.equal(report.packages['@zcatalyst/nosql'], '1.0.0');
  assert.equal(report.applicationCustomCredentialBugVerified, true);

  // Reproduce raw @zcatalyst/auth-admin bug directly: ApplicationCustomCredential omits Authorization header
  const rawDiag = await CatalystAdminAppProvider.verifyRawSdkCustomInitOmitsAuthHeader({
    projectId: 'proj_test_12345',
    accessToken: 'raw_access_token_sample',
  });
  assert.equal(rawDiag.credentialConstructorName, 'ApplicationCustomCredential');
  assert.equal(rawDiag.hasAuthorizationHeaderOnRawCustomInit, false);

  // Verify CatalystAdminAppProvider injects real Zoho-oauthtoken header from RefreshTokenCredential
  const servers = await startLocalMockCatalystServers();
  try {
    const provider = new CatalystAdminAppProvider({
      projectId: '99887766',
      projectKey: 'pk_secret_val_99',
      catalystEnvironment: 'Development',
      vigorEnvironment: 'test',
      apiDomain: servers.baasOrigin,
      accountsUrl: servers.oauthOrigin,
      clientId: '1000.TESTCLIENTID',
      clientSecret: 'super_secret_oauth_client_123',
      refreshToken: '1000.refresh_token_secret_456',
      allowInsecureLoopbackForTest: true,
    });

    const authReq: Record<string, unknown> = { headers: {} };
    await provider.getAdminApp().authenticateRequest(authReq);
    const hdrs = authReq.headers as Record<string, string>;
    assert.equal(hdrs.Authorization, 'Zoho-oauthtoken mock_oauth_access_token_xyz_123456');
    assert.equal(servers.oauthRequests.length, 1);
    assert.ok(servers.oauthRequests[0].url.includes('/oauth/v2/token'));
    assert.equal(provider.getAppName(), 'vigorcore-admin');

    // Secret redaction checks
    const summaryJson = JSON.stringify(provider);
    assert.equal(summaryJson.includes('super_secret_oauth_client_123'), false);
    assert.equal(summaryJson.includes('1000.refresh_token_secret_456'), false);
    assert.equal(summaryJson.includes('pk_secret_val_99'), false);

    const leakedErr = provider.redactErrorMessage(
      new Error('Failed with Bearer abc.def and Zoho-oauthtoken secretTok and super_secret_oauth_client_123')
    );
    assert.equal(leakedErr.includes('secretTok'), false);
    assert.equal(leakedErr.includes('super_secret_oauth_client_123'), false);
    assert.ok(leakedErr.includes('[REDACTED]'));

    const redactedObj = redactSensitiveObject({
      client_secret: 'abc',
      nested: { Authorization: 'Zoho-oauthtoken t123', safe: 'ok' },
    });
    assert.equal((redactedObj as any).client_secret, '[REDACTED]');
    assert.equal((redactedObj as any).nested.Authorization, '[REDACTED]');
    assert.equal((redactedObj as any).nested.safe, 'ok');

    // Credential rotation
    const rotated = provider.rotateCredentials({
      projectId: '99887766',
      projectKey: 'pk_secret_rotated_100',
      catalystEnvironment: 'Development',
      vigorEnvironment: 'test',
      apiDomain: servers.baasOrigin,
      accountsUrl: servers.oauthOrigin,
      authMode: 'access_token',
      accessToken: 'rotated_access_token_999',
      allowInsecureLoopbackForTest: true,
    });
    assert.equal(rotated.credentialVersion, 2);
    assert.equal(rotated.authMode, 'access_token');
    assert.equal(rotated.hasProjectKey, true);
  } finally {
    await servers.close();
  }
});

test('Phase 5.0 [PASS-UNIT] Admin provider fails closed on missing creds, projectKey, placeholders, and environment mismatches', () => {
  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        CATALYST_PROJECT_ID: '',
        CATALYST_PROJECT_KEY: 'valid_proj_key',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
      }),
    /MISSING_CATALYST_ADMIN_CONFIG/
  );

  // Missing CATALYST_PROJECT_KEY must fail closed (preventing Invalid value "undefined" for header "PROJECT_ID")
  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        CATALYST_PROJECT_ID: '123456',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'development',
        CATALYST_ADMIN_CLIENT_ID: '1000.abc',
        CATALYST_ADMIN_CLIENT_SECRET: 'real_secret_val',
        CATALYST_ADMIN_REFRESH_TOKEN: '1000.rtok',
      }),
    /MISSING_CATALYST_ADMIN_CONFIG.*CATALYST_PROJECT_KEY/
  );

  // Placeholder CATALYST_PROJECT_KEY must fail closed
  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        CATALYST_PROJECT_ID: '123456',
        CATALYST_PROJECT_KEY: 'YOUR_PROJECT_KEY',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'development',
        CATALYST_ADMIN_CLIENT_ID: '1000.abc',
        CATALYST_ADMIN_CLIENT_SECRET: 'real_secret_val',
        CATALYST_ADMIN_REFRESH_TOKEN: '1000.rtok',
      }),
    /PLACEHOLDER_CATALYST_ADMIN_CONFIG.*CATALYST_PROJECT_KEY/
  );

  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        CATALYST_PROJECT_ID: '123456',
        CATALYST_PROJECT_KEY: 'valid_proj_key',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'development',
        CATALYST_ADMIN_CLIENT_ID: '1000.abc',
        CATALYST_ADMIN_CLIENT_SECRET: 'YOUR_CLIENT_SECRET',
        CATALYST_ADMIN_REFRESH_TOKEN: '1000.rtok',
      }),
    /PLACEHOLDER_CATALYST_ADMIN_CONFIG/
  );

  assert.throws(
    () =>
      CatalystAdminAppProvider.fromEnvironment({
        CATALYST_PROJECT_ID: '123456',
        CATALYST_PROJECT_KEY: 'valid_proj_key',
        VIGORCORE_DEPLOYMENT_ENVIRONMENT: 'Development',
        VIGOR_ENVIRONMENT: 'production',
        CATALYST_ADMIN_CLIENT_ID: '1000.abc',
        CATALYST_ADMIN_CLIENT_SECRET: 'real_secret_val',
        CATALYST_ADMIN_REFRESH_TOKEN: '1000.rtok',
      }),
    /ENVIRONMENT_SEPARATION_VIOLATION/
  );

  assert.throws(
    () =>
      new CatalystAdminAppProvider({
        projectId: '123456',
        projectKey: 'valid_proj_key_prod',
        catalystEnvironment: 'Production',
        vigorEnvironment: 'production',
        apiDomain: 'http://127.0.0.1:9999',
        accountsUrl: 'https://accounts.zoho.com',
        authMode: 'access_token',
        accessToken: 'tok_1234567890',
        allowInsecureLoopbackForTest: false,
      }),
    /INSECURE_CATALYST_URL/
  );
});

test('Phase 5.0 [PASS-SDK-CONTRACT] Strict user/admin separation & header spoofing rejection', async () => {
  const servers = await startLocalMockCatalystServers();
  try {
    servers.mockUsers.set('u_alice_1', {
      zuid: 'zuid_1',
      user_id: 'u_alice_1',
      email_id: 'alice@vigorcore.lat',
      first_name: 'Alice',
      last_name: 'Athlete',
      status: 'ACTIVE',
      is_confirmed: true,
    });

    const provider = new CatalystAdminAppProvider({
      projectId: 'proj_real_777',
      projectKey: 'proj_key_777',
      catalystEnvironment: 'Development',
      vigorEnvironment: 'test',
      apiDomain: servers.baasOrigin,
      accountsUrl: servers.oauthOrigin,
      clientId: '1000.CID',
      clientSecret: '1000.SECRET_XYZ',
      refreshToken: '1000.RTOK_XYZ',
      allowInsecureLoopbackForTest: true,
    });

    const authRuntime = new CatalystSeparatedAuthRuntime({
      adminProvider: provider,
      requireLiveInt08ForPasswordReset: true,
    });

    // 1. Cookie-only request without x-zc-user-cred-token / x-zc-cookie returns null cleanly (no BaaS hit)
    const noCatHdr = await authRuntime.getCurrentUserFromRequest({
      headers: { cookie: '__Host-vigor_session=dummy' },
    });
    assert.equal(noCatHdr, null);
    assert.equal(servers.baasCalls.length, 0);

    // 2. Spoofed x-zc-projectid rejected 403
    await assert.rejects(
      () =>
        authRuntime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': 'forged_proj_999',
            'x-zc-user-cred-token': 'usr_tok',
          },
        }),
      (err: unknown) => err instanceof AuthGuardError && err.code === 'PROJECT_CONTEXT_MISMATCH' && err.statusCode === 403
    );

    // 3. Spoofed x-zc-user-type: admin rejected 403
    await assert.rejects(
      () =>
        authRuntime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': 'proj_real_777',
            'x-zc-user-type': 'admin',
            'x-zc-user-cred-token': 'usr_tok',
          },
        }),
      (err: unknown) => err instanceof AuthGuardError && err.code === 'CATALYST_ADMIN_HEADER_SPOOFED' && err.statusCode === 403
    );

    // 3b. Spoofed x-zc-project-key rejected 403
    await assert.rejects(
      () =>
        authRuntime.getCurrentUserFromRequest({
          headers: {
            'x-zc-projectid': 'proj_real_777',
            'x-zc-project-key': 'forged_key_999',
            'x-zc-user-cred-token': 'usr_tok',
          },
        }),
      (err: unknown) => err instanceof AuthGuardError && err.code === 'PROJECT_CONTEXT_MISMATCH' && err.statusCode === 403
    );

    // 4. User identity check runs strictly in scope=user and pins server domain/project.
    // Even if incoming x-zc-admin-cred-* headers are sent alongside user creds, scope stays 'user' and uses user_oauth_token_111.
    // Per @zcatalyst/auth-admin addDefaultAppHeaders & @zcatalyst/transport HttpClient:
    // - URL path carries projectId: `/baas/v1/project/${projectId}/...`
    // - HTTP header `PROJECT_ID` (`headers.project_id`) carries projectKey!
    const userRes = await authRuntime.getCurrentUserFromRequest({
      headers: {
        'x-zc-projectid': 'proj_real_777',
        'x-zc-admin-cred-type': 'token',
        'x-zc-admin-cred-token': 'forged_admin_cred_must_not_run',
        'x-zc-user-cred-type': 'token',
        'x-zc-user-cred-token': 'user_oauth_token_111',
        'zc-api-domain': 'https://evil.attacker.invalid',
      },
    });
    assert.equal(userRes?.user_id, 'u_alice_1');
    const userCall = servers.baasCalls[0];
    assert.equal(userCall.url, '/baas/v1/project/proj_real_777/project-user/current');
    assert.equal(userCall.headers.authorization, 'Zoho-oauthtoken user_oauth_token_111');
    assert.equal(userCall.headers['x-catalyst-user'], 'user');
    assert.equal(userCall.headers.project_id, 'proj_key_777');
    assert.equal(userCall.headers.environment, 'Development');

    // 5. Admin getUserDetails & updateUserStatus strictly use server admin OAuth (NOT request headers)
    const adminDetails = await authRuntime.getUserDetails('u_alice_1');
    assert.equal(adminDetails?.email_id, 'alice@vigorcore.lat');
    const adminCall = servers.baasCalls[1];
    assert.equal(adminCall.url, '/baas/v1/project/proj_real_777/project-user/u_alice_1');
    assert.equal(adminCall.headers.authorization, 'Zoho-oauthtoken mock_oauth_access_token_xyz_123456');
    assert.equal(adminCall.headers['x-catalyst-user'], 'admin');
    assert.equal(adminCall.headers.project_id, 'proj_key_777');

    const disabledOk = await authRuntime.updateUserStatus('u_alice_1', USER_STATUS.DISABLE);
    assert.equal(disabledOk, true);
    assert.equal(servers.mockUsers.get('u_alice_1')?.status, 'DISABLED');

    // 404 from Catalyst -> null (deleted user)
    const missingUser = await authRuntime.getUserDetails('does_not_exist');
    assert.equal(missingUser, null);

    // 503 outage -> throws Error (fails closed in AuthGuard)
    servers.setForceNextUserDetailsStatus(503);
    await assert.rejects(() => authRuntime.getUserDetails('u_alice_1'), /Catalyst getUserDetails failed/);

    // 6. INT-08 gate: sendPasswordReset stays blocked until live BaaS verification
    await assert.rejects(
      () => authRuntime.sendPasswordReset('alice@vigorcore.lat'),
      /INT_08_LIVE_VERIFICATION_PENDING/
    );
  } finally {
    await servers.close();
  }
});

test('Phase 5.0 [PASS-LOOPBACK] All 5 Per-Table Providers execute through REAL @zcatalyst/nosql SDK against mock BaaS', async () => {
  const servers = await startLocalMockCatalystServers();
  try {
    const provider = new CatalystAdminAppProvider({
      projectId: 'proj_nosql_888',
      projectKey: 'proj_key_nosql_888',
      catalystEnvironment: 'Development',
      vigorEnvironment: 'test',
      apiDomain: servers.baasOrigin,
      accountsUrl: servers.oauthOrigin,
      clientId: '1000.CID',
      clientSecret: 'secret_999',
      refreshToken: 'refresh_999',
      allowInsecureLoopbackForTest: true,
    });

    const registry = createTableProviders(provider.createNoSQLClient());
    const nowSec = 1_760_000_000;
    const nowIso = new Date(nowSec * 1000).toISOString();

    // 1. UsersTableProvider
    const userItem: UserAccountItem = {
      pk: KeyBuilders.userPk('u1'),
      uid: 'u1',
      email: 'u1@vigorcore.lat',
      normalizedEmail: 'u1@vigorcore.lat',
      displayName: 'User One',
      role: 'athlete',
      roleVersion: 1,
      sessionEpoch: 1,
      accountStatus: 'active',
      emailVerified: true,
      authProvider: 'catalyst_auth',
      directorySegment: KeyBuilders.directorySegment('u1'),
      onboardingCompleted: true,
      onboardingStep: 6,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastSignInAt: nowIso,
    };
    const insUser = await registry.users.insertUser(userItem);
    assert.equal(insUser.inserted, true);

    const fetchedUser = await registry.users.fetchUserByUid('u1', true);
    assert.equal(fetchedUser?.email, 'u1@vigorcore.lat');
    const fetchUserCall = servers.baasCalls.find(c => c.url.endsWith('/nosqltable/Users/item/fetch'));
    assert.ok(fetchUserCall?.url.startsWith('/baas/v1/project/proj_nosql_888/nosqltable/Users/item/fetch'));
    assert.equal(fetchUserCall?.headers.project_id, 'proj_key_nosql_888');
    assert.equal(fetchUserCall?.headers.environment, 'Development');
    assert.equal(fetchUserCall?.headers.authorization, 'Zoho-oauthtoken mock_oauth_access_token_xyz_123456');
    assert.equal(fetchUserCall?.body.consistent_read, true);

    const byEmail = await registry.users.findByNormalizedEmail('U1@VIGORCORE.LAT', true);
    assert.equal(byEmail.length, 1);

    const allSegs = await registry.users.listAllDirectorySegmentsConcurrently({ consistent_read: true });
    assert.equal(allSegs.length, 1);
    assert.equal((allSegs[0] as any).normalizedEmail, undefined); // GSI_Directory SPECIFIC_ATTRIBUTES verified!

    const byRole = await registry.users.queryByRoleStatus('athlete', 'active');
    assert.equal(byRole.items.length, 1);

    const epochRes = await registry.users.bumpSessionEpoch('u1', 1, nowIso);
    assert.equal(epochRes.updated, true);
    assert.equal((await registry.users.fetchUserByUid('u1', true))?.sessionEpoch, 2);

    // 2. UserDataTableProvider pagination & empty start_key termination
    const mealItems: UserDataItem[] = Array.from({ length: 3 }, (_, idx) => ({
      pk: KeyBuilders.userPk('u1'),
      sk: KeyBuilders.mealSk(`2026-10-0${idx + 1}T12:00:00.000Z`, `m${idx}`),
      uid: 'u1',
      entityType: 'MEAL_LOG',
      entityId: `m${idx}`,
      entityDateKey: `MEAL_LOG#2026-10-0${idx + 1}#m${idx}`,
      payload: { name: `Meal ${idx}`, kcal: 500 + idx * 10 },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    }));
    const batchRes = await registry.userData.insertBatch(mealItems);
    assert.equal(batchRes.count, 3);
    assert.equal(batchRes.batchCalls, 1);

    const page1 = await registry.userData.listUserPartition('u1', { sortKeyPrefix: 'MEAL#', limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextStartKey);
    const page2 = await registry.userData.listUserPartition('u1', {
      sortKeyPrefix: 'MEAL#',
      limit: 2,
      startKey: page1.nextStartKey,
    });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextStartKey, undefined); // Empty start_key {} MUST become undefined (no infinite loop!)

    const idxMeals = await registry.userData.queryEntityDateIndex('u1', { entityDatePrefix: 'MEAL_LOG#' });
    assert.equal(idxMeals.items.length, 3);

    const badVer = await registry.userData.updateEntityVersioned('u1', mealItems[0].sk, 999, { version: 2 });
    assert.equal(badVer.updated, false);
    assert.equal(badVer.status, 'ConditionMismatch');

    // Batch > 25 items automatically chunks into <= 25 per Catalyst request
    const bulkItems: UserDataItem[] = Array.from({ length: 27 }, (_, i) => ({
      pk: KeyBuilders.userPk('u1'),
      sk: KeyBuilders.grocerySk(`g_${String(i).padStart(2, '0')}`),
      uid: 'u1',
      entityType: 'GROCERY',
      entityId: `g_${String(i).padStart(2, '0')}`,
      entityDateKey: `GROCERY#${nowIso}#g_${i}`,
      payload: { name: `Item ${i}`, status: 'pending' },
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    }));
    const bulkRes = await registry.userData.insertBatch(bulkItems);
    assert.equal(bulkRes.count, 27);
    assert.equal(bulkRes.batchCalls, 2);
    assert.equal(CATALYST_PLATFORM_LIMITS.MAX_BATCH_WRITE_ITEMS, 25);
    assert.equal(DIRECTORY_SEGMENTS.length, 4);

    // 3. AdminInvitationsTableProvider
    const invite: AdminInvitationItem = {
      pk: KeyBuilders.invitePk('inv_1'),
      inviteId: 'inv_1',
      emailNormalized: 'coach@vigorcore.lat',
      targetRole: 'admin',
      status: 'pending',
      tokenHash: 'hash_abc',
      createdBy: 'u1',
      createdByEmail: 'u1@vigorcore.lat',
      createdAt: nowIso,
      expiresAt: new Date((nowSec + 3600) * 1000).toISOString(),
      expiresAtEpochSec: nowSec + 3600,
      ttlEpochSec: nowSec + 86400,
    };
    await registry.adminInvitations.createInvitation(invite);
    const invHits = await registry.adminInvitations.findByEmailAndStatus('coach@vigorcore.lat', 'pending', true);
    assert.equal(invHits.length, 1);
    const transRes = await registry.adminInvitations.transitionStatus('inv_1', 'pending', { status: 'redeemed' });
    assert.equal(transRes.updated, true);

    // 4. AuditLogsTableProvider (append-only + GSIs)
    const aud: AuditLogItem = {
      pk: 'AUDIT#2026-10',
      sk: KeyBuilders.auditSk(nowSec * 1000, 'ev_1'),
      auditPeriodBucket: 'AUDIT_Q#2026-Q4',
      globalChronologyKey: `${nowIso}#ev_1`,
      eventId: 'ev_1',
      action: 'SET_ROLE',
      actorUid: 'admin_0',
      actorRole: 'superadmin',
      actorEmail: 'root@vigorcore.lat',
      targetUid: 'u1',
      timestamp: nowIso,
    };
    await registry.auditLogs.appendEvent(aud);
    assert.equal((await registry.auditLogs.listByMonth('2026-10')).items.length, 1);
    assert.equal((await registry.auditLogs.listByActor('admin_0')).items.length, 1);
    assert.equal((await registry.auditLogs.listByTarget('u1')).items.length, 1);
    assert.equal((await registry.auditLogs.listByQuarterBucket('AUDIT_Q#2026-Q4')).items.length, 1);

    // 5. SystemControlTableProvider: sessions & atomic PUT + update_function increment/decrement
    const sess: SessionRecordItem = {
      pk: KeyBuilders.sessionPk('sid_1234567890abcdef'),
      sid: 'sid_1234567890abcdef',
      ownerUserId: 'u1',
      sessionEpoch: 2,
      issuedAt: nowIso,
      issuedAtEpochSec: nowSec,
      initialAuthAtEpochSec: nowSec,
      expiresAt: new Date((nowSec + 3600) * 1000).toISOString(),
      expiresAtEpochSec: nowSec + 3600,
      absoluteExpiresAtEpochSec: nowSec + 86400,
      lastCatalystCheckAtEpochSec: nowSec,
      status: 'active',
      ttlEpochSec: nowSec + 86400 * 2,
    };
    await registry.systemControl.insertSession(sess);
    assert.equal((await registry.systemControl.fetchSession('sid_1234567890abcdef'))?.status, 'active');

    await registry.systemControl.insertItem({
      pk: KeyBuilders.superadminCountPk(),
      activeSuperadminCount: 2,
      version: 1,
      updatedAt: nowIso,
      ttlEpochSec: nowSec + 86400 * 365,
    });
    const decRes = await registry.systemControl.atomicIncrementSuperadminCount(1, -1, nowIso);
    assert.equal(decRes.updated, true);
    const addCall = servers.baasCalls.filter(c => c.method === 'PUT' && c.url.endsWith('/nosqltable/SystemControl/item')).pop();
    const superadminOp = addCall?.body[0].update_attributes.find((u: any) => u.attribute_path[0] === 'activeSuperadminCount');
    assert.equal(superadminOp.operation_type, 'PUT');
    assert.equal(superadminOp.update_function.function_name, 'subtract');
    const ctr = await registry.systemControl.fetchControlRecord<any>(KeyBuilders.superadminCountPk());
    assert.equal(ctr.activeSuperadminCount, 1);
    assert.equal(ctr.version, 2);

    // HTTP 504 timeout normalization
    servers.setForceNextNoSqlStatus(504);
    await assert.rejects(
      () => registry.users.fetchUserByUid('u1', true),
      (err: unknown) => err instanceof CatalystTimeoutError && err.isTimeout === true
    );

    const sanitizedText = redactSecretsFromString('token=1000.secret __Host-vigor_session=tokval', ['1000.secret']);
    assert.equal(sanitizedText.includes('1000.secret'), false);
    assert.equal(sanitizedText.includes('tokval'), false);
  } finally {
    await servers.close();
  }
});
