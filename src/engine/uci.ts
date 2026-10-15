import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color } from '@/lib/chess/types';

/** Raw score as reported by UCI (relative to the side to move). */
export type UciScore = { kind: 'cp'; value: number } | { kind: 'mate'; value: number };

export interface UciInfo {
  depth: number;
  seldepth: number;
  multipv: number;
  score: UciScore | null;
  /** 'lower' / 'upper' bounds are aspiration-window fail lines; skip them for display. */
  bound: 'exact' | 'lower' | 'upper';
  nodes: number;
  nps: number;
  timeMs: number;
  pv: string[];
}

/** Parses an `info ...` line. Returns null for lines without a depth (e.g. `info string`). */
export function parseInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || line.startsWith('info string')) return null;
  const t = line.split(/\s+/);
  const info: UciInfo = { depth: -1, seldepth: 0, multipv: 1, score: null, bound: 'exact', nodes: 0, nps: 0, timeMs: 0, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = Number(t[++i]);
        break;
      case 'seldepth':
        info.seldepth = Number(t[++i]);
        break;
      case 'multipv':
        info.multipv = Number(t[++i]);
        break;
      case 'nodes':
        info.nodes = Number(t[++i]);
        break;
      case 'nps':
        info.nps = Number(t[++i]);
        break;
      case 'time':
        info.timeMs = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const value = Number(t[++i]);
        if ((kind === 'cp' || kind === 'mate') && Number.isFinite(value)) info.score = { kind, value };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.bound = t[++i] === 'lowerbound' ? 'lower' : 'upper';
        break;
      }
      case 'pv':
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
      default:
        break;
    }
  }
  return info.depth >= 0 ? info : null;
}

/** `bestmove e2e4 ponder e7e5` → { bestMove, ponder }. `(none)` → null (no legal moves). */
export function parseBestMove(line: string): { bestMove: string | null; ponder: string | null } | null {
  if (!line.startsWith('bestmove')) return null;
  const t = line.split(/\s+/);
  const best = t[1] && t[1] !== '(none)' ? t[1] : null;
  const pi = t.indexOf('ponder');
  return { bestMove: best, ponder: pi > 0 ? (t[pi + 1] ?? null) : null };
}

/** Converts a side-to-move UCI score into a White-POV evaluation. */
export function toWhitePov(score: UciScore, sideToMove: Color): Evaluation {
  const sign = sideToMove === 'w' ? 1 : -1;
  if (score.kind === 'cp') return { kind: 'cp', cp: score.value * sign };
  // `mate 0` = side to move is checkmated.
  if (score.value === 0) return { kind: 'terminal', result: sideToMove === 'w' ? '0-1' : '1-0' };
  return { kind: 'mate', mate: score.value * sign };
}

export interface UciMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export function parseUciMove(uci: string): UciMove {
  const promo = uci[4];
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: promo === 'q' || promo === 'r' || promo === 'b' || promo === 'n' ? promo : undefined,
  };
}
