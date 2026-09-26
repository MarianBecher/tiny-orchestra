# tiny-orchestra

A tiny orchestra for the browser: 25 instruments from
[VSCO-2 Community Edition](https://github.com/sgossner/VSCO-2-CE) (CC0), boiled
down to about 6.5 MB of MP3, plus a dependency-free Web Audio sampler that
plays single notes and whole scores with a lookahead scheduler.

- No runtime dependencies, no bundler required, no CDN: an ES module and a
  folder of samples you serve yourself.
- Written in TypeScript, ships `.d.ts` types and source maps.
- Samples and code are public domain (CC0 1.0).

## Install

```sh
npm install tiny-orchestra
```

The package contains the library (`dist/`) and the samples (`samples/`:
`manifest.json` plus one folder of MP3s per instrument). The samples have to
be served by your web server next to your app - see
[Copying the samples](#copying-the-samples-into-your-project).

## Usage

```ts
import { Orchestra } from 'tiny-orchestra';

const ctx = new AudioContext();                    // may still be "suspended"
const orch = new Orchestra(ctx, { baseUrl: '/audio/samples/' });
await orch.load(['violins', 'harp', 'timpani', 'cymbal']);   // no argument: everything

const music = orch.bus({ gain: 0.8, reverb: 0.3 });
orch.note({ instrument: 'harp', midi: 67, at: ctx.currentTime + 0.1, out: music });

const perf = orch.play({
  bpm: 96,
  beatsPerBar: 4,
  lengthBeats: 8,
  parts: [
    { instrument: 'violins', velocity: 0.5, notes: [[0, 60, 4], [4, 62, 4]] },
    { instrument: 'cymbal', variant: 'soft', notes: [[0, null, 1]] },
  ],
}, { out: music, loop: true });

// later
perf.stop(1.5);        // fade out over 1.5 s
music.fade(0, 2);      // or fade the whole bus
```

Browsers only allow sound after a user gesture. Loading and scheduling work
before that anyway; calling `ctx.resume()` on the first click is enough.

## Copying the samples into your project

The Node-only entry `tiny-orchestra/node` tells you where the samples are on
disk, so a build step can copy them into your public folder:

```ts
// scripts/copy-samples.ts
import { cp, rm } from 'node:fs/promises';
import { samplesDir } from 'tiny-orchestra/node';

const target = 'public/audio/samples';
await rm(target, { recursive: true, force: true }); // no leftovers of an older build
await cp(samplesDir(), target, { recursive: true });
```

Then point the orchestra at that URL: `new Orchestra(ctx, { baseUrl: '/audio/samples/' })`.
Clearing the target first matters: files of an older build that the manifest
no longer knows would otherwise stay behind.

Single files can also be resolved through the package exports, e.g.
`import.meta.resolve('tiny-orchestra/samples/manifest.json')`, or imported by
bundlers that handle static assets.

## API

### `new Orchestra(ctx, options?)`

| Option | Default | |
|---|---|---|
| `baseUrl` | `''` | Folder with `manifest.json` and the sample folders. |
| `destination` | `ctx.destination` | Where all buses and the reverb end up. |
| `manifest` | - | A `Manifest` object (then it is not fetched), or the manifest's URL (then sample files resolve relative to it unless `baseUrl` is given). |
| `reverb` | `true` | Create the shared reverb. |
| `reverbSeconds` | `2.6` | Reverb decay time (-60 dB). |

`ctx` can be any `BaseAudioContext`, including an `OfflineAudioContext`.

### `load(instruments?): Promise<void>`

Loads the manifest and the samples (at most 6 downloads at once) and decodes
them. Never throws: if the manifest or an instrument is missing, there is a
console warning and that instrument is simply missing. An instrument that
lacks only some samples stays usable with the rest. Calling it again loads
nothing twice; a failed manifest is retried on the next call.

### `has(instrument): boolean`, `instruments: string[]`, `manifest: Manifest | null`

`has` is true as soon as the instrument is decoded. `instruments` lists all
names in the manifest (empty until it has loaded); `manifest` is the loaded
manifest itself.

### `bus({ gain = 1, reverb = 0.25, pan = 0 }?): Bus`

A mixer channel, see [Buses and reverb](#buses-and-reverb).

### `note(options): Voice | null`

| Option | Default | |
|---|---|---|
| `instrument` | - | Instrument name. |
| `midi` | - | MIDI note (60 = C4). Required for pitched instruments, ignored for unpitched ones. |
| `at` | now | Absolute AudioContext time. In the past: now. |
| `duration` | - | Seconds. See below. |
| `velocity` | `0.7` | 0..1, applied quadratically (0.5 = -12 dB). |
| `detune` | `0` | Cents. |
| `pan` | `0` | -1..1. |
| `variant` | default | Unpitched: which variant. |
| `damp` | manifest | Decaying instruments: whether `duration` damps the note. |
| `out` | default bus | A `Bus` or any `AudioNode`. |

Returns `null` (no error) when the instrument is not loaded, or when a pitched
instrument gets no `midi` - a game should not crash because its music is
still loading.

- **Pitched:** the closest sample in the matching dynamic layer (the quietest
  one at least as strong as `velocity`), repitched via `playbackRate`; the
  measured detuning of the recording (`tune`) is compensated. Playback
  starts right at the attack (`offset`).
- **Sustained** (strings, winds, brass, timpani and snare rolls): if
  `duration` is longer than the sample, the baked-in loop carries it; after
  `duration` comes the release (`release` in the manifest). Without
  `duration` the sample plays through once.
- **Decaying** (harp, pizzicato, glockenspiel, marimba, timpani, percussion):
  rings out naturally. `duration` only damps if `damp` applies (default from
  the manifest: yes for pizzicato, no otherwise).
- **Unpitched:** `variant` picks the variant (unknown or missing:
  `defaultVariant`), randomly among several samples but never the same one
  twice in a row.
- `{ instrument: 'timpani', variant: 'roll' }` plays `timpaniRoll`.

`Voice`: `{ startTime, endTime, stop(when = now, release = 0.1) }`. Stopping
ramps a separate gain node down - never a hard cut.

### `play(score, options?): Performance`

| Option | Default | |
|---|---|---|
| `at` | now + 50 ms | Absolute AudioContext time of beat 0. |
| `bpm` | `score.bpm` | Tempo override. |
| `transpose` | `0` | Semitones for all pitched notes. |
| `velocity` | `1` | Multiplies every velocity. |
| `loop` | `false` | Repeat every `lengthBeats`, forever. |
| `out` | default bus | A `Bus` or any `AudioNode`. |

`Performance`:

| Field | |
|---|---|
| `endTime` | AudioContext time of the end; `Infinity` when looping. |
| `stop(fadeSeconds = 0.5)` | Fades out and cancels notes that are planned but not yet sounding. |
| `onEnd` | Callback for the *natural* end (not after `stop()`, never when looping). |
| `position` | Current position in beats (wrapped when looping). |
| `startTime`, `bpm`, `lengthBeats`, `loop`, `playing` | For inspection. |

### Pure helpers

Everything that works without an AudioContext is exported as well, typed:
`midiToFreq`, `playbackRate`, `velocityGain`, `pickLayer`, `pickSample`,
`pickVariant`, `beatToTime`, `timeToBeat`, `scoreLength`, `flattenScore`,
`collectEvents`, `wrapPosition`, `detectOnset`, `decoderShift`,
`makeImpulse`, and the scheduler itself (`startScheduler`, `LOOKAHEAD`,
`LOOKAHEAD_HIDDEN`, `TICK_MS`). `Orchestra.midiToFreq` is also a static.

## Score format

```ts
const score: Score = {
  bpm: 84,
  beatsPerBar: 4,      // default 4
  lengthBeats: 32,     // default: the notes, rounded up to whole bars
  parts: [
    {
      instrument: 'flute',
      velocity: 0.7,   // default velocity of the part's notes
      transpose: 0,    // semitones
      pan: 0.15,       // -1..1
      notes: [
        // [beat, midi, lengthBeats, velocity?, variant?]
        [0, 76, 2],
        [2, 79, 1, 0.9],
      ],
    },
    { instrument: 'triangle', variant: 'hit', notes: [[16, null, 1, 0.5], [24, null, 1, undefined, 'muted']] },
  ],
};
```

`midi` is `null` for unpitched parts; their variant comes from the fifth note
field or from `part.variant`. Beats are quarter notes in the given tempo and
can be fractional.

Scheduling uses a lookahead: every 100 ms the scheduler plans 0.5 s ahead
(2 s in background tabs, where browsers throttle timers). That way `stop()`
takes effect at once, loops run forever at no extra cost, and long pieces do
not keep thousands of nodes waiting in the audio graph. If the timer stalled,
missed notes are skipped rather than played all at once. The end of a
performance is detected on the audio clock, so a suspended context does not
end it early.

## Buses and reverb

`orch.bus({ gain, reverb, pan })` returns a mixer channel: dry into
`destination` and a `reverb` share into the reverb.

```ts
interface Bus {
  input: GainNode;                          // connect anything here
  fade(gain: number, seconds?: number): void; // ramp (default 1 s)
  set(gain: number): void;                  // 20 ms ramp, so it does not click
  dispose(): void;                          // fade out briefly and disconnect
}
```

Give music and sound effects a bus each, so they can be faded independently.
Every performance additionally gets its own fader, so `perf.stop()` never
touches a bus that other things are playing on.

The reverb is a single `ConvolverNode` shared by all buses. Its stereo
impulse response is computed at startup instead of loaded: decaying noise
that gets darker over time (air and walls swallow the highs first), with a
short, slightly different predelay per channel for width, normalized to
energy 1 and seeded, so it sounds the same on every load.

## Instruments

| Name | Range (MIDI) | Samples / variants | Sustained | Size |
|---|---|---|---|---|
| violins | G3-D6 (55-86) | 17 (2 layers: p, f) | yes | 636 KB |
| violas | C3-B5 (48-83) | 11 | yes | 411 KB |
| celli | C2-B4 (36-71) | 11 | yes | 343 KB |
| basses | E1-B3 (28-59) | 10 (solo double bass, no vibrato) | yes | 312 KB |
| violinsPizz | G3-D6 (55-86) | 11 | no | 103 KB |
| celliPizz | C2-F5 (36-77) | 13 | no | 193 KB |
| harp | E1-F7 (28-101) | 12 | no | 405 KB |
| flute | C4-A6 (60-93) | 9 | yes | 337 KB |
| oboe | A#3-F6 (58-89) | 9 | yes | 337 KB |
| clarinet | D3-F6 (50-89) | 11 | yes | 411 KB |
| bassoon | A#1-D#5 (34-75) | 11 | yes | 343 KB |
| horn | A1-F5 (33-77) | 11 (gap C4-D5 in the source) | yes | 356 KB |
| trumpet | F3-C6 (53-84) | 10 | yes | 373 KB |
| trombone | A#1-F4 (34-65) | 9 | yes | 280 KB |
| tuba | F1-D4 (29-62) | 8 | yes | 260 KB |
| glockenspiel | G5-C8 (79-108) | 6 | no | 181 KB |
| marimba | F2-C7 (41-96) | 10 | no | 218 KB |
| timpani | F2-G3 (41-55) | 5 kettles | no | 168 KB |
| timpaniRoll | F#2-E3 (42-52) | 5 kettles | yes | 155 KB |
| cymbal | - | `crash`, `swell` (with `peak`), `soft` | no | 282 KB |
| bassdrum | - | `hit`, `soft` | no | 60 KB |
| snareRoll | - | `roll` | yes | 37 KB |
| snare | - | `hit` | no | 12 KB |
| triangle | - | `hit`, `muted` | no | 90 KB |
| woodblock | - | `hit`, `claves` | no | 19 KB |

Beyond the range the outermost sample is tuned further - that works for a few
semitones, then it starts to sound like a chipmunk or a growl.

`cymbal`/`swell` has a `peak` in the manifest: seconds from the start of
playback to the climax of the crescendo. To put the climax on a beat, start
it at `beat - peak` (see the demo's swell button).

## Manifest format

```json
{ "version": 1,
  "instruments": {
    "violins": { "pitched": true, "sustain": true, "release": 0.35, "gain": 1, "range": [55, 86],
      "samples": [ { "file": "violins/C5-f.mp3", "midi": 72, "vel": 1, "offset": 0.01,
                     "loopStart": 1.26, "loopEnd": 2.86, "duration": 3.11, "mark": 0 } ] },
    "cymbal": { "pitched": false, "sustain": false, "release": 0.5, "gain": 0.7,
      "defaultVariant": "crash", "variants": ["crash", "swell", "soft"],
      "samples": [ { "file": "cymbal/swell1.mp3", "variant": "swell", "offset": 0.01, "peak": 3.22,
                     "duration": 5.73, "mark": 0.01 } ] } },
  "source": "VSCO-2 Community Edition (CC0), https://github.com/sgossner/VSCO-2-CE",
  "format": { "codec": "mp3", "kbps": 96, "kbpsLow": 80, "sampleRate": 44100, "channels": 1, "loudnessTarget": -20 } }
```

All times are seconds on the file's own timeline.

Instrument (`ManifestInstrument`):

| Field | Type | |
|---|---|---|
| `pitched` | boolean | Pitched (picked by `midi`) or unpitched (picked by `variant`). |
| `sustain` | boolean | Sustained with a baked-in loop, or decaying. |
| `damp` | boolean? | Decaying pitched instruments: whether `duration` damps a note. |
| `release` | number | Release time after the end of a note (s). |
| `gain` | number | Mix level relative to the other instruments. |
| `range` | [number, number]? | Pitched: lowest and highest sampled MIDI note. |
| `defaultVariant` | string? | Unpitched: variant used when none (or an unknown one) is named. |
| `variants` | string[]? | Unpitched: all variants, default first. |
| `samples` | ManifestSample[] | The files. |

Sample (`ManifestSample`):

| Field | Type | |
|---|---|---|
| `file` | string | Path relative to the manifest. |
| `midi` | number? | Pitched: the note the sample sounds at. |
| `vel` | number? | Velocity the file was levelled for (quiet layers < 1). |
| `offset` | number | Where playback starts: at the attack. |
| `loopStart`, `loopEnd` | number? | Sustained: the baked-in crossfaded loop. |
| `duration` | number | Decoded length according to ffmpeg. |
| `mark` | number | Where `detectOnset` finds the attack in the decoded file. |
| `tune` | number? | Measured detuning of the recording in cents (compensated). |
| `gain` | number? | Extra gain that could not be baked in without clipping. |
| `variant` | string? | Unpitched: the sample's variant. |
| `peak` | number? | Swells: seconds from `offset` to the climax. |

`gain`, `tune` and `peak` only appear where needed.

## How the samples were built

```sh
npm run build:samples                  # everything (~1 min; first time + ~400 MB download)
npm run build:samples -- harp flute    # only these, the manifest is updated
npm run build:samples -- --lenient     # only report pitch errors
npm run check:samples                  # check the finished MP3s
```

Needs Node 22 and `ffmpeg` (with libmp3lame) on the `PATH`. The file list
comes once from the GitHub API, the WAVs one by one from
raw.githubusercontent.com - the ~2 GB repository is not cloned. Everything
lands in `cache/` (gitignored); a second build needs no network. Rebuilt from
the same cache with the same ffmpeg, the output is byte-identical.

What the build does per sample (`scripts/build-samples.ts`, the selection is
in `scripts/instruments.ts`):

1. **Select:** note name from the file name, shifted by an octave per folder
   where VSCO counts differently (almost everywhere; not the harp). About one
   sample every 3-4 semitones.
2. **Find the onset** (-36 dB below the peak, above the noise floor) and keep
   10 ms of lead-in. For hits, `offset` sits at the -24 dB threshold - before
   that there is only the mallet's run-up.
3. **Sustained notes:** find where the sustained part ends, bake a loop from
   ~1.2 s to 2.85 s after the onset with a 0.35 s equal-power crossfade, with
   0.25 s of tail behind it. A bit over 3 s per file.
   **Decaying notes:** cut at -50 dB or a maximum length, fade out softly.
4. **Loudness:** K-weighted RMS (the BS.1770 curve) to -20 dB - sustained
   notes over the sustained part, hits over the loudest 400 ms window. Every
   layer is levelled across the range; between p and f the natural distance
   is kept (violins: -10.4 dB -> `vel` 0.55). Unpitched instruments get one
   gain for the whole instrument, so `soft` stays soft. Where the peak would
   exceed -1 dBFS, less is baked in and the rest is stored as the sample's
   `gain`. The instrument `gain` is only mixing taste.
5. **Check the pitch:** YIN on the sample, narrow around the expected note
   (cents) and wide (octave errors), plus a spectrum comparison (if the
   fundamental and odd partials are missing, it sounds an octave higher). More
   than 50 cents off fails the build. Glockenspiel via the spectral peak,
   timpani via the (1,1) mode of the head - their MIDI note is determined
   that way. Small deviations are stored as `tune` and compensated at
   playback.
6. **MP3**, mono, 96 kbit/s (low instruments 80 - there are no highs to miss
   there), decoded again and re-measured.

### MP3 encoder delay

LAME puts ~1100 samples of silence in front of the sound. ffmpeg, Chrome and
Firefox read the LAME header and cut that off again (measured by the build
with a click test, and confirmed in the browser check: shift 0). For decoders
that do not, every sample has `duration` (expected length) and `mark` (where
onset detection finds the attack) in the manifest: if the decoded buffer is
longer, the library measures and shifts `offset` and the loop points by the
detected priming length.

### Size

Budget: at most 6 MB if possible, hard limit 9 MB. Currently **6.5 MB** for
207 samples. The big chunks are the sustained notes (~35 KB each for 3 s).
To save more: drop the second violin layer (-220 KB), raise `gap` in
`scripts/instruments.ts`, or use 80 kbit/s for the high instruments too.

## Development

```sh
npm run build          # tsc -> dist/
npm run typecheck      # src, scripts and tests
npm test               # Vitest
npm run lint           # ESLint
npm run demo           # build, then http://localhost:8321/demo/
npm run check:samples  # decode and measure every shipped MP3 (ffmpeg)
npm run check:browser  # demo + offline rendering in headless Chromium
```

What is checked:

- `npm test`: sample choice, dynamic layers, `playbackRate`, beats -> time,
  loop wrapping, the scheduler's timing with a fake clock (lookahead, skipping
  missed notes, loops, the end on the audio clock), variant round robin,
  onset detection, decoder compensation, the impulse response, the Orchestra
  wiring against a fake AudioContext, the committed manifest, and the build
  helpers (note names, loop seam, end of the sustained part, loudness, pitch).
- `npm run check:samples`: every file decodes, length/offset/loop plausible,
  pitch within +-50 cents on the finished MP3, loop seams without a jump
  (residual after crossfade -26 dB median), no orphaned files.
- `npm run check:browser` (headless Chromium over the DevTools protocol; set
  `CHROME=...` or it looks in the `PATH` and in Playwright's cache): the demo
  loads without console messages, all 25 instruments are there, the piece
  runs; rendered offline (44.1 and 48 kHz) a woodblock lands within 1 ms, a
  7 s violin note carries across the loop and fades out, stopping does not
  click.

Not checked: Safari/WebKit (the decoder compensation above exists for exactly
that case), and of course the sound itself. That is what the demo is for.

## Releasing

Releases are published to npm by GitHub Actions (`.github/workflows/publish.yml`)
when a plain semver tag without a `v` prefix (e.g. `1.0.0`) is pushed. The
workflow checks that the tag equals the version in `package.json`, runs the
checks and the build, and publishes with provenance via npm Trusted
Publishing (OIDC) - there is no npm token.

1. The very first publish is manual: `npm publish --access public`.
2. Then configure the trusted publisher on npmjs.com: package settings ->
   Trusted publisher -> GitHub Actions, repository
   `MarianBecher/tiny-orchestra`, workflow `publish.yml`.
3. From then on, a release is

   ```sh
   npm version patch && git push --follow-tags
   ```

   which bumps the version, commits, and pushes a tag like `1.0.1` (the
   repository's `.npmrc` sets `tag-version-prefix=""`).

## Credits

The samples are edited excerpts from the
[Versilian Studios Chamber Orchestra 2 - Community Edition](https://github.com/sgossner/VSCO-2-CE)
by Versilian Studios / Samuel Gossner and contributors, released under CC0.
Attribution is not required, but it is appreciated - see [CREDITS.md](CREDITS.md).

## License

Code and samples: [CC0 1.0 Universal](LICENSE) - public domain. Do whatever
you like with it, no attribution or permission needed.
