# API

Everything the package exports, by entry point. Times called "context time"
are seconds on the `AudioContext` clock (`ctx.currentTime`); beats are quarter
notes.

- [`tiny-orchestra`](#tiny-orchestra): the `Orchestra`, scores, helpers
- [`tiny-orchestra/midi`](#tiny-orchestramidi): MIDI files to scores
- [`tiny-orchestra/node`](#tiny-orchestranode): where the samples are on disk

## tiny-orchestra

### `new Orchestra(ctx, options?)`

`ctx` is an `AudioContext` or an `OfflineAudioContext`.

| Option | Default | |
|---|---|---|
| `baseUrl` | `''` | Folder with `manifest.json` and the sample folders. |
| `manifest` | | The manifest as an object (not fetched), or its URL. With a URL and no `baseUrl`, samples are resolved relative to it. |
| `destination` | `ctx.destination` | Where everything ends up. |
| `reverb` | `true` | Create the shared reverb. |
| `reverbSeconds` | `2.6` | Its decay time (-60 dB). |
| `limiter` | `false` | A limiter in front of `destination`. Below -3 dB it changes nothing; the browser's compressor lookahead delays the output a little (6 ms in Chromium). |
| `maxVoices` | `32` | Most voices of one instrument at once; beyond that the oldest is faded out in 50 ms. `Infinity` for no limit. |

Properties: `ctx`, `baseUrl`, `destination`, `instruments` (names in the
manifest, empty until it has loaded), `manifest` (or `null`).
`Orchestra.midiToFreq(midi)` is a static.

### Loading

**`load(instruments?, { onProgress?, signal? }): Promise<void>`** loads the
manifest and the instruments; no list loads all of them. It never throws:
whatever cannot be loaded is missing, with a console warning, and an
instrument that lacks only some files is usable with the rest. Nothing is
fetched twice. `onProgress(loaded, total)` counts the sample files of this
call. Aborting `signal` stops the downloads this call started and resolves
at once; a later `load()` starts them afresh.

**`has(instrument): boolean`**: loaded and playable.

**`unload(instruments?)`** forgets instruments (no list: all), so their audio
can be garbage collected. Sounding notes play on.

**`unlock(target = document): Promise<void>`** resumes a suspended
`AudioContext` on the first `pointerdown`, `keydown` or `touchend` on
`target`, and resolves once it runs. Resolves at once if it already does.

### `note(options): Voice | null`

| Option | Default | |
|---|---|---|
| `instrument` | | Name of a loaded instrument. `{ instrument: 'timpani', variant: 'roll' }` plays `timpaniRoll`. |
| `midi` | | MIDI number or note name (`'C4'` = 60, `'F#3'`, `'Bb5'`). Required for pitched instruments, ignored for unpitched ones. |
| `at` | now | Context time. In the past: now. |
| `duration` | | Seconds. Sustained instruments hold (looping) and release after it; decaying ones ring out, unless `damp`. |
| `velocity` | `0.7` | 0 to 1, applied quadratically (0.5 = -12 dB). Picks the dynamic layer. |
| `velocityEnd` | | With `duration`: velocity at the end, reached by a linear ramp. The layer is picked for the louder end. |
| `detune` | `0` | Cents. |
| `pan` | `0` | -1 to 1. |
| `variant` | the default | Unpitched: which variant (`'crash'`, `'soft'`, ...). Samples of a variant alternate at random, never the same twice in a row. |
| `damp` | from the manifest | Decaying instruments: whether `duration` cuts the note. |
| `out` | a default bus | A `Bus` or any `AudioNode`. |

Returns `null` when the instrument is not loaded or a pitched note has no
valid pitch. A `Voice` has `startTime`, `endTime` and
`stop(when = now, release = 0.1)`.

### Scores

```ts
interface Score {
  bpm: number;                 // tempo at the start
  tempo?: TempoChange[];       // [beat, bpm, ramp?]
  beatsPerBar?: number;        // default 4
  lengthBeats?: number;        // default: the notes, rounded up to whole bars
  parts: Part[];
}

interface Part {
  instrument: InstrumentName;
  notes: ScoreNote[];          // [beat, pitch, lengthBeats, velocity?, variant?]
  name?: string;               // for performance.part(name)
  gain?: number;               // level 0..1, like a fader; default 1
  velocity?: number;           // default for the notes; default 0.7
  pan?: number;
  transpose?: number;          // semitones
  variant?: string;            // unpitched: for notes that name none
  dynamics?: DynamicsPoint[];  // [beat, level, ramp?]
}
```

- **Pitch** is a MIDI number, a note name, or `null` for unpitched parts.
- **Tempo changes** hold from their beat on; with `ramp`, the tempo moves
  there gradually from the previous change (accelerando, ritardando). When
  looping, every pass starts at `bpm` again.
- **Dynamics** work the same way for the level of a part: from `beat` on the
  part plays at `level` (0 to 1, quadratic like velocity; 1 is as written),
  with `ramp` gradually. Before the first point, the part is at its level.
  They are sample-accurate automation, so they also shape notes that are
  already sounding.

**`sequence(text, { start = 0, length = 1 }?): ScoreNote[]`** writes notes as
text. Tokens, separated by spaces:

| Token | |
|---|---|
| `C4`, `F#3`, `Bb5`, `60` | a note |
| `C4+E4+G4` | a chord |
| `x`, `x.soft` | an unpitched hit, with a variant |
| `r` | a rest |
| `:2`, `:1/2` | length in beats; carries over to the following tokens |
| `@0.8` | velocity of this token |
| `\|` | a bar line, ignored |

It throws on a token it cannot read.

### `play(score, options?): Performance`

| Option | Default | |
|---|---|---|
| `at` | 50 ms from now | Context time of the start. |
| `from` | `0` | Beat of the score to start at. |
| `bpm` | `score.bpm` | Plays the score at this tempo; its tempo changes scale along. |
| `transpose` | `0` | Semitones for every pitched note. |
| `velocity` | `1` | Factor for every velocity. |
| `loop` | `false` | Repeat forever. |
| `fadeIn` | | Seconds to fade in over. |
| `out` | a default bus | A `Bus` or any `AudioNode`. |

The score is planned only half a second ahead (two seconds in a background
tab), so everything below takes effect right away.

**Performance**

| | |
|---|---|
| `startTime`, `lengthBeats`, `beatsPerBar`, `loop` | As given. |
| `bpm`, `transpose` | Current values. |
| `endTime` | Context time of the end, `Infinity` when looping. |
| `position` | Current beat (wrapped when looping). |
| `playing` | Until the end, or until a stop begins. |
| `timeOf(beat)` | Context time of a beat, counted from the start of the score across loop passes. |
| `nextBar(after?)`, `nextBeat(after?)` | Context time of the next bar line or beat at or after `after` (default: now plus a moment). Every loop pass starts a bar; without a loop, the end is the last bar line. |
| `stop(fadeSeconds = 0.5, at = now)` | Fade out from `at`; notes that would start later are cancelled. |
| `setTempo(bpm)` | Change the tempo (the score's tempo changes scale along), from the notes not yet planned on. |
| `setTranspose(semitones)` | For notes planned from now on. |
| `part(nameOrIndex)` | A `PartControl` with `index`, `name`, `fade(gain, seconds = 1)` and `set(gain)`, or `null`. |
| `onEnd(perf)` | At the natural end (not when looping, not after a stop). |
| `onBeat(beat, time)`, `onBar(bar, time)` | On every beat and bar, as close to when it sounds as a timer gets; `time` is its exact context time, for anything that should line up. |

### `render(score, options?): Promise<AudioBuffer>`

Renders a score in an `OfflineAudioContext`, faster than real time. Loads
the instruments the score needs first. Takes the options of `play()` except
`at`, `out`, `loop` and `fadeIn`, plus:

| Option | Default | |
|---|---|---|
| `sampleRate` | `44100` | |
| `channels` | `2` | |
| `repeat` | `1` | How often the score plays in a row. |
| `tail` | `3` | Seconds after the end, for releases and the reverb. |
| `bus` | gain 1, reverb 0.25 | `BusOptions` of the bus it plays into. |

**`encodeWav(buffer, { bitDepth = 16 }?): ArrayBuffer`** makes a WAV file of
anything shaped like an `AudioBuffer`; `bitDepth: 32` writes float samples.

### `bus(options?): Bus`

A mixer channel into `destination` with a share into the shared reverb.
Options `gain` (1), `reverb` (0.25) and `pan` (0). A bus has `input` (a
`GainNode` to connect anything to), `fade(gain, seconds = 1)`, `set(gain)`
(with a 20 ms ramp, so it does not click) and `dispose()`.

### Helpers

Pure functions, usable without an `AudioContext`:

| | |
|---|---|
| `noteToMidi(name)`, `midiToNote(midi)`, `toMidi(pitch)` | Note names; `noteToMidi` returns `NaN` for anything else. |
| `midiToFreq`, `playbackRate`, `velocityGain`, `pickLayer`, `pickSample`, `pickVariant` | Pitch, level and sample choice. |
| `tempoMap(bpm, changes)`, `repeating(map, lengthBeats)`, `LiveTimeline` | Beats and seconds with tempo changes. |
| `beatToTime`, `timeToBeat`, `scoreLength`, `flattenScore`, `flattenDynamics`, `dynamicsAt`, `collectEvents`, `nextBarBeat`, `barAt`, `wrapPosition` | Scores as data. |
| `startScheduler` | The lookahead scheduler, with any clock. |
| `detectOnset`, `decoderShift`, `makeImpulse`, `makeupGain` | Signal helpers. |
| `INSTRUMENT_NAMES`, `InstrumentName` | The bundled instruments. |

## tiny-orchestra/midi

**`parseMidi(data: ArrayBuffer | Uint8Array): MidiData`** reads a Standard
MIDI File, format 0 or 1: its notes (with track, channel, program, pitch,
velocity 0 to 1, beat and length in beats), the tempo map, the first time
signature (`beatsPerBar` counts quarter notes, so 6/8 is 3) and the track
names. It throws on files it cannot read (SMPTE timing, format 2, truncated
data).

**`midiToScore(data, { instrument?, drums? }?): Score`** turns that into a
score. Pitched notes are grouped by track, channel and program; each group
becomes a part, named after its track. `instrument(group)` picks the
instrument of a group, or `null` to drop it; the default `gmInstrument` maps
General MIDI programs to the bundled instruments and picks the member of an
ensemble (strings, brass, winds) by the group's median pitch. Notes on the
percussion channel go through `drums(key, note)` instead, which returns an
instrument and variant, or `null`; the default `gmDrum` knows the bass drum,
snare, cymbals, triangle, wood blocks and claves. `drums: false` treats the
percussion channel like any other.

```ts
const score = midiToScore(parseMidi(bytes), {
  instrument: (g) => (g.program === 0 ? 'harp' : gmInstrument(g)),
});
```

## tiny-orchestra/node

**`samplesDir(): string`**: absolute path of the package's `samples/` folder,
for copying it into a project in a build step.
