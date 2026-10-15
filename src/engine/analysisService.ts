import { Chess } from 'chess.js';
import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color, MoveIntent } from '@/lib/chess/types';
import { CLASS_META, RETRYABLE, type MoveClass } from '@/lib/classification';
import { fenAtPly, useGameStore, type GameStore, type PositionEval, type ReviewSummary } from '@/store/gameStore';
import { gameAccuracy } from './accuracy';
import { loadOpeningBook, type OpeningBook } from './book/openingBook';
import { classifyMove } from './classifier';
import { EngineController, terminalEvaluation, type AnalysisJob, type AnalysisSnapshot, type PvLine } from './EngineController';
import { winPercent } from './winProbability';

/** Live position: deep enough to classify confidently (spec: depth 14–18). */
export const LIVE_LIMITS = { depth: 16, movetime: 2200 } as const;
/** Gap-filling / review positions. */
export const BACKFILL_LIMITS = { depth: 14, movetime: 1300 } as const;
const MULTI_PV = 3;
/** Partial (interrupted) searches at least this deep are still worth keeping. */
const MIN_USEFUL_DEPTH = 10;
/** Book badges only apply in the opening phase (~first 15 moves). */
const MAX_BOOK_PLY = 30;

interface CachedEval {
  depth: number;
  lines: PvLine[];
  bestMove: string | null;
  terminal: boolean;
}

const cacheKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
const store = () => useGameStore.getState();

/**
 * Orchestrates the analysis engine:
 *  1. Focus: the viewed position is searched at depth 16 with MultiPV 3, and
 *     the eval bar streams as depth increases. Scrubbing or fast play
 *     supersedes the old job.
 *  2. Classification: each ply is classified, in order, as soon as both of its
 *     endpoint positions are analysed (in order so the Miss rule can see the
 *     opponent's previous move).
 *  3. Backfill: when the engine is idle, missing positions are filled in at
 *     depth 14, every position during Game Review.
 *  4. Review summary: accuracy and class counts once everything is analysed.
 */
class AnalysisService {
  private engine: EngineController | null = null;
  private botEngine: Promise<EngineController> | null = null;
  private book: OpeningBook | null = null;
  private cache = new Map<string, CachedEval>();
  /** Positions the engine repeatedly failed to analyse; skipped rather than retried forever. */
  private failed = new Map<string, number>();
  private focus: { fen: string; job: AnalysisJob } | null = null;
  private backfill: { fen: string; job: AnalysisJob } | null = null;
  private tickQueued = false;
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    store().setEngineStatus({ state: 'loading' });
    try {
      const [engine, book] = await Promise.all([EngineController.create({ maxThreads: 4 }), loadOpeningBook()]);
      this.engine = engine;
      this.book = book;
      const info = engine.info!;
      store().setEngineStatus({ state: 'ready', flavor: info.flavor, threads: info.threads });
      engine.onStatus((status, detail) => {
        if (status === 'ready') store().setEngineStatus({ state: 'ready', detail: undefined });
        else store().setEngineStatus({ state: status, detail });
        if (status === 'ready') this.schedule();
      });
    } catch (err) {
      store().setEngineStatus({ state: 'error', detail: String(err) });
      return;
    }

