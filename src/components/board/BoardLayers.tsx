import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { SPRINGS } from '@/lib/motion/springs';
import { FILES, RANKS, squareToVisual } from '@/lib/chess/squares';
import type { Color, Premove, Square } from '@/lib/chess/types';

const pos = (sq: Square, orientation: Color, size: number) => {
  const { col, row } = squareToVisual(sq, orientation);
  return { left: col * size, top: row * size };
};

/* ─────────────────────────── Squares ─────────────────────────── */

const CELLS = Array.from({ length: 64 }, (_, i) => i);

export const SquaresLayer = memo(function SquaresLayer() {
  // The visual checker pattern does not depend on orientation: the top-left
  // cell is light from either side (a8 for White, h1 for Black).
  return (
    <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 overflow-hidden rounded-[12px]">
      {CELLS.map((i) => {
        const light = ((i % 8) + Math.floor(i / 8)) % 2 === 0;
        return <div key={i} className={clsx('cc-square', light ? 'cc-square-light' : 'cc-square-dark')} />;
      })}
      {/* Board-wide specular sheen */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgb(255_255_255/0.10),transparent_38%,transparent_70%,rgb(255_255_255/0.05))]" />
    </div>
  );
});

/* ─────────────────────────── Coordinates ─────────────────────────── */

export const CoordinatesLayer = memo(function CoordinatesLayer({ orientation, size }: { orientation: Color; size: number }) {
  const font = Math.max(9, size * 0.155);
  const pad = Math.max(2, size * 0.06);
  const files = orientation === 'w' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'w' ? [...RANKS].reverse() : RANKS;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ fontSize: font }}>
      {ranks.map((r, row) => (
        <span key={r} className="cc-coord" style={{ left: pad, top: row * size + pad }}>
          {r}
        </span>
      ))}
      {files.map((f, col) => (
        <span key={f} className="cc-coord" style={{ left: (col + 1) * size - pad - font * 0.55, top: 8 * size - pad - font }}>
          {f}
        </span>
      ))}
    </div>
  );
});

/* ─────────────────────────── Highlights ─────────────────────────── */

export type HighlightKind = 'last' | 'selected' | 'premove-next' | 'premove-queued' | 'hover';

export interface Highlight {
  square: Square;
  kind: HighlightKind;
}

const HL_STYLE: Record<HighlightKind, string> = {
  last: 'bg-[var(--hl-last)]',
  selected: 'bg-[var(--hl-selected)] shadow-[inset_0_0_18px_rgb(160_230_255/0.45)]',
  'premove-next': 'bg-[var(--hl-premove-next)] shadow-[inset_0_0_14px_rgb(120_180_255/0.5)]',
  'premove-queued': 'bg-[var(--hl-premove-queued)] shadow-[inset_0_0_14px_rgb(255_110_130/0.45)]',
  hover: 'shadow-[inset_0_0_0_3px_rgb(235_245_255/0.65),inset_0_0_22px_rgb(160_220_255/0.35)] bg-white/[0.06]',
};

export const HighlightsLayer = memo(function HighlightsLayer({
  highlights,
  orientation,
  size,
  checkSquare,
}: {
  highlights: readonly Highlight[];
  orientation: Color;
  size: number;
  checkSquare: Square | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[12px]">
      <AnimatePresence>
        {highlights.map((h) => (
          <motion.div
            key={`${h.kind}:${h.square}`}
            className={clsx('absolute', HL_STYLE[h.kind])}
            style={{ ...pos(h.square, orientation, size), width: size, height: size }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRINGS.fade}
          />
        ))}
        {checkSquare && (
          <motion.div
            key={`check:${checkSquare}`}
            className="absolute"
            style={{
              ...pos(checkSquare, orientation, size),
              width: size,
              height: size,
              background: 'radial-gradient(circle, rgb(255 60 90 / 0.95) 0%, rgb(255 40 70 / 0.55) 32%, rgb(255 40 70 / 0) 72%)',
            }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={SPRINGS.pop}
          />
        )}
      </AnimatePresence>
    </div>
  );
});

/* ─────────────────────────── Legal move hints ─────────────────────────── */

export const LegalHintsLayer = memo(function LegalHintsLayer({
  targets,
  occupied,
  orientation,
  size,
  selectionKey,
}: {
  targets: readonly Square[];
  occupied: ReadonlySet<Square>;
  orientation: Color;
  size: number;
  selectionKey: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence>
        {targets.map((sq, i) => {
          const capture = occupied.has(sq);
          return (
            <div key={`${selectionKey}:${sq}`} className="absolute grid place-items-center" style={{ ...pos(sq, orientation, size), width: size, height: size }}>
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, transition: { ...SPRINGS.pop, delay: Math.min(i * 0.012, 0.12) } }}
                exit={{ scale: 0, opacity: 0, transition: SPRINGS.settle }}
                className="rounded-full"
                style={
                  capture
                    ? {
                        width: size * 0.92,
                        height: size * 0.92,
                        border: `${Math.max(3, size * 0.075)}px solid var(--hint)`,
                        boxShadow: '0 0 14px rgb(180 225 255 / 0.25), inset 0 0 10px rgb(255 255 255 / 0.12)',
                      }
                    : {
                        width: size * 0.3,
                        height: size * 0.3,
                        background: 'radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.55), var(--hint) 60%)',
                        boxShadow: '0 0 12px rgb(170 220 255 / 0.35), inset 0 1px 1px rgb(255 255 255 / 0.5)',
                      }
                }
              />
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});

/* ─────────────────────────── Premove trails ─────────────────────────── */

export const PremoveTrailsLayer = memo(function PremoveTrailsLayer({
  premoves,
  orientation,
}: {
  premoves: readonly Premove[];
  orientation: Color;
}) {
  const center = (sq: Square) => {
    const { col, row } = squareToVisual(sq, orientation);
    return { x: col + 0.5, y: row + 0.5 };
  };
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 8 8" aria-hidden>
      <defs>
        <linearGradient id="cc-trail-next" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5aa2ff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#7cc0ff" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <AnimatePresence>
        {premoves.map((pm, i) => {
          const a = center(pm.from);
          const b = center(pm.to);
          const next = i === 0;
          return (
            <motion.g key={pm.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={SPRINGS.fade}>
              <motion.line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={next ? '#6fb2ff' : '#ff5c78'}
                strokeOpacity={next ? 0.6 : 0.5}
                strokeWidth={0.16}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={SPRINGS.snappy}
              />
              <motion.circle
                cx={b.x}
                cy={b.y}
                r={0.13}
                fill={next ? '#9fd0ff' : '#ff8ea0'}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={SPRINGS.pop}
              />
            </motion.g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
});
