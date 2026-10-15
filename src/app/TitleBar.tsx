import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { inTauri, nativeWindow } from '@/lib/platform/window';
import { SPRINGS } from '@/lib/motion/springs';
import { IconClose, IconFlask, IconMaximize, IconMinimize, IconRestore } from '@/components/glass/Icons';

interface TitleBarProps {
  subtitle: string;
  onToggleLab?: () => void;
  labOpen?: boolean;
}

function WindowButton({ label, onClick, danger, children }: { label: string; onClick(): void; danger?: boolean; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      transition={SPRINGS.snappy}
      className={clsx(
        'grid h-8 w-11 place-items-center rounded-xl text-ink-dim transition-colors',
        danger ? 'hover:bg-[#e81123]/85 hover:text-white' : 'hover:bg-white/10 hover:text-ink',
      )}
    >
      {children}
    </motion.button>
  );
}

/**
 * Frameless title bar. `data-tauri-drag-region` makes the bar move the window
 * (double-click maximizes). The caption buttons sit inside the frosted header.
 */
export function TitleBar({ subtitle, onToggleLab, labOpen }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const native = inTauri();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const sync = () => void nativeWindow.isMaximized().then(setMaximized);
    sync();
    void nativeWindow.onResized(sync).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return (
    <header data-tauri-drag-region className="relative z-20 flex h-12 shrink-0 items-center gap-3 pl-4 pr-2">
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <img src="/crystal.svg" alt="" className="pointer-events-none size-6 drop-shadow-[0_0_8px_rgb(111_211_255/0.6)]" />
        <span data-tauri-drag-region className="font-display text-[14px] font-semibold tracking-tight text-ink">
          Crystal<span className="text-accent">Chess</span>
        </span>
      </div>
      <span data-tauri-drag-region className="truncate text-[12.5px] text-ink-faint">
        {subtitle}
      </span>

      <div data-tauri-drag-region className="h-full flex-1" />

      {import.meta.env.DEV && onToggleLab && (
        <motion.button
          type="button"
          onClick={onToggleLab}
          whileTap={{ scale: 0.92 }}
          transition={SPRINGS.snappy}
          className={clsx(
            'flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition-colors',
            labOpen ? 'bg-fuchsia-400/20 text-fuchsia-100 ring-1 ring-fuchsia-300/30' : 'text-ink-dim hover:bg-white/10',
          )}
          title="Design Lab (Ctrl+Shift+L)"
        >
          <IconFlask size={15} /> Design Lab
        </motion.button>
      )}

      {native && (
        <div className="flex items-center gap-0.5">
          <WindowButton label="Minimize" onClick={() => void nativeWindow.minimize()}>
            <IconMinimize />
          </WindowButton>
          <WindowButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => void nativeWindow.toggleMaximize()}>
            {maximized ? <IconRestore /> : <IconMaximize />}
          </WindowButton>
          <WindowButton label="Close" danger onClick={() => void nativeWindow.close()}>
            <IconClose />
          </WindowButton>
        </div>
      )}
      <div className="hairline absolute inset-x-4 bottom-0" />
    </header>
  );
}
