import { useEffect, useRef } from 'react';
import { soundBus } from '@/lib/audio/soundBus';
import { remainingMs } from '@/store/clock';
import { liveLegalMoves, liveTurn, useGameStore } from '@/store/gameStore';

const LOW_TIME_MS = 10_000;

/** Flag-fall detection plus a one-shot low-time warning per side. */
export function useClockWatcher() {
  const active = useGameStore((s) => s.clock?.active ?? null);
  const playing = useGameStore((s) => s.status.state === 'playing');
  const gameId = useGameStore((s) => s.gameId);
  const warned = useRef<Record<string, boolean>>({});

  useEffect(() => {
    warned.current = {};
  }, [gameId]);

  useEffect(() => {
    if (!active || !playing) return;
    const id = window.setInterval(() => {
      const { clock, flag } = useGameStore.getState();
      if (!clock) return;
      const left = remainingMs(clock, active);
      if (left <= 0) flag(active);
      else if (left < LOW_TIME_MS && clock.initialMs > LOW_TIME_MS * 3 && !warned.current[active]) {
        warned.current[active] = true;
        soundBus.play('lowTime');
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [active, playing]);
}

/**
 * DEV sparring partner: makes random legal moves (with a preference for
 * captures). It lets you exercise premoves, clocks and animations before the
 * Stockfish bots arrive in Phase 3. This is not the AI opponent.
 */
export function useSparringPartner() {
  const opponent = useGameStore((s) => s.opponent);
  const playerSide = useGameStore((s) => s.playerSide);
  const playing = useGameStore((s) => s.status.state === 'playing');
  const plyCount = useGameStore((s) => s.moves.length);
  const gameId = useGameStore((s) => s.gameId);

  useEffect(() => {
    if (opponent !== 'sparring' || playerSide === 'both' || !playing) return;
    if (liveTurn() === playerSide) return;
    const delay = 450 + Math.random() * 900;
    const id = window.setTimeout(() => {
      const legal = liveLegalMoves();
      if (!legal.length) return;
      const captures = legal.filter((m) => m.isCapture());
      const pool = captures.length && Math.random() < 0.6 ? captures : legal;
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      useGameStore.getState().playMove({ from: pick.from, to: pick.to, promotion: pick.promotion ? 'q' : undefined });
    }, delay);
    return () => window.clearTimeout(id);
  }, [opponent, playerSide, playing, plyCount, gameId]);
}

/** ←/→ step, Home/End jump, F flip, Ctrl+Z takeback. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const s = useGameStore.getState();
      switch (e.key) {
        case 'ArrowLeft':
          s.stepPly(-1);
          break;
        case 'ArrowRight':
          s.stepPly(1);
          break;
        case 'Home':
          s.goToPly(0);
          break;
        case 'End':
          s.goToPly(s.moves.length);
          break;
        case 'f':
        case 'F':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          s.flip();
          break;
        case 'z':
        case 'Z':
          if (!(e.ctrlKey || e.metaKey)) return;
          s.takeback();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
