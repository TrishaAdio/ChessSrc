/**
 * Authoritative, lag-compensated Fischer clocks.
 *
 * The server owns the canonical remaining milliseconds for both colours; a
 * client's own countdown is purely cosmetic and is never trusted. Every
 * transition goes through `measure()` (pure) and `commit()` (mutating) so a
 * rejected move cannot cost a player time.
 */
import { opposite, WIRE_TIME_CONTROLS } from './protocol.mjs';

/**
 * Maximum one-way network delay we are willing to refund per move.
 *
 * A player should not be billed for the time their move spent on the wire, but
 * an unbounded refund would let a client fake a huge RTT and play for free, so
 * the credit is capped.
 */
export const MAX_LAG_CREDIT_MS = 150;

/** @typedef {import('./protocol.mjs').Color} Color */
/** @typedef {import('./protocol.mjs').TimeControlId} TimeControlId */
/** @typedef {{ w: number, b: number, active: Color|null, serverTs: number }} WireClocks */

/**
 * True when `color` holds enough material for a mate to exist at all.
 *
 * Used to downgrade a flag-fall win to a draw (`timeout-vs-insufficient`).
 * Insufficient means bare king, king + one knight, or king + one bishop.
 *
 * @param {string} fen
 * @param {Color} color
 * @returns {boolean}
 */
export function hasMatingMaterial(fen, color) {
  const placement = fen.split(' ')[0] ?? '';
  let knights = 0;
  let bishops = 0;
  for (const ch of placement) {
    if (ch === '/' || (ch >= '1' && ch <= '9')) continue;
    const isWhitePiece = ch === ch.toUpperCase();
    if (isWhitePiece !== (color === 'w')) continue;
    const piece = ch.toLowerCase();
    if (piece === 'p' || piece === 'r' || piece === 'q') return true;
    if (piece === 'n') knights++;
    else if (piece === 'b') bishops++;
  }
  return knights + bishops > 1;
}

/**
 * Resolves the configured time control, honouring the documented test override.
 *
 * @param {TimeControlId} tc
 * @param {number|null} [initialMsOverride] Test-only shortened initial time.
 * @returns {{ initialMs: number, incrementMs: number, unlimited: boolean }}
 */
export function resolveTimeControl(tc, initialMsOverride = null) {
  const base = WIRE_TIME_CONTROLS[tc];
  if (tc === 'unlimited') return { initialMs: 0, incrementMs: 0, unlimited: true };
  const initialMs = initialMsOverride != null ? initialMsOverride : base.initialMs;
  return { initialMs, incrementMs: base.incrementMs, unlimited: false };
}

export class GameClock {
  /** @type {{ w: number, b: number }} */
  #remaining;
  /** @type {Color|null} */
  #active = null;
  /** @type {number} */
  #turnStartedAt = 0;
  /** @type {number} */
  #movesCommitted = 0;
  /** @type {NodeJS.Timeout|null} */
  #flagTimer = null;
  /** @type {(color: Color) => void} */
  #onFlag;

  /**
   * @param {TimeControlId} tc
   * @param {{ onFlag: (color: Color) => void, initialMsOverride?: number|null }} opts
   */
  constructor(tc, { onFlag, initialMsOverride = null }) {
    const { initialMs, incrementMs, unlimited } = resolveTimeControl(tc, initialMsOverride);
    /** @readonly */ this.tc = tc;
    /** @readonly */ this.initialMs = initialMs;
    /** @readonly */ this.incrementMs = incrementMs;
    /** @readonly */ this.unlimited = unlimited;
    this.#remaining = { w: initialMs, b: initialMs };
    this.#onFlag = onFlag;
  }

  /** @returns {boolean} True while no move has been committed this game. */
  get firstMovePending() {
    return this.#movesCommitted === 0;
  }

  /**
   * Starts the game: white is nominally on the move, but the first move is free.
   * @param {number} [now]
   * @returns {void}
   */
  start(now = Date.now()) {
    this.#remaining = { w: this.initialMs, b: this.initialMs };
    this.#movesCommitted = 0;
    this.#active = 'w';
    this.#turnStartedAt = now;
    this.#arm();
  }

  /**
   * Computes what `color`'s move would cost, without mutating anything.
   *
   * @param {Color} color
   * @param {{ now?: number, rttMs?: number }} [opts]
   * @returns {{ elapsed: number, credit: number, flagged: boolean }}
   */
  measure(color, { now = Date.now(), rttMs = 0 } = {}) {
    if (this.unlimited) return { elapsed: 0, credit: 0, flagged: false };
    // Refund half the round trip (the inbound leg) up to the cap.
    const credit = Math.min(rttMs / 2, MAX_LAG_CREDIT_MS);
    // The very first move of the game is free, so an opening book lookup or a
    // slow board animation never costs the player time.
    const raw = this.firstMovePending ? 0 : now - this.#turnStartedAt - credit;
    const elapsed = Math.max(0, raw);
    return { elapsed, credit, flagged: elapsed >= this.#remaining[color] };
  }

  /**
   * Charges `elapsed`, adds the Fischer increment and starts the opponent.
   * @param {Color} color
   * @param {number} elapsed
   * @param {number} [now]
   * @returns {void}
   */
  commit(color, elapsed, now = Date.now()) {
    if (!this.unlimited) {
      this.#remaining[color] = Math.max(0, this.#remaining[color] - elapsed) + this.incrementMs;
    }
    this.#movesCommitted++;
    this.#active = opposite(color);
    this.#turnStartedAt = now;
    this.#arm();
  }

  /**
   * Zeroes a colour's clock — used when the server adjudicates a flag-fall.
   * @param {Color} color
   * @returns {void}
   */
  zero(color) {
    this.#remaining[color] = 0;
  }

  /**
   * Stops the clocks (game over). `active` becomes null on the wire.
   * @returns {void}
   */
  stop() {
    this.#active = null;
    this.#clearTimer();
  }

  /** @returns {void} */
  dispose() {
    this.#clearTimer();
  }

  /**
   * Live snapshot for the wire, with the running side's elapsed time deducted.
   * @param {number} [now]
   * @returns {WireClocks|null} null for `unlimited`, which has no clocks at all.
   */
  snapshot(now = Date.now()) {
    if (this.unlimited) return null;
    const running = this.#active && !this.firstMovePending ? Math.max(0, now - this.#turnStartedAt) : 0;
    return {
      w: Math.max(0, this.#remaining.w - (this.#active === 'w' ? running : 0)),
      b: Math.max(0, this.#remaining.b - (this.#active === 'b' ? running : 0)),
      active: this.#active,
      serverTs: now,
    };
  }

  /**
   * Arms the flag-fall timer so the server adjudicates time loss by itself,
   * without waiting for either client to claim it.
   *
   * The timer fires `MAX_LAG_CREDIT_MS` late on purpose: a move posted just
   * before the flag is still in flight for up to that long and, once the lag
   * credit is applied, legitimately beats the clock.
   */
  #arm() {
    this.#clearTimer();
    if (this.unlimited || !this.#active) return;
    // While the free first move is pending the mover cannot possibly flag.
    if (this.firstMovePending) return;
    const color = this.#active;
    const delay = this.#remaining[color] + MAX_LAG_CREDIT_MS;
    this.#flagTimer = setTimeout(() => {
      this.#flagTimer = null;
      this.#remaining[color] = 0;
      this.#onFlag(color);
    }, delay);
    this.#flagTimer.unref?.();
  }

  #clearTimer() {
    if (this.#flagTimer) clearTimeout(this.#flagTimer);
    this.#flagTimer = null;
  }
}
