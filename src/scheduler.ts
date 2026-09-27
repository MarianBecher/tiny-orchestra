// Lookahead scheduler. A score is never planned all at once, only a short
// stretch ahead (every 100 ms, ~0.5 s ahead): that way stop() takes effect
// immediately, a loop can run forever at no extra cost, the tempo can change
// while it plays, and a long piece does not keep thousands of nodes waiting
// in the audio graph.
//
// This module knows nothing about Web Audio: it reads a clock and hands each
// due event to `schedule`, which creates the actual voice.

import { collectEvents, type ScoreEvent } from './score.ts';
import { LiveTimeline, tempoMap, type Timeline } from './tempo.ts';
import type { Voice } from './types.ts';

/** How far ahead notes are planned (seconds). */
export const LOOKAHEAD = 0.5;
/** Background tabs throttle setInterval to ~1 s, so plan further ahead there. */
export const LOOKAHEAD_HIDDEN = 2.0;
export const TICK_MS = 100;
/** A timer that is late by more than this skips the missed notes. */
const LATE = 0.1;

export interface SchedulerOptions<C extends { beat: number } = { beat: number }> {
  events: readonly ScoreEvent[];
  lengthBeats: number;
  loop: boolean;
  /** Clock time <-> beat. Default: a constant `bpm` with beat `from` at `startTime`. */
  timeline?: Timeline | undefined;
  /** Clock time of beat `from`; only without a `timeline`. */
  startTime?: number | undefined;
  /** Only without a `timeline`. Default 120. */
  bpm?: number | undefined;
  /** Beat to start planning from. Default 0. */
  from?: number | undefined;
  /** Beat at which it ends (looping or not). Default: `lengthBeats`, or never when looping. */
  until?: number | undefined;
  /** Seconds to plan ahead, instead of LOOKAHEAD / LOOKAHEAD_HIDDEN. */
  lookahead?: number | undefined;
  /** The clock, usually `() => ctx.currentTime`. */
  now: () => number;
  /** Whether the page is in the background. Default: `document.hidden`, if there is a document. */
  hidden?: () => boolean;
  /** Plan one event at clock time `time`, lasting `duration` seconds. */
  schedule: (ev: ScoreEvent, time: number, duration: number) => Voice | null;
  /** Other things tied to beats (like dynamics), repeated with the loop. Sorted by beat. */
  cues?: readonly C[] | undefined;
  /** `beat` counts from the start like the notes (across loop passes). */
  onCue?: ((cue: C, time: number, beat: number) => void) | undefined;
  /** Called while planning, once for every whole beat, with its clock time. */
  onBeat?: ((beat: number, time: number) => void) | undefined;
  /** Called once when the score has played to its end (not after `stop()`). */
  onEnd?: () => void;
}

export interface Scheduler {
  /** Clock time of the end; `Infinity` when looping without `until`. */
  readonly endTime: number;
  /** Everything up to this beat has been planned. */
  readonly planned: number;
  readonly running: boolean;
  /**
   * Stop at clock time `at`: notes before it are still planned, every voice
   * is stopped at `at` with a short release.
   */
  stop(at: number): void;
}

const documentHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

export function startScheduler<C extends { beat: number }>(options: SchedulerOptions<C>): Scheduler {
  const { events, lengthBeats, loop, now, schedule, from = 0 } = options;
  const hidden = options.hidden ?? documentHidden;
  const timeline = options.timeline ?? new LiveTimeline(tempoMap(options.bpm ?? 120), options.startTime ?? now(), from);
  const until = options.until ?? (loop ? Infinity : lengthBeats);
  const endTime = (): number => (Number.isFinite(until) ? timeline.time(until) : Infinity);

  let planned = from;
  let voices: Voice[] = [];
  let running = true;
  let stopAt = Infinity;
  const finish = (): void => {
    running = false;
    clearInterval(timer);
  };
  const tick = (): void => {
    if (!running) return;
    const t = now();
    voices = voices.filter((v) => v.endTime > t);
    if (t >= stopAt) {
      finish();
      return;
    }
    if (planned >= until) {
      // Everything is planned; wait for the end - on the audio clock, so a
      // suspended context does not report the end too early.
      if (t >= endTime()) {
        finish();
        options.onEnd?.();
      }
      return;
    }
    // If the timer stalled (background tab, busy machine), rather skip the
    // missed notes than play them all at once.
    const late = timeline.beat(t - LATE);
    if (planned < late) planned = Math.min(late, until);
    const ahead = options.lookahead ?? (hidden() ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    let to = Math.min(timeline.beat(t + ahead), until);
    if (Number.isFinite(stopAt)) to = Math.min(to, timeline.beat(stopAt));
    if (to > planned) {
      for (const { ev, beat } of collectEvents(events, lengthBeats, loop, planned, to)) {
        const time = timeline.time(beat);
        const v = schedule(ev, time, timeline.time(beat + ev.length) - time);
        if (v) {
          if (Number.isFinite(stopAt)) v.stop(stopAt, 0.02);
          voices.push(v);
        }
      }
      if (options.cues && options.onCue) {
        for (const { ev, beat } of collectEvents(options.cues, lengthBeats, loop, planned, to)) options.onCue(ev, timeline.time(beat), beat);
      }
      if (options.onBeat) {
        for (let b = Math.ceil(planned - 1e-9) + 0; b < to - 1e-9; b++) options.onBeat(b, timeline.time(b));
      }
      planned = to;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  tick();

  return {
    get endTime() {
      return endTime();
    },
    get planned() {
      return planned;
    },
    get running() {
      return running;
    },
    stop(at: number) {
      if (!running || at >= stopAt) return;
      stopAt = at;
      // cancel what is planned beyond `at`, fade what sounds at `at`
      for (const v of voices) v.stop(at, 0.02);
      if (at <= now()) {
        finish();
        voices = [];
      }
    },
  };
}
