#!/usr/bin/env node
/**
 * Self-contained integration test for the CrystalChess multiplayer server.
 *
 * Boots real servers on ephemeral ports, connects real `ws` clients and plays
 * real games end to end. Prints one PASS/FAIL line per assertion and exits 1
 * if anything fails.
 *
 * Run: `node server/test-server.mjs`
 */
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

import { startServer } from './index.mjs';
import { hasMatingMaterial } from './lib/clock.mjs';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, WIRE_TIME_CONTROLS } from './lib/protocol.mjs';
import { RttEstimator } from './lib/rtt.mjs';
import { chess960Setup, createEngine } from './vendor/variant-engine.mjs';

/* ───────────────────────────── harness ───────────────────────────── */

let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];

/**
 * @param {boolean} cond
 * @param {string} label
 */
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`PASS ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} label
 */
function eq(actual, expected, label) {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  ok(good, good ? label : `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function suite(name, fn) {
  console.log(`\n── ${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name} threw`);
    console.log(`FAIL ${name} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** A test client that buffers every server message so tests can await specific ones. */
class Peer {
  /** @type {any[]} Every message ever received — diagnostics and absence checks. */
  log = [];
  /** @type {any[]} Messages not yet consumed by a `waitFor`. */
  #queue = [];
  /** @type {{ predicate: (m: any) => boolean, resolve: (m: any) => void, timer: NodeJS.Timeout }[]} */
  #pending = [];

  /**
   * @param {string} url
   * @param {string} name
   */
  constructor(url, name) {
    this.name = name;
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.log.push(msg);
      const i = this.#pending.findIndex((p) => p.predicate(msg));
      if (i >= 0) {
        const [p] = this.#pending.splice(i, 1);
        clearTimeout(p.timer);
        p.resolve(msg);
      } else {
        this.#queue.push(msg);
      }
    });
    this.ws.on('error', () => {});
  }

  /** @returns {Promise<Peer>} */
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    return this;
  }

  /** @param {object} msg @returns {void} */
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** @param {string} raw @returns {void} */
  sendRaw(raw) {
    this.ws.send(raw);
  }

  /**
   * @param {(m: any) => boolean} predicate
   * @param {string} label
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  waitFor(predicate, label, timeout = 5_000) {
    const i = this.#queue.findIndex(predicate);
    if (i >= 0) return Promise.resolve(this.#queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      /** @type {any} */
      const entry = { predicate, resolve };
      entry.timer = setTimeout(() => {
        const j = this.#pending.indexOf(entry);
        if (j >= 0) this.#pending.splice(j, 1);
        reject(
          new Error(
            `${this.name}: timed out after ${timeout}ms waiting for ${label}; recent: ` +
              JSON.stringify(this.log.slice(-6).map((m) => m.t + (m.code ? `:${m.code}` : ''))),
          ),
        );
      }, timeout);
      this.#pending.push(entry);
    });
  }

  /**
   * @param {string} t
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  expect(t, timeout = 5_000) {
    return this.waitFor((m) => m.t === t, `\`${t}\``, timeout);
  }

  /** @param {string} t @returns {boolean} */
  everSaw(t) {
    return this.log.some((m) => m.t === t);
  }

  /**
   * @param {number} [v]
   * @returns {Promise<any>}
   */
  async hello(v = PROTOCOL_VERSION) {
    this.send({ t: 'hello', v, name: this.name });
    return this.expect('hello');
  }

  /** @returns {void} */
  close() {
    for (const p of this.#pending) clearTimeout(p.timer);
    this.#pending.length = 0;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Two seated peers plus the shared ply counter, so tests never mis-number moves.
 */
class Game {
  /**
   * @param {Peer} white
   * @param {Peer} black
   */
  constructor(white, black) {
    this.white = white;
    this.black = black;
    this.ply = 0;
  }

  /** Mirrors a server-side rematch: colours swap and the move list restarts. */
  swapColours() {
    const prevWhite = this.white;
    this.white = this.black;
    this.black = prevWhite;
    this.ply = 0;
  }

  /** @returns {Peer} The peer whose turn it is. */
  get mover() {
    return this.ply % 2 === 0 ? this.white : this.black;
  }

  /**
   * Plays moves in sequence, asserting both players see each broadcast.
   * @param {Array<{ from: string, to: string, promotion?: string }>} moves
   * @param {{ gapMs?: number }} [opts]
   * @returns {Promise<any[]>} The `move` messages (as received by white).
   */
  async play(moves, { gapMs = 0 } = {}) {
    /** @type {any[]} */
    const seen = [];
    for (const m of moves) {
      if (gapMs) await sleep(gapMs);
      const ply = this.ply;
      this.mover.send({ t: 'move', ...m, ply });
      const broadcast = await this.white.waitFor(
        (x) => x.t === 'move' && x.move.ply === ply,
        `move ply ${ply} (white view)`,
      );
      await this.black.waitFor((x) => x.t === 'move' && x.move.ply === ply, `move ply ${ply} (black view)`);
      this.ply++;
      seen.push(broadcast);
    }
    return seen;
  }
}

/** @type {Peer[]} */
const allPeers = [];
/** @type {Array<{ close: () => Promise<void> }>} */
const allServers = [];

/**
 * @param {string} url
 * @param {string} name
 * @returns {Promise<Peer>}
 */
async function peer(url, name) {
  const p = new Peer(url, name);
  allPeers.push(p);
  await p.open();
  await p.hello();
  return p;
}

/**
 * Boots a server on an ephemeral port and registers it for teardown.
 * @param {Parameters<typeof startServer>[0]} [opts]
 */
async function boot(opts = {}) {
  const handle = await startServer({ port: 0, host: '127.0.0.1', quiet: true, ...opts });
  allServers.push(handle);
  return handle;
}

/**
 * Queues two fresh peers against each other.
 * @param {string} url
 * @param {string} tc
 * @param {string} variant
 * @param {string} tag
 */
async function matchedPair(url, tc, variant, tag) {
  const a = await peer(url, `${tag}-A`);
  const b = await peer(url, `${tag}-B`);
  a.send({ t: 'queue', tc, variant });
  const queuedA = await a.expect('queued');
  b.send({ t: 'queue', tc, variant });
  const queuedB = await b.expect('queued');
  const roomA = await a.expect('room');
  const roomB = await b.expect('room');
  const white = roomA.role === 'white' ? a : b;
  const black = roomA.role === 'white' ? b : a;
  return { a, b, white, black, roomA, roomB, queuedA, queuedB, game: new Game(white, black) };
}

/* ───────────────────────────── suites ───────────────────────────── */

/** 1.f3 e5 2.g4 Qh4# — the shortest mate for black. */
const MATE_LINE = [
  { from: 'f2', to: 'f3' },
  { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' },
  { from: 'd8', to: 'h4' },
];

/** `src/multiplayer/protocol.ts` is authoritative; verify the runtime mirror. */
async function protocolParity() {
  const src = readFileSync(new URL('../src/multiplayer/protocol.ts', import.meta.url), 'utf8');
  /** @param {RegExp} re */
  const num = (re) => {
    const m = src.match(re);
    return m ? Number(m[1].replace(/_/g, '')) : null;
  };
  eq(num(/PROTOCOL_VERSION\s*=\s*(\d+)/), PROTOCOL_VERSION, 'PROTOCOL_VERSION matches protocol.ts');
  eq(src.match(/ROOM_CODE_ALPHABET\s*=\s*'([^']+)'/)?.[1], ROOM_CODE_ALPHABET, 'ROOM_CODE_ALPHABET matches protocol.ts');
  eq(num(/ROOM_CODE_LENGTH\s*=\s*(\d+)/), ROOM_CODE_LENGTH, 'ROOM_CODE_LENGTH matches protocol.ts');

  /** @type {Record<string, { initialMs: number, incrementMs: number }>} */
  const parsed = {};
  const table = src.slice(src.indexOf('WIRE_TIME_CONTROLS'), src.indexOf('export type Role'));
  for (const m of table.matchAll(/'?([\w+]+)'?:\s*\{\s*initialMs:\s*([\d_]+),\s*incrementMs:\s*([\d_]+)\s*\}/g)) {
    parsed[m[1]] = { initialMs: Number(m[2].replace(/_/g, '')), incrementMs: Number(m[3].replace(/_/g, '')) };
  }
  eq(parsed, WIRE_TIME_CONTROLS, 'WIRE_TIME_CONTROLS matches protocol.ts (all 8 entries)');

  /* The server duplicates these names as string literals; guard against drift. */
  /** @param {string} from @param {string} to */
  const literals = (from, to) => {
    const section = src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);
    return [...section.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  const clientTypes = new Set(
    [...src.slice(src.indexOf('export type ClientMessage'), src.indexOf('export type ServerMessage')).matchAll(/\bt: '(\w+)'/g)].map(
      (m) => m[1],
    ),
  );
  const serverTypes = new Set(
    [...src.slice(src.indexOf('export type ServerMessage'), src.indexOf('export type ErrorCode')).matchAll(/\bt: '(\w+)'/g)].map(
      (m) => m[1],
    ),
  );
  const errorCodes = new Set(literals('export type ErrorCode', 'isServerMessage'));
  const endReasons = new Set(literals('export type GameEndReason', 'export interface WireMove'));

  const serverSource = ['index.mjs', 'lib/hub.mjs', 'lib/room.mjs', 'lib/clock.mjs', 'lib/client.mjs', 'lib/protocol.mjs']
    .map((f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'))
    .join('\n');

  const handled = new Set([...readFileSync(new URL('./lib/hub.mjs', import.meta.url), 'utf8').matchAll(/case '(\w+)':/g)].map((m) => m[1]));
  eq([...clientTypes].filter((t) => !handled.has(t)), [], 'every ClientMessage type is dispatched by the hub');

  const emitted = new Set([...serverSource.matchAll(/\{ t: '(\w+)'/g)].map((m) => m[1]));
  eq([...emitted].filter((t) => !serverTypes.has(t)), [], 'the server emits no message type outside ServerMessage');
  eq([...serverTypes].filter((t) => !emitted.has(t)), [], 'every ServerMessage type is actually emitted');

  const usedCodes = new Set([...serverSource.matchAll(/(?:error|reject)\((?:client, )?'([a-z-]+)'/g)].map((m) => m[1]));
  eq([...usedCodes].filter((c) => !errorCodes.has(c)), [], 'the server uses no ErrorCode outside the protocol union');
  const usedReasons = new Set([...serverSource.matchAll(/#end\([^,]+, '([a-z-]+)'/g)].map((m) => m[1]));
  eq([...usedReasons].filter((r) => !endReasons.has(r)), [], 'the server uses no GameEndReason outside the protocol union');
}

/** The Chess960 id must always rebuild the exact advertised start FEN. */
async function chess960FenContract() {
  /** @type {number[]} */
  const mismatched = [];
  for (let id = 0; id < 960; id++) {
    const setup = chess960Setup(id);
    const srv = { startFen: setup.fen }; // what Room publishes (see Room.#newGame)
    if (srv.startFen !== chess960Setup(id).fen) mismatched.push(id);
  }
  eq(mismatched, [], 'chess960Setup(id).fen is reproducible for all 960 ids');

  // Every setup FEN must be directly playable by the engine, since the room
  // hands it to createEngine untouched rather than normalising it.
  /** @type {number[]} */
  const unplayable = [];
  for (let id = 0; id < 960; id++) {
    const setup = chess960Setup(id);
    const engine = createEngine('chess960', setup.fen);
    if (engine.fen().split(' ')[0] !== setup.fen.split(' ')[0] || engine.moves().length === 0) unplayable.push(id);
  }
  eq(unplayable, [], 'all 960 Chess960 start FENs are playable as published');
}

/** The RTT estimator sizes the lag credit, so a client must not be able to inflate it. */
async function rttEstimator() {
  const fresh = new RttEstimator();
  eq(fresh.rttMs, 0, 'a fresh RTT estimator reports 0 (no lag credit)');

  const frames = new RttEstimator();
  for (const v of [40, 50, 60, 2_000]) frames.addRoundTrip(v);
  eq(frames.rttMs, 55, 'the estimate is the median of recent round trips, not the mean');

  // A single `ping` whose `t0` claims the future used to pin the estimate to
  // the 2000ms clamp, buying the maximum lag credit on every later move.
  const poisoned = new RttEstimator();
  const base = Date.now();
  poisoned.addPing(base + 600_000, base); // ten minutes in the future
  for (let i = 1; i <= 6; i++) poisoned.addPing(base + i * 100, base + i * 100 + 30);
  ok(poisoned.rttMs <= 200, `a skewed ping.t0 cannot inflate the estimate (got ${poisoned.rttMs}ms)`);

  // Server-measured frames outrank anything derived from client timestamps.
  const mixed = new RttEstimator();
  const t = Date.now();
  mixed.addPing(t, t); // baseline
  for (let i = 1; i <= 5; i++) mixed.addPing(t + i, t + i + 400); // ~800ms derived
  mixed.addRoundTrip(30);
  eq(mixed.rttMs, 30, 'server-measured pong frames take precedence over client-derived samples');

  // Honest one-way samples still work for peers that ignore control frames.
  const derived = new RttEstimator();
  const u = Date.now();
  derived.addPing(u, u);
  for (let i = 1; i <= 5; i++) derived.addPing(u + i, u + i + 25);
  eq(derived.rttMs, 50, 'application pings still yield an estimate when no frames exist');
}

/** @param {string} url */
async function handshake(url) {
  const bad = new Peer(url, 'bad-version');
  allPeers.push(bad);
  await bad.open();
  bad.send({ t: 'hello', v: PROTOCOL_VERSION + 99, name: 'old client' });
  const vErr = await bad.expect('error');
  eq(vErr.code, 'version-mismatch', 'mismatched `hello.v` → error version-mismatch');
  bad.close();

  const early = new Peer(url, 'early');
  allPeers.push(early);
  await early.open();
  early.send({ t: 'queue', tc: '3+0', variant: 'standard' });
  eq((await early.expect('error')).code, 'bad-message', 'a message before `hello` → error bad-message');

  early.sendRaw('{not json at all');
  eq((await early.expect('error')).code, 'bad-message', 'malformed JSON → error bad-message');

  early.send({ t: 'nonsense' });
  eq((await early.expect('error')).code, 'bad-message', 'unknown message type → error bad-message');

  const hi = await early.hello();
  ok(typeof hi.id === 'string' && hi.id.length > 0, 'hello reply carries a generated id');
  eq(hi.v, PROTOCOL_VERSION, 'hello reply carries the server protocol version');

  const t0 = Date.now();
  early.send({ t: 'ping', t0 });
  const pong = await early.expect('pong');
  eq(pong.t0, t0, 'pong echoes the client `t0`');
  ok(typeof pong.serverTs === 'number' && pong.serverTs > 0, 'pong carries a server timestamp');
  early.close();

  const flood = await peer(url, 'flood');
  for (let i = 0; i < 300; i++) flood.send({ t: 'ping', t0: Date.now() });
  const rateErr = await flood.waitFor((m) => m.t === 'error' && m.code === 'rate-limited', 'rate-limited error');
  eq(rateErr.code, 'rate-limited', 'message flood → error rate-limited');
  flood.close();
}

/** @param {string} url */
async function queueAndFullGame(url) {
  const { a, b, roomA, roomB, queuedA, queuedB, game } = await matchedPair(url, '3+0', 'standard', 'mate');

  eq(queuedA.size, 1, 'the first client is queued with size 1');
  eq(queuedB.size, 2, 'the second client is queued with size 2');
  eq(queuedA.tc, '3+0', '`queued` echoes the requested time control');
  eq(queuedA.variant, 'standard', '`queued` echoes the requested variant');

  eq(roomA.room.code, roomB.room.code, 'both matched clients land in the same room');
  ok(ROOM_CODE_RE.test(roomA.room.code), 'the matched room code uses the protocol alphabet and length');
  eq([roomA.role, roomB.role].sort(), ['black', 'white'], 'matched clients get complementary colours');
  eq(roomA.room.status, { state: 'playing' }, 'a matched room starts in status playing');
  eq(roomA.room.private, false, 'a matched room is not flagged private');
  eq(roomA.room.moves, [], 'a fresh room has an empty move list');
  eq(roomA.room.tc, '3+0', 'RoomState reports the negotiated time control');
  eq(roomA.room.clocks?.w, 180_000, 'clocks start at the 3+0 initial time');
  eq(roomA.room.players.white?.connected, true, 'white is reported connected');
  eq(roomA.room.players.black?.connected, true, 'black is reported connected');
  eq(roomA.room.fen, roomA.room.startFen, 'the live FEN equals the start FEN before any move');

  a.send({ t: 'queue', tc: '5+0', variant: 'standard' });
  eq((await a.expect('error')).code, 'already-in-room', 'queueing while seated → error already-in-room');

  const seen = await game.play(MATE_LINE, { gapMs: 45 });
  eq(seen.map((m) => m.move.san), ['f3', 'e5', 'g4', 'Qh4#'], 'every move is broadcast with the engine SAN');
  eq(seen.map((m) => m.move.ply), [0, 1, 2, 3], 'broadcast plies are sequential from 0');
  eq(seen[3].move.fen.split(' ')[1], 'w', 'the broadcast FEN tracks the side to move');
  eq(seen[0].move.lan, 'f2f3', 'the broadcast carries the LAN form too');

  const overW = await game.white.expect('over');
  const overB = await game.black.expect('over');
  eq(overW.result, '0-1', 'the short mate ends 0-1');
  eq(overW.reason, 'checkmate', 'the short mate ends with reason checkmate');
  eq(overW.winner, 'b', 'the short mate is won by black');
  eq(overB.result, '0-1', 'both players receive the same `over`');
  eq(overW.clocks?.active, null, 'the clocks stop (active null) when the game ends');

  const clocks = seen.map((m) => m.clocks);
  eq(clocks[0].w, 180_000, 'the first move of the game consumes no time');
  eq(clocks[0].b, 180_000, "the first move does not touch the opponent's clock");
  eq(clocks.map((c) => c.active), ['b', 'w', 'b', 'w'], 'the active colour alternates after each move');
  ok(
    clocks.every((c, i) => i === 0 || (c.w <= clocks[i - 1].w && c.b <= clocks[i - 1].b)),
    'clocks are monotonically non-increasing in a 0-increment control',
  );
  ok(clocks[1].b < clocks[0].b, "black's clock strictly decreases after black's first move");
  ok(clocks[2].w < clocks[1].w, "white's clock strictly decreases after white's second move");
  ok(clocks[3].b < clocks[1].b, "black's clock keeps decreasing across moves");
  ok(clocks.every((c) => typeof c.serverTs === 'number' && c.serverTs > 0), 'every clock payload carries a serverTs');

  a.close();
  b.close();
}

/** @param {string} url */
async function incrementApplied(url) {
  const { a, b, game } = await matchedPair(url, '2+1', 'standard', 'inc');
  const [first] = await game.play([{ from: 'e2', to: 'e4' }]);
  eq(first.clocks.w, 121_000, 'the first move adds the 2+1 increment without charging time');

  const [second] = await game.play([{ from: 'e7', to: 'e5' }], { gapMs: 120 });
  ok(
    second.clocks.b > 120_000 && second.clocks.b <= 121_000,
    `the increment outweighs a ~120ms think (b=${second.clocks.b}ms from 120000ms)`,
  );
  ok(second.clocks.b < 121_000, 'the think time is still charged on top of the increment');
  a.close();
  b.close();
}

/** @param {string} url */
async function rejectionsAndResync(url) {
  const { a, b, white, black, roomA, game } = await matchedPair(url, '5+0', 'standard', 'reject');
  await game.play([{ from: 'e2', to: 'e4' }]);

  // Out of turn: it is black to move, white tries anyway.
  white.send({ t: 'move', from: 'd2', to: 'd4', ply: game.ply });
  eq((await white.expect('error')).code, 'not-your-turn', 'moving out of turn → error not-your-turn');
  const turnResync = await white.expect('resync');
  eq(turnResync.room.moves.length, 1, 'not-your-turn is followed by a resync with the authoritative moves');
  eq(turnResync.room.code, roomA.room.code, 'the resync carries the right room');
  eq(turnResync.role, 'white', 'the resync restates the recipient role');
  eq(turnResync.room.fen, turnResync.room.moves[0].fen, 'the resync FEN matches the last played move');

  // Illegal: black's a8 rook cannot jump its own a7 pawn.
  black.send({ t: 'move', from: 'a8', to: 'a5', ply: game.ply });
  eq((await black.expect('error')).code, 'illegal-move', 'an illegal move → error illegal-move');
  const illegalResync = await black.expect('resync');
  eq(illegalResync.room.moves.length, 1, 'illegal-move is followed by a resync');
  eq(illegalResync.room.status, { state: 'playing' }, 'the resync shows the game is still live');

  // Neither rejection advanced the position, so the real move still works.
  const [reply] = await game.play([{ from: 'e7', to: 'e5' }]);
  eq(reply.move.ply, 1, 'a rejected move does not consume a ply');

  // Stale ply → rejected plus resync.
  white.send({ t: 'move', from: 'g1', to: 'f3', ply: 99 });
  eq((await white.expect('error')).code, 'illegal-move', 'a stale `ply` → error illegal-move');
  await white.expect('resync');
  ok(true, 'a stale `ply` is followed by a resync');

  // Malformed squares are rejected before the engine is touched.
  white.send({ t: 'move', from: 'zz', to: '99', ply: game.ply });
  eq((await white.expect('error')).code, 'bad-message', 'malformed move squares → error bad-message');
  await white.expect('resync');
  ok(true, 'a malformed move is followed by a resync');

  const loner = await peer(url, 'loner');
  loner.send({ t: 'move', from: 'e2', to: 'e4', ply: 0 });
  eq((await loner.expect('error')).code, 'not-playing', 'moving outside a room → error not-playing');
  loner.close();

  a.close();
  b.close();
}

/** @param {string} url */
async function privateRoomAndSpectator(url) {
  const host = await peer(url, 'host');
  host.send({ t: 'create', tc: '5+0', variant: 'standard' });
  const created = await host.expect('room');
  ok(ROOM_CODE_RE.test(created.room.code), 'the private room code uses ROOM_CODE_ALPHABET exactly');
  eq(created.room.code.length, ROOM_CODE_LENGTH, 'the private room code has ROOM_CODE_LENGTH characters');
  eq(created.room.private, true, 'a created room is flagged private');
  eq(created.room.status, { state: 'waiting' }, 'a created room starts in status waiting');
  ok(created.role === 'white' || created.role === 'black', 'the room creator is seated as a player');

  const stranger = await peer(url, 'stranger');
  stranger.send({ t: 'join', code: 'ZZZZZZ' });
  eq((await stranger.expect('error')).code, 'room-not-found', 'joining an unknown code → error room-not-found');

  stranger.send({ t: 'join', code: created.room.code });
  const joined = await stranger.expect('room');
  const hostUpdate = await host.waitFor((m) => m.t === 'room' && m.room.status.state === 'playing', 'host room update');
  eq(joined.room.code, created.room.code, 'the joiner lands in the requested room');
  eq(joined.room.status, { state: 'playing' }, 'filling the second seat starts the game');
  eq(hostUpdate.room.status, { state: 'playing' }, 'the creator is told the game started');
  ok(joined.role !== created.role, 'the joiner takes the free colour');

  const game = new Game(created.role === 'white' ? host : stranger, created.role === 'white' ? stranger : host);
  await game.play([
    { from: 'd2', to: 'd4' },
    { from: 'd7', to: 'd5' },
  ]);

  // Third client (lowercase code) → spectator with the full history.
  const watcher = await peer(url, 'watcher');
  watcher.send({ t: 'join', code: created.room.code.toLowerCase() });
  const watched = await watcher.expect('room');
  eq(watched.role, 'spectator', 'a third client joining a game in progress becomes a spectator');
  eq(watched.room.code, created.room.code, 'lowercase room codes are normalised');
  eq(watched.room.moves.length, 2, 'the spectator receives the full move history');
  eq(watched.room.moves.map((/** @type {any} */ m) => m.san), ['d4', 'd5'], 'the history is ordered and carries SAN');
  eq(watched.room.spectators, 1, 'RoomState reports the spectator count');
  ok(watched.room.clocks !== null, 'the spectator receives the authoritative clocks');
  eq(watched.room.players.white?.connected, true, 'the spectator sees both players as connected');

  eq((await game.white.expect('spectators')).count, 1, 'players are notified of the spectator count');

  const [live] = await game.play([{ from: 'c2', to: 'c4' }]);
  const relayed = await watcher.waitFor((m) => m.t === 'move' && m.move.ply === live.move.ply, 'relayed move');
  eq(relayed.move.san, 'c4', 'spectators receive live move broadcasts');
  ok(relayed.clocks !== null, 'spectators receive the clocks with each move');

  watcher.send({ t: 'move', from: 'e7', to: 'e5', ply: game.ply });
  eq((await watcher.expect('error')).code, 'not-playing', 'a spectator cannot move → error not-playing');
  await watcher.expect('resync');
  ok(true, 'a spectator rejection is followed by a resync');

  watcher.send({ t: 'leave' });
  eq((await game.white.expect('spectators')).count, 0, 'a spectator leaving broadcasts the new count');

  host.close();
  stranger.close();
  watcher.close();
}

/** @param {string} url */
async function resignAndRematch(url) {
  const { white, black, roomA, game } = await matchedPair(url, '10+0', 'standard', 'resign');
  await game.play([{ from: 'e2', to: 'e4' }]);

  white.send({ t: 'resign' });
  const overW = await white.expect('over');
  const overB = await black.expect('over');
  eq(overW.result, '0-1', 'white resigning ends 0-1');
  eq(overW.reason, 'resignation', 'resignation is reported as the reason');
  eq(overW.winner, 'b', 'resignation awards the win to black');
  eq(overB.reason, 'resignation', 'both players are told about the resignation');

  white.send({ t: 'rematch' });
  const offer = await black.expect('rematchOffer');
  eq(offer.by, 'white', 'a rematch request is forwarded as rematchOffer tagged with the asker');
  ok(!white.everSaw('rematchOffer'), 'the asker does not receive their own rematchOffer');

  black.send({ t: 'rematch' });
  const newWhite = await white.waitFor((m) => m.t === 'room' && m.room.moves.length === 0, 'rematch room (A)');
  const newBlack = await black.waitFor((m) => m.t === 'room' && m.room.moves.length === 0, 'rematch room (B)');
  eq(newWhite.role, 'black', 'the previous white plays black in the rematch');
  eq(newBlack.role, 'white', 'the previous black plays white in the rematch');
  eq(newWhite.room.code, roomA.room.code, 'the rematch reuses the same room code');
  eq(newWhite.room.status, { state: 'playing' }, 'the rematch starts immediately');
  eq(newWhite.room.moves, [], 'the rematch starts from a fresh move list');
  eq(newWhite.room.clocks?.w, 600_000, 'the rematch resets both clocks to the initial time');

  // Prove the swap is real: the previous black now has the first move.
  game.swapColours();
  const [opening] = await game.play([{ from: 'd2', to: 'd4' }]);
  eq(opening.move.san, 'd4', 'the swapped colours are accepted by the move validator');

  white.close();
  black.close();
}

/** @param {string} url */
async function drawFlow(url) {
  const { white, black, game } = await matchedPair(url, '15+10', 'standard', 'draw');
  await game.play([
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
  ]);

  white.send({ t: 'drawOffer' });
  eq((await black.expect('drawOffer')).by, 'white', 'a draw offer reaches the opponent tagged with the offerer role');
  ok(!white.everSaw('drawOffer'), 'the offerer does not receive their own draw offer');

  black.send({ t: 'drawDecline' });
  await white.expect('drawDeclined');
  ok(true, 'declining a draw sends drawDeclined to the offerer');

  black.send({ t: 'drawOffer' });
  eq((await white.expect('drawOffer')).by, 'black', 'the opponent can offer a draw in turn');

  white.send({ t: 'drawAccept' });
  const overW = await white.expect('over');
  const overB = await black.expect('over');
  eq(overW.result, '1/2-1/2', 'accepting a draw ends 1/2-1/2');
  eq(overW.reason, 'agreement', 'an accepted draw is reported with reason agreement');
  eq(overW.winner, null, 'an accepted draw has no winner');
  eq(overB.result, '1/2-1/2', 'both players receive the draw result');

  white.close();
  black.close();
}

/** @param {string} url */
async function unqueueFlow(url) {
  const a = await peer(url, 'unqueue-A');
  a.send({ t: 'queue', tc: '1+0', variant: 'standard' });
  await a.expect('queued');
  a.send({ t: 'unqueue' });
  await a.expect('unqueued');
  ok(true, 'unqueue is acknowledged with `unqueued`');

  const b = await peer(url, 'unqueue-B');
  b.send({ t: 'queue', tc: '1+0', variant: 'standard' });
  eq((await b.expect('queued')).size, 1, 'an unqueued client no longer occupies the queue');
  await sleep(150);
  ok(!b.everSaw('room'), 'a lone queued client is not matched');
  a.close();
  b.close();
}

/** Queues are keyed by variant + time control, so mismatched clients never pair. */
async function queueKeying(url) {
  const a = await peer(url, 'key-A');
  const b = await peer(url, 'key-B');
  a.send({ t: 'queue', tc: '3+2', variant: 'standard' });
  eq((await a.expect('queued')).size, 1, 'a standard 3+2 seeker queues alone');
  b.send({ t: 'queue', tc: '3+2', variant: 'fog' });
  eq((await b.expect('queued')).size, 1, 'a fog 3+2 seeker gets its own queue');
  await sleep(150);
  ok(!a.everSaw('room') && !b.everSaw('room'), 'different variants on the same time control do not match');
  a.close();
  b.close();
}

/** The server adjudicates flag-fall itself, on a server booted with a tiny clock. */
async function flagFall() {
  // Equivalent to running the server with TEST_FAST_CLOCK_MS=400.
  const srv = await boot({ initialMsOverride: 400 });
  const { white, black, roomA, game } = await matchedPair(srv.url, '3+0', 'standard', 'flag');
  eq(roomA.room.clocks?.w, 400, 'TEST_FAST_CLOCK_MS shortens the initial time');

  // White's free first move starts black's 400ms clock.
  await game.play([{ from: 'e2', to: 'e4' }]);
  // Black deliberately idles. Nobody claims the win — the server must act.
  const over = await black.expect('over', 3_000);
  const overW = await white.expect('over', 3_000);
  eq(over.reason, 'timeout', 'an idle player is flagged by the server with no claim from either side');
  eq(over.result, '1-0', 'the flag-fall result favours the player with time left');
  eq(over.winner, 'w', 'the flagged player loses');
  eq(over.clocks?.b, 0, "the flagged player's clock is reported at zero");
  eq(over.clocks?.active, null, 'the clocks are stopped after a flag-fall');
  eq(overW.reason, 'timeout', 'both players are told about the flag-fall');

  black.send({ t: 'move', from: 'e7', to: 'e5', ply: 1 });
  eq((await black.expect('error')).code, 'not-playing', 'a move after the flag → error not-playing');
  white.close();
  black.close();

  // The material rule that downgrades a flag-fall win to `timeout-vs-insufficient`.
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/4K3 w - - 0 1', 'w'), false, 'a bare king cannot mate → draw on time');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/4KN2 w - - 0 1', 'w'), false, 'king + single knight cannot mate');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/4KB2 w - - 0 1', 'w'), false, 'king + single bishop cannot mate');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/3NKN2 w - - 0 1', 'w'), true, 'king + two knights can mate');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/4KB1B w - - 0 1', 'w'), true, 'king + two bishops can mate');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', 'w'), true, 'king + pawn can mate');
  eq(hasMatingMaterial('8/8/8/4k3/8/8/8/4K2R w - - 0 1', 'w'), true, 'king + rook can mate');
  eq(hasMatingMaterial('7q/8/8/4k3/8/8/8/4K3 w - - 0 1', 'b'), true, 'mating material is counted per colour');
}

/** @param {string} url */
async function unlimitedClocks(url) {
  const { a, b, roomA, game } = await matchedPair(url, 'unlimited', 'standard', 'unlimited');
  eq(roomA.room.clocks, null, '`unlimited` rooms report clocks: null');
  const [mv] = await game.play([{ from: 'e2', to: 'e4' }]);
  eq(mv.clocks, null, '`unlimited` move broadcasts carry clocks: null');
  a.close();
  b.close();
}

/** @param {string} url */
async function chess960(url) {
  const { a, b, roomA } = await matchedPair(url, '5+0', 'chess960', 'c960');
  const id = roomA.room.chess960Id;
  ok(Number.isInteger(id) && id >= 0 && id < 960, `a Chess960 room reports a chess960Id (got ${id})`);
  eq(roomA.room.startFen, chess960Setup(id).fen, 'the start FEN comes from chess960Setup(chess960Id)');
  eq(roomA.room.variant, 'chess960', 'RoomState reports the chess960 variant');
  a.close();
  b.close();

  // Position 518 is the orthodox back rank: there the king-onto-rook encoding
  // (e1→h1) differs from the king's real destination (g1), which is the case
  // worth proving.
  const srv = await boot({ chess960Id: 518 });
  const { white, black, roomA: pinned, game } = await matchedPair(srv.url, '3+0', 'chess960', 'c960-castle');
  eq(pinned.room.chess960Id, 518, 'TEST_CHESS960_ID pins the Chess960 position');
  eq(pinned.room.startFen, chess960Setup(518).fen, 'the pinned room starts from the matching FEN');

  await game.play([
    { from: 'g1', to: 'f3' },
    { from: 'g8', to: 'f6' },
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
    { from: 'f1', to: 'c4' },
    { from: 'f8', to: 'c5' },
  ]);

  const ply = game.ply;
  white.send({ t: 'move', from: 'e1', to: 'h1', ply });
  const castle = await black.waitFor((m) => m.t === 'move' && m.move.ply === ply, 'castling broadcast');
  eq(castle.move.san, 'O-O', 'king-onto-rook (e1→h1) is accepted as castling');
  eq(castle.move.from, 'e1', 'the castling broadcast keeps the king origin');
  eq(castle.move.to, 'g1', 'the castling broadcast normalises the king destination to g1');
  ok(castle.move.fen.startsWith('rnbqk2r/pppp1ppp'), 'the position after castling is authoritative');
  ok(castle.move.fen.includes('RNBQ1RK1'), 'the rook really moved to f1 alongside the king');
  white.close();
  black.close();
}

/** @param {string} url */
async function fogOfWar(url) {
  const { white, black, roomA, game } = await matchedPair(url, '5+0', 'fog', 'fog');
  eq(roomA.room.variant, 'fog', 'RoomState reports the fog variant');
  eq(roomA.room.chess960Id, undefined, 'non-Chess960 rooms omit chess960Id');

  const setup = [
    { from: 'e2', to: 'e4' },
    { from: 'e7', to: 'e5' },
    { from: 'd1', to: 'h5' },
    { from: 'g8', to: 'f6' },
    { from: 'h5', to: 'e5' }, // Qxe5 — this is check under standard rules.
  ];
  await game.play(setup);

  // Prove the next move really is illegal under standard rules.
  const reference = createEngine('standard');
  for (const m of setup) reference.move(m);
  eq(reference.move({ from: 'a7', to: 'a6' }), null, 'ignoring a check is illegal in standard chess');

  const fogPly = game.ply;
  black.send({ t: 'move', from: 'a7', to: 'a6', ply: fogPly });
  const fogMove = await white.waitFor((m) => m.t === 'move' && m.move.ply === fogPly, 'fog move broadcast');
  eq(fogMove.move.san, 'a6', 'Fog of War accepts a move that leaves the king attacked');

  const capturePly = fogPly + 1;
  white.send({ t: 'move', from: 'e5', to: 'e8', ply: capturePly });
  const capture = await black.waitFor((m) => m.t === 'move' && m.move.ply === capturePly, 'king capture broadcast');
  eq(capture.move.san, 'Qxe8', 'the king capture is broadcast');
  const over = await black.expect('over');
  eq(over.reason, 'king-captured', 'Fog of War ends via king-captured');
  eq(over.result, '1-0', 'the king capture wins the game');
  eq(over.winner, 'w', 'the capturing side wins');

  white.close();
  black.close();
}

/** Disconnect → presence, reconnection inside the grace window, then abandonment. */
async function disconnectAndReconnect() {
  const srv = await boot({ abandonGraceMs: 600 });

  {
    const { white, black, roomA, game } = await matchedPair(srv.url, '5+0', 'standard', 'recon');
    const code = roomA.room.code;
    await game.play([{ from: 'e2', to: 'e4' }]);

    white.ws.terminate();
    const dropped = await black.expect('presence');
    eq(dropped.white?.connected, false, 'a dropped player is broadcast as disconnected via presence');
    eq(dropped.black?.connected, true, 'the remaining player is still reported connected');

    const rejoined = await peer(srv.url, 'recon-A2');
    rejoined.send({ t: 'join', code });
    const resumed = await rejoined.expect('room');
    eq(resumed.role, 'white', 'reconnecting with the same room code reclaims the same seat');
    eq(resumed.room.moves.length, 1, 'the reconnected player receives the move history');
    eq(resumed.room.status, { state: 'playing' }, 'the game is still live after a reconnect');
    const back = await black.waitFor((m) => m.t === 'presence' && m.white?.connected === true, 'presence restored');
    eq(back.white?.connected, true, 'presence reports the reconnected player');

    await sleep(900); // Comfortably longer than the 600ms grace window.
    ok(!black.everSaw('over'), 'reconnecting inside the grace window cancels abandonment');

    game.white = rejoined;
    const [reply] = await game.play([{ from: 'e7', to: 'e5' }]);
    eq(reply.move.san, 'e5', 'the game continues normally after the reconnect');
    rejoined.close();
    black.close();
  }

  {
    const { white, black, game } = await matchedPair(srv.url, '10+0', 'standard', 'abandon');
    await game.play([{ from: 'e2', to: 'e4' }]);
    white.ws.terminate();
    await black.expect('presence');
    const over = await black.expect('over', 3_000);
    eq(over.reason, 'abandoned', 'an expired grace window ends the game with reason abandoned');
    eq(over.result, '0-1', 'abandonment favours the player still present');
    eq(over.winner, 'b', 'the player who stayed wins');
    black.close();
  }
}

/** An explicit `leave` is deliberate, so it forfeits at once rather than idling out a grace window. */
async function leaveForfeits() {
  const srv = await boot({ abandonGraceMs: 30_000 });
  const { white, black, game } = await matchedPair(srv.url, '5+0', 'standard', 'leave');
  await game.play([{ from: 'e2', to: 'e4' }]);

  white.send({ t: 'leave' });
  const over = await black.expect('over', 2_000); // Must NOT wait out the 30s grace.
  eq(over.reason, 'abandoned', 'leaving a live game ends it immediately as abandoned');
  eq(over.winner, 'b', 'the player who stayed wins after an opponent leaves');

  // And the quitter is free to queue, without a stale seat pinning the old room.
  white.send({ t: 'queue', tc: '5+0', variant: 'standard' });
  eq((await white.expect('queued')).size, 1, 'a client that left can queue again');
  white.send({ t: 'unqueue' });
  await white.expect('unqueued');
  white.close();
  black.close();
}

/** A reclaimed seat keeps the original player's name: the chair is not an identity. */
async function seatIdentity() {
  const srv = await boot({ abandonGraceMs: 2_000 });
  const { white, black, roomA, game } = await matchedPair(srv.url, '5+0', 'standard', 'seat');
  // The white seat is the one that gets vacated and reclaimed below.
  const originalName = roomA.room.players.white?.name;
  await game.play([{ from: 'e2', to: 'e4' }]);

  white.ws.terminate();
  await black.expect('presence');
  const taker = await peer(srv.url, 'IMPOSTOR');
  taker.send({ t: 'join', code: roomA.room.code });
  const seated = await taker.expect('room');
  eq(seated.room.players.white?.name, originalName, 'a reclaimed seat keeps the original player name');
  ok(seated.room.players.white?.name !== 'IMPOSTOR', 'reconnecting does not rewrite the scoresheet');
  taker.close();
  black.close();
}

/** `move.ply` is required by the protocol: it is the desync guard. */
async function plyIsRequired(url) {
  const { a, b, white } = await matchedPair(url, '3+2', 'standard', 'ply');
  white.send({ t: 'move', from: 'e2', to: 'e4' });
  eq((await white.expect('error')).code, 'bad-message', 'a `move` without `ply` → error bad-message');
  await white.expect('resync');
  ok(true, 'a `move` without `ply` is followed by a resync');

  white.send({ t: 'move', from: 'e2', to: 'e4', ply: 'zero' });
  eq((await white.expect('error')).code, 'bad-message', 'a non-numeric `ply` → error bad-message');
  await white.expect('resync');

  white.send({ t: 'ping' });
  eq((await white.expect('error')).code, 'bad-message', 'a `ping` without a numeric `t0` → error bad-message');
  a.close();
  b.close();
}

/** Nothing should hold a room open forever just by never making the free first move. */
async function openingAbort() {
  const srv = await boot({ firstMoveAbortMs: 400 });
  const { white, black } = await matchedPair(srv.url, 'unlimited', 'standard', 'abort');
  const over = await black.expect('over', 3_000);
  eq(over.reason, 'abandoned', 'a game where the opening move never arrives is aborted');
  eq(over.winner, 'b', 'the waiting player is awarded the aborted game');
  ok(!white.everSaw('move'), 'no move was ever played in the aborted game');
  white.close();
  black.close();
}

/** Fog of War flag-fall must not be downgraded by the mate-material rule. */
async function fogFlagFall() {
  const srv = await boot({ initialMsOverride: 350 });
  const { white, black, game } = await matchedPair(srv.url, '3+0', 'fog', 'fogflag');
  await game.play([{ from: 'e2', to: 'e4' }]);
  const over = await black.expect('over', 3_000);
  eq(over.reason, 'timeout', 'a Fog of War game is flagged by the server too');
  eq(over.winner, 'w', 'the Fog of War flag-fall awards the win, never a material draw');
  white.close();
  black.close();
}

/** The connection cap is a back-stop against socket exhaustion. */
async function connectionCap() {
  const srv = await boot({ maxConnections: 1 });
  const first = await peer(srv.url, 'cap-first');
  const second = new Peer(srv.url, 'cap-second');
  allPeers.push(second);
  await second.open();
  const err = await second.expect('error', 2_000);
  eq(err.code, 'rate-limited', 'a connection beyond maxConnections is refused');
  first.close();
  second.close();
}

/** @param {number} port */
async function health(port) {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  eq(res.status, 200, 'GET /health returns 200');
  eq(res.headers.get('content-type'), 'application/json; charset=utf-8', 'GET /health returns JSON');
  const body = await res.json();
  eq(body.ok, true, 'GET /health reports ok: true');
  ok(typeof body.rooms === 'number', 'GET /health reports a numeric room count');
  ok(typeof body.clients === 'number', 'GET /health reports a numeric client count');
  eq((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404, 'unknown HTTP paths return 404');
}

/* ───────────────────────────── runner ───────────────────────────── */

async function run() {
  const server = await boot();

  await suite('protocol parity with src/multiplayer/protocol.ts', () => protocolParity());
  await suite('Chess960 id ↔ startFen contract (all 960 positions)', () => chess960FenContract());
  await suite('RTT estimator cannot be inflated by a client', () => rttEstimator());
  await suite('handshake, errors and flood protection', () => handshake(server.url));
  await suite('matchmaking + a full game to mate, with clocks', () => queueAndFullGame(server.url));
  await suite('Fischer increment', () => incrementApplied(server.url));
  await suite('rejections are followed by a resync', () => rejectionsAndResync(server.url));
  await suite('private rooms and spectators', () => privateRoomAndSpectator(server.url));
  await suite('resignation and rematch with swapped colours', () => resignAndRematch(server.url));
  await suite('draw offer / decline / accept', () => drawFlow(server.url));
  await suite('queue and unqueue', () => unqueueFlow(server.url));
  await suite('queues are keyed by variant + time control', () => queueKeying(server.url));
  await suite('`move.ply` and `ping.t0` are required', () => plyIsRequired(server.url));
  await suite('unlimited time control', () => unlimitedClocks(server.url));
  await suite('server-adjudicated flag-fall', () => flagFall());
  await suite('Fog of War flag-fall is not downgraded', () => fogFlagFall());
  await suite('Chess960 with king-onto-rook castling', () => chess960(server.url));
  await suite('Fog of War: into-check legal, king-captured', () => fogOfWar(server.url));
  await suite('disconnect, reconnect grace and abandonment', () => disconnectAndReconnect());
  await suite('`leave` forfeits immediately', () => leaveForfeits());
  await suite('a reclaimed seat keeps its identity', () => seatIdentity());
  await suite('the opening move has an abort window', () => openingAbort());
  await suite('connection cap', () => connectionCap());
  await suite('GET /health', () => health(server.port));

  for (const p of allPeers) p.close();
  await sleep(100);
  for (const s of allServers) await s.close();

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.log(`FAIL harness crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
