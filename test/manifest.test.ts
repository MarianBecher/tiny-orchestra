// The committed samples/manifest.json is what consumers load - check its
// shape against the types and against the files next to it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { samplesDir } from '../src/node.ts';
import { pickSample } from '../src/pitch.ts';
import type { Manifest } from '../src/types.ts';

const dir = samplesDir();
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;

describe('samples/manifest.json', () => {
  test('header', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.source).toMatch(/VSCO-2/);
    expect(manifest.format).toMatchObject({ codec: 'mp3', sampleRate: 44100, channels: 1 });
    expect(Object.keys(manifest.instruments)).toHaveLength(25);
  });

  test.each(Object.entries(manifest.instruments))('%s', (_name, inst) => {
    expect(inst.samples.length).toBeGreaterThan(0);
    for (const s of inst.samples) {
      expect(existsSync(join(dir, s.file)), s.file).toBe(true);
      expect(s.offset).toBeGreaterThanOrEqual(0);
      expect(s.duration).toBeGreaterThan(s.offset!);
      if (inst.sustain) expect(s.loopEnd).toBeGreaterThan(s.loopStart!);
    }
    if (inst.pitched) {
      const midis = inst.samples.map((s) => s.midi!);
      expect(midis.every((m) => Number.isInteger(m))).toBe(true);
      expect(inst.range).toEqual([Math.min(...midis), Math.max(...midis)]);
      // every note in range finds a sample at most a few semitones away (the
      // horn has the widest gap: C4-D5 is missing in the source)
      for (let m = inst.range![0]; m <= inst.range![1]; m++) {
        expect(Math.abs(pickSample(inst.samples, m, 1)!.midi! - m)).toBeLessThanOrEqual(7);
      }
    } else {
      expect(inst.variants).toContain(inst.defaultVariant);
      expect(inst.variants?.[0]).toBe(inst.defaultVariant);
      for (const s of inst.samples) expect(inst.variants).toContain(s.variant);
    }
  });
});
