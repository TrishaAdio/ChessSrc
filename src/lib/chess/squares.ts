import type { Color, Placement, PlacedPiece, Square } from './types';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

/** 0 = a-file … 7 = h-file */
export const fileOf = (sq: Square): number => sq.charCodeAt(0) - 97;
/** 0 = rank 1 … 7 = rank 8 */
export const rankOf = (sq: Square): number => sq.charCodeAt(1) - 49;

export function toSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${RANKS[rank]}` as Square;
}

export const isLightSquare = (sq: Square): boolean => (fileOf(sq) + rankOf(sq)) % 2 === 1;

/** Board-space (col,row from the top-left of the rendered board) for a square. */
export function squareToVisual(sq: Square, orientation: Color): { col: number; row: number } {
  const f = fileOf(sq);
  const r = rankOf(sq);
  return orientation === 'w' ? { col: f, row: 7 - r } : { col: 7 - f, row: r };
}

export function visualToSquare(col: number, row: number, orientation: Color): Square | null {
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return orientation === 'w' ? toSquare(col, 7 - row) : toSquare(7 - col, row);
}

export const ALL_SQUARES: readonly Square[] = Array.from({ length: 64 }, (_, i) =>
  toSquare(i % 8, Math.floor(i / 8)),
) as Square[];

/** Parses the piece-placement field of a FEN string. */
export function placementFromFen(fen: string): Placement {
  const map: Placement = new Map();
  const rows = (fen.split(' ')[0] ?? '').split('/');
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      const n = Number(ch);
      if (Number.isInteger(n) && n > 0) {
        file += n;
        continue;
      }
      const sq = toSquare(file, rank);
      if (sq) {
        const lower = ch.toLowerCase() as PlacedPiece['type'];
        map.set(sq, { color: ch === lower ? 'b' : 'w', type: lower });
      }
      file += 1;
    }
  });
  return map;
}

export function findKing(placement: Placement, color: Color): Square | null {
  for (const [sq, p] of placement) if (p.type === 'k' && p.color === color) return sq;
  return null;
}

export const turnFromFen = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');
