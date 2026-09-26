# tiny-orchestra

[![npm](https://img.shields.io/npm/v/tiny-orchestra)](https://www.npmjs.com/package/tiny-orchestra)
[![CI](https://github.com/MarianBecher/tiny-orchestra/actions/workflows/ci.yml/badge.svg)](https://github.com/MarianBecher/tiny-orchestra/actions/workflows/ci.yml)

A small orchestra for the browser: 25 instruments sampled from the
[VSCO-2 Community Edition](https://github.com/sgossner/VSCO-2-CE), boiled down
to 6.5 MB of MP3, and a Web Audio sampler that plays notes and whole scores.

I built this for a party game that needed a lobby waltz, a timpani roll and
the national anthem of whatever country the round landed in, without loading
anything from a CDN. It is one ES module and a folder of samples that you
serve yourself. No dependencies, written in TypeScript, everything public
domain.

## Install

```sh
npm install tiny-orchestra
```

The package holds the library in `dist/` and the samples in `samples/`, a
manifest plus one folder of MP3s per instrument. The samples have to end up
on your web server. The Node entry tells you where they are, so a build step
can copy them:

```ts
import { cp, rm } from 'node:fs/promises';
import { samplesDir } from 'tiny-orchestra/node';

await rm('public/audio/samples', { recursive: true, force: true });
await cp(samplesDir(), 'public/audio/samples', { recursive: true });
```

## Usage

```ts
import { Orchestra } from 'tiny-orchestra';

const ctx = new AudioContext();
const orch = new Orchestra(ctx, { baseUrl: '/audio/samples/' });
await orch.load(['violins', 'harp', 'timpani', 'cymbal']);   // no argument loads everything

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

perf.stop(1.5);      // fade out over 1.5 s
music.fade(0, 2);    // or fade the whole bus
```

Browsers only make sound after a user gesture. Loading and scheduling work
before that; `ctx.resume()` on the first click is all it takes.

`load()` never throws and never fetches anything twice, so you can load the
lobby music first and the rest of the orchestra while the game is already
running. `orch.has('harp')` tells you what is ready.

A score is a list of parts, each with an instrument and notes as
`[beat, midi, lengthBeats, velocity?, variant?]`. Beats are quarter notes at
the score's tempo and may be fractional. Unpitched parts use `null` for the
pitch and pick a variant instead. A part can also set `pan`, `transpose` and
a default `velocity`; `play()` takes `at`, `bpm`, `transpose`, a `velocity`
factor, `loop` and `out`, and returns a performance with `position` (in
beats), `playing`, `stop()` and an `onEnd` callback for chaining pieces.

Playback runs on a lookahead scheduler, so `stop()` takes effect at once,
loops cost nothing extra, and the music keeps going in a background tab.

Instrument names are typed. `Orchestra`, `Score` and `Part` default to the
union of the 25 bundled instruments, so `'violin'` instead of `'violins'` is
a compile error. With a manifest of your own, pass it as `manifest` (an
object or a URL) and use `new Orchestra<string>`.

### Notes

`orch.note()` takes `instrument`, `midi`, `at` (absolute context time),
`duration`, `velocity` (0 to 1, quadratic), `detune`, `pan`, `variant` and
`out`, and returns a voice with `stop()`. It picks the closest sample in the
matching dynamic layer and repitches it. Sustained instruments (strings,
winds, brass, rolls) loop as long as `duration` asks and then release;
decaying ones (harp, pizzicato, mallets, percussion) ring out on their own.
When the instrument is not loaded yet, the call returns `null` instead of
throwing: a game should not crash because its music is still on the way.

### Buses

`orch.bus({ gain, reverb, pan })` is a mixer channel with `fade()`, `set()`
and `dispose()`. Give music and sound effects a bus each so they can be faded
independently. All buses share one reverb whose impulse response is computed
at start-up rather than downloaded; `new Orchestra(ctx, { reverb: false })`
leaves it out.

## Instruments

| Name | Range | | Size |
|---|---|---|---|
| violins | G3 to D6 | two layers, p and f | 636 KB |
| violas | C3 to B5 | | 411 KB |
| celli | C2 to B4 | | 343 KB |
| basses | E1 to B3 | | 312 KB |
| violinsPizz | G3 to D6 | | 103 KB |
| celliPizz | C2 to F5 | | 193 KB |
| harp | E1 to F7 | | 405 KB |
| flute | C4 to A6 | | 337 KB |
| oboe | A#3 to F6 | | 337 KB |
| clarinet | D3 to F6 | | 411 KB |
| bassoon | A#1 to D#5 | | 343 KB |
| horn | A1 to F5 | | 343 KB |
| trumpet | F3 to C6 | | 373 KB |
| trombone | A#1 to F4 | | 280 KB |
| tuba | F1 to D4 | | 249 KB |
| glockenspiel | G5 to C8 | | 181 KB |
| marimba | F2 to C7 | | 218 KB |
| timpani | F2 to G3 | five kettles, plus `timpaniRoll` (or `variant: 'roll'`) | 323 KB |
| cymbal | | `crash`, `swell`, `soft` | 282 KB |
| bassdrum | | `hit`, `soft` | 60 KB |
| snare | | `hit`, plus `snareRoll` | 49 KB |
| triangle | | `hit`, `muted` | 90 KB |
| woodblock | | `hit`, `claves` | 19 KB |

Beyond a range the outermost sample is stretched further, which works for a
few semitones before it starts to sound like a chipmunk.

## Development

```sh
make check      # typecheck, lint, tests
make demo       # build and serve http://localhost:8321/demo/
```

Needs Node 22. The demo page plays every instrument and a short piece. The
samples are cut, looped, levelled and pitch-checked by a script that
downloads the VSCO-2 WAVs and encodes them with ffmpeg; how that works, and
what the manifest fields mean, is written up in
[docs/building-samples.md](docs/building-samples.md) and
[docs/manifest.md](docs/manifest.md).

## Credits and license

The samples are edited excerpts from the Versilian Studios Chamber
Orchestra 2, Community Edition, by Samuel Gossner and contributors, released
under CC0. Attribution is not required, but see [CREDITS.md](CREDITS.md)
anyway.

Code and samples are [CC0 1.0](LICENSE), public domain.
