import { memo, useEffect } from 'react';
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';
import type { Backdrop } from '@/lib/platform/window';
import { SPRINGS, springOptions } from '@/lib/motion/springs';

interface Blob {
  calm: string;
  tense: string;
  size: string;
  /** Anchor in % of viewport. */
  ax: number;
  ay: number;
  /** Lissajous drift amplitude (vmax) and angular speeds (rad/s). */
  amp: number;
  wx: number;
  wy: number;
  phase: number;
}

const BLOBS: Blob[] = [
  { calm: 'rgb(37 99 235 / 0.55)', tense: 'rgb(245 158 11 / 0.5)', size: '70vmax', ax: 12, ay: 18, amp: 7, wx: 0.07, wy: 0.05, phase: 0 },
  { calm: 'rgb(16 185 129 / 0.42)', tense: 'rgb(220 38 38 / 0.48)', size: '62vmax', ax: 86, ay: 78, amp: 8, wx: 0.05, wy: 0.08, phase: 1.7 },
  { calm: 'rgb(99 102 241 / 0.4)', tense: 'rgb(234 88 12 / 0.42)', size: '55vmax', ax: 78, ay: 8, amp: 6, wx: 0.09, wy: 0.04, phase: 3.1 },
  { calm: 'rgb(14 165 233 / 0.34)', tense: 'rgb(190 18 60 / 0.4)', size: '48vmax', ax: 30, ay: 92, amp: 9, wx: 0.04, wy: 0.07, phase: 4.4 },
  { calm: 'rgb(45 212 191 / 0.22)', tense: 'rgb(251 191 36 / 0.3)', size: '40vmax', ax: 52, ay: 46, amp: 10, wx: 0.06, wy: 0.06, phase: 5.6 },
];

function BlobPair({ blob, x, y, breathe, tension }: { blob: Blob; x: MotionValue<string>; y: MotionValue<string>; breathe: MotionValue<number>; tension: MotionValue<number> }) {
  const calmOpacity = useTransform(tension, (t) => 1 - t);
  const common = {
    position: 'absolute' as const,
    left: `calc(${blob.ax}% - ${blob.size} / 2)`,
    top: `calc(${blob.ay}% - ${blob.size} / 2)`,
    width: blob.size,
    height: blob.size,
    borderRadius: '50%',
    x,
    y,
    scale: breathe,
    willChange: 'transform, opacity',
  };
  return (
    <>
      <motion.div style={{ ...common, opacity: calmOpacity, background: `radial-gradient(closest-side, ${blob.calm}, transparent)` }} />
      <motion.div style={{ ...common, opacity: tension, background: `radial-gradient(closest-side, ${blob.tense}, transparent)` }} />
    </>
  );
}

function useDrift(blob: Blob, reduced: boolean) {
  const x = useMotionValue('0vmax');
  const y = useMotionValue('0vmax');
  const breathe = useMotionValue(1);
  useAnimationFrame((ms) => {
    if (reduced) return;
    const t = ms / 1000;
    x.set(`${Math.sin(t * blob.wx + blob.phase) * blob.amp}vmax`);
    y.set(`${Math.cos(t * blob.wy + blob.phase * 1.3) * blob.amp}vmax`);
    breathe.set(1 + Math.sin(t * 0.11 + blob.phase) * 0.06);
  });
  return { x, y, breathe };
}

function DriftingBlob({ blob, tension, reduced }: { blob: Blob; tension: MotionValue<number>; reduced: boolean }) {
  const { x, y, breathe } = useDrift(blob, reduced);
  return <BlobPair blob={blob} x={x} y={y} breathe={breathe} tension={tension} />;
}

/**
 * Ambient mesh gradient behind the whole app. Each colour blob exists twice
 * (calm and tense palettes) and the two are cross-faded by a slow spring on
 * `tension`. That keeps animation to opacity and transform only, with no
 * per-frame repaints of large gradients. With Mica/Acrylic the base stays
 * translucent so the OS material shows through.
 */
export const AmbientBackground = memo(function AmbientBackground({ tension, backdrop }: { tension: number; backdrop: Backdrop }) {
  const reduced = !!useReducedMotion();
  const target = useMotionValue(tension);
  useEffect(() => target.set(tension), [tension, target]);
  const mood = useSpring(target, springOptions(SPRINGS.ambient));
  const vignetteRed = useTransform(mood, [0, 1], [0, 0.35]);

  const native = backdrop !== 'none';
  const base = native ? 'rgb(5 8 18 / 0.58)' : 'rgb(5 8 18 / 1)';

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: base }} aria-hidden>
      <div className="absolute inset-0" style={{ filter: 'saturate(125%)' }}>
        {BLOBS.map((b, i) => (
          <DriftingBlob key={i} blob={b} tension={mood} reduced={reduced} />
        ))}
      </div>
      {/* Tension vignette */}
      <motion.div
        className="absolute inset-0"
        style={{ opacity: vignetteRed, background: 'radial-gradient(120% 90% at 50% 50%, transparent 55%, rgb(190 18 60 / 0.55))' }}
      />
      {/* Depth vignette + frosted grain */}
      <div className="absolute inset-0 bg-[radial-gradient(140%_100%_at_50%_0%,transparent_40%,rgb(0_0_0/0.55))]" />
      <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: 'var(--noise)', backgroundSize: '160px 160px' }} />
    </div>
  );
});
