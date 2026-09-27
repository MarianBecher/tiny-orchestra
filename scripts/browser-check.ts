// Checks the demo and the library in a real (headless) Chromium - without a
// Puppeteer/Playwright package, straight over the DevTools protocol (Node 22
// has WebSocket built in).
//
//   npm run check:browser               finds Chromium by itself
//   CHROME=/path/to/chrome npm run check:browser
//
// Checked:
//  1. The demo loads without JS errors or 404s and every instrument is there.
//  2. The demo piece starts (the position moves) and can be stopped.
//  3. Rendered offline (OfflineAudioContext, 44.1 and 48 kHz):
//     - a woodblock at t = 0.5 s sounds at 0.5 s (the offset is right)
//     - a 7 s violin note carries across the loop and fades out afterwards
//     - no click (jumps) when stopping, no NaN
//     - what this browser's decoder does with the MP3 delay
//  4. orch.render(): a score with a tempo change, dynamics and the limiter
//     lands its notes at the right times and encodes to WAV
//  5. every score in examples/scores.ts renders without clipping
//  6. the site loads, draws a row per part, plays, reports broken code and
//     hands over to changed code; its piece stays inside the instrument ranges
//
//   SCREENSHOTS=dir npm run check:browser   also saves screenshots of the site

import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, access, readdir, mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import type * as Lib from '../src/index.ts';
import { scores } from '../examples/scores.ts';
import { startServer } from './serve.ts';

async function findChrome(): Promise<string | null> {
  if (process.env['CHROME']) return process.env['CHROME'];
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { /* next */ }
  }
  // Playwright keeps its browsers here
  const base = join(homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = (await readdir(base)).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = join(base, d, 'chrome-linux64', 'chrome');
      try { await access(p); return p; } catch { /* next */ }
    }
  } catch { /* no Playwright */ }
  return null;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown> & {
    exceptionDetails?: { text?: string; exception?: { description?: string } };
    type?: string;
    args?: { value?: unknown; description?: string }[];
    entry?: { level: string; text: string; url?: string };
  };
  result?: unknown;
  error?: { message: string };
}

