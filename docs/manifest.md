# The manifest

What `samples/manifest.json` contains and what the library reads from it.


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
