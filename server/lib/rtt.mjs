/**
 * Per-connection round-trip-time estimation.
 *
 * Two independent sample sources feed one estimator:
 *
 *  1. WebSocket control frames (`ws.ping()` → `'pong'` event). Both timestamps
 *     are taken from the server's own clock, so this is a true, unambiguous
 *     round trip. It is the primary source and also doubles as liveness
 *     detection.
 *
 *  2. Application-level `ping {t0}` messages. `t0` is a *client* clock reading,
 *     so `recvTs - t0` is "clock offset + one-way delay" and cannot be used
 *     directly. We track the running minimum of that quantity as the offset
 *     baseline (the fastest observed packet is the one with the least queuing
 *     delay), then treat each sample's excess over the baseline as one-way
 *     delay and double it. This is the standard NTP-style trick and keeps the
 *     estimate useful even for clients that never answer control frames.
 *
 * The estimate is the *median* of the recent window rather than the mean: a
 * single stalled packet must not hand a player hundreds of milliseconds of
 * free lag credit.
 */

const WINDOW = 8;
const MAX_PLAUSIBLE_RTT_MS = 2_000;

export class RttEstimator {
  /** @type {number[]} */
  #samples = [];
  /** Lowest observed `recvTs - t0`, i.e. clock offset plus best-case one-way delay. */
  #offsetBaseline = Number.POSITIVE_INFINITY;

  /**
   * Records a directly measured round trip (WebSocket pong frame).
   * @param {number} rttMs
   * @returns {void}
   */
  addRoundTrip(rttMs) {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.#push(Math.min(rttMs, MAX_PLAUSIBLE_RTT_MS));
  }

  /**
   * Records an application `ping` arrival, deriving RTT from the one-way delay.
   * @param {number} t0 Client-clock timestamp carried by the ping.
   * @param {number} recvTs Server-clock arrival time.
   * @returns {void}
   */
  addPing(t0, recvTs) {
    if (!Number.isFinite(t0)) return;
    const observed = recvTs - t0;
    if (observed < this.#offsetBaseline) this.#offsetBaseline = observed;
    const oneWay = observed - this.#offsetBaseline;
    if (oneWay <= 0) return; // This sample *defined* the baseline; it carries no delay info.
    this.#push(Math.min(oneWay * 2, MAX_PLAUSIBLE_RTT_MS));
  }

  /**
   * Smoothed estimate in milliseconds; 0 until at least one sample arrives.
   * @returns {number}
   */
  get rttMs() {
    if (this.#samples.length === 0) return 0;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** @returns {number} */
  get sampleCount() {
    return this.#samples.length;
  }

  /** @param {number} v */
  #push(v) {
    this.#samples.push(v);
    if (this.#samples.length > WINDOW) this.#samples.shift();
  }
}
