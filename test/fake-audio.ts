// A minimal fake AudioContext for the Orchestra tests: nodes record what
// they are connected to, params record their automation.

import { vi } from 'vitest';
import type { Manifest } from '../src/types.ts';

export class FakeParam {
  value = 1;
  events: [string, ...number[]][] = [];
  setValueAtTime(v: number, t: number) { this.events.push(['set', v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(['ramp', v, t]); }
  setTargetAtTime(v: number, t: number, c: number) { this.events.push(['target', v, t, c]); }
  cancelScheduledValues(t: number) { this.events.push(['cancel', t]); }
  cancelAndHoldAtTime(t: number) { this.events.push(['hold', t]); }
}

export class FakeNode {
  outputs: unknown[] = [];
  connect<T>(n: T): T { this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}

export class FakeGain extends FakeNode { gain = new FakeParam(); }
export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
}
export class FakePanner extends FakeNode { pan = new FakeParam(); }
export class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: [number, number] | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(t: number, offset: number) { this.started = [t, offset]; }
  stop(t: number) { this.stopped = t; }
}

export function fakeContext() {
  const sources: FakeSource[] = [];
  const gains: FakeGain[] = [];
  const ctx = {
    currentTime: 1,
    sampleRate: 44100,
    destination: new FakeNode(),
    createGain: () => { const g = new FakeGain(); gains.push(g); return g; },
    createDynamicsCompressor: () => new FakeCompressor(),
    createStereoPanner: () => new FakePanner(),
    createBufferSource: () => { const s = new FakeSource(); sources.push(s); return s; },
    decodeAudioData: (data: ArrayBuffer) => Promise.resolve({
      duration: new DataView(data).getFloat32(0),
      sampleRate: 44100,
      getChannelData: () => new Float32Array(10),
    }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources, gains, raw: ctx };
}

export const manifest: Manifest = {
  version: 1,
  source: 'test',
  format: { codec: 'mp3', kbps: 96, sampleRate: 44100, channels: 1 },
  instruments: {
    violins: {
      pitched: true, sustain: true, release: 0.35, range: [55, 67],
      samples: [
        { file: 'violins/G3.mp3', midi: 55, offset: 0.01, loopStart: 1.26, loopEnd: 2.86, duration: 3.11, mark: 0 },
        { file: 'violins/G4.mp3', midi: 67, offset: 0.01, loopStart: 1.26, loopEnd: 2.86, duration: 3.11, mark: 0, tune: 10 },
      ],
    },
    woodblock: {
      pitched: false, release: 0.05, defaultVariant: 'hit', variants: ['hit'],
      samples: [{ file: 'woodblock/hit1.mp3', variant: 'hit', offset: 0.002, duration: 0.6 }],
    },
    broken: { pitched: true, samples: [{ file: 'broken/C4.mp3', midi: 60 }] },
  },
};

/** fetch stub: every mp3 decodes to a buffer of the length the manifest expects. */
export function stubFetch(urls: string[], failing: RegExp = /broken/) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (failing.test(url)) return new Response(null, { status: 404 });
    if (url.endsWith('manifest.json')) return Response.json(manifest);
    const file = Object.values(manifest.instruments).flatMap((i) => i.samples).find((s) => url.endsWith(s.file));
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, file?.duration ?? 1);
    return new Response(buf);
  }));
}
