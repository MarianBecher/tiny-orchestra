// Which VSCO files become which instrument.
//
// File names in VSCO-2-CE are not uniform: most folders count octaves one too
// low (the viola calls it "C2", but it sounds at the viola's lowest note, C3),
// harp, glockenspiel and marimba count differently. So every instrument has
// an `octave` that is added to the octave number in the name. Whether that is
// right is checked by the build with a pitch measurement (scripts/lib/dsp.ts,
// detectPitch) - so the value here is not a guess, but what the measurement
// confirmed.

import type { PitchMethod } from './lib/dsp.ts';

/** Settings every kind of instrument shares. */
export interface BaseConfig {
  /** Sustained tone with a baked-in loop. */
  sustain?: boolean;
  /** Maximum length from the onset in seconds (decaying tones). */
  maxLen?: number;
  /** Whether `duration` damps decaying tones (pizzicato yes, harp no - you let that ring). */
  damp?: boolean;
  /** Release time after the end of a note in seconds. */
  release: number;
  /** Mix level relative to the other instruments (after loudness normalization, so only taste). */
  gain: number;
  /**
   * MP3 bitrate if not 96 - low instruments have hardly any highs, 80 kbit/s
   * is inaudible there but saves space.
   */
  kbps?: number;
  /** 'spectrum' instead of YIN for the pitch check (glockenspiel). */
  pitchMethod?: PitchMethod;
}

export interface PitchedConfig extends BaseConfig {
  /** Folder in the repository (direct files only). */
  dir: string;
  /** Pattern with the named groups note (e.g. "F#3"), v (dynamic), rr (round robin, optional). */
  re: RegExp;
  /** Added to the octave number in the file name. */
  octave: number;
  /** Which dynamic layers (value of v) count with which velocity - one layer = one file per note. */
  layers: Record<string, number>;
  /** Minimum distance in semitones between two kept notes. */
  gap: number;
  /** Different gap for single dynamic layers. */
  gapByLayer?: Record<string, number>;
  /** [lowest, highest] MIDI note that is kept. */
  range?: [number, number];
  /** Among several layers with the same velocity, prefer this one. */
  preferLayer?: string;
  /** Files (substring) that match the name but are no good. */
  exclude?: string[];
  /** Misnamed notes: name in the file -> actual note. */
  rename?: Record<string, string>;
}

export interface TimpaniConfig extends BaseConfig {
  files: string[];
}

export interface UnpitchedSampleConfig {
  variant: string;
  file: string;
  /** Crescendo: measure where it peaks. */
  swell?: boolean;
}

export interface UnpitchedConfig extends BaseConfig {
  /** Explicitly chosen files per variant; the first variant is the default. */
  samples: UnpitchedSampleConfig[];
}

