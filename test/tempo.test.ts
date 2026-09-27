import { describe, expect, test } from 'vitest';
import { LiveTimeline, repeating, tempoMap } from '../src/tempo.ts';
import { close } from './helpers.ts';

describe('tempoMap', () => {
  test('constant tempo, also before beat 0', () => {
    const m = tempoMap(120);
    close(m.seconds(4), 2);
    close(m.seconds(-1), -0.5);
    close(m.beatAt(3), 6);
    close(m.beatAt(-0.5), -1);
    expect(m.bpmAt(100)).toBe(120);
  });

  test('a step change holds from its beat on', () => {
    const m = tempoMap(120, [[4, 60]]);
    close(m.seconds(4), 2);
    close(m.seconds(6), 4);
    close(m.beatAt(4), 6);
    expect(m.bpmAt(3.9)).toBe(120);
    expect(m.bpmAt(4)).toBe(60);
  });

  test('a ramp integrates the tempo and inverts exactly', () => {
    // 120 -> 60 over 4 beats: 60/k * ln(60/120) with k = -15 bpm per beat
    const m = tempoMap(120, [[4, 60, true]]);
    close(m.seconds(4), -4 * Math.log(0.5), 1e-12);
    close(m.bpmAt(2), 90);
    for (const b of [0.5, 1.7, 3.99, 4, 5.5]) close(m.beatAt(m.seconds(b)), b, 1e-9);
    // after the ramp the target tempo holds
    close(m.seconds(5) - m.seconds(4), 1);
  });

  test('a change at beat 0 replaces the base tempo; invalid changes are ignored', () => {
    const m = tempoMap(120, [[0, 60], [-2, 200], [2, 0], [3, NaN]]);
    close(m.seconds(3), 3);
  });

  test('changes are sorted', () => {
    const a = tempoMap(100, [[8, 50], [4, 200, true]]);
    const b = tempoMap(100, [[4, 200, true], [8, 50]]);
    close(a.seconds(10), b.seconds(10));
  });
});

test('repeating: every pass starts at the base tempo again', () => {
  const m = repeating(tempoMap(120, [[2, 60]]), 4);
  // one pass: 2 beats at 120 (1 s) + 2 beats at 60 (2 s)
  close(m.seconds(4), 3);
  close(m.seconds(5), 3.5);
  close(m.seconds(10), 7);
  close(m.beatAt(7), 10);
  expect(m.bpmAt(4.5)).toBe(120);
  expect(m.bpmAt(7)).toBe(60);
});

describe('LiveTimeline', () => {
  test('start beat at start time, then the map', () => {
    const tl = new LiveTimeline(tempoMap(120), 10, 8);
    close(tl.time(8), 10);
    close(tl.time(10), 11);
    close(tl.beat(11), 10);
    close(tl.beat(9), 6); // before the start, extrapolated
  });

  test('a factor speeds up everything', () => {
    const tl = new LiveTimeline(tempoMap(120), 0, 0, 2);
    close(tl.time(4), 1);
    expect(tl.factor).toBe(2);
    close(tl.bpmAt(0), 240);
  });

  test('setFactor changes only what comes after its beat', () => {
    const tl = new LiveTimeline(tempoMap(120), 0);
    tl.setFactor(0.5, 4); // half as fast from beat 4 (2 s) on
    close(tl.time(3), 1.5);
    close(tl.time(4), 2);
    close(tl.time(5), 3);
    close(tl.beat(3), 5);
    // a second change before the first one replaces it
    tl.setFactor(2, 2);
    close(tl.time(2), 1);
    close(tl.time(4), 1.5);
    expect(tl.factor).toBe(2);
    tl.setFactor(0, 6); // ignored
    expect(tl.factor).toBe(2);
  });
});
