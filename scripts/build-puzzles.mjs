#!/usr/bin/env node
// Builds src/puzzles/puzzle-data.json from the Lichess puzzle database (CC0-1.0).
// Only a ranged slice of the (very large) compressed CSV is fetched, then every
// candidate is replayed through chess.js so the shipped bank is known-valid.
// Usage: node scripts/build-puzzles.mjs [--bytes 28000000] [--per-bucket 22]
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createZstdDecompress } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'scripts', '.cache');
const outFile = join(root, 'src', 'puzzles', 'puzzle-data.json');
const SOURCE = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const BYTES = arg('bytes', 28_000_000);
const PER_BUCKET = arg('per-bucket', 22);

/** Rating tiers: [label, min, max] */
const TIERS = [
  ['starter', 0, 900],
  ['easy', 900, 1300],
  ['club', 1300, 1700],
  ['strong', 1700, 2100],
  ['expert', 2100, 2400],
  ['master', 2400, 9999],
];

/** Themes we curate for, in priority order. A puzzle is filed under its rarest matching theme. */
const THEMES = [
  'attraction',
  'sacrifice',
  'quietMove',
  'interference',
  'deflection',
  'xRayAttack',
  'zugzwang',
  'smotheredMate',
  'bodenMate',
  'anastasiaMate',
  'doubleCheck',
  'skewer',
  'backRankMate',
  'discoveredAttack',
  'trappedPiece',
  'pin',
  'fork',
  'hangingPiece',
  'mateIn2',
  'mateIn1',
];
const THEME_SET = new Set(THEMES);
/** Themes that describe the puzzle rather than the tactic; never used as the primary label. */
const SKIP_PRIMARY = new Set(['mateIn1']);

const csvPath = join(cache, 'puzzles.csv');
mkdirSync(cache, { recursive: true });

if (!existsSync(csvPath)) {
  console.log(`Fetching first ${(BYTES / 1e6).toFixed(0)} MB of ${SOURCE} …`);
  const res = await fetch(SOURCE, { headers: { Range: `bytes=0-${BYTES - 1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`download failed: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  // The file opens with a zstd skippable frame (magic 0x184D2A5x); Node's
  // decoder stops dead on it, so start at the first real frame (0x28B52FFD).
  const offset = raw.subarray(0, 4096).indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  if (offset < 0) throw new Error('no zstd frame found in the downloaded slice');
  if (offset > 0) console.log(`skipping ${offset}-byte leading frame`);

  // The slice stops mid-frame, so a trailing decoder error is expected and the
  // output produced up to that point is exactly what we want to keep.
  await new Promise((resolve, reject) => {
    const sink = createWriteStream(csvPath);
    const dec = createZstdDecompress();
    let bytes = 0;
    dec.on('data', (c) => {
      bytes += c.length;
      sink.write(c);
    });
    dec.on('error', () => {});
    dec.on('close', () => {
      sink.end();
      bytes > 0 ? resolve() : reject(new Error('decompressed nothing'));
    });
    dec.end(raw.subarray(offset));
  });
}
console.log(`CSV cache: ${(readFileSync(csvPath).length / 1e6).toFixed(1)} MB`);

/** buckets.get(`${tier}:${theme}`) = candidates */
const buckets = new Map();
let seen = 0;
let valid = 0;

const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || line.startsWith('PuzzleId')) continue;
  const f = line.split(',');
  if (f.length < 8) continue;
  const [id, fen, movesRaw, ratingRaw, , popularityRaw, playsRaw, themesRaw] = f;
  seen++;
  const rating = Number(ratingRaw);
  const popularity = Number(popularityRaw);
  const plays = Number(playsRaw);
  if (!Number.isFinite(rating) || popularity < 85 || plays < 400) continue;

  const moves = movesRaw.trim().split(' ');
  // Need the opponent's setup move plus at least one solution ply.
  if (moves.length < 2 || moves.length > 8) continue;

  const themes = themesRaw.trim().split(' ');
  const matching = THEMES.filter((t) => themes.includes(t));
  const primary = matching.find((t) => !SKIP_PRIMARY.has(t)) ?? matching[0];
  if (!primary || !THEME_SET.has(primary)) continue;

  const tier = TIERS.find(([, lo, hi]) => rating >= lo && rating < hi);
  if (!tier) continue;

  // Replay to guarantee the data is sound before we ship it.
  const chess = new Chess();
  try {
    chess.load(fen);
  } catch {
    continue;
  }
  let ok = true;
  const sans = [];
  for (const uci of moves) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      sans.push(m.san);
    } catch {
      ok = false;
      break;
    }
  }
  if (!ok) continue;
  // Solution plies must alternate starting with the solver, so the count must be even.
  if (moves.length % 2 !== 0) continue;
  valid++;

  const key = `${tier[0]}:${primary}`;
  const list = buckets.get(key) ?? [];
  list.push({ id, fen, moves, rating, themes: matching, popularity, plays, sans });
  buckets.set(key, list);
}

// Pick the most-played puzzles from each bucket for a broad, high-quality spread.
const picked = [];
for (const [, lo, hi] of TIERS) {
  void lo;
  void hi;
}
for (const tier of TIERS) {
  for (const theme of THEMES) {
    const list = buckets.get(`${tier[0]}:${theme}`);
    if (!list) continue;
    list.sort((a, b) => b.plays - a.plays);
    picked.push(...list.slice(0, PER_BUCKET));
  }
}
picked.sort((a, b) => a.rating - b.rating);

const themeIndex = new Map(THEMES.map((t, i) => [t, i]));
const data = {
  source: 'lichess.org puzzle database (CC0-1.0)',
  generated: new Date().toISOString().slice(0, 10),
  themes: THEMES,
  tiers: TIERS.map(([label, lo, hi]) => [label, lo, hi]),
  // [id, fen, "uci uci …", rating, [themeIdx…]]
  puzzles: picked.map((p) => [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.map((t) => themeIndex.get(t))]),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data));

const byTier = TIERS.map(([label, lo, hi]) => `${label} ${picked.filter((p) => p.rating >= lo && p.rating < hi).length}`).join(', ');
console.log(`scanned ${seen} rows, ${valid} valid candidates`);
console.log(`shipped ${picked.length} puzzles (${byTier})`);
console.log(`rating range ${picked[0]?.rating}–${picked.at(-1)?.rating} → ${outFile}`);
