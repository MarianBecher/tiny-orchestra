# Building the samples


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

## MP3 encoder delay

LAME puts ~1100 samples of silence in front of the sound. ffmpeg, Chrome and
Firefox read the LAME header and cut that off again (measured by the build
with a click test, and confirmed in the browser check: shift 0). For decoders
that do not, every sample has `duration` (expected length) and `mark` (where
onset detection finds the attack) in the manifest: if the decoded buffer is
longer, the library measures and shifts `offset` and the loop points by the
detected priming length.

## Size

Budget: at most 6 MB if possible, hard limit 9 MB. Currently **6.5 MB** for
207 samples. The big chunks are the sustained notes (~35 KB each for 3 s).
To save more: drop the second violin layer (-220 KB), raise `gap` in
`scripts/instruments.ts`, or use 80 kbit/s for the high instruments too.

# Checks


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
