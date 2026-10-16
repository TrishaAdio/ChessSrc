/**
 * Verifies VariantBoard's move generator against known perft values and
 * against chess.js, and checks the Chess960 generator's structural rules.
 * Run: node scripts/run-ts.mjs scripts/checks/board-perft.ts
 */
import { Chess } from 'chess.js';
import { VariantBoard, idxToSquare } from '@/variants/board';
import { CHESS960_POSITIONS, CHESS960_STANDARD_ID, backRankFor, chess960Setup, idForBackRank, isValidBackRank } from '@/variants/chess960';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  ok ? pass++ : fail++;
};

/* ── 1. Standard perft against published node counts ── */
const PERFT: [string, string, number[]][] = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['promo/pins', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [name, fen, expected] of PERFT) {
  const board = new VariantBoard(fen, 'standard');
  const got = expected.map((_, i) => board.perft(i + 1));
  check(`perft ${name}`, got.join(',') === expected.join(','), `${got.join(',')} vs ${expected.join(',')}`);
}

/* ── 2. Move-by-move agreement with chess.js over a random walk ── */
function agree(seed: number, plies: number): string | null {
  let rng = seed;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const chess = new Chess();
  const board = new VariantBoard(chess.fen(), 'standard');
  for (let i = 0; i < plies; i++) {
    const mine = board.moves().map((m) => m.lan).sort();
    const theirs = chess.moves({ verbose: true }).map((m) => m.lan).sort();
    if (mine.join(' ') !== theirs.join(' ')) {
      return `ply ${i} @ ${chess.fen()}\n  mine:   ${mine.join(' ')}\n  chessjs:${theirs.join(' ')}`;
    }
    const sansMine = board.moves().map((m) => m.san).sort().join(' ');
    const sansTheirs = chess.moves({ verbose: true }).map((m) => m.san).sort().join(' ');
    if (sansMine !== sansTheirs) return `SAN mismatch ply ${i} @ ${chess.fen()}\n  mine:   ${sansMine}\n  chessjs:${sansTheirs}`;
    if (!theirs.length) break;
    const pick = chess.moves({ verbose: true })[Math.floor(rand() * theirs.length)]!;
    chess.move(pick.san);
    const applied = board.move({ from: pick.from, to: pick.to, promotion: pick.promotion });
    if (!applied) return `board rejected legal move ${pick.san} @ ${chess.fen()}`;
    if (board.fen() !== chess.fen()) return `FEN drift after ${pick.san}\n  mine:   ${board.fen()}\n  chessjs:${chess.fen()}`;
    if (chess.isGameOver()) break;
  }
  return null;
}
let walkErr: string | null = null;
for (let seed = 1; seed <= 40 && !walkErr; seed++) walkErr = agree(seed, 120);
check('random-walk agreement with chess.js (40 games × 120 plies: moves, SAN, FEN)', !walkErr, walkErr ?? '');

