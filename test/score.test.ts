import { describe, expect, test } from 'vitest';
import {
  barAt, beatToTime, collectEvents, dynamicsAt, flattenDynamics, flattenScore, nextBarBeat, scoreLength, timeToBeat, wrapPosition,
} from '../src/score.ts';
import type { Score } from '../src/types.ts';
import { close } from './helpers.ts';

const score: Score = {
  bpm: 120,
  beatsPerBar: 4,
  parts: [
    { instrument: 'violins', velocity: 0.5, transpose: 12, pan: -0.3, notes: [[0, 60, 2], [2, 62, 2, 0.9]] },
    { instrument: 'cymbal', variant: 'crash', notes: [[1, null, 1], [3, null, 1, 0.4, 'soft']] },
  ],
};

test('beatToTime / timeToBeat', () => {
  close(beatToTime(0, 10, 120), 10);
  close(beatToTime(4, 10, 120), 12);
  close(beatToTime(1.5, 0, 90), 1);
  close(timeToBeat(12, 10, 120), 4);
  close(timeToBeat(beatToTime(7.25, 3.3, 133), 3.3, 133), 7.25);
});

test('scoreLength: as given or rounded up to bars', () => {
  expect(scoreLength(score)).toBe(4);
  expect(scoreLength({ ...score, lengthBeats: 6 })).toBe(6);
  expect(scoreLength({ parts: [{ notes: [[4, 60, 0.5]] }] })).toBe(8);
  expect(scoreLength({ beatsPerBar: 3, parts: [{ notes: [[0, 60, 1]] }] })).toBe(3);
  expect(scoreLength({ parts: [] })).toBe(4);
  expect(scoreLength({})).toBe(4);
});

test('flattenScore: sorted, transposition, level, variants', () => {
  const ev = flattenScore(score, { transpose: -2, velocity: 0.5 });
  expect(ev.map((e) => e.beat)).toEqual([0, 1, 2, 3]);
  const [e0, e1, e2, e3] = ev;
  expect(e0?.midi).toBe(70);            // 60 + 12 - 2
  close(e0!.velocity, 0.25);            // part 0.5 * call 0.5
  close(e2!.velocity, 0.45);            // note 0.9 * 0.5
  expect(e0?.pan).toBe(-0.3);
  expect(e1?.midi).toBeNull();          // unpitched stays null
  expect(e1?.variant).toBe('crash');    // from the part
  expect(e3?.variant).toBe('soft');     // from the note
  close(e1!.velocity, 0.35);            // default 0.7 * 0.5
});

test('flattenScore: velocity is clamped, explicit undefined velocity falls back to the part', () => {
  const ev = flattenScore({ parts: [{ instrument: 'x', velocity: 0.4, notes: [[0, 60, 1, 3], [1, null, 1, undefined, 'soft']] }] }, { velocity: 2 });
  expect(ev[0]?.velocity).toBe(1);
  close(ev[1]!.velocity, 0.8);
  expect(ev[1]?.variant).toBe('soft');
});

describe('collectEvents', () => {
  test('window without loop', () => {
    const ev = flattenScore(score);
    expect(collectEvents(ev, 4, false, 0, 1.5).map((x) => x.beat)).toEqual([0, 1]);
    expect(collectEvents(ev, 4, false, 1.5, 100).map((x) => x.beat)).toEqual([2, 3]);
    expect(collectEvents(ev, 4, false, 1, 1)).toEqual([]);
    // half open: [from, to) - nothing twice at window edges
    const a = collectEvents(ev, 4, false, 0, 2).length;
    const b = collectEvents(ev, 4, false, 2, 4).length;
    expect(a + b).toBe(4);
  });

  test('loop wraps around and counts absolute beats', () => {
    const ev = flattenScore(score);
    expect(collectEvents(ev, 4, true, 3, 9).map((x) => x.beat)).toEqual([3, 4, 5, 6, 7, 8]);
    // events of the second pass are the notes of the first
    expect(collectEvents(ev, 4, true, 4, 5)[0]?.ev).toBe(ev[0]);
    // gap-free over many small windows, even with odd boundaries
    let n = 0;
    for (let t = 0; t < 40; t += 0.37) n += collectEvents(ev, 4, true, t, Math.min(40, t + 0.37)).length;
    expect(n).toBe(40);
    // notes on/after lengthBeats are dropped instead of sounding twice
    const odd = [{ beat: 4 }, { beat: 0 }];
    expect(collectEvents(odd, 4, true, 0, 8).map((x) => x.beat)).toEqual([0, 4]);
    expect(collectEvents(odd, 0, true, 0, 8)).toEqual([]);
  });
});

