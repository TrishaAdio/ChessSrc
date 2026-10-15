import { AnimatePresence, motion } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { GlassButton, GlassPanel, IconButton } from '@/components/glass/Glass';
import { analysisService } from '@/engine/analysisService';
import { IconChart, IconFirst, IconFlag, IconFlip, IconLast, IconMute, IconNext, IconPlus, IconPrev, IconUndo, IconVolume } from '@/components/glass/Icons';
import { useSettings } from '@/store/settingsStore';
import { useGameStore, type GameOverReason, type GameStatus } from '@/store/gameStore';

const REASON: Record<GameOverReason, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  insufficient: 'by insufficient material',
  'fifty-move': 'by the 50-move rule',
  timeout: 'on time',
  'timeout-vs-insufficient': 'timeout vs. insufficient material',
  resignation: 'by resignation',
};

function ResultCard({ status, onNewGame }: { status: GameStatus; onNewGame(): void }) {
  return (
    <AnimatePresence>
      {status.state === 'over' && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={SPRINGS.gentle}
        >
          <GlassPanel strong radius={22} className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex-1">
              <div className="font-display text-[17px] font-bold tracking-tight">
                {status.winner ? `${status.winner === 'w' ? 'White' : 'Black'} wins` : 'Draw'}
                <span className="tabular ml-2 text-[13px] font-semibold text-ink-faint">{status.result === '1/2-1/2' ? '½–½' : status.result}</span>
              </div>
              <div className="text-[12.5px] text-ink-dim">{REASON[status.reason]}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <GlassButton variant="accent" size="sm" icon={<IconChart size={15} />} onClick={() => analysisService.requestReview()} data-testid="game-review">
                Game Review
              </GlassButton>
              <GlassButton size="sm" icon={<IconPlus size={15} />} onClick={onNewGame}>
                Rematch
              </GlassButton>
            </div>
          </GlassPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function GameControls({ onNewGame }: { onNewGame(): void }) {
  const viewPly = useGameStore((s) => s.viewPly);
  const total = useGameStore((s) => s.moves.length);
  const status = useGameStore((s) => s.status);
  const { goToPly, stepPly, flip, takeback, resign, newGame } = useGameStore.getState();
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);
  const playing = status.state === 'playing';

  return (
    <div className="flex flex-col gap-3">
      <ResultCard status={status} onNewGame={() => newGame()} />
      <GlassPanel radius={22} className="flex flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between">
          <IconButton label="First move (Home)" onClick={() => goToPly(0)} disabled={viewPly === 0}>
            <IconFirst />
          </IconButton>
          <IconButton label="Previous (←)" onClick={() => stepPly(-1)} disabled={viewPly === 0}>
            <IconPrev />
          </IconButton>
          <IconButton label="Next (→)" onClick={() => stepPly(1)} disabled={viewPly === total}>
            <IconNext />
          </IconButton>
          <IconButton label="Latest (End)" onClick={() => goToPly(total)} disabled={viewPly === total}>
            <IconLast />
          </IconButton>
          <div className="mx-1 h-6 w-px bg-white/10" />
          <IconButton label="Flip board (F)" onClick={flip}>
            <IconFlip />
          </IconButton>
          <IconButton label={soundEnabled ? 'Mute' : 'Unmute'} onClick={() => setSoundEnabled(!soundEnabled)} active={!soundEnabled}>
            {soundEnabled ? <IconVolume /> : <IconMute />}
          </IconButton>
        </div>
        <div className="hairline" />
        <div className="grid grid-cols-3 gap-2">
          <GlassButton size="sm" icon={<IconUndo size={15} />} onClick={takeback} disabled={total === 0}>
            Takeback
          </GlassButton>
          <GlassButton size="sm" variant="danger" icon={<IconFlag size={15} />} onClick={() => resign()} disabled={!playing || total === 0}>
            Resign
          </GlassButton>
          <GlassButton size="sm" variant="accent" icon={<IconPlus size={15} />} onClick={onNewGame}>
            New
          </GlassButton>
        </div>
      </GlassPanel>
    </div>
  );
}
