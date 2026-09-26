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

import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, access, readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import type * as Lib from '../src/index.ts';
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
