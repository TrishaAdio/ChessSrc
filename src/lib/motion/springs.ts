import type { SpringOptions, Transition } from 'framer-motion';

/**
 * Every motion in CrystalChess is a physical spring (no duration-based or
 * linear easing), tuned to feel like iOS `UISpringTimingParameters`.
 *
 * damping ratio ζ = damping / (2·√(stiffness·mass))
 */
const spring = (stiffness: number, damping: number, mass = 1) =>
  ({ type: 'spring', stiffness, damping, mass }) as const satisfies Transition;

export const SPRINGS = {
  /** Piece travel between squares (product spec). ζ ≈ 0.84 */
  piece: spring(400, 30, 0.8),
  /** Pick-up lift. Quick, with a little life. */
  lift: spring(520, 26, 0.6),
  /** Landing "tactile snap". Underdamped (ζ ≈ 0.5); pair with a negative velocity. */
  land: spring(900, 20, 0.6),
  /** Relaxing back to rest without bounce. */
  settle: spring(380, 34, 0.8),
  /** UI chrome: pills, chips, list highlights. */
  snappy: spring(600, 40, 0.7),
  /** Panels, sheets, modals. */
  gentle: spring(260, 28, 1),
  /** Liquid eval bar fill. Soft and slightly sloshy. */
  liquid: spring(110, 17, 1.1),
  /** Critically-damped spring for opacity/colour (no overshoot). */
  fade: spring(300, 40, 1),
  /** Badges popping onto the board. */
  pop: spring(560, 17, 0.7),
  /** Camera shake: high stiffness, low damping, driven by initial velocity. */
  shake: spring(1400, 12, 0.6),
  /** Ambient background mood shifts. Very slow. */
  ambient: spring(14, 9, 1.6),
} as const;

/** `useSpring`-compatible options derived from a SPRINGS entry. */
export const springOptions = ({ stiffness, damping, mass }: (typeof SPRINGS)[keyof typeof SPRINGS]): SpringOptions => ({
  stiffness,
  damping,
  mass,
});

/** Scale applied to a piece while selected / airborne / dragged. */
export const LIFT_SCALE = 1.08;
export const DRAG_SCALE = 1.12;
