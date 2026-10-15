import { AnimatePresence, motion } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { CLASS_META } from '@/lib/classification';
import { GlassPanel } from '@/components/glass/Glass';
import { IconBook } from '@/components/glass/Icons';
import type { Opening } from '@/store/gameStore';

/** Live opening name. The Phase 3 book lookup calls `setOpening`. */
export function OpeningTicker({ opening, ply }: { opening: Opening | null; ply: number }) {
  const name = opening?.name ?? (ply === 0 ? 'Starting Position' : 'Opening not identified');
  const key = opening ? `${opening.eco}:${opening.name}` : `none:${ply === 0}`;
  return (
    <GlassPanel radius={20} className="flex items-center gap-3 px-4 py-3">
      <div
        className="grid size-9 shrink-0 place-items-center rounded-xl text-white/90"
        style={{ background: `linear-gradient(160deg, ${CLASS_META.book.color}, color-mix(in oklab, ${CLASS_META.book.color} 60%, black))`, boxShadow: `0 0 16px ${CLASS_META.book.glow}` }}
      >
        <IconBook size={17} />
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Opening{opening ? ` · ${opening.eco}` : ''}</div>
        <div className="relative h-5">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={key}
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={SPRINGS.snappy}
              className="absolute inset-0 truncate text-[13.5px] font-semibold text-ink"
              title={name}
            >
              {name}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </GlassPanel>
  );
}
