import { useEffect, useState } from 'react';
import { winningChances } from '@/lib/chess/evaluation';
import { remainingMs } from '@/store/clock';
import { useGameStore } from '@/store/gameStore';

const ANNOTATION_TENSION: Partial<Record<string, number>> = {
  blunder: 0.55,
  miss: 0.4,
  mistake: 0.4,
  inaccuracy: 0.18,
  brilliant: 0.3,
  great: 0.15,
};

/**
 * Board "mood" from 0 (calm sapphire/emerald) to 1 (amber/crimson). Inputs:
 * checks, recent tactical errors, how decisive the eval is, and low time on
 * the clock that is running. The background spring smooths the result.
 */
export function useAmbientTension(): number {
  const override = useGameStore((s) => s.ambientOverride);
  const viewPly = useGameStore((s) => s.viewPly);
  const lastMove = useGameStore((s) => s.moves[s.viewPly - 1]);
  const annotation = useGameStore((s) => s.annotations[s.viewPly]);
  const evaluation = useGameStore((s) => s.evaluation);
  const status = useGameStore((s) => s.status);
  const clockActive = useGameStore((s) => s.clock?.active ?? null);
  const [timePressure, setTimePressure] = useState(0);

  useEffect(() => {
    if (!clockActive) {
      setTimePressure(0);
      return;
    }
    const tick = () => {
      const clock = useGameStore.getState().clock;
      if (!clock) return;
      const left = remainingMs(clock, clockActive);
      const span = Math.min(30_000, clock.initialMs * 0.25);
      setTimePressure(left >= span ? 0 : Math.round((1 - left / span) * 20) / 20);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [clockActive]);

  if (override !== null) return override;

  let t = 0.08;
  if (lastMove?.isCheck) t += 0.3;
  if (lastMove?.isCheckmate) t += 0.35;
  if (annotation) t += ANNOTATION_TENSION[annotation.classification] ?? 0;
  // A lopsided eval adds a little edge; a balanced position stays calm.
  if (viewPly > 0) t += Math.abs(winningChances(evaluation)) * 0.12;
  t += timePressure * 0.6;
  if (status.state === 'over' && status.reason !== 'checkmate') t *= 0.5;
  return Math.min(1, t);
}
