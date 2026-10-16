import { FILES } from '@/lib/chess/squares';
import type { Color, PieceSymbol, PromotionPiece, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import type { MoveLike, Outcome, VariantId } from './types';

/**
 * Self-contained board used for the variants chess.js can't express:
 *   • Chess960 — castling with arbitrary king/rook files (Shredder-FEN rights)
 *   • Fog of War — no check rules at all; the game ends when a king is captured
 *
 * Standard chess keeps using chess.js (see engine.ts), so Phase 1–3 behaviour
 * is untouched. This generator is verified against chess.js with perft in the
 * Phase 4 test suite.
 *
 * Squares are indices 0–63 with 0 = a1 and 63 = h8 (index = rank * 8 + file).
 */

export interface Piece {
  color: Color;
  type: PieceSymbol;
}

const WHITE: Color = 'w';
const BLACK: Color = 'b';

const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;
const KING_DELTAS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const PROMOTIONS: PromotionPiece[] = ['q', 'r', 'b', 'n'];

export const idx = (file: number, rank: number): number => rank * 8 + file;
export const fileOfIdx = (i: number): number => i % 8;
export const rankOfIdx = (i: number): number => (i - (i % 8)) / 8;
export const idxToSquare = (i: number): Square => `${FILES[fileOfIdx(i)]}${rankOfIdx(i) + 1}` as Square;
export const squareToIdx = (s: Square): number => idx(s.charCodeAt(0) - 97, s.charCodeAt(1) - 49);

/** Internal move; `rookFrom`/`rookTo` are set for castling. */
interface RawMove {
  from: number;
  to: number;
  piece: PieceSymbol;
  color: Color;
  captured?: PieceSymbol;
  capturedAt?: number;
  promotion?: PromotionPiece;
  castle?: 'k' | 'q';
  rookFrom?: number;
  rookTo?: number;
  epCapture?: boolean;
  doublePush?: boolean;
}

interface State {
  board: (Piece | null)[];
  turn: Color;
  /** Castling rights as the files of rooks that may still castle. */
  rights: Record<Color, Set<number>>;
  ep: number | null;
  halfMoves: number;
  fullMoves: number;
}

export class VariantBoard {
  private s: State;
  /** Repetition keys (placement + turn + rights + ep) for every position reached. */
  private history: string[] = [];
  /** Set in Fog of War when a king has been taken. */
  private kingCapturedBy: Color | null = null;

  constructor(
    fen: string,
    readonly variant: VariantId,
  ) {
    this.s = VariantBoard.parse(fen);
    this.history.push(this.repetitionKey());
  }

  /* ───────────────────────────── FEN ───────────────────────────── */

  private static parse(fen: string): State {
    const parts = fen.trim().split(/\s+/);
    const [placement, turnField = 'w', castleField = '-', epField = '-', half = '0', full = '1'] = parts;
    const board: (Piece | null)[] = Array(64).fill(null);
    const rows = (placement ?? '').split('/');
    if (rows.length !== 8) throw new Error(`bad FEN placement: ${fen}`);
    rows.forEach((row, i) => {
      const rank = 7 - i;
      let file = 0;
      for (const ch of row) {
        const n = Number(ch);
        if (Number.isInteger(n) && n > 0) {
          file += n;
          continue;
        }
        const lower = ch.toLowerCase() as PieceSymbol;
        if (!'pnbrqk'.includes(lower)) throw new Error(`bad FEN piece '${ch}'`);
        board[idx(file, rank)] = { color: ch === lower ? BLACK : WHITE, type: lower };
        file += 1;
      }
    });

    const rights: Record<Color, Set<number>> = { w: new Set(), b: new Set() };
    if (castleField !== '-') {
      for (const ch of castleField) {
        const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK;
        const rank = color === WHITE ? 0 : 7;
        const lower = ch.toLowerCase();
        if (lower === 'k' || lower === 'q') {
          // Standard notation: the outermost rook on that side.
          const kingFile = board.findIndex((p, i) => p?.type === 'k' && p.color === color && rankOfIdx(i) === rank);
          const kf = kingFile >= 0 ? fileOfIdx(kingFile) : 4;
          const files = [...Array(8).keys()].filter((f) => {
            const p = board[idx(f, rank)];
            return p?.type === 'r' && p.color === color;
          });
          const side = lower === 'k' ? files.filter((f) => f > kf).at(-1) : files.filter((f) => f < kf)[0];
          if (side !== undefined) rights[color].add(side);
        } else {
          // Shredder notation: the rook's file letter.
          const f = lower.charCodeAt(0) - 97;
          if (f >= 0 && f < 8) rights[color].add(f);
        }
      }
    }

    return {
      board,
      turn: turnField === 'b' ? BLACK : WHITE,
      rights,
      ep: epField !== '-' ? squareToIdx(epField as Square) : null,
      halfMoves: Number(half) || 0,
      fullMoves: Number(full) || 1,
    };
  }

  fen(): string {
    const rows: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.s.board[idx(file, rank)];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          row += String(empty);
          empty = 0;
        }
        row += p.color === WHITE ? p.type.toUpperCase() : p.type;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return `${rows.join('/')} ${this.s.turn} ${this.castlingField()} ${this.s.ep === null ? '-' : idxToSquare(this.s.ep)} ${this.s.halfMoves} ${this.s.fullMoves}`;
  }

  /**
   * Shredder-FEN rights (rook files) for Chess960, classic KQkq when the
   * layout is standard so the FEN stays interoperable.
   */
  private castlingField(): string {
    const out: string[] = [];
    for (const color of [WHITE, BLACK] as Color[]) {
      const rank = color === WHITE ? 0 : 7;
      const kingFile = this.kingFileOf(color, rank);
      const files = [...this.s.rights[color]].sort((a, b) => b - a);
      for (const f of files) {
        const standard = kingFile === 4 && (f === 7 || f === 0);
        const letter = standard ? (f === 7 ? 'k' : 'q') : FILES[f]!;
        out.push(color === WHITE ? letter.toUpperCase() : letter);
      }
    }
    return out.length ? out.join('') : '-';
  }

  private kingFileOf(color: Color, rank: number): number {
    for (let f = 0; f < 8; f++) {
      const p = this.s.board[idx(f, rank)];
      if (p?.type === 'k' && p.color === color) return f;
    }
    return -1;
  }

  private repetitionKey(): string {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  /* ───────────────────────────── queries ───────────────────────────── */

  get turn(): Color {
    return this.s.turn;
  }

  get moveNumber(): number {
    return this.s.fullMoves;
  }

  pieceAt(sq: Square): Piece | null {
    return this.s.board[squareToIdx(sq)] ?? null;
  }

  board(): readonly (Piece | null)[] {
    return this.s.board;
  }

  kingSquare(color: Color): number | null {
    for (let i = 0; i < 64; i++) {
      const p = this.s.board[i];
      if (p?.type === 'k' && p.color === color) return i;
    }
    return null;
  }

  /** True if `color` attacks `square` (pawn pushes don't count as attacks). */
  isAttacked(square: number, color: Color): boolean {
    const f = fileOfIdx(square);
    const r = rankOfIdx(square);

    // Pawns
    const pawnRank = r - (color === WHITE ? 1 : -1);
    if (pawnRank >= 0 && pawnRank < 8) {
      for (const df of [-1, 1]) {
        const pf = f + df;
        if (pf < 0 || pf > 7) continue;
        const p = this.s.board[idx(pf, pawnRank)];
        if (p?.type === 'p' && p.color === color) return true;
      }
    }
    // Knights
    for (const [df, dr] of KNIGHT_DELTAS) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const p = this.s.board[idx(nf, nr)];
      if (p?.type === 'n' && p.color === color) return true;
    }
    // King
    for (const [df, dr] of KING_DELTAS) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const p = this.s.board[idx(nf, nr)];
      if (p?.type === 'k' && p.color === color) return true;
    }
    // Sliders
    const slide = (dirs: readonly (readonly [number, number])[], types: string) => {
      for (const [df, dr] of dirs) {
        for (let i = 1; i < 8; i++) {
          const nf = f + df * i;
          const nr = r + dr * i;
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
          const p = this.s.board[idx(nf, nr)];
          if (!p) continue;
          if (p.color === color && types.includes(p.type)) return true;
          break;
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
  }

  inCheck(color: Color = this.s.turn): boolean {
    if (this.variant === 'fog') return false; // no check concept
    const k = this.kingSquare(color);
    return k !== null && this.isAttacked(k, opposite(color));
  }

  /**
   * Fog of War vision for `color`: its own squares, every square its pieces can
   * move to, and the squares its pawns attack (even when empty). Everything
   * else stays hidden, so enemy pieces there are invisible.
   */
  vision(color: Color): Set<number> {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) {
      const p = this.s.board[i];
      if (!p || p.color !== color) continue;
      seen.add(i);
      if (p.type !== 'p') continue;
      // Pawn captures only appear in move generation when something is there.
      const dir = color === WHITE ? 1 : -1;
      const r = rankOfIdx(i) + dir;
      if (r < 0 || r > 7) continue;
      for (const df of [-1, 1]) {
        const f = fileOfIdx(i) + df;
        if (f >= 0 && f <= 7) seen.add(idx(f, r));
      }
    }
    for (const m of this.pseudoMoves(color)) seen.add(m.to);
    return seen;
  }

  /* ───────────────────────── move generation ───────────────────────── */

  private pseudoMoves(color: Color): RawMove[] {
    const out: RawMove[] = [];
    const fog = this.variant === 'fog';

    for (let from = 0; from < 64; from++) {
      const piece = this.s.board[from];
      if (!piece || piece.color !== color) continue;
      const f = fileOfIdx(from);
      const r = rankOfIdx(from);

      const push = (to: number, extra: Partial<RawMove> = {}) => {
        const target = this.s.board[to];
        // Only Fog of War allows taking a king.
        if (target && (target.color === color || (target.type === 'k' && !fog))) return false;
        out.push({
          from,
          to,
          piece: piece.type,
          color,
          ...(target ? { captured: target.type, capturedAt: to } : {}),
          ...extra,
        });
        return !target;
      };

      switch (piece.type) {
        case 'p': {
          const dir = color === WHITE ? 1 : -1;
          const startRank = color === WHITE ? 1 : 6;
          const lastRank = color === WHITE ? 7 : 0;
          const one = r + dir;
          if (one >= 0 && one < 8 && !this.s.board[idx(f, one)]) {
            if (one === lastRank) for (const promotion of PROMOTIONS) out.push({ from, to: idx(f, one), piece: 'p', color, promotion });
            else {
              out.push({ from, to: idx(f, one), piece: 'p', color });
              const two = r + dir * 2;
              if (r === startRank && !this.s.board[idx(f, two)]) out.push({ from, to: idx(f, two), piece: 'p', color, doublePush: true });
            }
          }
          if (one < 0 || one > 7) break;
          for (const df of [-1, 1]) {
            const cf = f + df;
            if (cf < 0 || cf > 7) continue;
            const to = idx(cf, one);
            const target = this.s.board[to];
            if (target && target.color !== color && (target.type !== 'k' || fog)) {
              if (one === lastRank) for (const promotion of PROMOTIONS) out.push({ from, to, piece: 'p', color, captured: target.type, capturedAt: to, promotion });
              else out.push({ from, to, piece: 'p', color, captured: target.type, capturedAt: to });
            } else if (!target && this.s.ep === to) {
              out.push({ from, to, piece: 'p', color, captured: 'p', capturedAt: idx(cf, r), epCapture: true });
            }
          }
          break;
        }
        case 'n':
          for (const [df, dr] of KNIGHT_DELTAS) {
            const nf = f + df;
            const nr = r + dr;
            if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
            push(idx(nf, nr));
          }
          break;
        case 'k':
          for (const [df, dr] of KING_DELTAS) {
            const nf = f + df;
            const nr = r + dr;
            if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
            push(idx(nf, nr));
          }
          this.addCastles(color, from, out);
          break;
        default: {
          const dirs = piece.type === 'r' ? ROOK_DIRS : piece.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
          for (const [df, dr] of dirs) {
            for (let i = 1; i < 8; i++) {
              const nf = f + df * i;
              const nr = r + dr * i;
              if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
              if (!push(idx(nf, nr))) break;
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * Chess960-aware castling. The king always ends on the c- or g-file and the
   * rook on the d- or f-file, which matches standard chess when the pieces
   * start on e1/a1/h1.
   */
  private addCastles(color: Color, kingFrom: number, out: RawMove[]) {
    const rights = this.s.rights[color];
    if (!rights.size) return;
    const rank = color === WHITE ? 0 : 7;
    if (rankOfIdx(kingFrom) !== rank) return;
    const fog = this.variant === 'fog';
    const enemy = opposite(color);
    if (!fog && this.isAttacked(kingFrom, enemy)) return; // can't castle out of check

    const kingFile = fileOfIdx(kingFrom);
    for (const rookFile of rights) {
      const rookFrom = idx(rookFile, rank);
      const rook = this.s.board[rookFrom];
      if (rook?.type !== 'r' || rook.color !== color) continue;
      const kingside = rookFile > kingFile;
      const kingTo = idx(kingside ? 6 : 2, rank);
      const rookTo = idx(kingside ? 5 : 3, rank);

      // Every square between (and including the endpoints) must be free,
      // ignoring the castling king and rook themselves.
      const lo = Math.min(kingFile, fileOfIdx(kingTo), rookFile, fileOfIdx(rookTo));
      const hi = Math.max(kingFile, fileOfIdx(kingTo), rookFile, fileOfIdx(rookTo));
      let blocked = false;
      for (let f = lo; f <= hi && !blocked; f++) {
        const sq = idx(f, rank);
        if (sq === kingFrom || sq === rookFrom) continue;
        if (this.s.board[sq]) blocked = true;
      }
      if (blocked) continue;

      // The king may not pass through or land on an attacked square.
      if (!fog) {
        const step = fileOfIdx(kingTo) >= kingFile ? 1 : -1;
        let attacked = false;
        for (let f = kingFile; f !== fileOfIdx(kingTo) + step && !attacked; f += step) {
          if (this.isAttacked(idx(f, rank), enemy)) attacked = true;
        }
        if (attacked) continue;
      }

      out.push({ from: kingFrom, to: kingTo, piece: 'k', color, castle: kingside ? 'k' : 'q', rookFrom, rookTo });
    }
  }

  /** Legal moves for the side to move (Fog of War skips the self-check filter). */
  private legalRaw(): RawMove[] {
    const pseudo = this.pseudoMoves(this.s.turn);
    if (this.variant === 'fog') return pseudo;
    const color = this.s.turn;
    return pseudo.filter((m) => {
      const undo = this.applyRaw(m);
      const king = this.kingSquare(color);
      const ok = king === null || !this.isAttacked(king, opposite(color));
      undo();
      return ok;
    });
  }

  moves(): MoveLike[] {
    return this.legalRaw().map((m) => this.describe(m));
  }

  movesFrom(square: Square): MoveLike[] {
    const from = squareToIdx(square);
    return this.legalRaw()
      .filter((m) => m.from === from)
      .map((m) => this.describe(m));
  }

  /** Count of legal moves without building descriptions. */
  moveCount(): number {
    return this.legalRaw().length;
  }

  /* ───────────────────────── applying moves ───────────────────────── */

  /** Applies a raw move and returns a function that reverts it exactly. */
  private applyRaw(m: RawMove): () => void {
    const b = this.s.board;
    const prev = {
      turn: this.s.turn,
      ep: this.s.ep,
      halfMoves: this.s.halfMoves,
      fullMoves: this.s.fullMoves,
      rightsW: new Set(this.s.rights.w),
      rightsB: new Set(this.s.rights.b),
      kingCapturedBy: this.kingCapturedBy,
    };
    const moving = b[m.from]!;
    const capturedPiece = m.capturedAt !== undefined ? b[m.capturedAt] : null;
    const rookPrev = m.castle !== undefined ? b[m.rookFrom!]! : null;

    if (m.castle !== undefined) {
      // In Chess960 the king's and rook's squares can overlap (king f1→g1 while
      // rook g1→f1), so both are lifted before either is placed.
      b[m.from] = null;
      b[m.rookFrom!] = null;
      b[m.to] = moving;
      b[m.rookTo!] = rookPrev;
    } else {
      b[m.from] = null;
      if (m.capturedAt !== undefined) b[m.capturedAt] = null;
      b[m.to] = m.promotion ? { color: m.color, type: m.promotion } : moving;
    }

    if (m.captured === 'k') this.kingCapturedBy = m.color;

    // Castling rights
    const rights = this.s.rights[m.color];
    if (m.piece === 'k') rights.clear();
    else if (m.piece === 'r' && rankOfIdx(m.from) === (m.color === WHITE ? 0 : 7)) rights.delete(fileOfIdx(m.from));
    if (m.captured === 'r' && m.capturedAt !== undefined) {
      const victim = opposite(m.color);
      if (rankOfIdx(m.capturedAt) === (victim === WHITE ? 0 : 7)) this.s.rights[victim].delete(fileOfIdx(m.capturedAt));
    }

    this.s.ep = null;
    if (m.doublePush) {
      const enemy = opposite(m.color);
      const destRank = rankOfIdx(m.to);
      for (const df of [-1, 1]) {
        const nf = fileOfIdx(m.to) + df;
        if (nf < 0 || nf > 7) continue;
        const neighbour = b[idx(nf, destRank)];
        if (neighbour?.type === 'p' && neighbour.color === enemy) {
          this.s.ep = idx(fileOfIdx(m.from), (rankOfIdx(m.from) + destRank) / 2);
          break;
        }
      }
    }
    this.s.halfMoves = m.piece === 'p' || m.captured ? 0 : this.s.halfMoves + 1;
    if (m.color === BLACK) this.s.fullMoves += 1;
    this.s.turn = opposite(m.color);

    return () => {
      if (m.castle !== undefined) {
        b[m.to] = null;
        b[m.rookTo!] = null;
        b[m.from] = moving;
        b[m.rookFrom!] = rookPrev;
      } else {
        b[m.to] = null;
        b[m.from] = moving;
        if (m.capturedAt !== undefined) b[m.capturedAt] = capturedPiece;
      }
      this.s.turn = prev.turn;
      this.s.ep = prev.ep;
      this.s.halfMoves = prev.halfMoves;
      this.s.fullMoves = prev.fullMoves;
      this.s.rights.w = prev.rightsW;
      this.s.rights.b = prev.rightsB;
      this.kingCapturedBy = prev.kingCapturedBy;
    };
  }

  /** Builds the public description of a move (SAN included) without keeping it applied. */
  private describe(m: RawMove): MoveLike {
    const before = this.fen();
    const san = this.sanOf(m);
    const undo = this.applyRaw(m);
    const after = this.fen();
    undo();
    return {
      color: m.color,
      from: idxToSquare(m.from),
      to: idxToSquare(m.to),
      piece: m.piece,
      ...(m.captured ? { captured: m.captured } : {}),
      ...(m.promotion ? { promotion: m.promotion } : {}),
      san,
      // Chess960 castling uses the UCI "king takes rook" encoding, which stays
      // unambiguous when the king's destination is also a legal king step.
      // Standard chess keeps the classic e1g1/e1c1 form.
      lan:
        m.castle !== undefined && this.variant === 'chess960'
          ? `${idxToSquare(m.from)}${idxToSquare(m.rookFrom!)}`
          : `${idxToSquare(m.from)}${idxToSquare(m.to)}${m.promotion ?? ''}`,
      before,
      after,
      isCapture: !!m.captured,
      isCastle: m.castle !== undefined,
      ...(m.castle !== undefined ? { castleRook: { from: idxToSquare(m.rookFrom!), to: idxToSquare(m.rookTo!) } } : {}),
      isEnPassant: !!m.epCapture,
      isKingCapture: m.captured === 'k',
    };
  }

  private sanOf(m: RawMove): string {
    if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
    const to = idxToSquare(m.to);
    let san: string;
    if (m.piece === 'p') {
      san = m.captured ? `${FILES[fileOfIdx(m.from)]}x${to}` : to;
      if (m.promotion) san += `=${m.promotion.toUpperCase()}`;
    } else {
      // Disambiguate only against same-type pieces whose move is actually
      // legal — a pinned knight doesn't force a file/rank qualifier.
      const rivals = this.legalRaw().filter(
        (o) => o.piece === m.piece && o.to === m.to && o.from !== m.from && !o.castle,
      );
      let suffix = '';
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOfIdx(o.from) === fileOfIdx(m.from));
        const sameRank = rivals.some((o) => rankOfIdx(o.from) === rankOfIdx(m.from));
        if (!sameFile) suffix = FILES[fileOfIdx(m.from)]!;
        else if (!sameRank) suffix = String(rankOfIdx(m.from) + 1);
        else suffix = `${FILES[fileOfIdx(m.from)]}${rankOfIdx(m.from) + 1}`;
      }
      san = `${m.piece.toUpperCase()}${suffix}${m.captured ? 'x' : ''}${to}`;
    }
    if (this.variant === 'fog') return san; // no check/mate notation in the fog

    const undo = this.applyRaw(m);
    const enemy = opposite(m.color);
    const check = this.inCheck(enemy);
    const mate = check && this.legalRaw().length === 0;
    undo();
    return san + (mate ? '#' : check ? '+' : '');
  }

  /** Plays a move. Returns null when it isn't legal in this position. */
  move(req: { from: Square; to: Square; promotion?: PromotionPiece }): MoveLike | null {
    const from = squareToIdx(req.from);
    const to = squareToIdx(req.to);
    const legal = this.legalRaw().filter((m) => m.from === from);

    // In Chess960 the king's castling target can also be a plain king step
    // (king b1 → c1). Dropping the king on its own rook always means castling;
    // naming the destination square prefers the ordinary move, and only falls
    // back to castling when nothing else lands there.
    const ontoRook = legal.find((m) => m.castle !== undefined && m.rookFrom === to);
    const plain = legal.filter((m) => m.to === to && m.castle === undefined);
    const castleTo = legal.find((m) => m.castle !== undefined && m.to === to);
    const candidates = ontoRook ? [ontoRook] : plain.length ? plain : castleTo ? [castleTo] : [];
    if (!candidates.length) return null;
    const chosen = req.promotion ? candidates.find((m) => m.promotion === req.promotion) : (candidates.find((m) => !m.promotion) ?? candidates.find((m) => m.promotion === 'q'));
    const raw = chosen ?? candidates[0]!;
    const described = this.describe(raw);
    this.applyRaw(raw);
    this.history.push(this.repetitionKey());
    return described;
  }

  /** Needed for Chess960: castling by dropping the king on its own rook. */
  castleTargetForRook(kingSquare: Square, rookSquare: Square): Square | null {
    const from = squareToIdx(kingSquare);
    const rookIdx = squareToIdx(rookSquare);
    const match = this.legalRaw().find((m) => m.from === from && m.castle && m.rookFrom === rookIdx);
    return match ? idxToSquare(match.to) : null;
  }

  outcome(): Outcome | null {
    if (this.variant === 'fog') {
      if (this.kingCapturedBy) {
        return { result: this.kingCapturedBy === WHITE ? '1-0' : '0-1', reason: 'king-captured', winner: this.kingCapturedBy };
      }
      // A side with no moves at all is stalemated; everything else continues.
      if (!this.legalRaw().length) return { result: '1/2-1/2', reason: 'stalemate', winner: null };
    } else if (!this.legalRaw().length) {
      if (this.inCheck()) {
        const winner = opposite(this.s.turn);
        return { result: winner === WHITE ? '1-0' : '0-1', reason: 'checkmate', winner };
      }
      return { result: '1/2-1/2', reason: 'stalemate', winner: null };
    }
    if (this.s.halfMoves >= 100) return { result: '1/2-1/2', reason: 'fifty-move', winner: null };
    const key = this.history.at(-1)!;
    if (this.history.filter((k) => k === key).length >= 3) return { result: '1/2-1/2', reason: 'threefold', winner: null };
    if (this.insufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient', winner: null };
    return null;
  }

  private insufficientMaterial(): boolean {
    const pieces: { color: Color; type: PieceSymbol; sq: number }[] = [];
    this.s.board.forEach((p, i) => p && pieces.push({ ...p, sq: i }));
    if (pieces.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return false;
    const minors = pieces.filter((p) => p.type === 'n' || p.type === 'b');
    if (minors.length <= 1) return true; // K v K, K+minor v K
    if (minors.length === 2 && minors.every((m) => m.type === 'b')) {
      // Two bishops on the same colour complex can't mate.
      const colorOf = (sq: number) => (fileOfIdx(sq) + rankOfIdx(sq)) % 2;
      return minors[0]!.color !== minors[1]!.color && colorOf(minors[0]!.sq) === colorOf(minors[1]!.sq);
    }
    return false;
  }

  clone(): VariantBoard {
    const copy = new VariantBoard(this.fen(), this.variant);
    copy.history = [...this.history];
    copy.kingCapturedBy = this.kingCapturedBy;
    return copy;
  }

  /** Move-generation node count, used to verify this generator against chess.js. */
  perft(depth: number): number {
    if (depth === 0) return 1;
    const moves = this.legalRaw();
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) {
      const undo = this.applyRaw(m);
      nodes += this.perft(depth - 1);
      undo();
    }
    return nodes;
  }
}
