// The shared reverb and the mixer buses that feed it.

import type { Bus, BusOptions } from './types.ts';

/** Deterministic randomness, so the reverb sounds the same on every load. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ImpulseOptions {
  /** Seconds of silence before the reverb starts. Default 12 ms. */
  predelay?: number;
  seed?: number;
}

/**
 * Impulse response for the reverb, computed instead of loaded: noise that
 * decays exponentially (-60 dB after `seconds`) and gets darker as it goes -
 * in real halls, air and walls swallow the highs first. Left and right get
 * their own noise and slightly different predelay, which makes the room wide.
 * Energy is normalized to 1, so a bus's `reverb` is a meaningful share.
 */
export function makeImpulse(sampleRate: number, seconds = 2.6, { predelay = 0.012, seed = 7 }: ImpulseOptions = {}): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.round(sampleRate * (seconds + predelay + 0.01)));
  const rnd = mulberry32(seed);
  const channels: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const data = new Float32Array(len);
    const pre = Math.round(sampleRate * (predelay + c * 0.005));
    let lp = 0, energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const decay = Math.exp((-6.9 * t) / seconds);
      // cutoff of the lowpass falls from ~9 kHz to ~1.5 kHz
      const fc = 1500 + 7500 * Math.exp((-3 * t) / seconds);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      lp += a * ((rnd() * 2 - 1) - lp);
      const fadeIn = Math.min(1, t / 0.005);
      const v = lp * decay * fadeIn;
      data[i] = v;
      energy += data[i]! * data[i]!;
    }
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < len; i++) data[i]! *= norm;
    channels.push(data);
  }
  return [channels[0]!, channels[1]!];
}

/**
 * The reverb is shared: every bus sends its share into the same convolver.
 * One is enough for everything, and it is the most expensive node here.
 * Returns the node to send into.
 */
export function createReverb(ctx: BaseAudioContext, destination: AudioNode, seconds = 2.6): GainNode {
  const input = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.normalize = false;
  const [l, r] = makeImpulse(ctx.sampleRate, seconds);
  const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
  ir.getChannelData(0).set(l);
  ir.getChannelData(1).set(r);
  conv.buffer = ir;
  input.connect(conv);
  conv.connect(destination);
  return input;
}

/**
 * Ramp a gain from wherever it is right now. cancelAndHoldAtTime holds the
 * value where a running fade currently is; without it (older Firefox),
 * `.value` has to do.
 */
export function rampFromNow(ctx: BaseAudioContext, param: AudioParam, target: number, seconds: number): void {
  const t = ctx.currentTime;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  param.linearRampToValueAtTime(target, t + seconds);
}

/**
 * A mixer channel: level, pan, reverb share. A game's music and its sound
 * effects each get their own, so they can be faded independently.
 */
export function createBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  reverbIn: AudioNode | null,
  { gain = 1, reverb = 0.25, pan = 0 }: BusOptions = {},
): Bus {
  const input = ctx.createGain();
  input.gain.value = gain;
  const nodes: AudioNode[] = [input];
  let last: AudioNode = input;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    input.connect(p);
    nodes.push(p);
    last = p;
  }
  last.connect(destination);
  if (reverbIn && reverb > 0) {
    const send = ctx.createGain();
    send.gain.value = reverb;
    last.connect(send);
    send.connect(reverbIn);
    nodes.push(send);
  }
  const ramp = (target: number, seconds: number) => rampFromNow(ctx, input.gain, target, Math.max(0.01, seconds));
  return {
    input,
    fade: (target, seconds = 1) => ramp(target, seconds),
    set: (target) => ramp(target, 0.02),
    dispose: () => {
      ramp(0, 0.05);
      setTimeout(() => nodes.forEach((n) => n.disconnect()), 120);
    },
  };
}
