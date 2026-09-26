// Signal processing for the sample build - deliberately plain and without
// packages.
//
// Everything works on Float32Array (mono, one fixed sample rate). Nothing here
// has to be fast, it runs once per build; readable matters more.

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-12));

/** Envelope: maximum absolute value per block of `hop` samples. */
export function envelope(x: Float32Array, hop: number): Float32Array {
  const n = Math.ceil(x.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(x.length, (i + 1) * hop);
    for (let j = i * hop; j < end; j++) {
      const a = Math.abs(x[j]!);
      if (a > m) m = a;
    }
    env[i] = m;
  }
  return env;
}

// Onset detection is shared by build and runtime - the same function, so the
// mark in the manifest and the measurement in the browser mean the same thing.
export { detectOnset } from '../../src/onset.ts';

/** Running RMS over windows of `win` samples, step `hop`. */
export function rmsFrames(x: Float32Array, win: number, hop: number): number[] {
  const out: number[] = [];
  for (let s = 0; s + win <= x.length; s += hop) {
    let acc = 0;
    for (let j = s; j < s + win; j++) acc += x[j]! * x[j]!;
    out.push(Math.sqrt(acc / win));
  }
  return out;
}

function rms(x: Float32Array, from: number, to: number): number {
  from = Math.max(0, Math.floor(from));
  to = Math.min(x.length, Math.floor(to));
  if (to <= from) return 0;
  let acc = 0;
  for (let i = from; i < to; i++) acc += x[i]! * x[i]!;
  return Math.sqrt(acc / (to - from));
}

// --- Loudness -------------------------------------------------------------
//
// Plain RMS overrates low instruments: at equal RMS, tuba and double bass
// would feel less present than an oboe. The K-weighting from ITU-R BS.1770
// (highpass at ~38 Hz plus a treble lift around 1.7 kHz) is the simplest
// curve that roughly evens this out - and only two biquads.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function biquad(x: Float32Array, { b0, b1, b2, a1, a2 }: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

function highShelf(sr: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const sa = 2 * Math.sqrt(A) * alpha;
  const a0 = (A + 1) - (A - 1) * c + sa;
  return {
    b0: A * ((A + 1) + (A - 1) * c + sa) / a0,
    b1: -2 * A * ((A - 1) + (A + 1) * c) / a0,
    b2: A * ((A + 1) + (A - 1) * c - sa) / a0,
    a1: 2 * ((A - 1) - (A + 1) * c) / a0,
    a2: ((A + 1) - (A - 1) * c - sa) / a0,
  };
}

function highPass(sr: number, f0: number, q: number): Biquad {
  const w = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    b0: (1 + c) / 2 / a0,
    b1: -(1 + c) / a0,
    b2: (1 + c) / 2 / a0,
    a1: -2 * c / a0,
    a2: (1 - alpha) / a0,
  };
}

export function kWeight(x: Float32Array, sr: number): Float32Array {
  return biquad(biquad(x, highShelf(sr, 1681.97, 4.0, 0.7072)), highPass(sr, 38.13, 0.5003));
}

/**
 * Loudness in dB (K-weighted RMS).
 *  - 'sustain': mean over the sustained part (from..to)
 *  - 'peak':    loudest 400 ms window - for hits and plucks, whose level
 *               drops at once; a mean over the decay would favour notes that
 *               ring long.
 */
export function loudness(x: Float32Array, sr: number, mode: 'sustain' | 'peak', from = 0, to = x.length): number {
  const k = kWeight(x, sr);
  if (mode === 'sustain') return gainToDb(rms(k, from, to));
  const win = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.02);
  let best = 0;
  for (let s = Math.max(0, from); s + win <= Math.min(k.length, to) || s === from; s += hop) {
    best = Math.max(best, rms(k, s, s + win));
    if (s + win > k.length) break;
  }
  return gainToDb(best);
}

// --- End and loop -----------------------------------------------------------

/**
 * Where the sustained part ends: the first point after the onset at which
 * the 50 ms RMS falls below 35 % (-9 dB) of the median level. Some
 * recordings are already decaying after three seconds - no loop may sit there.
 */
