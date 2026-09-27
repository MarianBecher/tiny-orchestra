// Note names and a compact text notation for writing parts by hand. Pure.

import type { ScoreNote } from './types.ts';

const STEPS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE = /^([a-g])(#{1,2}|b{1,2}|♯|♭|x)?(-?\d+)$/i;

/**
 * MIDI number of a note name in scientific pitch notation: `"C4"` = 60,
 * `"F#3"`, `"Bb5"`, `"C-1"` = 0. Sharps `#`/`♯`/`x` (double), flats
 * `b`/`♭`. NaN for anything else.
 */
export function noteToMidi(name: string): number {
  const m = NOTE.exec(name.trim());
  if (!m) return NaN;
  const acc = m[2] ?? '';
  const shift = acc === 'x' ? 2 : acc.startsWith('#') || acc === '♯' ? acc.length : acc.startsWith('b') || acc === '♭' ? -acc.length : 0;
  return (Number(m[3]) + 1) * 12 + STEPS[m[1]!.toLowerCase()]! + shift;
}

/** Note name of a MIDI number, with sharps: 60 -> `"C4"`, 61 -> `"C#4"`. */
export function midiToNote(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** A pitch as a score may give it: MIDI number, note name, or null (unpitched). */
export function toMidi(pitch: number | string | null | undefined): number | null {
  if (pitch == null) return null;
  return typeof pitch === 'number' ? pitch : noteToMidi(pitch);
}

export interface SequenceOptions {
  /** Beat of the first note. Default 0. */
  start?: number;
  /** Length of a note that gives none, until one does. Default 1. */
  length?: number;
}

/**
 * Notes of a part written as text, one token after the other:
 *
 *     sequence('C4 D4 E4:2 | G4+B4+D5:4 r:1 x:0.5@0.9')
 *
 * - `C4`, `F#3`, `Bb5` - a note (or a MIDI number, `60`)
 * - `C4+E4+G4` - a chord
 * - `x` - an unpitched hit, `x.soft` with a variant
 * - `r` - a rest
 * - `:2` - length in beats; it carries over to the following tokens
 * - `@0.8` - velocity of this token
 * - `|` - a bar line, ignored (only for reading)
 *
 * Throws on a token it does not understand - the text is written by hand
 * and a typo should not go unnoticed.
 */
export function sequence(text: string, { start = 0, length = 1 }: SequenceOptions = {}): ScoreNote[] {
  const notes: ScoreNote[] = [];
  let beat = start;
  let len = length;
  for (const token of text.split(/\s+/)) {
    if (!token || token === '|') continue;
    const m = /^([^:@]+)(?::([\d.]+(?:\/\d+)?))?(?:@([\d.]+))?$/.exec(token);
    if (!m) throw new Error(`sequence: cannot read "${token}"`);
    if (m[2] !== undefined) {
      const [num, den] = m[2].split('/');
      len = Number(num) / (den === undefined ? 1 : Number(den));
      if (!(len > 0)) throw new Error(`sequence: bad length in "${token}"`);
    }
    const vel = m[3] === undefined ? undefined : Number(m[3]);
    if (vel !== undefined && !(vel >= 0 && vel <= 1)) throw new Error(`sequence: bad velocity in "${token}"`);
    const head = m[1]!;
    if (head !== 'r') {
      for (const p of head.split('+')) {
        const [name, variant] = p.split('.');
        let midi: number | null;
        if (name === 'x') midi = null;
        else if (/^\d+$/.test(name!)) midi = Number(name);
        else {
          midi = noteToMidi(name!);
          if (Number.isNaN(midi)) throw new Error(`sequence: unknown note "${p}" in "${token}"`);
        }
        const note: ScoreNote = [beat, midi, len];
        if (vel !== undefined || variant !== undefined) note.push(vel);
        if (variant !== undefined) note.push(variant);
        notes.push(note);
      }
    }
    beat += len;
  }
  return notes;
}
