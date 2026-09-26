import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOOKAHEAD, LOOKAHEAD_HIDDEN, TICK_MS, startScheduler, type SchedulerOptions } from '../src/scheduler.ts';
import { flattenScore, type ScoreEvent } from '../src/score.ts';
import type { Score, Voice } from '../src/types.ts';
import { close } from './helpers.ts';

// 120 bpm: one beat = 0.5 s. Four quarter notes per bar.
const score: Score = {
  bpm: 120,
  lengthBeats: 4,
  parts: [{ instrument: 'harp', notes: [[0, 60, 1], [1, 62, 1], [2, 64, 1], [3, 65, 1]] }],
};

interface Planned { midi: number | null; time: number; duration: number; plannedAt: number; voice: FakeVoice }
interface FakeVoice extends Voice { stoppedAt: number | null }

function setup(overrides: Partial<SchedulerOptions> = {}) {
  let clock = 10;
  const planned: Planned[] = [];
  const onEnd = vi.fn();
  const sched = startScheduler({
    events: flattenScore(score),
    lengthBeats: 4,
    loop: false,
    startTime: 10,
    bpm: 120,
    now: () => clock,
    hidden: () => false,
    onEnd,
    schedule: (ev: ScoreEvent, time, duration) => {
      const voice: FakeVoice = {
        startTime: time,
        endTime: time + duration + 0.3,
        stoppedAt: null,
        stop(when = clock) { this.stoppedAt = when; },
      };
      planned.push({ midi: ev.midi, time, duration, plannedAt: clock, voice });
      return voice;
    },
    ...overrides,
  });
  /** Let `seconds` pass on both the audio clock and the timer. */
  const advance = (seconds: number) => {
    const steps = Math.round((seconds * 1000) / TICK_MS);
    for (let i = 0; i < steps; i++) {
      clock += TICK_MS / 1000;
      vi.advanceTimersByTime(TICK_MS);
    }
  };
  return { sched, planned, onEnd, advance, setClock: (t: number) => { clock = t; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('startScheduler', () => {
  test('plans only the lookahead window right away', () => {
    const { planned, sched } = setup();
    // at t = start, 0.5 s ahead = 1 beat: only beat 0 (window is half open)
    expect(planned.map((p) => p.midi)).toEqual([60]);
    close(sched.planned, LOOKAHEAD * 2);
  });

  test('every note is planned once, ahead of time, at the exact beat time', () => {
    const { planned, advance } = setup();
    advance(3);
    expect(planned.map((p) => p.midi)).toEqual([60, 62, 64, 65]);
    planned.forEach((p, i) => {
      close(p.time, 10 + i * 0.5);
      close(p.duration, 0.5);
      expect(p.plannedAt).toBeLessThanOrEqual(p.time);
      expect(p.time - p.plannedAt).toBeLessThanOrEqual(LOOKAHEAD + 1e-9);
    });
  });

  test('ends on the audio clock and calls onEnd once', () => {
    const { onEnd, advance, sched } = setup();
    expect(sched.endTime).toBe(12);
    advance(1.9);
    expect(onEnd).not.toHaveBeenCalled();
    advance(0.3);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(sched.running).toBe(false);
    advance(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test('a suspended clock does not end the score early', () => {
    const { onEnd, setClock, planned } = setup();
    setClock(10);
    vi.advanceTimersByTime(10_000); // timer runs, audio clock stands still
    expect(onEnd).not.toHaveBeenCalled();
    expect(planned).toHaveLength(1);
  });

  test('loop runs on with absolute times and never ends', () => {
    const { planned, onEnd, advance, sched } = setup({ loop: true });
    expect(sched.endTime).toBe(Infinity);
    advance(6); // three passes
    expect(onEnd).not.toHaveBeenCalled();
    const times = planned.map((p) => p.time);
    expect(times.length).toBeGreaterThanOrEqual(12);
    times.forEach((t, i) => close(t, 10 + i * 0.5));
    expect(planned.slice(4, 8).map((p) => p.midi)).toEqual([60, 62, 64, 65]);
  });

  test('a stalled timer skips the missed notes instead of piling them up', () => {
    const { planned, setClock } = setup();
    setClock(11.05); // 1.05 s pass without a tick
    vi.advanceTimersByTime(TICK_MS);
    // beat 1 (10.5 s) is more than 0.1 s behind - skipped; beat 2 (11.0 s)
    // is only 50 ms late and still sounds; beat 3 is inside the new window
    expect(planned.map((p) => p.midi)).toEqual([60, 64, 65]);
  });

  test('hidden pages plan further ahead', () => {
    const { planned } = setup({ hidden: () => true });
    expect(LOOKAHEAD_HIDDEN).toBeGreaterThan(LOOKAHEAD);
    expect(planned.map((p) => p.midi)).toEqual([60, 62, 64, 65]);
  });

  test('stop cancels pending voices and stops planning', () => {
    const { planned, sched, advance } = setup();
    advance(0.3);
    const before = planned.length;
    sched.stop(10.4);
    for (const p of planned) expect(p.voice.stoppedAt).toBe(10.4);
    advance(3);
    expect(planned).toHaveLength(before);
    expect(sched.running).toBe(false);
  });
});
