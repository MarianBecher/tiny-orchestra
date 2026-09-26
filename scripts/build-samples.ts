// Builds samples/ from VSCO-2-CE: select, download, trim, bake in loops, match
// loudness, check pitch, save as MP3.
//
//   npm run build:samples                  everything
//   npm run build:samples -- violins harp  only these (the manifest is updated)
//   npm run build:samples -- --lenient     only report pitch errors
//
// Why MP3 and not Opus/OGG: Safari has decoded Ogg/Opus via decodeAudioData
// only recently and not everywhere, MP3 works everywhere. The price is the
// encoder delay (LAME puts ~1100 samples of silence in front). Most decoders
// remove it again using the LAME header, but that cannot be relied on. So
// the manifest holds for every file not only `offset` (where the attack is),
// but also `duration` (length according to ffmpeg, which removes the delay)
// and `mark` (where the shared onset detector detectOnset finds the attack).
// If a browser delivers a longer buffer, the runtime measures and shifts.

import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, ManifestInstrument, ManifestSample } from '../src/types.ts';
import { fileList, download, decodeMono, encodeMp3, pool, CACHE, SAMPLES } from './lib/vsco.ts';
import {
  detectOnset, sustainEnd, decayEnd, bakeLoop, fadeIn, fadeOut, loudness,
  peakAbs, dbToGain, hzToMidi, envelope, measurePitch, noteToMidi,
  type PitchMeasurement,
} from './lib/dsp.ts';
import { PITCHED, TIMPANI, UNPITCHED, type BaseConfig, type PitchedConfig, type TimpaniConfig, type UnpitchedConfig } from './instruments.ts';

const SR = 44100;
const KBPS = 96;               // low instruments: 80, see instruments.ts
const TARGET_DB = -20;         // K-weighted RMS everything is brought to
const PEAK_CEIL = dbToGain(-1); // nothing above is baked in, the rest goes into `gain`
const PRE = Math.round(0.01 * SR);  // 10 ms lead-in before the onset
// Sustained notes: loop end 2.85 s after the onset, plus 0.25 s of tail -
// a bit over three seconds per file. Longer only costs space, the loop carries.
const SUSTAIN = { loopEnd: 2.85, minLoop: 0.8, loopLen: 1.6, fade: 0.35, tail: 0.25 };
const MAX_CENTS = 50;

const OUT = SAMPLES;
const args = process.argv.slice(2);
const lenient = args.includes('--lenient');
const only = args.filter((a) => !a.startsWith('--'));

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m: number): string => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** A source file on its way into the manifest. */
interface Entry {
  path: string;
  midi?: number;
  label?: string;
  vel?: number;
  rr?: number;
  /** Timpani: the note is measured, not read from the name. */
  detect?: boolean;
  variant?: string;
  swell?: boolean;
}

interface PitchedEntry extends Entry { midi: number; label: string; vel: number; rr: number }

// --- Selection ------------------------------------------------------------

function selectPitched(name: string, cfg: PitchedConfig, tree: string[]): PitchedEntry[] {
  const prefix = cfg.dir + '/';
  const found: PitchedEntry[] = [];
  for (const path of tree) {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
    if (!path.toLowerCase().endsWith('.wav')) continue;
    const m = cfg.re.exec(path.slice(prefix.length));
    if (!m?.groups) continue;
    const label = m.groups['v'] ?? '';
    if (!(label in cfg.layers)) continue;
    if (cfg.exclude?.some((x) => path.includes(x))) continue;
    const rr = Number(m.groups['rr'] ?? 1);
    const named = m.groups['note']!;
    const note = cfg.rename?.[named] ?? named;
    found.push({ path, midi: noteToMidi(note) + 12 * cfg.octave, label, vel: cfg.layers[label]!, rr });
  }
  // Exactly one file per note and velocity: the first round robin, and with
  // several dynamic layers of the same velocity the preferred one.
  const byKey = new Map<string, PitchedEntry>();
  for (const f of found.sort((a, b) => a.rr - b.rr)) {
    const key = `${f.midi}/${f.vel}`;
    const prev = byKey.get(key);
    if (!prev || (cfg.preferLayer && f.label === cfg.preferLayer && prev.label !== cfg.preferLayer)) byKey.set(key, f);
  }
  // Thin out per dynamic layer: the quiet layer may be spread more coarsely
  // (`gapByLayer`), it is played less often and more quietly anyway.
  const [lo, hi] = cfg.range ?? [0, 127];
  const picked: PitchedEntry[] = [];
  for (const vel of new Set([...byKey.values()].map((f) => f.vel))) {
    const group = [...byKey.values()].filter((f) => f.vel === vel);
    const gap = cfg.gapByLayer?.[group[0]!.label] ?? cfg.gap;
    const notes = group.map((f) => f.midi).filter((m) => m >= lo && m <= hi).sort((a, b) => a - b);
    const keep: number[] = [];
    for (const m of notes) if (!keep.length || m - keep[keep.length - 1]! >= gap) keep.push(m);
    // always keep the highest note, or the top would be stretched needlessly far
    const top = notes[notes.length - 1]!;
    if (notes.length && keep[keep.length - 1] !== top && top - keep[keep.length - 1]! >= 2) keep.push(top);
    picked.push(...group.filter((f) => keep.includes(f.midi)));
  }
  if (!picked.length) throw new Error(`${name}: no files in ${cfg.dir}`);
  return picked.sort((a, b) => a.midi - b.midi || a.vel - b.vel);
}

