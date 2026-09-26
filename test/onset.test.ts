import { expect, test } from 'vitest';
import { MP3_PRIMING, decoderShift, detectOnset } from '../src/onset.ts';
import { close } from './helpers.ts';

test('detectOnset: finds the onset after silence, even with noise', () => {
  const sr = 10000;
  const x = new Float32Array(sr);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0004;
  for (let i = 0; i < x.length; i++) x[i] = noise();
  for (let i = 5000; i < x.length; i++) x[i]! += 0.8 * Math.sin(i * 0.3) * Math.min(1, (i - 5000) / 50);
  const on = detectOnset(x, sr);
  expect(on).toBeGreaterThanOrEqual(4950);
  expect(on).toBeLessThanOrEqual(5010);
  expect(detectOnset(new Float32Array(100), sr)).toBe(0);
});

test('detectOnset: a relative threshold without noise floor finds the loud part', () => {
  const sr = 1000;
  const x = new Float32Array(1000);
  for (let i = 100; i < 1000; i++) x[i] = i < 300 ? 0.01 : 1; // quiet lead-in, then the hit
  expect(detectOnset(x, sr, -60, false)).toBe(98);
  expect(detectOnset(x, sr, -24, false)).toBe(298);
});

test('decoderShift: only when the buffer is longer, then a known priming length', () => {
  expect(decoderShift(3.0, 3.0, 0.02, 0.02)).toBe(0);
  expect(decoderShift(3.005, 3.0, 0.05, 0.02)).toBe(0);
  expect(decoderShift(3.5, undefined, 0.05, 0.02)).toBe(0);
  close(decoderShift(3.05, 3.0, 0.02 + 1105 / 44100, 0.02), 1105 / 44100);
  close(decoderShift(3.08, 3.0, 0.02 + 2257 / 44100 + 0.004, 0.02), 2257 / 44100);
  // measurement wobbles (soft onset): still the nearest known priming length
  close(decoderShift(3.05, 3.0, 0.02 + 0.031, 0.02), 1105 / 44100);
  close(decoderShift(3.05, 3.0, null, null), 1105 / 44100);
  expect(MP3_PRIMING[1] - MP3_PRIMING[0]).toBeCloseTo(1152 / 44100, 12);
});
