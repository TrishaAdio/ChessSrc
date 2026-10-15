import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, animate, motion, motionValue, useMotionValue, useReducedMotion } from 'framer-motion';
import { soundBus } from '@/lib/audio/soundBus';
import { diffPieces } from '@/lib/chess/pieceDiff';
import { applyPremoves, premoveTargets } from '@/lib/chess/premove';
import { fileOf, placementFromFen, rankOf, squareToVisual, toSquare, visualToSquare } from '@/lib/chess/squares';
import type { BoardPiece, Color, MoveIntent, Placement, Premove, Square, SquarePair } from '@/lib/chess/types';
import type { MoveClass } from '@/lib/classification';
import { SPRINGS } from '@/lib/motion/springs';
import type { BoardFx } from '@/store/gameStore';
import { CoordinatesLayer, HighlightsLayer, LegalHintsLayer, PremoveTrailsLayer, SquaresLayer, type Highlight } from './BoardLayers';
import { ArrowsLayer, type BoardArrow } from './ArrowsLayer';
import { ImpactLayer, type Shockwave } from './ImpactLayer';
import { MoveBadge } from './MoveBadge';
import { Piece, Z, type PieceMotion } from './Piece';
import { PromotionPicker } from './PromotionPicker';

export interface BadgeSpec {
  /** Changes whenever a new badge should animate in (e.g. the ply). */
  key: string | number;
  square: Square;
  classification: MoveClass;
}

export interface ChessboardProps {
  fen: string;
  /** Board edge length in px (ideally a multiple of 8 to avoid seams). */
  size: number;
  orientation: Color;
  /** Color the user may move right now (null = no live moves). */
  movableColor: Color | null;
  /** Color the user may premove (opponent to move). */
  premoveColor: Color | null;
  /** Legal destinations per origin square for `movableColor`. */
  legalMoves: ReadonlyMap<Square, ReadonlySet<Square>>;
  lastMove: SquarePair | null;
  checkSquare: Square | null;
  premoves: readonly Premove[];
  badge: BadgeSpec | null;
  fx: BoardFx | null;
  /** Analysis arrows (best vs. played). */
  arrows?: readonly BoardArrow[];
  showCoordinates?: boolean;
  showLegalMoves?: boolean;
  /** Return true if the move was accepted. */
  onMove(intent: MoveIntent): boolean;
  onPremove(intent: MoveIntent): void;
  onCancelPremoves(): void;
}

interface Press {
  pointerId: number;
  from: Square;
  pieceId: string;
  startX: number;
  startY: number;
  rect: DOMRect;
  wasSelected: boolean;
  dragging: boolean;
}

interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

const EMPTY_SET: ReadonlySet<Square> = new Set();
const NO_ARROWS: readonly BoardArrow[] = [];
const DRAG_THRESHOLD_PX = 4;

function pointToSquare(clientX: number, clientY: number, rect: DOMRect, orientation: Color): Square | null {
  const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
  const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
  return visualToSquare(col, row, orientation);
}

function withPendingPromotion(placement: Placement, p: PendingPromotion | null): Placement {
  if (!p) return placement;
  const next = new Map(placement);
  const pawn = next.get(p.from);
  if (!pawn) return placement;
  next.delete(p.from);
  next.set(p.to, pawn);
  return next;
}

/**
 * Interactive glass chessboard.
 *
 * Rendering is controlled: the board draws `fen` with queued premoves applied
 * visually. It keeps only transient UI state (selection, drag, promotion
 * picker). Pieces keep stable identities across positions (see `diffPieces`),
 * and their x/y/scale live in motion values, so every transition is a spring
 * and drags run off the React render path.
 */
