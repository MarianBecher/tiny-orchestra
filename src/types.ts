// Shared types: the manifest written by the sample build, the score format
// read by the scheduler, and the objects the Orchestra hands out.

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

export interface Manifest {
  version: number;
  source: string;
  format: ManifestFormat;
  instruments: Record<string, ManifestInstrument>;
}

/**
 * One note of a score: `[beat, midi, lengthBeats, velocity?, variant?]`.
 * `midi` is null for unpitched parts; `velocity` defaults to the part's.
 */
export type ScoreNote = [
  beat: number,
  midi: number | null,
  lengthBeats: number,
  velocity?: number | undefined,
  variant?: string | undefined,
];

export interface Part {
  instrument: string;
  notes: ScoreNote[];
  /** Default velocity of the part's notes, 0..1. Default 0.7. */
  velocity?: number;
  /** Stereo position -1..1. */
  pan?: number;
  /** Semitones added to every note. */
  transpose?: number;
  /** Unpitched: variant for notes that name none. */
  variant?: string;
}

export interface Score {
  bpm: number;
  /** Default 4. */
  beatsPerBar?: number;
  /** Length in beats; if missing, the notes rounded up to whole bars. */
  lengthBeats?: number;
  parts: Part[];
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

export interface NoteOptions {
  instrument: string;
  /** MIDI note; required for pitched instruments, ignored for unpitched ones. */
  midi?: number | null | undefined;
  /** Absolute AudioContext time. In the past or missing: now. */
  at?: number | undefined;
  /** Seconds. Sustained notes hold (looping if needed) and then release. */
  duration?: number | undefined;
  /** 0..1, applied quadratically (0.5 = -12 dB). Default 0.7. */
  velocity?: number | undefined;
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
  /** Overrides `score.bpm`. */
  bpm?: number | undefined;
  /** Semitones added to every pitched note. */
  transpose?: number | undefined;
  /** Multiplies every velocity. Default 1. */
  velocity?: number | undefined;
  loop?: boolean | undefined;
  out?: Output | undefined;
}

export interface Performance {
  readonly startTime: number;
  readonly bpm: number;
  readonly lengthBeats: number;
  readonly loop: boolean;
  /** AudioContext time of the end; `Infinity` when looping. */
  readonly endTime: number;
  /** Current position in beats (wrapped when looping). */
  readonly position: number;
  readonly playing: boolean;
  /** Called at the natural end (never after `stop()`, never when looping). */
  onEnd: ((performance: Performance) => void) | null;
  /** Fade out and cancel notes that are planned but not yet sounding. Default 0.5 s. */
  stop(fadeSeconds?: number): void;
}

export interface OrchestraOptions {
  /** Folder that holds `manifest.json` and the sample folders. */
  baseUrl?: string | undefined;
  /** Default: `ctx.destination`. */
  destination?: AudioNode | undefined;
  /**
   * The manifest itself (no fetch), or its URL. With a URL and no `baseUrl`,
   * sample files are resolved relative to the manifest.
   */
  manifest?: Manifest | string | undefined;
  /** Create the shared reverb. Default true. */
  reverb?: boolean | undefined;
  /** Reverb decay time (-60 dB) in seconds. Default 2.6. */
  reverbSeconds?: number | undefined;
}
