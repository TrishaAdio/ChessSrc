import { Chess } from 'chess.js';

export interface OpeningEntry {
  eco: string;
  name: string;
}

interface EcoData {
  source: string;
  openings: [eco: string, name: string][];
  positions: [epd: string, named: number, lines: number][];
}

interface BookPosition {
  opening: OpeningEntry | null;
  /** How many named lines pass through this position (popularity proxy). */
  lines: number;
}

export interface BookMove {
  uci: string;
  san: string;
  lines: number;
  /** Name of the resulting position or, failing that, the nearest named ancestor. */
  opening: OpeningEntry | null;
}

/** First four FEN fields: placement, side, castling, en passant. */
export const epdOf = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/**
 * Embedded ECO opening book (3,865 named lines, CC0). Lookups are keyed by
 * position, so transpositions resolve correctly. The data loads lazily as a
 * separate chunk.
 */
export class OpeningBook {
  private constructor(private readonly table: Map<string, BookPosition>) {}

  static async load(): Promise<OpeningBook> {
    const { default: data } = (await import('./eco-data.json')) as unknown as { default: EcoData };
    const openings = data.openings.map(([eco, name]) => ({ eco, name }));
    const table = new Map<string, BookPosition>();
    for (const [epd, named, lines] of data.positions) table.set(epd, { opening: named >= 0 ? openings[named]! : null, lines });
    return new OpeningBook(table);
  }

  get size(): number {
    return this.table.size;
  }

  has(fen: string): boolean {
    return this.table.has(epdOf(fen));
  }

  get(fen: string): BookPosition | undefined {
    return this.table.get(epdOf(fen));
  }

  /**
   * Walks the game and returns (a) how many leading plies are book and (b)
   * the deepest named opening reached within `uptoPly`.
   */
  analyseLine(fens: readonly string[], uptoPly: number): { bookPlies: number; opening: OpeningEntry | null } {
    let bookPlies = 0;
    for (let ply = 1; ply < fens.length; ply++) {
      if (!this.has(fens[ply]!)) break;
      bookPlies = ply;
    }
    let opening: OpeningEntry | null = null;
    for (let ply = 1; ply <= Math.min(uptoPly, fens.length - 1); ply++) {
      const hit = this.get(fens[ply]!);
      if (hit?.opening) opening = hit.opening;
    }
    return { bookPlies, opening };
  }

  /** Legal continuations from `fen` that stay in book. */
  continuations(fen: string): BookMove[] {
    const chess = new Chess(fen);
    const out: BookMove[] = [];
    const parentOpening = this.get(fen)?.opening ?? null;
    for (const m of chess.moves({ verbose: true })) {
      const hit = this.table.get(epdOf(m.after));
      if (hit) out.push({ uci: m.lan, san: m.san, lines: hit.lines, opening: hit.opening ?? parentOpening });
    }
    return out;
  }
}

let bookPromise: Promise<OpeningBook> | null = null;
export const loadOpeningBook = (): Promise<OpeningBook> => (bookPromise ??= OpeningBook.load());
