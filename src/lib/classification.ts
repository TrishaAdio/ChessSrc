import type { Evaluation } from './chess/evaluation';

export type MoveClass =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export type BadgeIcon = 'text' | 'star' | 'book' | 'thumb' | 'check' | 'cross';

export interface ClassMeta {
  label: string;
  /** Annotation glyph used in move lists / PGN. */
  glyph: string;
  icon: BadgeIcon;
  /** Base badge color. */
  color: string;
  /** Outer glow (rgba). */
  glow: string;
  /** Badge reacts with a shake on arrival. */
  shake: boolean;
  /** Badge gets a specular shimmer sweep. */
  shimmer: boolean;
}

export const CLASS_META: Record<MoveClass, ClassMeta> = {
  brilliant: { label: 'Brilliant', glyph: '!!', icon: 'text', color: '#1bc8c4', glow: 'rgba(38, 230, 222, 0.75)', shake: false, shimmer: true },
  great: { label: 'Great Move', glyph: '!', icon: 'text', color: '#3d6fe0', glow: 'rgba(84, 132, 255, 0.7)', shake: false, shimmer: true },
  best: { label: 'Best Move', glyph: '★', icon: 'star', color: '#21a65b', glow: 'rgba(52, 214, 120, 0.6)', shake: false, shimmer: false },
  excellent: { label: 'Excellent', glyph: '👍', icon: 'thumb', color: '#4fae3f', glow: 'rgba(120, 214, 96, 0.5)', shake: false, shimmer: false },
  good: { label: 'Good', glyph: '✓', icon: 'check', color: '#6f9a5a', glow: 'rgba(150, 200, 120, 0.45)', shake: false, shimmer: false },
  book: { label: 'Book Move', glyph: '📖', icon: 'book', color: '#a5734a', glow: 'rgba(214, 156, 102, 0.55)', shake: false, shimmer: false },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', icon: 'text', color: '#e6b422', glow: 'rgba(255, 210, 60, 0.6)', shake: false, shimmer: false },
  mistake: { label: 'Mistake', glyph: '?', icon: 'text', color: '#ef7d1a', glow: 'rgba(255, 140, 40, 0.65)', shake: false, shimmer: false },
  miss: { label: 'Miss', glyph: '✕', icon: 'cross', color: '#e05a6a', glow: 'rgba(255, 100, 120, 0.55)', shake: false, shimmer: false },
  blunder: { label: 'Blunder', glyph: '??', icon: 'text', color: '#d7263d', glow: 'rgba(255, 48, 72, 0.8)', shake: true, shimmer: false },
};

/**
 * Upper bounds (in pawns) of the eval-loss bands from the product spec:
 * 0.5–1.0 inaccuracy, 1.0–2.5 mistake, >2.5 blunder. The Phase 3 classifier
 * reads these.
 */
export const LOSS_THRESHOLDS = {
  excellent: 0.2,
  good: 0.5,
  inaccuracy: 1.0,
  mistake: 2.5,
} as const;

export interface MoveAnnotation {
  classification: MoveClass;
  evalBefore?: Evaluation;
  evalAfter?: Evaluation;
  /** Engine best move (UCI) in the position before this move, for review arrows. */
  bestMove?: string;
  /** The move actually played (UCI). */
  playedMove?: string;
  /** Mover's win % before / after and the loss (percentage points). */
  winBefore?: number;
  winAfter?: number;
  winLoss?: number;
  /** Human-readable justification from the classifier. */
  reason?: string;
}

/** Classes that represent an error worth retrying in review. */
export const RETRYABLE: ReadonlySet<MoveClass> = new Set<MoveClass>(['mistake', 'blunder', 'miss']);

/** Classes counted in the review breakdown table, in display order. */
export const BREAKDOWN_ORDER: readonly MoveClass[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];