export function sustainEnd(x: Float32Array, sr: number, onset: number): number {
  const win = Math.round(sr * 0.05);
  const frames = rmsFrames(x.subarray(onset), win, win);
  const a = Math.round(0.3 / 0.05), b = Math.round(2.0 / 0.05);
  const body = frames.slice(a, Math.max(a + 1, b)).sort((p, q) => p - q);
  const median = body[Math.floor(body.length / 2)] || 0;
  // Only search once the tone has arrived: strings sometimes need half a
  // second for the bow to speak, that is not an end.
  let i0 = 0;
  while (i0 < frames.length && frames[i0]! < median * 0.7) i0++;
  // ... and the drop has to last 200 ms - a short breath in the vibrato or a
  // bow change is not an end either.
  for (let i = Math.max(i0, 2); i < frames.length; i++) {
    let low = true;
    for (let j = i; j < Math.min(frames.length, i + 4); j++) if (frames[j]! >= median * 0.35) low = false;
    if (low) return onset + i * win;
  }
  return x.length;
}

/**
 * Where a decaying tone becomes inaudible: the last 10 ms block above `relDb`
 * below the peak (or above the noise floor at the end of the file, if that is
 * louder - otherwise noise would be dragged along for minutes).
 */
export function decayEnd(x: Float32Array, sr: number, onset: number, relDb = -50): number {
  const hop = Math.round(sr * 0.01);
  const env = envelope(x.subarray(onset), hop);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  const tail = Array.from(env.slice(-20)).sort((a, b) => a - b);
  const floor = tail[Math.floor(tail.length / 2)] || 0;
  const thr = Math.max(peak * dbToGain(relDb), floor * 2);
  for (let i = env.length - 1; i >= 0; i--) {
    if (env[i]! > thr) return onset + (i + 1) * hop;
  }
  return x.length;
}

/**
 * Bake a crossfaded loop into the audio. The stretch before loopEnd is
 * replaced by a mix of itself (fading out) and the stretch before loopStart
 * (fading in). When playback jumps from loopEnd back to loopStart it then
 * continues exactly as if it had never jumped - no click, without having to
 * search for zero crossings.
 *
 * Equal power (cos/sin) rather than linear: an ensemble sound with vibrato is
 * practically uncorrelated after a second, linear would leave a dip there.
 */
export function bakeLoop(x: Float32Array, loopStart: number, loopEnd: number, fade: number): Float32Array {
  const y = Float32Array.from(x);
  fade = Math.min(fade, loopStart, Math.floor((loopEnd - loopStart) / 2));
  for (let i = 0; i < fade; i++) {
    const t = (i / fade) * Math.PI / 2;
    const a = loopEnd - fade + i;
    const b = loopStart - fade + i;
    y[a] = x[a]! * Math.cos(t) + x[b]! * Math.sin(t);
  }
  return y;
}

export function fadeIn(x: Float32Array, n: number): Float32Array {
  for (let i = 0; i < Math.min(n, x.length); i++) x[i]! *= i / n;
  return x;
}

/** Half a cosine - softer than linear, no kink at the end. */
export function fadeOut(x: Float32Array, n: number): Float32Array {
  const L = x.length;
  n = Math.min(n, L);
  for (let i = 0; i < n; i++) {
    x[L - n + i]! *= 0.5 * (1 + Math.cos(Math.PI * (i + 1) / n));
  }
  return x;
}

export function peakAbs(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]!));
  return m;
}

// --- Pitch ----------------------------------------------------------------
//
// YIN (de Cheveigne & Kawahara 2002) in its simplest form. To avoid billions
// of steps, it only searches between half and twice the expected period
// (with a margin) and downsamples low notes first. A wrongly named octave is
// still found, because the search range includes the neighbouring octaves.

function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor === 1) return x;
  const n = Math.floor(x.length / factor);
  const y = new Float32Array(n);
  // Moving average as a crude lowpass - good enough for measuring periods.
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < factor; j++) acc += x[i * factor + j]!;
    y[i] = acc / factor;
  }
  return y;
}

function yinFrame(x: Float32Array, start: number, W: number, tauMin: number, tauMax: number, threshold: number) {
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let acc = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[start + j]! - x[start + j + tau]!;
      acc += diff * diff;
    }
    d[tau] = acc;
  }
  // cumulative mean normalized difference
  const cm = new Float64Array(tauMax + 2);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau]!;
    cm[tau] = run > 0 ? d[tau]! * tau / run : 1;
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cm[tau]! < threshold) {
      while (tau + 1 <= tauMax && cm[tau + 1]! < cm[tau]!) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    // no dip below the threshold: global minimum, marked as uncertain
    let m = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau]! < m) { m = cm[tau]!; best = tau; }
  }
  const a = cm[best - 1]!, b = cm[best]!, c = cm[best + 1]!;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
  return { tau: best + Math.max(-1, Math.min(1, shift)), clarity: 1 - b };
}

