// Lookahead scheduler. A score is never planned all at once, only a short
// stretch ahead (every 100 ms, ~0.5 s ahead): that way stop() takes effect
// immediately, a loop can run forever at no extra cost, and a long piece does
// not keep thousands of nodes waiting in the audio graph.
//
// This module knows nothing about Web Audio: it reads a clock and hands each
// due event to `schedule`, which creates the actual voice.

import { beatToTime, collectEvents, timeToBeat, type ScoreEvent } from './score.ts';
import type { Voice } from './types.ts';

/** How far ahead notes are planned (seconds). */
export const LOOKAHEAD = 0.5;
/** Background tabs throttle setInterval to ~1 s, so plan further ahead there. */
export const LOOKAHEAD_HIDDEN = 2.0;
export const TICK_MS = 100;
/** A timer that is late by more than this skips the missed notes. */
const LATE = 0.1;

export interface SchedulerOptions {
  events: readonly ScoreEvent[];
  lengthBeats: number;
  loop: boolean;
  /** Clock time of beat 0. */
  startTime: number;
  bpm: number;
  /** The clock, usually `() => ctx.currentTime`. */
  now: () => number;
  /** Whether the page is in the background. Default: `document.hidden`, if there is a document. */
  hidden?: () => boolean;
  /** Plan one event at clock time `time`, lasting `duration` seconds. */
  schedule: (ev: ScoreEvent, time: number, duration: number) => Voice | null;
  /** Called once when the (non-looping) score has played to its end. */
  onEnd?: () => void;
}

export interface Scheduler {
  /** Clock time of the end; `Infinity` when looping. */
  readonly endTime: number;
  /** Everything up to this beat has been planned. */
  readonly planned: number;
  readonly running: boolean;
  /** Stop planning and stop every planned voice at `at` with a short release. */
  stop(at: number): void;
}

const documentHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

export function startScheduler(options: SchedulerOptions): Scheduler {
  const { events, lengthBeats, loop, startTime, bpm, now, schedule } = options;
  const hidden = options.hidden ?? documentHidden;
  const spb = 60 / bpm;
  const endTime = loop ? Infinity : beatToTime(lengthBeats, startTime, bpm);

  let planned = 0;
  let voices: Voice[] = [];
  let running = true;
  const tick = (): void => {
    if (!running) return;
    const t = now();
    voices = voices.filter((v) => v.endTime > t);
    if (!loop && planned >= lengthBeats) {
      // Everything is planned; wait for the end - on the audio clock, so a
      // suspended context does not report the end too early.
      if (t >= endTime) {
        running = false;
        clearInterval(timer);
        options.onEnd?.();
      }
      return;
    }
    // If the timer stalled (background tab, busy machine), rather skip the
    // missed notes than play them all at once.
    const late = timeToBeat(t - LATE, startTime, bpm);
    if (planned < late) planned = loop ? late : Math.min(late, lengthBeats);
    const until = timeToBeat(t + (hidden() ? LOOKAHEAD_HIDDEN : LOOKAHEAD), startTime, bpm);
    const to = loop ? until : Math.min(until, lengthBeats);
    for (const { ev, beat } of collectEvents(events, lengthBeats, loop, planned, to)) {
      const v = schedule(ev, beatToTime(beat, startTime, bpm), ev.length * spb);
      if (v) voices.push(v);
    }
    planned = Math.max(planned, to);
  };

  const timer = setInterval(tick, TICK_MS);
  tick();

  return {
    endTime,
    get planned() {
      return planned;
    },
    get running() {
      return running;
    },
    stop(at: number) {
      if (!running) return;
      running = false;
      clearInterval(timer);
      // also cancel notes that are planned but not sounding yet
      for (const v of voices) v.stop(at, 0.02);
      voices = [];
    },
  };
}