// --- Processing one sample ------------------------------------------------

interface Prepared<E extends Entry = Entry> {
  entry: E;
  seg: Float32Array;
  onset: number;
  loopStart: number | undefined;
  loopEnd: number | undefined;
  peakTime: number | undefined;
  loud: number;
  pitch: PitchMeasurement | null;
  warn: string[];
}

async function prepare<E extends Entry>(entry: E, cfg: BaseConfig): Promise<Prepared<E>> {
  const local = await download(entry.path);
  const pcm = await decodeMono(local, SR);
  const on = detectOnset(pcm, SR);
  const start = Math.max(0, on - PRE);
  let seg: Float32Array;
  let loopStart: number | undefined, loopEnd: number | undefined, peakTime: number | undefined;
  const warn: string[] = [];

  if (cfg.sustain) {
    const se = sustainEnd(pcm, SR, on);
    const le = Math.min(on + Math.round(SUSTAIN.loopEnd * SR), se - Math.round(0.1 * SR), pcm.length);
    if ((le - on) / SR < 2.5) warn.push(`sustained part only ${((le - on) / SR).toFixed(2)} s`);
    let ls = Math.max(on + Math.round(0.6 * SR), le - Math.round(SUSTAIN.loopLen * SR));
    if (le - ls < SUSTAIN.minLoop * SR) ls = Math.max(on + Math.round(0.3 * SR), le - Math.round(SUSTAIN.minLoop * SR));
    const baked = bakeLoop(pcm, ls, le, Math.round(SUSTAIN.fade * SR));
    // After loopEnd, the stretch from loopStart follows (that is how it
    // sounds after the jump, too) and fades out - for notes shorter than the
    // file, or for someone playing without the loop at all.
    const tailLen = Math.round(SUSTAIN.tail * SR);
    const tail = fadeOut(Float32Array.from(pcm.subarray(ls, ls + tailLen)), tailLen);
    seg = new Float32Array(le - start + tail.length);
    seg.set(baked.subarray(start, le), 0);
    seg.set(tail, le - start);
    loopStart = ls - start;
    loopEnd = le - start;
  } else {
    let end = Math.min(pcm.length, decayEnd(pcm, SR, on));
    let maxLen = cfg.maxLen ?? 3;
    if (entry.swell) {
      // find the climax of the crescendo, then 2.5 s of decay after it
      const env = envelope(pcm.subarray(on), Math.round(SR * 0.01));
      let pi = 0;
      for (let i = 0; i < env.length; i++) if (env[i]! > env[pi]!) pi = i;
      peakTime = pi * 0.01; // seconds after the onset
      maxLen = pi * 0.01 + 2.5;
    }
    end = Math.min(end, on + Math.round(maxLen * SR));
    seg = Float32Array.from(pcm.subarray(start, end));
    fadeOut(seg, Math.round(Math.min(0.5 * SR, 0.3 * (end - on))));
  }
  fadeIn(seg, on - start);
  // Where playback starts. Sustained notes: at the -36 dB threshold, the soft
  // start of the bow is part of the sound. Hits and plucks: at the -24 dB
  // threshold (minus 2 ms) - before that there is only the mallet's run-up
  // and room noise, and every millisecond there blurs the ensemble. But only
  // if the attack really is fast (< 15 ms between the thresholds) - a cymbal
  // crescendo would otherwise lose its beginning.
  let onset = on - start;
  if (!cfg.sustain) {
    const hit = detectOnset(seg, SR, -24, false);
    if (hit > onset && hit - onset < 0.015 * SR) onset = hit;
  }
  if (peakTime != null) peakTime -= (onset - (on - start)) / SR; // relative to the offset

  const loud = cfg.sustain
    ? loudness(seg, SR, 'sustain', onset + 0.2 * SR, loopEnd)
    : loudness(seg, SR, 'peak', onset);

  const pitch = entry.detect || entry.midi != null
    ? measurePitch(seg, SR, onset, entry.midi ?? 0, { sustain: cfg.sustain, method: entry.detect ? 'timpani' : cfg.pitchMethod })
    : null;
  return { entry, seg, onset, loopStart, loopEnd, peakTime, loud, pitch, warn };
}

