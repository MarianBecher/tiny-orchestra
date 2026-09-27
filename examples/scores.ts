// Example scores for the bundled instruments: short, original or public
// domain, each showing a few features of the score format. Not part of the
// package - material for trying the library, for the tests and the browser
// check, and a starting point for your own.

import { sequence, type Score } from '../src/index.ts';

/**
 * Fanfare in C major, 4/4, 5 bars: trumpet melody over horns, trombones and
 * tuba (I - IV - V - V7 - I), timpani on tonic and dominant, ending on a held
 * chord with a cymbal crash. Shows chords and note names via `sequence()`.
 */
export const fanfare: Score = {
  bpm: 112,
  beatsPerBar: 4,
  lengthBeats: 20,
  parts: [
    {
      name: 'trumpet',
      instrument: 'trumpet',
      velocity: 0.85,
      pan: -0.2,
      notes: sequence(`
        C5:1.5 G4:0.5 C5 E5 G5:1 |
        A5:1.5 F5:0.5 C5 F5 A5:1 |
        G5:1.5 D5:0.5 B4 D5 G5:1 |
        F5:1.5 D5:0.5 B4 G4 B4:1 |
        C5:4
      `),
    },
    {
      name: 'horns',
      instrument: 'horn',
      velocity: 0.7,
      pan: -0.45,
      notes: sequence(`
        E4+G4:1.5 E4+G4:0.5 E4+G4:2 |
        F4+A4:1.5 F4+A4:0.5 F4+A4:2 |
        D4+G4:1.5 D4+G4:0.5 D4+G4:2 |
        D4+F4:1.5 D4+F4:0.5 D4+F4:2 |
        C4+E4:4
      `),
    },
    {
      name: 'trombones',
      instrument: 'trombone',
      velocity: 0.7,
      pan: 0.3,
      notes: sequence(`
        C3+G3:1.5 C3+G3:0.5 C3+G3:2 |
        C3+F3:1.5 C3+F3:0.5 C3+F3:2 |
        B2+D3:1.5 B2+D3:0.5 B2+D3:2 |
        B2+D3:1.5 B2+D3:0.5 B2+D3:2 |
        C3+G3:4
      `),
    },
    {
      name: 'tuba',
      instrument: 'tuba',
      velocity: 0.75,
      pan: 0.45,
      notes: sequence('C2:1.5 C2:0.5 C2:2 | F2:1.5 F2:0.5 F2:2 | G2:1.5 G2:0.5 G2:2 | G2:1.5 G2:0.5 G2:2 | C2:4'),
    },
    {
      name: 'timpani',
      instrument: 'timpani',
      velocity: 0.7,
      pan: 0.1,
      notes: sequence(`
        C3:1 r G2:0.5 G2 C3:1 |
        C3 r G2:0.5 G2 C3:1 |
        G2 r G2:0.5 G2 G2:1 |
        G2 G2 G2:0.5 G2 G2:1 |
        C3:4@0.9
      `),
    },
    {
      name: 'cymbal',
      instrument: 'cymbal',
      velocity: 0.8,
      pan: 0,
      notes: [[16, null, 4, undefined, 'crash']],
    },
  ],
};

// Waltz harmony, one bar each: cello root, violin chord on 2 and 3.
const WALTZ: [root: string, chord: string][] = [
  ['G2', 'G4+B4+D5'],   // G
  ['E2', 'G4+B4+E5'],   // e
  ['A2', 'A4+C5+E5'],   // a
  ['D2', 'A4+C5+F#5'],  // D7
  ['G2', 'B4+D5+G5'],   // G
  ['C3', 'C5+E5+G5'],   // C
  ['D3', 'C5+D5+F#5'],  // D7
  ['G2', 'B4+D5+G5'],   // G
];

/**
 * Waltz in G major, 3/4, 8 bars, loopable: oom-pah-pah with pizzicato celli
 * on 1 and pizzicato violin chords on 2 and 3, flute melody on top. Shows
 * `beatsPerBar: 3` and named parts (to mute or fade with `performance.part()`).
 */
export const waltz: Score = {
  bpm: 168,
  beatsPerBar: 3,
  lengthBeats: 24,
  parts: [
    {
      name: 'bass',
      instrument: 'celliPizz',
      velocity: 0.75,
      pan: 0.3,
      notes: WALTZ.flatMap(([root], bar) => sequence(`${root}:1`, { start: bar * 3 })),
    },
    {
      name: 'chords',
      instrument: 'violinsPizz',
      velocity: 0.5,
      pan: -0.3,
      notes: WALTZ.flatMap(([, chord], bar) => sequence(`${chord}:1 ${chord}@0.4`, { start: bar * 3 + 1 })),
    },
    {
      name: 'melody',
      instrument: 'flute',
      velocity: 0.65,
      pan: 0.1,
      notes: sequence(`
        B5:2 D6:1 | E6:2 B5:1 | C6:2 A5:1 | F#5:2 A5:0.5 C6 |
        B5:2 G5:1 | E6:2 C6:1 | A5:2 F#5:1 | G5:3
      `),
    },
  ],
};

