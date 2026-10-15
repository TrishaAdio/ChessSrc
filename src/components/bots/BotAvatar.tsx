import { memo } from 'react';
import { BOTS, type BotId } from '@/bots/personalities';

/** Faceted "crystal" avatar in each bot's palette. */
export const BotAvatar = memo(function BotAvatar({ id, size = 44 }: { id: BotId; size?: number }) {
  const bot = BOTS[id];
  const gid = `bot-grad-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label={`${bot.name} avatar`} role="img" style={{ filter: `drop-shadow(0 0 ${size * 0.18}px ${bot.palette.glow})` }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bot.palette.from} />
          <stop offset="1" stopColor={bot.palette.to} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#${gid})`} opacity="0.92" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="17.5" fill="none" stroke="rgba(255,255,255,0.6)" />
      {/* facets */}
      <polygon points="32,10 50,24 32,30" fill="rgba(255,255,255,0.32)" />
      <polygon points="32,10 14,24 32,30" fill="rgba(255,255,255,0.18)" />
      <polygon points="14,24 32,30 32,54" fill="rgba(0,0,0,0.08)" />
      <polygon points="50,24 32,30 32,54" fill="rgba(0,0,0,0.18)" />
      <polyline points="14,24 32,10 50,24 32,54 14,24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" strokeLinejoin="round" />
      <text x="32" y="38" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff" style={{ fontFamily: 'var(--font-display)', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 2 }}>
        {bot.name[0]}
      </text>
    </svg>
  );
});