interface Finished {
  file: string;
  offset: number;
  loopStart: number | undefined;
  loopEnd: number | undefined;
  duration: number;
  mark: number;
  gain: number | undefined;
}

async function finish(p: Prepared, file: string, gainDb: number, kbps: number): Promise<Finished> {
  let g = dbToGain(gainDb);
  const peak = peakAbs(p.seg) * g;
  let residual = 1;
  if (peak > PEAK_CEIL) {
    residual = peak / PEAK_CEIL;
    g /= residual;
  }
  const out = p.seg.map((v) => v * g);
  const mp3 = join(OUT, file);
  await encodeMp3(out, SR, mp3, kbps);

  // Read back: where does the onset really sit in the decoded MP3?
  const dec = await decodeMono(mp3, SR);
  // shift caused by the codec, measured once with a click (measureCodecDelay)
  const delta = CODEC_DELAY;
  // Cross-check: does the onset detector find the same spot in the MP3?
  const before = detectOnset(out, SR, -36, false), after = detectOnset(dec, SR, -36, false);
  if (Math.abs(after - before - delta) > SR * 0.01) {
    console.warn(`  ! ${file}: onset in the MP3 ${((after - before - delta) / SR * 1000).toFixed(1)} ms off`);
  }
  return {
    file,
    offset: r4((p.onset + delta) / SR),
    loopStart: p.loopStart != null ? r4((p.loopStart + delta) / SR) : undefined,
    loopEnd: p.loopEnd != null ? r4((p.loopEnd + delta) / SR) : undefined,
    duration: r4(dec.length / SR),
    mark: r4(detectOnset(dec, SR, -36, false) / SR),
    gain: residual > 1.001 ? r4(residual) : undefined,
  };
}

/**
 * How far ffmpeg+LAME shift the content: a single click at 100 ms, encoded
 * and read back. Expected is 0 (ffmpeg reads the LAME header and cuts the
 * priming) - but checked is checked.
 */
let CODEC_DELAY = 0;
async function measureCodecDelay(): Promise<void> {
  const x = new Float32Array(SR);
  const at = Math.round(0.1 * SR);
  for (let i = -20; i <= 20; i++) x[at + i] = 0.8 * Math.exp(-(i * i) / 40);
  const file = join(CACHE, 'click.mp3');
  await encodeMp3(x, SR, file, KBPS);
  const y = await decodeMono(file, SR);
  let pi = 0;
  for (let i = 0; i < y.length; i++) if (Math.abs(y[i]!) > Math.abs(y[pi]!)) pi = i;
  CODEC_DELAY = pi - at;
  console.log(`MP3 shift (ffmpeg): ${CODEC_DELAY} samples, length ${x.length} -> ${y.length}`);
}

// --- Instruments ----------------------------------------------------------

const report: string[] = [];
let failures = 0;

