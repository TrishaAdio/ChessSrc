import { useEffect, useMemo, useRef } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useSpring } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { analysisService } from '@/engine/analysisService';
import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color } from '@/lib/chess/types';
import { BREAKDOWN_ORDER, CLASS_META, RETRYABLE } from '@/lib/classification';
import { SPRINGS, springOptions } from '@/lib/motion/springs';
import { BOTS } from '@/bots/personalities';
import { GlassButton } from '@/components/glass/Glass';
import { IconChart, IconUndo } from '@/components/glass/Icons';
import { useGameStore } from '@/store/gameStore';
import { EvalGraph } from './EvalGraph';

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const target = useMotionValue(0);
  const shown = useSpring(target, springOptions(SPRINGS.gentle));
  useEffect(() => target.set(value), [value, target]);
  useMotionValueEvent(shown, 'change', (v) => {
    if (ref.current) ref.current.textContent = v.toFixed(1);
  });
  return <span ref={ref}>0.0</span>;
}

function AccuracyCard({ label, color, value }: { label: string; color: Color; value: number | null }) {
  return (
    <div className="glass-inset flex flex-1 flex-col items-center gap-0.5 py-3" data-testid={`accuracy-${color}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</span>
      <span className="tabular font-display text-[28px] font-bold leading-none tracking-tight" style={{ color: color === 'w' ? '#f8fafc' : '#c7d2fe' }}>
        {value === null ? '—' : <CountUp value={value} />}
      </span>
      <span className="text-[10.5px] text-ink-faint">accuracy</span>
    </div>
  );
}

export function ReviewPanel() {
  const r = useGameStore(
    useShallow((s) => ({
      review: s.review,
      moves: s.moves,
      annotations: s.annotations,
      positionEvals: s.positionEvals,
      viewPly: s.viewPly,
      playerSide: s.playerSide,
      opponent: s.opponent,
      botId: s.botId,
      retry: s.retry,
    })),
  );
  const goToPly = useGameStore((s) => s.goToPly);

  const evals = useMemo<(Evaluation | null)[]>(
    () => Array.from({ length: r.moves.length + 1 }, (_, ply) => r.positionEvals[ply]?.eval ?? null),
    [r.moves.length, r.positionEvals],
  );

  const name = (c: Color) => {
    if (r.playerSide === 'both') return c === 'w' ? 'White' : 'Black';
    return c === r.playerSide ? 'You' : r.opponent === 'bot' ? BOTS[r.botId].name : c === 'w' ? 'White' : 'Black';
  };

  const retryable = useMemo(
    () =>
      r.moves.filter((m) => {
        const a = r.annotations[m.ply];
        return a && RETRYABLE.has(a.classification) && (r.playerSide === 'both' || r.playerSide === m.color);
      }).length,
    [r.moves, r.annotations, r.playerSide],
  );

  if (r.review.status === 'idle') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <IconChart size={28} className="text-ink-faint" />
        <p className="text-[12.5px] text-ink-dim">Classify every move, measure accuracy and replay your mistakes.</p>
        <GlassButton variant="accent" onClick={() => analysisService.requestReview()} disabled={r.moves.length < 1} data-testid="start-review">
          Run Game Review
        </GlassButton>
      </div>
    );
  }

  const summary = r.review.summary;
  return (
    <div className="scroll-glass flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-1" data-testid="review-panel">
      {r.review.status === 'running' && (
        <div className="flex flex-col gap-1.5 pt-1" data-testid="review-progress">
          <div className="flex justify-between text-[11.5px] text-ink-dim">
            <span>Analyzing with Stockfish…</span>
            <span className="tabular">{Math.round(r.review.progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-sky-300 to-emerald-300 shadow-[0_0_10px_rgb(103_232_249/0.7)]"
              initial={{ width: 0 }}
              animate={{ width: `${r.review.progress * 100}%` }}
              transition={SPRINGS.gentle}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <AccuracyCard label={name('w')} color="w" value={summary?.accuracy.w ?? null} />
        <AccuracyCard label={name('b')} color="b" value={summary?.accuracy.b ?? null} />
      </div>

      <EvalGraph evals={evals} moves={r.moves} annotations={r.annotations} viewPly={r.viewPly} onSelect={goToPly} />

      <table className="w-full text-[12.5px]" data-testid="breakdown-table">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
            <th className="pb-1 text-left font-semibold">Move</th>
            <th className="pb-1 text-center font-semibold">{name('w')}</th>
            <th className="pb-1 text-center font-semibold">{name('b')}</th>
          </tr>
        </thead>
        <tbody>
          {BREAKDOWN_ORDER.map((cls) => {
            const meta = CLASS_META[cls];
            const w = summary?.counts.w[cls] ?? countLive(r, 'w', cls);
            const b = summary?.counts.b[cls] ?? countLive(r, 'b', cls);
            return (
              <tr key={cls} data-class={cls} className="border-t border-white/[0.05]">
                <td className="py-1">
                  <span className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full text-[9.5px] font-black text-white" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.glow}` }}>
                      {meta.icon === 'text' ? meta.glyph : meta.glyph.slice(0, 2)}
                    </span>
                    <span className="text-ink-dim">{meta.label}</span>
                  </span>
                </td>
                <td className="tabular text-center font-semibold" data-count="w">{w}</td>
                <td className="tabular text-center font-semibold" data-count="b">{b}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {r.review.status === 'done' && (
        <GlassButton
          variant={retryable ? 'accent' : 'glass'}
          disabled={!retryable || !!r.retry}
          icon={<IconUndo size={15} />}
          onClick={() => analysisService.startRetry(1)}
          data-testid="retry-mistakes"
        >
          {retryable ? `Retry Mistakes (${retryable})` : 'No mistakes to retry'}
        </GlassButton>
      )}
    </div>
  );
}

function countLive(r: { moves: { ply: number; color: Color }[]; annotations: Record<number, { classification: string }> }, c: Color, cls: string): number {
  return r.moves.filter((m) => m.color === c && r.annotations[m.ply]?.classification === cls).length;
}
