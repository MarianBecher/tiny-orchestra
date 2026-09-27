import { describe, expect, test } from 'vitest';
import { midiToNote, noteToMidi, sequence, toMidi } from '../src/notes.ts';

describe('note names', () => {
  test('noteToMidi: scientific pitch notation', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('c-1')).toBe(0);
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('Bb5')).toBe(82);
    expect(noteToMidi('E♭4')).toBe(63);
    expect(noteToMidi('G♯2')).toBe(44);
    expect(noteToMidi('Cx4')).toBe(62);
    expect(noteToMidi('Dbb4')).toBe(60);
    expect(noteToMidi(' B#3 ')).toBe(60);
  });

  test('noteToMidi: NaN for anything else', () => {
    for (const bad of ['', 'H4', 'C', '4', 'C#', 'C4.5', 'Cb#4']) expect(noteToMidi(bad), bad).toBeNaN();
  });

  test('midiToNote round-trips with sharps', () => {
    expect(midiToNote(60)).toBe('C4');
    expect(midiToNote(61)).toBe('C#4');
    expect(midiToNote(0)).toBe('C-1');
    for (let m = 0; m < 128; m++) expect(noteToMidi(midiToNote(m))).toBe(m);
  });

  test('toMidi: numbers, names, null', () => {
    expect(toMidi(64)).toBe(64);
    expect(toMidi('E4')).toBe(64);
    expect(toMidi(null)).toBeNull();
    expect(toMidi(undefined)).toBeNull();
  });
});

describe('sequence', () => {
  test('notes one after the other, lengths carry over', () => {
    expect(sequence('C4 D4:2 E4 | F4:0.5')).toEqual([
      [0, 60, 1], [1, 62, 2], [3, 64, 2], [5, 65, 0.5],
    ]);
  });

  test('chords, rests, hits, variants, velocities, fractions, start and default length', () => {
    expect(sequence('C4+E4+G4:1/2 r x.soft@0.4 67:1@1', { start: 8, length: 2 })).toEqual([
      [8, 60, 0.5], [8, 64, 0.5], [8, 67, 0.5],
      [9, null, 0.5, 0.4, 'soft'],
      [9.5, 67, 1, 1],
    ]);
    expect(sequence('x.crash')).toEqual([[0, null, 1, undefined, 'crash']]);
  });

  test('typos throw', () => {
    expect(() => sequence('C4 H4')).toThrow(/H4/);
    expect(() => sequence('C4:0')).toThrow(/length/);
    expect(() => sequence('C4@2')).toThrow(/velocity/);
    expect(() => sequence('C4::2')).toThrow(/cannot read/);
  });

  test('empty text, no notes', () => {
    expect(sequence('  ')).toEqual([]);
  });
});