test('wrapPosition', () => {
  expect(wrapPosition(-1, 8, true)).toBe(0);
  expect(wrapPosition(9.5, 8, true)).toBe(1.5);
  expect(wrapPosition(9.5, 8, false)).toBe(8);
  expect(wrapPosition(3, 8, false)).toBe(3);
});

test('flattenScore: note names, part index', () => {
  const ev = flattenScore({ parts: [
    { instrument: 'a', notes: [[1, 'C4', 1]] },
    { instrument: 'b', transpose: 2, notes: [[0, 'A4', 1], [2, 'nope', 1]] },
  ] });
  expect(ev.map((e) => [e.beat, e.part, e.midi])).toEqual([[0, 1, 71], [1, 0, 60], [2, 1, NaN]]);
});

describe('bars', () => {
  test('nextBarBeat without loop, up to the end', () => {
    expect(nextBarBeat(0, 4, 16, false)).toBe(0);
    expect(nextBarBeat(0.1, 4, 16, false)).toBe(4);
    expect(nextBarBeat(4, 4, 16, false)).toBe(4);
    expect(nextBarBeat(3.9999999999, 4, 16, false)).toBe(4);
    expect(nextBarBeat(13, 4, 14, false)).toBe(14);
  });

  test('nextBarBeat with loop: every pass starts a bar', () => {
    expect(nextBarBeat(17, 4, 16, true)).toBe(20);
    expect(nextBarBeat(9, 3, 10, true)).toBe(9);
    expect(nextBarBeat(9.5, 3, 10, true)).toBe(10); // the next would be 12, past the end of the pass
    expect(nextBarBeat(10.5, 3, 10, true)).toBe(13);
  });

  test('barAt counts bars, per pass when looping', () => {
    expect(barAt(8, 4, 16, false)).toBe(2);
    expect(barAt(9, 4, 16, false)).toBeNull();
    // 10 beats in 3/4: bars at 0, 3, 6, 9 - four per pass
    expect([0, 3, 6, 9, 10, 13].map((b) => barAt(b, 3, 10, true))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(barAt(12, 3, 10, true)).toBeNull();
  });
});

describe('dynamics', () => {
  const parts = [
    { instrument: 'a', notes: [], dynamics: [[4, 1, true], [2, 0.5]] as [number, number, boolean?][] },
    { instrument: 'b', notes: [] },
  ];

  test('flattenDynamics: sorted, gain = level squared, a first point at beat 0, ramps with their start', () => {
    expect(flattenDynamics({ parts })).toEqual([
      { beat: 0, part: 0, gain: 0.25, rampTo: null },
      { beat: 2, part: 0, gain: 0.25, rampTo: { beat: 4, gain: 1 } },
      { beat: 4, part: 0, gain: 1, rampTo: null },
    ]);
  });

  test('dynamicsAt: steps, ramps, and 1 without dynamics', () => {
    const d = parts[0]!.dynamics;
    expect(dynamicsAt(d, 1)).toEqual({ gain: 0.25, rampTo: null });
    const mid = dynamicsAt(d, 3);
    close(mid.gain, 0.625);
    expect(mid.rampTo).toEqual({ beat: 4, gain: 1 });
    expect(dynamicsAt(d, 9)).toEqual({ gain: 1, rampTo: null });
    expect(dynamicsAt(undefined, 3)).toEqual({ gain: 1, rampTo: null });
    expect(dynamicsAt([[0, 2]], 0).gain).toBe(1); // clamped
  });
});
