/**
 * The hub owns every connection, the matchmaking queues and the room registry,
 * and routes each `ClientMessage` to the right handler.
 */
import { Client } from './client.mjs';
import {
  coinFlip,
  generateRoomCode,
  isPromotion,
  isSquare,
  isTimeControlId,
  isVariantId,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './protocol.mjs';
import { DEFAULT_ABANDON_GRACE_MS, Room } from './room.mjs';

const MAX_NAME_LENGTH = 24;
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
/** Repeated throttling notices would themselves be a flood, so rate-limit them. */
const RATE_WARN_INTERVAL_MS = 1_000;

/**
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeName(raw) {
  if (typeof raw !== 'string') return 'Anonymous';
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Anonymous';
}

export class Hub {
  /**
   * @param {object} [opts]
   * @param {number|null} [opts.initialMsOverride] Test-only shortened initial clock.
   * @param {number|null} [opts.chess960Id] Test-only forced Chess960 position id.
   * @param {number} [opts.abandonGraceMs]
   * @param {number} [opts.heartbeatMs]
   * @param {number} [opts.clockTickMs]
   * @param {(msg: string) => void} [opts.log]
   */
  constructor({
    initialMsOverride = null,
    chess960Id = null,
    abandonGraceMs = DEFAULT_ABANDON_GRACE_MS,
    heartbeatMs = 5_000,
    clockTickMs = 5_000,
    log = () => {},
  } = {}) {
    this.initialMsOverride = initialMsOverride;
    this.chess960Id = chess960Id;
    this.abandonGraceMs = abandonGraceMs;
    this.log = log;

    /** @type {Set<Client>} */
    this.clients = new Set();
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Map<string, Client[]>} variant|tc → waiting clients, FIFO. */
    this.queues = new Map();

    this.heartbeat = setInterval(() => this.#heartbeat(), heartbeatMs);
    this.heartbeat.unref?.();
    this.ticker = setInterval(() => {
      for (const room of this.rooms.values()) room.tickClocks();
    }, clockTickMs);
    this.ticker.unref?.();
  }

  /** @returns {{ ok: true, rooms: number, clients: number }} */
  healthSnapshot() {
    return { ok: true, rooms: this.rooms.size, clients: this.clients.size };
  }

  /** @returns {void} */
  close() {
    clearInterval(this.heartbeat);
    clearInterval(this.ticker);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.queues.clear();
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
    this.clients.clear();
  }

  /* ───────────────────────────── connections ───────────────────────────── */

  /**
   * @param {import('ws').WebSocket} ws
   * @returns {Client}
   */
  handleConnection(ws) {
    const client = new Client(ws);
    this.clients.add(client);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        client.error('bad-message', 'Binary frames are not supported.');
        return;
      }
      this.#onRaw(client, data.toString());
    });
    ws.on('pong', () => {
      client.alive = true;
      // Both ends of this measurement are server-clock readings, so it is a
      // true round trip with no client clock-skew to correct for.
      if (client.pingSentAt) client.rtt.addRoundTrip(Date.now() - client.pingSentAt);
      client.pingSentAt = 0;
    });
    ws.on('close', () => this.#onClose(client));
    ws.on('error', () => this.#onClose(client));
    return client;
  }

  /**
   * @param {Client} client
   */
  #onClose(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    this.#dequeue(client);
    client.room?.detach(client);
  }

  #heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.pingSentAt = Date.now();
      try {
        client.ws.ping();
      } catch {
        client.ws.terminate();
      }
    }
  }

  /* ───────────────────────────── message plumbing ───────────────────────────── */

  /**
   * @param {Client} client
   * @param {string} raw
   */
  #onRaw(client, raw) {
    const now = Date.now();
    if (!client.limiter.take(now)) {
      if (now - client.lastRateWarnAt > RATE_WARN_INTERVAL_MS) {
        client.lastRateWarnAt = now;
        client.error('rate-limited', 'Slow down: too many messages.');
      }
      return;
    }
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      client.error('bad-message', 'Payload is not valid JSON.');
      return;
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg) || typeof msg.t !== 'string') {
      client.error('bad-message', 'Expected an object with a string `t`.');
      return;
    }
    try {
      this.#dispatch(client, msg);
    } catch (err) {
      this.log(`dispatch failed for ${msg.t}: ${err instanceof Error ? err.message : String(err)}`);
      client.error('bad-message', `Could not handle ${msg.t}.`);
    }
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #dispatch(client, msg) {
    if (!client.greeted) {
      if (msg.t !== 'hello') {
        client.error('bad-message', 'Send `hello` before anything else.');
        return;
      }
      this.#onHello(client, msg);
      return;
    }

    switch (msg.t) {
      case 'hello':
        client.error('bad-message', 'Already greeted.');
        return;
      case 'ping':
        this.#onPing(client, msg);
        return;
      case 'queue':
        this.#onQueue(client, msg);
        return;
      case 'unqueue':
        this.#dequeue(client);
        client.send({ t: 'unqueued' });
        return;
      case 'create':
        this.#onCreate(client, msg);
        return;
      case 'join':
        this.#onJoin(client, msg);
        return;
      case 'move':
        this.#onMove(client, msg);
        return;
      case 'resign':
        this.#withRoom(client, (room) => room.resign(client));
        return;
      case 'drawOffer':
        this.#withRoom(client, (room) => room.offerDraw(client));
        return;
      case 'drawAccept':
        this.#withRoom(client, (room) => room.acceptDraw(client));
        return;
      case 'drawDecline':
        this.#withRoom(client, (room) => room.declineDraw(client));
        return;
      case 'rematch':
        this.#withRoom(client, (room) => room.requestRematch(client));
        return;
      case 'leave':
        this.#dequeue(client);
        client.room?.detach(client);
        return;
      default:
        client.error('bad-message', `Unknown message type \`${msg.t}\`.`);
    }
  }

  /**
   * @param {Client} client
   * @param {(room: Room) => void} fn
   */
  #withRoom(client, fn) {
    if (!client.room) {
      client.error('not-playing', 'You are not in a room.');
      return;
    }
    fn(client.room);
  }

  /* ───────────────────────────── handlers ───────────────────────────── */

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onHello(client, msg) {
    if (typeof msg.v !== 'number' || !Number.isFinite(msg.v)) {
      client.error('bad-message', '`hello.v` must be a number.');
      return;
    }
    if (msg.v !== PROTOCOL_VERSION) {
      client.error('version-mismatch', `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${msg.v}.`);
      // `close()` flushes the queued error frame first, so the client still sees why.
      client.ws.close(1002, 'protocol version mismatch');
      return;
    }
    client.name = sanitizeName(msg.name);
    client.greeted = true;
    client.send({ t: 'hello', id: client.id, v: PROTOCOL_VERSION });
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onPing(client, msg) {
    const serverTs = Date.now();
    if (typeof msg.t0 === 'number') client.rtt.addPing(msg.t0, serverTs);
    client.send({ t: 'pong', t0: msg.t0, serverTs });
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onQueue(client, msg) {
    if (client.room) {
      client.error('already-in-room', 'Leave your current room before queueing.');
      return;
    }
    if (!isTimeControlId(msg.tc) || !isVariantId(msg.variant)) {
      client.error('bad-message', 'queue needs a valid `tc` and `variant`.');
      return;
    }
    this.#dequeue(client); // Re-queueing with different settings is allowed.
    const key = `${msg.variant}|${msg.tc}`;
    const queue = this.queues.get(key) ?? [];
    queue.push(client);
    this.queues.set(key, queue);
    client.queueKey = key;
    client.send({ t: 'queued', tc: msg.tc, variant: msg.variant, size: queue.length });
    this.#tryMatch(key, msg.variant, msg.tc);
  }

  /**
   * @param {Client} client
   */
  #dequeue(client) {
    if (!client.queueKey) return;
    const queue = this.queues.get(client.queueKey);
    if (queue) {
      const i = queue.indexOf(client);
      if (i >= 0) queue.splice(i, 1);
      if (queue.length === 0) this.queues.delete(client.queueKey);
    }
    client.queueKey = null;
  }

  /**
   * Pairs the two longest-waiting clients sharing a queue key.
   * @param {string} key
   * @param {import('./protocol.mjs').VariantId} variant
   * @param {import('./protocol.mjs').TimeControlId} tc
   */
  #tryMatch(key, variant, tc) {
    const queue = this.queues.get(key);
    if (!queue) return;
    while (queue.length >= 2) {
      const a = queue.shift();
      const b = queue.shift();
      if (!a || !b) return;
      // Drop sockets that died while waiting instead of pairing them.
      if (!this.clients.has(a)) {
        a.queueKey = null;
        if (b) queue.unshift(b);
        continue;
      }
      if (!this.clients.has(b)) {
        b.queueKey = null;
        queue.unshift(a);
        continue;
      }
      a.queueKey = null;
      b.queueKey = null;
      const room = this.#createRoom(variant, tc, false);
      // Colours come from a CSPRNG coin flip, never from queue order.
      const whiteFirst = coinFlip();
      room.seat(whiteFirst ? a : b, 'white');
      room.seat(whiteFirst ? b : a, 'black');
      room.startGame();
      room.sendRoom(a);
      room.sendRoom(b);
      this.log(`matched ${a.id} vs ${b.id} in ${room.code} (${variant} ${tc})`);
    }
    if (queue.length === 0) this.queues.delete(key);
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onCreate(client, msg) {
    if (client.room) {
      client.error('already-in-room', 'You are already in a room.');
      return;
    }
    if (!isTimeControlId(msg.tc) || !isVariantId(msg.variant)) {
      client.error('bad-message', 'create needs a valid `tc` and `variant`.');
      return;
    }
    this.#dequeue(client);
    const room = this.#createRoom(msg.variant, msg.tc, true);
    room.seat(client, coinFlip() ? 'white' : 'black');
    room.sendRoom(client);
    this.log(`${client.id} created private room ${room.code} (${msg.variant} ${msg.tc})`);
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onJoin(client, msg) {
    if (client.room) {
      client.error('already-in-room', 'You are already in a room.');
      return;
    }
    const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
    if (!ROOM_CODE_RE.test(code)) {
      client.error('room-not-found', 'Malformed room code.');
      return;
    }
    const room = this.rooms.get(code);
    if (!room) {
      client.error('room-not-found', `No room with code ${code}.`);
      return;
    }
    this.#dequeue(client);
    const admitted = room.admit(client);
    if ('error' in admitted) {
      client.error(admitted.error, 'This room cannot take any more watchers.');
      return;
    }
    if (room.status.state === 'waiting' && room.bothSeated) {
      room.startGame();
      room.broadcastRoom(); // Everyone needs the `playing` status, not just the joiner.
      this.log(`room ${code} started (${room.variant} ${room.tc})`);
      return;
    }
    // Spectators and reconnecting players get the full authoritative state,
    // including every move played so far.
    room.sendRoom(client, admitted.role);
  }

  /**
   * @param {Client} client
   * @param {any} msg
   */
  #onMove(client, msg) {
    const room = client.room;
    if (!room) {
      client.error('not-playing', 'You are not in a room.');
      return;
    }
    if (!isSquare(msg.from) || !isSquare(msg.to) || (msg.promotion !== undefined && !isPromotion(msg.promotion))) {
      room.reject(client, 'bad-message', 'move needs valid `from`/`to` squares.');
      return;
    }
    room.applyMove(client, {
      from: msg.from,
      to: msg.to,
      ...(msg.promotion ? { promotion: msg.promotion } : {}),
      ...(typeof msg.ply === 'number' ? { ply: msg.ply } : {}),
    });
  }

  /* ───────────────────────────── rooms ───────────────────────────── */

  /**
   * @param {import('./protocol.mjs').VariantId} variant
   * @param {import('./protocol.mjs').TimeControlId} tc
   * @param {boolean} isPrivate
   * @returns {Room}
   */
  #createRoom(variant, tc, isPrivate) {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room({
      code,
      variant,
      tc,
      isPrivate,
      initialMsOverride: this.initialMsOverride,
      chess960Id: this.chess960Id,
      abandonGraceMs: this.abandonGraceMs,
      onEmpty: (r) => {
        if (this.rooms.get(r.code) !== r) return;
        this.rooms.delete(r.code);
        r.dispose();
        this.log(`room ${r.code} released`);
      },
    });
    this.rooms.set(code, room);
    return room;
  }
}
