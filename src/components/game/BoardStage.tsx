import { useCallback, useMemo, useRef } from 'react';
import { Chess } from 'chess.js';
import { useShallow } from 'zustand/react/shallow';
import type { BoardArrow } from '@/components/board/ArrowsLayer';
import { Chessboard, type BadgeSpec } from '@/components/board/Chessboard';
import { BotAvatar } from '@/components/bots/BotAvatar';
import { SpeechBubble } from '@/components/bots/SpeechBubble';
import { EvalBar } from '@/components/eval/EvalBar';
import { RetryBanner } from '@/components/review/RetryBanner';
import { PlayerCard } from '@/components/sidebar/PlayerCard';
import { analysisService } from '@/engine/analysisService';
import { useElementSize } from '@/hooks/useElementSize';
import { BOTS } from '@/bots/personalities';
import { materialSummary } from '@/lib/chess/material';
import { findKing, placementFromFen, turnFromFen } from '@/lib/chess/squares';
import type { Color, MoveIntent, Premove, Square } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import type { MoveClass } from '@/lib/classification';
import { fenAtPly, selectIsLive, selectViewFen, useGameStore } from '@/store/gameStore';
import { useSettings } from '@/store/settingsStore';

const CARD_H = 56;
const GAP = 12;
const EVAL_W = 30;
const FRAME_PAD = 20; // board frame padding × 2
// Stable identity: a fresh [] per render would re-derive the board placement every render.
const NO_PREMOVES: readonly Premove[] = [];
/** Moves that don't warrant "best vs played" arrows. */
const SOUND: ReadonlySet<MoveClass> = new Set(['brilliant', 'great', 'best', 'book']);

const arrowKind = (cls: MoveClass): BoardArrow['kind'] =>
  cls === 'blunder' || cls === 'mistake' || cls === 'miss' ? 'played-blunder' : cls === 'inaccuracy' ? 'played-inaccuracy' : 'played';

const uciSquares = (uci: string) => ({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square });

