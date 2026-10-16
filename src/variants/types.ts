import type { Color, PieceSymbol, PromotionPiece, Square } from '@/lib/chess/types';

export type VariantId = 'standard' | 'chess960' | 'fog';

export interface VariantMeta {
  id: VariantId;
  name: string;
  blurb: string;
}

export const VARIANTS: Record<VariantId, VariantMeta> = {
  standard: { id: 'standard', name: 'Standard', blurb: 'Classical chess.' },
  chess960: { id: 'chess960', name: 'Chess960', blurb: 'Randomised back rank, 960 start positions.' },
  fog: { id: 'fog', name: 'Fog of War', blurb: 'You only see what your pieces see. Capture the king to win.' },
};

export const VARIANT_ORDER: readonly VariantId[] = ['standard', 'chess960', 'fog'];

/** A played move, shaped like chess.js's `Move` so the store can treat both alike. */
export interface MoveLike {
  color: Color;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PromotionPiece;
  san: string;
  lan: string;
  before: string;
  after: string;
  isCapture: boolean;
  isCastle: boolean;
  /** Where the rook travels, for castling only (Chess960-aware). */
  castleRook?: { from: Square; to: Square };
  isEnPassant: boolean;
  /** Fog of War: this move captured the enemy king and ends the game. */
  isKingCapture: boolean;
}

export type OutcomeReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-move'
  | 'king-captured';

export interface Outcome {
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: OutcomeReason;
  winner: Color | null;
}

export interface MoveRequest {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}
