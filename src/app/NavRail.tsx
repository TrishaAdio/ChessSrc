import { motion } from 'framer-motion';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { SPRINGS } from '@/lib/motion/springs';
import { GlassPanel } from '@/components/glass/Glass';
import { IconChart, IconGlobe, IconGrid, IconPlay, IconPuzzle, IconSettings } from '@/components/glass/Icons';

export type Section = 'play' | 'online' | 'puzzles' | 'analysis' | 'variants';

interface Item {
  id: Section;
  label: string;
  icon: ReactNode;
  /** Build phase that delivers the section. */
  phase?: number;
}

const ITEMS: Item[] = [
  { id: 'play', label: 'Play', icon: <IconPlay size={20} /> },
  { id: 'online', label: 'Online', icon: <IconGlobe size={20} />, phase: 4 },
  { id: 'puzzles', label: 'Puzzle Rush', icon: <IconPuzzle size={20} />, phase: 4 },
  { id: 'analysis', label: 'Review', icon: <IconChart size={20} />, phase: 3 },
  { id: 'variants', label: 'Variants', icon: <IconGrid size={20} />, phase: 4 },
];

export function NavRail({ active, onSelect }: { active: Section; onSelect(s: Section): void }) {
  return (
    <GlassPanel radius={24} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 py-3">
      {ITEMS.map((item) => {
        const isActive = item.id === active;
        const locked = item.phase !== undefined;
        return (
          <motion.button
            key={item.id}
            type="button"
            disabled={locked}
            onClick={() => onSelect(item.id)}
            whileTap={locked ? undefined : { scale: 0.9 }}
            transition={SPRINGS.snappy}
            title={locked ? `${item.label}: arrives in Phase ${item.phase}` : item.label}
            className={clsx(
              'relative grid h-[52px] w-[52px] place-items-center rounded-2xl',
              isActive ? 'text-ink' : 'text-ink-faint',
              locked ? 'cursor-not-allowed opacity-45' : 'hover:text-ink',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="nav-pill"
                transition={SPRINGS.snappy}
                className="absolute inset-0 rounded-2xl bg-white/[0.12] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_18px_rgb(111_211_255/0.25)]"
              />
            )}
            <span className="relative flex flex-col items-center gap-0.5">
              {item.icon}
              <span className="text-[9.5px] font-semibold tracking-tight">{item.label.split(' ')[0]}</span>
            </span>
          </motion.button>
        );
      })}
      <div className="flex-1" />
      <button type="button" disabled title="Settings: arrives in Phase 4" className="grid size-[52px] cursor-not-allowed place-items-center rounded-2xl text-ink-faint opacity-45">
        <IconSettings size={20} />
      </button>
    </GlassPanel>
  );
}
