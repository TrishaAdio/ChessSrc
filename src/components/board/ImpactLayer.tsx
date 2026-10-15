import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { squareToVisual } from '@/lib/chess/squares';
import type { Color, Square } from '@/lib/chess/types';

export interface Shockwave {
  id: number;
  square: Square;
  strength: 'check' | 'mate';
}

/**
 * Radial shockwave rings expanding from the checked king. Scale and opacity
 * run on springs (critically damped for opacity), so the ring decelerates
 * naturally instead of following a fixed curve.
 */
export const ImpactLayer = memo(function ImpactLayer({
  waves,
  orientation,
  size,
  onDone,
}: {
  waves: readonly Shockwave[];
  orientation: Color;
  size: number;
  onDone(id: number): void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[65] overflow-visible">
      <AnimatePresence>
        {waves.map((w) => {
          const { col, row } = squareToVisual(w.square, orientation);
          const mate = w.strength === 'mate';
          return [0, 1].map((ring) => (
            <motion.div
              key={`${w.id}:${ring}`}
              className="absolute rounded-full"
              style={{
                left: (col + 0.5) * size - size / 2,
                top: (row + 0.5) * size - size / 2,
                width: size,
                height: size,
                border: `${Math.max(2, size * (ring ? 0.03 : 0.06))}px solid ${mate ? 'rgb(255 90 110 / 0.9)' : 'rgb(255 120 140 / 0.85)'}`,
                boxShadow: `0 0 ${size * 0.4}px rgb(255 70 100 / 0.6), inset 0 0 ${size * 0.3}px rgb(255 120 140 / 0.4)`,
              }}
              initial={{ scale: 0.3, opacity: 0.95 }}
              animate={{ scale: (mate ? 7 : 3.4) * (ring ? 0.7 : 1), opacity: 0 }}
              transition={{
                scale: { type: 'spring', stiffness: mate ? 55 : 90, damping: 18, mass: 1, delay: ring * 0.08 },
                opacity: { type: 'spring', stiffness: mate ? 22 : 40, damping: 14, mass: 1, delay: ring * 0.08 },
              }}
              onAnimationComplete={() => ring === 1 && onDone(w.id)}
            />
          ));
        })}
      </AnimatePresence>
    </div>
  );
});
