/**
 * One connected socket: identity, send helpers, RTT state and flood control.
 */
import { generateClientId } from './protocol.mjs';
import { RttEstimator } from './rtt.mjs';

/** @typedef {import('./protocol.mjs').Role} Role */

/**
 * Token-bucket flood control.
 *
 * A burst is fine (a client may fire `hello` + `queue` + several `ping`s at
 * once) but a sustained stream is not, so capacity is generous while the refill
 * rate is what actually bounds throughput.
 */
export class RateLimiter {
  /**
   * @param {{ capacity?: number, refillPerSec?: number }} [opts]
   */
  constructor({ capacity = 60, refillPerSec = 30 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }

  /**
   * @param {number} [now]
   * @returns {boolean} false when the message must be dropped.
   */
  take(now = Date.now()) {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class Client {
  /**
   * @param {import('ws').WebSocket} ws
   */
  constructor(ws) {
    /** @readonly @type {string} */ this.id = generateClientId();
    /** @readonly */ this.ws = ws;
    /** @type {string} */ this.name = 'Anonymous';
    /** @type {boolean} */ this.greeted = false;
    /** @type {import('./room.mjs').Room|null} */ this.room = null;
    /** @type {Role|null} */ this.role = null;
    /** @type {string|null} Queue key while waiting for a match. */ this.queueKey = null;
    /** @readonly */ this.rtt = new RttEstimator();
    /** @readonly */ this.limiter = new RateLimiter();
    /** Suppresses repeated `rate-limited` errors while a client is throttled. */
    this.lastRateWarnAt = 0;
    /** Timestamp of the outstanding WebSocket ping frame, if any. */
    this.pingSentAt = 0;
    this.alive = true;
  }

  /** @returns {number} Smoothed round-trip estimate in ms. */
  get rttMs() {
    return this.rtt.rttMs;
  }

  /**
   * @param {object} msg A `ServerMessage`.
   * @returns {void}
   */
  send(msg) {
    // 1 === WebSocket.OPEN; avoids importing `ws` just for the constant.
    if (this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * @param {import('./protocol.mjs').ErrorCode|string} code
   * @param {string} message
   * @returns {void}
   */
  error(code, message) {
    this.send({ t: 'error', code, message });
  }
}
