# tiny-orchestra

[![npm](https://img.shields.io/npm/v/tiny-orchestra)](https://www.npmjs.com/package/tiny-orchestra)
[![CI](https://github.com/MarianBecher/tiny-orchestra/actions/workflows/ci.yml/badge.svg)](https://github.com/MarianBecher/tiny-orchestra/actions/workflows/ci.yml)

A small orchestra for the browser: 25 instruments sampled from the
[VSCO-2 Community Edition](https://github.com/sgossner/VSCO-2-CE), boiled down
to 6.5 MB of MP3, and a Web Audio sampler that plays single notes, whole
scores and MIDI files, live or rendered to WAV.

It is one ES module and a folder of samples that you serve yourself. No
dependencies, written in TypeScript, everything public domain. Use it for
music in web apps and games, sonification, teaching, sketching an
arrangement, or anything else that needs a real-sounding orchestra without a
DAW or a CDN.

## Install

```sh
npm install tiny-orchestra
```

The package holds the library in `dist/` and the samples in `samples/`, a
manifest plus one folder of MP3s per instrument. The samples have to end up
on a web server. The Node entry tells you where they are, so a build step
can copy them:

```ts
import { cp, rm } from 'node:fs/promises';
import { samplesDir } from 'tiny-orchestra/node';

await rm('public/audio/samples', { recursive: true, force: true });
await cp(samplesDir(), 'public/audio/samples', { recursive: true });
```

Or skip the copying and load them from a CDN that mirrors npm, with the
version pinned: `baseUrl: 'https://cdn.jsdelivr.net/npm/tiny-orchestra@0/samples/'`.

## Usage

```ts
import { Orchestra, sequence } from 'tiny-orchestra';

const ctx = new AudioContext();
const orch = new Orchestra(ctx, { baseUrl: '/audio/samples/' });
orch.unlock();                                            // resume on the first click or key press
await orch.load(['violins', 'harp', 'timpani', 'cymbal']);  // no argument loads everything

const music = orch.bus({ gain: 0.8, reverb: 0.3 });
orch.note({ instrument: 'harp', midi: 'G4', at: ctx.currentTime + 0.1, out: music });

const perf = orch.play({
  bpm: 96,
  parts: [
    { instrument: 'violins', name: 'strings', velocity: 0.5, notes: sequence('C4:4 D4') },
    { instrument: 'harp', notes: sequence('C3:1/2 G3 C4 E4 G4 E4 C4 G3 | D3 A3 D4 F4 A4 F4 D4 A3') },
    { instrument: 'cymbal', variant: 'soft', notes: [[0, null, 1]] },
  ],
}, { out: music, loop: true });

perf.part('strings')?.fade(0, 2);   // take one part out
perf.stop(1.5, perf.nextBar());     // fade out from the next bar line
```

Browsers only make sound after a user gesture. Loading and scheduling work
before that; `orch.unlock()` resumes the context on the first click, touch or
key press.

`load()` never throws and never fetches anything twice, so you can load a few
instruments first and the rest while the page is already in use. It reports
progress and can be aborted: `load(names, { onProgress, signal })`.
`orch.has('harp')` tells you what is ready, `orch.unload()` frees memory
again.

The full API is in [docs/api.md](docs/api.md). An overview follows.

### Notes

`orch.note()` plays one note at an absolute context time: `instrument`, `midi`
(a number or a name like `'F#4'`), `at`, `duration`, `velocity` (0 to 1,
quadratic), `velocityEnd` for a crescendo or diminuendo within the note,
`detune`, `pan`, `variant` and `out`. It returns a voice with `stop()`, or
`null` when the instrument is not loaded yet, so an app does not break while
its samples are still on the way.

It picks the closest sample in the matching dynamic layer and repitches it.
Sustained instruments (strings, winds, brass, rolls) loop as long as
`duration` asks and then release; decaying ones (harp, pizzicato, mallets,
percussion) ring out on their own. Each instrument keeps at most 32 voices
(`maxVoices`); beyond that the oldest one is faded out quickly.

### Scores

A score is a tempo and a list of parts, each with an instrument and notes as
`[beat, pitch, lengthBeats, velocity?, variant?]`. Beats are quarter notes
and may be fractional; the pitch is a MIDI number or a note name, and `null`
for unpitched instruments, which pick a variant instead. `sequence()` writes
the notes of a part as text:

```ts
sequence('C4 D4 E4:2 | G4+B4+D5:4 r:1 x.soft@0.5')
// note, note, a half note (lengths carry over), a chord, a rest, a soft hit at velocity 0.5
```

A score can also give `beatsPerBar`, `lengthBeats` and tempo changes, in steps
or gradual: `tempo: [[16, 60, true]]` slows down to 60 bpm by beat 16. A part
can set `name`, `gain`, `pan`, `transpose`, a default `velocity` and
`dynamics`, a level curve over time: `dynamics: [[0, 0.2], [8, 1, true]]` is
a crescendo over two bars.

MIDI files become scores with `tiny-orchestra/midi`. General MIDI programs and
drums are mapped onto the bundled instruments, or onto a mapping of your own:

```ts
import { midiToScore, parseMidi } from 'tiny-orchestra/midi';

const score = midiToScore(parseMidi(await (await fetch('/bach.mid')).arrayBuffer()));
orch.play(score);
```

A few example pieces that show the score format are in
[examples/scores.ts](examples/scores.ts).

### Performances

`orch.play(score, options)` takes `at`, `from` (the beat to start at), `bpm`,
`transpose`, a `velocity` factor, `loop`, `fadeIn` and `out`. It returns a
performance:

- `position` (in beats), `playing`, `endTime`, and `onEnd` for chaining pieces
- `stop(fadeSeconds, at)`, now or at a later time
- `nextBar()` and `nextBeat()` for doing things in time with the music, such
  as starting the next piece on the next bar line:
  `orch.play(next, { at: perf.nextBar() })`
- `onBeat` and `onBar` callbacks, fired as the beat sounds, for anything
  visual that should follow the music
- `setTempo()` and `setTranspose()` while it plays
- `part(name)` to fade single parts in and out, e.g. to add or drop layers of
  an arrangement

Playback runs on a lookahead scheduler, so `stop()` takes effect at once,
loops cost nothing extra, and the music keeps going in a background tab.

### Rendering

`orch.render(score, options)` renders a score offline, much faster than real
time, into an `AudioBuffer`; `encodeWav()` turns that into a WAV file:

```ts
import { encodeWav } from 'tiny-orchestra';

const buffer = await orch.render(score, { repeat: 2, tail: 3 });
const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
```

### Buses

`orch.bus({ gain, reverb, pan })` is a mixer channel with `fade()`, `set()`
and `dispose()`. Give separate groups of sounds a bus each, so they can be
faded independently. All buses share one reverb whose impulse response is
computed at start-up rather than downloaded; `new Orchestra(ctx, { reverb:
false })` leaves it out. `limiter: true` puts a limiter in front of the
output, so that many loud notes at once do not clip.

### Types

Instrument names are typed. `Orchestra`, `Score` and `Part` default to the
union of the 25 bundled instruments, so `'violin'` instead of `'violins'` is
a compile error. With a manifest of your own, pass it as `manifest` (an
object or a URL) and use `new Orchestra<string>`.

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
make check          # typecheck, lint, tests
make demo           # build and serve http://localhost:8321/demo/
make site           # build and serve the showcase site at http://localhost:8321/site/
make check-browser  # play the demo and the site, render offline in headless Chromium
```

Needs Node 22. The demo page plays every instrument and a short piece; the
site in `site/` shows a longer piece as a score that follows the playback,
with its code to edit and play again, and is published on GitHub Pages. The
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
