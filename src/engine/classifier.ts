import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color, PieceSymbol } from '@/lib/chess/types';
import type { MoveClass } from '@/lib/classification';
import type { PvLine } from './EngineController';
import { detectSacrifice, pieceValue } from './sacrifice';
import { isMateAgainst, isMateFor, winPercent } from './winProbability';

/** ΔW thresholds in win-percentage points (product spec). */
export const THRESHOLDS = {
  best: 1.5,
  excellent: 4.5,
  good: 9,
  inaccuracy: 14,
  mistake: 24,
  brilliantMaxLoss: 2.5,
  brilliantMinAfter: 48,
  brilliantMaxBefore: 92,
  greatMaxLoss: 2,
  greatOnlyMoveGap: 12,
  /** "Only good move": the runner-up must not itself be comfortably winning. */
  greatMaxSecond: 70,
  missGap: 15,
  missMinLoss: 10,
  missStillOk: 40,
} as const;

export interface ClassifierInput {
  mover: Color;
  playedUci: string;
  /** Piece captured by the played move, if any (for net sacrifice accounting). */
  captured?: PieceSymbol;
  fenAfter: string;
  /** MultiPV lines for the position BEFORE the move (mover to move), best first. */
  linesBefore: readonly PvLine[];
  /** Best evaluation of the position AFTER the move (White POV). */
  evalAfter: Evaluation;
  /** Number of legal moves the mover had. */
  legalMoveCount: number;
  /**
   * All plies up to and including this one are in the opening book. Book
   * still has to pass an engine sanity check, because the ECO data contains
   * trap lines like "Fool's Mate".
   */
  isBook: boolean;
  /** Classification of the opponent's previous move (for Miss). */
  previousOpponentClass?: MoveClass;
  /** Mover's win % before the opponent's previous move (for "turnaround" Great). */
  winTwoPliesAgo?: number;
}

export interface ClassifierOutput {
  classification: MoveClass;
  winBefore: number;
  winAfter: number;
  /** ΔW in percentage points, ≥ 0. */
  winLoss: number;
  /** Gap between the best and second-best line (percentage points). */
  onlyMoveGap: number;
  bestMove: string | null;
  sacrifice: boolean;
  reason: string;
}

/**
 * Win-probability move classifier modelled on chess.com's system. All
 * comparisons are in expected score from the mover's POV, so dropping from
 * +9 to +6 (still winning) is not a blunder.
 */
export function classifyMove(input: ClassifierInput): ClassifierOutput {
  const { mover, playedUci, linesBefore, evalAfter } = input;
  const best = linesBefore[0];
  const second = linesBefore[1];
  const bestMove = best?.pv[0] ?? null;

  const winBefore = best ? winPercent(best.eval, mover) : 50;
  // When the played move is one of the analysed lines, use that line's score.
  // It comes from the same search, which removes depth noise between searches.
  const playedLine = linesBefore.find((l) => l.pv[0] === playedUci);
  const effectiveAfter = playedLine?.eval ?? evalAfter;
  const winAfter = winPercent(effectiveAfter, mover);
  const isTopMove = !!bestMove && playedUci === bestMove;
  const winLoss = isTopMove ? 0 : Math.max(0, winBefore - winAfter);
  const winSecond = second ? winPercent(second.eval, mover) : null;
  const onlyMoveGap = winSecond !== null ? Math.max(0, winBefore - winSecond) : 0;
  const out = (classification: MoveClass, reason: string, sacrifice = false): ClassifierOutput => ({
    classification,
    winBefore,
    winAfter,
    winLoss,
    onlyMoveGap,
    bestMove,
    sacrifice,
    reason,
  });

  if (input.legalMoveCount <= 1) return out('best', 'forced: only legal move');

  // ── Forced-mate rules ──
  const hadMate = !!best && isMateFor(best.eval, mover);
  const keepsMate = isMateFor(effectiveAfter, mover);
  const wasGettingMated = !!best && isMateAgainst(best.eval, mover);
  const nowGettingMated = isMateAgainst(effectiveAfter, mover);
  if (nowGettingMated && !wasGettingMated) return out('blunder', 'walks into a forced mate');
  if (hadMate && !keepsMate) {
    // Missing a mate but staying crushing is a missed opportunity, not a blunder.
    return winAfter >= 90 ? out('miss', 'missed a forced mate') : out('blunder', 'threw away a forced mate');
  }

  // ── Book: theory, even dubious theory like 1.f3 (≤ inaccuracy-sized loss), but never a
  //    real error or a mating move (the ECO data contains trap lines such as Fool's Mate) ──
  if (input.isBook && winLoss <= THRESHOLDS.inaccuracy && effectiveAfter.kind !== 'terminal' && !keepsMate) {
    return out('book', 'opening theory');
  }

  // ── Brilliant: sound sacrifice, near-best, keeps a good game, wasn't trivially won ──
  if (
    winLoss <= THRESHOLDS.brilliantMaxLoss &&
    winAfter >= THRESHOLDS.brilliantMinAfter &&
    winBefore < THRESHOLDS.brilliantMaxBefore
  ) {
    const sac = detectSacrifice(input.fenAfter, mover, pieceValue(input.captured));
    if (sac.isSacrifice) return out('brilliant', `sound sacrifice (${sac.materialAtRisk} pawns at risk on ${sac.square})`, true);
  }

  // ── Great: the only good move, or a game-turning resource ──
  if (winLoss <= THRESHOLDS.greatMaxLoss && second) {
    if (onlyMoveGap >= THRESHOLDS.greatOnlyMoveGap && winSecond! < THRESHOLDS.greatMaxSecond) {
      return out('great', `only good move (next best is ${onlyMoveGap.toFixed(1)}% worse)`);
    }
    const turnaround = input.winTwoPliesAgo !== undefined && input.winTwoPliesAgo <= 55 && winAfter >= 75 && onlyMoveGap >= 6;
    if (turnaround) return out('great', 'turns the game into a win');
  }

  if (isTopMove || winLoss <= THRESHOLDS.best) return out('best', isTopMove ? "engine's top choice" : 'equivalent to best');

  // ── Miss: failed to punish the opponent's error ──
  const opponentErred = input.previousOpponentClass === 'mistake' || input.previousOpponentClass === 'blunder';
  if (opponentErred && onlyMoveGap >= THRESHOLDS.missGap && winLoss > THRESHOLDS.missMinLoss && winAfter >= THRESHOLDS.missStillOk) {
    return out('miss', "didn't punish the opponent's error");
  }

  if (winLoss <= THRESHOLDS.excellent) return out('excellent', `−${winLoss.toFixed(1)}% win chance`);
  if (winLoss <= THRESHOLDS.good) return out('good', `−${winLoss.toFixed(1)}% win chance`);
  if (winLoss <= THRESHOLDS.inaccuracy) return out('inaccuracy', `−${winLoss.toFixed(1)}% win chance`);
  if (winLoss <= THRESHOLDS.mistake) return out('mistake', `−${winLoss.toFixed(1)}% win chance`);
  return out('blunder', `−${winLoss.toFixed(1)}% win chance`);
}
