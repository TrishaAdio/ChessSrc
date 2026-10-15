export type TimeCategory = 'bullet' | 'blitz' | 'rapid' | 'unlimited';

export interface TimeControl {
  id: string;
  label: string;
  category: TimeCategory;
  initialMs: number;
  incrementMs: number;
}

const tc = (minutes: number, inc: number, category: TimeCategory): TimeControl => ({
  id: `${minutes}+${inc}`,
  label: `${minutes} + ${inc}`,
  category,
  initialMs: minutes * 60_000,
  incrementMs: inc * 1000,
});

export const TIME_CONTROLS: readonly TimeControl[] = [
  tc(1, 0, 'bullet'),
  tc(2, 1, 'bullet'),
  tc(3, 0, 'blitz'),
  tc(3, 2, 'blitz'),
  tc(5, 0, 'blitz'),
  tc(10, 0, 'rapid'),
  tc(15, 10, 'rapid'),
];

export const UNLIMITED: TimeControl = {
  id: 'unlimited',
  label: 'Unlimited',
  category: 'unlimited',
  initialMs: 0,
  incrementMs: 0,
};
