import { expect, test, vi } from 'vitest';
import { makeImpulse, makeupGain, rampFromNow } from '../src/reverb.ts';
import { close } from './helpers.ts';

test('makeImpulse: stereo, predelay, decaying, energy 1, deterministic', () => {
  const sr = 8000;
  const [l, r] = makeImpulse(sr, 1.5);
  expect(l.length).toBe(r.length);
  expect(l[0]).toBe(0);
  expect(l.slice(0, Math.round(0.011 * sr)).every((v) => v === 0)).toBe(true);
  let e = 0;
  for (const v of l) e += v * v;
  close(e, 1, 1e-6);
  const rms = (a: number, b: number) => Math.sqrt(l.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  expect(rms(200, 1200)).toBeGreaterThan(10 * rms(9000, 10000));
  expect(Array.from(l.slice(500, 600))).not.toEqual(Array.from(r.slice(500, 600))); // left != right
  expect(Array.from(makeImpulse(sr, 1.5)[0].slice(0, 400))).toEqual(Array.from(l.slice(0, 400)));
  // a different seed is a different room
  expect(Array.from(makeImpulse(sr, 1.5, { seed: 8 })[0].slice(200, 300))).not.toEqual(Array.from(l.slice(200, 300)));
});

test('rampFromNow: holds a running fade, falls back to the current value', () => {
  const ctx = { currentTime: 3 } as BaseAudioContext;
  const hold = { cancelAndHoldAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  rampFromNow(ctx, hold as unknown as AudioParam, 0.5, 2);
  expect(hold.cancelAndHoldAtTime).toHaveBeenCalledWith(3);
  expect(hold.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 5);

  const old = { value: 0.8, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  rampFromNow(ctx, old as unknown as AudioParam, 0, 1);
  expect(old.cancelScheduledValues).toHaveBeenCalledWith(3);
  expect(old.setValueAtTime).toHaveBeenCalledWith(0.8, 3);
  expect(old.linearRampToValueAtTime).toHaveBeenCalledWith(0, 4);
});

test('makeupGain: as the Web Audio compressor adds it', () => {
  // measured in Chromium: a limiter at -3 dB / 20:1 raised a 0.5352 peak to 0.6517
  close(makeupGain(-3, 20), 0.6517 / 0.5352, 1e-3);
  expect(makeupGain(0, 20)).toBe(1);
});
