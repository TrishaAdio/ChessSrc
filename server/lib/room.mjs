/**
 * A single game room: authoritative position, clocks, seats and spectators.
 *
 * All rule questions are delegated to the project's own engine
 * (`server/vendor/variant-engine.mjs`), which is the exact bundle the client
 * uses, so the two can never disagree about legality, castling in Chess960 or
 * Fog of War king captures.
 */
import { chess960Setup, createEngine, randomChess960Id } from '../vendor/variant-engine.mjs';
import { GameClock, hasMatingMaterial } from './clock.mjs';
import { opposite, roleToColor } from './protocol.mjs';

/** @typedef {import('./client.mjs').Client} Client */
/** @typedef {import('./protocol.mjs').Color} Color */
/** @typedef {import('./protocol.mjs').Role} Role */
/** @typedef {import('./protocol.mjs').TimeControlId} TimeControlId */
/** @typedef {import('./protocol.mjs').VariantId} VariantId */
/** @typedef {{ name: string, client: Client|null, graceTimer: NodeJS.Timeout|null }} Seat */

/** A room keeps at most this many watchers; beyond it joins fail `room-full`. */
export const MAX_SPECTATORS = 64;

/** Reconnection window for a player who drops mid-game. */
export const DEFAULT_ABANDON_GRACE_MS = 30_000;

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.code
   * @param {VariantId} opts.variant
   * @param {TimeControlId} opts.tc
   * @param {boolean} opts.isPrivate
   * @param {number|null} [opts.initialMsOverride] Test-only shortened clock.
   * @param {number|null} [opts.chess960Id] Forced Chess960 position (tests).
   * @param {number} [opts.abandonGraceMs]
   * @param {(room: Room) => void} [opts.onEmpty] Called when nothing references the room.
   */
  constructor({
    code,
    variant,
    tc,
    isPrivate,
    initialMsOverride = null,
    chess960Id = null,
    abandonGraceMs = DEFAULT_ABANDON_GRACE_MS,
    onEmpty = () => {},
  }) {
    /** @readonly */ this.code = code;
    /** @readonly */ this.variant = variant;
    /** @readonly */ this.tc = tc;
    /** @readonly */ this.private = isPrivate;
    /** @readonly */ this.createdAt = Date.now();
    this.abandonGraceMs = abandonGraceMs;
    this.forcedChess960Id = chess960Id;
    this.onEmpty = onEmpty;

    /** @type {{ white: Seat|null, black: Seat|null }} */
    this.seats = { white: null, black: null };
    /** @type {Set<Client>} */
    this.spectators = new Set();
    /** @type {import('../../src/multiplayer/protocol').RoomStatus} */
    this.status = { state: 'waiting' };
    /** @type {Role|null} Who has a draw offer outstanding. */
    this.drawOfferBy = null;
    /** @type {Set<'white'|'black'>} */
    this.rematchAsked = new Set();
    /** @type {Array<{ ply: number, from: string, to: string, promotion?: string, san: string, lan: string, fen: string }>} */
    this.moves = [];

    this.clock = new GameClock(tc, {
      initialMsOverride,
      onFlag: (color) => this.#onFlag(color),
    });

    this.#newGame();
  }

  /* ───────────────────────────── lifecycle ───────────────────────────── */

  /**
   * Builds a fresh position for this room's variant.
   * @param {number|null} [forcedId]
   */
  #newGame(forcedId = undefined) {
    if (this.variant === 'chess960') {
      const id = forcedId ?? this.forcedChess960Id ?? randomChess960Id();
      const setup = chess960Setup(id);
      /** @type {number|undefined} */ this.chess960Id = setup.id;
      this.startFen = setup.fen;
    } else {
      this.chess960Id = undefined;
      this.startFen = undefined; // createEngine applies the standard default
    }
    this.engine = createEngine(this.variant, this.startFen);
    // Normalise: always report the concrete FEN the game actually started from.
    this.startFen = this.engine.fen();
    this.moves = [];
    this.drawOfferBy = null;
    this.rematchAsked.clear();
  }

  /** @returns {boolean} */
  get isPlaying() {
    return this.status.state === 'playing';
  }

  /** @returns {boolean} True when the room holds no clients and no pending reconnects. */
  get isAbandonedShell() {
    if (this.spectators.size > 0) return false;
    for (const role of /** @type {const} */ (['white', 'black'])) {
      const seat = this.seats[role];
      if (seat && (seat.client || seat.graceTimer)) return false;
    }
    return true;
  }

  /** @returns {void} */
  dispose() {
    this.clock.dispose();
    for (const role of /** @type {const} */ (['white', 'black'])) {
      const seat = this.seats[role];
      if (seat?.graceTimer) clearTimeout(seat.graceTimer);
      if (seat) seat.graceTimer = null;
    }
  }

  /* ───────────────────────────── membership ───────────────────────────── */

  /**
   * @param {Client} client
   * @returns {Role|null}
   */
  roleOf(client) {
    if (this.seats.white?.client === client) return 'white';
    if (this.seats.black?.client === client) return 'black';
    if (this.spectators.has(client)) return 'spectator';
    return null;
  }

  /**
   * Seats a client at a specific colour (matchmaking / room creation).
   * @param {Client} client
   * @param {'white'|'black'} role
   * @returns {void}
   */
  seat(client, role) {
    this.seats[role] = { name: client.name, client, graceTimer: null };
    client.room = this;
    client.role = role;
  }

  /**
   * Admits a joining client: reclaim a dropped seat, fill a free seat, else watch.
   *
   * Reclaiming takes priority over spectating so that a player who reconnects
   * with the same room code inside the grace window lands back in their chair
   * instead of becoming a bystander in their own game.
   *
   * @param {Client} client
   * @returns {{ role: Role }|{ error: 'room-full' }}
   */
  admit(client) {
    for (const role of /** @type {const} */ (['white', 'black'])) {
      const seat = this.seats[role];
      if (seat && !seat.client) {
        // Dropped player returning within the grace window.
        if (seat.graceTimer) clearTimeout(seat.graceTimer);
        seat.graceTimer = null;
        seat.client = client;
        seat.name = client.name;
        client.room = this;
        client.role = role;
        this.#broadcastPresence();
        return { role };
      }
    }
    for (const role of /** @type {const} */ (['white', 'black'])) {
      if (!this.seats[role]) {
        this.seat(client, role);
        this.#broadcastPresence();
        return { role };
      }
    }
    if (this.spectators.size >= MAX_SPECTATORS) return { error: 'room-full' };
    this.spectators.add(client);
    client.room = this;
    client.role = 'spectator';
    this.broadcast({ t: 'spectators', count: this.spectators.size });
    return { role: 'spectator' };
  }

  /** @returns {boolean} True when both seats hold a live connection. */
  get bothSeated() {
    return Boolean(this.seats.white?.client && this.seats.black?.client);
  }

  /**
   * Flips the room to `playing` and starts the clocks.
   * @returns {void}
   */
  startGame() {
    this.status = { state: 'playing' };
    this.clock.start();
  }

  /**
   * Detaches a client (socket close or explicit `leave`).
   *
   * A player who vanishes mid-game keeps their seat for `abandonGraceMs` so a
   * flaky connection does not instantly lose a game; the seat only forfeits
   * when the window closes.
   *
   * @param {Client} client
   * @returns {void}
   */
  detach(client) {
    const role = this.roleOf(client);
    client.room = null;
    client.role = null;
    if (role === 'spectator') {
      this.spectators.delete(client);
      this.broadcast({ t: 'spectators', count: this.spectators.size });
    } else if (role === 'white' || role === 'black') {
      const seat = /** @type {Seat} */ (this.seats[role]);
      seat.client = null;
      this.#broadcastPresence();
      if (this.isPlaying) {
        seat.graceTimer = setTimeout(() => {
          seat.graceTimer = null;
          if (this.isPlaying && !seat.client) this.#abandon(role);
          if (this.isAbandonedShell) this.onEmpty(this);
        }, this.abandonGraceMs);
        seat.graceTimer.unref?.();
      }
    } else {
      return; // not a member
    }
    if (this.isAbandonedShell) this.onEmpty(this);
  }

  /* ───────────────────────────── serialisation ───────────────────────────── */

  /**
   * @param {'white'|'black'} role
   * @returns {{ name: string, connected: boolean }|null}
   */
  #wirePlayer(role) {
    const seat = this.seats[role];
    if (!seat) return null;
    return { name: seat.name, connected: Boolean(seat.client) };
  }

  /**
   * Full authoritative room snapshot (`RoomState`).
   * @param {number} [now]
   * @returns {object}
   */
  serialize(now = Date.now()) {
    return {
      code: this.code,
      variant: this.variant,
      ...(this.chess960Id !== undefined ? { chess960Id: this.chess960Id } : {}),
      startFen: this.startFen,
      tc: this.tc,
      moves: this.moves,
      fen: this.engine.fen(),
      clocks: this.clock.snapshot(now),
      status: this.status,
      players: { white: this.#wirePlayer('white'), black: this.#wirePlayer('black') },
      spectators: this.spectators.size,
      private: this.private,
    };
  }

  /** @returns {Client[]} Every live connection in the room. */
  members() {
    /** @type {Client[]} */
    const out = [];
    if (this.seats.white?.client) out.push(this.seats.white.client);
    if (this.seats.black?.client) out.push(this.seats.black.client);
    for (const s of this.spectators) out.push(s);
    return out;
  }

  /**
   * @param {object} msg
   * @param {Client|null} [except]
   * @returns {void}
   */
  broadcast(msg, except = null) {
    for (const c of this.members()) if (c !== except) c.send(msg);
  }

  /**
   * Sends `client` its own `room` view (role-aware).
   * @param {Client} client
   * @param {Role} [role]
   * @returns {void}
   */
  sendRoom(client, role = /** @type {Role} */ (this.roleOf(client) ?? 'spectator')) {
    client.send({ t: 'room', room: this.serialize(), role });
  }

  /** Re-sends `room` to everyone, each with their own role. @returns {void} */
  broadcastRoom() {
    for (const c of this.members()) this.sendRoom(c);
  }

  /**
   * Sends an error followed by an authoritative `resync`, so a client that has
   * drifted out of step can repair itself without reconnecting.
   * @param {Client} client
   * @param {string} code
   * @param {string} message
   * @returns {void}
   */
  reject(client, code, message) {
    client.error(code, message);
    client.send({ t: 'resync', room: this.serialize(), role: this.roleOf(client) ?? 'spectator' });
  }

  #broadcastPresence() {
    this.broadcast({ t: 'presence', white: this.#wirePlayer('white'), black: this.#wirePlayer('black') });
  }

  /* ───────────────────────────── gameplay ───────────────────────────── */

  /**
   * Validates and applies a move, then broadcasts it with fresh clocks.
   * @param {Client} client
   * @param {{ from: string, to: string, promotion?: string, ply?: number }} req
   * @returns {void}
   */
  applyMove(client, req) {
    const role = this.roleOf(client);
    if (role !== 'white' && role !== 'black') {
      this.reject(client, 'not-playing', 'Only seated players may move.');
      return;
    }
    if (!this.isPlaying) {
      this.reject(client, 'not-playing', `Room is ${this.status.state}, not playing.`);
      return;
    }
    const color = /** @type {Color} */ (roleToColor(role));
    if (this.engine.turn() !== color) {
      this.reject(client, 'not-your-turn', `It is ${this.engine.turn() === 'w' ? 'white' : 'black'} to move.`);
      return;
    }
    // `ply` is the 0-based index of the move being submitted. A mismatch means
    // the client is acting on a stale position, so repair it rather than guess.
    if (typeof req.ply === 'number' && req.ply !== this.moves.length) {
      this.reject(client, 'illegal-move', `Stale ply ${req.ply}; server is at ${this.moves.length}.`);
      return;
    }

    const now = Date.now();
    const charge = this.clock.measure(color, { now, rttMs: client.rttMs });
    if (charge.flagged) {
      // The move arrived after the flag had already fallen.
      this.#onFlag(color);
      return;
    }

    const played = this.engine.move({ from: req.from, to: req.to, promotion: req.promotion });
    if (!played) {
      // Nothing was mutated and no time is charged: an illegal move is free.
      this.reject(client, 'illegal-move', `${req.from}${req.to} is not legal here.`);
      return;
    }

    this.clock.commit(color, charge.elapsed, now);
    const move = {
      ply: this.moves.length,
      // Report the engine's normalised squares: Chess960 castling may be sent
      // as king-onto-rook (e1h1) but is recorded as the real king path (e1g1).
      from: played.from,
      to: played.to,
      ...(played.promotion ? { promotion: played.promotion } : {}),
      san: played.san,
      lan: played.lan,
      fen: this.engine.fen(),
    };
    this.moves.push(move);
    this.drawOfferBy = null; // Moving implicitly withdraws/declines a pending offer.
    this.broadcast({ t: 'move', move, clocks: this.clock.snapshot(now) });

    const outcome = this.engine.outcome();
    if (outcome) this.#end(outcome.result, outcome.reason, outcome.winner);
  }

  /**
   * @param {Client} client
   * @returns {void}
   */
  resign(client) {
    const role = this.roleOf(client);
    if ((role !== 'white' && role !== 'black') || !this.isPlaying) {
      this.reject(client, 'not-playing', 'Nothing to resign.');
      return;
    }
    const winner = opposite(/** @type {Color} */ (roleToColor(role)));
    this.#end(winner === 'w' ? '1-0' : '0-1', 'resignation', winner);
  }

  /**
   * @param {Client} client
   * @returns {void}
   */
  offerDraw(client) {
    const role = this.roleOf(client);
    if ((role !== 'white' && role !== 'black') || !this.isPlaying) {
      this.reject(client, 'not-playing', 'Nothing to offer a draw in.');
      return;
    }
    this.drawOfferBy = role;
    const opponent = this.seats[role === 'white' ? 'black' : 'white']?.client;
    opponent?.send({ t: 'drawOffer', by: role });
  }

  /**
   * @param {Client} client
   * @returns {void}
   */
  acceptDraw(client) {
    const role = this.roleOf(client);
    if ((role !== 'white' && role !== 'black') || !this.isPlaying) {
      this.reject(client, 'not-playing', 'Nothing to accept.');
      return;
    }
    // Only the side that did *not* offer can accept.
    if (!this.drawOfferBy || this.drawOfferBy === role) {
      this.reject(client, 'bad-message', 'No draw offer from your opponent.');
      return;
    }
    this.#end('1/2-1/2', 'agreement', null);
  }

  /**
   * @param {Client} client
   * @returns {void}
   */
  declineDraw(client) {
    const role = this.roleOf(client);
    if (role !== 'white' && role !== 'black') {
      this.reject(client, 'not-playing', 'Not a player.');
      return;
    }
    const offerer = this.drawOfferBy;
    this.drawOfferBy = null;
    // The offerer is the one who needs to hear it. With no offer outstanding
    // (it was already withdrawn by a move) the decliner gets the ack instead,
    // so a client waiting on a reply never hangs.
    if (offerer && offerer !== role) this.seats[offerer]?.client?.send({ t: 'drawDeclined' });
    else client.send({ t: 'drawDeclined' });
  }

  /**
   * Registers a rematch request; starts a new game once both sides have asked.
   * @param {Client} client
   * @returns {void}
   */
  requestRematch(client) {
    const role = this.roleOf(client);
    if (role !== 'white' && role !== 'black') {
      this.reject(client, 'not-playing', 'Only players may ask for a rematch.');
      return;
    }
    if (this.status.state !== 'over') {
      this.reject(client, 'not-playing', 'The current game is still running.');
      return;
    }
    this.rematchAsked.add(role);
    const opponentRole = role === 'white' ? 'black' : 'white';
    if (!this.rematchAsked.has(opponentRole)) {
      this.seats[opponentRole]?.client?.send({ t: 'rematchOffer', by: role });
      return;
    }
    if (!this.bothSeated) {
      this.reject(client, 'not-playing', 'Opponent is no longer connected.');
      return;
    }
    this.#rematch();
  }

  /** Starts a fresh game in this room with the colours swapped. */
  #rematch() {
    const previousWhite = this.seats.white;
    const previousBlack = this.seats.black;
    // Swapping keeps a series fair: whoever had black now opens.
    this.seats.white = previousBlack;
    this.seats.black = previousWhite;
    if (this.seats.white?.client) this.seats.white.client.role = 'white';
    if (this.seats.black?.client) this.seats.black.client.role = 'black';

    this.#newGame(this.forcedChess960Id ?? (this.variant === 'chess960' ? randomChess960Id() : null));
    this.startGame();
    this.broadcastRoom();
  }

  /* ───────────────────────────── endings ───────────────────────────── */

  /**
   * Server-adjudicated flag-fall.
   * @param {Color} loser
   */
  #onFlag(loser) {
    if (!this.isPlaying) return;
    this.clock.zero(loser);
    const winner = opposite(loser);
    // A player who cannot construct a mate cannot win on time either.
    if (!hasMatingMaterial(this.engine.fen(), winner)) {
      this.#end('1/2-1/2', 'timeout-vs-insufficient', null);
      return;
    }
    this.#end(winner === 'w' ? '1-0' : '0-1', 'timeout', winner);
  }

  /**
   * The grace window closed on a disconnected player.
   * @param {'white'|'black'} missingRole
   */
  #abandon(missingRole) {
    const opponentRole = missingRole === 'white' ? 'black' : 'white';
    const opponentPresent = Boolean(this.seats[opponentRole]?.client);
    if (!opponentPresent) {
      // Nobody is left to award the game to.
      this.#end('1/2-1/2', 'abandoned', null);
    } else {
      const winner = /** @type {Color} */ (roleToColor(opponentRole));
      this.#end(winner === 'w' ? '1-0' : '0-1', 'abandoned', winner);
    }
    if (this.isAbandonedShell) this.onEmpty(this);
  }

  /**
   * @param {'1-0'|'0-1'|'1/2-1/2'} result
   * @param {string} reason
   * @param {Color|null} winner
   */
  #end(result, reason, winner) {
    this.clock.stop();
    this.status = { state: 'over', result, reason: /** @type {any} */ (reason), winner };
    this.drawOfferBy = null;
    this.rematchAsked.clear();
    this.broadcast({ t: 'over', result, reason, winner, clocks: this.clock.snapshot() });
  }

  /* ───────────────────────────── upkeep ───────────────────────────── */

  /**
   * Periodic clock sync so idle clients cannot drift.
   * @returns {void}
   */
  tickClocks() {
    if (!this.isPlaying) return;
    const clocks = this.clock.snapshot();
    if (clocks) this.broadcast({ t: 'clocks', clocks });
  }
}
