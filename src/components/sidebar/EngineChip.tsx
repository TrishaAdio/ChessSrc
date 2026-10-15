import clsx from 'clsx';
import { useGameStore } from '@/store/gameStore';

/** Compact engine status: flavour, threads and live depth. */
export function EngineChip() {
  const engine = useGameStore((s) => s.engine);
  const label =
    engine.state === 'loading'
      ? 'Loading engine…'
      : engine.state === 'error'
        ? 'Engine offline'
        : engine.state === 'restarting'
          ? 'Restarting…'
          : `SF19 · d${engine.depth || '–'}`;
  const title =
    engine.state === 'ready'
      ? `Stockfish 19 lite (${engine.flavor === 'lite-mt' ? `${engine.threads} threads` : 'single-threaded'}) · ${Math.round(engine.nps / 1000)} kN/s`
      : (engine.detail ?? label);
  return (
    <span
      className={clsx(
        'tabular inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] font-semibold ring-1',
        engine.state === 'ready' ? 'bg-emerald-400/10 text-emerald-100 ring-emerald-300/25' : engine.state === 'error' ? 'bg-rose-500/15 text-rose-100 ring-rose-300/30' : 'bg-white/[0.06] text-ink-dim ring-white/10',
      )}
      title={title}
      data-testid="engine-chip"
      data-state={engine.state}
      data-flavor={engine.flavor ?? ''}
    >
      <span className={clsx('size-1.5 rounded-full', engine.state === 'ready' ? 'bg-emerald-300 shadow-[0_0_6px_#6ee7b7]' : engine.state === 'error' ? 'bg-rose-300' : 'animate-pulse bg-sky-300')} />
      {label}
    </span>
  );
}
