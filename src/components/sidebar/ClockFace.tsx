import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import type { Color } from '@/lib/chess/types';
import { SPRINGS } from '@/lib/motion/springs';
import { formatClock, remainingMs, type ClockState } from '@/store/clock';

const LOW_MS = 20_000;

/**
 * Clock readout. While running it repaints from requestAnimationFrame straight
 * into the DOM (no React renders), so tenths stay smooth.
 */
export function ClockFace({ clock, color }: { clock: ClockState; color: Color }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const active = clock.active === color;
  const initialLow = remainingMs(clock, color) < LOW_MS;

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const paint = () => {
      const ms = remainingMs(clock, color);
      el.textContent = formatClock(ms);
      el.parentElement?.toggleAttribute('data-low', ms < LOW_MS);
    };
    paint();
    if (!active) return;
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, color, active]);

  return (
    <motion.div
      data-low={initialLow || undefined}
      animate={{ scale: active ? 1 : 0.96, opacity: active ? 1 : 0.62 }}
      transition={SPRINGS.snappy}
      className={clsx(
        'group tabular relative flex h-11 min-w-[112px] items-center justify-end rounded-2xl px-4 text-[22px] font-semibold tracking-tight',
        active
          ? 'bg-white/[0.16] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_24px_rgb(111_211_255/0.22)] ring-1 ring-white/25'
          : 'bg-black/20 text-ink-dim ring-1 ring-white/5',
        'data-[low]:text-rose-100 data-[low]:ring-rose-300/40 data-[low]:shadow-[0_0_26px_rgb(255_60_90/0.45)]',
      )}
    >
      {active && <span className="absolute left-3 top-1/2 size-1.5 -translate-y-1/2 animate-pulse rounded-full bg-accent-2 shadow-[0_0_8px_#43e3b0]" />}
      <span ref={textRef} />
    </motion.div>
  );
}
