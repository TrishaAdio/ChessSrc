#!/usr/bin/env node
/**
 * CrystalChess authoritative multiplayer server.
 *
 * One Node process serves both a WebSocket game endpoint and a `GET /health`
 * probe on the same port. The server is the single source of truth for
 * positions, legality and clocks; clients only ever propose moves.
 *
 * Run: `node server/index.mjs`   (see server/README.md for env vars)
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

import { DEFAULT_MAX_CONNECTIONS, Hub } from './lib/hub.mjs';
import { DEFAULT_ABANDON_GRACE_MS, DEFAULT_FIRST_MOVE_ABORT_MS } from './lib/room.mjs';
import { PROTOCOL_VERSION } from './lib/protocol.mjs';

/** Frames larger than this are dropped by `ws` before we ever parse them. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Reads a positive integer from the environment.
 * @param {string|undefined} raw
 * @param {number|null} fallback
 * @returns {number|null}
 */
function intEnv(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * @typedef {object} ServerHandle
 * @property {number} port Actual bound port (resolved even when 0 was requested).
 * @property {string} host
 * @property {string} url `ws://host:port`
 * @property {Hub} hub
 * @property {import('node:http').Server} http
 * @property {WebSocketServer} wss
 * @property {() => Promise<void>} close
 */

/**
 * Boots the HTTP + WebSocket server.
 *
 * @param {object} [options]
 * @param {number} [options.port] 0 picks an ephemeral port (used by the tests).
 * @param {string} [options.host]
 * @param {number|null} [options.initialMsOverride] Shortens every clock; test hook.
 * @param {number|null} [options.chess960Id] Forces a Chess960 position; test hook.
 * @param {number} [options.abandonGraceMs] Reconnection window for dropped players.
 * @param {number} [options.firstMoveAbortMs] Window for the free opening move.
 * @param {number} [options.maxConnections]
 * @param {string[]|null} [options.allowedOrigins] When set, rejects other `Origin` headers.
 * @param {boolean} [options.quiet] Suppresses the per-event log lines.
 * @returns {Promise<ServerHandle>}
 */
export async function startServer(options = {}) {
  const port = options.port ?? intEnv(process.env.PORT, 8787) ?? 8787;
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const initialMsOverride = options.initialMsOverride ?? intEnv(process.env.TEST_FAST_CLOCK_MS, null);
  const chess960Id = options.chess960Id ?? intEnv(process.env.TEST_CHESS960_ID, null);
  const abandonGraceMs =
    options.abandonGraceMs ?? intEnv(process.env.ABANDON_GRACE_MS, DEFAULT_ABANDON_GRACE_MS) ?? DEFAULT_ABANDON_GRACE_MS;
  const firstMoveAbortMs =
    options.firstMoveAbortMs ??
    intEnv(process.env.FIRST_MOVE_ABORT_MS, DEFAULT_FIRST_MOVE_ABORT_MS) ??
    DEFAULT_FIRST_MOVE_ABORT_MS;
  const maxConnections =
    options.maxConnections ?? intEnv(process.env.MAX_CONNECTIONS, DEFAULT_MAX_CONNECTIONS) ?? DEFAULT_MAX_CONNECTIONS;
  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : null);
  const quiet = options.quiet ?? process.env.QUIET === '1';

  /** @param {string} msg */
  const log = (msg) => {
    if (!quiet) console.log(`[crystalchess] ${msg}`);
  };

  const hub = new Hub({ initialMsOverride, chess960Id, abandonGraceMs, firstMoveAbortMs, maxConnections, log });

  const http = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = JSON.stringify(hub.healthSnapshot());
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const body = JSON.stringify({ ok: false, error: 'not-found' });
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  });

  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Opt-in origin allowlist. Left unset by default because the desktop shell
    // and local dev tooling present a variety of origins; set ALLOWED_ORIGINS
    // in a hosted deployment to stop arbitrary web pages opening sockets.
    ...(allowedOrigins
      ? {
          verifyClient: (/** @type {{ origin?: string }} */ info) =>
            !info.origin || allowedOrigins.includes(info.origin),
        }
      : {}),
  });
  wss.on('connection', (ws) => {
    const client = hub.handleConnection(ws);
    log(`connection ${client.id} (${hub.clients.size} online)`);
  });

  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      http.removeListener('error', reject);
      resolve(undefined);
    });
  });

  const address = http.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const dialHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  log(`protocol v${PROTOCOL_VERSION} listening on ws://${host}:${boundPort} (health: /health)`);
  if (initialMsOverride != null) log(`TEST_FAST_CLOCK_MS active: every clock starts at ${initialMsOverride}ms`);
  if (chess960Id != null) log(`TEST_CHESS960_ID active: every Chess960 game uses position ${chess960Id}`);

  return {
    port: boundPort,
    host,
    url: `ws://${dialHost}:${boundPort}`,
    hub,
    http,
    wss,
    close: () =>
      new Promise((resolve) => {
        hub.close();
        wss.close(() => http.close(() => resolve(undefined)));
      }),
  };
}

// Only self-start when executed directly, so tests can import `startServer`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = await startServer();
  /** @param {NodeJS.Signals} sig */
  const shutdown = (sig) => {
    console.log(`[crystalchess] ${sig} received, shutting down`);
    handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
