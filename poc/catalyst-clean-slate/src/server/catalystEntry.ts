/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Phase 5.0 Zoho Catalyst Advanced I/O Express Entrypoint
 *
 * Compatible with Catalyst Advanced I/O Node.js runtime (`module.exports = app` / default export).
 * Uses lazy initialization on first request so importing this module NEVER reads/requires
 * live environment secrets at import time and NEVER auto-starts an HTTP listener unless
 * `startStandaloneLocalServer()` is explicitly called by a local runner.
 */

import http from 'node:http';
import {
  createVigorCoreProductionRuntimeFromEnv,
  type VigorCoreRuntimeBundle,
} from './advancedIoApp.js';
import { redactSecretsFromString } from '../sdk/catalystSdkBridge.js';

let cachedRuntime: VigorCoreRuntimeBundle | null = null;

export function getOrInitializeAdvancedIoRuntime(
  envMap: Record<string, string | undefined> = process.env
): VigorCoreRuntimeBundle {
  if (!cachedRuntime) {
    cachedRuntime = createVigorCoreProductionRuntimeFromEnv(envMap);
  }
  return cachedRuntime;
}

export function resetAdvancedIoRuntimeForTests(): void {
  cachedRuntime = null;
}

export function catalystAdvancedIoEntry(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  let runtime: VigorCoreRuntimeBundle;
  try {
    runtime = getOrInitializeAdvancedIoRuntime(process.env);
  } catch (err) {
    const safeMsg = redactSecretsFromString(
      err instanceof Error ? err.message : 'Server configuration incomplete.'
    );
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        error: 'SERVER_CONFIGURATION_UNAVAILABLE',
        message: safeMsg,
      })
    );
    return;
  }

  (runtime.app as unknown as http.RequestListener)(req, res);
}

export function startStandaloneLocalServer(
  port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 0),
  host = '127.0.0.1',
  envMap: Record<string, string | undefined> = process.env
): Promise<{ server: http.Server; port: number; runtime: VigorCoreRuntimeBundle }> {
  const runtime = getOrInitializeAdvancedIoRuntime(envMap);
  return new Promise((resolve, reject) => {
    const server = runtime.app.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: boundPort, runtime });
    });
    server.on('error', reject);
  });
}

export default catalystAdvancedIoEntry;
