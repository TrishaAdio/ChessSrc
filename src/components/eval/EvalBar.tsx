import { memo, useEffect, useRef } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion';
import { favoured, formatEval, whiteShare, type Evaluation } from '@/lib/chess/evaluation';
import type { Color } from '@/lib/chess/types';
import { SPRINGS, springOptions } from '@/lib/motion/springs';

interface EvalBarProps {
  evaluation: Evaluation;
  orientation: Color;
  height: number;
  width?: number;
}

/**
 * Vertical "liquid glass" evaluation tube.
 *
 * - The fill level springs to the Lichess win-probability mapping of the eval.
 * - The meniscus is a travelling sine wave whose amplitude is driven by the
 *   fill spring's velocity, so the liquid sloshes harder on big swings.
 * - The numeric label counts toward the new value on the same spring.
 * Only transforms are animated, so the bar stays on the compositor.
 */
export const EvalBar = memo(function EvalBar({ evaluation, orientation, height, width = 30 }: EvalBarProps) {
  const reduced = useReducedMotion();
  const share = whiteShare(evaluation);
  // Fraction of the tube (from the bottom) filled with the bottom player's color.
  const bottomShare = orientation === 'w' ? share : 1 - share;

  const target = useMotionValue(bottomShare);
  useEffect(() => target.set(bottomShare), [bottomShare, target]);
  const level = useSpring(target, springOptions(SPRINGS.liquid));
  const levelVelocity = useVelocity(level);

  // translateY of the fill, in px (0 = full).
  const fillY = useTransform(level, (l) => (1 - Math.min(1, Math.max(0, l))) * height);
  const waveAmp = useTransform(levelVelocity, (v) => Math.min(1.6, 0.35 + Math.abs(v) * 1.4));

  // Endless meniscus drift (time-driven sine, no easing curve).
  const waveX = useMotionValue(0);
  useAnimationFrame((t) => {
    if (reduced) return;
    waveX.set(-((t * 0.02) % width));
  });

  // Counting label on the spring.
  const labelRef = useRef<HTMLSpanElement>(null);
  const cpTarget = useMotionValue(evaluation.kind === 'cp' ? evaluation.cp : 0);
  const cpShown = useSpring(cpTarget, springOptions(SPRINGS.snappy));
  useEffect(() => {
    if (evaluation.kind === 'cp') cpTarget.set(evaluation.cp);
  }, [evaluation, cpTarget]);
  const renderLabel = () => {
    const el = labelRef.current;
    if (!el) return;
    el.textContent =
      evaluation.kind === 'cp' ? formatEval({ kind: 'cp', cp: Math.round(cpShown.get()) }) : formatEval(evaluation);
  };
  useMotionValueEvent(cpShown, 'change', renderLabel);
  useEffect(renderLabel);

  const side = favoured(evaluation) ?? 'w';
  const labelAtBottom = side === orientation;
  const bottomIsWhite = orientation === 'w';
  const labelOnWhite = labelAtBottom === bottomIsWhite;

  const bottomFill = bottomIsWhite
    ? 'linear-gradient(90deg, rgb(255 255 255 / 0.98), rgb(226 234 250 / 0.95) 55%, rgb(196 208 232 / 0.95))'
    : 'linear-gradient(90deg, rgb(52 58 76 / 0.98), rgb(28 32 44 / 0.97) 55%, rgb(18 21 30 / 0.97))';
  const topFill = bottomIsWhite
    ? 'linear-gradient(90deg, rgb(40 46 62 / 0.8), rgb(18 21 30 / 0.85))'
    : 'linear-gradient(90deg, rgb(240 244 255 / 0.9), rgb(200 210 232 / 0.9))';
  const waveColor = bottomIsWhite ? 'rgb(240 245 255 / 0.98)' : 'rgb(36 41 56 / 0.98)';

  return (
    <div
      className="glass relative shrink-0 overflow-hidden"
      style={{ width, height, ['--glass-radius' as string]: `${width / 2}px` }}
      role="meter"
      aria-label="Evaluation"
      aria-valuetext={formatEval(evaluation)}
    >
      <div className="absolute inset-[3px] overflow-hidden rounded-full" style={{ background: topFill }}>
        {/* Liquid column */}
        <motion.div className="absolute inset-x-0 bottom-0" style={{ height, y: fillY }}>
          <div className="absolute inset-0" style={{ background: bottomFill }} />
          {/* Meniscus */}
          <motion.svg
            className="absolute left-0"
            width={width * 3}
            height={10}
            viewBox={`0 0 ${width * 3} 10`}
            style={{ top: -7, x: waveX, scaleY: waveAmp, originY: 1 }}
            aria-hidden
          >
            <path
              // Six crest+trough periods of width/2 across 3×width, so drifting by
              // `width` loops seamlessly.
              d={`M0 7 ${Array.from({ length: 6 }, (_, i) => `Q ${width * (i + 0.25) * 0.5} 3.5 ${width * (i + 0.5) * 0.5} 7 T ${width * (i + 1) * 0.5} 7`).join(' ')} V10 H0 Z`}
              fill={waveColor}
            />
          </motion.svg>
        </motion.div>

        {/* Center marker */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sky-300/50 shadow-[0_0_6px_rgb(125_211_252/0.8)]" />
        {/* Glass tube specular stripe */}
        <div className="pointer-events-none absolute inset-y-2 left-[18%] w-[22%] rounded-full bg-gradient-to-b from-white/40 via-white/10 to-white/25 mix-blend-screen" />
      </div>

      <span
        ref={labelRef}
        className="tabular absolute inset-x-0 text-center text-[10.5px] font-bold tracking-tight"
        style={{
          [labelAtBottom ? 'bottom' : 'top']: 8,
          color: labelOnWhite ? 'rgb(20 24 36 / 0.9)' : 'rgb(236 242 255 / 0.92)',
          textShadow: labelOnWhite ? 'none' : '0 0 6px rgb(120 190 255 / 0.6)',
        }}
      />
    </div>
  );
});
