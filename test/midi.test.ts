import { describe, expect, test } from 'vitest';
import { gmDrum, gmInstrument, midiToScore, parseMidi, type MidiGroup, type MidiNote } from '../src/midi.ts';
import { close } from './helpers.ts';

// A tiny SMF writer: tracks are lists of `[delta, ...bytes]` events, written
// as given (so running status is simply leaving out the status byte).

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

type Ev = [delta: number, ...bytes: number[]];

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];

function smf(format: number, division: number, tracks: Ev[][]): Uint8Array {
  const out = [...'MThd'].map((c) => c.charCodeAt(0));
  out.push(...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division));
  for (const events of tracks) {
    const body: number[] = [];
    for (const [delta, ...bytes] of events) body.push(...vlq(delta), ...bytes);
    body.push(0, 0xff, 0x2f, 0);
    out.push(...[...'MTrk'].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(out);
}

const on = (delta: number, key: number, vel = 100, ch = 0): Ev => [delta, 0x90 | ch, key, vel];
const off = (delta: number, key: number, ch = 0): Ev => [delta, 0x80 | ch, key, 0];
const program = (delta: number, p: number, ch = 0): Ev => [delta, 0xc0 | ch, p];
const tempo = (delta: number, bpm: number): Ev => {
  const us = Math.round(60e6 / bpm);
  return [delta, 0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
};
const timeSig = (num: number, denPow: number): Ev => [0, 0xff, 0x58, 4, num, denPow, 24, 8];
const name = (s: string): Ev => [0, 0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];

/** A group as `gmInstrument` sees it. */
const group = (prog: number, keys: number[]): MidiGroup => ({
  track: 0,
  trackName: undefined,
  channel: 0,
  program: prog,
  notes: keys.map((midi, i): MidiNote => ({ track: 0, channel: 0, program: prog, midi, velocity: 1, beat: i, length: 1 })),
});

describe('parseMidi', () => {
  test('format 0: notes, defaults, velocity, ArrayBuffer input', () => {
    const file = smf(0, 96, [[on(0, 60, 127), off(96, 60), on(0, 64, 64), off(48, 64)]]);
    const d = parseMidi(file.buffer.slice(0) as ArrayBuffer);
    expect(d.format).toBe(0);
    expect(d.ticksPerBeat).toBe(96);
    expect(d.tempo).toEqual([[0, 120]]);
    expect(d.beatsPerBar).toBe(4);
    expect(d.timeSignature).toEqual([4, 4]);
    expect(d.lengthBeats).toBe(1.5);
    expect(d.tracks).toEqual([{ name: undefined }]);
    expect(d.notes).toEqual([
      { track: 0, channel: 0, program: 0, midi: 60, velocity: 1, beat: 0, length: 1 },
      { track: 0, channel: 0, program: 0, midi: 64, velocity: 64 / 127, beat: 1, length: 0.5 },
    ]);
  });

  test('running status and note on with velocity 0 as note off', () => {
    // one status byte, then only data bytes; the offs are note ons with velocity 0
    const file = smf(0, 480, [[[0, 0x90, 60, 90], [0, 64, 80], [480, 60, 0], [240, 64, 0], [0, 0x91, 67, 70], [120, 67, 0]]]);
    const n = parseMidi(file).notes;
    expect(n.map((x) => [x.midi, x.channel, x.beat, x.length])).toEqual([
      [60, 0, 0, 1],
      [64, 0, 0, 1.5],
      [67, 1, 1.5, 0.25],
    ]);
  });

  test('running status survives meta and sysex events', () => {
    const file = smf(0, 4, [[[0, 0x90, 60, 90], name('x'), [0, 0xf0, 2, 0x7e, 0xf7], [4, 60, 0]]]);
    expect(parseMidi(file).notes.map((x) => x.length)).toEqual([1]);
  });

  test('other channel messages are skipped with their byte counts', () => {
    const file = smf(0, 4, [[
      [0, 0xb0, 7, 100], // control change
      [0, 0xe0, 0, 64], // pitch bend
      [0, 0xd0, 50], // channel pressure (1 data byte)
      [0, 0xa0, 60, 10], // key pressure
      on(0, 62), off(4, 62),
    ]]);
    expect(parseMidi(file).notes.map((x) => x.midi)).toEqual([62]);
  });

  test('overlapping notes of the same key pair first in, first out', () => {
    const file = smf(0, 4, [[on(0, 60, 100), on(4, 60, 50), off(4, 60), off(4, 60)]]);
    const n = parseMidi(file).notes;
    expect(n.map((x) => [x.beat, x.length])).toEqual([[0, 2], [1, 2]]);
    close(n[1]!.velocity, 50 / 127);
  });

  test('notes still held end with their track; stray note offs are ignored', () => {
    const file = smf(0, 4, [[off(0, 50), on(0, 60), on(4, 62), off(4, 62), [8, 0xb0, 1, 0]]]);
    const n = parseMidi(file).notes;
    expect(n.map((x) => [x.midi, x.beat, x.length])).toEqual([[60, 0, 4], [62, 1, 1]]);
    expect(parseMidi(file).lengthBeats).toBe(4);
  });

  test('format 1: tempo map, time signature, track names, programs', () => {
    const file = smf(1, 100, [
      [name('Conductor'), timeSig(3, 2), tempo(0, 90), tempo(300, 60), tempo(300, 60)],
      [name('Strings'), program(0, 48), on(0, 60), off(100, 60), program(0, 40), on(0, 67), off(100, 67)],
      [name('Brass'), program(0, 61, 1), on(50, 55, 100, 1), off(100, 55, 1)],
    ]);
    const d = parseMidi(file);
    expect(d.format).toBe(1);
    expect(d.tempo).toEqual([[0, 90], [3, 60]]); // repeated tempo dropped
    expect(d.timeSignature).toEqual([3, 4]);
    expect(d.beatsPerBar).toBe(3);
    expect(d.tracks.map((t) => t.name)).toEqual(['Conductor', 'Strings', 'Brass']);
    expect(d.notes.map((n) => [n.track, n.channel, n.program, n.midi, n.beat])).toEqual([
      [1, 0, 48, 60, 0],
      [2, 1, 61, 55, 0.5],
      [1, 0, 40, 67, 1],
    ]);
    expect(d.lengthBeats).toBe(6);
  });

  test('6/8 is 3 quarter notes per bar; a first tempo after beat 0 starts at 120', () => {
    const d = parseMidi(smf(0, 4, [[timeSig(6, 3), tempo(8, 100), on(0, 60), off(4, 60)]]));
    expect(d.beatsPerBar).toBe(3);
    expect(d.tempo).toEqual([[0, 120], [2, 100]]);
  });

  test('program changes on a channel apply to other tracks too', () => {
    const d = parseMidi(smf(1, 4, [[program(0, 73)], [on(4, 72), off(4, 72)]]));
    expect(d.notes[0]?.program).toBe(73);
  });

  test('errors: not MIDI, SMPTE division, format 2, truncated data', () => {
    expect(() => parseMidi(new Uint8Array(20))).toThrow(/MThd/);
    const smpte = smf(0, 0, [[on(0, 60), off(1, 60)]]);
    smpte[12] = 0xe7; // -25 fps
    smpte[13] = 40;
    expect(() => parseMidi(smpte)).toThrow(/SMPTE/);
    expect(() => parseMidi(smf(2, 96, [[]]))).toThrow(/format 2/);
    const file = smf(0, 96, [[on(0, 60), off(96, 60)]]);
    expect(() => parseMidi(file.subarray(0, file.length - 6))).toThrow(/end of data/);
    // a track too few, and a chunk whose events run past its end
    expect(() => parseMidi(file.subarray(0, 14))).toThrow(/tracks/);
    const bad = file.slice();
    bad[21] = 3; // MTrk length 3: the note on is cut off
    expect(() => parseMidi(bad.subarray(0, 25))).toThrow(/end of data/);
    // data byte without any status
    expect(() => parseMidi(smf(0, 96, [[[0, 60, 100]]]))).toThrow(/without status/);
  });
});

describe('gmInstrument', () => {
  test('specific programs', () => {
    expect(gmInstrument(group(40, [70]))).toBe('violins');
    expect(gmInstrument(group(43, [40]))).toBe('basses');
    expect(gmInstrument(group(46, [60]))).toBe('harp');
    expect(gmInstrument(group(47, [45]))).toBe('timpani');
    expect(gmInstrument(group(57, [50]))).toBe('trombone');
    expect(gmInstrument(group(60, [60]))).toBe('horn');
    expect(gmInstrument(group(71, [60]))).toBe('clarinet');
    expect(gmInstrument(group(73, [80]))).toBe('flute');
    expect(gmInstrument(group(9, [90]))).toBe('glockenspiel');
    expect(gmInstrument(group(12, [70]))).toBe('marimba');
    expect(gmInstrument(group(0, [60]))).toBe('harp'); // piano
    expect(gmInstrument(group(25, [60]))).toBe('harp'); // guitar
  });

  test('families by median pitch', () => {
    expect(gmInstrument(group(48, [72, 76, 79]))).toBe('violins');
    expect(gmInstrument(group(48, [55, 60, 62]))).toBe('violas');
    expect(gmInstrument(group(49, [36, 48, 52]))).toBe('celli');
    expect(gmInstrument(group(89, [28, 33, 40]))).toBe('basses');
    expect(gmInstrument(group(61, [67, 72]))).toBe('trumpet');
    expect(gmInstrument(group(61, [55, 60]))).toBe('horn');
    expect(gmInstrument(group(62, [45, 50]))).toBe('trombone');
    expect(gmInstrument(group(63, [30, 36]))).toBe('tuba');
    expect(gmInstrument(group(65, [80]))).toBe('flute');
    expect(gmInstrument(group(65, [70]))).toBe('oboe');
    expect(gmInstrument(group(66, [60]))).toBe('clarinet');
    expect(gmInstrument(group(67, [40]))).toBe('bassoon');
    expect(gmInstrument(group(45, [60, 67]))).toBe('violinsPizz');
    expect(gmInstrument(group(45, [36, 43]))).toBe('celliPizz');
  });

  test('gmDrum', () => {
    expect(gmDrum(36)).toEqual({ instrument: 'bassdrum', variant: 'hit' });
    expect(gmDrum(51)).toEqual({ instrument: 'cymbal', variant: 'soft' });
    expect(gmDrum(75)).toEqual({ instrument: 'woodblock', variant: 'claves' });
    expect(gmDrum(42)).toBeNull(); // closed hi-hat
  });
});

describe('midiToScore', () => {
  const file = smf(1, 4, [
    [tempo(0, 100), timeSig(3, 2), tempo(12, 80)],
    [name('Melody'), program(0, 56), on(0, 72, 127), off(4, 72), on(0, 74, 64), off(2, 74), program(0, 48), on(0, 60), off(4, 60)],
    [
      name('Drums'),
      on(0, 36, 127, 9), off(1, 36, 9),
      on(0, 49, 100, 9), on(0, 42, 100, 9), off(1, 49, 9), off(0, 42, 9),
      on(0, 38, 100, 9), off(1, 38, 9),
      on(0, 51, 100, 9), off(1, 51, 9),
    ],
  ]);
  const data = parseMidi(file);

  test('parts per program and per drum instrument, tempo, bars', () => {
    const s = midiToScore(data);
    expect(s.bpm).toBe(100);
    expect(s.tempo).toEqual([[0, 100], [3, 80]]);
    expect(s.beatsPerBar).toBe(3);
    expect(s.lengthBeats).toBe(3); // notes end at 2.5 and the tempo change at 3
    expect(s.parts.map((p) => [p.instrument, p.name])).toEqual([
      ['trumpet', 'Melody'],
      ['violas', 'Melody 2'],
      ['bassdrum', 'bassdrum'],
      ['cymbal', 'cymbal'],
      ['snare', 'snare'],
    ]);
    const [trumpet, , bassdrum, cymbal] = s.parts;
    expect(trumpet!.notes).toEqual([[0, 72, 1, 1], [1, 74, 0.5, 0.503937]]);
    expect(bassdrum!.notes).toEqual([[0, null, 0.25, 1, 'hit']]);
    expect(cymbal!.notes.map((n) => [n[0], n[1], n[4]])).toEqual([[0.25, null, 'crash'], [0.75, null, 'soft']]);
  });

  test('a single tempo gives no tempo map; length rounds up to bars', () => {
    const s = midiToScore(parseMidi(smf(0, 3, [[on(0, 60), off(13, 60)]])));
    expect(s.bpm).toBe(120);
    expect(s.tempo).toBeUndefined();
    expect(s.lengthBeats).toBe(8);
    expect(s.parts[0]?.notes).toEqual([[0, 60, 4.333333, 0.787402]]);
  });

  test('custom mapping; null drops a group, drums can be ordinary', () => {
    const s = midiToScore<string>(data, {
      instrument: (g) => (g.program === 48 ? null : `p${g.program}c${g.channel}`),
      drums: false,
    });
    expect(s.parts.map((p) => [p.instrument, p.name])).toEqual([['p56c0', 'Melody'], ['p0c9', 'Drums']]);
    expect(s.parts[1]?.notes.map((n) => n[1])).toEqual([36, 42, 49, 38, 51]);
  });

  test('custom drums', () => {
    const s = midiToScore(data, { drums: (key) => (key === 42 ? { instrument: 'triangle', variant: 'muted' } : null) });
    const parts = s.parts.filter((p) => p.instrument === 'triangle');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.notes).toEqual([[0.25, null, 0.25, 0.787402, 'muted']]);
  });
});
