// Checks samples/ as it is shipped - not the intermediate stages of the
// build, but the finished MP3s:
//
//  - every file in the manifest exists and decodes (ffmpeg)
//  - length, offset and loop points fit the file
//  - the pitch at the attack (offset) matches `midi` within +-50 cents
//  - neither signal nor level jumps at the loop seam
//  - no file without an entry, size within budget
//
//   npm run check:samples

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Manifest, ManifestInstrument, ManifestSample } from '../src/types.ts';
import { decodeMono, pool, SAMPLES } from './lib/vsco.ts';
import { measurePitch, hzToMidi, gainToDb } from './lib/dsp.ts';

const SR = 44100;
const DIR = SAMPLES;
const problems: string[] = [];
const bad = (msg: string): void => { problems.push(msg); };

/**
 * The loop seam. Two things:
 *  - jump: how large is the step from loopEnd-1 to loopStart, compared with
 *    the steps that occur in the signal anyway (99th percentile)?
 *  - sameness: the last 20 ms before loopEnd must be (thanks to the baked-in
 *    crossfade) almost the same as the 20 ms before loopStart - then the jump
 *    sounds like playing on without interruption. Residual in dB.
 */
function seam(x: Float32Array, ls: number, le: number): { ratio: number; residual: number } {
  const diffs: number[] = [];
  for (let i = ls + 1; i < le; i++) diffs.push(Math.abs(x[i]! - x[i - 1]!));
  diffs.sort((a, b) => a - b);
  const p99 = diffs[Math.floor(diffs.length * 0.99)] || 1e-9;
  const jump = Math.abs(x[ls]! - x[le - 1]!);
  const w = Math.round(0.02 * SR);
  let e = 0, r = 0;
  for (let i = 0; i < w; i++) {
    const d = x[le - w + i]! - x[ls - w + i]!;
    e += d * d;
    r += x[ls - w + i]! * x[ls - w + i]!;
  }
  return { ratio: jump / p99, residual: gainToDb(Math.sqrt(e / Math.max(1e-12, r))) };
}

interface Job { name: string; inst: ManifestInstrument; s: ManifestSample }

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(DIR, 'manifest.json'), 'utf8')) as Manifest;
  const listed = new Set<string>();
  const lines: string[] = [];
  const jobs: Job[] = [];
  const seams: number[] = [];
  for (const [name, inst] of Object.entries(manifest.instruments)) {
    for (const s of inst.samples) jobs.push({ name, inst, s });
  }
  await pool(jobs, 8, async ({ name, inst, s }) => {
    listed.add(s.file);
    const path = join(DIR, s.file);
    let x: Float32Array;
    try {
      await stat(path);
      x = await decodeMono(path, SR);
    } catch (err) {
      bad(`${s.file}: missing or not decodable (${(err instanceof Error ? err.message : String(err)).split('\n')[0]})`);
      return;
    }
    const dur = x.length / SR;
    const offset = s.offset ?? 0;
    if (s.duration === undefined || Math.abs(dur - s.duration) > 0.002) bad(`${s.file}: length ${dur.toFixed(4)} instead of ${s.duration}`);
    if (!(offset >= 0 && offset < dur - 0.05)) bad(`${s.file}: offset ${offset} out of range`);
    if (inst.sustain) {
      const { loopStart: ls, loopEnd: le } = s;
      if (ls === undefined || le === undefined || !(ls > offset && le > ls + 0.5 && le <= dur)) {
        bad(`${s.file}: loop ${ls}..${le} implausible`);
      } else {
        const r = seam(x, Math.round(ls * SR), Math.round(le * SR));
        seams.push(r.residual);
        if (r.ratio > 1.5 || r.residual > -9) bad(`${s.file}: loop seam jump ${r.ratio.toFixed(2)}, residual ${r.residual.toFixed(1)} dB`);
      }
      if (dur < 3) bad(`${s.file}: sustained sample only ${dur.toFixed(2)} s`);
    }
    if (inst.pitched) {
      if (typeof s.midi !== 'number') { bad(`${s.file}: pitched sample without midi`); return; }
      const timp = name.startsWith('timpani');
      const glock = name === 'glockenspiel';
      const on = Math.round(offset * SR);
      const p = measurePitch(x, SR, on, s.midi, { sustain: inst.sustain, method: timp ? 'timpani' : glock ? 'spectrum' : undefined });
      if (!p) { bad(`${s.file}: pitch not measurable`); return; }
      const cents = 100 * (hzToMidi(p.hz) - s.midi);
      const flag = Math.abs(cents) > 50 || p.octave !== 0;
      lines.push(`${flag ? 'x' : ' '} ${s.file.padEnd(28)} midi ${String(s.midi).padStart(3)}  ${((cents >= 0 ? '+' : '') + cents.toFixed(0)).padStart(4)} ct  tune ${s.tune ?? 0}`);
      if (flag) bad(`${s.file}: ${cents.toFixed(0)} cents${p.octave ? ', wrong octave' : ''}`);
    }
  });

  // leftover files without a manifest entry?
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        total += (await stat(p)).size;
        const rel = relative(DIR, p).split(sep).join('/');
        if (rel !== 'manifest.json' && !listed.has(rel)) bad(`${rel}: not in the manifest`);
      }
    }
  };
  await walk(DIR);

  console.log(lines.sort().join('\n'));
  seams.sort((a, b) => a - b);
  if (seams.length) console.log(`\nLoop seams: ${seams.length}, residual median ${seams[seams.length >> 1]!.toFixed(1)} dB, worst ${seams[seams.length - 1]!.toFixed(1)} dB`);
  console.log(`\n${jobs.length} samples, ${Object.keys(manifest.instruments).length} instruments, ${(total / 1e6).toFixed(2)} MB`);
  if (total > 9e6) bad(`size ${(total / 1e6).toFixed(2)} MB over 9 MB`);
  if (problems.length) {
    console.error(`\n${problems.length} problems:\n` + problems.map((p) => '  ' + p).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('All good.');
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
