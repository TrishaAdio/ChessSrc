import type { Color } from '@/lib/chess/types';
import { opposite } from '@/lib/chess/types';
import type { TimeControl } from './timeControls';

export interface ClockState {
  initialMs: number;
  incrementMs: number;
  /** Banked time at the moment `turnStartedAt` was stamped. */
  remaining: Record<Color, number>;
  /** Side whose clock is running (null = not started / stopped). */
  active: Color | null;
  /** performance.now() timestamp the active side's turn began. */
  turnStartedAt: number | null;
}

export function createClock(tc: TimeControl): ClockState | null {
  if (tc.category === 'unlimited') return null;
  return {
    initialMs: tc.initialMs,
    incrementMs: tc.incrementMs,
    remaining: { w: tc.initialMs, b: tc.initialMs },
    active: null,
    turnStartedAt: null,
  };
}

/** Live remaining time for `color` at time `now`. */
export function remainingMs(clock: ClockState, color: Color, now = performance.now()): number {
  const banked = clock.remaining[color];
  if (clock.active !== color || clock.turnStartedAt === null) return banked;
  return Math.max(0, banked - (now - clock.turnStartedAt));
}

/**
 * Called after `mover` completes a move. The first move of the game does not
 * consume time (chess.com behaviour). After that, the mover's elapsed time is
 * charged, the Fischer increment is added and the opponent's clock starts.
 * Phase 4 replaces `now` with a server-authoritative, lag-compensated stamp.
 */
export function pressClock(clock: ClockState, mover: Color, now = performance.now()): ClockState {
  const remaining = { ...clock.remaining };
  if (clock.active === mover && clock.turnStartedAt !== null) {
    remaining[mover] = Math.max(0, remaining[mover] - (now - clock.turnStartedAt)) + clock.incrementMs;
  }
  return { ...clock, remaining, active: opposite(mover), turnStartedAt: now };
}

export function stopClock(clock: ClockState, now = performance.now()): ClockState {
  if (!clock.active) return clock;
  return {
    ...clock,
    remaining: { ...clock.remaining, [clock.active]: remainingMs(clock, clock.active, now) },
    active: null,
    turnStartedAt: null,
  };
}

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = clamped / 1000;
  if (totalSec < 20) {
    const s = Math.floor(totalSec);
    const tenths = Math.floor((clamped % 1000) / 100);
    return `0:${String(s).padStart(2, '0')}.${tenths}`;
  }
  const whole = Math.ceil(totalSec);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
