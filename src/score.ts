// Scores as data: beats <-> time, length, and the flat event list the
// scheduler reads from. Pure functions, no AudioContext.

import { toMidi } from './notes.ts';
import type { DynamicsPoint, Part, Score } from './types.ts';

export const beatToTime = (beat: number, startTime: number, bpm: number): number => startTime + (beat * 60) / bpm;
export const timeToBeat = (time: number, startTime: number, bpm: number): number => ((time - startTime) * bpm) / 60;

/** A note of a score with part and call settings already applied. */
export interface ScoreEvent {
  beat: number;
  /** Index of the part in the score. */
  part: number;
  /** In beats. */
  length: number;
  instrument: string;
  midi: number | null;
  velocity: number;
  pan: number;
  variant: string | undefined;
}

/** What `scoreLength` needs of a score. */
export type ScoreShape = Pick<Score<string>, 'beatsPerBar' | 'lengthBeats'> & { parts?: readonly Pick<Part<string>, 'notes'>[] };

/** Length of a score in beats: as given, or rounded up to whole bars. */
export function scoreLength(score: ScoreShape): number {
  if (score.lengthBeats !== undefined && score.lengthBeats > 0) return score.lengthBeats;
  const bar = score.beatsPerBar || 4;
  let end = 0;
  for (const part of score.parts ?? []) {
    for (const n of part.notes) end = Math.max(end, n[0] + (n[2] || 0));
  }
  return Math.max(bar, Math.ceil(end / bar) * bar);
}

export interface FlattenOptions {
  /** Semitones added to every pitched note. */
  transpose?: number;
  /** Multiplies every velocity. */
  velocity?: number;
}

/**
 * Score -> flat event list sorted by beat. Transposition and level of the
 * part and of the call are applied here already, so that the scheduler only
 * has to read off events while the music is running.
 */
export function flattenScore(score: Pick<Score<string>, 'parts'>, { transpose = 0, velocity = 1 }: FlattenOptions = {}): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  score.parts.forEach((part, index) => {
    const pv = part.velocity ?? 0.7;
    for (const n of part.notes) {
      const [beat, pitch, length = 1, vel, variant] = n;
      const midi = toMidi(pitch);
      events.push({
        beat,
        part: index,
        length,
        instrument: part.instrument,
        midi: midi === null ? null : midi + (part.transpose || 0) + transpose,
        velocity: Math.max(0, Math.min(1, (vel ?? pv) * velocity)),
        pan: part.pan || 0,
        variant: variant ?? part.variant,
      });
    }
  });
  return events.sort((a, b) => a.beat - b.beat);
}

/** An event together with the absolute beat it sounds on. */
export interface Occurrence<E extends { beat: number } = ScoreEvent> {
  ev: E;
  beat: number;
}

/**
 * All events with a beat in [from, to). When looping, the score repeats every
 * `lengthBeats`; `beat` in the result is then the absolute beat since the
 * start (including the passes before).
 */
export function collectEvents<E extends { beat: number }>(
  events: readonly E[],
  lengthBeats: number,
  loop: boolean,
  from: number,
  to: number,
): Occurrence<E>[] {
  const out: Occurrence<E>[] = [];
  if (to <= from) return out;
  if (!loop) {
    for (const ev of events) if (ev.beat >= from && ev.beat < to && ev.beat < lengthBeats) out.push({ ev, beat: ev.beat });
    return out;
  }
  if (!(lengthBeats > 0)) return out;
  const first = Math.floor(from / lengthBeats);
  const last = Math.floor(to / lengthBeats);
  for (let k = first; k <= last; k++) {
    const base = k * lengthBeats;
    for (const ev of events) {
      if (ev.beat >= lengthBeats) continue; // would sound twice, again in the next pass
      const b = base + ev.beat;
      if (b >= from && b < to) out.push({ ev, beat: b });
    }
  }
  return out;
}

/** Position in beats for display: never negative, wrapped when looping. */
export function wrapPosition(beats: number, lengthBeats: number, loop: boolean): number {
  if (beats <= 0) return 0;
  if (loop) return lengthBeats > 0 ? beats % lengthBeats : 0;
  return Math.min(beats, lengthBeats);
}

/**
 * Next bar line at or after `beat`. Bars start on multiples of
 * `beatsPerBar`; when looping, every pass starts a new bar (even if the
 * length is not a whole number of bars). Without a loop, the end is the last
 * bar line.
 */
