/**
 * Per-connection round-trip-time estimation, used to size the per-move lag
 * credit. Because that credit is literally free time, the estimate has to be
 * hard for a client to inflate.
 *
 * Two sample sources, deliberately *not* equal in weight:
 *
 *  1. WebSocket control frames (`ws.ping()` → `'pong'` event). Both timestamps
 *     are the server's own, so this is a true round trip that a client cannot
 *     forge. It is authoritative whenever it is available, and it doubles as
 *     liveness detection.
 *
 *  2. Application-level `ping {t0}` messages. `t0` is a *client* clock reading,
 *     so `recvTs - t0` is "clock offset + one-way delay". We take the minimum
 *     over a sliding window as the offset baseline and treat each sample's
 *     excess over it as one-way delay (the NTP-style trick). This path only
 *     feeds the estimate for peers that never answer control frames.
 *
 * The estimate is the *median* of the recent window rather than the mean, so a
 * single stalled packet cannot hand a player a large chunk of free time.
 */

const WINDOW = 8;
/** Offsets expire from the window, so one bogus `t0` cannot poison it forever. */
const OFFSET_WINDOW = 16;
const MAX_PLAUSIBLE_RTT_MS = 2_000;

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class RttEstimator {
  /** @type {number[]} Server-measured round trips (trusted). */
  #frames = [];
  /** @type {number[]} Round trips derived from client `ping.t0` (untrusted). */
  #derived = [];
  /** @type {number[]} Recent `recvTs - t0` readings; their minimum is the offset baseline. */
  #offsets = [];

  /**
   * Records a directly measured round trip (WebSocket pong frame).
   * @param {number} rttMs
   * @returns {void}
   */
  addRoundTrip(rttMs) {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    push(this.#frames, Math.min(rttMs, MAX_PLAUSIBLE_RTT_MS), WINDOW);
  }

  /**
   * Records an application `ping` arrival, deriving RTT from the one-way delay.
   * @param {number} t0 Client-clock timestamp carried by the ping.
   * @param {number} recvTs Server-clock arrival time.
   * @returns {void}
   */
  addPing(t0, recvTs) {
    if (!Number.isFinite(t0)) return;
    push(this.#offsets, recvTs - t0, OFFSET_WINDOW);
    const oneWay = recvTs - t0 - Math.min(...this.#offsets);
    if (oneWay <= 0) return; // This sample *defined* the baseline; no delay info.
    const rtt = oneWay * 2;
    // An implausible delay means the client's clock jumped (or is lying), not
    // that the network is slow. Drop the sample rather than clamping it, so a
    // single skewed `t0` cannot pin the estimate to the ceiling.
    if (rtt > MAX_PLAUSIBLE_RTT_MS) return;
    push(this.#derived, rtt, WINDOW);
  }

  /**
   * Smoothed estimate in milliseconds; 0 until at least one sample arrives.
   *
   * Server-measured frames win outright when present: a client that answers
   * control frames cannot talk its way into a bigger lag credit.
   *
   * @returns {number}
   */
  get rttMs() {
    if (this.#frames.length > 0) return median(this.#frames);
    if (this.#derived.length > 0) return median(this.#derived);
    return 0;
  }

  /** @returns {number} */
  get sampleCount() {
    return this.#frames.length + this.#derived.length;
  }
}

/**
 * @param {number[]} arr
 * @param {number} value
 * @param {number} limit
 */
function push(arr, value, limit) {
  arr.push(value);
  if (arr.length > limit) arr.shift();
}
