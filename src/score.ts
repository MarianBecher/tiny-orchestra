// Scores as data: beats <-> time, length, and the flat event list the
// scheduler reads from. Pure functions, no AudioContext.

import type { Part, Score } from './types.ts';

export const beatToTime = (beat: number, startTime: number, bpm: number): number => startTime + (beat * 60) / bpm;
export const timeToBeat = (time: number, startTime: number, bpm: number): number => ((time - startTime) * bpm) / 60;

/** A note of a score with part and call settings already applied. */
export interface ScoreEvent {
  beat: number;
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
  for (const part of score.parts) {
    const pv = part.velocity ?? 0.7;
    for (const n of part.notes) {
      const [beat, midi, length = 1, vel, variant] = n;
      events.push({
        beat,
        length,
        instrument: part.instrument,
        midi: midi == null ? null : midi + (part.transpose || 0) + transpose,
        velocity: Math.max(0, Math.min(1, (vel ?? pv) * velocity)),
        pan: part.pan || 0,
        variant: variant ?? part.variant,
      });
    }
  }
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
