import { motion } from 'framer-motion';
import { analysisService } from '@/engine/analysisService';
import { CLASS_META } from '@/lib/classification';
import { SPRINGS } from '@/lib/motion/springs';
import { GlassButton } from '@/components/glass/Glass';
import { useGameStore } from '@/store/gameStore';

/** Shown in place of the top player card while retrying a mistake. */
export function RetryBanner() {
  const retry = useGameStore((s) => s.retry);
  const original = useGameStore((s) => (s.retry ? s.annotations[s.retry.ply] : undefined));
  const originalSan = useGameStore((s) => (s.retry ? s.moves[s.retry.ply - 1]?.san : undefined));
  if (!retry) return null;
  const cls = retry.attempt?.classification ?? (retry.status === 'revealed' ? 'best' : null);
  const tint = cls ? CLASS_META[cls].color : '#67e8f9';

  return (
    <motion.div
      key={retry.ply}
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRINGS.gentle}
      className="glass glass-strong flex h-14 items-center gap-3 px-3"
      style={{ ['--glass-radius' as string]: '18px', boxShadow: `0 0 0 1px ${tint}55, 0 0 26px -6px ${tint}` }}
      data-testid="retry-banner"
      data-status={retry.status}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink" data-testid="retry-message">
          {retry.message}
        </div>
        <div className="truncate text-[11.5px] text-ink-faint">
          Played {originalSan}
          {original ? ` (${CLASS_META[original.classification].label})` : ''} · attempt {retry.tries}
        </div>
      </div>
      {retry.status !== 'solved' && retry.status !== 'revealed' && (
        <GlassButton size="sm" variant="ghost" onClick={() => analysisService.revealRetry()} data-testid="retry-reveal">
          Show
        </GlassButton>
      )}
      <GlassButton size="sm" variant={retry.status === 'solved' || retry.status === 'revealed' ? 'accent' : 'glass'} onClick={() => analysisService.nextRetry()} data-testid="retry-next">
        Next
      </GlassButton>
      <GlassButton size="sm" variant="ghost" onClick={() => analysisService.exitRetry()}>
        Exit
      </GlassButton>
    </motion.div>
  );
}
