import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/**
 * Static exchange evaluation: how much material `attacker` can win by
 * starting a capture sequence on `square`, where each side may stop when
 * continuing would lose material. It's the classic swap-list algorithm. X-rays
 * and pins are ignored, which is fine for sacrifice detection.
 */
export function staticExchange(chess: Chess, square: Square, attacker: Color): number {
  const target = chess.get(square);
  if (!target || target.color === attacker) return 0;

  const valuesOf = (c: Color) =>
    chess
      .attackers(square, c)
      .map((sq) => VALUE[chess.get(sq)!.type])
      .sort((a, b) => a - b);
  const side: Record<Color, number[]> = { [attacker]: valuesOf(attacker), [opposite(attacker)]: valuesOf(opposite(attacker)) } as Record<Color, number[]>;
  if (!side[attacker].length) return 0;

  const gain: number[] = [VALUE[target.type]];
  let onSquare = side[attacker].shift()!;
  let mover = opposite(attacker);
  let d = 0;
  while (side[mover].length) {
    d++;
    gain[d] = onSquare - gain[d - 1]!;
    onSquare = side[mover].shift()!;
    mover = opposite(mover);
  }
  while (d > 0) {
    gain[d - 1] = -Math.max(-gain[d - 1]!, gain[d]!);
    d--;
  }
  return Math.max(0, gain[0]!);
}

export interface SacrificeInfo {
  isSacrifice: boolean;
  /** Net material (pawns) the mover puts at risk, after what the move captured. */
  materialAtRisk: number;
  square: Square | null;
}

/**
 * A move is a sacrifice when, after it, the opponent can win at least two
 * pawns' worth of material by static exchange, net of anything the move just
 * captured. That covers en-prise pieces, exchange sacs (R for N/B) and pieces
 * left hanging to pursue an attack. Pawn sacrifices don't count, as on chess.com.
 */
export function detectSacrifice(fenAfter: string, mover: Color, capturedValue: number): SacrificeInfo {
  const chess = new Chess(fenAfter);
  const opp = opposite(mover);
  // Only squares the opponent can *legally* capture on right now. That
  // excludes pinned attackers and attacks the opponent can't make because
  // they must answer a check.
  const capturable = new Set<Square>(
    chess.turn() === opp ? chess.moves({ verbose: true }).filter((m) => m.captured).map((m) => m.to) : [],
  );
  let worst = 0;
  let square: Square | null = null;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== mover || cell.type === 'k' || cell.type === 'p') continue;
      if (!capturable.has(cell.square)) continue;
      const loss = staticExchange(chess, cell.square, opp);
      if (loss > worst) {
        worst = loss;
        square = cell.square;
      }
    }
  }
  const atRisk = worst - capturedValue;
  return { isSacrifice: atRisk >= 2, materialAtRisk: atRisk, square };
}

export const pieceValue = (t: PieceSymbol | undefined): number => (t ? VALUE[t] : 0);
