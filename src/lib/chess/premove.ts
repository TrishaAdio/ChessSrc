import { fileOf, rankOf, toSquare } from './squares';
import type { MoveIntent, Placement, Square } from './types';

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function rays(f: number, r: number, dirs: readonly (readonly [number, number])[], out: Set<Square>) {
  for (const [df, dr] of dirs) {
    for (let i = 1; i < 8; i++) {
      const sq = toSquare(f + df * i, r + dr * i);
      if (!sq) break;
      out.add(sq);
    }
  }
}

/**
 * Geometric premove destinations (chessground-style). Blockers and own pieces
 * are ignored on purpose, because the position will change before the premove
 * runs. Legality is checked when the premove executes.
 */
export function premoveTargets(placement: Placement, from: Square): Set<Square> {
  const piece = placement.get(from);
  const out = new Set<Square>();
  if (!piece) return out;
  const f = fileOf(from);
  const r = rankOf(from);

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const start = piece.color === 'w' ? 1 : 6;
      const one = toSquare(f, r + dir);
      if (one) out.add(one);
      if (r === start) {
        const two = toSquare(f, r + 2 * dir);
        if (two) out.add(two);
      }
      for (const df of [-1, 1]) {
        const cap = toSquare(f + df, r + dir);
        if (cap) out.add(cap);
      }
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT) {
        const sq = toSquare(f + df, r + dr);
        if (sq) out.add(sq);
      }
      break;
    case 'b':
      rays(f, r, DIAG, out);
      break;
    case 'r':
      rays(f, r, ORTHO, out);
      break;
    case 'q':
      rays(f, r, DIAG, out);
      rays(f, r, ORTHO, out);
      break;
    case 'k': {
      for (const [df, dr] of KING) {
        const sq = toSquare(f + df, r + dr);
        if (sq) out.add(sq);
      }
      const home = piece.color === 'w' ? 0 : 7;
      if (r === home && f === 4) {
        const rookAt = (file: number) => {
          const p = placement.get(toSquare(file, home)!);
          return p?.type === 'r' && p.color === piece.color;
        };
        if (rookAt(7)) out.add(toSquare(6, home)!);
        if (rookAt(0)) out.add(toSquare(2, home)!);
      }
      break;
    }
  }
  out.delete(from);
  return out;
}

/** Applies a premove to a placement for display (castling and auto-promotion included). */
export function applyPremove(placement: Placement, pm: MoveIntent): Placement {
  const next = new Map(placement);
  const piece = next.get(pm.from);
  if (!piece) return next;
  next.delete(pm.from);

  const lastRank = piece.color === 'w' ? 7 : 0;
  if (piece.type === 'p' && rankOf(pm.to) === lastRank) {
    next.set(pm.to, { color: piece.color, type: pm.promotion ?? 'q' });
  } else {
    next.set(pm.to, piece);
  }

  if (piece.type === 'k' && Math.abs(fileOf(pm.to) - fileOf(pm.from)) === 2) {
    const rank = rankOf(pm.from);
    const kingside = fileOf(pm.to) > fileOf(pm.from);
    const rookFrom = toSquare(kingside ? 7 : 0, rank)!;
    const rookTo = toSquare(kingside ? 5 : 3, rank)!;
    const rook = next.get(rookFrom);
    if (rook?.type === 'r') {
      next.delete(rookFrom);
      next.set(rookTo, rook);
    }
  }
  return next;
}

export const applyPremoves = (placement: Placement, premoves: readonly MoveIntent[]): Placement =>
  premoves.reduce(applyPremove, placement);
