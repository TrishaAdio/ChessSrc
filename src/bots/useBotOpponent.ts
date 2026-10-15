import { useEffect, useRef } from 'react';
import { analysisService } from '@/engine/analysisService';
import { parseUciMove } from '@/engine/uci';
import { winPercent } from '@/engine/winProbability';
import type { Color, PromotionPiece, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import { remainingMs } from '@/store/clock';
import { liveFen, liveTurn, useGameStore } from '@/store/gameStore';
import { banterLine, PRIORITY, TONE, type BanterEvent } from './banter';
import { chooseBotMove } from './botBrain';
import { BOTS } from './personalities';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drives the bot's moves when it's the bot's turn. */
export function useBotOpponent() {
  const opponent = useGameStore((s) => s.opponent);
  const playerSide = useGameStore((s) => s.playerSide);
  const playing = useGameStore((s) => s.status.state === 'playing');
  const plyCount = useGameStore((s) => s.moves.length);
  const gameId = useGameStore((s) => s.gameId);
  const botId = useGameStore((s) => s.botId);

  // Warm the engine as soon as a bot game starts.
  useEffect(() => {
    if (opponent === 'bot') void analysisService.getBotEngine();
  }, [opponent, gameId]);

  useEffect(() => {
    if (opponent !== 'bot' || playerSide === 'both' || !playing) return;
    if (liveTurn() === playerSide) return;
    let cancelled = false;
    const token = { gameId, ply: plyCount };

    void (async () => {
      const engine = await analysisService.getBotEngine();
      if (cancelled) return;
      const s = useGameStore.getState();
      const botColor = opposite(playerSide);
      const t0 = performance.now();
      const decision = await chooseBotMove(engine, BOTS[botId], {
        fen: liveFen(),
        ply: plyCount,
        clock: s.clock ? { remainingMs: remainingMs(s.clock, botColor), incrementMs: s.clock.incrementMs } : null,
        book: analysisService.getBook(),
      });
      await sleep(Math.max(0, decision.thinkMs - (performance.now() - t0)));
      const now = useGameStore.getState();
      if (cancelled || now.gameId !== token.gameId || now.moves.length !== token.ply || now.status.state !== 'playing') return;
      const m = parseUciMove(decision.uci);
      now.playMove({ from: m.from as Square, to: m.to as Square, promotion: m.promotion as PromotionPiece | undefined });
    })().catch((err: unknown) => {
      if (!cancelled) console.error('[bot] failed to move', err);
    });

    return () => {
      cancelled = true;
      void analysisService.getBotEngine().then((e) => e.cancelChannel('bot'));
    };
  }, [opponent, playerSide, playing, plyCount, gameId, botId]);
}

const COOLDOWN_MS = 7000;

/** Reactive speech bubbles: listens to game events and lets the bot comment in character. */
export function useBotBanter() {
  const last = useRef(0);
  const flags = useRef(new Set<string>());

  useEffect(() => {
    const say = (event: BanterEvent, vars?: Record<string, string>, chance = 1) => {
      const s = useGameStore.getState();
      if (s.opponent !== 'bot' || s.playerSide === 'both') return;
      if (Math.random() > chance) return;
      const now = performance.now();
      if (PRIORITY[event] < 3 && now - last.current < COOLDOWN_MS) return;
      last.current = now;
      s.say(banterLine(s.botId, event, vars), TONE[event]);
    };
    const once = (key: string) => {
      if (flags.current.has(key)) return false;
      flags.current.add(key);
      return true;
    };

    let greetTimer: ReturnType<typeof setTimeout> | null = null;
    const greet = () => {
      flags.current.clear();
      last.current = 0;
      if (greetTimer) clearTimeout(greetTimer);
      greetTimer = setTimeout(() => say('greet'), 700);
    };
    if (useGameStore.getState().opponent === 'bot') greet();

    const unsub = useGameStore.subscribe((s, prev) => {
      if (s.opponent !== 'bot' || s.playerSide === 'both') return;
      if (s.gameId !== prev.gameId) return greet();
      const human: Color = s.playerSide;
      const bot = opposite(human);

      // Classifications (live play only, not when a review back-fills old plies).
      if (s.annotations !== prev.annotations && s.review.status !== 'running') {
        for (const [plyStr, a] of Object.entries(s.annotations)) {
          const ply = Number(plyStr);
          if (prev.annotations[ply] || ply < s.moves.length - 1) continue;
          const mover = s.moves[ply - 1]?.color;
          if (mover === human) {
            if (a.classification === 'brilliant') say('humanBrilliant');
            else if (a.classification === 'great') say('humanGreat', undefined, 0.7);
            else if (a.classification === 'blunder') say('humanBlunder');
            else if (a.classification === 'mistake' || a.classification === 'miss') say('humanMistake', undefined, 0.5);
          } else if (a.classification === 'blunder') say('botBlunder', undefined, 0.8);
        }
      }

      // Checks.
      if (s.moves.length > prev.moves.length) {
        const last = s.moves.at(-1)!;
        if (last.isCheck && !last.isCheckmate) say(last.color === human ? 'humanCheck' : 'botCheck', undefined, 0.35);
      }

      // Opening recognition (once).
      if (s.opening && s.opening !== prev.opening && s.moves.length >= 4 && s.moves.length <= 16 && once('opening')) {
        say('opening', { opening: s.opening.name.split(':')[0]! }, 0.6);
      }

      // Evaluation swings, from the bot's perspective (live position only).
      if (s.positionEvals !== prev.positionEvals) {
        const pe = s.positionEvals[s.moves.length];
        if (pe && s.status.state === 'playing') {
          const w = winPercent(pe.eval, bot);
          if (w >= 85 && once('winning')) say('botWinning');
          if (w <= 15 && once('losing')) say('botLosing');
        }
      }

      // Low time.
      if (s.clock && s.status.state === 'playing' && s.clock.initialMs >= 60_000 && !flags.current.has('lowtime')) {
        if (remainingMs(s.clock, human) < 20_000 && once('lowtime')) say('humanLowTime');
      }

      // Game over.
      if (s.status.state === 'over' && prev.status.state === 'playing') {
        say(s.status.winner === null ? 'draw' : s.status.winner === bot ? 'win' : 'loss');
      }
    });

    // Low-time check needs a timer (no store change while a clock just runs).
    const timer = setInterval(() => {
      const s = useGameStore.getState();
      if (s.opponent !== 'bot' || s.playerSide === 'both' || !s.clock || s.status.state !== 'playing') return;
      if (s.clock.initialMs >= 60_000 && remainingMs(s.clock, s.playerSide) < 20_000 && once('lowtime')) say('humanLowTime');
    }, 500);

    return () => {
      unsub();
      clearInterval(timer);
      if (greetTimer) clearTimeout(greetTimer);
    };
  }, []);
}
