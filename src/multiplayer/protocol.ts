import type { Color, PromotionPiece, Square } from '@/lib/chess/types';
import type { VariantId } from '@/variants/types';

/** Bumped whenever the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER_URL = 'ws://127.0.0.1:8787';

/** Room codes avoid easily confused characters (no 0/O/1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export type TimeControlId = '1+0' | '2+1' | '3+0' | '3+2' | '5+0' | '10+0' | '15+10' | 'unlimited';

export const WIRE_TIME_CONTROLS: Record<TimeControlId, { initialMs: number; incrementMs: number }> = {
  '1+0': { initialMs: 60_000, incrementMs: 0 },
  '2+1': { initialMs: 120_000, incrementMs: 1_000 },
  '3+0': { initialMs: 180_000, incrementMs: 0 },
  '3+2': { initialMs: 180_000, incrementMs: 2_000 },
  '5+0': { initialMs: 300_000, incrementMs: 0 },
  '10+0': { initialMs: 600_000, incrementMs: 0 },
  '15+10': { initialMs: 900_000, incrementMs: 10_000 },
  unlimited: { initialMs: 0, incrementMs: 0 },
};

export type Role = 'white' | 'black' | 'spectator';
export const roleToColor = (r: Role): Color | null => (r === 'white' ? 'w' : r === 'black' ? 'b' : null);

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-move'
  | 'king-captured'
  | 'timeout'
  | 'timeout-vs-insufficient'
  | 'resignation'
  | 'agreement'
  | 'abandoned';

export interface WireMove {
  ply: number;
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
  san: string;
  lan: string;
  /** Position after the move. */
  fen: string;
}

export interface WireClocks {
  w: number;
  b: number;
  /** Side whose clock is running, null when stopped. */
  active: Color | null;
  /** Server timestamp (ms) the clocks were measured at. */
  serverTs: number;
}

export interface WirePlayer {
  name: string;
  connected: boolean;
}

export type RoomStatus =
  | { state: 'waiting' }
  | { state: 'playing' }
  | { state: 'over'; result: '1-0' | '0-1' | '1/2-1/2'; reason: GameEndReason; winner: Color | null };

export interface RoomState {
  code: string;
  variant: VariantId;
  /** Chess960 position id, present only for that variant. */
  chess960Id?: number;
  startFen: string;
  tc: TimeControlId;
  moves: WireMove[];
  fen: string;
  clocks: WireClocks | null;
  status: RoomStatus;
  players: { white: WirePlayer | null; black: WirePlayer | null };
  spectators: number;
  /** True when the room was created privately (invite code) rather than matched. */
  private: boolean;
}

/* ───────────────────────── client → server ───────────────────────── */

export type ClientMessage =
  | { t: 'hello'; v: number; name: string }
  | { t: 'queue'; tc: TimeControlId; variant: VariantId }
  | { t: 'unqueue' }
  | { t: 'create'; tc: TimeControlId; variant: VariantId }
  | { t: 'join'; code: string }
  | { t: 'move'; from: Square; to: Square; promotion?: PromotionPiece; ply: number }
  | { t: 'resign' }
  | { t: 'drawOffer' }
  | { t: 'drawAccept' }
  | { t: 'drawDecline' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; t0: number };

/* ───────────────────────── server → client ───────────────────────── */

export type ServerMessage =
  | { t: 'hello'; id: string; v: number }
  | { t: 'queued'; tc: TimeControlId; variant: VariantId; size: number }
  | { t: 'unqueued' }
  | { t: 'room'; room: RoomState; role: Role }
  | { t: 'move'; move: WireMove; clocks: WireClocks | null }
  | { t: 'clocks'; clocks: WireClocks }
  | { t: 'over'; result: '1-0' | '0-1' | '1/2-1/2'; reason: GameEndReason; winner: Color | null; clocks: WireClocks | null }
  | { t: 'drawOffer'; by: Role }
  | { t: 'drawDeclined' }
  | { t: 'rematchOffer'; by: Role }
  | { t: 'spectators'; count: number }
  | { t: 'presence'; white: WirePlayer | null; black: WirePlayer | null }
  | { t: 'resync'; room: RoomState; role: Role }
  | { t: 'pong'; t0: number; serverTs: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'bad-message'
  | 'version-mismatch'
  | 'room-not-found'
  | 'room-full'
  | 'not-your-turn'
  | 'illegal-move'
  | 'not-playing'
  | 'already-in-room'
  | 'rate-limited';

/** Narrowing helper shared by the client and the test harness. */
export const isServerMessage = (v: unknown): v is ServerMessage =>
  typeof v === 'object' && v !== null && typeof (v as { t?: unknown }).t === 'string';
