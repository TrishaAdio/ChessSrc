import type { Color, PieceSymbol, Placement } from './types';

export const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const DISPLAY_ORDER: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q'];

export interface MaterialSummary {
  /** Opponent pieces captured BY each color, in display order. */
  capturedBy: Record<Color, PieceSymbol[]>;
  /** Positive material lead for each color (the other side is 0). */
  lead: Record<Color, number>;
}

export function materialSummary(placement: Placement): MaterialSummary {
  const counts: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  let score = 0;
  for (const p of placement.values()) {
    counts[p.color][p.type] += 1;
    score += (p.color === 'w' ? 1 : -1) * PIECE_VALUES[p.type];
  }

  const captured = (victim: Color): PieceSymbol[] => {
    // Promoted pieces push a type above its start count; extra pawns missing
    // offset that, so we count pawn deficit net of promotions.
    const promotions = DISPLAY_ORDER.slice(1).reduce(
      (acc, t) => acc + Math.max(0, counts[victim][t] - START_COUNT[t]),
      0,
    );
    const out: PieceSymbol[] = [];
    for (const t of DISPLAY_ORDER) {
      let missing = START_COUNT[t] - counts[victim][t];
      if (t === 'p') missing -= promotions;
      for (let i = 0; i < missing; i++) out.push(t);
    }
    return out;
  };

  return {
    capturedBy: { w: captured('b'), b: captured('w') },
    lead: { w: Math.max(0, score), b: Math.max(0, -score) },
  };
}
