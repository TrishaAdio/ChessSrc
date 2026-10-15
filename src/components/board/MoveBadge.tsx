import { memo, useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { CLASS_META, type BadgeIcon, type MoveClass } from '@/lib/classification';

function Glyph({ icon, text, size }: { icon: BadgeIcon; text: string; size: number }) {
  const s = size * 0.58;
  const common = { width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  switch (icon) {
    case 'star':
      return (
        <svg {...common} fill="#fff">
          <path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round">
          <path d="M3.5 5.5C6 4.5 9 4.6 12 6.4c3-1.8 6-1.9 8.5-.9V19c-2.5-1-5.5-.9-8.5.9-3-1.8-6-1.9-8.5-.9z" />
          <path d="M12 6.4V19.9" />
        </svg>
      );
    case 'thumb':
      return (
        <svg {...common} fill="#fff">
          <path d="M2.5 10.5h3.5v10H2.5zM8 20.5V10l4.4-7.2c1.5-.2 2.6 1 2.3 2.5L14 9h5.3c1.4 0 2.4 1.3 2 2.6l-2.2 7.3a2.2 2.2 0 0 1-2.1 1.6z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common} fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case 'cross':
      return (
        <svg {...common} fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round">
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      );
    case 'text':
      return <span style={{ fontSize: text.length > 1 ? size * 0.5 : size * 0.62, lineHeight: 1 }}>{text}</span>;
  }
}

interface MoveBadgeProps {
  classification: MoveClass;
  /** Center position in board pixels. */
  cx: number;
  cy: number;
  size: number;
}

/**
 * Floating glass annotation badge on the destination square's top-right
 * corner. It pops in on a bouncy spring. Blunders wobble with a
 * velocity-driven spring (a damped oscillation, not a keyframe loop).
 * Brilliant and Great moves get a specular shimmer sweep.
 */
export const MoveBadge = memo(function MoveBadge({ classification, cx, cy, size }: MoveBadgeProps) {
  const meta = CLASS_META[classification];
  const rotate = useMotionValue(0);
  const shakeX = useMotionValue(0);
  const shine = useMotionValue(-1.2);

  useEffect(() => {
    const stops: { stop(): void }[] = [];
    const t = window.setTimeout(() => {
      if (meta.shake) {
        stops.push(animate(rotate, 0, { ...SPRINGS.shake, velocity: 900 }));
        stops.push(animate(shakeX, 0, { ...SPRINGS.shake, velocity: -160 }));
      }
      if (meta.shimmer) {
        shine.jump(-1.2);
        stops.push(animate(shine, 1.4, { type: 'spring', stiffness: 40, damping: 14, mass: 1 }));
      }
    }, 160);
    return () => {
      window.clearTimeout(t);
      stops.forEach((s) => s.stop());
    };
  }, [meta.shake, meta.shimmer, rotate, shakeX, shine]);

  const shineX = useTransform(shine, (v) => `${v * 100}%`);

  return (
    <motion.div
      className="pointer-events-none absolute"
      style={{ left: cx - size / 2, top: cy - size / 2, width: size, height: size, x: shakeX, rotate, zIndex: 70 }}
    >
      <motion.div
        className="cc-badge h-full w-full"
        initial={{ scale: 0, rotate: -35, y: size * 0.35, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, y: 0, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0, transition: SPRINGS.settle }}
        transition={SPRINGS.pop}
        style={{
          background: `radial-gradient(120% 120% at 30% 22%, rgb(255 255 255 / 0.55), ${meta.color} 46%, color-mix(in oklab, ${meta.color} 70%, black) 100%)`,
          boxShadow: `0 0 ${size * 0.7}px ${meta.glow}, 0 ${size * 0.12}px ${size * 0.3}px rgb(0 0 0 / 0.45), inset 0 1px 1px rgb(255 255 255 / 0.7), inset 0 -2px 4px rgb(0 0 0 / 0.25)`,
          border: '1px solid rgb(255 255 255 / 0.55)',
        }}
        aria-label={meta.label}
      >
        <Glyph icon={meta.icon} text={meta.glyph} size={size} />
        {meta.shimmer && (
          <motion.span
            className="absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/70 to-transparent"
            style={{ x: shineX, left: 0 }}
          />
        )}
      </motion.div>
    </motion.div>
  );
});
