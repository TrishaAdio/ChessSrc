import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { MaterialSummary } from '@/lib/chess/material';
import type { Color, PieceSymbol } from '@/lib/chess/types';
import { SPRINGS } from '@/lib/motion/springs';
import type { ClockState } from '@/store/clock';
import { PieceGlyph } from '@/components/board/PieceSprite';
import { ClockFace } from './ClockFace';

interface PlayerCardProps {
  color: Color;
  name: string;
  subtitle: string;
  toMove: boolean;
  material: MaterialSummary;
  clock: ClockState | null;
  /** Custom avatar (bots); defaults to a king glyph. */
  avatar?: ReactNode;
  /** Overlay anchored to the card (speech bubble). */
  overlay?: ReactNode;
}

function CapturedRow({ pieces, victimColor }: { pieces: PieceSymbol[]; victimColor: Color }) {
  return (
    <div className="flex h-5 items-center">
      {pieces.map((t, i) => (
        <motion.span
          key={`${t}${i}`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SPRINGS.pop}
          className="block"
          style={{ marginLeft: i > 0 && pieces[i - 1] === t ? -9 : i > 0 ? 1 : 0 }}
        >
          <PieceGlyph color={victimColor} type={t} size={19} />
        </motion.span>
      ))}
    </div>
  );
}

export const PlayerCard = memo(function PlayerCard({ color, name, subtitle, toMove, material, clock, avatar, overlay }: PlayerCardProps) {
  const lead = material.lead[color];
  return (
    <div className="relative flex h-14 items-center gap-3 px-1" data-testid={`player-card-${color}`}>
      <motion.div
        animate={{ scale: toMove ? 1 : 0.94 }}
        transition={SPRINGS.snappy}
        className={avatar ? 'relative grid size-11 shrink-0 place-items-center' : 'glass grid size-11 shrink-0 place-items-center'}
        style={avatar ? undefined : { ['--glass-radius' as string]: '14px' }}
      >
        {avatar ?? <PieceGlyph color={color} type="k" size={30} />}
        {toMove && (
          <motion.span
            layoutId="turn-dot"
            transition={SPRINGS.snappy}
            className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-accent-2 ring-2 ring-[#0b1022] shadow-[0_0_10px_#43e3b0]"
          />
        )}
      </motion.div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14.5px] font-semibold text-ink">{name}</span>
          <span className="truncate text-[11.5px] text-ink-faint">{subtitle}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CapturedRow pieces={material.capturedBy[color]} victimColor={color === 'w' ? 'b' : 'w'} />
          {lead > 0 && <span className="text-[11.5px] font-semibold text-ink-dim">+{lead}</span>}
        </div>
      </div>
      {clock && <ClockFace clock={clock} color={color} />}
      {overlay}
    </div>
  );
});
