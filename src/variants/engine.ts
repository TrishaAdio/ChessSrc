import { Chess, DEFAULT_POSITION, type Move } from 'chess.js';
import type { Color, Square } from '@/lib/chess/types';
import { VariantBoard, idxToSquare } from './board';
import type { MoveLike, MoveRequest, Outcome, VariantId } from './types';

/**
 * One interface over two rule engines:
 *   • standard chess  → chess.js (unchanged from Phases 1–3)
 *   • chess960 / fog  → VariantBoard (perft-verified against chess.js)
 */
export interface GameEngine {
  readonly variant: VariantId;
  fen(): string;
  turn(): Color;
  moves(): MoveLike[];
  /** Legal destinations per origin square, including Chess960 king-onto-rook. */
  targets(): Map<Square, Set<Square>>;
  move(req: MoveRequest): MoveLike | null;
  moveCount(): number;
  inCheck(): boolean;
  outcome(): Outcome | null;
  /** Squares the colour can see; null when the variant has no fog. */
  vision(color: Color): Set<Square> | null;
}

/* ───────────────────────────── standard ───────────────────────────── */

const toMoveLike = (m: Move): MoveLike => ({
  color: m.color,
  from: m.from,
  to: m.to,
  piece: m.piece,
  ...(m.captured ? { captured: m.captured } : {}),
  ...(m.promotion ? { promotion: m.promotion as MoveLike['promotion'] } : {}),
  san: m.san,
  lan: m.lan,
  before: m.before,
  after: m.after,
  isCapture: m.isCapture() || m.isEnPassant(),
  isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
  ...(m.isKingsideCastle() || m.isQueensideCastle()
    ? {
        castleRook: {
          from: (m.isKingsideCastle() ? 'h' : 'a') + m.from[1]! as Square,
          to: (m.isKingsideCastle() ? 'f' : 'd') + m.from[1]! as Square,
        },
      }
    : {}),
  isEnPassant: m.isEnPassant(),
  isKingCapture: false,
});

class StandardEngine implements GameEngine {
  readonly variant = 'standard' as const;
  private chess: Chess;

  constructor(fen: string) {
    this.chess = new Chess(fen);
  }

  fen() {
    return this.chess.fen();
  }

  turn() {
    return this.chess.turn();
  }

  moves() {
    return this.chess.moves({ verbose: true }).map(toMoveLike);
  }

  targets() {
    const map = new Map<Square, Set<Square>>();
    for (const m of this.chess.moves({ verbose: true })) {
      let set = map.get(m.from);
      if (!set) map.set(m.from, (set = new Set()));
      set.add(m.to);
    }
    return map;
  }

  move(req: MoveRequest) {
    try {
      return toMoveLike(this.chess.move({ from: req.from, to: req.to, promotion: req.promotion }));
    } catch {
      return null;
    }
  }

  moveCount() {
    return this.chess.moves().length;
  }

  inCheck() {
    return this.chess.inCheck();
  }

  outcome(): Outcome | null {
    const c = this.chess;
    if (c.isCheckmate()) {
      const winner: Color = c.turn() === 'w' ? 'b' : 'w';
      return { result: winner === 'w' ? '1-0' : '0-1', reason: 'checkmate', winner };
    }
    const draw = (reason: Outcome['reason']): Outcome => ({ result: '1/2-1/2', reason, winner: null });
    if (c.isStalemate()) return draw('stalemate');
    if (c.isInsufficientMaterial()) return draw('insufficient');
    if (c.isThreefoldRepetition()) return draw('threefold');
    if (c.isDrawByFiftyMoves()) return draw('fifty-move');
    return null;
  }

  vision() {
    return null;
  }
}

/* ───────────────────────── chess960 & fog ───────────────────────── */

class VariantEngine implements GameEngine {
  private board: VariantBoard;

  constructor(
    readonly variant: VariantId,
    fen: string,
  ) {
    this.board = new VariantBoard(fen, variant);
  }

  fen() {
    return this.board.fen();
  }

  turn() {
    return this.board.turn;
  }

  moves() {
    return this.board.moves();
  }

  targets() {
    const map = new Map<Square, Set<Square>>();
    for (const m of this.board.moves()) {
      let set = map.get(m.from);
      if (!set) map.set(m.from, (set = new Set()));
      set.add(m.to);
      // Chess960: dropping the king on its own rook also castles.
      if (m.castleRook) set.add(m.castleRook.from);
    }
    return map;
  }

  move(req: MoveRequest) {
    return this.board.move(req);
  }

  moveCount() {
    return this.board.moveCount();
  }

  inCheck() {
    return this.board.inCheck();
  }

  outcome() {
    return this.board.outcome();
  }

  vision(color: Color) {
    if (this.variant !== 'fog') return null;
    const out = new Set<Square>();
    for (const i of this.board.vision(color)) out.add(idxToSquare(i));
    return out;
  }

  /** Raw board access for the Fog of War bot heuristics. */
  raw(): VariantBoard {
    return this.board;
  }
}

export const createEngine = (variant: VariantId, fen: string = DEFAULT_POSITION): GameEngine =>
  variant === 'standard' ? new StandardEngine(fen) : new VariantEngine(variant, fen);

/** Rebuilds an engine by replaying moves, used for takebacks and resyncs. */
export function replayEngine(variant: VariantId, startFen: string, moves: readonly MoveRequest[]): GameEngine {
  const engine = createEngine(variant, startFen);
  for (const m of moves) engine.move(m);
  return engine;
}

export const asVariantEngine = (e: GameEngine): VariantEngine | null => (e instanceof VariantEngine ? e : null);
