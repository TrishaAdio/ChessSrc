export type BotId = 'nova' | 'kael' | 'vesper' | 'aegis' | 'seraph';

export interface BotStyle {
  /** Win-% bonus added to candidate lines with these traits before sampling. */
  capture: number;
  check: number;
  sacrifice: number;
  quiet: number;
}

export interface BotPersonality {
  id: BotId;
  name: string;
  elo: number;
  title: string;
  tagline: string;
  /** Avatar gradient stops + glow. */
  palette: { from: string; to: string; glow: string };
  /** Engine search profile. */
  search: {
    depth: number;
    /** Optional movetime cap (ms). */
    movetime?: number;
    multiPv: number;
    /** Softmax temperature over win% (higher = more random). */
    temperature: number;
    /** Extra depth when ≤ 10 pieces remain (endgame technique). */
    endgameDepthBonus: number;
  };
  /** Chance of a "natural oversight": a plausible-looking move picked without calculation. */
  oversightRate: number;
  /** Chance of only calculating 2 plies (misses two-move tactics). */
  shallowRate: number;
  style: BotStyle;
  book: {
    /** Follow book moves up to this ply. */
    maxPly: number;
    /** Multipliers for continuations whose opening name contains a keyword. */
    preferences: Record<string, number>;
  };
  /** Human-feeling think time range in ms (scaled down under clock pressure). */
  thinkMs: [number, number];
}

export const BOTS: Record<BotId, BotPersonality> = {
  nova: {
    id: 'nova',
    name: 'Nova',
    elo: 450,
    title: 'Beginner',
    tagline: 'Just learned how the knight moves. Mostly.',
    palette: { from: '#7dd3fc', to: '#a78bfa', glow: 'rgba(167,139,250,0.55)' },
    search: { depth: 4, multiPv: 10, temperature: 14, endgameDepthBonus: 0 },
    oversightRate: 0.24,
    shallowRate: 0.4,
    style: { capture: 6, check: 4, sacrifice: 0, quiet: 0 },
    book: { maxPly: 4, preferences: {} },
    thinkMs: [700, 2200],
  },
  kael: {
    id: 'kael',
    name: 'Kael',
    elo: 1000,
    title: 'Club Casual',
    tagline: 'Loves open games. Hates being forked.',
    palette: { from: '#34d399', to: '#22d3ee', glow: 'rgba(52,211,153,0.5)' },
    search: { depth: 6, multiPv: 6, temperature: 6.5, endgameDepthBonus: 1 },
    oversightRate: 0.07,
    shallowRate: 0.35,
    style: { capture: 2.5, check: 2, sacrifice: 0, quiet: 0 },
    book: { maxPly: 10, preferences: { Italian: 4, 'Giuoco Piano': 4, Scotch: 4, "King's Pawn": 2, 'Two Knights': 3, Sicilian: 1.5 } },
    thinkMs: [900, 2600],
  },
  vesper: {
    id: 'vesper',
    name: 'Vesper',
    elo: 1500,
    title: 'Tactician',
    tagline: 'Sharp lines, early sacrifices, no regrets.',
    palette: { from: '#fb7185', to: '#f59e0b', glow: 'rgba(251,113,133,0.55)' },
    search: { depth: 10, multiPv: 5, temperature: 3.2, endgameDepthBonus: 2 },
    oversightRate: 0.025,
    shallowRate: 0.06,
    style: { capture: 3, check: 4, sacrifice: 6, quiet: -1 },
    book: { maxPly: 14, preferences: { Gambit: 6, Attack: 3, 'Smith-Morra': 6, Evans: 6, "King's Gambit": 6, Dragon: 3, Najdorf: 2 } },
    thinkMs: [1100, 3200],
  },
  aegis: {
    id: 'aegis',
    name: 'Aegis',
    elo: 2000,
    title: 'Positional Master',
    tagline: 'Squeezes small edges until something breaks.',
    palette: { from: '#60a5fa', to: '#818cf8', glow: 'rgba(96,165,250,0.55)' },
    search: { depth: 14, movetime: 2500, multiPv: 3, temperature: 1.1, endgameDepthBonus: 5 },
    oversightRate: 0.004,
    shallowRate: 0,
    style: { capture: 0, check: 0, sacrifice: -2, quiet: 1 },
    book: { maxPly: 18, preferences: { "Queen's Gambit Declined": 5, Catalan: 5, 'Caro-Kann': 4, English: 4, 'Ruy Lopez': 3, Slav: 4, "Queen's Indian": 3 } },
    thinkMs: [1300, 3600],
  },
  seraph: {
    id: 'seraph',
    name: 'Seraph',
    elo: 2850,
    title: 'Maximum Engine',
    tagline: 'Unthrottled Stockfish. Polite about it.',
    palette: { from: '#e2e8f0', to: '#67e8f9', glow: 'rgba(103,232,249,0.65)' },
    search: { depth: 24, movetime: 1800, multiPv: 1, temperature: 0, endgameDepthBonus: 0 },
    oversightRate: 0,
    shallowRate: 0,
    style: { capture: 0, check: 0, sacrifice: 0, quiet: 0 },
    book: { maxPly: 12, preferences: {} },
    thinkMs: [600, 1800],
  },
};

export const BOT_ORDER: readonly BotId[] = ['nova', 'kael', 'vesper', 'aegis', 'seraph'];
