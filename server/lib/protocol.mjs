/**
 * Runtime mirror of `src/multiplayer/protocol.ts`.
 *
 * The TypeScript file is the single source of truth for the wire format, but it
 * cannot be imported by a build-free Node server (it is TS and uses `@/` path
 * aliases). The constants below are copied verbatim; `scripts/checks` style
 * drift is guarded by `assertProtocolParity()` in the test harness, which reads
 * the .ts file and compares the literals.
 */
import { randomBytes, randomInt } from 'node:crypto';

/** Bumped whenever the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Room codes avoid easily confused characters (no 0/O/1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** @typedef {'1+0'|'2+1'|'3+0'|'3+2'|'5+0'|'10+0'|'15+10'|'unlimited'} TimeControlId */
/** @typedef {'standard'|'chess960'|'fog'} VariantId */
/** @typedef {'white'|'black'|'spectator'} Role */
/** @typedef {'w'|'b'} Color */

/** @type {Record<TimeControlId, { initialMs: number, incrementMs: number }>} */
export const WIRE_TIME_CONTROLS = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '2+1': { initialMs: 120_000, incrementMs: 1_000 },
  '3+0': { initialMs: 180_000, incrementMs: 0 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+0': { initialMs: 300_000, incrementMs: 0 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '15+10': { initialMs: 900_000, incrementMs: 10_000 },
  unlimited: { initialMs: 0, incrementMs: 0 },
};

/** @type {readonly VariantId[]} */
export const VARIANT_IDS = ['standard', 'chess960', 'fog'];

/**
 * @typedef {'bad-message'|'version-mismatch'|'room-not-found'|'room-full'|'not-your-turn'
 *   |'illegal-move'|'not-playing'|'already-in-room'|'rate-limited'} ErrorCode
 */

const PROMOTION_PIECES = new Set(['q', 'r', 'b', 'n']);
const SQUARE_RE = /^[a-h][1-8]$/;

/**
 * @param {Role} role
 * @returns {Color|null}
 */
export const roleToColor = (role) => (role === 'white' ? 'w' : role === 'black' ? 'b' : null);

/**
 * @param {Color} color
 * @returns {Color}
 */
export const opposite = (color) => (color === 'w' ? 'b' : 'w');

/** @param {unknown} v @returns {v is TimeControlId} */
export const isTimeControlId = (v) => typeof v === 'string' && Object.hasOwn(WIRE_TIME_CONTROLS, v);

/** @param {unknown} v @returns {v is VariantId} */
export const isVariantId = (v) => typeof v === 'string' && VARIANT_IDS.includes(/** @type {VariantId} */ (v));

/** @param {unknown} v @returns {v is string} */
export const isSquare = (v) => typeof v === 'string' && SQUARE_RE.test(v);

/** @param {unknown} v @returns {boolean} */
export const isPromotion = (v) => typeof v === 'string' && PROMOTION_PIECES.has(v);

/**
 * Generates a room code using exactly the protocol alphabet and length.
 *
 * The alphabet is 32 characters, which divides 256 evenly, so masking random
 * bytes with 0x1f is uniform — no modulo bias, no rejection loop.
 *
 * @returns {string}
 */
export function generateRoomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[bytes[i] & 0x1f];
  return out;
}

/**
 * Opaque, collision-resistant connection id handed back in the `hello` reply.
 * @returns {string}
 */
export const generateClientId = () => randomBytes(9).toString('base64url');

/**
 * Unbiased coin flip used for colour assignment.
 *
 * Colours are drawn from the CSPRNG rather than from join order so neither the
 * queue position nor the room creator can predict or steer who gets white.
 *
 * @returns {boolean}
 */
export const coinFlip = () => randomInt(2) === 1;
