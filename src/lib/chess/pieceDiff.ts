import { fileOf, rankOf } from './squares';
import type { BoardPiece, Placement, SquarePair } from './types';

let idCounter = 0;
const nextId = () => `pc${++idCounter}`;

const distance = (a: BoardPiece['square'], b: BoardPiece['square']) =>
  Math.hypot(fileOf(a) - fileOf(b), rankOf(a) - rankOf(b));

/**
 * Carries piece identities from the previous position to the next one, so
 * every piece can spring from its old square to its new one, even across
 * multi-ply jumps such as history scrubbing, takebacks or board resets.
 *
 * Matching runs in this order:
 *  1. Same square, same color and type: the piece did not move.
 *  2. Known moves (`hints`) such as the last move or queued premoves. Type may
 *     differ here, so a pawn keeps its identity when it promotes.
 *  3. Greedy nearest match among pieces of the same color and type.
 *  4. Same color, any type: covers un-promotion when scrubbing backwards.
 * Previous pieces left unmatched are removed (exit animation). Next pieces left
 * unmatched get new ids (enter animation).
 */
export function diffPieces(
  prev: readonly BoardPiece[],
  next: Placement,
  hints: readonly SquarePair[] = [],
): BoardPiece[] {
  const pool = new Map<string, BoardPiece>(prev.map((p) => [p.id, p]));
  const prevBySquare = new Map(prev.map((p) => [p.square, p]));
  const unassigned = new Map(next);
  const result: BoardPiece[] = [];

  const assign = (id: string, sq: BoardPiece['square']) => {
    const placed = unassigned.get(sq)!;
    result.push({ id, square: sq, color: placed.color, type: placed.type });
    unassigned.delete(sq);
    pool.delete(id);
  };

  // 1. Stationary pieces.
  for (const [sq, piece] of next) {
    const old = prevBySquare.get(sq);
    if (old && pool.has(old.id) && old.color === piece.color && old.type === piece.type) {
      assign(old.id, sq);
    }
  }

  // 2. Explicit move hints (in order; chained premoves resolve correctly).
  for (const { from, to } of hints) {
    const target = unassigned.get(to);
    if (!target) continue;
    const old = [...pool.values()].find((p) => p.square === from && p.color === target.color);
    if (old) assign(old.id, to);
  }

  // 3 & 4. Greedy nearest neighbour.
  const greedy = (sameType: boolean) => {
    const pairs: { id: string; sq: BoardPiece['square']; d: number }[] = [];
    for (const [sq, piece] of unassigned) {
      for (const old of pool.values()) {
        if (old.color !== piece.color) continue;
        if (sameType && old.type !== piece.type) continue;
        pairs.push({ id: old.id, sq, d: distance(old.square, sq) });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    for (const { id, sq } of pairs) {
      if (pool.has(id) && unassigned.has(sq)) assign(id, sq);
    }
  };
  greedy(true);
  greedy(false);

  // New pieces (initial mount, edited positions, …).
  for (const sq of [...unassigned.keys()]) assign(nextId(), sq);

  return result;
}