export function Chessboard({
  fen,
  size,
  orientation,
  movableColor,
  premoveColor,
  legalMoves,
  lastMove,
  checkSquare,
  premoves,
  badge,
  fx,
  arrows = NO_ARROWS,
  showCoordinates = true,
  showLegalMoves = true,
  onMove,
  onPremove,
  onCancelPremoves,
}: ChessboardProps) {
  const sq = size / 8;
  const reducedMotion = useReducedMotion();
  const mode: 'move' | 'premove' | null = movableColor ? 'move' : premoveColor ? 'premove' : null;
  const interactionColor = movableColor ?? premoveColor;

  /* ── position → displayed placement ── */
  const [pending, setPending] = useState<PendingPromotion | null>(null);
  const basePlacement = useMemo(() => placementFromFen(fen), [fen]);
  const premovePlacement = useMemo(() => applyPremoves(basePlacement, premoves), [basePlacement, premoves]);
  const placement = useMemo(() => withPendingPromotion(premovePlacement, pending), [premovePlacement, pending]);

  const hints = useMemo<SquarePair[]>(() => {
    const h: SquarePair[] = [];
    if (lastMove) h.push(lastMove);
    for (const pm of premoves) h.push(pm);
    if (pending) h.push(pending);
    return h;
  }, [lastMove, premoves, pending]);

  // Derive piece identities whenever the placement changes (render-phase
  // state update, the sanctioned "adjust state on prop change" pattern).
  const [tracked, setTracked] = useState(() => ({ placement, pieces: diffPieces([], placement) }));
  let pieces = tracked.pieces;
  if (tracked.placement !== placement) {
    pieces = diffPieces(tracked.pieces, placement, hints);
    setTracked({ placement, pieces });
  }

  /* ── motion registry (one set of motion values per piece id) ── */
  const motions = useRef(new Map<string, PieceMotion>());
  const motionFor = (p: BoardPiece, x: number, y: number): PieceMotion => {
    let m = motions.current.get(p.id);
    if (!m) {
      m = { x: motionValue(x), y: motionValue(y), scale: motionValue(1), z: motionValue<number>(Z.rest) };
      motions.current.set(p.id, m);
    }
    return m;
  };
  const livePieceIds = useRef(new Set<string>());
  livePieceIds.current = new Set(pieces.map((p) => p.id));
  const pruneMotions = useCallback(() => {
    for (const id of motions.current.keys()) if (!livePieceIds.current.has(id)) motions.current.delete(id);
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  /* ── selection & targets ── */
  const [selected, setSelected] = useState<Square | null>(null);
  const selectedPiece = selected ? placement.get(selected) : undefined;
  const activeSelected = mode && selected && selectedPiece?.color === interactionColor ? selected : null;

  const targetsFor = useCallback(
    (from: Square): ReadonlySet<Square> => {
      if (mode === 'move') return legalMoves.get(from) ?? EMPTY_SET;
      if (mode === 'premove') return premoveTargets(placement, from);
      return EMPTY_SET;
    },
    [mode, legalMoves, placement],
  );
  const targets = useMemo(() => (activeSelected ? targetsFor(activeSelected) : EMPTY_SET), [activeSelected, targetsFor]);

  /* ── drag state ── */
  const press = useRef<Press | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hover, setHover] = useState<Square | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const endDrag = useCallback(() => {
    press.current = null;
    setDraggingId(null);
    setHover(null);
  }, []);

  // A dragged piece can vanish mid-drag (captured, takeback, new game).
  useEffect(() => {
    if (draggingId && !pieces.some((p) => p.id === draggingId)) endDrag();
  }, [pieces, draggingId, endDrag]);

  // Interaction revoked (game over, history view): drop transient UI state.
  useEffect(() => {
    if (!mode) {
      setSelected(null);
      setPending(null);
      endDrag();
    }
  }, [mode, endDrag]);

  /* ── committing moves ── */
  const commit = useCallback(
    (from: Square, rawTo: Square): boolean => {
      const piece = placement.get(from);
      if (!mode || !piece || piece.color !== interactionColor) return false;
      const dests = targetsFor(from);
      let to = rawTo;

      // Castling by dropping the king onto its own rook.
      if (!dests.has(to) && piece.type === 'k') {
        const target = placement.get(to);
        if (target?.type === 'r' && target.color === piece.color && rankOf(to) === rankOf(from)) {
          const castle = toSquare(fileOf(to) > fileOf(from) ? 6 : 2, rankOf(from));
          if (castle && dests.has(castle)) to = castle;
        }
      }
      if (!dests.has(to)) return false;

      const promotes = piece.type === 'p' && rankOf(to) === (piece.color === 'w' ? 7 : 0);
      if (mode === 'premove') {
        onPremove({ from, to, promotion: promotes ? 'q' : undefined });
        return true;
      }
      if (promotes) {
        setPending({ from, to, color: piece.color });
        return true;
      }
      return onMove({ from, to });
    },
    [placement, mode, interactionColor, targetsFor, onPremove, onMove],
  );

  /* ── pointer handling (one handler set on the board; pieces are inert) ── */
  const updateCursor = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = boardRef.current;
    if (!el) return;
    if (press.current?.dragging) {
      el.style.cursor = 'grabbing';
      return;
    }
    const s = pointToSquare(e.clientX, e.clientY, el.getBoundingClientRect(), orientation);
    const p = s ? placement.get(s) : undefined;
    el.style.cursor = p && mode && p.color === interactionColor ? 'grab' : s && targets.has(s) ? 'pointer' : 'default';
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    soundBus.unlock();
    if (pending) return;
    if (e.button === 2) {
      // Right click: cancel selection, drag and all premoves (chess.com convention).
      if (press.current?.dragging) endDrag();
      setSelected(null);
      onCancelPremoves();
      return;
    }
    if (e.button !== 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const square = pointToSquare(e.clientX, e.clientY, rect, orientation);
    if (!square) return;
    const piece = placement.get(square);
    const own = !!piece && !!mode && piece.color === interactionColor;

    // Click-to-move onto a destination.
    if (activeSelected && square !== activeSelected) {
      const castleViaRook = own && placement.get(activeSelected)?.type === 'k' && piece?.type === 'r';
      if (!own || castleViaRook) {
        if (commit(activeSelected, square)) {
          setSelected(null);
          return;
        }
        if (!own) {
          setSelected(null);
          return;
        }
      }
    }

    if (!own) {
      setSelected(null);
      return;
    }

    const pieceId = pieces.find((p) => p.square === square)?.id;
    if (!pieceId) return;
    press.current = {
      pointerId: e.pointerId,
      from: square,
      pieceId,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      wasSelected: activeSelected === square,
      dragging: false,
    };
    setSelected(square);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) {
      updateCursor(e);
      return;
    }
    const m = motions.current.get(p.pieceId);
    if (!m) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      m.x.stop();
      m.y.stop();
      setDraggingId(p.pieceId);
      updateCursor(e);
    }
    // 1:1 finger tracking (like iOS); board-space pixels, centred under the pointer.
    const scale = size / p.rect.width;
    m.x.set((e.clientX - p.rect.left) * scale - sq / 2);
    m.y.set((e.clientY - p.rect.top) * scale - sq / 2);
    const over = pointToSquare(e.clientX, e.clientY, p.rect, orientation);
    setHover((prev) => (prev === over ? prev : over));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endDrag();
    if (p.dragging) {
      const drop = pointToSquare(e.clientX, e.clientY, p.rect, orientation);
      if (drop && drop !== p.from && commit(p.from, drop)) setSelected(null);
      // Otherwise the piece springs home (Piece effect) and stays selected.
    } else if (p.wasSelected) {
      setSelected(null);
    }
    updateCursor(e);
  };

  const onPointerCancel = () => {
    if (press.current) endDrag();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelected(null);
      setPending(null);
      if (press.current) endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endDrag]);

  /* ── FX: camera shake + shockwave on check / mate ── */
  const shakeX = useMotionValue(0);
  const shakeY = useMotionValue(0);
  const shakeR = useMotionValue(0);
  const [waves, setWaves] = useState<Shockwave[]>([]);
  const fxId = fx?.id;

  useEffect(() => {
    if (!fx || (fx.kind !== 'check' && fx.kind !== 'checkmate') || !fx.kingSquare) return;
    const mate = fx.kind === 'checkmate';
    const king = fx.kingSquare;
    // Fire as the checking piece lands.
    const t = window.setTimeout(() => {
      if (!reducedMotion) {
        animate(shakeX, 0, { ...SPRINGS.shake, velocity: mate ? 560 : 230 });
        animate(shakeY, 0, { ...SPRINGS.shake, velocity: mate ? -320 : -80 });
        if (mate) animate(shakeR, 0, { ...SPRINGS.shake, velocity: 36 });
      }
      setWaves((w) => [...w, { id: fx.id, square: king, strength: mate ? 'mate' : 'check' }]);
    }, 170);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the one-shot fx id
  }, [fxId]);

  const removeWave = useCallback((id: number) => setWaves((w) => w.filter((x) => x.id !== id)), []);

  /* ── derived overlays ── */
  const highlights = useMemo<Highlight[]>(() => {
    const out = new Map<string, Highlight>();
    const add = (h: Highlight) => out.set(`${h.kind}:${h.square}`, h);
    if (lastMove) {
      add({ square: lastMove.from, kind: 'last' });
      add({ square: lastMove.to, kind: 'last' });
    }
    premoves.forEach((pm, i) => {
      const kind = i === 0 ? 'premove-next' : 'premove-queued';
      add({ square: pm.from, kind });
      add({ square: pm.to, kind });
    });
    if (activeSelected) add({ square: activeSelected, kind: 'selected' });
    if (draggingId && hover && hover !== activeSelected) add({ square: hover, kind: 'hover' });
    return [...out.values()];
  }, [lastMove, premoves, activeSelected, draggingId, hover]);

  const occupied = useMemo(() => new Set(placement.keys()), [placement]);
  const targetList = useMemo(() => [...targets], [targets]);

  const badgeSize = Math.max(20, Math.min(44, sq * 0.42));
  const badgePos = badge
    ? (() => {
        const { col, row } = squareToVisual(badge.square, orientation);
        return { cx: (col + 1) * sq - badgeSize * 0.3, cy: row * sq + badgeSize * 0.3 };
      })()
    : null;

  if (size <= 0) return null;

  return (
    <motion.div className="glass cc-board-frame p-[10px]" style={{ x: shakeX, y: shakeY, rotate: shakeR }}>
      <div
        ref={boardRef}
        className="relative touch-none"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        role="grid"
        aria-label="Chessboard"
      >
        <SquaresLayer />
        <HighlightsLayer highlights={highlights} orientation={orientation} size={sq} checkSquare={checkSquare} />
        {showCoordinates && <CoordinatesLayer orientation={orientation} size={sq} />}
        <PremoveTrailsLayer premoves={premoves} orientation={orientation} />
        {showLegalMoves && (
          <LegalHintsLayer
            targets={targetList}
            occupied={occupied}
            orientation={orientation}
            size={sq}
            selectionKey={activeSelected ?? ''}
          />
        )}

        <AnimatePresence onExitComplete={pruneMotions}>
          {pieces.map((p) => {
            const { col, row } = squareToVisual(p.square, orientation);
            const x = col * sq;
            const y = row * sq;
            return (
              <Piece
                key={p.id}
                piece={p}
                mv={motionFor(p, x, y)}
                x={x}
                y={y}
                size={sq}
                lifted={p.square === activeSelected}
                dragging={p.id === draggingId}
                enterDelay={mounted.current ? 0 : (7 - row) * 0.035 + col * 0.012}
              />
            );
          })}
        </AnimatePresence>

        <ArrowsLayer arrows={arrows} orientation={orientation} />
        <ImpactLayer waves={waves} orientation={orientation} size={sq} onDone={removeWave} />

        <AnimatePresence>
          {badge && badgePos && (
            <MoveBadge key={badge.key} classification={badge.classification} cx={badgePos.cx} cy={badgePos.cy} size={badgeSize} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pending && (
            <PromotionPicker
              square={pending.to}
              color={pending.color}
              orientation={orientation}
              size={sq}
              onCancel={() => setPending(null)}
              onPick={(promotion) => {
                const { from, to } = pending;
                setPending(null);
                onMove({ from, to, promotion });
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
