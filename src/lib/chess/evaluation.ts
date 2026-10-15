/**
 * Engine evaluation, always from WHITE's point of view.
 *  - cp:       centipawns (+ = white better)
 *  - mate:     signed mate distance (+3 = white mates in 3, -2 = black mates in 2)
 *  - terminal: game already decided on the board
 */
export type Evaluation =
  | { kind: 'cp'; cp: number }
  | { kind: 'mate'; mate: number }
  | { kind: 'terminal'; result: '1-0' | '0-1' | '1/2-1/2' };

export const EVAL_EQUAL: Evaluation = { kind: 'cp', cp: 0 };

/** Lichess win-probability model, scaled to [-1, 1]. */
export function winningChances(e: Evaluation): number {
  switch (e.kind) {
    case 'cp': {
      const cp = Math.max(-1000, Math.min(1000, e.cp));
      return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
    }
    case 'mate':
      return e.mate >= 0 ? 1 : -1;
    case 'terminal':
      return e.result === '1-0' ? 1 : e.result === '0-1' ? -1 : 0;
  }
}

/** Share of the bar filled by White (0..1). */
export const whiteShare = (e: Evaluation): number => 0.5 + 0.5 * winningChances(e);

/** Short display string: "+1.4", "-0.3", "M3", "1-0". */
export function formatEval(e: Evaluation): string {
  switch (e.kind) {
    case 'cp': {
      const pawns = e.cp / 100;
      const abs = Math.abs(pawns);
      const body = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
      if (body === '0.0') return '0.0';
      return `${pawns > 0 ? '+' : '-'}${body}`;
    }
    case 'mate':
      return `M${Math.abs(e.mate)}`;
    case 'terminal':
      return e.result === '1/2-1/2' ? '½-½' : e.result;
  }
}

/** Which side the evaluation favours (null = level). */
export function favoured(e: Evaluation): 'w' | 'b' | null {
  const wc = winningChances(e);
  if (Math.abs(wc) < 0.01) return null;
  return wc > 0 ? 'w' : 'b';
}
