// A canon on Pachelbel's ground bass, in D major. Eight chords, two beats
// each, make one round of four bars. The round repeats while the orchestra
// joins layer by layer, turns to pizzicato for a moment, comes back in full
// and slows down into the last chord.
//
// Change anything and press "Play changes" (or Ctrl+Enter). While the piece
// is playing, your version takes over at the next bar line.

import { sequence } from 'tiny-orchestra';

const ROUND = 16; // beats: D A | Bm F#m | G D | G A

/** `text` in round `round`, repeated `times` times. */
const from = (round, text, times = 1) =>
  sequence(Array(times).fill(text).join(' '), { start: round * ROUND });

const ground    = 'D3:2 A2 B2 F#2 G2 D2 G2 A2';
const groundLow = 'D2:2 A1 B1 F#1 G1 D2 G1 A1';
const plucks    = 'D3:1 D3 A2 A2 B2 B2 F#2 F#2 G2 G2 D2 D2 G2 G2 A2 A2';
const thirds    = 'F#4:2 E4 D4 C#4 B3 A3 B3 C#4';   // the canon line
const sixths    = 'D5:2 C#5 B4 A4 G4 F#4 G4 A4';     // a sixth above it
const high      = 'F#5:2 E5 D5 C#5 B4 A4 B4 C#5';
const counter   = 'A5:1 F#5 E5 A5 F#5 D5 C#5 F#5 D5 B4 A4 D5 B4 D5 C#5 E5';
const horns     = 'A3:2 A3 B3 A3 B3 A3 B3 A3';
const arpeggio  = 'D3:1/2 A3 D4 F#4 A2 E3 A3 C#4 B2 F#3 B3 D4 F#2 C#3 F#3 A3 ' +
                  'G2 D3 G3 B3 D3 A3 D4 F#4 G2 D3 G3 B3 A2 E3 A3 C#4';
const broken    = 'F#4:1/2 A4 D5 A4 E4 A4 C#5 A4 F#4 B4 D5 B4 F#4 A4 C#5 A4 ' +
                  'G4 B4 D5 B4 F#4 A4 D5 A4 G4 B4 D5 B4 E4 A4 C#5 E5';

export default {
  bpm: 72,
  // steady until the last round, then slowing down into the final chord
  tempo: [[80, 72], [96, 52, true]],
  lengthBeats: 6 * ROUND + 8,
  parts: [
    {
      name: 'Flute', instrument: 'flute', velocity: 0.6, pan: 0.2,
      notes: [...from(3, counter), ...from(5, counter), ...from(6, 'A5:8')],
    },
    {
      name: 'Oboe', instrument: 'oboe', velocity: 0.55, pan: 0.1,
      notes: from(4, high),
    },
    {
      name: 'Horns', instrument: 'horn', velocity: 0.45, pan: -0.3,
      notes: [...from(5, horns), ...from(6, 'D4:8')],
    },
    {
      name: 'Timpani', instrument: 'timpani', velocity: 0.6,
      notes: [...from(5, 'D3:4 r D3 r:2 A2'), ...from(6, 'D3:8')],
    },
    {
      name: 'Cymbal', instrument: 'cymbal', velocity: 0.45, pan: 0.3,
      notes: from(6, 'x.soft:8'),
    },
    {
      name: 'Harp', instrument: 'harp', velocity: 0.5, pan: -0.25,
      notes: [
        ...from(3, arpeggio),
        ...from(5, arpeggio),
        ...from(6, 'D2:1/4 A2 D3 F#3 A3 D4 F#4 A4:6'), // a rolled chord
      ],
    },
    {
      name: 'Violins pizzicato', instrument: 'violinsPizz', velocity: 0.55, pan: -0.35,
      notes: from(4, broken),
    },
    {
      name: 'Violins', instrument: 'violins', velocity: 0.55, pan: -0.4,
      notes: [...from(2, sixths, 2), ...from(5, high), ...from(6, 'D5+F#5:8')],
    },
    {
      name: 'Violas', instrument: 'violas', velocity: 0.5, pan: 0.15,
      notes: [...from(1, thirds, 3), ...from(5, thirds), ...from(6, 'A3+F#4:8')],
    },
    {
      name: 'Celli', instrument: 'celli', velocity: 0.55, pan: 0.3,
      // a crescendo through the first round, a diminuendo on the last chord
      dynamics: [[0, 0.5], [16, 1, true], [96, 1], [104, 0.6, true]],
      notes: [...from(0, ground, 4), ...from(5, ground), ...from(6, 'D3:8')],
    },
    {
      name: 'Celli pizzicato', instrument: 'celliPizz', velocity: 0.6, pan: 0.3,
      notes: from(4, plucks),
    },
    {
      name: 'Basses', instrument: 'basses', velocity: 0.5, pan: 0.4,
      dynamics: [[16, 0.4], [32, 1, true]],
      notes: [...from(1, groundLow, 3), ...from(5, groundLow), ...from(6, 'D2:8')],
    },
  ],
};