/**
 * Ode to Joy (Beethoven, Symphony No. 9, public domain), 8 bars in C major,
 * 4/4: the melody on flute over a four-part string harmonization
 * (violins in two voices, violas, celli, basses an octave below the celli).
 */
export const odeToJoy: Score = {
  bpm: 100,
  beatsPerBar: 4,
  lengthBeats: 32,
  parts: [
    {
      name: 'melody',
      instrument: 'flute',
      velocity: 0.7,
      pan: 0.15,
      notes: sequence(`
        E5:1 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | E5:1.5 D5:0.5 D5:2 |
        E5:1 E5 F5 G5 | G5 F5 E5 D5 | C5 C5 D5 E5 | D5:1.5 C5:0.5 C5:2
      `),
    },
    {
      // C | G7 C | a G | C G | C | G7 C | F G | G7 C
      name: 'violins',
      instrument: 'violins',
      velocity: 0.45,
      pan: -0.4,
      notes: sequence(`
        C5+G4:4 | B4+G4:2 C5+G4 | C5+A4 D5+B4 | C5+G4 B4+G4 |
        C5+G4:4 | B4+G4:2 C5+G4 | C5+A4 B4+G4 | B4+G4 C5+G4
      `),
    },
    {
      name: 'violas',
      instrument: 'violas',
      velocity: 0.45,
      pan: 0.05,
      notes: sequence('E4:4 | F4:2 E4 | E4 G4 | E4 D4 | E4:4 | F4:2 E4 | F4 D4 | F4 E4'),
    },
    {
      name: 'celli',
      instrument: 'celli',
      velocity: 0.5,
      pan: 0.3,
      notes: sequence('C3:4 | G2:2 C3 | A2 G2 | C3 G2 | C3:4 | G2:2 C3 | F2 G2 | G2 C3'),
    },
    {
      name: 'basses',
      instrument: 'basses',
      velocity: 0.45,
      pan: 0.45,
      transpose: -12,
      notes: sequence('C3:4 | G2:2 C3 | A2 G2 | C3 G2 | C3:4 | G2:2 C3 | F2 G2 | G2 C3'),
    },
  ],
};

/**
 * Drum roll: two bars of snare roll from pianissimo to fortissimo, a timpani
 * roll joining for the second bar, landing on bass drum, cymbal crash,
 * snare and timpani. Shows part `dynamics` with ramps (crescendo) and
 * unpitched variants.
 */
export const drumroll: Score = {
  bpm: 96,
  beatsPerBar: 4,
  lengthBeats: 12,
  parts: [
    {
      name: 'snare roll',
      instrument: 'snareRoll',
      velocity: 0.9,
      pan: -0.15,
      dynamics: [[0, 0.1], [8, 1, true]],
      notes: sequence('x.roll:8'),
    },
    {
      name: 'timpani roll',
      instrument: 'timpaniRoll',
      velocity: 0.8,
      pan: 0.1,
      dynamics: [[4, 0.2], [8, 1, true]],
      notes: sequence('C3:4', { start: 4 }),
    },
    { name: 'snare', instrument: 'snare', velocity: 0.65, pan: -0.15, notes: sequence('x:1', { start: 8 }) },
    { name: 'bass drum', instrument: 'bassdrum', velocity: 0.75, pan: 0, notes: sequence('x.hit:4', { start: 8 }) },
    { name: 'cymbal', instrument: 'cymbal', velocity: 0.7, pan: 0.2, notes: sequence('x.crash:4', { start: 8 }) },
    { name: 'timpani', instrument: 'timpani', velocity: 0.75, pan: 0.1, notes: sequence('C3:4', { start: 8 }) },
  ],
};

/**
 * Closing cadence in C major for strings in four parts:
 * I - vi - IV - ii6 - I6/4 - V7 - I. The tempo holds for the first three
 * chords, then slows down gradually into the final chord. Shows `tempo`
 * changes with a ramp (ritardando).
 */
export const cadence: Score = {
  bpm: 72,
  tempo: [[6, 72], [12, 44, true]],
  beatsPerBar: 4,
  lengthBeats: 16,
  parts: [
    { name: 'violins', instrument: 'violins', velocity: 0.6, pan: -0.4, notes: sequence('E5:2 E5 F5 F5 E5 D5 | C5:4') },
    { name: 'violas', instrument: 'violas', velocity: 0.55, pan: -0.1, notes: sequence('G4:2 A4 A4 A4 G4 F4 | E4:4') },
    { name: 'celli', instrument: 'celli', velocity: 0.55, pan: 0.2, notes: sequence('C4:2 C4 C4 D4 C4 B3 | C4:4') },
    { name: 'basses', instrument: 'basses', velocity: 0.6, pan: 0.4, notes: sequence('C3:2 A2 F2 F2 G2 G2 | C2:4') },
    { name: 'timpani', instrument: 'timpani', velocity: 0.5, pan: 0.1, notes: sequence('C3:4@0.6', { start: 12 }) },
  ],
};

/** All example scores by name, e.g. to list them in a demo. */
export const scores: Record<string, Score> = { fanfare, waltz, odeToJoy, drumroll, cadence };