    useGameStore.subscribe((s, prev) => {
      if (s.status.state === 'over' && prev.status.state === 'playing' && s.moves.length > 1) this.requestReview();
      if (
        s.gameId !== prev.gameId ||
        s.moves !== prev.moves ||
        s.viewPly !== prev.viewPly ||
        s.review.status !== prev.review.status ||
        s.positionEvals !== prev.positionEvals ||
        s.retry?.ply !== prev.retry?.ply
      ) {
        this.schedule();
      }
    });
    this.schedule();
  }

  /** Lazily spawns the separate engine that plays for bots. */
  getBotEngine(): Promise<EngineController> {
    return (this.botEngine ??= EngineController.create({ maxThreads: 2, hashMb: 32 }));
  }

  getBook(): OpeningBook | null {
    return this.book;
  }

  requestReview() {
    const s = store();
    if (s.moves.length < 1 || s.review.status === 'running') return;
    s.setReview({ status: 'running', progress: 0, summary: null });
    s.setSidebarTab('review');
    this.schedule();
  }

  /* ───────────────────────────── scheduling ───────────────────────────── */

  private schedule() {
    if (this.tickQueued) return;
    this.tickQueued = true;
    queueMicrotask(() => {
      this.tickQueued = false;
      this.tick();
    });
  }

  private tick() {
    const engine = this.engine;
    const book = this.book;
    if (!engine || !book) return;
    const s = store();
    const n = s.moves.length;
    const fens = [s.startFen, ...s.moves.map((m) => m.fenAfter)];

    // 1. Opening name + book plies (instant, no engine).
    const line = book.analyseLine(fens, s.viewPly);
    const bookPlies = Math.min(line.bookPlies, MAX_BOOK_PLY);
    s.setOpening(line.opening, bookPlies);

    // 2. Hydrate positionEvals from cache (transpositions, takebacks, replays).
    for (let ply = 0; ply <= n; ply++) {
      if (s.positionEvals[ply]) continue;
      const hit = this.cache.get(cacheKey(fens[ply]!));
      if (hit) s.setPositionEval(ply, toPositionEval(fens[ply]!, hit));
    }

    // 3. Classify ready plies, in order.
    this.classifyReady();

    // 4. Focus on the viewed position (or the retry position).
    const st = store();
    const focusPly = st.retry ? st.retry.ply - 1 : st.viewPly;
    const focusFen = fens[focusPly]!;
    const cached = this.cache.get(cacheKey(focusFen));
    if (cached && (cached.terminal || cached.depth >= LIVE_LIMITS.depth)) {
      st.setEvaluation(cached.lines[0]!.eval);
      if (this.focus) {
        this.focus.job.cancel();
        this.focus = null;
      }
    } else if (this.focus?.fen !== focusFen) {
      this.startFocus(focusPly, focusFen);
      return; // backfill waits until focus is done
    } else {
      return; // focus job still running
    }

    // 5. Backfill the next missing position.
    if (this.backfill) return;
    const target = this.nextBackfillTarget(fens);
    if (target !== null) this.startBackfill(target, fens[target]!);
    else this.maybeFinishReview();
  }

  private startFocus(ply: number, fen: string) {
    const engine = this.engine!;
    this.focus?.job.cancel();
    if (this.backfill) {
      this.backfill.job.cancel();
      this.backfill = null;
    }
    const job = engine.analyze({
      fen,
      limits: LIVE_LIMITS,
      options: { multiPv: MULTI_PV },
      channel: 'focus',
      onInfo: (snap) => this.onFocusInfo(fen, snap),
    });
    this.focus = { fen, job };
    void job.result.then((res) => {
      if (this.focus?.job === job) this.focus = null;
      this.store(fen, res, !res.cancelled);
      const pe = this.cache.get(cacheKey(fen));
      if (pe) {
        const s = store();
        const viewFen = fenAtPly(s, s.retry ? s.retry.ply - 1 : s.viewPly);
        if (viewFen === fen) s.setEvaluation(pe.lines[0]!.eval);
        s.setPositionEval(ply, toPositionEval(fen, pe));
      }
      this.schedule();
    });
  }

  private onFocusInfo(fen: string, snap: AnalysisSnapshot) {
    const s = store();
    const line = snap.lines[0];
    if (!line) return;
    const viewFen = fenAtPly(s, s.retry ? s.retry.ply - 1 : s.viewPly);
    if (viewFen === fen) s.setEvaluation(line.eval);
    s.setEngineStatus({ depth: snap.depth, nps: snap.nps });
  }

  private startBackfill(ply: number, fen: string) {
    const job = this.engine!.analyze({ fen, limits: BACKFILL_LIMITS, options: { multiPv: MULTI_PV }, channel: 'backfill' });
    this.backfill = { fen, job };
    void job.result.then((res) => {
      if (this.backfill?.job === job) this.backfill = null;
      this.store(fen, res, !res.cancelled);
      const pe = this.cache.get(cacheKey(fen));
      if (pe) store().setPositionEval(ply, toPositionEval(fen, pe));
      else if (!res.cancelled) this.failed.set(cacheKey(fen), (this.failed.get(cacheKey(fen)) ?? 0) + 1);
      this.updateReviewProgress();
      this.schedule();
    });
  }

  /** Earliest position needed to classify the earliest unclassified non-book ply (all positions in review). */
  private nextBackfillTarget(fens: string[]): number | null {
    const s = store();
    const has = (ply: number) => !!s.positionEvals[ply] || this.cache.has(cacheKey(fens[ply]!)) || this.isDead(fens[ply]!);
    for (let ply = 1; ply <= s.moves.length; ply++) {
      if (s.annotations[ply]) continue;
      if (!has(ply - 1)) return ply - 1;
      if (!has(ply)) return ply;
    }
    if (s.review.status === 'running') {
      for (let ply = 0; ply <= s.moves.length; ply++) if (!has(ply)) return ply;
    }
    return null;
  }

  private isDead(fen: string): boolean {
    return (this.failed.get(cacheKey(fen)) ?? 0) >= 2;
  }

  private store(fen: string, res: { depth: number; lines: PvLine[]; bestMove: string | null }, complete: boolean) {
    if (!res.lines.length) return;
    if (!complete && res.depth < MIN_USEFUL_DEPTH) return;
    const key = cacheKey(fen);
    const prev = this.cache.get(key);
    if (prev && prev.depth >= res.depth) return;
    const terminal = res.lines[0]!.eval.kind === 'terminal';
    this.cache.set(key, { depth: terminal ? 99 : res.depth, lines: res.lines, bestMove: res.bestMove, terminal });
  }

  /* ───────────────────────────── classification ───────────────────────────── */

  private classifyReady() {
    const s = store();
    const fens = [s.startFen, ...s.moves.map((m) => m.fenAfter)];
    const unclassifiable = (ply: number) => this.isDead(fens[ply - 1]!) || this.isDead(fens[ply]!);
    for (let ply = 1; ply <= s.moves.length; ply++) {
      if (s.annotations[ply]) continue;
      const rec = s.moves[ply - 1]!;
      const isBook = ply <= store().bookPlies;
      // Keep order: Miss needs the opponent's previous classification.
      if (ply > 1 && !store().annotations[ply - 1] && !unclassifiable(ply - 1)) return;
      const before = store().positionEvals[ply - 1];
      const after = store().positionEvals[ply];
      if (!before || !after || !before.lines.length) {
        if (unclassifiable(ply)) continue;
        return;
      }

      const twoAgo = store().positionEvals[ply - 2];
      const result = classifyMove({
        mover: rec.color,
        playedUci: rec.lan,
        captured: rec.captured,
        fenAfter: rec.fenAfter,
        linesBefore: before.lines,
        evalAfter: after.eval,
        legalMoveCount: rec.legalMoveCount,
        isBook,
        previousOpponentClass: store().annotations[ply - 1]?.classification,
        winTwoPliesAgo: twoAgo ? winPercent(twoAgo.eval, rec.color) : undefined,
      });
      store().setAnnotation(ply, {
        classification: result.classification,
        evalBefore: before.eval,
        evalAfter: after.eval,
        bestMove: result.bestMove ?? undefined,
        playedMove: rec.lan,
        winBefore: result.winBefore,
        winAfter: result.winAfter,
        winLoss: result.winLoss,
        reason: result.reason,
      });
    }
  }

  /* ───────────────────────────── review ───────────────────────────── */

  private updateReviewProgress() {
    const s = store();
    if (s.review.status !== 'running') return;
    const n = s.moves.length;
    const evals = Object.keys(s.positionEvals).length;
    const classified = Object.keys(s.annotations).length;
    s.setReview({ progress: Math.min(0.99, (evals + classified) / (2 * n + 1)) });
  }

  private maybeFinishReview() {
    const s = store();
    if (s.review.status !== 'running') return;
    const n = s.moves.length;
    const fens = [s.startFen, ...s.moves.map((m) => m.fenAfter)];
    const missing = (ply: number) => !s.positionEvals[ply] && !this.isDead(fens[ply]!);
    for (let ply = 0; ply <= n; ply++) if (missing(ply)) return this.updateReviewProgress();
    for (let ply = 1; ply <= n; ply++) {
      const unclassifiable = this.isDead(fens[ply - 1]!) || this.isDead(fens[ply]!);
      if (!s.annotations[ply] && !unclassifiable) return this.updateReviewProgress();
    }
    s.setReview({ status: 'done', progress: 1, summary: summarize(s) });
  }

  /* ───────────────────────────── retry mistakes ───────────────────────────── */

  startRetry(fromPly = 1) {
    const s = store();
    const ply = findRetryable(s, fromPly);
    if (ply === null) {
      s.setRetry(null);
      return false;
    }
    const mover = s.moves[ply - 1]!.color;
    s.goToPly(ply - 1);
    if (s.orientation !== mover) s.flip();
    s.setRetry({ ply, mover, status: 'trying', attempt: null, message: `Find a better move for ${mover === 'w' ? 'White' : 'Black'}.`, tries: 0 });
    return true;
  }

  nextRetry() {
    const r = store().retry;
    if (!this.startRetry(r ? r.ply + 1 : 1)) {
      store().setRetry(null);
      store().goToPly(store().moves.length);
    }
  }

  exitRetry() {
    store().setRetry(null);
    store().goToPly(store().moves.length);
  }

  revealRetry() {
    const s = store();
    const r = s.retry;
    if (!r) return;
    const pe = s.positionEvals[r.ply - 1];
    const best = pe?.bestMove;
    const san = best ? sanOf(fenAtPly(s, r.ply - 1), best) : null;
    s.setRetry({ ...r, status: 'revealed', attempt: null, message: san ? `The best move was ${san}.` : 'No engine line available.' });
  }

  /** Grades an attempt. Returns true if it was legal (so the board accepts it). */
  attemptRetry(intent: MoveIntent): boolean {
    const s = store();
    const r = s.retry;
    if (!r || r.status === 'checking' || r.status === 'solved' || !this.engine) return false;
    const fenBefore = fenAtPly(s, r.ply - 1);
    const chess = new Chess(fenBefore);
    const legalMoveCount = chess.moves().length;
    let move;
    try {
      move = chess.move({ from: intent.from, to: intent.to, promotion: intent.promotion });
    } catch {
      return false;
    }
    const pe = s.positionEvals[r.ply - 1];
    if (!pe) return false;
    const key = r.tries + 1;
    const attempt = { key, uci: move.lan, fen: move.after, to: move.to, classification: null };
    s.setRetry({ ...r, status: 'checking', attempt, tries: key, message: 'Checking…' });

    const grade = (evalAfter: Evaluation) => {
      const cur = store().retry;
      if (!cur || cur.attempt?.key !== key) return;
      const out = classifyMove({
        mover: r.mover,
        playedUci: move.lan,
        captured: move.captured,
        fenAfter: move.after,
        linesBefore: pe.lines,
        evalAfter,
        legalMoveCount,
        isBook: false,
      });
      const solved = out.classification === 'best' || out.classification === 'great' || out.classification === 'brilliant';
      const label = CLASS_META[out.classification].label;
      store().setRetry({
        ...cur,
        status: solved ? 'solved' : 'trying',
        attempt: { ...attempt, classification: out.classification },
        message: solved ? `${label}! You found it.` : out.classification === 'excellent' || out.classification === 'good' ? `${label}, but there's something stronger.` : `${label}. Try again.`,
      });
      if (!solved) {
        setTimeout(() => {
          const now = store().retry;
          if (now?.attempt?.key === key && now.status === 'trying') store().setRetry({ ...now, attempt: null });
        }, 1200);
      }
    };

    const known = pe.lines.find((l) => l.pv[0] === move.lan);
    if (known) {
      queueMicrotask(() => grade(known.eval));
    } else {
      const terminal = terminalEvaluation(move.after);
      if (terminal) queueMicrotask(() => grade(terminal));
      else
        void this.engine
          .analyze({ fen: move.after, limits: { depth: 14, movetime: 1500 }, options: { multiPv: 1 }, channel: 'retry' })
          .result.then((res) => res.lines[0] && grade(res.lines[0].eval));
    }
    return true;
  }
}

