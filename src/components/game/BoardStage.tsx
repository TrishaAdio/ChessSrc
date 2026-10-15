import { useCallback, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { useShallow } from 'zustand/react/shallow';
import { Chessboard, type BadgeSpec } from '@/components/board/Chessboard';
import { EvalBar } from '@/components/eval/EvalBar';
import { PlayerCard } from '@/components/sidebar/PlayerCard';
import { useElementSize } from '@/hooks/useElementSize';
import { materialSummary } from '@/lib/chess/material';
import { findKing, placementFromFen, turnFromFen } from '@/lib/chess/squares';
import type { Color, MoveIntent, Premove, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import { selectIsLive, selectViewFen, useGameStore } from '@/store/gameStore';
import { useSettings } from '@/store/settingsStore';

const CARD_H = 56;
const GAP = 12;
const EVAL_W = 30;
const FRAME_PAD = 20; // board frame padding × 2
// Stable identity: a fresh [] per render would re-derive the board placement every render.
const NO_PREMOVES: readonly Premove[] = [];

/** Center column: opponent card, [eval bar | board], player card. */
export function BoardStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(containerRef);

  const game = useGameStore(
    useShallow((s) => ({
      fen: selectViewFen(s),
      isLive: selectIsLive(s),
      orientation: s.orientation,
      playerSide: s.playerSide,
      opponent: s.opponent,
      playing: s.status.state === 'playing',
      lastMove: s.moves[s.viewPly - 1],
      annotation: s.annotations[s.viewPly],
      viewPly: s.viewPly,
      premoves: s.premoves,
      evaluation: s.evaluation,
      fx: s.fx,
      clock: s.clock,
    })),
  );
  const { playMove, queuePremove, clearPremoves } = useGameStore.getState();
  const { showCoordinates, showLegalMoves, premovesEnabled } = useSettings(
    useShallow((s) => ({ showCoordinates: s.showCoordinates, showLegalMoves: s.showLegalMoves, premovesEnabled: s.premovesEnabled })),
  );

  const turn = turnFromFen(game.fen);
  const placement = useMemo(() => placementFromFen(game.fen), [game.fen]);
  const material = useMemo(() => materialSummary(placement), [placement]);

  // Legal moves + check state for the displayed position.
  const { legalMoves, checkSquare } = useMemo(() => {
    const chess = new Chess(game.fen);
    const map = new Map<Square, Set<Square>>();
    for (const m of chess.moves({ verbose: true })) {
      let set = map.get(m.from);
      if (!set) map.set(m.from, (set = new Set()));
      set.add(m.to);
    }
    return { legalMoves: map, checkSquare: chess.inCheck() ? findKing(placement, chess.turn()) : null };
  }, [game.fen, placement]);

  // Who may interact right now.
  const canInteract = game.isLive && game.playing;
  const movableColor: Color | null = !canInteract ? null : game.playerSide === 'both' ? turn : turn === game.playerSide ? game.playerSide : null;
  const premoveColor: Color | null =
    canInteract && premovesEnabled && game.playerSide !== 'both' && turn !== game.playerSide ? game.playerSide : null;

  const onMove = useCallback((intent: MoveIntent) => playMove(intent).ok, [playMove]);
  const lastFrom = game.lastMove?.from;
  const lastTo = game.lastMove?.to;
  const lastMove = useMemo(() => (lastFrom && lastTo ? { from: lastFrom, to: lastTo } : null), [lastFrom, lastTo]);

  const badge: BadgeSpec | null =
    game.annotation && game.lastMove
      ? { key: `${game.viewPly}:${game.annotation.classification}`, square: game.lastMove.to, classification: game.annotation.classification }
      : null;

  // Largest board that fits, snapped to a multiple of 8 px.
  const raw = Math.min(width - EVAL_W - GAP - FRAME_PAD, height - 2 * (CARD_H + GAP) - FRAME_PAD);
  const size = Math.max(0, Math.floor(raw / 8) * 8);

  const top = opposite(game.orientation);
  const bottom = game.orientation;
  const label = (c: Color) => {
    if (game.playerSide === 'both') return { name: c === 'w' ? 'White' : 'Black', subtitle: 'Pass & Play' };
    if (c === game.playerSide) return { name: 'You', subtitle: c === 'w' ? 'White' : 'Black' };
    return game.opponent === 'sparring'
      ? { name: 'Sparring Partner', subtitle: 'random mover · dev' }
      : { name: c === 'w' ? 'White' : 'Black', subtitle: 'Opponent' };
  };

  return (
    <div ref={containerRef} className="flex h-full w-full min-w-0 items-center justify-center">
      {size > 0 && (
        <div className="flex flex-col" style={{ gap: GAP, width: size + FRAME_PAD + EVAL_W + GAP }}>
          <div style={{ paddingLeft: EVAL_W + GAP }}>
            <PlayerCard color={top} {...label(top)} toMove={turn === top && game.playing} material={material} clock={game.clock} />
          </div>
          <div className="flex items-center" style={{ gap: GAP }}>
            <EvalBar evaluation={game.evaluation} orientation={game.orientation} height={size + FRAME_PAD} width={EVAL_W} />
            <Chessboard
              fen={game.fen}
              size={size}
              orientation={game.orientation}
              movableColor={movableColor}
              premoveColor={premoveColor}
              legalMoves={legalMoves}
              lastMove={lastMove}
              checkSquare={checkSquare}
              premoves={game.isLive ? game.premoves : NO_PREMOVES}
              badge={badge}
              fx={game.fx}
              showCoordinates={showCoordinates}
              showLegalMoves={showLegalMoves}
              onMove={onMove}
              onPremove={queuePremove}
              onCancelPremoves={clearPremoves}
            />
          </div>
          <div style={{ paddingLeft: EVAL_W + GAP }}>
            <PlayerCard color={bottom} {...label(bottom)} toMove={turn === bottom && game.playing} material={material} clock={game.clock} />
          </div>
        </div>
      )}
    </div>
  );
}