function checkPitch(name: string, p: Prepared, exempt: boolean): number | null {
  const { entry, pitch } = p;
  if (!pitch) return null;
  const midi = entry.midi!;
  const cents = 100 * (hzToMidi(pitch.hz) - midi);
  const wideOff = pitch.wideHz ? 1200 * Math.log2(pitch.wideHz / pitch.hz) : 0;
  const notes: string[] = [];
  if (pitch.method && entry.detect) notes.push(`${pitch.method}, fifth ${pitch.clarity.toFixed(2)}`);
  else if (pitch.method) notes.push(pitch.method);
  else notes.push(`spread ${pitch.spread.toFixed(0)} ct, clarity ${pitch.clarity.toFixed(2)}`);
  if (Math.abs(Math.abs(wideOff) - 1200) < 100) notes.push('estimator jumps by an octave');
  if (pitch.octave > 0) notes.push('SPECTRUM: sounds an octave higher');
  if (pitch.octave < 0) notes.push('SPECTRUM: sounds an octave lower');
  const line = `${name.padEnd(12)} ${midiName(midi).padEnd(4)} ${String(midi).padStart(3)}  ` +
    `${pitch.hz.toFixed(1).padStart(7)} Hz  ${((cents >= 0 ? '+' : '') + cents.toFixed(0)).padStart(4)} ct  (${notes.join('; ')})`;
  const bad = Math.abs(cents) > MAX_CENTS || pitch.octave !== 0;
  report.push((bad ? (exempt ? '~ ' : 'x ') : '  ') + line);
  if (bad && !exempt) failures++;
  // Small detunings of the recording are compensated at runtime - but only
  // if the measurement agrees with itself (small spread).
  return !bad && pitch.spread < 25 ? Math.round(cents) : 0; // timpani have spread 0: measured = truth
}

async function buildPitched(name: string, cfg: PitchedConfig, tree: string[]): Promise<ManifestInstrument> {
  const entries = selectPitched(name, cfg, tree);
  const prepared = await pool(entries, 6, (e) => prepare(e, cfg));
  return finishPitched(name, cfg, prepared);
}

async function finishPitched(name: string, cfg: BaseConfig, prepared: Prepared[], exempt = false): Promise<ManifestInstrument> {
  // Several dynamic layers: the natural distance between quiet and loud is
  // kept (median over all notes, limited to 4..14 dB), but each layer is
  // levelled across the range on its own. The distance gives `vel`, so that
  // velocity -> level (vel squared) stays continuous, whichever layer the
  // runtime picks.
  const velOf = (p: Prepared): number => p.entry.vel!;
  const vels = [...new Set(prepared.map(velOf))].sort((a, b) => b - a);
  const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
  const top = median(prepared.filter((p) => velOf(p) === vels[0]).map((p) => p.loud));
  const layer = new Map([[vels[0]!, { db: 0, vel: 1 }]]);
  for (const v of vels.slice(1)) {
    const diff = median(prepared.filter((p) => velOf(p) === v).map((p) => p.loud)) - top;
    const db = Math.max(-14, Math.min(-4, diff));
    layer.set(v, { db, vel: r4(Math.pow(10, db / 40)) });
    console.log(`  ${name}: quiet layer ${diff.toFixed(1)} dB (using ${db.toFixed(1)} dB, vel ${layer.get(v)!.vel})`);
  }
  const samples: ManifestSample[] = [];
  for (const p of prepared) {
    const L = layer.get(velOf(p))!;
    const midi = p.entry.midi!;
    const tune = checkPitch(name, p, exempt);
    for (const w of p.warn) console.warn(`  ! ${name} ${midiName(midi)}: ${w}`);
    const suffix = vels.length > 1 ? (L.vel === 1 ? '-f' : '-p') : '';
    const file = `${name}/${midiName(midi).replace('#', 's')}${suffix}.mp3`;
    const s = await finish(p, file, TARGET_DB + L.db - p.loud, cfg.kbps ?? KBPS);
    // undefined fields are dropped by JSON.stringify - the key order here is the manifest's
    samples.push(defined({ file: s.file, midi, vel: L.vel, ...strip(s), tune: tune || undefined }));
  }
  const first = samples[0]!.midi!, last = samples[samples.length - 1]!.midi!;
  return defined({
    pitched: true,
    sustain: !!cfg.sustain,
    damp: cfg.sustain ? undefined : !!cfg.damp,
    release: cfg.release,
    gain: cfg.gain,
    range: [first, last] as [number, number],
    samples,
  });
}

function strip({ file: _file, ...rest }: Finished): Omit<Finished, 'file'> {
  return rest;
}

/** Drop the undefined fields (as JSON.stringify would), for the types' sake. */
type Defined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
function defined<T extends object>(o: T): Defined<T> {
  return o as Defined<T>;
}