export interface PitchEstimate {
  hz: number;
  /** Spread of the per-window estimates in cents (large = uncertain). */
  spread: number;
  clarity: number;
  frames: number;
}

/**
 * Fundamental around `expectHz`; returns the median over several windows and
 * the spread in cents (large spread = uncertain measurement).
 */
export function detectPitch(
  x: Float32Array, sr: number, from: number, to: number, expectHz: number,
  { threshold = 0.15, span = 2.3 }: { threshold?: number; span?: number } = {},
): PitchEstimate | null {
  // The period should be at least ~40 samples long, or quantization eats the
  // cent accuracy; more than needed only costs time.
  let factor = 1;
  while (factor < 8 && (sr / factor) / expectHz > 160) factor *= 2;
  const s = decimate(x.subarray(Math.max(0, from), Math.min(x.length, to)), factor);
  const fs = sr / factor;
  const T = fs / expectHz;
  const tauMin = Math.max(2, Math.floor(T / span));
  const tauMax = Math.ceil(T * span);
  const W = Math.max(Math.ceil(T * 4), Math.round(fs * 0.03));
  const results: { hz: number; clarity: number }[] = [];
  const step = Math.max(1, Math.floor((s.length - W - tauMax - 2) / 8));
  for (let st = 0; st + W + tauMax + 2 < s.length; st += step) {
    const r = yinFrame(s, st, W, tauMin, tauMax, threshold);
    results.push({ hz: fs / r.tau, clarity: r.clarity });
    if (results.length >= 9) break;
  }
  if (!results.length) return null;
  const hz = results.map((r) => r.hz).sort((a, b) => a - b);
  const med = hz[Math.floor(hz.length / 2)]!;
  const cents = hz.map((h) => 1200 * Math.log2(h / med));
  const spread = Math.max(...cents.map(Math.abs).slice(1, -1).concat([0]));
  const clarity = results.map((r) => r.clarity).sort((a, b) => a - b)[Math.floor(results.length / 2)]!;
  return { hz: med, spread, clarity, frames: results.length };
}

/** Note name as in the VSCO files ("F#3", "A#0") -> MIDI, C4 = 60. */
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Unknown note: ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);

// --- Spectrum -------------------------------------------------------------

/** Magnitude of the DFT at one frequency (Goertzel), with a Hann window. */
export function goertzel(x: Float32Array, sr: number, from: number, to: number, hz: number): number {
  from = Math.max(0, Math.floor(from));
  to = Math.min(x.length, Math.floor(to));
  const n = to - from;
  const w = 2 * Math.PI * hz / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s0 = x[from + i]! * win + c * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / n;
}

/** Strongest value around `hz` (+-cents), in `step` cent steps. */
export function peakNear(x: Float32Array, sr: number, from: number, to: number, hz: number, cents = 40, step = 5): { amp: number; hz: number } {
  let best = 0, bestHz = hz;
  for (let c = -cents; c <= cents; c += step) {
    const f = hz * Math.pow(2, c / 1200);
    const a = goertzel(x, sr, from, to, f);
    if (a > best) { best = a; bestHz = f; }
  }
  return { amp: best, hz: bestHz };
}

/**
 * Does the tone really sound in the octave of `hz`? Pitch estimators like to
 * slip by an octave when the fundamental is weak (low pizzicati) - but file
 * names are sometimes wrong, too. The spectrum decides: if the fundamental
 * and the odd partials are almost absent, it sounds an octave higher; if
 * there is strong energy at hz/2 and 3hz/2, lower.
 */
export function octaveCheck(x: Float32Array, sr: number, from: number, to: number, hz: number): { up: number; down: number; verdict: -1 | 0 | 1 } {
  const A = (m: number) => peakNear(x, sr, from, to, hz * m).amp;
  const f1 = A(1), f2 = A(2), f3 = A(3), f4 = A(4);
  const h = A(0.5), h3 = A(1.5);
  const up = (f1 + f3) / Math.max(1e-12, f2 + f4);
  const down = (h + h3) / Math.max(1e-12, f1 + f2);
  return { up, down, verdict: up < 0.1 ? +1 : down > 0.3 ? -1 : 0 };
}

