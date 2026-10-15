import type { Color, PieceSymbol, Square } from 'chess.js';

export type { Color, PieceSymbol, Square };

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface PlacedPiece {
  color: Color;
  type: PieceSymbol;
}

/** Square → piece map (only occupied squares). */
export type Placement = Map<Square, PlacedPiece>;

/** A piece with a stable identity, so it can animate between positions. */
export interface BoardPiece extends PlacedPiece {
  id: string;
  square: Square;
}

export interface MoveIntent {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export interface Premove extends MoveIntent {
  id: number;
}

export interface SquarePair {
  from: Square;
  to: Square;
}

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