const STD = /_(?<note>[A-G]#?-?\d)_v(?<v>\d)(?:_(?:rr)?(?<rr>\d))?/i;

export const PITCHED: Record<string, PitchedConfig> = {
  violins: {
    dir: 'Strings/Violin Section/susVib', re: STD, octave: 1,
    layers: { 1: 0.5, 2: 1.0 }, gap: 2, gapByLayer: { 1: 5 },
    sustain: true, release: 0.35, gain: 1.0,
  },
  violas: {
    dir: 'Strings/Viola Section/susvib', re: STD, octave: 1,
    layers: { 2: 1.0 }, gap: 3, range: [48, 84],
    sustain: true, release: 0.35, gain: 1.0,
  },
  celli: {
    // Above D5, violas and violins take over - saves ~100 KB
    dir: 'Strings/Cello Section/susvib', re: STD, octave: 1,
    layers: { 3: 1.0 }, gap: 3, kbps: 80, range: [36, 72],
    sustain: true, release: 0.4, gain: 1.0,
  },
  basses: {
    dir: 'Strings/Solo Contrabass/SusNV', re: STD, octave: 1,
    layers: { 3: 1.0 }, gap: 3, kbps: 80,
    sustain: true, release: 0.4, gain: 1.0,
  },
  violinsPizz: {
    dir: 'Strings/Violin Section/Pizz', re: STD, octave: 1,
    layers: { 2: 1.0 }, gap: 2,
    maxLen: 1.5, damp: true, release: 0.12, gain: 1.0,
  },
  celliPizz: {
    dir: 'Strings/Cello Section/pizzT', re: STD, octave: 1,
    // The low C of the loud layer has neither fundamental nor third partial
    // in its spectrum - so it sounds an octave higher than named. The quiet
    // layer steps in there.
    layers: { 1: 1.0, 2: 1.0 }, preferLayer: '2', exclude: ['pizzT_C1_v2'], gap: 3, kbps: 80,
    maxLen: 2.0, damp: true, release: 0.15, gain: 1.0,
  },
  harp: {
    dir: 'Strings/Harp', re: /_(?<note>[A-G]#?\d)_(?<v>mp|mf|f)\.wav$/, octave: 0,
    layers: { mp: 1.0, mf: 1.0, f: 1.0 }, gap: 5,
    maxLen: 3.5, damp: false, release: 0.3, gain: 1.0,
  },
  flute: {
    dir: 'Woodwinds/Flute/susNV', re: STD, octave: 1,
    layers: { 3: 1.0, 2: 1.0 }, gap: 3, preferLayer: '3',
    sustain: true, release: 0.2, gain: 0.9,
  },
  oboe: {
    dir: 'Woodwinds/Oboe/Sus', re: /_(?<note>[A-G]#?\d)_v(?<v>\d)_Main/, octave: 1,
    layers: { 3: 1.0 }, gap: 3,
    sustain: true, release: 0.2, gain: 0.85,
  },
  clarinet: {
    dir: 'Woodwinds/Clarinet/susLong', re: STD, octave: 1,
    // "F#5" is an F in all three dynamic layers (measured -99 cents)
    rename: { 'F#5': 'F5' },
    layers: { 2: 1.0 }, gap: 3,
    sustain: true, release: 0.2, gain: 0.9,
  },
  bassoon: {
    dir: 'Woodwinds/Bassoon/sus', re: /_(?<note>[A-G]#?\d)_v(?<v>\d)_(?<rr>\d)/, octave: 1,
    layers: { 2: 1.0 }, gap: 3, kbps: 80,
    sustain: true, release: 0.2, gain: 0.9,
  },
  horn: {
    // The middle layer is missing at the very top (and bottom); the quiet one
    // steps in there - otherwise the instrument would stop mid-range.
    dir: 'Brass/F Horn/sus', re: STD, octave: 1,
    layers: { 1: 1.0, 2: 1.0 }, preferLayer: '2', gap: 3, kbps: 80,
    sustain: true, release: 0.3, gain: 0.9,
  },
  trumpet: {
    dir: 'Brass/Trumpet/sus', re: STD, octave: 1,
    layers: { 1: 1.0 }, gap: 3,
    sustain: true, release: 0.25, gain: 0.75,
  },
  trombone: {
    dir: 'Brass/Tenor Trombone/sus', re: STD, octave: 1,
    layers: { 2: 1.0 }, gap: 3, kbps: 80,
    sustain: true, release: 0.3, gain: 0.85,
  },
  tuba: {
    // The middle layer is missing at the very top (and bottom); the quiet one
    // steps in there - otherwise the instrument would stop mid-range.
    dir: 'Brass/Tuba/sus', re: STD, octave: 1,
    layers: { 1: 1.0, 2: 1.0 }, preferLayer: '2', gap: 3, kbps: 80,
    sustain: true, release: 0.3, gain: 0.9,
  },
  glockenspiel: {
    dir: 'Percussion/Glock', re: /_(?<note>[A-G]#?\d)\.wav$/, octave: 1,
    layers: { '': 1.0 }, gap: 3, pitchMethod: 'spectrum',
    maxLen: 3.0, damp: false, release: 0.3, gain: 0.55,
  },
  marimba: {
    dir: 'Percussion/Marimba', re: /_(?<note>[A-G]#?\d)_loud/, octave: 1,
    layers: { '': 1.0 }, gap: 3,
    maxLen: 2.5, damp: false, release: 0.2, gain: 0.8,
  },
};

// Timpani carry no note names, only the kettle number - the pitch is
// measured (see build-samples.ts) and snapped to the nearest semitone.
const timp = (n: number, v: number, dir = 'Percussion/Timpani', kind = 'Hit'): string =>
  `${dir}/Timpani${n}_${kind}_v${v}_rr1_Sum.wav`;

export const TIMPANI: Record<string, TimpaniConfig> = {
  timpani: {
    files: [1, 2, 3, 4, 5].map((n) => timp(n, 3)), kbps: 80,
    maxLen: 4.0, damp: false, release: 0.4, gain: 1.0,
  },
  timpaniRoll: {
    files: [1, 2, 3, 4].map((n) => timp(n, 3, 'Percussion/Timpani/Rolls', 'Roll'))
      .concat(timp(5, 3, 'Percussion/Timpani/Rolls', 'Roll')),
    sustain: true, release: 0.6, gain: 0.9, kbps: 80,
  },
};

// Unpitched: explicitly chosen files per variant. The first variant is the
// default when note() names none.
const P = 'Percussion';
const V1 = 'VSCO 1 Percussion';
export const UNPITCHED: Record<string, UnpitchedConfig> = {
  cymbal: {
    maxLen: 4.5, release: 0.5, gain: 0.7,
    samples: [
      { variant: 'crash', file: `${P}/cymbal-crash1_ff_rr1.wav` },
      { variant: 'crash', file: `${P}/cymbal-crash1_ff_rr2.wav` },
      // Swelling cymbal: the climax is at the end, so `peak` is measured
      // too - that way it can be placed on a beat.
      { variant: 'swell', file: `${P}/susCymb1-cresc-Median_v1.wav`, swell: true },
      { variant: 'soft', file: `${P}/susCymb1-hit_pp_rr1.wav` },
      { variant: 'soft', file: `${P}/susCymb1-hit_pp_rr2.wav` },
    ],
  },
  bassdrum: {
    maxLen: 3.0, release: 0.3, gain: 1.0, kbps: 80,
    samples: [
      { variant: 'hit', file: `${P}/BDrumNewhit_v6_rr1_Sum.wav` },
      { variant: 'hit', file: `${P}/BDrumNewhit_v6_rr2_Sum.wav` },
      { variant: 'soft', file: `${P}/BDrumNewhit_v3_rr1_Sum.wav` },
    ],
  },
  snareRoll: {
    sustain: true, release: 0.3, gain: 0.6,
    samples: [
      { variant: 'roll', file: `${P}/Snare2-rollSN_v3_rr1_Sum.wav` },
    ],
  },
  snare: {
    maxLen: 1.0, release: 0.1, gain: 0.6,
    samples: [
      { variant: 'hit', file: `${P}/Snare2-HitSN_v7_rr1_Sum.wav` },
      { variant: 'hit', file: `${P}/Snare2-HitSN_v7_rr2_Sum.wav` },
    ],
  },
  triangle: {
    maxLen: 3.5, release: 0.3, gain: 0.5,
    samples: [
      { variant: 'hit', file: `${P}/Triangle3-Hit_v2_rr1_Sum.wav` },
      { variant: 'hit', file: `${P}/Triangle3-Hit_v2_rr2_Sum.wav` },
      { variant: 'muted', file: `${P}/Triangle3-HitM_v2_rr1_Sum.wav` },
    ],
  },
  woodblock: {
    maxLen: 0.6, release: 0.05, gain: 0.6,
    samples: [
      { variant: 'hit', file: `${V1}/varWood/wood_click_f.wav` },
      { variant: 'hit', file: `${V1}/varWood/wood_click_f2.wav` },
      { variant: 'claves', file: `${V1}/varWood/claves_ff.wav` },
      { variant: 'claves', file: `${V1}/varWood/claves_mf.wav` },
    ],
  },
};