class Cdp {
  private readonly ws: WebSocket;
  private id = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly handlers: ((msg: CdpMessage) => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e: MessageEvent<string>) => {
      const msg = JSON.parse(e.data) as CdpMessage;
      const waiting = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (msg.id !== undefined && waiting) {
        this.pending.delete(msg.id);
        if (msg.error) waiting.reject(new Error(msg.error.message));
        else waiting.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    };
  }
  open(): Promise<void> {
    return new Promise((resolve, reject) => { this.ws.onopen = () => resolve(); this.ws.onerror = reject; });
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }
  on(fn: (msg: CdpMessage) => void): void { this.handlers.push(fn); }
  close(): void { this.ws.close(); }
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

interface OfflineResult {
  loaded: string[];
  unknownIsNull: boolean;
  decoderShiftSamples: number[];
  voice: boolean;
  woodblockAttackAfterOffsetMs: number;
  woodblockOnsetErrorMs: number;
  nan: boolean;
  rmsViolin: { '2-3s': number; '6-7s': number; '8.6-9.6s': number };
  stopJumpRatio: number;
  peak: number;
}

/** What the offline test reads from the Orchestra beyond its public API. */
interface Internals { ready: Map<string, { samples: Lib.LoadedSample[]; last: Lib.LoadedSample | null }> }

// Runs in the browser (serialized with toString, so no closures): render
// offline and measure.
const OFFLINE_TEST = async (sampleRate: number): Promise<OfflineResult> => {
  const lib = '/dist/index.js';
  const { Orchestra } = (await import(lib)) as typeof Lib;
  const secs = 10;
  const ctx = new OfflineAudioContext(2, sampleRate * secs, sampleRate);
  const orch = new Orchestra<string>(ctx, { baseUrl: '/samples/', reverb: false });
  const internals = orch as unknown as Internals;
  const names = ['woodblock', 'violins', 'harp', 'timpani', 'cymbal', 'tuba'];
  await orch.load(names);
  const loaded = names.filter((n) => orch.has(n));
  const unknownIsNull = orch.note({ instrument: 'nonexistent', midi: 60 }) === null && orch.note({ instrument: 'violins' }) === null;
  // What did the decoder do with the MP3 priming?
  const shifts = new Set<number>();
  for (const n of loaded) for (const s of internals.ready.get(n)!.samples) shifts.add(Math.round(s.shift * 44100));

  orch.note({ instrument: 'woodblock', at: 0.5, velocity: 1 });
  const v = orch.note({ instrument: 'violins', midi: 67, at: 1.0, duration: 7, velocity: 0.8 });
  // the tuba is stopped in the middle of its note - that must not click
  const t = orch.note({ instrument: 'tuba', midi: 41, at: 1.2, duration: 5, velocity: 0.9 });
  t?.stop(2.05, 0.1);
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const rms = (a: number, b: number) => {
    let s = 0;
    const i0 = Math.round(a * sr), i1 = Math.round(b * sr);
    for (let i = i0; i < i1; i++) s += x[i]! * x[i]!;
    return Math.sqrt(s / (i1 - i0));
  };
  // Onset: first sample above 10 % of the peak - measured in the rendered
  // output and in the sample itself from `offset` on. Equal = the attack sits
  // exactly on `at`; the distance within the sample shows how close `offset`
  // is to the audible attack.
  const firstOver = (d: Float32Array, from: number, to: number, rate: number): number => {
    let m = 0;
    for (let i = from; i < to; i++) m = Math.max(m, Math.abs(d[i]!));
    for (let i = from; i < to; i++) if (Math.abs(d[i]!) >= 0.1 * m) return (i - from) / rate;
    return NaN;
  };
  const wb = internals.ready.get('woodblock')!.last!;
  const wd = wb.buffer.getChannelData(0), wr = wb.buffer.sampleRate;
  const wo = (wb.offset ?? 0) + wb.shift;
  const expected = firstOver(wd, Math.round(wo * wr), Math.round((wo + 0.3) * wr), wr);
  const got = firstOver(x, Math.round(0.5 * sr), Math.round(0.8 * sr), sr);
  // largest step between two samples around the tuba stop, compared with the
  // largest step in the sound before it
  let jumpStop = 0, jumpBefore = 0;
  for (let i = Math.round(1.6 * sr); i < Math.round(2.0 * sr); i++) jumpBefore = Math.max(jumpBefore, Math.abs(x[i]! - x[i - 1]!));
  for (let i = Math.round(2.0 * sr); i < Math.round(2.4 * sr); i++) jumpStop = Math.max(jumpStop, Math.abs(x[i]! - x[i - 1]!));
  return {
    loaded,
    unknownIsNull,
    decoderShiftSamples: [...shifts],
    voice: typeof v?.stop === 'function',
    woodblockAttackAfterOffsetMs: expected * 1000,
    woodblockOnsetErrorMs: (got - expected) * 1000,
    nan: x.some((s) => !Number.isFinite(s)),
    rmsViolin: { '2-3s': rms(2.2, 3), '6-7s': rms(6, 7), '8.6-9.6s': rms(8.6, 9.6) },
    stopJumpRatio: jumpStop / jumpBefore,
    peak: x.reduce((m, s) => Math.max(m, Math.abs(s)), 0),
  };
};

interface RenderResult {
  seconds: number;
  channels: number;
  onsetsMs: number[];
  nan: boolean;
  peak: number;
  crescendo: number;
  wavBytes: number;
}

// Runs in the browser like OFFLINE_TEST. Woodblock on beats 0-3 at 120 bpm,
// 60 bpm from beat 2 on: hits at 0, 0.5, 1.0 and 2.0 s. Violins with a
// crescendo over beats 4-8 (3-7 s).
const RENDER_TEST = async (limiter: boolean): Promise<RenderResult> => {
  const lib = '/dist/index.js';
  const { Orchestra, encodeWav } = (await import(lib)) as typeof Lib;
  const orch = new Orchestra<string>(new OfflineAudioContext(2, 44100, 44100), { baseUrl: '/samples/', limiter });
  const buf = await orch.render({
    bpm: 120,
    tempo: [[2, 60]],
    lengthBeats: 8,
    parts: [
      { instrument: 'woodblock', velocity: 1, notes: [[0, null, 0.25], [1, null, 0.25], [2, null, 0.25], [3, null, 0.25]] },
      { instrument: 'violins', velocity: 1, dynamics: [[4, 0.1], [8, 1, true]], notes: [[4, 'G4', 4]] },
    ],
  }, { tail: 1, bus: { reverb: 0 } });
  const x = buf.getChannelData(0);
  const sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  // attack near each expected hit: first sample over 30 % of the local peak
  const onsets = [0, 0.5, 1, 2].map((t) => {
    const i0 = Math.max(0, Math.round((t - 0.1) * sr)), i1 = Math.round((t + 0.2) * sr);
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(x[i]!));
    for (let i = i0; i < i1; i++) if (Math.abs(x[i]!) >= 0.3 * m) return (i / sr) * 1000;
    return NaN;
  });
  const rms = (a: number, b: number) => {
    let s = 0;
    for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) s += x[i]! * x[i]!;
    return Math.sqrt(s / ((b - a) * sr));
  };
  return {
    seconds: buf.duration,
    channels: buf.numberOfChannels,
    onsetsMs: onsets.map((o) => Math.round(o * 10) / 10),
    nan: x.some((v) => !Number.isFinite(v)),
    peak,
    // the end of the crescendo against its start
    crescendo: rms(6.3, 6.9) / rms(3.3, 3.9),
    wavBytes: encodeWav(buf).byteLength,
  };
};

