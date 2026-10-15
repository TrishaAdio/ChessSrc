import { memo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { CLASS_META, type MoveAnnotation } from '@/lib/classification';
import { SPRINGS } from '@/lib/motion/springs';
import { GlassPanel } from '@/components/glass/Glass';
import { ReviewPanel } from '@/components/review/ReviewPanel';
import { useGameStore, type MoveRecord, type SidebarTab } from '@/store/gameStore';
import { EngineChip } from './EngineChip';

interface MoveListProps {
  moves: readonly MoveRecord[];
  annotations: Record<number, MoveAnnotation>;
  viewPly: number;
  onSelect(ply: number): void;
}

const MoveCell = memo(function MoveCell({ move, annotation, active, onSelect }: { move: MoveRecord; annotation?: MoveAnnotation; active: boolean; onSelect(ply: number): void }) {
  const meta = annotation ? CLASS_META[annotation.classification] : null;
  return (
    <button
      type="button"
      data-active={active || undefined}
      data-ply={move.ply}
      data-class={annotation?.classification}
      onClick={() => onSelect(move.ply)}
      title={annotation?.reason}
      className={clsx('relative flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-left text-[13.5px] font-semibold', active ? 'text-ink' : 'text-ink-dim hover:bg-white/[0.06] hover:text-ink')}
    >
      {active && (
        <motion.span
          layoutId="move-cursor"
          transition={SPRINGS.snappy}
          className="absolute inset-0 rounded-xl bg-white/[0.14] shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_0_14px_rgb(111_211_255/0.18)]"
        />
      )}
      {meta && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={SPRINGS.pop}
          className="relative grid size-4 shrink-0 place-items-center rounded-full text-[8.5px] font-black text-white"
          style={{ background: meta.color, boxShadow: `0 0 8px ${meta.glow}` }}
          title={meta.label}
        >
          {meta.icon === 'text' ? meta.glyph : meta.glyph.slice(0, 2)}
        </motion.span>
      )}
      <span className="relative">{move.san}</span>
    </button>
  );
});

function MoveRows({ moves, annotations, viewPly, onSelect }: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [viewPly, moves.length]);

  const rows: { n: number; white?: MoveRecord; black?: MoveRecord }[] = [];
  for (const m of moves) {
    const n = Math.ceil(m.ply / 2);
    if (m.color === 'w' || !rows.length || rows.at(-1)!.n !== n) rows.push({ n });
    rows.at(-1)![m.color === 'w' ? 'white' : 'black'] = m;
  }

  return (
    <div ref={scrollRef} className="scroll-glass min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="move-list">
      {rows.length === 0 ? (
        <div className="grid h-full place-items-center px-6 text-center text-[12.5px] text-ink-faint">Make a move to begin. Drag or click a piece.</div>
      ) : (
        rows.map((r) => (
          <div key={r.n} className="grid grid-cols-[34px_1fr_1fr] items-center gap-1 rounded-xl even:bg-white/[0.025]">
            <span className="tabular pl-2 text-[12px] text-ink-faint">{r.n}.</span>
            {r.white ? <MoveCell move={r.white} annotation={annotations[r.white.ply]} active={viewPly === r.white.ply} onSelect={onSelect} /> : <span className="px-2.5 text-ink-faint">…</span>}
            {r.black ? <MoveCell move={r.black} annotation={annotations[r.black.ply]} active={viewPly === r.black.ply} onSelect={onSelect} /> : <span />}
          </div>
        ))
      )}
    </div>
  );
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'moves', label: 'Moves' },
  { id: 'review', label: 'Review' },
];

/** Sidebar main panel: move list and game review tabs. */
export function MoveList(props: MoveListProps) {
  const tab = useGameStore((s) => s.sidebarTab);
  const setTab = useGameStore((s) => s.setSidebarTab);
  return (
    <GlassPanel radius={22} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="glass-inset flex gap-0.5 p-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={clsx('relative h-7 rounded-[10px] px-3 text-[12px] font-semibold', tab === t.id ? 'text-ink' : 'text-ink-faint hover:text-ink')}
            >
              {tab === t.id && <motion.span layoutId="side-tab" transition={SPRINGS.snappy} className="absolute inset-0 rounded-[10px] bg-white/[0.13]" />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <EngineChip />
      </div>
      <div className="hairline mx-3" />
      {tab === 'moves' ? <MoveRows {...props} /> : <ReviewPanel />}
    </GlassPanel>
  );
}