async function buildTimpani(name: string, cfg: TimpaniConfig): Promise<ManifestInstrument> {
  const entries: Entry[] = cfg.files.map((path) => ({ path, detect: true }));
  const prepared = await pool(entries, 6, (e) => prepare(e, cfg));
  // snap the measured pitch to the nearest semitone; the remaining deviation
  // goes into the manifest as `tune`, like everywhere else
  for (const p of prepared) {
    if (!p.pitch) throw new Error(`${name}: no pitch for ${p.entry.path}`);
    p.entry.midi = Math.round(hzToMidi(p.pitch.hz));
    p.entry.vel = 1;
  }
  prepared.sort((a, b) => a.entry.midi! - b.entry.midi!);
  return finishPitched(name, cfg, prepared, true);
}

async function buildUnpitched(name: string, cfg: UnpitchedConfig): Promise<ManifestInstrument> {
  const prepared = await pool(cfg.samples, 6, (e) => prepare({ ...e, path: e.file }, cfg));
  // One gain for the whole instrument, measured on the default variant: that
  // way the soft cymbal stays soft and the swell swells.
  const def = cfg.samples[0]!.variant;
  const ref = prepared.filter((p) => p.entry.variant === def).map((p) => p.loud);
  const gainDb = TARGET_DB - ref.reduce((a, b) => a + b, 0) / ref.length;
  const samples: ManifestSample[] = [];
  const count: Record<string, number> = {};
  for (const p of prepared) {
    const v = p.entry.variant;
    count[v] = (count[v] ?? 0) + 1;
    const s = await finish(p, `${name}/${v}${count[v]}.mp3`, gainDb, cfg.kbps ?? KBPS);
    samples.push(defined({
      file: s.file, variant: v, ...strip(s),
      peak: p.peakTime != null ? r4(p.peakTime) : undefined,
    }));
  }
  return {
    pitched: false,
    sustain: !!cfg.sustain,
    release: cfg.release,
    gain: cfg.gain,
    defaultVariant: def,
    variants: [...new Set(samples.map((s) => s.variant!))],
    samples,
  };
}

// --- Run --------------------------------------------------------------------

async function main(): Promise<void> {
  const tree = await fileList();
  const all = { ...PITCHED, ...TIMPANI, ...UNPITCHED };
  const names = only.length ? only : Object.keys(all);
  for (const n of names) if (!all[n]) throw new Error(`Unknown instrument: ${n}`);

  await mkdir(OUT, { recursive: true });
  await measureCodecDelay();
  let manifest = { version: 1, instruments: {} } as Manifest;
  if (only.length) {
    try { manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8')) as Manifest; } catch { /* new */ }
  }

  for (const name of names) {
    console.log(`${name} ...`);
    await rm(join(OUT, name), { recursive: true, force: true });
    let inst: ManifestInstrument;
    const pitched = PITCHED[name], timpani = TIMPANI[name];
    if (pitched) inst = await buildPitched(name, pitched, tree);
    else if (timpani) inst = await buildTimpani(name, timpani);
    else inst = await buildUnpitched(name, UNPITCHED[name]!);
    manifest.instruments[name] = inst;
  }
  // fixed order as in instruments.ts, whatever was built last
  const ordered: Record<string, ManifestInstrument> = {};
  for (const n of Object.keys(all)) if (manifest.instruments[n]) ordered[n] = manifest.instruments[n];
  manifest.instruments = ordered;
  manifest.source = 'VSCO-2 Community Edition (CC0), https://github.com/sgossner/VSCO-2-CE';
  manifest.format = { codec: 'mp3', kbps: KBPS, kbpsLow: 80, sampleRate: SR, channels: 1, loudnessTarget: TARGET_DB };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

  console.log('\nPitches (x = more than 50 cents off, ~ = exempt):');
  console.log(report.join('\n'));
  const size = await dirSize(OUT);
  console.log(`\nsamples: ${(size / 1e6).toFixed(2)} MB`);
  if (size > 9e6) { console.error('Over the hard limit of 9 MB!'); process.exitCode = 1; }
  if (failures) {
    console.error(`${failures} samples more than ${MAX_CENTS} cents off their note.`);
    if (!lenient) process.exitCode = 1;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
