import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { animate, motion, useTransform, type MotionValue } from 'framer-motion';
import { DRAG_SCALE, LIFT_SCALE, SPRINGS } from '@/lib/motion/springs';
import type { BoardPiece } from '@/lib/chess/types';
import { pieceHref } from './PieceSprite';

export interface PieceMotion {
  x: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
  z: MotionValue<number>;
}

/** Stacking inside the board: impact FX = 65, badges = 70, promotion picker = 90. */
export const Z = { rest: 10, selected: 20, flying: 30, drag: 85 } as const;

interface PieceProps {
  piece: BoardPiece;
  mv: PieceMotion;
  /** Target top-left in board pixels. */
  x: number;
  y: number;
  size: number;
  lifted: boolean;
  dragging: boolean;
  enterDelay: number;
}

/**
 * One chess piece. Its position lives in motion values owned by the board, so
 * the board can drive them 1:1 with the pointer while dragging. When the
 * target square changes, the piece springs there: it lifts (1.08×), travels on
 * the spec spring (400/30/0.8) and lands with an underdamped scale snap.
 */
export const Piece = memo(function Piece({ piece, mv, x, y, size, lifted, dragging, enterDelay }: PieceProps) {
  const flying = useRef(false);
  const liftedRef = useRef(lifted);
  const lastSize = useRef(size);

  useLayoutEffect(() => {
    liftedRef.current = lifted;
  }, [lifted]);

  // Position: spring flight to the target square.
  useLayoutEffect(() => {
    if (dragging) return;
    if (lastSize.current !== size) {
      lastSize.current = size;
      mv.x.jump(x);
      mv.y.jump(y);
      return;
    }
    if (Math.abs(mv.x.get() - x) < 0.5 && Math.abs(mv.y.get() - y) < 0.5) {
      mv.x.jump(x);
      mv.y.jump(y);
      return;
    }

    let cancelled = false;
    flying.current = true;
    mv.z.set(Z.flying);
    animate(mv.scale, LIFT_SCALE, SPRINGS.lift);
    const ax = animate(mv.x, x, SPRINGS.piece);
    const ay = animate(mv.y, y, SPRINGS.piece);

    void Promise.all([ax, ay]).then(() => {
      if (cancelled) return;
      flying.current = false;
      if (liftedRef.current) {
        mv.z.set(Z.selected);
        animate(mv.scale, LIFT_SCALE, SPRINGS.lift);
      } else {
        mv.z.set(Z.rest);
        // Tactile snap: dip below 1 then settle, like a piece pressed into felt.
        animate(mv.scale, 1, { ...SPRINGS.land, velocity: -2.6 });
      }
    });

    return () => {
      cancelled = true;
      flying.current = false;
      ax.stop();
      ay.stop();
    };
  }, [x, y, size, dragging, mv]);

  // Lift / settle when selection or drag state changes (skipped mid-flight).
  useEffect(() => {
    if (dragging) {
      mv.z.set(Z.drag);
      const a = animate(mv.scale, DRAG_SCALE, SPRINGS.lift);
      return () => a.stop();
    }
    if (flying.current) return;
    mv.z.set(lifted ? Z.selected : Z.rest);
    const a = animate(mv.scale, lifted ? LIFT_SCALE : 1, lifted ? SPRINGS.lift : SPRINGS.settle);
    return () => a.stop();
  }, [lifted, dragging, mv]);

  // Contact shadow grows and drifts as the piece rises.
  const shadowOpacity = useTransform(mv.scale, [1, DRAG_SCALE], [0, 0.85]);
  const shadowY = useTransform(mv.scale, [1, DRAG_SCALE], [0, size * 0.1]);
  const shadowScale = useTransform(mv.scale, [1, DRAG_SCALE], [0.9, 1.15]);

  return (
    <motion.div
      className="cc-piece"
      style={{ x: mv.x, y: mv.y, zIndex: mv.z, width: size, height: size }}
      exit={{ opacity: 0, transition: { ...SPRINGS.fade, delay: 0.07 } }}
    >
      <motion.div className="cc-piece-shadow" style={{ opacity: shadowOpacity, y: shadowY, scale: shadowScale }} />
      <motion.div style={{ scale: mv.scale, width: '100%', height: '100%', originY: 0.62 }}>
        <motion.svg
          // Re-keying on type makes a promoting pawn "pop" into its new piece.
          key={piece.type}
          viewBox="0 0 100 100"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: { ...SPRINGS.pop, delay: enterDelay } }}
          exit={{ scale: 0.55, transition: SPRINGS.settle }}
        >
          <use href={pieceHref(piece.color, piece.type)} />
        </motion.svg>
      </motion.div>
    </motion.div>
  );
});
