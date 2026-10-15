import { memo, useMemo, useRef, useState, type PointerEvent } from 'react';
import { motion } from 'framer-motion';
import { formatEval, whiteShare, type Evaluation } from '@/lib/chess/evaluation';
import { CLASS_META, type MoveAnnotation, type MoveClass } from '@/lib/classification';
import { SPRINGS } from '@/lib/motion/springs';
import type { MoveRecord } from '@/store/gameStore';

const W = 320;
const H = 112;
const MARKED: ReadonlySet<MoveClass> = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);

interface EvalGraphProps {
  /** Evaluation per position, index = ply (0 = start); null = not analysed yet. */
  evals: readonly (Evaluation | null)[];
  moves: readonly MoveRecord[];
  annotations: Record<number, MoveAnnotation>;
  viewPly: number;
  onSelect(ply: number): void;
}

/** Monotone cubic (Fritsch–Carlson) through points, so the curve never overshoots the data. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]!.x} ${pts[0]!.y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x);
    slope.push((pts[i + 1]!.y - pts[i]!.y) / dx[i]!);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${p.x + h} ${p.y + m[i]! * h} ${q.x - h} ${q.y - m[i + 1]! * h} ${q.x} ${q.y}`;
  }
  return d;
}

/**
 * Interactive evaluation area chart. White's share fills from the bottom, the
 * curve is a monotone cubic, and critical moves get coloured markers.
 * Click or drag anywhere to jump the board to that ply.
 */
export const EvalGraph = memo(function EvalGraph({ evals, moves, annotations, viewPly, onSelect }: EvalGraphProps) {
  const n = Math.max(1, evals.length - 1);
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => {
    let last = 0.5;
    return evals.map((e, i) => {
      const share = e ? whiteShare(e) : last;
      last = share;
      return { x: (i / n) * W, y: (1 - share) * H };
    });
  }, [evals, n]);

  const curve = useMemo(() => monotonePath(pts), [pts]);
  const area = `${curve} L${W} ${H} L0 ${H} Z`;

  const plyAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)));
  };

  const hp = hover ?? viewPly;
  const hoverEval = evals[hp];
  const hoverMove = moves[hp - 1];

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[120px] w-full cursor-crosshair overflow-visible rounded-2xl"
        role="img"
        aria-label="Evaluation graph"
        data-testid="eval-graph"
        onPointerMove={(e) => setHover(plyAt(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSelect(plyAt(e));
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        <defs>
          <linearGradient id="cc-graph-white" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgb(255 255 255)" stopOpacity="0.95" />
            <stop offset="1" stopColor="rgb(205 216 240)" stopOpacity="0.85" />
          </linearGradient>
          <clipPath id="cc-graph-clip">
            <rect width={W} height={H} rx="14" />
          </clipPath>
        </defs>
        <g clipPath="url(#cc-graph-clip)">
          <rect width={W} height={H} fill="rgb(14 18 30 / 0.75)" />
          <path d={area} fill="url(#cc-graph-white)" />
          <path d={curve} fill="none" stroke="rgb(111 211 255 / 0.9)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgb(125 211 252 / 0.45)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={pts[hover]!.x} x2={pts[hover]!.x} y1="0" y2={H} stroke="rgb(255 255 255 / 0.35)" vectorEffect="non-scaling-stroke" />}
          <motion.line
            initial={false}
            animate={{ x1: pts[viewPly]?.x ?? 0, x2: pts[viewPly]?.x ?? 0 }}
            transition={SPRINGS.snappy}
            y1="0"
            y2={H}
            stroke="rgb(67 227 176 / 0.95)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
      {/* Markers are HTML so they stay round despite the non-uniform SVG scaling. */}
      <div className="pointer-events-none absolute inset-0">
        {moves.map((m, i) => {
          const cls = annotations[i + 1]?.classification;
          if (!cls || !MARKED.has(cls)) return null;
          const p = pts[i + 1]!;
          return (
            <motion.span
              key={`${m.ply}:${cls}`}
              data-marker={cls}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={SPRINGS.pop}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#0b1022]"
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, background: CLASS_META[cls].color, boxShadow: `0 0 8px ${CLASS_META[cls].glow}` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink-dim">
        <span>{hp === 0 ? 'Start' : hoverMove ? `${Math.ceil(hp / 2)}${hoverMove.color === 'w' ? '.' : '…'} ${hoverMove.san}` : ''}</span>
        <span className="tabular font-semibold text-ink">{hoverEval ? formatEval(hoverEval) : '…'}</span>
      </div>
    </div>
  );
});
