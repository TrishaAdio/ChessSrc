import type { Color } from '@/lib/chess/types';

/**
 * Game accuracy à la CAPS / Lichess.
 *
 *   moveAccuracy = 103.1668·e^(−0.04354·ΔW) − 3.1669   (clamped to 0..100)
 *
 * Moves are weighted by local volatility: the standard deviation of win% in a
 * sliding window, clamped to [0.5, 12]. Blunders in sharp, decisive phases
 * therefore count more than drift in dead positions. The final score
 * averages the volatility-weighted mean and the harmonic mean; the harmonic
 * mean punishes a single disaster harder than a plain average.
 *
 * @param whiteWin win% from White's POV for positions 0..n (index 0 = start).
 */
export function gameAccuracy(whiteWin: readonly number[]): Record<Color, number | null> {
  const n = whiteWin.length - 1; // number of plies
  if (n < 1) return { w: null, b: null };

  const windowSize = Math.max(2, Math.min(8, Math.floor(whiteWin.length / 10)));
  const windows: number[][] = [];
  const first = whiteWin.slice(0, Math.min(windowSize, whiteWin.length));
  for (let i = 0; i < Math.min(windowSize, whiteWin.length) - 2; i++) windows.push(first);
  for (let i = 0; i + windowSize <= whiteWin.length; i++) windows.push(whiteWin.slice(i, i + windowSize));
  while (windows.length < n) windows.push(windows.at(-1) ?? first);
  const weights = windows.slice(0, n).map((w) => clamp(stdDev(w), 0.5, 12));

  const per: Record<Color, { acc: number; weight: number }[]> = { w: [], b: [] };
  for (let ply = 1; ply <= n; ply++) {
    const mover: Color = ply % 2 === 1 ? 'w' : 'b';
    const before = mover === 'w' ? whiteWin[ply - 1]! : 100 - whiteWin[ply - 1]!;
    const after = mover === 'w' ? whiteWin[ply]! : 100 - whiteWin[ply]!;
    per[mover].push({ acc: moveAccuracy(before, after), weight: weights[ply - 1]! });
  }

  const score = (moves: { acc: number; weight: number }[]): number | null => {
    if (!moves.length) return null;
    const wSum = moves.reduce((s, m) => s + m.weight, 0);
    const weighted = moves.reduce((s, m) => s + m.acc * m.weight, 0) / wSum;
    const harmonic = moves.length / moves.reduce((s, m) => s + 1 / Math.max(m.acc, 1), 0);
    return clamp((weighted + harmonic) / 2, 0, 100);
  };
  return { w: score(per.w), b: score(per.b) };
}

/** Accuracy (0..100) of one move given the mover's win% before and after. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const loss = Math.max(0, winBefore - winAfter);
  return clamp(103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411, 0, 100);
}

function stdDev(xs: readonly number[]): number {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
