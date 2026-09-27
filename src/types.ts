// Shared types: the manifest written by the sample build, the score format
// read by the scheduler, and the objects the Orchestra hands out.
//
// Everything that names an instrument is generic over the allowed names. The
// default is the bundled instruments (InstrumentName); for a custom manifest
// use `string` (or your own union).

import type { InstrumentName } from './instruments.ts';
import type { TempoChange } from './tempo.ts';

/** One audio file in the manifest. All times are seconds on the file's own timeline. */
export interface ManifestSample {
  /** Path relative to the manifest, e.g. `"violins/C5-f.mp3"`. */
  file: string;
  /** MIDI note the sample sounds at. Absent (or null) for unpitched instruments. */
  midi?: number | null;
  /** Velocity the file was levelled for (quiet layers are quieter in the file). Default 1. */
  vel?: number;
  /** Where playback starts: right at the attack. */
  offset?: number;
  /** Baked-in crossfaded loop of sustained samples. */
  loopStart?: number;
  loopEnd?: number;
  /** Decoded length according to ffmpeg (which removes the MP3 encoder delay). */
  duration?: number;
  /** Where the shared onset detector finds the attack in the decoded file. */
  mark?: number;
  /** Measured detuning of the recording in cents; compensated at playback. */
  tune?: number;
  /** Extra linear gain that could not be baked in without clipping. */
  gain?: number;
  /** Unpitched: which variant this sample belongs to (`"crash"`, `"soft"`, ...). */
  variant?: string;
  /** Swells: seconds from `offset` to the peak of the crescendo. */
  peak?: number;
}

export interface ManifestInstrument {
  pitched: boolean;
  /** Sustained (bowed, blown, rolled) with a baked-in loop, as opposed to decaying. */
  sustain?: boolean;
  /** Decaying instruments: whether a note's `duration` damps it (pizzicato yes, harp no). */
  damp?: boolean;
  /** Release time after the end of a note, in seconds. */
  release?: number;
  /** Mix level relative to the other instruments. */
  gain?: number;
  /** Lowest and highest sampled MIDI note. */
  range?: [number, number];
  /** Unpitched: variant used when a note names none (or an unknown one). */
  defaultVariant?: string;
  /** Unpitched: all variants, default first. */
  variants?: string[];
  samples: ManifestSample[];
}

export interface ManifestFormat {
  codec: string;
  kbps: number;
  kbpsLow?: number;
  sampleRate: number;
  channels: number;
  loudnessTarget?: number;
}

export interface Manifest<I extends string = string> {
  version: number;
  source: string;
  format: ManifestFormat;
  instruments: Record<I, ManifestInstrument>;
}

/**
 * One note of a score: `[beat, pitch, lengthBeats, velocity?, variant?]`.
 * `pitch` is a MIDI number or a note name (`"F#4"`), null for unpitched
 * parts; `velocity` defaults to the part's.
 */
export type ScoreNote = [
  beat: number,
  midi: number | string | null,
  lengthBeats: number,
  velocity?: number | undefined,
  variant?: string | undefined,
];

/**
 * A point of a part's dynamics: from `beat` on the part plays at `level`
 * (0..1, quadratic like velocity, 1 = as written). With `ramp`, it gets
 * there gradually from the previous point - a crescendo or diminuendo.
 */
export type DynamicsPoint = [beat: number, level: number, ramp?: boolean | undefined];

export interface Part<I extends string = InstrumentName> {
  instrument: I;
  notes: ScoreNote[];
  /** Name to address the part in `performance.part(name)`. */
  name?: string;
  /** Level of the part, 0..1 (linear, like a fader). Default 1. Changeable while playing. */
  gain?: number;
  /** Dynamics over time; see `DynamicsPoint`. Before the first point, its level. */
  dynamics?: DynamicsPoint[];
  /** Default velocity of the part's notes, 0..1. Default 0.7. */
  velocity?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Semitones added to every note. */
  transpose?: number;
  /** Unpitched: variant for notes that name none. */
  variant?: string;
}

export interface Score<I extends string = InstrumentName> {
  /** Tempo at the start, in quarter notes per minute. */
  bpm: number;
  /** Tempo changes, see `TempoChange`. On a loop, every pass starts at `bpm` again. */
  tempo?: TempoChange[];
  /** Default 4. */
  beatsPerBar?: number;
  /** Length in beats; if missing, the notes rounded up to whole bars. */
  lengthBeats?: number;
  parts: Part<I>[];
}

export interface Bus {
  /** Connect anything here; `note()` and `play()` take the bus itself as `out`. */
  input: GainNode;
  /** Ramp the bus gain to `gain` over `seconds` (default 1). */
  fade(gain: number, seconds?: number): void;
  /** Set the gain with a 20 ms ramp, so it does not click. */
  set(gain: number): void;
  /** Fade out briefly and disconnect. */
  dispose(): void;
}

export interface BusOptions {
  /** Default 1. */
  gain?: number | undefined;
  /** Share sent into the reverb. Default 0.25. */
  reverb?: number | undefined;
  /** Stereo position -1..1. Default 0. */
  pan?: number | undefined;
}

/** Where a note or a performance goes: a bus or any AudioNode. */
export type Output = Bus | AudioNode;