function toPositionEval(fen: string, c: CachedEval): PositionEval {
  return { fen, eval: c.lines[0]!.eval, depth: c.depth, lines: c.lines, bestMove: c.bestMove ?? c.lines[0]?.pv[0] ?? null };
}

function sanOf(fen: string, uci: string): string | null {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m.san;
  } catch {
    return null;
  }
}

function findRetryable(s: GameStore, fromPly: number): number | null {
  for (let ply = Math.max(1, fromPly); ply <= s.moves.length; ply++) {
    const a = s.annotations[ply];
    const mover = s.moves[ply - 1]!.color;
    const mine = s.playerSide === 'both' || s.playerSide === mover;
    if (a && mine && RETRYABLE.has(a.classification) && s.positionEvals[ply - 1]?.bestMove) return ply;
  }
  return null;
}

export function summarize(s: Pick<GameStore, 'moves' | 'positionEvals' | 'annotations'>): ReviewSummary {
  const n = s.moves.length;
  const whiteWin: number[] = [];
  for (let ply = 0; ply <= n; ply++) {
    const pe = s.positionEvals[ply];
    whiteWin.push(pe ? winPercent(pe.eval, 'w') : (whiteWin.at(-1) ?? 50));
  }
  const counts: ReviewSummary['counts'] = { w: {}, b: {} };
  for (let ply = 1; ply <= n; ply++) {
    const cls = s.annotations[ply]?.classification;
    if (!cls) continue;
    const c: Color = s.moves[ply - 1]!.color;
    counts[c][cls] = (counts[c][cls] ?? 0) + 1;
  }
  return { accuracy: gameAccuracy(whiteWin), counts };
}

export type { MoveClass };
export const analysisService = new AnalysisService();
