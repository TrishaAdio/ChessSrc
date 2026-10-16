import { FILES } from '@/lib/chess/squares';


/**
 * Chess960 start-position generator using Scharnagl's numbering (0–959),
 * the same scheme the FIDE/SP-ID tables and Stockfish's UCI_Chess960 use.
 *
 * Decoding a position id N:
 *   N / 4  remainder → light-square bishop file (b1, d1, f1, h1)
 *   N / 4, then % 4  → dark-square bishop file  (a1, c1, e1, g1)
 *   next  % 6        → queen's index among the remaining empty squares
 *   final quotient   → one of 10 knight placements (KRN table)
 * Rooks and the king then fill the last three squares left-to-right, which
 * automatically puts the king between the rooks.
 */
const KRN = ['NNRKR', 'NRNKR', 'NRKNR', 'NRKRN', 'RNNKR', 'RNKNR', 'RNKRN', 'RKNNR', 'RKNRN', 'RKRNN'] as const;

export const CHESS960_POSITIONS = 960;
/** Scharnagl id of the standard array (RNBQKBNR). */
export const CHESS960_STANDARD_ID = 518;

/** Back rank for position `id`, as 8 uppercase piece letters (file a → h). */
export function backRankFor(id: number): string {
  const n = ((id % CHESS960_POSITIONS) + CHESS960_POSITIONS) % CHESS960_POSITIONS;
  const rank: (string | null)[] = Array(8).fill(null);

  const q1 = Math.floor(n / 4);
  rank[n % 4 * 2 + 1] = 'B'; // light-square bishop
  const q2 = Math.floor(q1 / 4);
  rank[(q1 % 4) * 2] = 'B'; // dark-square bishop

  const empty = () => rank.reduce<number[]>((acc, p, i) => (p === null ? (acc.push(i), acc) : acc), []);
  const free = empty();
  rank[free[q2 % 6]!] = 'Q';

  const krn = KRN[Math.floor(q2 / 6)]!;
  const rest = empty();
  krn.split('').forEach((piece, i) => (rank[rest[i]!] = piece));
  return rank.join('');
}

/** Scharnagl id for a back rank, or null if the arrangement isn't a legal Chess960 array. */
export function idForBackRank(rank: string): number | null {
  for (let id = 0; id < CHESS960_POSITIONS; id++) if (backRankFor(id) === rank.toUpperCase()) return id;
  return null;
}

export interface Chess960Setup {
  id: number;
  backRank: string;
  /** Shredder-FEN: castling rights name the rook files (e.g. "HAha"). */
  fen: string;
  kingFile: number;
  /** Rook files [queenside, kingside] relative to the king. */
  rookFiles: [number, number];
}

export function chess960Setup(id: number): Chess960Setup {
  const backRank = backRankFor(id);
  const kingFile = backRank.indexOf('K');
  const rooks = [...backRank].reduce<number[]>((acc, p, i) => (p === 'R' ? (acc.push(i), acc) : acc), []);
  const [qs, ks] = [rooks[0]!, rooks[1]!];
  // Standard layouts keep the familiar KQkq so FENs stay interoperable;
  // everything else uses Shredder-FEN rook files. Matches VariantBoard.
  const standard = kingFile === 4 && qs === 0 && ks === 7;
  const castling = standard ? 'KQkq' : `${FILES[ks]!.toUpperCase()}${FILES[qs]!.toUpperCase()}${FILES[ks]}${FILES[qs]}`;
  const fen = `${backRank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${backRank} w ${castling} - 0 1`;
  return { id, backRank, fen, kingFile, rookFiles: [qs, ks] };
}

export const randomChess960Id = (rng: () => number = Math.random): number => Math.floor(rng() * CHESS960_POSITIONS);

/** Verifies the two structural Chess960 constraints. Used by the test suite. */
export function isValidBackRank(rank: string): boolean {
  if (rank.length !== 8) return false;
  const counts = [...rank].reduce<Record<string, number>>((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {});
  if (counts.K !== 1 || counts.Q !== 1 || counts.R !== 2 || counts.B !== 2 || counts.N !== 2) return false;
  const bishops = [...rank].reduce<number[]>((acc, p, i) => (p === 'B' ? (acc.push(i), acc) : acc), []);
  if (bishops[0]! % 2 === bishops[1]! % 2) return false; // opposite colours
  const rooks = [...rank].reduce<number[]>((acc, p, i) => (p === 'R' ? (acc.push(i), acc) : acc), []);
  const king = rank.indexOf('K');
  return rooks[0]! < king && king < rooks[1]!; // king between the rooks
}