/**
 * Pitch of a timpani: the perceived pitch is the (1,1) mode of the head,
 * usually the strongest spectral peak between 60 and 260 Hz once the dull
 * initial thump (the (0,1) mode) has died away after ~0.1 s. YIN is no good
 * here, the partials are not harmonic.
 */
export function timpaniPitch(x: Float32Array, sr: number, from: number, to: number): { hz: number; fifth: number; octave: number } {
  let best = 0, bestHz = 0;
  for (let c = 0; c <= 1200 * Math.log2(260 / 60); c += 10) {
    const f = 60 * Math.pow(2, c / 1200);
    const a = goertzel(x, sr, from, to, f);
    if (a > best) { best = a; bestHz = f; }
  }
  // On a strong hit the (2,1) mode a fifth above is sometimes louder than
  // the main tone. If there is still a clear peak at 2/3 of the frequency,
  // that is the actual pitch.
  const below = peakNear(x, sr, from, to, bestHz / 1.5, 60);
  if (bestHz / 1.5 >= 60 && below.amp >= 0.3 * best) bestHz = below.hz;
  const fine = peakNear(x, sr, from, to, bestHz, 10);
  // Does the pattern fit? The (2,1) and (3,1) modes lie about a fifth and an
  // octave above.
  const fifth = peakNear(x, sr, from, to, fine.hz * 1.5, 60).amp / fine.amp;
  const octave = peakNear(x, sr, from, to, fine.hz * 2, 60).amp / fine.amp;
  return { hz: fine.hz, fifth, octave };
}

export interface PitchMeasurement {
  hz: number;
  spread: number;
  clarity: number;
  /** +1: sounds an octave higher than expected, -1: lower, 0: as expected. */
  octave: -1 | 0 | 1;
  /** Set when a spectral method was used instead of YIN. */
  method?: string;
  /** YIN with the wide search range, to spot octave jumps of the estimator. */
  wideHz?: number | undefined;
}

export type PitchMethod = 'timpani' | 'spectrum';

/**
 * Measure the pitch of a sample, differently per instrument:
 *  - 'timpani':  spectral peak of the (1,1) mode; the note is derived from it
 *  - 'spectrum': spectral peak at the expected fundamental (glockenspiel:
 *                inharmonic partials, very high - YIN guesses around +-50 cents)
 *  - otherwise YIN: narrow search (+-6 semitones) for the cent deviation,
 *                plus a wide search and the spectrum to catch octave errors
 *                in the file name
 * Sustained notes are measured in the steady part, plucked and struck ones
 * right after the attack, where the fundamental is clearest.
 */
export function measurePitch(
  x: Float32Array, sr: number, onset: number, midi: number,
  { sustain = false, method }: { sustain?: boolean | undefined; method?: PitchMethod | undefined } = {},
): PitchMeasurement | null {
  if (method === 'timpani') {
    const [a, b] = sustain ? [0.3, 2.0] : [0.15, 0.9];
    const t = timpaniPitch(x, sr, onset + a * sr, onset + b * sr);
    return { hz: t.hz, spread: 0, clarity: t.fifth, octave: 0, method: 'spectrum' };
  }
  const hz = midiToHz(midi);
  if (method === 'spectrum') {
    const from = onset + 0.03 * sr, to = onset + 0.6 * sr;
    const coarse = peakNear(x, sr, from, to, hz, 150, 5);
    const fine = peakNear(x, sr, from, to, coarse.hz, 6, 1);
    return { hz: fine.hz, spread: 0, clarity: 1, octave: 0, method: 'spectrum' };
  }
  const [a, b] = sustain ? [0.4, 1.6] : [0.03, 0.45];
  const from = onset + a * sr, to = onset + b * sr;
  const narrow = detectPitch(x, sr, from, to, hz, { span: 1.42 });
  if (!narrow) return null;
  const wide = detectPitch(x, sr, from, to, hz);
  const oc = octaveCheck(x, sr, from, to, hz);
  return { ...narrow, wideHz: wide?.hz, octave: oc.verdict };
}
