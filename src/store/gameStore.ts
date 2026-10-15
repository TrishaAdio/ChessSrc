import { create } from 'zustand';
import { Chess, DEFAULT_POSITION, type Move } from 'chess.js';
import { soundBus } from '@/lib/audio/soundBus';
import { EVAL_EQUAL, type Evaluation } from '@/lib/chess/evaluation';
import { findKing, placementFromFen } from '@/lib/chess/squares';
import type { Color, MoveIntent, PieceSymbol, Premove, PromotionPiece, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import { CLASS_META, type MoveAnnotation, type MoveClass } from '@/lib/classification';
import { createClock, pressClock, remainingMs, stopClock, type ClockState } from './clock';
import { UNLIMITED, type TimeControl } from './timeControls';

/* ───────────────────────────── types ───────────────────────────── */

export type Opponent = 'human' | 'sparring';
/** Which color(s) the local user controls. 'both' = pass-and-play. */
export type PlayerSide = Color | 'both';

export interface MoveRecord {
  ply: number;
  san: string;
  lan: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isCapture: boolean;
  isCastle: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  fenBefore: string;
  fenAfter: string;
  /** Clock snapshot after this move (null for untimed games). */
  clockAfter: Record<Color, number> | null;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';
export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'insufficient'
  | 'fifty-move'
  | 'timeout'
  | 'timeout-vs-insufficient'
  | 'resignation';

export type GameStatus =
  | { state: 'playing' }
  | { state: 'over'; result: GameResult; reason: GameOverReason; winner: Color | null };

export type BoardFxKind = 'move' | 'capture' | 'castle' | 'check' | 'checkmate' | 'promote';

/** One-shot visual event consumed by the board (shake, shockwave…). */
export interface BoardFx {
  id: number;
  kind: BoardFxKind;
  square: Square;
  kingSquare: Square | null;
}

export interface Opening {
  eco: string;
  name: string;
}

export interface NewGameOptions {
  playerSide?: PlayerSide;
  opponent?: Opponent;
  timeControl?: TimeControl;
  fen?: string;
}

export type PlayResult =
  | { ok: true; move: MoveRecord }
  | { ok: false; reason: 'illegal' | 'game-over' | 'not-live' };

interface GameState {
  gameId: number;
  startFen: string;
  moves: MoveRecord[];
  /** Ply being displayed. Equals moves.length when viewing the live position. */
  viewPly: number;
  orientation: Color;
  playerSide: PlayerSide;
  opponent: Opponent;
  timeControl: TimeControl;
  clock: ClockState | null;
  status: GameStatus;
  premoves: Premove[];
  /** Keyed by ply (1-based). Filled by the Phase 3 classifier. */
  annotations: Record<number, MoveAnnotation>;
  evaluation: Evaluation;
  opening: Opening | null;
  fx: BoardFx | null;
  /** Dev override for the ambient mood (0..1), null = automatic. */
  ambientOverride: number | null;
}

interface GameActions {
  newGame(opts?: NewGameOptions): void;
  playMove(intent: MoveIntent): PlayResult;
  queuePremove(intent: MoveIntent): void;
  clearPremoves(): void;
  takeback(): void;
  goToPly(ply: number): void;
  stepPly(delta: number): void;
  flip(): void;
  resign(color?: Color): void;
  flag(color: Color): void;
  // Integration points for the engine (Phase 3) and network (Phase 4):
  setEvaluation(e: Evaluation): void;
  setAnnotation(ply: number, annotation: MoveAnnotation): void;
  setOpening(o: Opening | null): void;
  setAmbientOverride(v: number | null): void;
}

export type GameStore = GameState & GameActions;

/* ─────────────────────── live chess.js instance ─────────────────────── */

// chess.js is mutable and not serialisable, so it lives outside React state.
let live = new Chess();

export const liveTurn = (): Color => live.turn();
export const liveLegalMoves = (): Move[] => live.moves({ verbose: true });
export const liveFen = (): string => live.fen();

/* ───────────────────────────── helpers ───────────────────────────── */

let fxCounter = 0;
let premoveCounter = 0;
const PREMOVE_FLUSH_DELAY_MS = 30;
const MAX_PREMOVES = 12;

function toRecord(move: Move, ply: number, chess: Chess, clock: ClockState | null): MoveRecord {
  return {
    ply,
    san: move.san,
    lan: move.lan,
    from: move.from,
    to: move.to,
    color: move.color,
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion,
    isCapture: move.isCapture() || move.isEnPassant(),
    isCastle: move.isKingsideCastle() || move.isQueensideCastle(),
    isCheck: chess.inCheck(),
    isCheckmate: chess.isCheckmate(),
    fenBefore: move.before,
    fenAfter: move.after,
    clockAfter: clock ? { ...clock.remaining } : null,
  };
}

function statusOf(chess: Chess): GameStatus {
  if (chess.isCheckmate()) {
    const winner = opposite(chess.turn());
    return { state: 'over', result: winner === 'w' ? '1-0' : '0-1', reason: 'checkmate', winner };
  }
  const draw = (reason: GameOverReason): GameStatus => ({ state: 'over', result: '1/2-1/2', reason, winner: null });
  if (chess.isStalemate()) return draw('stalemate');
  if (chess.isInsufficientMaterial()) return draw('insufficient');
  if (chess.isThreefoldRepetition()) return draw('threefold');
  if (chess.isDrawByFiftyMoves()) return draw('fifty-move');
  return { state: 'playing' };
}

/** FIDE 6.9: flagging is a draw if the opponent cannot possibly mate. */
function hasMatingMaterial(fen: string, color: Color): boolean {
  const pieces = [...placementFromFen(fen).values()].filter((p) => p.color === color && p.type !== 'k');
  if (pieces.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  return pieces.length >= 2; // two minors can (in some positions) mate
}

function fxFor(rec: MoveRecord): BoardFx {
  const kind: BoardFxKind = rec.isCheckmate
    ? 'checkmate'
    : rec.isCheck
      ? 'check'
      : rec.promotion
        ? 'promote'
        : rec.isCastle
          ? 'castle'
          : rec.isCapture
            ? 'capture'
            : 'move';
  const kingSquare = rec.isCheck ? findKing(placementFromFen(rec.fenAfter), opposite(rec.color)) : null;
  return { id: ++fxCounter, kind, square: rec.to, kingSquare };
}

function soundFor(rec: MoveRecord) {
  const opts = { square: rec.to };
  if (rec.isCheckmate) return; // gameEnd covers it
  if (rec.isCheck) soundBus.play('check', opts);
  else if (rec.promotion) soundBus.play('promote', opts);
  else if (rec.isCastle) soundBus.play('castle', opts);
  else if (rec.isCapture) soundBus.play('capture', opts);
  else soundBus.play('move', opts);
}

function terminalEval(status: GameStatus): Evaluation | null {
  return status.state === 'over' ? { kind: 'terminal', result: status.result } : null;
}

/* ───────────────────────────── store ───────────────────────────── */

const initialState = (opts: NewGameOptions = {}, prev?: GameState): GameState => {
  const playerSide = opts.playerSide ?? prev?.playerSide ?? 'both';
  const timeControl = opts.timeControl ?? prev?.timeControl ?? UNLIMITED;
  const startFen = opts.fen ?? DEFAULT_POSITION;
  return {
    gameId: (prev?.gameId ?? 0) + 1,
    startFen,
    moves: [],
    viewPly: 0,
    orientation: playerSide === 'b' ? 'b' : 'w',
    playerSide,
    opponent: opts.opponent ?? prev?.opponent ?? 'human',
    timeControl,
    clock: createClock(timeControl),
    status: { state: 'playing' },
    premoves: [],
    annotations: {},
    evaluation: EVAL_EQUAL,
    opening: null,
    fx: null,
    ambientOverride: prev?.ambientOverride ?? null,
  };
};

export const useGameStore = create<GameStore>()((set, get) => {
  const flushPremove = () => {
    const s = get();
    if (!s.premoves.length || s.status.state !== 'playing' || s.playerSide === 'both') return;
    if (live.turn() !== s.playerSide) return;
    const [next, ...rest] = s.premoves;
    const legal = live
      .moves({ square: next!.from, verbose: true })
      .find((m) => m.to === next!.to);
    if (!legal) {
      set({ premoves: [] }); // whole chain is invalidated (chess.com behaviour)
      return;
    }
    set({ premoves: rest });
    get().playMove({ from: next!.from, to: next!.to, promotion: legal.promotion ? (next!.promotion ?? 'q') : undefined });
  };

  return {
    ...initialState(),

    newGame(opts) {
      live = new Chess(opts?.fen ?? DEFAULT_POSITION);
      set(initialState(opts, get()));
      soundBus.play('gameStart');
    },

    playMove(intent) {
      const s = get();
      if (s.status.state !== 'playing') return { ok: false, reason: 'game-over' };
      let move: Move;
      try {
        move = live.move({ from: intent.from, to: intent.to, promotion: intent.promotion as PromotionPiece | undefined });
      } catch {
        soundBus.play('illegal', { square: intent.to });
        return { ok: false, reason: 'illegal' };
      }

      const now = performance.now();
      let clock = s.clock ? pressClock(s.clock, move.color, now) : null;
      let status = statusOf(live);

      // A move made after the flag fell (race with the watcher) loses on time.
      if (s.clock && s.clock.active === move.color && remainingMs(s.clock, move.color, now) <= 0) {
        live.undo();
        get().flag(move.color);
        return { ok: false, reason: 'game-over' };
      }

      if (status.state === 'over' && clock) clock = stopClock(clock, now);
      const record = toRecord(move, s.moves.length + 1, live, clock);

      set({
        moves: [...s.moves, record],
        viewPly: s.moves.length + 1,
        clock,
        status,
        fx: fxFor(record),
        evaluation: terminalEval(status) ?? s.evaluation,
      });

      soundFor(record);
      if (status.state === 'over') soundBus.play('gameEnd');
      else if (get().premoves.length) setTimeout(flushPremove, PREMOVE_FLUSH_DELAY_MS);

      return { ok: true, move: record };
    },

    queuePremove(intent) {
      const s = get();
      if (s.playerSide === 'both' || s.status.state !== 'playing') return;
      if (s.premoves.length >= MAX_PREMOVES) return;
      set({ premoves: [...s.premoves, { ...intent, id: ++premoveCounter }] });
      soundBus.play('premove', { square: intent.to });
    },

    clearPremoves() {
      if (get().premoves.length) set({ premoves: [] });
    },

    takeback() {
      const s = get();
      if (!s.moves.length) return;
      // Vs. the sparring partner, take back a full move pair when it's our turn.
      const ours = s.playerSide !== 'both' && live.turn() === s.playerSide;
      const count = s.opponent === 'sparring' && ours && s.moves.length >= 2 ? 2 : 1;
      for (let i = 0; i < count; i++) live.undo();

      const moves = s.moves.slice(0, -count);
      const annotations = Object.fromEntries(
        Object.entries(s.annotations).filter(([ply]) => Number(ply) <= moves.length),
      );
      let clock = s.clock;
      if (clock) {
        const snap = moves.at(-1)?.clockAfter ?? { w: clock.initialMs, b: clock.initialMs };
        clock = {
          ...clock,
          remaining: { ...snap },
          active: moves.length ? live.turn() : null,
          turnStartedAt: moves.length ? performance.now() : null,
        };
      }
      set({
        moves,
        viewPly: moves.length,
        annotations,
        clock,
        premoves: [],
        status: { state: 'playing' },
        evaluation: s.evaluation.kind === 'terminal' ? EVAL_EQUAL : s.evaluation,
        fx: null,
      });
      soundBus.play('move');
    },

    goToPly(ply) {
      const s = get();
      const target = Math.max(0, Math.min(s.moves.length, ply));
      if (target === s.viewPly) return;
      const forwardStep = target === s.viewPly + 1;
      const rec = s.moves[target - 1];
      set({ viewPly: target, fx: forwardStep && rec ? fxFor(rec) : null });
      if (rec && forwardStep) soundFor(rec);
      else soundBus.play('move', { gain: 0.6, square: rec?.to });
    },

    stepPly(delta) {
      get().goToPly(get().viewPly + delta);
    },

    flip() {
      set({ orientation: opposite(get().orientation) });
    },

    resign(color) {
      const s = get();
      if (s.status.state !== 'playing') return;
      const loser: Color = color ?? (s.playerSide === 'both' ? live.turn() : s.playerSide);
      const winner = opposite(loser);
      const status: GameStatus = { state: 'over', result: winner === 'w' ? '1-0' : '0-1', reason: 'resignation', winner };
      set({ status, premoves: [], clock: s.clock ? stopClock(s.clock) : null, evaluation: terminalEval(status)! });
      soundBus.play('gameEnd');
    },

    flag(color) {
      const s = get();
      if (s.status.state !== 'playing' || !s.clock) return;
      if (remainingMs(s.clock, color) > 0) return;
      const winner = opposite(color);
      const status: GameStatus = hasMatingMaterial(live.fen(), winner)
        ? { state: 'over', result: winner === 'w' ? '1-0' : '0-1', reason: 'timeout', winner }
        : { state: 'over', result: '1/2-1/2', reason: 'timeout-vs-insufficient', winner: null };
      const clock = stopClock(s.clock);
      clock.remaining[color] = 0;
      set({ status, clock, premoves: [], evaluation: terminalEval(status)! });
      soundBus.play('gameEnd');
    },

    setEvaluation(evaluation) {
      if (get().status.state === 'over') return;
      set({ evaluation });
    },

    setAnnotation(ply, annotation) {
      const s = get();
      set({ annotations: { ...s.annotations, [ply]: annotation } });
      if (ply === s.viewPly) {
        const cls: MoveClass = annotation.classification;
        const square = s.moves[ply - 1]?.to;
        if (CLASS_META[cls].shake) soundBus.play('blunder', { square });
        else if (cls === 'brilliant') soundBus.play('brilliant', { square });
        else if (cls === 'great') soundBus.play('brilliant', { square, gain: 0.6 });
      }
    },

    setOpening(opening) {
      set({ opening });
    },

    setAmbientOverride(ambientOverride) {
      set({ ambientOverride });
    },
  };
});

/* ───────────────────────────── selectors ───────────────────────────── */

export const selectIsLive = (s: GameStore) => s.viewPly === s.moves.length;
export const selectViewFen = (s: GameStore) => s.moves[s.viewPly - 1]?.fenAfter ?? s.startFen;
