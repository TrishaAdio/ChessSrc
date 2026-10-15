import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { squareToVisual } from '@/lib/chess/squares';
import type { Color, Square } from '@/lib/chess/types';

export type ArrowKind = 'best' | 'played-blunder' | 'played-inaccuracy' | 'played' | 'hint';

export interface BoardArrow {
  from: Square;
  to: Square;
  kind: ArrowKind;
}

const COLORS: Record<ArrowKind, { stroke: string; glow: string; opacity: number }> = {
  best: { stroke: '#34d399', glow: 'rgba(52,211,153,0.75)', opacity: 0.82 },
  'played-blunder': { stroke: '#f43f5e', glow: 'rgba(244,63,94,0.7)', opacity: 0.72 },
  'played-inaccuracy': { stroke: '#f59e0b', glow: 'rgba(245,158,11,0.65)', opacity: 0.72 },
  played: { stroke: '#a5b4fc', glow: 'rgba(165,180,252,0.5)', opacity: 0.6 },
  hint: { stroke: '#67e8f9', glow: 'rgba(103,232,249,0.6)', opacity: 0.7 },
};

const SHAFT = 0.17;
const HEAD_LEN = 0.42;
const HEAD_HALF = 0.27;
const START_INSET = 0.24;

/** Square-centre path in board units (0..8). Knight moves become an L, like chess.com's arrows. */
function arrowGeometry(a: BoardArrow, orientation: Color) {
  const f = squareToVisual(a.from, orientation);
  const t = squareToVisual(a.to, orientation);
  const p0 = { x: f.col + 0.5, y: f.row + 0.5 };
  const p2 = { x: t.col + 0.5, y: t.row + 0.5 };
  const dx = p2.x - p0.x;
  const dy = p2.y - p0.y;
  const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  const corner = knight ? (Math.abs(dx) > Math.abs(dy) ? { x: p2.x, y: p0.y } : { x: p0.x, y: p2.y }) : null;

  const lastFrom = corner ?? p0;
  const len = Math.hypot(p2.x - lastFrom.x, p2.y - lastFrom.y);
  const ux = (p2.x - lastFrom.x) / len;
  const uy = (p2.y - lastFrom.y) / len;
  const tip = { x: p2.x - ux * 0.12, y: p2.y - uy * 0.12 };
  const base = { x: tip.x - ux * HEAD_LEN, y: tip.y - uy * HEAD_LEN };

  const firstTo = corner ?? p2;
  const flen = Math.hypot(firstTo.x - p0.x, firstTo.y - p0.y);
  const start = { x: p0.x + ((firstTo.x - p0.x) / flen) * START_INSET, y: p0.y + ((firstTo.y - p0.y) / flen) * START_INSET };

  const shaft = corner ? `M${start.x} ${start.y} L${corner.x} ${corner.y} L${base.x} ${base.y}` : `M${start.x} ${start.y} L${base.x} ${base.y}`;
  const head = `M${tip.x} ${tip.y} L${base.x - uy * HEAD_HALF} ${base.y + ux * HEAD_HALF} L${base.x + uy * HEAD_HALF} ${base.y - ux * HEAD_HALF} Z`;
  return { shaft, head };
}

/** Translucent analysis arrows (best move vs. played move), drawn above the pieces. */
export const ArrowsLayer = memo(function ArrowsLayer({ arrows, orientation }: { arrows: readonly BoardArrow[]; orientation: Color }) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-[60] h-full w-full overflow-visible" viewBox="0 0 8 8" aria-hidden data-testid="arrows-layer">
      <AnimatePresence>
        {arrows.map((a) => {
          const { shaft, head } = arrowGeometry(a, orientation);
          const c = COLORS[a.kind];
          return (
            <motion.g
              key={`${a.kind}:${a.from}${a.to}`}
              data-arrow={a.kind}
              initial={{ opacity: 0 }}
              animate={{ opacity: c.opacity }}
              exit={{ opacity: 0 }}
              transition={SPRINGS.fade}
              style={{ filter: `drop-shadow(0 0 0.08px ${c.glow}) drop-shadow(0 0.04px 0.06px rgba(0,0,0,0.5))` }}
            >
              <motion.path
                d={shaft}
                fill="none"
                stroke={c.stroke}
                strokeWidth={SHAFT}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={SPRINGS.snappy}
              />
              <motion.path d={head} fill={c.stroke} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRINGS.pop, delay: 0.08 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
            </motion.g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
});
