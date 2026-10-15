import { Chess } from 'chess.js';
import type { Evaluation } from '@/lib/chess/evaluation';
import type { Color } from '@/lib/chess/types';
import { parseBestMove, parseInfo, toWhitePov } from './uci';

export type EngineFlavor = 'lite-mt' | 'lite-single';

export interface SearchLimits {
  depth?: number;
  movetime?: number;
  nodes?: number;
}

export interface EngineOptions {
  multiPv?: number;
  skillLevel?: number;
}

export interface PvLine {
  multipv: number;
  depth: number;
  /** White-POV evaluation. */
  eval: Evaluation;
  /** Principal variation in UCI notation. */
  pv: string[];
}

export interface AnalysisSnapshot {
  fen: string;
  depth: number;
  lines: PvLine[];
  nodes: number;
  nps: number;
  timeMs: number;
}

export interface AnalysisResult extends AnalysisSnapshot {
  bestMove: string | null;
  ponder: string | null;
  /** True when the search was stopped before reaching its limits. */
  cancelled: boolean;
}

export interface AnalyzeRequest {
  fen: string;
  limits: SearchLimits;
  options?: EngineOptions;
  /**
   * Jobs on the same channel supersede each other: a new request cancels
   * older pending/running work on that channel (history scrubbing, bullet).
   */
  channel?: string;
  onInfo?: (s: AnalysisSnapshot) => void;
}

export interface AnalysisJob {
  readonly id: number;
  readonly channel: string | undefined;
  readonly result: Promise<AnalysisResult>;
  cancel(): void;
}

export interface EngineInfo {
  flavor: EngineFlavor;
  threads: number;
  name: string;
}

interface InternalJob {
  id: number;
  req: AnalyzeRequest;
  sideToMove: Color;
  cancelled: boolean;
  stopSent: boolean;
  lines: Map<number, PvLine>;
  nodes: number;
  nps: number;
  timeMs: number;
  lastEmit: number;
  lastEmitDepth: number;
  emitTimer: ReturnType<typeof setTimeout> | null;
  retries: number;
  resolve(r: AnalysisResult): void;
}

const ENGINE_BASE = `${import.meta.env.BASE_URL}engine/`;
const INIT_TIMEOUT_MS = 15_000;
const EMIT_INTERVAL_MS = 60;
const DEFAULT_HASH_MB = 32;

/** Multi-threaded WASM needs SharedArrayBuffer, which needs cross-origin isolation. */
export const canUseThreads = (): boolean =>
  typeof SharedArrayBuffer === 'function' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

let jobCounter = 0;

/**
 * One Stockfish worker behind an async, cancellable job queue.
 *
 * Protocol invariants (Stockfish misbehaves when they're violated):
 *  - Options and `position` are only sent while the engine is idle.
 *  - A running search is only interrupted with `stop`, and the next job starts
 *    after its `bestmove` arrives.
 *  - If the worker crashes, it is respawned and the running job is retried once.
 */
export class EngineController {
  private worker: Worker | null = null;
  private pending: InternalJob[] = [];
  private current: InternalJob | null = null;
  private appliedOptions = new Map<string, string>();
  private lineWaiters: { match(l: string): boolean; resolve(l: string): void }[] = [];
  private disposed = false;
  private _info: EngineInfo | null = null;
  private listeners = new Set<(status: 'ready' | 'restarting' | 'error', detail?: string) => void>();

  private constructor(
    private flavor: EngineFlavor,
    private threads: number,
    private hashMb: number,
  ) {}

  /**
   * Spawns an engine, preferring the multi-threaded build when the page is
   * cross-origin isolated and falling back to single-threaded otherwise (or on
   * init failure).
   */
  static async create(opts: { maxThreads?: number; hashMb?: number; flavor?: EngineFlavor } = {}): Promise<EngineController> {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const wantThreads = Math.max(1, Math.min(opts.maxThreads ?? 4, cores - 1));
    const preferMt = (opts.flavor ?? (canUseThreads() ? 'lite-mt' : 'lite-single')) === 'lite-mt' && canUseThreads();
    const hash = opts.hashMb ?? DEFAULT_HASH_MB;

    if (preferMt) {
      const mt = new EngineController('lite-mt', wantThreads, hash);
      try {
        await mt.boot();
        return mt;
      } catch (err) {
        console.warn('[engine] multi-threaded build failed, falling back to single-threaded', err);
        mt.terminate();
      }
    }
    const single = new EngineController('lite-single', 1, hash);
    await single.boot();
    return single;
  }

