import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color } from '@/lib/chess/types';

const K = 0.00368208;

/** W(cp) = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1), cp from the mover's perspective. */
export const winFromCp = (cp: number): number => 50 + 50 * (2 / (1 + Math.exp(-K * cp)) - 1);

/**
 * Forced mates sit just below or above 100/0. Shorter mates score slightly
 * higher, so throwing away M2 for M9 still registers as a (tiny) loss, but
 * never as much as a real blunder.
 */
const winFromMate = (mateForPov: number): number => {
  const n = Math.min(Math.abs(mateForPov), 25);
  const sure = 100 - 0.04 * (n - 1);
  return mateForPov > 0 ? sure : 100 - sure;
};

/** Win probability (0..100) of `pov` for a White-POV evaluation. */
export function winPercent(e: Evaluation, pov: Color): number {
  const sign = pov === 'w' ? 1 : -1;
  switch (e.kind) {
    case 'cp':
      return winFromCp(e.cp * sign);
    case 'mate':
      return winFromMate(e.mate * sign);
    case 'terminal':
      if (e.result === '1/2-1/2') return 50;
      return (e.result === '1-0') === (pov === 'w') ? 100 : 0;
  }
}

/** Mover has a forced mate (or has already delivered it). */
export const isMateFor = (e: Evaluation, pov: Color): boolean =>
  (e.kind === 'mate' && e.mate * (pov === 'w' ? 1 : -1) > 0) ||
  (e.kind === 'terminal' && e.result === (pov === 'w' ? '1-0' : '0-1'));

/** Mover is getting mated (or already is). */
export const isMateAgainst = (e: Evaluation, pov: Color): boolean => isMateFor(e, pov === 'w' ? 'b' : 'w');
