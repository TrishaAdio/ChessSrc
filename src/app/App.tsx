import { useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { AmbientBackground } from '@/components/background/AmbientBackground';
import { PieceSprite } from '@/components/board/PieceSprite';
import { DesignLab } from '@/components/dev/DesignLab';
import { NewGameSheet } from '@/components/dialogs/NewGameSheet';
import { BoardStage } from '@/components/game/BoardStage';
import { GameControls } from '@/components/sidebar/GameControls';
import { MoveList } from '@/components/sidebar/MoveList';
import { OpeningTicker } from '@/components/sidebar/OpeningTicker';
import { useAmbientTension } from '@/hooks/useAmbientTension';
import { useBackdrop } from '@/hooks/useBackdrop';
import { useClockWatcher, useKeyboardShortcuts } from '@/hooks/useGameLoop';
import { useBotBanter, useBotOpponent } from '@/bots/useBotOpponent';
import { BOTS } from '@/bots/personalities';
import { analysisService } from '@/engine/analysisService';
import { soundBus } from '@/lib/audio/soundBus';
import { useGameStore } from '@/store/gameStore';
import { NavRail, type Section } from './NavRail';
import { TitleBar } from './TitleBar';

function Sidebar({ onNewGame }: { onNewGame(): void }) {
  const moves = useGameStore((s) => s.moves);
  const annotations = useGameStore((s) => s.annotations);
  const viewPly = useGameStore((s) => s.viewPly);
  const opening = useGameStore((s) => s.opening);
  const goToPly = useGameStore((s) => s.goToPly);
  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-3">
      <OpeningTicker opening={opening} ply={viewPly} />
      <MoveList moves={moves} annotations={annotations} viewPly={viewPly} onSelect={goToPly} />
      <GameControls onNewGame={onNewGame} />
    </aside>
  );
}

export function App() {
  const backdrop = useBackdrop();
  const tension = useAmbientTension();
  const [section, setSection] = useState<Section>('play');
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const tc = useGameStore((s) => s.timeControl);
  const opponent = useGameStore((s) => s.opponent);
  const botId = useGameStore((s) => s.botId);

  useClockWatcher();
  useBotOpponent();
  useBotBanter();
  useKeyboardShortcuts();

  useEffect(() => {
    void analysisService.start();
  }, []);

  useEffect(() => {
    // Unlock Web Audio on the first gesture (autoplay policy).
    const unlock = () => soundBus.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    const onKey = (e: KeyboardEvent) => {
      if (import.meta.env.DEV && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') setLabOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const subtitle = `${opponent === 'bot' ? `vs ${BOTS[botId].name} (${BOTS[botId].elo})` : 'Pass & Play'} · ${tc.category === 'unlimited' ? 'Unlimited' : `${tc.label} ${tc.category}`}`;

  return (
    <MotionConfig reducedMotion="user">
      <PieceSprite />
      <AmbientBackground tension={tension} backdrop={backdrop} />
      <div className="relative flex h-full flex-col">
        <TitleBar subtitle={subtitle} onToggleLab={() => setLabOpen((v) => !v)} labOpen={labOpen} />
        <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-3">
          <NavRail active={section} onSelect={setSection} />
          <main className="flex min-w-0 flex-1">
            <BoardStage />
          </main>
          <Sidebar onNewGame={() => setNewGameOpen(true)} />
        </div>
      </div>
      <NewGameSheet open={newGameOpen} onClose={() => setNewGameOpen(false)} />
      {import.meta.env.DEV && <DesignLab open={labOpen} onClose={() => setLabOpen(false)} />}
    </MotionConfig>
  );
}
