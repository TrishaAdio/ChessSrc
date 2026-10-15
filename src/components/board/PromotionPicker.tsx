import { motion } from 'framer-motion';
import { SPRINGS } from '@/lib/motion/springs';
import { squareToVisual } from '@/lib/chess/squares';
import type { Color, PromotionPiece, Square } from '@/lib/chess/types';
import { PieceGlyph } from './PieceSprite';

const CHOICES: PromotionPiece[] = ['q', 'n', 'r', 'b'];

interface Props {
  square: Square;
  color: Color;
  orientation: Color;
  size: number;
  onPick(p: PromotionPiece): void;
  onCancel(): void;
}

/** Glass column of promotion choices that unfolds from the promotion square. */
export function PromotionPicker({ square, color, orientation, size, onPick, onCancel }: Props) {
  const { col, row } = squareToVisual(square, orientation);
  const downward = row === 0;
  const top = downward ? 0 : (row - 3) * size;

  return (
    <motion.div
      className="absolute inset-0 z-[90]"
      animate={{ pointerEvents: 'auto' }}
      exit={{ pointerEvents: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.div
        className="absolute inset-0 rounded-[12px] bg-black/35 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={SPRINGS.fade}
        style={{ pointerEvents: 'none' }}
      />
      <motion.div
        className="glass glass-strong absolute flex overflow-hidden"
        style={{
          left: col * size,
          top,
          width: size,
          height: size * 4,
          flexDirection: downward ? 'column' : 'column-reverse',
          ['--glass-radius' as string]: `${size * 0.22}px`,
          transformOrigin: downward ? 'top' : 'bottom',
        }}
        initial={{ scaleY: 0.2, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        exit={{ scaleY: 0.2, opacity: 0 }}
        transition={SPRINGS.gentle}
      >
        {CHOICES.map((p, i) => (
          <motion.button
            key={p}
            type="button"
            aria-label={`Promote to ${p}`}
            className="grid shrink-0 place-items-center hover:bg-white/15"
            style={{ width: size, height: size }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, transition: { ...SPRINGS.pop, delay: 0.03 + i * 0.035 } }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(p)}
          >
            <PieceGlyph color={color} type={p} size={size * 0.86} />
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}
