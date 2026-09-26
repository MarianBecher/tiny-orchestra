// Tests for the build helpers that work without ffmpeg and network.

import { expect, test } from 'vitest';
import { bakeLoop, decayEnd, fadeIn, fadeOut, loudness, measurePitch, midiToHz, noteToMidi, sustainEnd } from '../scripts/lib/dsp.ts';
import { PITCHED, TIMPANI, UNPITCHED } from '../scripts/instruments.ts';

test('noteToMidi: C4 = 60, sharps, flats, low octaves', () => {
  expect(noteToMidi('C4')).toBe(60);
  expect(noteToMidi('A4')).toBe(69);
  expect(noteToMidi('F#3')).toBe(54);
  expect(noteToMidi('A#0')).toBe(22);
  expect(noteToMidi('Bb2')).toBe(46);
  expect(noteToMidi('C-1')).toBe(0);
  expect(() => noteToMidi('H2')).toThrow();
});

test('bakeLoop: the jump from loopEnd to loopStart is seamless', () => {
  // sine with a "wrong" period, so the loop would click without crossfade
  const n = 20000;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.0137) * (1 + 0.3 * Math.sin(i * 0.001));
  const ls = 6000, le = 15777, fade = 2000;
  const y = bakeLoop(x, ls, le, fade);
  // unchanged outside the crossfade
  expect(y[ls]).toBe(x[ls]);
  expect(y[le - fade - 1]).toBe(x[le - fade - 1]);
  // at the end of the crossfade it sounds like just before loopStart ...
  expect(Math.abs(y[le - 1]! - x[ls - 1]!)).toBeLessThan(1e-3);
  // ... so the step across the seam is as small as a normal step
  const step = Math.abs(y[le - 1]! - y[ls]!);
  const normal = Math.abs(x[ls]! - x[ls - 1]!);
  expect(step, `seam ${step} vs. ${normal}`).toBeLessThan(normal * 1.5 + 1e-3);
  // without the crossfade it would be a real jump
  expect(Math.abs(x[le - 1]! - x[ls]!)).toBeGreaterThan(0.1);
});

test('fadeOut ends at 0 and leaves the start alone; fadeIn starts at 0', () => {
  const x = new Float32Array(100).fill(1);
  fadeOut(x, 40);
  expect(x[0]).toBe(1);
  expect(x[59]).toBe(1);
  expect(Math.abs(x[99]!)).toBeLessThan(1e-6);
  expect(x[70]!).toBeGreaterThan(x[90]!);
  const y = fadeIn(new Float32Array(10).fill(1), 4);
  expect(Array.from(y.slice(0, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
});

test('sustainEnd: a short dip is no end, a real end is', () => {
  const sr = 1000;
  const x = new Float32Array(6000);
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    let a = t < 4 ? 1 : 0.01;
    if (t > 1 && t < 1.1) a = 0.1; // 100 ms breath
    x[i] = a * Math.sin(i);
  }
  const end = sustainEnd(x, sr, 0) / sr;
  expect(end).toBeGreaterThanOrEqual(3.9);
  expect(end).toBeLessThanOrEqual(4.1);
});

test('decayEnd: where an exponential decay falls below -50 dB', () => {
  const sr = 8000;
  const x = new Float32Array(sr * 3);
  // -60 dB per second: -50 dB is reached after 5/6 s
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.3) * Math.pow(10, (-60 * i) / sr / 20);
  const end = decayEnd(x, sr, 0) / sr;
  expect(end).toBeGreaterThan(0.8);
  expect(end).toBeLessThan(0.87);
});

test('loudness: K-weighting favours presence over rumble', () => {
  const sr = 44100;
  const tone = (hz: number) => Float32Array.from({ length: sr }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr));
  const low = loudness(tone(30), sr, 'sustain', 0, sr);
  const mid = loudness(tone(1000), sr, 'sustain', 0, sr);
  const high = loudness(tone(4000), sr, 'sustain', 0, sr);
  expect(mid).toBeGreaterThan(low + 3);
  expect(high).toBeGreaterThan(mid);
  expect(loudness(tone(1000), sr, 'peak')).toBeCloseTo(mid, 0);
});

test('measurePitch: YIN finds a harmonic tone and its cents', () => {
  const sr = 44100;
  const hz = midiToHz(57) * Math.pow(2, 12 / 1200); // A3, 12 cents sharp
  const x = Float32Array.from({ length: sr }, (_, i) => {
    const t = i / sr;
    return 0.5 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.1 * Math.sin(6 * Math.PI * hz * t);
  });
  const p = measurePitch(x, sr, 0, 57, { sustain: false });
  expect(p).not.toBeNull();
  expect(1200 * Math.log2(p!.hz / midiToHz(57))).toBeCloseTo(12, 0);
  expect(p!.octave).toBe(0);
});

test('instrument table: 25 instruments, no name used twice', () => {
  const names = [...Object.keys(PITCHED), ...Object.keys(TIMPANI), ...Object.keys(UNPITCHED)];
  expect(names).toHaveLength(25);
  expect(new Set(names).size).toBe(25);
  for (const cfg of Object.values(UNPITCHED)) expect(cfg.samples.length).toBeGreaterThan(0);
});