  get info(): EngineInfo | null {
    return this._info;
  }

  get busy(): boolean {
    return this.current !== null || this.pending.length > 0;
  }

  onStatus(fn: (status: 'ready' | 'restarting' | 'error', detail?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  analyze(req: AnalyzeRequest): AnalysisJob {
    if (req.channel) this.cancelChannel(req.channel);
    let resolve!: (r: AnalysisResult) => void;
    const result = new Promise<AnalysisResult>((r) => (resolve = r));
    const job: InternalJob = {
      id: ++jobCounter,
      req,
      sideToMove: req.fen.split(' ')[1] === 'b' ? 'b' : 'w',
      cancelled: false,
      stopSent: false,
      lines: new Map(),
      nodes: 0,
      nps: 0,
      timeMs: 0,
      lastEmit: 0,
      lastEmitDepth: 0,
      emitTimer: null,
      retries: 0,
      resolve,
    };

    // Terminal positions never reach the engine (it would answer `bestmove (none)`).
    const terminal = terminalEvaluation(req.fen);
    if (terminal) {
      resolve({ fen: req.fen, depth: 0, lines: [{ multipv: 1, depth: 0, eval: terminal, pv: [] }], nodes: 0, nps: 0, timeMs: 0, bestMove: null, ponder: null, cancelled: false });
    } else {
      this.pending.push(job);
      this.pump();
    }
    return { id: job.id, channel: req.channel, result, cancel: () => this.cancelJob(job) };
  }

  cancelChannel(channel: string) {
    for (const j of [...this.pending]) if (j.req.channel === channel) this.cancelJob(j);
    if (this.current?.req.channel === channel) this.cancelJob(this.current);
  }

  cancelAll() {
    for (const j of [...this.pending]) this.cancelJob(j);
    if (this.current) this.cancelJob(this.current);
  }

  /** Clears the hash table between unrelated games. */
  async newGame() {
    this.cancelAll();
    await this.waitIdle();
    this.send('ucinewgame');
    await this.ready();
  }

  terminate() {
    this.disposed = true;
    this.cancelAll();
    this.worker?.terminate();
    this.worker = null;
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private async boot() {
    const url = `${ENGINE_BASE}${this.flavor === 'lite-mt' ? 'stockfish-lite.js' : 'stockfish-lite-single.js'}`;
    const worker = new Worker(url);
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      for (const line of String(e.data).split('\n')) if (line) this.onLine(line.trim());
    };
    worker.onerror = (e) => {
      e.preventDefault();
      this.onCrash(e.message || 'worker error');
    };

    const withTimeout = <T,>(p: Promise<T>, what: string) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`engine ${what} timed out`)), INIT_TIMEOUT_MS))]);

    const nameLine = this.waitFor((l) => l.startsWith('id name'));
    this.send('uci');
    await withTimeout(this.waitFor((l) => l === 'uciok'), 'uci handshake');
    const name = (await Promise.race([nameLine, Promise.resolve('id name Stockfish')])).replace('id name ', '');
    this.appliedOptions.clear();
    if (this.flavor === 'lite-mt') this.setOption('Threads', String(this.threads));
    this.setOption('Hash', String(this.hashMb));
    this.setOption('UCI_ShowWDL', 'false');
    await withTimeout(this.ready(), 'isready');
    this._info = { flavor: this.flavor, threads: this.threads, name };
    this.listeners.forEach((l) => l('ready'));
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private setOption(name: string, value: string) {
    if (this.appliedOptions.get(name) === value) return;
    this.appliedOptions.set(name, value);
    this.send(`setoption name ${name} value ${value}`);
  }

  private ready(): Promise<string> {
    const p = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    return p;
  }

  private waitFor(match: (l: string) => boolean): Promise<string> {
    return new Promise((resolve) => this.lineWaiters.push({ match, resolve }));
  }

  private waitIdle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => (this.current ? setTimeout(check, 10) : resolve());
      check();
    });
  }

  private pump() {
    if (this.current || this.disposed || !this.worker || !this._info) return;
    let job: InternalJob | undefined;
    while ((job = this.pending.shift())) {
      if (!job.cancelled) break;
    }
    if (!job) return;

    const { options = {}, limits, fen } = job.req;
    this.setOption('MultiPV', String(Math.max(1, options.multiPv ?? 1)));
    this.setOption('Skill Level', String(options.skillLevel ?? 20));
    this.current = job;
    this.send(`position fen ${fen}`);
    const go = ['go'];
    if (limits.depth) go.push('depth', String(limits.depth));
    if (limits.movetime) go.push('movetime', String(limits.movetime));
    if (limits.nodes) go.push('nodes', String(limits.nodes));
    if (go.length === 1) go.push('depth', '16');
    this.send(go.join(' '));
  }

  private onLine(line: string) {
    for (let i = 0; i < this.lineWaiters.length; i++) {
      const w = this.lineWaiters[i]!;
      if (w.match(line)) {
        this.lineWaiters.splice(i, 1);
        w.resolve(line);
        i--;
      }
    }

    const job = this.current;
    if (!job) return;

    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (!info) return;
      job.nodes = info.nodes || job.nodes;
      job.nps = info.nps || job.nps;
      job.timeMs = info.timeMs || job.timeMs;
      if (!info.score || !info.pv.length || info.bound !== 'exact') return;
      job.lines.set(info.multipv, { multipv: info.multipv, depth: info.depth, eval: toWhitePov(info.score, job.sideToMove), pv: info.pv });
      // A completed iteration (all MultiPV lines at a new depth) is emitted at once,
      // so the eval bar visibly climbs through depths even on fast hardware.
      const want = Math.max(1, job.req.options?.multiPv ?? 1);
      const iterationDone = info.multipv === want || info.multipv === job.lines.size;
      if (iterationDone && info.depth > job.lastEmitDepth) this.emitNow(job);
      else this.scheduleEmit(job);
      return;
    }

    const best = parseBestMove(line);
    if (best) {
      this.current = null;
      if (job.emitTimer) clearTimeout(job.emitTimer);
      const snap = snapshotOf(job);
      job.resolve({ ...snap, bestMove: best.bestMove ?? snap.lines[0]?.pv[0] ?? null, ponder: best.ponder, cancelled: job.cancelled });
      this.pump();
    }
  }

  private emitNow(job: InternalJob) {
    if (!job.req.onInfo || job.cancelled) return;
    if (job.emitTimer) {
      clearTimeout(job.emitTimer);
      job.emitTimer = null;
    }
    const snap = snapshotOf(job);
    job.lastEmit = performance.now();
    job.lastEmitDepth = snap.depth;
    job.req.onInfo(snap);
  }

  private scheduleEmit(job: InternalJob) {
    if (!job.req.onInfo || job.cancelled || job.emitTimer) return;
    const wait = Math.max(0, EMIT_INTERVAL_MS - (performance.now() - job.lastEmit));
    job.emitTimer = setTimeout(() => {
      job.emitTimer = null;
      if (job.cancelled || this.current !== job) return;
      this.emitNow(job);
    }, wait);
  }

  private cancelJob(job: InternalJob) {
    if (job.cancelled) return;
    job.cancelled = true;
    const idx = this.pending.indexOf(job);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      job.resolve({ ...snapshotOf(job), bestMove: null, ponder: null, cancelled: true });
      return;
    }
    if (this.current === job && !job.stopSent) {
      job.stopSent = true;
      this.send('stop');
    }
  }

  private onCrash(detail: string) {
    if (this.disposed) return;
    console.error('[engine] worker crashed:', detail);
    this.listeners.forEach((l) => l('restarting', detail));
    const crashed = this.current;
    this.current = null;
    this.worker?.terminate();
    this.worker = null;
    this._info = null;
    this.lineWaiters = [];
    if (crashed) {
      if (!crashed.cancelled && crashed.retries < 1) {
        crashed.retries += 1;
        crashed.lines.clear();
        this.pending.unshift(crashed);
      } else {
        crashed.resolve({ ...snapshotOf(crashed), bestMove: null, ponder: null, cancelled: true });
      }
    }
    this.boot()
      .then(() => this.pump())
      .catch((err: unknown) => {
        this.listeners.forEach((l) => l('error', String(err)));
        for (const j of this.pending.splice(0)) j.resolve({ ...snapshotOf(j), bestMove: null, ponder: null, cancelled: true });
      });
  }
}

function snapshotOf(job: InternalJob): AnalysisSnapshot {
  const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
  return { fen: job.req.fen, depth: lines[0]?.depth ?? 0, lines, nodes: job.nodes, nps: job.nps, timeMs: job.timeMs };
}

/** Evaluation for positions with no legal moves (mate / stalemate), else null. */
export function terminalEvaluation(fen: string): Evaluation | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { kind: 'terminal', result: chess.turn() === 'w' ? '0-1' : '1-0' };
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { kind: 'terminal', result: '1/2-1/2' };
  return null;
}
