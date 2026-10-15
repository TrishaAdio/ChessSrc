# CrystalChess

A Windows 10/11 desktop chess client with a glassmorphism look and spring-physics animation.
Built with Tauri 2, React 19, TypeScript, Vite 8, Tailwind 4, Framer Motion and chess.js.

**Status:** Phases 1–3 are done: architecture; glass shell, board and animation engine; Stockfish analysis, move classification, opening book, AI personalities and game review.

## Run

Prerequisites on Windows: Node 20.19+ or 22.12+, the Rust stable toolchain (MSVC), and WebView2. WebView2 ships with Windows 11; the installer bootstraps it on Windows 10.

```bash
npm install
npm run tauri:dev     # native frameless window with Mica/Acrylic
npm run dev           # browser-only UI at http://localhost:1420
npm run tauri:build   # NSIS + MSI installers
```

Dev-only tools: **Design Lab** (`Ctrl+Shift+L`, or the title-bar button) and `window.__cc` (the game store).

Shortcuts: `←`/`→` step through moves, `Home`/`End` jump to start/end, `F` flips the board, `Ctrl+Z` takes back, `Esc` cancels the selection, right-click cancels premoves.

## Folder structure

```
crystalchess/
├─ index.html                     transparent body, so the OS material shows through
├─ vite.config.ts                 Tauri dev port 1420, ES workers (Stockfish, Phase 3)
├─ src-tauri/
│  ├─ tauri.conf.json             frameless, transparent, shadowed, starts hidden, CSP allows WASM
│  ├─ capabilities/default.json   window-control + window-state permissions
│  └─ src/lib.rs                  Mica → Acrylic → Blur fallback, `get_backdrop` command
└─ src/
   ├─ app/                        App shell: TitleBar, NavRail, layout
   ├─ components/
   │  ├─ background/              AmbientBackground (tension-driven mesh gradient)
   │  ├─ board/                   Chessboard, Piece, PieceSprite, layers, MoveBadge,
   │  │                           PromotionPicker, ImpactLayer (shockwaves)
   │  ├─ eval/                    EvalBar (liquid glass)
   │  ├─ game/                    BoardStage: store ↔ board/eval/player cards
   │  ├─ sidebar/                 MoveList, OpeningTicker, PlayerCard, ClockFace, GameControls
   │  ├─ dialogs/                 NewGameSheet
   │  ├─ glass/                   GlassPanel/Button/IconButton, icon set
   │  └─ dev/                     DesignLab (DEV only)
   ├─ hooks/                      clock watcher, sparring partner, shortcuts, tension, sizing
   ├─ lib/
   │  ├─ chess/                   squares, pieceDiff (identity tracking), premove geometry,
   │  │                           material, evaluation (win-chance mapping)
   │  ├─ motion/springs.ts        every spring preset in the app
   │  ├─ audio/soundBus.ts        spatial Web Audio synth + sample override hooks
   │  ├─ platform/window.ts        Tauri window/backdrop bridge (browser-safe)
   │  └─ classification.ts        move classes, badge metadata, eval-loss thresholds
   ├─ store/                      gameStore (zustand + chess.js), clock, timeControls, settings
   ├─ engine/                     EngineController (UCI job queue), analysisService (live eval,
   │                              classification, review, retry), classifier, winProbability,
   │                              sacrifice (SEE), accuracy (CAPS-style), book/ (ECO, 7,982 positions)
   ├─ bots/                       5 personalities, botBrain (book → oversight → MultiPV softmax), banter
   ├─ components/review/          ReviewPanel, EvalGraph, RetryBanner
   └─ net/                        ← Phase 4: socket client, clock sync, matchmaking
public/engine/                    Stockfish 19 lite builds (multi-threaded + single-threaded)
scripts/                          vendor-engine.mjs, build-eco.mjs
server/                           ← Phase 4: Socket.io rooms, matchmaking, authoritative clocks
```

## Engine & analysis

- **Stockfish 19 lite (WASM)** runs in Web Workers: one worker for analysis, one for bots. The page is cross-origin isolated (COOP/COEP, set in `vite.config.ts` and in `tauri.conf.json` under `app.security.headers`), so the multi-threaded build is used. Without isolation the app falls back to the single-threaded build, and it does the same if the threaded build fails to start. A crashed worker is respawned and its search retried once.
- **Live analysis:** the viewed position is searched to depth 16 with MultiPV 3, and the eval bar updates at every completed depth. Scrubbing through history or playing fast cancels searches that are no longer needed. When the engine is idle, missing positions are filled in at depth 14.
- **Classification** (`engine/classifier.ts`) works in win probability, not raw centipawns: W(cp) = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1). Book moves still have to pass an engine sanity check, because the ECO data includes trap lines such as Fool's Mate. Brilliant requires a real sacrifice, detected by static exchange evaluation (SEE) over legal captures only. Great requires being the only good move. Miss means failing to punish the opponent's mistake or blunder. Losing a forced mate is a Blunder, unless the position stays crushing (win chance ≥ 90%), in which case it's a Miss.
- **Accuracy** follows the CAPS/Lichess approach: a per-move accuracy curve, weighted by how volatile the position was, combined with a harmonic mean.
- **Rebuild data:** `node scripts/vendor-engine.mjs` refreshes `public/engine/`; `node scripts/build-eco.mjs` regenerates the opening book.

## Licensing

- **Stockfish is GPL-3.0** (`public/engine/COPYING.txt`). Shipping it inside the installer means meeting GPL obligations for that distribution, such as offering the corresponding source. Get legal review before a commercial release.
- **Opening data** comes from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) and is CC0 (public domain).

## Integration points for later phases

| Store API | Used by |
| --- | --- |
| `setEvaluation` / `setPositionEval` / `setAnnotation` | Written by `analysisService`; read by the eval bar, badges, graph and ambient mood |
| `analysisService.getBotEngine()` | Phase 4: server-side or rated bots can reuse the bot worker |
| `playMove(intent)` | Phase 4 network: remote moves; also flushes queued premoves |
| `pressClock(...)` in `store/clock.ts` | Phase 4: swap in server-stamped, lag-compensated timestamps |
| `soundBus.registerSample(kind, url)` | Replace synth voices with recorded audio |

## Notes

- With `decorations: false`, Windows 11 keeps its rounded corners and shadow, but Snap Layouts no longer appear when you hover the maximize button.
- Acrylic on Windows 10 can lag while the window is resized or dragged (a known DWM limitation). Windows 11 uses Mica.