export interface NoteOptions<I extends string = InstrumentName> {
  instrument: I;
  /** MIDI note or note name (`"C4"`); required for pitched instruments, ignored for unpitched ones. */
  midi?: number | string | null | undefined;
  /** Absolute AudioContext time. In the past or missing: now. */
  at?: number | undefined;
  /** Seconds. Sustained notes hold (looping if needed) and then release. */
  duration?: number | undefined;
  /** 0..1, applied quadratically (0.5 = -12 dB). Default 0.7. */
  velocity?: number | undefined;
  /** With `duration`: velocity at the end of the note, reached by a linear ramp (crescendo, diminuendo). */
  velocityEnd?: number | undefined;
  /** Cents. */
  detune?: number | undefined;
  /** Stereo position -1..1. */
  pan?: number | undefined;
  /** Unpitched: which variant. `{ instrument: 'timpani', variant: 'roll' }` plays `timpaniRoll`. */
  variant?: string | undefined;
  /** Decaying instruments: whether `duration` damps the note. Default from the manifest. */
  damp?: boolean | undefined;
  /** Default: a shared default bus. */
  out?: Output | undefined;
}

export interface Voice {
  readonly startTime: number;
  readonly endTime: number;
  /** Fade the voice out from `when` (default now) over `release` seconds (default 0.1). */
  stop(when?: number, release?: number): void;
}

export interface PlayOptions {
  /** Absolute AudioContext time. Default: 50 ms from now. */
  at?: number | undefined;
  /** Beat of the score to start from. Default 0. */
  from?: number | undefined;
  /** Overrides `score.bpm`; tempo changes of the score are scaled along. */
  bpm?: number | undefined;
  /** Semitones added to every pitched note. */
  transpose?: number | undefined;
  /** Multiplies every velocity. Default 1. */
  velocity?: number | undefined;
  loop?: boolean | undefined;
  /** Fade in over this many seconds instead of starting at full level. */
  fadeIn?: number | undefined;
  out?: Output | undefined;
}

/** A part of a running performance, see `Performance.part()`. */
export interface PartControl {
  readonly index: number;
  readonly name: string | undefined;
  /** Ramp the part's level to `gain` (0..1) over `seconds` (default 1). */
  fade(gain: number, seconds?: number): void;
  /** Set the level with a 20 ms ramp. */
  set(gain: number): void;
}

export interface Performance {
  readonly startTime: number;
  /** Current tempo at the start of the score (`setTempo` changes it). */
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly lengthBeats: number;
  readonly loop: boolean;
  /** Semitones added to every pitched note (`setTranspose` changes it). */
  readonly transpose: number;
  /** AudioContext time of the end; `Infinity` when looping. */
  readonly endTime: number;
  /** Current position in beats (wrapped when looping). */
  readonly position: number;
  readonly playing: boolean;
  /** Called at the natural end (never after `stop()`, never when looping). */
  onEnd: ((performance: Performance) => void) | null;
  /**
   * Called on every beat, as close to when it sounds as the main thread
   * manages. `beat` counts from the start of the score (across loop passes),
   * `time` is the exact AudioContext time of the beat.
   */
  onBeat: ((beat: number, time: number) => void) | null;
  /** Like `onBeat`, on the first beat of every bar; `bar` counts from 0. */
  onBar: ((bar: number, time: number) => void) | null;
  /** AudioContext time at which `beat` (counted like in `onBeat`) sounds. */
  timeOf(beat: number): number;
  /**
   * AudioContext time of the next bar line at or after `after` (default:
   * now plus a moment to plan). For starting or stopping something in time
   * with the music: `play(next, { at: perf.nextBar() })`.
   */
  nextBar(after?: number): number;
  /** Like `nextBar`, for the next beat. */
  nextBeat(after?: number): number;
  /** Change the tempo; takes effect after the notes already planned (under half a second). */
  setTempo(bpm: number): void;
  /** Change the transposition of notes planned from now on. */
  setTranspose(semitones: number): void;
  /** A part by name or index, to change its level while playing; null if there is none. */
  part(nameOrIndex: string | number): PartControl | null;
  /**
   * Fade out over `fadeSeconds` (default 0.5) from `at` (AudioContext time,
   * default now), and cancel notes that would start later.
   */
  stop(fadeSeconds?: number, at?: number): void;
}

export interface LoadOptions {
  /** Called whenever a sample file has been loaded (or has failed): `loaded` of `total` files. */
  onProgress?: ((loaded: number, total: number) => void) | undefined;
  /** Aborts the downloads this call started; `load()` then resolves early. */
  signal?: AbortSignal | undefined;
}

export interface RenderOptions extends Omit<PlayOptions, 'at' | 'out' | 'loop' | 'fadeIn'> {
  /** Default 44100. */
  sampleRate?: number | undefined;
  /** Default 2. */
  channels?: number | undefined;
  /** How often the score is played in a row. Default 1. */
  repeat?: number | undefined;
  /** Seconds added after the end for releases and the reverb. Default 3. */
  tail?: number | undefined;
  /** The bus the score is played into. Default: gain 1, reverb 0.25. */
  bus?: BusOptions | undefined;
}

export interface OrchestraOptions<I extends string = InstrumentName> {
  /** Folder that holds `manifest.json` and the sample folders. */
  baseUrl?: string | undefined;
  /** Default: `ctx.destination`. */
  destination?: AudioNode | undefined;
  /**
   * The manifest itself (no fetch), or its URL. With a URL and no `baseUrl`,
   * sample files are resolved relative to the manifest.
   */
  manifest?: Manifest<I> | string | undefined;
  /** Create the shared reverb. Default true. */
  reverb?: boolean | undefined;
  /** Reverb decay time (-60 dB) in seconds. Default 2.6. */
  reverbSeconds?: number | undefined;
  /**
   * Put a limiter in front of `destination`, so that many loud notes at once
   * do not clip. Default false.
   */
  limiter?: boolean | undefined;
  /**
   * Most voices of one instrument sounding at the same time; beyond that the
   * oldest one is faded out quickly. Default 32; `Infinity` for no limit.
   */
  maxVoices?: number | undefined;
}
