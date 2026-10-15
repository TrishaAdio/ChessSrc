import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { useGameStore, type BubbleTone } from '@/store/gameStore';

const TONE_RING: Record<BubbleTone, string> = {
  neutral: 'rgb(255 255 255 / 0.18)',
  warm: 'rgb(110 231 183 / 0.4)',
  impressed: 'rgb(103 232 249 / 0.5)',
  smug: 'rgb(251 191 36 / 0.45)',
  concerned: 'rgb(251 113 133 / 0.45)',
};

/**
 * Glass speech bubble anchored to the bot's player card. It springs out of
 * the avatar and dismisses itself after a reading-time-based delay.
 */
export function SpeechBubble({ placement }: { placement: 'below' | 'above' }) {
  const bubble = useGameStore((s) => s.bubble);
  const clearBubble = useGameStore((s) => s.clearBubble);

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => clearBubble(bubble.id), Math.max(3200, bubble.text.length * 60));
    return () => clearTimeout(t);
  }, [bubble, clearBubble]);

  const below = placement === 'below';
  return (
    <div className="pointer-events-none absolute left-1 z-40" style={below ? { top: 'calc(100% + 4px)' } : { bottom: 'calc(100% + 4px)' }}>
      <AnimatePresence mode="popLayout">
        {bubble && (
          <motion.div
            key={bubble.id}
            data-testid="speech-bubble"
            initial={{ opacity: 0, scale: 0.6, y: below ? -10 : 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, transition: SPRINGS.settle }}
            transition={SPRINGS.pop}
            style={{ originX: 0.08, originY: below ? 0 : 1 }}
            className="relative"
          >
            <div
              className="glass glass-strong max-w-[300px] px-3.5 py-2 text-[13px] font-medium leading-snug text-ink"
              style={{ ['--glass-radius' as string]: '16px', boxShadow: `0 0 0 1px ${TONE_RING[bubble.tone]}, 0 12px 30px -12px rgb(0 0 0 / 0.6)` }}
            >
              {bubble.text}
            </div>
            <span
              className="absolute left-4 size-3 rotate-45 bg-white/20 backdrop-blur-md"
              style={below ? { top: -5, borderTopLeftRadius: 3 } : { bottom: -5, borderBottomRightRadius: 3 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