async function main(): Promise<void> {
  const chrome = await findChrome();
  if (!chrome) {
    console.log('No Chromium found (set CHROME=...). Skipped.');
    return;
  }
  const server = await startServer(0, { quiet: true });
  const port = (server.address() as AddressInfo).port;
  const profile = await mkdtemp(join(tmpdir(), 'tiny-orchestra-'));
  const proc = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const problems: string[] = [];
  let page: Cdp | null = null;
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stderr.on('data', (d: Buffer) => {
        buf += d.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) resolve(m[1]!);
      });
      proc.on('exit', () => reject(new Error('Chromium exited:\n' + buf)));
      setTimeout(() => reject(new Error('Chromium does not start:\n' + buf)), 15000);
    });
    const devPort = new URL(wsUrl).port;
    const pages = (await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const target = pages.find((p) => p.type === 'page');
    if (!target) throw new Error('no page target');
    page = new Cdp(target.webSocketDebuggerUrl);
    await page.open();
    const logs: [string, string][] = [];
    page.on((msg) => {
      const p = msg.params;
      if (!p) return;
      if (msg.method === 'Runtime.exceptionThrown') logs.push(['exception', p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '']);
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type ?? '')) {
        logs.push([p.type!, (p.args ?? []).map((a) => String(a.value ?? a.description)).join(' ')]);
      }
      if (msg.method === 'Log.entryAdded' && p.entry && ['error', 'warning'].includes(p.entry.level)) {
        logs.push([`log-${p.entry.level}`, `${p.entry.text} ${p.entry.url ?? ''}`]);
      }
    });
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/demo/` });
    await new Promise((r) => setTimeout(r, 500));
    await page.eval('new Promise((r) => { const w = () => window.__demo ? r() : setTimeout(w, 50); w(); })');

    // 1. Loading
    const t0 = Date.now();
    const ready = await page.eval<{ loaded: string[]; missing: string[] }>('window.__demo.ready');
    console.log(`Demo loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${ready.loaded.length} instruments, missing: ${ready.missing.join(', ') || '-'}`);
    if (ready.missing.length) problems.push(`missing instruments: ${ready.missing.join(', ')}`);
    if (ready.loaded.length !== 25) problems.push(`expected 25 instruments, got ${ready.loaded.length}`);

    // 2. Play the piece
    const play = await page.eval<{ pos: number; state: string; errors: string[] }>(`(async () => {
      document.getElementById('piece').click();
      await new Promise((r) => setTimeout(r, 2500));
      const d = window.__demo;
      const pos = d.perf ? d.perf.position : -1;
      const state = d.ctx.state;
      document.getElementById('stop').click();
      await new Promise((r) => setTimeout(r, 1000));
      return { pos, state, errors: d.errors };
    })()`);
    console.log(`Piece: context ${play.state}, position after 2.5 s: ${play.pos.toFixed(2)} beats`);
    if (play.state === 'running' && !(play.pos > 1)) problems.push(`the piece does not start (position ${play.pos})`);
    if (play.state !== 'running') console.log('  (the audio clock does not run headless - playback checked offline only)');

    // 3. Offline
    for (const sr of [44100, 48000]) {
      const r = await page.eval<OfflineResult>(`(${OFFLINE_TEST.toString()})(${sr})`);
      console.log(`Offline ${sr} Hz:`, JSON.stringify(r));
      if (r.loaded.length < 6) problems.push(`${sr}: not everything loaded`);
      if (!r.unknownIsNull) problems.push(`${sr}: note() without instrument/midi does not return null`);
      if (!r.voice) problems.push(`${sr}: note() did not return a voice`);
      if (r.nan) problems.push(`${sr}: NaN in the output`);
      if (!(Math.abs(r.woodblockOnsetErrorMs) < 1)) problems.push(`${sr}: woodblock onset ${r.woodblockOnsetErrorMs} ms off`);
      if (!(r.woodblockAttackAfterOffsetMs < 6)) problems.push(`${sr}: attack only ${r.woodblockAttackAfterOffsetMs} ms after offset`);
      if (!(r.rmsViolin['6-7s'] > 0.3 * r.rmsViolin['2-3s'])) problems.push(`${sr}: the violin does not carry across the loop`);
      if (!(r.rmsViolin['8.6-9.6s'] < 0.02 * r.rmsViolin['2-3s'])) problems.push(`${sr}: the violin does not fade out`);
      if (r.stopJumpRatio > 1.5) problems.push(`${sr}: jump when stopping (${r.stopJumpRatio.toFixed(2)})`);
    }

    // 4. render()
    const r0 = await page.eval<RenderResult>(`(${RENDER_TEST.toString()})(false)`);
    console.log('Render without limiter:', JSON.stringify(r0));
    const r = await page.eval<RenderResult>(`(${RENDER_TEST.toString()})(true)`);
    console.log('Render:', JSON.stringify(r));
    // beats 0-2 at 120 bpm and 2-8 at 60 bpm: 1 s + 6 s, plus the tail
    if (Math.abs(r.seconds - 8) > 0.01) problems.push(`render: ${r.seconds} s instead of 8`);
    if (r.channels !== 2) problems.push(`render: ${r.channels} channels`);
    // The two woodblock samples take 2.5 and 8 ms to 30 % of their peak (the
    // round robin picks one at random); the limiter adds its lookahead (6 ms
    // in Chromium) on top.
    const want = [0, 500, 1000, 2000];
    const late = (x: RenderResult, max: number) => x.onsetsMs.some((o, i) => !(o - want[i]! >= 0 && o - want[i]! < max));
    if (late(r0, 10)) problems.push(`render: woodblock at ${r0.onsetsMs.join(', ')} ms, expected ${want.join(', ')}`);
    if (late(r, 16)) problems.push(`render with limiter: woodblock at ${r.onsetsMs.join(', ')} ms, expected ${want.join(', ')}`);
    if (r0.nan || r.nan) problems.push('render: NaN in the output');
    // below the threshold the limiter changes nothing (its makeup gain is undone)
    if (!(Math.abs(r.peak / r0.peak - 1) < 0.01)) problems.push(`render: the limiter changes the level (${r0.peak} -> ${r.peak})`);
    if (!(r0.crescendo > 4)) problems.push(`render: crescendo only x${r0.crescendo.toFixed(2)}`);
    if (r.wavBytes !== 44 + 8 * 44100 * 2 * 2) problems.push(`render: WAV has ${r.wavBytes} bytes`);

    // 5. every example score renders cleanly
    const pieces = await page.eval<{ name: string; seconds: number; peak: number; nan: boolean }[]>(`(async () => {
      const { Orchestra } = await import('/dist/index.js');
      const scores = ${JSON.stringify(scores)};
      const orch = new Orchestra(new OfflineAudioContext(2, 44100, 44100), { baseUrl: '/samples/' });
      const out = [];
      for (const [name, score] of Object.entries(scores)) {
        const buf = await orch.render(score, { tail: 2 });
        const x = buf.getChannelData(0), y = buf.getChannelData(1);
        let peak = 0, nan = false;
        for (let i = 0; i < x.length; i++) {
          const a = Math.max(Math.abs(x[i]), Math.abs(y[i]));
          if (!Number.isFinite(a)) nan = true;
          else if (a > peak) peak = a;
        }
        out.push({ name, seconds: buf.duration, peak, nan });
      }
      return out;
    })()`);
    for (const p of pieces) {
      console.log(`Score ${p.name}: ${p.seconds.toFixed(1)} s, peak ${p.peak.toFixed(3)}`);
      if (p.nan) problems.push(`score ${p.name}: NaN`);
      if (!(p.peak > 0.05)) problems.push(`score ${p.name}: nearly silent (${p.peak})`);
      if (!(p.peak < 1)) problems.push(`score ${p.name}: clips (${p.peak})`);
    }

    // 6. the site
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/site/` });
    await page.eval('new Promise((r) => { const w = () => window.__site ? r() : setTimeout(w, 50); w(); })');
    // both pieces: a row per part, the notes drawn, inside the instrument ranges
    const sitePieces = await page.eval<{ id: string; rows: number; parts: number; notes: number; outOfRange: string[] }[]>(`(async () => {
      await window.__site.ready;
      const { orch, select } = window.__site;
      const { toMidi } = await import('/site/lib/index.js');
      const out = [];
      for (const id of ['simple', 'canon']) {
        await select(id);
        const mod = await import(URL.createObjectURL(new Blob([document.getElementById('source').value], { type: 'text/javascript' })));
        const outOfRange = [];
        for (const p of mod.default.parts) {
          const def = orch.manifest.instruments[p.instrument];
          if (!def) { outOfRange.push(p.instrument + ' unknown'); continue; }
          for (const n of p.notes) {
            const m = toMidi(n[1]) + (p.transpose || 0);
            if (def.pitched && (m < def.range[0] || m > def.range[1])) outOfRange.push(p.name + ' ' + n[1] + ' at ' + n[0]);
          }
        }
        out.push({
          id,
          rows: document.querySelectorAll('#names .lane-name').length,
          parts: mod.default.parts.length,
          notes: document.querySelectorAll('#notes rect.note').length,
          outOfRange,
        });
      }
      return out;
    })()`);
    for (const p of sitePieces) {
      console.log(`Site, ${p.id}: ${p.rows} rows, ${p.notes} notes`);
      if (p.rows !== p.parts) problems.push(`site ${p.id}: ${p.rows} rows for ${p.parts} parts`);
      if (!(p.notes > 20)) problems.push(`site ${p.id}: only ${p.notes} notes drawn`);
      if (p.outOfRange.length) problems.push(`site ${p.id}: notes out of range: ${p.outOfRange.join(', ')}`);
    }
    const shots = process.env['SCREENSHOTS'];
    const shoot = async (name: string) => {
      if (!shots) return;
      await mkdir(shots, { recursive: true });
      const { data } = await page!.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
    };
    await shoot('site-ready');
    const played = await page.eval<{ state: string; pos: number; playhead: string; errors: string[] }>(`(async () => {
      document.getElementById('play').click();
      await new Promise((r) => setTimeout(r, 3000));
      const d = window.__site;
      return { state: d.ctx.state, pos: d.perf ? d.perf.position : -1, playhead: document.getElementById('playhead').style.transform, errors: [] };
    })()`);
    console.log(`Site playing: context ${played.state}, position ${played.pos.toFixed(2)}, playhead ${played.playhead}`);
    if (played.state === 'running' && !(played.pos > 1)) problems.push(`site: the piece does not play (position ${played.pos})`);
    await shoot('site-playing');
    const edited = await page.eval<{ error: string; errorHidden: boolean; handedOver: boolean; errorAfter: boolean }>(`(async () => {
      const d = window.__site;
      const src = document.getElementById('source');
      const good = src.value;
      src.value = good.replace("sequence } from", "sequence, } from").replace('bpm: 72,', 'bpm: 72,,');
      await d.runChanges();
      const box = document.getElementById('error');
      const error = box.textContent, errorHidden = box.hidden;
      const before = d.perf;
      src.value = good.replace("velocity: 0.6, pan: 0.2", "velocity: 0.7, pan: 0.2");
      await d.runChanges();
      const handedOver = d.perf !== null && d.perf !== before;
      const errorAfter = !box.hidden;
      document.getElementById('stop').click();
      src.value = good;
      return { error, errorHidden, handedOver, errorAfter };
    })()`);
    console.log(`Site editing: error "${edited.error}", handed over: ${edited.handedOver}`);
    if (edited.errorHidden || !edited.error) problems.push('site: broken code shows no error');
    if (edited.errorAfter) problems.push('site: the error stays after fixing the code');
    if (played.state === 'running' && !edited.handedOver) problems.push('site: changed code does not take over');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await shoot('site-mobile');
    await page.send('Emulation.clearDeviceMetricsOverride');

    const errs = logs.concat(play.errors.map((e): [string, string] => ['page', e]));
    if (errs.length) {
      console.log('Console:');
      for (const [k, m] of errs) console.log(`  [${k}] ${m}`);
      problems.push(`${errs.length} messages in the console`);
    } else {
      console.log('Console: no errors or warnings.');
    }
  } finally {
    page?.close();
    proc.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  if (problems.length) {
    console.error('\nProblems:\n' + problems.map((p) => '  ' + p).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\nBrowser check passed.');
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
