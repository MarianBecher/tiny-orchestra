import { describe, expect, test } from 'vitest';
import { midiToFreq, pickLayer, pickSample, pickVariant, playbackRate, velocityGain } from '../src/pitch.ts';
import { close } from './helpers.ts';

test('midiToFreq: A4 = 440, an octave doubles', () => {
  close(midiToFreq(69), 440);
  close(midiToFreq(81), 880);
  close(midiToFreq(57), 220);
  close(midiToFreq(60), 261.6255653005986);
});

test('playbackRate: semitones, detune, tuning correction', () => {
  close(playbackRate(60, 60), 1);
  close(playbackRate(72, 60), 2);
  close(playbackRate(57, 60), Math.pow(2, -3 / 12));
  close(playbackRate(60, 60, 100), Math.pow(2, 1 / 12));
  // recorded 20 cents sharp -> play slightly slower
  close(playbackRate(60, 60, 0, 20), Math.pow(2, -0.2 / 12));
  // detune and tuning cancel out
  close(playbackRate(64, 62, 30, 30), Math.pow(2, 2 / 12));
});

test('velocityGain: quadratic, relative to the layer, clamped', () => {
  close(velocityGain(1), 1);
  close(velocityGain(0.5), 0.25);
  close(velocityGain(0.55, 0.55), 1);
  close(velocityGain(2), 1);
  close(velocityGain(-1), 0);
  // continuous across the layer boundary: same level whichever layer is used
  const quietBaked = 0.55 * 0.55; // the quiet layer is that much quieter in the file
  close(velocityGain(0.7, 0.55) * quietBaked, velocityGain(0.7, 1), 1e-12);
});

test('pickLayer: quietest sufficient layer, else the strongest', () => {
  expect(pickLayer([0.55, 1], 0.3)).toBe(0.55);
  expect(pickLayer([0.55, 1], 0.55)).toBe(0.55);
  expect(pickLayer([0.55, 1], 0.56)).toBe(1);
  expect(pickLayer([1, 0.55, 1], 1)).toBe(1);
  expect(pickLayer([0.4], 0.9)).toBe(0.4);
  expect(pickLayer([], 0.9)).toBeUndefined();
});

describe('pickSample', () => {
  const strings = [
    { midi: 55, vel: 0.55 }, { midi: 62, vel: 0.55 },
    { midi: 55, vel: 1 }, { midi: 59, vel: 1 }, { midi: 62, vel: 1 },
  ];

  test('closest note within the layer', () => {
    expect(pickSample(strings, 60, 1)).toEqual({ midi: 59, vel: 1 });
    expect(pickSample(strings, 61, 1)).toEqual({ midi: 62, vel: 1 });
    expect(pickSample(strings, 30, 1)).toEqual({ midi: 55, vel: 1 });
    expect(pickSample(strings, 99, 1)).toEqual({ midi: 62, vel: 1 });
    // quiet: only two samples in that layer, there is no 59
    expect(pickSample(strings, 59, 0.3)).toEqual({ midi: 62, vel: 0.55 });
    expect(pickSample(strings, 58, 0.3)).toEqual({ midi: 55, vel: 0.55 });
  });

  test('a tie picks the lower sample; empty list gives null', () => {
    const s = [{ midi: 60 }, { midi: 64 }];
    expect(pickSample(s, 62)?.midi).toBe(60);
    expect(pickSample([], 60)).toBeNull();
  });

  test('returns the manifest object itself, typed', () => {
    const s = [{ file: 'a.mp3', midi: 60, offset: 0.01 }];
    const picked = pickSample(s, 61);
    expect(picked).toBe(s[0]);
    expect(picked?.file).toBe('a.mp3');
  });
});

test('pickVariant: variant, default, no immediate repeat', () => {
  const a = { variant: 'crash' }, b = { variant: 'crash' }, c = { variant: 'soft' };
  const all = [a, b, c];
  expect(pickVariant(all, 'soft', 'crash')).toBe(c);
  expect([a, b]).toContain(pickVariant(all, undefined, 'crash'));
  expect([a, b]).toContain(pickVariant(all, 'nonexistent', 'crash'));
  // round robin: never the same twice, even if chance wanted it
  for (let i = 0; i < 20; i++) {
    expect(pickVariant(all, 'crash', 'crash', a, () => 0)).toBe(b);
    expect(pickVariant(all, 'crash', 'crash', b, () => 0.99)).toBe(a);
  }
  // only one there -> the same one, then
  expect(pickVariant(all, 'soft', 'crash', c)).toBe(c);
  // nothing matches at all -> any sample
  expect(pickVariant([a], 'x', 'y')).toBe(a);
  expect(pickVariant([], 'x', 'y')).toBeNull();
});