/** Centre column: opponent card, [eval bar | board], player card. */
export function BoardStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(containerRef);

  const game = useGameStore(
    useShallow((s) => ({
      viewFen: selectViewFen(s),
      isLive: selectIsLive(s),
      orientation: s.orientation,
      playerSide: s.playerSide,
      opponent: s.opponent,
      botId: s.botId,
      playing: s.status.state === 'playing',
      lastRecord: s.moves[s.viewPly - 1],
      annotation: s.annotations[s.viewPly],
      viewPly: s.viewPly,
      premoves: s.premoves,
      evaluation: s.evaluation,
      fx: s.fx,
      clock: s.clock,
      sidebarTab: s.sidebarTab,
      retry: s.retry,
      retryFen: s.retry ? fenAtPly(s, s.retry.ply - 1) : null,
      retryPrevMove: s.retry ? s.moves[s.retry.ply - 2] : undefined,
      retryBest: s.retry ? s.positionEvals[s.retry.ply - 1]?.bestMove : undefined,
    })),
  );
  const { playMove, queuePremove, clearPremoves } = useGameStore.getState();
  const { showCoordinates, showLegalMoves, premovesEnabled } = useSettings(
    useShallow((s) => ({ showCoordinates: s.showCoordinates, showLegalMoves: s.showLegalMoves, premovesEnabled: s.premovesEnabled })),
  );

  const retry = game.retry;
  const fen = retry ? (retry.attempt?.fen ?? game.retryFen!) : game.viewFen;
  const turn = turnFromFen(fen);
  const placement = useMemo(() => placementFromFen(fen), [fen]);
  const material = useMemo(() => materialSummary(placement), [placement]);

  // Legal moves + check state for the displayed position.
  const { legalMoves, checkSquare } = useMemo(() => {
    const chess = new Chess(fen);
    const map = new Map<Square, Set<Square>>();
    for (const m of chess.moves({ verbose: true })) {
      let set = map.get(m.from);
      if (!set) map.set(m.from, (set = new Set()));
      set.add(m.to);
    }
    return { legalMoves: map, checkSquare: chess.inCheck() ? findKing(placement, chess.turn()) : null };
  }, [fen, placement]);

  // Who may interact right now.
  let movableColor: Color | null;
  let premoveColor: Color | null = null;
  if (retry) {
    movableColor = retry.status === 'trying' && !retry.attempt ? retry.mover : null;
  } else {
    const canInteract = game.isLive && game.playing;
    movableColor = !canInteract ? null : game.playerSide === 'both' ? turn : turn === game.playerSide ? game.playerSide : null;
    premoveColor = canInteract && premovesEnabled && game.playerSide !== 'both' && turn !== game.playerSide ? game.playerSide : null;
  }

  const onMove = useCallback(
    (intent: MoveIntent) => (useGameStore.getState().retry ? analysisService.attemptRetry(intent) : playMove(intent).ok),
    [playMove],
  );

  // Last-move highlight.
  const lastUci = retry ? (retry.attempt?.uci ?? game.retryPrevMove?.lan) : game.lastRecord?.lan;
  const lastMove = useMemo(() => (lastUci ? uciSquares(lastUci) : null), [lastUci]);

  // Classification badge.
  let badge: BadgeSpec | null = null;
  if (retry) {
    if (retry.attempt?.classification) badge = { key: `retry:${retry.attempt.key}`, square: retry.attempt.to, classification: retry.attempt.classification };
  } else if (game.annotation && game.lastRecord) {
    badge = { key: `${game.viewPly}:${game.annotation.classification}`, square: game.lastRecord.to, classification: game.annotation.classification };
  }

  // Best-move vs played-move arrows (history view, review tab or retry reveal).
  const a = game.annotation;
  const showReviewArrows = !retry && (!game.isLive || game.sidebarTab === 'review') && !!a?.bestMove && !!a.playedMove && a.bestMove !== a.playedMove && !SOUND.has(a.classification);
  const arrowKey = retry ? `${retry.status}:${game.retryBest}` : showReviewArrows ? `${a!.bestMove}:${a!.playedMove}:${a!.classification}` : '';
  const arrows = useMemo<BoardArrow[]>(() => {
    if (retry) return (retry.status === 'revealed' || retry.status === 'solved') && game.retryBest ? [{ ...uciSquares(game.retryBest), kind: 'best' }] : [];
    if (!showReviewArrows) return [];
    return [
      { ...uciSquares(a!.playedMove!), kind: arrowKind(a!.classification) },
      { ...uciSquares(a!.bestMove!), kind: 'best' },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arrowKey captures every input
  }, [arrowKey]);

  // Largest board that fits, snapped to a multiple of 8 px.
  const raw = Math.min(width - EVAL_W - GAP - FRAME_PAD, height - 2 * (CARD_H + GAP) - FRAME_PAD);
  const size = Math.max(0, Math.floor(raw / 8) * 8);

  const top = opposite(game.orientation);
  const bottom = game.orientation;
  const isBot = (c: Color) => game.opponent === 'bot' && game.playerSide !== 'both' && c !== game.playerSide;
  const card = (c: Color, placementHint: 'below' | 'above') => {
    const bot = isBot(c) ? BOTS[game.botId] : null;
    const label =
      game.playerSide === 'both'
        ? { name: c === 'w' ? 'White' : 'Black', subtitle: 'Pass & Play' }
        : bot
          ? { name: bot.name, subtitle: `${bot.title} · ${bot.elo}` }
          : { name: 'You', subtitle: c === 'w' ? 'White' : 'Black' };
    return (
      <PlayerCard
        color={c}
        {...label}
        toMove={turn === c && game.playing && !retry}
        material={material}
        clock={game.clock}
        avatar={bot ? <BotAvatar id={bot.id} size={44} /> : undefined}
        overlay={bot ? <SpeechBubble placement={placementHint} /> : undefined}
      />
    );
  };

  return (
    <div ref={containerRef} className="flex h-full w-full min-w-0 items-center justify-center">
      {size > 0 && (
        <div className="flex flex-col" style={{ gap: GAP, width: size + FRAME_PAD + EVAL_W + GAP }}>
          <div className="relative z-30" style={{ paddingLeft: EVAL_W + GAP, height: CARD_H }}>
            {retry ? <RetryBanner /> : card(top, 'below')}
          </div>
          <div className="flex items-center" style={{ gap: GAP }}>
            <EvalBar evaluation={game.evaluation} orientation={game.orientation} height={size + FRAME_PAD} width={EVAL_W} />
            <Chessboard
              fen={fen}
              size={size}
              orientation={game.orientation}
              movableColor={movableColor}
              premoveColor={premoveColor}
              legalMoves={legalMoves}
              lastMove={lastMove}
              checkSquare={checkSquare}
              premoves={game.isLive && !retry ? game.premoves : NO_PREMOVES}
              badge={badge}
              fx={retry ? null : game.fx}
              arrows={arrows}
              showCoordinates={showCoordinates}
              showLegalMoves={showLegalMoves}
              onMove={onMove}
              onPremove={queuePremove}
              onCancelPremoves={clearPremoves}
            />
          </div>
          <div className="relative z-30" style={{ paddingLeft: EVAL_W + GAP }}>
            {card(bottom, 'above')}
          </div>
        </div>
      )}
    </div>
  );
}
