import { memo, type ReactNode } from 'react';
import type { Color, PieceSymbol } from '@/lib/chess/types';

/**
 * Original "neo-classic" vector piece set on a 100×100 grid, rendered once as
 * an SVG <symbol> sprite and drawn with <use href="#cc-wn"/>. Every piece on
 * the board shares the same gradients and paths, so DOM and paint costs stay
 * low even with 32 animated pieces.
 */

interface Palette {
  fill: string;
  stroke: string;
  detail: string;
  rim: string;
}

const PALETTE: Record<Color, Palette> = {
  w: { fill: 'url(#cc-fill-w)', stroke: '#141a2b', detail: '#141a2b', rim: 'rgba(255,255,255,0.95)' },
  b: { fill: 'url(#cc-fill-b)', stroke: '#05070c', detail: 'rgba(214,226,255,0.72)', rim: 'rgba(170,200,255,0.55)' },
};

const BASE = <rect x="22" y="80" width="56" height="11" rx="4" />;

function shapes(type: PieceSymbol, p: Palette): ReactNode {
  switch (type) {
    case 'p':
      return (
        <>
          <path d="M38 47 C40 59 34 70 28 80 L72 80 C66 70 60 59 62 47 Z" />
          <ellipse cx="50" cy="45" rx="15" ry="4.5" />
          <circle cx="50" cy="30" r="12" />
          {BASE}
          <path d="M43 25 a8 8 0 0 1 7 -5" fill="none" stroke={p.rim} strokeWidth="2.2" />
        </>
      );
    case 'r':
      return (
        <>
          <path d="M33 39 L67 39 L69 74 L31 74 Z" />
          <rect x="26" y="73" width="48" height="8" rx="2.5" />
          <rect x="30" y="34" width="40" height="6" rx="2" />
          <path d="M27 17 h10 v7 h6.5 v-7 h13 v7 h6.5 v-7 h10 v17 h-46 Z" />
          {BASE}
          <path d="M36 46 h28 M35 64 h30" fill="none" stroke={p.detail} strokeWidth="2" opacity="0.7" />
        </>
      );
    case 'n':
      return (
        <>
          <path d="M34 80 C34 69 39 62 46 57 C39 58 32 60 26 58 L19 52 C17 48 19 44 23 42 L42 25 L45 13 L54 21 C69 26 79 44 77 62 C76 70 73 76 73 80 Z" />
          {BASE}
          <circle cx="40" cy="34" r="2.8" fill={p.detail} stroke="none" />
          <path d="M24 51 l3 -1" fill="none" stroke={p.detail} strokeWidth="2.2" />
          <path d="M56 24 C66 31 71 44 70 60" fill="none" stroke={p.detail} strokeWidth="2" opacity="0.6" />
          <path d="M44 18 L42 27 L26 41" fill="none" stroke={p.rim} strokeWidth="2" opacity="0.8" />
        </>
      );
    case 'b':
      return (
        <>
          <path d="M40 58 C42 67 36 74 30 80 L70 80 C64 74 58 67 60 58 Z" />
          <ellipse cx="50" cy="55" rx="15" ry="4.5" />
          <path d="M50 19 C63 27 67 40 61 51 L39 51 C33 40 37 27 50 19 Z" />
          <circle cx="50" cy="14" r="5" />
          {BASE}
          <path d="M55 30 L46 41" fill="none" stroke={p.detail} strokeWidth="2.6" />
          <path d="M42 30 C44 26 46 24 49 22" fill="none" stroke={p.rim} strokeWidth="2" opacity="0.85" />
        </>
      );
    case 'q':
      return (
        <>
          <path d="M32 68 L68 68 L72 80 L28 80 Z" />
          <path d="M22 30 L31 62 L69 62 L78 30 L63 49 L64 22 L55 47 L50 18 L45 47 L36 22 L37 49 Z" />
          <rect x="30" y="61" width="40" height="7" rx="2.5" />
          {[[22, 27], [36, 19], [50, 14], [64, 19], [78, 27]].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="4.6" />
          ))}
          {BASE}
          <path d="M36 56 h28" fill="none" stroke={p.detail} strokeWidth="2" opacity="0.6" />
        </>
      );
    case 'k':
      return (
        <>
          <path d="M33 68 L67 68 L72 80 L28 80 Z" />
          <path d="M50 35 C42 27 26 28 26 41 C26 51 35 56 36 62 L64 62 C65 56 74 51 74 41 C74 28 58 27 50 35 Z" />
          <rect x="31" y="61" width="38" height="7" rx="2.5" />
          <path d="M50 35 L50 60" fill="none" stroke={p.detail} strokeWidth="2" opacity="0.55" />
          <rect x="46.5" y="6" width="7" height="22" rx="2" />
          <rect x="40" y="11.5" width="20" height="7" rx="2" />
          {BASE}
          <path d="M31 39 C32 34 36 32 41 32" fill="none" stroke={p.rim} strokeWidth="2" opacity="0.85" />
        </>
      );
  }
}

const TYPES: PieceSymbol[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const COLORS: Color[] = ['w', 'b'];

export const pieceHref = (color: Color, type: PieceSymbol) => `#cc-${color}${type}`;

export const PieceSprite = memo(function PieceSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <linearGradient id="cc-fill-w" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#eef2fa" />
          <stop offset="1" stopColor="#bcc6da" />
        </linearGradient>
        <linearGradient id="cc-fill-b" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#5a6378" />
          <stop offset="0.4" stopColor="#2b3141" />
          <stop offset="1" stopColor="#0f121a" />
        </linearGradient>
        {COLORS.map((c) =>
          TYPES.map((t) => {
            const p = PALETTE[c];
            return (
              <symbol key={c + t} id={`cc-${c}${t}`} viewBox="0 0 100 100">
                <g fill={p.fill} stroke={p.stroke} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
                  {shapes(t, p)}
                </g>
              </symbol>
            );
          }),
        )}
      </defs>
    </svg>
  );
});

/** Inline piece glyph for UI (captured pieces, promotion picker, avatars). */
export function PieceGlyph({ color, type, size = 20, className }: { color: Color; type: PieceSymbol; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <use href={pieceHref(color, type)} />
    </svg>
  );
}
