import { Chess, type Move } from 'chess.js';
import type { EngineController } from '@/engine/EngineController';
import type { OpeningBook } from '@/engine/book/openingBook';
import { detectSacrifice, pieceValue } from '@/engine/sacrifice';
import { winPercent } from '@/engine/winProbability';
import type { BotPersonality } from './personalities';

export interface BotContext {
  fen: string;
  ply: number;
  /** Bot's remaining time and increment, or null for untimed games. */
  clock: { remainingMs: number; incrementMs: number } | null;
  book: OpeningBook | null;
}

export type DecisionSource = 'forced' | 'book' | 'oversight' | 'shallow' | 'engine';

export interface BotDecision {
  uci: string;
  source: DecisionSource;
  /** Target total think time (the caller subtracts engine time already spent). */
  thinkMs: number;
}

type Rng = () => number;

function weightedPick<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T {
  const ws = items.map((t) => Math.max(0, weight(t)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return items[i]!;
  }
  return items.at(-1)!;
}

/** "Looks natural" weighting for a move picked without calculation. */
function naturalness(m: Move): number {
  let w = 1;
  if (m.captured) w += 2 + pieceValue(m.captured) * 0.5;
  if (m.san.includes('+')) w += 1.5;
  if (m.piece === 'p' && 'cdef'.includes(m.to[0]!)) w += 1;
  if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) w += 1.2;
  if (m.piece === 'k' && !m.isKingsideCastle() && !m.isQueensideCastle()) w *= 0.3;
  return w;
}

function thinkTime(bot: BotPersonality, ctx: BotContext, legalCount: number, source: DecisionSource, rng: Rng): number {
  const [lo, hi] = bot.thinkMs;
  let ms = lo + (hi - lo) * rng();
  ms *= 0.75 + Math.min(1, legalCount / 35) * 0.5; // more options → longer think
  if (source === 'book') ms *= 0.45;
  if (source === 'forced') ms = Math.min(ms, 450);
  if (ctx.clock) {
    const budget = ctx.clock.remainingMs / 32 + ctx.clock.incrementMs * 0.8;
    ms = Math.min(ms, Math.max(150, budget));
  }
  return Math.round(ms);
}

/**
 * Picks a move "in character":
 *  1. book move, weighted by popularity and the bot's opening tastes
 *  2. occasional natural-looking oversight (weaker bots)
 *  3. shallow 2-ply search (misses two-move tactics)
 *  4. MultiPV engine search; lines are scored as win% plus a style bonus and
 *     sampled with a softmax at the bot's temperature
 */
export async function chooseBotMove(engine: EngineController, bot: BotPersonality, ctx: BotContext, rng: Rng = Math.random): Promise<BotDecision> {
  const chess = new Chess(ctx.fen);
  const mover = chess.turn();
  const legal = chess.moves({ verbose: true });
  if (!legal.length) throw new Error('bot asked to move in a terminal position');
  const decide = (uci: string, source: DecisionSource): BotDecision => ({ uci, source, thinkMs: thinkTime(bot, ctx, legal.length, source, rng) });

  if (legal.length === 1) return decide(legal[0]!.lan, 'forced');

  // 1. Opening book.
  if (ctx.book && ctx.ply < bot.book.maxPly) {
    const options = ctx.book.continuations(ctx.fen);
    if (options.length) {
      const pick = weightedPick(
        options,
        (o) => {
          let w = Math.sqrt(o.lines);
          const name = o.opening?.name ?? '';
          for (const [kw, mult] of Object.entries(bot.book.preferences)) if (name.includes(kw)) w *= mult;
          return w;
        },
        rng,
      );
      return decide(pick.uci, 'book');
    }
  }

  // 2. Oversight.
  if (rng() < bot.oversightRate) return decide(weightedPick(legal, naturalness, rng).lan, 'oversight');

  // 3/4. Engine.
  const shallow = rng() < bot.shallowRate;
  const pieces = chess.board().flat().filter(Boolean).length;
  const endgame = pieces <= 10;
  const depth = shallow ? 2 : bot.search.depth + (endgame ? bot.search.endgameDepthBonus : 0);
  const multiPv = Math.min(bot.search.multiPv, legal.length);
  const res = await engine.analyze({
    fen: ctx.fen,
    limits: { depth, movetime: bot.search.movetime },
    options: { multiPv },
    channel: 'bot',
  }).result;
  if (res.cancelled && !res.lines.length) throw new Error('bot search cancelled');

  const source: DecisionSource = shallow ? 'shallow' : 'engine';
  if (bot.search.temperature <= 0 || res.lines.length <= 1) {
    const uci = res.bestMove ?? res.lines[0]?.pv[0] ?? legal[0]!.lan;
    return decide(uci, source);
  }

  const byUci = new Map(legal.map((m) => [m.lan, m]));
  const temperature = bot.search.temperature * (endgame ? 0.6 : 1);
  const maxDrop = Math.max(6, temperature * 5);
  const bestW = winPercent(res.lines[0]!.eval, mover);
  const candidates = res.lines
    .filter((l) => l.pv[0] && byUci.has(l.pv[0]))
    .map((l) => {
      const m = byUci.get(l.pv[0]!)!;
      const w = winPercent(l.eval, mover);
      const givesCheck = m.san.includes('+') || m.san.includes('#');
      let bonus = 0;
      if (m.captured) bonus += bot.style.capture;
      if (givesCheck) bonus += bot.style.check;
      if (!m.captured && !givesCheck) bonus += bot.style.quiet;
      if (bot.style.sacrifice !== 0 && detectSacrifice(m.after, mover, pieceValue(m.captured)).isSacrifice) bonus += bot.style.sacrifice;
      return { uci: m.lan, w, score: w + bonus };
    })
    .filter((c) => c.w >= bestW - maxDrop);
  if (!candidates.length) return decide(res.bestMove ?? legal[0]!.lan, source);

  const top = Math.max(...candidates.map((c) => c.score));
  const pick = weightedPick(candidates, (c) => Math.exp((c.score - top) / temperature), rng);
  return decide(pick.uci, source);
}
