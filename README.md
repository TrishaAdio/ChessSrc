# CrystalChess

A Windows 10/11 desktop chess client with a glassmorphism look and spring-physics animation.
Built with Tauri 2, React 19, TypeScript, Vite 8, Tailwind 4, Framer Motion and chess.js.

**Status:** Phase 1 (architecture) and Phase 2 (glass shell, board and animation engine) are done.

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
   ├─ engine/                     ← Phase 3: Stockfish WASM worker, UCI client, classifier, book
   └─ net/                        ← Phase 4: socket client, clock sync, matchmaking
server/                           ← Phase 4: Socket.io rooms, matchmaking, authoritative clocks
```

## Integration points for later phases

| Store API | Used by |
| --- | --- |
| `setEvaluation(e)` | Phase 3 engine: drives the eval bar and ambient mood |
| `setAnnotation(ply, { classification, … })` | Phase 3 classifier: renders the badge and plays blunder/brilliant sounds |
| `setOpening({ eco, name })` | Phase 3 book: updates the opening ticker |
| `playMove(intent)` | Phase 4 network: remote moves; also flushes queued premoves |
| `pressClock(...)` in `store/clock.ts` | Phase 4: swap in server-stamped, lag-compensated timestamps |
| `soundBus.registerSample(kind, url)` | Replace synth voices with recorded audio |

## Notes

- The **Sparring Partner** is a dev-only random mover for exercising premoves and clocks. The real Stockfish personalities arrive in Phase 3.
- With `decorations: false`, Windows 11 keeps its rounded corners and shadow, but Snap Layouts no longer appear when you hover the maximize button.
- Acrylic on Windows 10 can lag while the window is resized or dragged (a known DWM limitation). Windows 11 uses Mica.
