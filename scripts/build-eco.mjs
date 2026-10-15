#!/usr/bin/env node
// Builds src/engine/book/eco-data.json from the lichess-org/chess-openings dataset (CC0-1.0).
// Every position along every named line is "book". Positions are keyed by EPD, so
// transpositions resolve to the same entry.
// Usage: node scripts/build-eco.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'scripts', '.cache');
const outFile = join(root, 'src', 'engine', 'book', 'eco-data.json');
const SOURCE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

mkdirSync(cache, { recursive: true });
const rows = [];
for (const vol of ['a', 'b', 'c', 'd', 'e']) {
  const file = join(cache, `${vol}.tsv`);
  if (!existsSync(file)) {
    const res = await fetch(`${SOURCE}/${vol}.tsv`);
    if (!res.ok) throw new Error(`Download failed for ${vol}.tsv: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  const lines = readFileSync(file, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    if (eco && name && pgn) rows.push({ eco, name, pgn });
  }
}

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const openings = [];
/** epd -> { named: index | -1, namedPlies, lines } */
const positions = new Map();

for (const row of rows) {
  const chess = new Chess();
  const sans = row.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
  const keys = [];
  try {
    for (const san of sans) {
      chess.move(san);
      keys.push(epd(chess.fen()));
    }
  } catch {
    console.warn(`Skipping unparsable line: ${row.eco} ${row.name}`);
    continue;
  }
  const idx = openings.push([row.eco, row.name]) - 1;
  keys.forEach((k, i) => {
    const entry = positions.get(k) ?? { named: -1, namedPlies: Infinity, lines: 0 };
    entry.lines += 1;
    // The line ending here names the position; on transpositions keep the shortest line.
    if (i === keys.length - 1 && sans.length < entry.namedPlies) {
      entry.named = idx;
      entry.namedPlies = sans.length;
    }
    positions.set(k, entry);
  });
}

// Compact: positions as [epd, openingIndex, lineCount] tuples.
const data = {
  source: 'lichess-org/chess-openings (CC0-1.0)',
  openings,
  positions: [...positions].map(([k, v]) => [k, v.named, v.lines]),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(data));
console.log(`ECO book: ${openings.length} named lines, ${positions.size} book positions → ${outFile}`);
