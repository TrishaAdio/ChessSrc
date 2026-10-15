import { useEffect, useRef } from 'react';
import { soundBus } from '@/lib/audio/soundBus';
import { remainingMs } from '@/store/clock';
import { useGameStore } from '@/store/gameStore';

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
