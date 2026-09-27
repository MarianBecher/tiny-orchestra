// The example scores must only use what the bundled samples can play.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { samplesDir } from '../src/node.ts';
import { noteToMidi } from '../src/notes.ts';
import { flattenScore, scoreLength } from '../src/score.ts';
import { cadence, drumroll, fanfare, odeToJoy, scores, waltz } from '../examples/scores.ts';
import type { Manifest } from '../src/types.ts';

const manifest = JSON.parse(readFileSync(join(samplesDir(), 'manifest.json'), 'utf8')) as Manifest;

describe('example scores', () => {
  test('all are listed', () => {
    expect(scores).toEqual({ fanfare, waltz, odeToJoy, drumroll, cadence });
  });

  test.each(Object.entries(scores))('%s', (_name, score) => {
    const length = scoreLength(score);
    expect(length).toBe(score.lengthBeats);
    expect(length % (score.beatsPerBar ?? 4)).toBe(0);

    const names = score.parts.map((p) => p.name);
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);

    for (const part of score.parts) {
      const inst = manifest.instruments[part.instrument];
      expect(inst, part.instrument).toBeDefined();
      if (!inst) continue;
      expect(part.notes.length, part.name).toBeGreaterThan(0);
      for (const [beat, pitch, len, vel, variant] of part.notes) {
        const where = `${part.name} @${beat}`;
        expect(beat, where).toBeGreaterThanOrEqual(0);
        expect(len, where).toBeGreaterThan(0);
        expect(beat + len, where).toBeLessThanOrEqual(length);
        if (vel !== undefined) expect(vel >= 0 && vel <= 1, where).toBe(true);
        if (inst.pitched) {
          expect(pitch, where).not.toBeNull();
          const midi = (typeof pitch === 'string' ? noteToMidi(pitch) : (pitch as number)) + (part.transpose ?? 0);
          const [lo, hi] = inst.range!;
          expect(midi >= lo && midi <= hi, `${where}: ${midi} outside ${lo}..${hi}`).toBe(true);
          expect(variant, where).toBeUndefined();
        } else {
          expect(pitch, where).toBeNull();
          const v = variant ?? part.variant;
          if (v !== undefined) expect(inst.variants, where).toContain(v);
        }
      }
    }

    const events = flattenScore(score);
    expect(events).toHaveLength(score.parts.reduce((n, p) => n + p.notes.length, 0));
    expect(events.every((e) => e.midi === null || Number.isInteger(e.midi))).toBe(true);
  });

  test('waltz is in 3/4, the cadence slows down', () => {
    expect(waltz.beatsPerBar).toBe(3);
    const last = cadence.tempo?.at(-1);
    expect(last?.[1]).toBeLessThan(cadence.bpm);
    expect(last?.[2]).toBe(true);
    expect(drumroll.parts[0]?.dynamics?.at(-1)).toEqual([8, 1, true]);
  });
});