/* ── 3. Draw/terminal detection parity ── */
const TERMINALS: [string, string][] = [
  ['rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'checkmate'],
  ['7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate'],
  ['8/8/8/8/8/5k2/8/5K2 w - - 0 1', 'insufficient'],
  ['8/8/8/8/8/5kb2/8/5K2 w - - 0 1'.replace('kb2', 'k1b'), 'insufficient'],
];
for (const [fen, reason] of TERMINALS) {
  const out = new VariantBoard(fen, 'standard').outcome();
  check(`terminal: ${reason}`, out?.reason === reason, `${out?.reason ?? 'none'} @ ${fen}`);
}

/* ── 4. Chess960 structure ── */
let bad = 0;
const ranks = new Set<string>();
for (let id = 0; id < CHESS960_POSITIONS; id++) {
  const r = backRankFor(id);
  ranks.add(r);
  if (!isValidBackRank(r)) bad++;
}
check('all 960 back ranks are structurally legal', bad === 0, `${bad} invalid`);
check('all 960 back ranks are distinct', ranks.size === 960, `${ranks.size} unique`);
check(`id ${CHESS960_STANDARD_ID} is the standard array`, backRankFor(CHESS960_STANDARD_ID) === 'RNBQKBNR', backRankFor(CHESS960_STANDARD_ID));
check('idForBackRank round-trips', idForBackRank('RNBQKBNR') === CHESS960_STANDARD_ID);

/* ── 5. Chess960 id 518 must behave exactly like standard chess ── */
{
  const setup = chess960Setup(CHESS960_STANDARD_ID);
  const board = new VariantBoard(setup.fen, 'chess960');
  const got = [1, 2, 3].map((d) => board.perft(d)).join(',');
  check('chess960 #518 perft equals standard', got === '20,400,8902', got);
}

/* ── 6. Chess960 castling, including overlapping king/rook squares ── */
{
  // Deliberate swap case: king on f1, rook on g1 (rights: g-file and a-file).
  const fen = 'r6r/pppppppp/8/8/8/8/PPPPPPPP/R4KR1 w GAga - 0 1';
  const board = new VariantBoard(fen, 'chess960');
  const castles = board.moves().filter((m) => m.isCastle);
  const ks = castles.find((m) => m.san === 'O-O');
  let swapOk = false;
  if (ks) {
    const b2 = new VariantBoard(fen, 'chess960');
    b2.move({ from: ks.from, to: ks.to });
    swapOk = b2.pieceAt('g1')?.type === 'k' && b2.pieceAt('f1')?.type === 'r';
  }
  check('chess960 castling with overlapping squares (Kf1 + Rg1 → Kg1/Rf1)', swapOk, ks ? `${ks.san} ${ks.from}→${ks.to}` : 'no O-O generated');
}
{
  // Queenside with the rook far away: king b1, rook a1 → king c1, rook d1.
  const fen = 'r6r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w AHah - 0 1';
  const board = new VariantBoard(fen, 'chess960');
  const qs = board.moves().find((m) => m.san === 'O-O-O');
  // Dropping the king on its own rook castles.
  const b2 = new VariantBoard(fen, 'chess960');
  const castled = b2.move({ from: 'b1', to: 'a1' });
  const ok = castled?.isCastle === true && b2.pieceAt('c1')?.type === 'k' && b2.pieceAt('d1')?.type === 'r' && !b2.pieceAt('a1') && !b2.pieceAt('b1');
  check('chess960 queenside castling via king-onto-rook (Kb1 ×Ra1 → Kc1/Rd1)', ok, qs ? `lan=${qs.lan}` : 'no O-O-O');
  check('chess960 castle LAN uses king-takes-rook', qs?.lan === 'b1a1', String(qs?.lan));
  const target = board.castleTargetForRook('b1', 'a1');
  check('king-onto-rook resolves to the castling square', target === 'c1', String(target));
  // The same square reached by an ordinary king step must stay a king step.
  const b3 = new VariantBoard(fen, 'chess960');
  const step = b3.move({ from: 'b1', to: 'c1' });
  check('ambiguous Kb1→c1 resolves to the plain king move', step?.isCastle === false && b3.pieceAt('a1')?.type === 'r', `isCastle=${step?.isCastle}`);
}
{
  // Castling must be refused through an attacked square.
  // Black rook on c8 covers c1, the square the king must land on.
  const fen = '2r5/8/8/8/8/8/PP1PPPPP/RK5R w AH - 0 1';
  const board = new VariantBoard(fen, 'chess960');
  const blocked = board.moves().some((m) => m.san === 'O-O-O');
  check('chess960: no castling through an attacked square', !blocked);
}

/* ── 7. Castling rights round-trip through Shredder-FEN ── */
{
  let rtFail = '';
  for (const id of [0, 1, 42, 123, 518, 700, 959]) {
    const setup = chess960Setup(id);
    const board = new VariantBoard(setup.fen, 'chess960');
    if (board.fen() !== setup.fen) rtFail ||= `#${id}: ${board.fen()} != ${setup.fen}`;
  }
  check('Shredder-FEN castling rights round-trip', !rtFail, rtFail);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
