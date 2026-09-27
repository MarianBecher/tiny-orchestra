# Changelog

All notable changes to this package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (before 1.0, a minor version may
break the API).

## [Unreleased]

## [0.2.0] - 2026-09-27

### Added

- Scores
  - Tempo changes, in steps or as gradual ramps: `tempo: [[beat, bpm, ramp?]]`.
  - Note names as pitches (`'F#4'`), in scores and in `note()`.
  - `sequence()` writes the notes of a part as text: notes, chords, rests,
    unpitched hits with variants, lengths and velocities.
  - Parts have a `name`, a `gain` and `dynamics`, a level curve over time
    with crescendos and diminuendos.
- Performances
  - `play()` takes `from` (the beat to start at) and `fadeIn`.
  - `stop(fadeSeconds, at)` can stop at a later time.
  - `nextBar()`, `nextBeat()` and `timeOf()` help with doing things in time
    with the music, such as starting the next piece on the next bar line.
  - `onBeat` and `onBar` callbacks fire as the beat sounds.
  - `setTempo()` and `setTranspose()` work while a performance plays.
  - `part(name)` fades single parts in and out.
- Notes
  - `velocityEnd` ramps a held note to another velocity.
  - Each instrument plays at most `maxVoices` (default 32) voices at once and
    fades out the oldest beyond that.
- `render()` renders a score offline into an `AudioBuffer`, and `encodeWav()`
  turns it into a WAV file. `play()` on an `OfflineAudioContext` plans the
  whole score at once.
- `load()` reports progress (`onProgress`) and can be aborted (`signal`);
  `unload()` frees instruments again; `unlock()` resumes the context on the
  first user gesture.
- `limiter: true` puts a limiter in front of the output.
- `tiny-orchestra/midi`: `parseMidi()` reads Standard MIDI Files and
  `midiToScore()` maps them onto the bundled instruments.
- Pure helpers: `tempoMap`, `repeating`, `LiveTimeline`, `noteToMidi`,
  `midiToNote`, `toMidi`, `nextBarBeat`, `barAt`, `flattenDynamics`,
  `dynamicsAt`, `makeupGain`.
- `docs/api.md`, a complete API reference.

### Changed

- **Breaking (types):** `ScoreNote` pitches and `NoteOptions.midi` are
  `number | string | null`; code that reads pitches out of a score has to
  handle note names.
- **Breaking (scheduler):** a `ScoreEvent` has a `part` index, and
  `startScheduler()` reads beat times from a `timeline` (a constant
  `startTime`/`bpm` still works). `Scheduler.stop(at)` now keeps planning up
  to `at` when `at` is in the future.
- The voice limit is on by default (`maxVoices: 32`); pass `Infinity` for the
  previous behaviour.
- The README describes the library without a particular use case in mind.

## [0.1.0] - 2026-09-26

First release: the `Orchestra` sampler with loading, buses, a shared reverb,
single notes and looping score playback on a lookahead scheduler; 25
instruments built from VSCO-2 Community Edition; the Node entry
`tiny-orchestra/node`.

[Unreleased]: https://github.com/MarianBecher/tiny-orchestra/compare/0.2.0...HEAD
[0.2.0]: https://github.com/MarianBecher/tiny-orchestra/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/MarianBecher/tiny-orchestra/releases/tag/0.1.0
