import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { SPRINGS } from '@/lib/motion/springs';
import type { Color } from '@/lib/chess/types';
import { BOT_ORDER, BOTS, type BotId } from '@/bots/personalities';
import { GlassButton, GlassPanel } from '@/components/glass/Glass';
import { PieceGlyph } from '@/components/board/PieceSprite';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { TIME_CONTROLS, UNLIMITED, type TimeCategory, type TimeControl } from '@/store/timeControls';
import { useGameStore, type Opponent, type PlayerSide } from '@/store/gameStore';

function Segmented<T extends string>({ value, options, onChange, layoutId }: { value: T; options: { value: T; label: ReactNode }[]; onChange(v: T): void; layoutId: string }) {
  return (
    <div className="glass-inset flex gap-1 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx('relative flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] text-[13px] font-semibold', value === o.value ? 'text-ink' : 'text-ink-dim hover:text-ink')}
        >
          {value === o.value && (
            <motion.span layoutId={layoutId} transition={SPRINGS.snappy} className="absolute inset-0 rounded-[11px] bg-white/[0.14] shadow-[inset_0_1px_0_rgb(255_255_255/0.22)]" />
          )}
          <span className="relative flex items-center gap-2">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const CATEGORY_LABEL: Record<Exclude<TimeCategory, 'unlimited'>, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' };
const SECTION = 'text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint';

function BotPicker({ value, onChange }: { value: BotId; onChange(id: BotId): void }) {
  const bot = BOTS[value];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-5 gap-2">
        {BOT_ORDER.map((id) => {
          const b = BOTS[id];
          const selected = id === value;
          return (
            <motion.button
              key={id}
              type="button"
              data-testid={`bot-${id}`}
              onClick={() => onChange(id)}
              whileTap={{ scale: 0.95 }}
              transition={SPRINGS.snappy}
              className={clsx('relative flex flex-col items-center gap-1 rounded-2xl px-1 pb-2 pt-2.5', selected ? 'text-ink' : 'text-ink-dim hover:bg-white/[0.05]')}
            >
              {selected && (
                <motion.span
                  layoutId="ng-bot"
                  transition={SPRINGS.snappy}
                  className="absolute inset-0 rounded-2xl bg-white/[0.1] ring-1 ring-white/25"
                  style={{ boxShadow: `0 0 22px ${b.palette.glow}` }}
                />
              )}
              <span className="relative">
                <BotAvatar id={id} size={42} />
              </span>
              <span className="relative text-[12.5px] font-bold">{b.name}</span>
              <span className="tabular relative text-[10.5px] text-ink-faint">{b.elo}</span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRINGS.snappy}
          className="glass-inset px-3.5 py-2.5 text-[12.5px]"
        >
          <span className="font-semibold text-ink">
            {bot.name} · {bot.title}
          </span>
          <span className="text-ink-dim"> · {bot.tagline}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function NewGameSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [opponent, setOpponent] = useState<Opponent>('bot');
  const [botId, setBotId] = useState<BotId>('kael');
  const [side, setSide] = useState<Color | 'random'>('w');
  const [tc, setTc] = useState<TimeControl>(UNLIMITED);

  // Each time the sheet opens, start from the current game's settings.
  useEffect(() => {
    if (!open) return;
    const s = useGameStore.getState();
    setOpponent(s.opponent);
    setBotId(s.botId);
    setSide(s.playerSide === 'b' ? 'b' : 'w');
    setTc(s.timeControl);
  }, [open]);

  const start = () => {
    const playerSide: PlayerSide = opponent === 'human' ? 'both' : side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    useGameStore.getState().newGame({ opponent, botId, playerSide, timeControl: tc });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          // Non-animatable: applied instantly, so the board is usable while the sheet fades out.
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={SPRINGS.fade}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[6px]" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 12, opacity: 0 }}
            transition={SPRINGS.gentle}
            className="relative w-[560px]"
            role="dialog"
            aria-label="New game"
          >
            <GlassPanel strong radius={28} className="flex flex-col gap-5 p-6">
              <div>
                <h2 className="font-display text-[22px] font-bold tracking-tight">New Game</h2>
                <p className="text-[12.5px] text-ink-faint">Online play arrives in Phase 4.</p>
              </div>

              <section className="flex flex-col gap-2">
                <span className={SECTION}>Opponent</span>
                <Segmented<Opponent>
                  layoutId="ng-opp"
                  value={opponent}
                  onChange={setOpponent}
                  options={[
                    { value: 'bot', label: 'Computer' },
                    { value: 'human', label: 'Pass & Play' },
                  ]}
                />
              </section>

              <AnimatePresence initial={false}>
                {opponent === 'bot' && (
                  <motion.section
                    className="flex flex-col gap-3 overflow-hidden"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={SPRINGS.gentle}
                  >
                    <BotPicker value={botId} onChange={setBotId} />
                    <span className={SECTION}>Play as</span>
                    <Segmented<Color | 'random'>
                      layoutId="ng-side"
                      value={side}
                      onChange={setSide}
                      options={[
                        { value: 'w', label: <><PieceGlyph color="w" type="k" size={20} /> White</> },
                        { value: 'random', label: 'Random' },
                        { value: 'b', label: <><PieceGlyph color="b" type="k" size={20} /> Black</> },
                      ]}
                    />
                  </motion.section>
                )}
              </AnimatePresence>

              <section className="flex flex-col gap-2.5">
                <span className={SECTION}>Time control</span>
                {(['bullet', 'blitz', 'rapid'] as const).map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="w-14 text-[12px] font-semibold text-ink-dim">{CATEGORY_LABEL[cat]}</span>
                    <div className="flex flex-1 gap-2">
                      {TIME_CONTROLS.filter((t) => t.category === cat).map((t) => (
                        <TcChip key={t.id} tc={t} selected={tc.id === t.id} onClick={() => setTc(t)} />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="w-14 text-[12px] font-semibold text-ink-dim">Casual</span>
                  <TcChip tc={UNLIMITED} selected={tc.id === UNLIMITED.id} onClick={() => setTc(UNLIMITED)} />
                </div>
              </section>

              <div className="flex justify-end gap-2 pt-1">
                <GlassButton variant="ghost" onClick={onClose}>
                  Cancel
                </GlassButton>
                <GlassButton variant="accent" size="lg" onClick={start}>
                  Start Game
                </GlassButton>
              </div>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TcChip({ tc, selected, onClick }: { tc: TimeControl; selected: boolean; onClick(): void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      animate={{ scale: selected ? 1.03 : 1 }}
      transition={SPRINGS.snappy}
      className={clsx(
        'tabular h-10 flex-1 rounded-2xl px-3 text-[13.5px] font-semibold ring-1 transition-colors',
        selected ? 'bg-sky-300/20 text-ink ring-sky-200/45 shadow-[0_0_18px_rgb(111_211_255/0.3)]' : 'bg-white/[0.05] text-ink-dim ring-white/10 hover:bg-white/10',
      )}
    >
      {tc.label}
    </motion.button>
  );
}
