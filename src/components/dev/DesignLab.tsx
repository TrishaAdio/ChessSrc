import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { CLASS_META, type MoveClass } from '@/lib/classification';
import { formatEval } from '@/lib/chess/evaluation';
import { SPRINGS } from '@/lib/motion/springs';
import { GlassPanel } from '@/components/glass/Glass';
import { useGameStore } from '@/store/gameStore';

const CLASSES = Object.keys(CLASS_META) as MoveClass[];

/**
 * DEV-only panel that drives the same store APIs the Phase 3 engine will use
 * (`setEvaluation`, `setAnnotation`), so the eval bar, badges and ambient mood
 * can be previewed and tuned before Stockfish is wired in.
 */
export function DesignLab({ open, onClose }: { open: boolean; onClose(): void }) {
  const evaluation = useGameStore((s) => s.evaluation);
  const viewPly = useGameStore((s) => s.viewPly);
  const current = useGameStore((s) => s.annotations[s.viewPly]?.classification);
  const override = useGameStore((s) => s.ambientOverride);
  const { setEvaluation, setAnnotation, setAmbientOverride } = useGameStore.getState();
  const cp = evaluation.kind === 'cp' ? evaluation.cp : evaluation.kind === 'mate' ? Math.sign(evaluation.mate) * 1000 : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed bottom-5 left-24 z-40 w-[360px]"
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={SPRINGS.gentle}
        >
          <GlassPanel strong radius={22} className="flex flex-col gap-3 p-4 text-[12.5px]">
            <div className="flex items-center justify-between">
              <span className="font-display text-[14px] font-bold text-fuchsia-100">Design Lab</span>
              <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
                Close
              </button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="flex justify-between text-ink-dim">
                Evaluation <span className="tabular font-semibold text-ink">{formatEval(evaluation)}</span>
              </span>
              <input type="range" min={-1000} max={1000} step={10} value={cp} onChange={(e) => setEvaluation({ kind: 'cp', cp: Number(e.target.value) })} className="accent-sky-300" />
            </label>
            <div className="flex gap-1.5">
              {[-3, -1, 1, 3].map((m) => (
                <button key={m} type="button" onClick={() => setEvaluation({ kind: 'mate', mate: m })} className="tabular flex-1 rounded-lg bg-white/[0.07] py-1.5 font-semibold hover:bg-white/15">
                  {m > 0 ? `+M${m}` : `-M${-m}`}
                </button>
              ))}
              <button type="button" onClick={() => setEvaluation({ kind: 'cp', cp: 0 })} className="flex-1 rounded-lg bg-white/[0.07] py-1.5 font-semibold hover:bg-white/15">
                0.0
              </button>
            </div>

            <div className="hairline" />
            <span className="text-ink-dim">Badge on current move {viewPly === 0 && <em className="text-ink-faint">(make a move first)</em>}</span>
            <div className="grid grid-cols-5 gap-1.5">
              {CLASSES.map((c) => {
                const m = CLASS_META[c];
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={viewPly === 0}
                    title={m.label}
                    onClick={() => setAnnotation(viewPly, { classification: c })}
                    className={clsx('h-9 rounded-lg font-black text-white disabled:opacity-30', current === c && 'ring-2 ring-white/70')}
                    style={{ background: m.color, boxShadow: `0 0 10px ${m.glow}` }}
                  >
                    {m.glyph}
                  </button>
                );
              })}
            </div>

            <div className="hairline" />
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-ink-dim">
                Ambient tension
                <span className="flex items-center gap-1.5">
                  <input type="checkbox" checked={override === null} onChange={(e) => setAmbientOverride(e.target.checked ? null : 0.5)} /> auto
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                disabled={override === null}
                value={override ?? 0}
                onChange={(e) => setAmbientOverride(Number(e.target.value))}
                className="accent-amber-300 disabled:opacity-40"
              />
            </label>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
