import { fileOf } from '@/lib/chess/squares';
import type { Square } from '@/lib/chess/types';

export type SoundKind =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'promote'
  | 'premove'
  | 'illegal'
  | 'blunder'
  | 'brilliant'
  | 'lowTime'
  | 'gameStart'
  | 'gameEnd';

export interface PlayOptions {
  /** Pans the sound across the stereo field based on the square's file. */
  square?: Square;
  /** 0..1 multiplier on top of master volume. */
  gain?: number;
}

type Listener = (kind: SoundKind, opts: PlayOptions) => void;

/**
 * Spatial sound bus. Every gameplay event goes through `soundBus.play(...)`.
 * Sounds are synthesised with the Web Audio API, so the app works without
 * shipping audio assets. Call `registerSample(kind, url)` to replace any synth
 * voice with a recorded sample. Panning stays the same either way.
 */
class SoundBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<SoundKind, AudioBuffer>();
  private listeners = new Set<Listener>();
  private _enabled = true;
  private _volume = 0.7;

  get enabled() {
    return this._enabled;
  }

  setEnabled(v: boolean) {
    this._enabled = v;
  }

  setVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this._volume;
  }

  /** Observe sound events (e.g. for haptics/visual metronomes or analytics). */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  async registerSample(kind: SoundKind, url: string) {
    const ctx = this.ensure();
    if (!ctx) return;
    const res = await fetch(url);
    this.samples.set(kind, await ctx.decodeAudioData(await res.arrayBuffer()));
  }

  play(kind: SoundKind, opts: PlayOptions = {}) {
    this.listeners.forEach((l) => l(kind, opts));
    if (!this._enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const out = ctx.createGain();
    out.gain.value = opts.gain ?? 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.square ? ((fileOf(opts.square) - 3.5) / 3.5) * 0.55 : 0;
    out.connect(pan).connect(this.master);

    const sample = this.samples.get(kind);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.connect(out);
      src.start();
      return;
    }
    VOICES[kind](ctx, out, ctx.currentTime + 0.005);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(comp).connect(this.ctx.destination);
    return this.ctx;
  }
}

/* ───────────────────────── synth voices ───────────────────────── */

type Voice = (ctx: AudioContext, out: AudioNode, t: number) => void;

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Exponential decay envelope (a natural, physically-shaped decay). */
function env(ctx: AudioContext, t: number, peak: number, decay: number, attack = 0.002): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** Filtered noise burst: the "wood" transient of a piece on a board. */
function knock(ctx: AudioContext, out: AudioNode, t: number, freq: number, q: number, peak: number, decay: number) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = env(ctx, t, peak, decay);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + decay + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, freq: number, peak: number, decay: number, type: OscillatorType = 'sine', glideTo?: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
  const g = env(ctx, t, peak, decay, 0.004);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

const VOICES: Record<SoundKind, Voice> = {
  move: (ctx, out, t) => {
    knock(ctx, out, t, 1900, 1.6, 0.9, 0.055);
    tone(ctx, out, t, 240, 0.35, 0.07, 'sine', 170);
  },
  capture: (ctx, out, t) => {
    knock(ctx, out, t, 1300, 1.1, 1.0, 0.09);
    knock(ctx, out, t + 0.012, 3200, 3, 0.4, 0.04);
    tone(ctx, out, t, 170, 0.5, 0.11, 'triangle', 110);
  },
  castle: (ctx, out, t) => {
    knock(ctx, out, t, 1900, 1.6, 0.8, 0.05);
    knock(ctx, out, t + 0.085, 1700, 1.6, 0.8, 0.05);
    tone(ctx, out, t + 0.085, 220, 0.3, 0.07, 'sine', 160);
  },
  check: (ctx, out, t) => {
    knock(ctx, out, t, 1900, 1.6, 0.7, 0.05);
    tone(ctx, out, t + 0.01, 880, 0.22, 0.28);
    tone(ctx, out, t + 0.06, 1320, 0.16, 0.3);
  },
  promote: (ctx, out, t) => {
    knock(ctx, out, t, 1900, 1.6, 0.7, 0.05);
    [660, 880, 1175].forEach((f, i) => tone(ctx, out, t + 0.05 + i * 0.06, f, 0.16, 0.22));
  },
  premove: (ctx, out, t) => {
    knock(ctx, out, t, 3400, 4, 0.35, 0.03);
  },
  illegal: (ctx, out, t) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(out);
    tone(ctx, lp, t, 110, 0.25, 0.12, 'square');
  },
  blunder: (ctx, out, t) => {
    tone(ctx, out, t, 523, 0.18, 0.32, 'triangle', 392);
    tone(ctx, out, t + 0.14, 311, 0.16, 0.4, 'triangle', 247);
  },
  brilliant: (ctx, out, t) => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(ctx, out, t + i * 0.045, f, 0.1, 0.5));
  },
  lowTime: (ctx, out, t) => {
    tone(ctx, out, t, 1760, 0.12, 0.06);
    tone(ctx, out, t + 0.12, 1760, 0.12, 0.06);
  },
  gameStart: (ctx, out, t) => {
    [523, 659, 784].forEach((f, i) => tone(ctx, out, t + i * 0.07, f, 0.12, 0.45));
  },
  gameEnd: (ctx, out, t) => {
    [392, 494, 587, 784].forEach((f) => tone(ctx, out, t, f, 0.1, 1.1, 'sine'));
    knock(ctx, out, t, 900, 0.8, 0.5, 0.2);
  },
};

export const soundBus = new SoundBus();
