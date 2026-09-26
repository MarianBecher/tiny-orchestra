// Access to VSCO-2-CE without cloning the ~2 GB repository, plus the ffmpeg
// calls the build needs.
//
// The file list comes once from the GitHub API (a single call, the anonymous
// limit of 60/h is plenty), the WAVs one by one from raw.githubusercontent.com.
// Everything ends up in cache/, so a second build needs no network and nobody
// loads the servers needlessly.

import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const REPO = 'sgossner/VSCO-2-CE';
const BRANCH = 'master';
/** Repository root, with a trailing separator. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CACHE = join(ROOT, 'cache');
export const SAMPLES = join(ROOT, 'samples');

interface GitTree { tree: { path: string; type: string }[] }

/** All file paths in the VSCO-2-CE repository. */
export async function fileList(): Promise<string[]> {
  const file = join(CACHE, 'tree.json');
  let json: GitTree;
  try {
    json = JSON.parse(await readFile(file, 'utf8')) as GitTree;
  } catch {
    const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    json = (await res.json()) as GitTree;
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(json));
  }
  return json.tree.filter((e) => e.type === 'blob').map((e) => e.path);
}

const rawUrl = (path: string): string =>
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Download a file (or take it from the cache) and return the local path. */
export async function download(path: string): Promise<string> {
  const local = join(CACHE, 'raw', path);
  try {
    if ((await stat(local)).size > 0) return local;
  } catch { /* not there yet */ }
  await mkdir(dirname(local), { recursive: true });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(rawUrl(path));
      if (!res.ok) throw new Error(`${res.status} ${path}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // write under another name first: an aborted download must not sit in
      // the cache as a finished file on the next run
      await writeFile(local + '.part', buf);
      await rename(local + '.part', local);
      return local;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Any audio file -> Float32Array, mono, `sr` Hz (via ffmpeg). */
export async function decodeMono(file: string, sr = 44100): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 30 });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
}

/** Float32Array -> MP3 (mono, CBR). */
export async function encodeMp3(pcm: Float32Array, sr: number, out: string, kbps: number): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const tmp = out + '.f32';
  await writeFile(tmp, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  try {
    await run('ffmpeg', [
      '-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', tmp,
      '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', out,
    ]);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Simple work queue: at most `n` tasks at once, results in input order. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}