export function nextBarBeat(beat: number, beatsPerBar: number, lengthBeats: number, loop: boolean): number {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4;
  const eps = 1e-9;
  // `+ 0` turns the -0 that Math.ceil returns just below 0 into 0
  if (!loop || !(lengthBeats > 0)) return Math.min(Math.ceil(beat / bar - eps) * bar, loop ? Infinity : lengthBeats) + 0;
  const pass = Math.floor(beat / lengthBeats + eps);
  const local = Math.ceil((beat - pass * lengthBeats) / bar - eps) * bar + 0;
  return local >= lengthBeats - eps ? (pass + 1) * lengthBeats : pass * lengthBeats + local;
}

/** Bar number of `beat` if it starts a bar (see `nextBarBeat`), otherwise null. */
export function barAt(beat: number, beatsPerBar: number, lengthBeats: number, loop: boolean): number | null {
  const bar = beatsPerBar > 0 ? beatsPerBar : 4;
  const eps = 1e-9;
  if (!loop || !(lengthBeats > 0)) {
    const b = beat / bar;
    return Math.abs(b - Math.round(b)) < eps ? Math.round(b) : null;
  }
  const pass = Math.floor(beat / lengthBeats + eps);
  const local = (beat - pass * lengthBeats) / bar;
  if (Math.abs(local - Math.round(local)) > eps) return null;
  return pass * Math.ceil(lengthBeats / bar - eps) + Math.round(local);
}

/**
 * One point of a part's dynamics, flattened for the scheduler. A ramp is
 * planned together with the point it starts from - so a ramp to the very end
 * of the score (which is never planned as a beat of its own) still happens.
 */
export interface DynamicsCue {
  beat: number;
  part: number;
  /** Gain (the level squared). */
  gain: number;
  /** The next point, if the part ramps there from this one. */
  rampTo: { beat: number; gain: number } | null;
}

const levelGain = (level: number): number => {
  const l = Math.max(0, Math.min(1, level));
  return l * l;
};

/** Points sorted by beat, with one at beat 0 (the first level) so every loop pass starts the same. */
function normalizeDynamics(points: readonly DynamicsPoint[]): DynamicsPoint[] {
  const sorted = points.filter(([b, l]) => Number.isFinite(b) && b >= 0 && Number.isFinite(l)).sort((a, b) => a[0] - b[0]);
  if (sorted.length && sorted[0]![0] > 0) sorted.unshift([0, sorted[0]![1]]);
  return sorted;
}

/** All dynamics of a score as cues sorted by beat. */
export function flattenDynamics(score: Pick<Score<string>, 'parts'>): DynamicsCue[] {
  const cues: DynamicsCue[] = [];
  score.parts.forEach((part, index) => {
    const points = normalizeDynamics(part.dynamics ?? []);
    points.forEach(([beat, level], i) => {
      const next = points[i + 1];
      const rampTo = next && next[2] && next[0] > beat ? { beat: next[0], gain: levelGain(next[1]) } : null;
      cues.push({ beat, part: index, gain: levelGain(level), rampTo });
    });
  });
  return cues.sort((a, b) => a.beat - b.beat);
}

/**
 * Gain of a part's dynamics at `beat` (within one pass; 1 without
 * dynamics), and the ramp it is in the middle of, if any - where a
 * performance that starts at `beat` picks up.
 */
export function dynamicsAt(points: readonly DynamicsPoint[] | undefined, beat: number): { gain: number; rampTo: DynamicsCue['rampTo'] } {
  const pts = normalizeDynamics(points ?? []);
  if (!pts.length) return { gain: 1, rampTo: null };
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1]![0] <= beat) i++;
  const [b0, l0] = pts[i]!;
  const next = pts[i + 1];
  if (!next || !next[2] || next[0] <= b0) return { gain: levelGain(l0), rampTo: null };
  // a ramp interpolates the gain, as the AudioParam will
  const f = Math.max(0, Math.min(1, (beat - b0) / (next[0] - b0)));
  const target = levelGain(next[1]);
  // right on the point, its own cue plans the ramp
  return { gain: levelGain(l0) + (target - levelGain(l0)) * f, rampTo: beat > b0 ? { beat: next[0], gain: target } : null };
}
