// Loading, voices, performances and rendering of the Orchestra against the
// fake AudioContext (see orchestra.test.ts for the basics).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeupGain, Orchestra } from '../src/index.ts';
import { fakeContext, FakeCompressor, manifest, stubFetch, type FakeGain, type FakeNode, type FakeParam, type FakeSource } from './fake-audio.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** The gain nodes a voice goes through: source -> envelope -> stopper -> out. */
function chain(src: FakeSource) {
  const env = src.outputs[0] as FakeGain;
  const stopper = env.outputs[0] as FakeGain;
  return { env: env.gain as unknown as FakeParam, stopper, out: stopper.outputs[0] as FakeGain };
}

async function loaded(names: string[], options: ConstructorParameters<typeof Orchestra<string>>[1] = {}) {
  stubFetch([]);
  const f = fakeContext();
  const orch = new Orchestra<string>(f.ctx, { reverb: false, ...options });
  await orch.load(names);
  return { orch, ...f };
}

describe('loading', () => {
  test('progress counts the files of the call', async () => {
    stubFetch([]);
    const orch = new Orchestra<string>(fakeContext().ctx, { reverb: false });
    const calls: [number, number][] = [];
    await orch.load(['violins', 'woodblock'], { onProgress: (l, t) => calls.push([l, t]) });
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    // already loaded instruments count as done at once
    const again: [number, number][] = [];
    await orch.load(['woodblock'], { onProgress: (l, t) => again.push([l, t]) });
    expect(again).toEqual([[1, 1]]);
  });

  test('abort: resolves early, warns about nothing, and the next load starts afresh', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (url.endsWith('manifest.json')
      ? Promise.resolve(Response.json(manifest))
      : new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orch = new Orchestra<string>(fakeContext().ctx, { reverb: false });
    const ac = new AbortController();
    const p = orch.load(['violins'], { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    await p;
    expect(orch.has('violins')).toBe(false);
    stubFetch([]);
    await orch.load(['violins']);
    expect(orch.has('violins')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).not.toHaveBeenCalled();
    expect(orch.has('violins')).toBe(true); // the aborted attempt does not undo it
  });

  test('unload forgets, a later load fetches again', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const orch = new Orchestra<string>(fakeContext().ctx, { reverb: false });
    await orch.load(['woodblock']);
    orch.unload(['woodblock']);
    expect(orch.has('woodblock')).toBe(false);
    await orch.load(['woodblock']);
    expect(orch.has('woodblock')).toBe(true);
    expect(urls.filter((u) => u.endsWith('hit1.mp3'))).toHaveLength(2);
    orch.unload();
    expect(orch.has('woodblock')).toBe(false);
  });

  test('unlock resumes on the first gesture', async () => {
    const { ctx, raw } = fakeContext();
    const state = { state: 'suspended', resume: vi.fn(async () => { state.state = 'running'; }) };
    Object.defineProperty(raw, 'state', { get: () => state.state });
    Object.assign(raw, { resume: state.resume });
    const orch = new Orchestra<string>(ctx, { reverb: false });
    const target = new EventTarget();
    const p = orch.unlock(target);
    expect(state.resume).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('pointerdown'));
    await p;
    expect(state.state).toBe('running');
    await orch.unlock(target); // already running
    expect(state.resume).toHaveBeenCalledTimes(1);
  });
});

describe('notes', () => {
  test('note names work like MIDI numbers', async () => {
    const { orch, sources } = await loaded(['violins']);
    orch.note({ instrument: 'violins', midi: 'F#4', at: 2 });
    expect(sources.at(-1)!.playbackRate.value).toBeCloseTo(Math.pow(2, (-1 - 0.1) / 12), 12);
    expect(orch.note({ instrument: 'violins', midi: 'H4' })).toBeNull();
  });

  test('velocityEnd ramps the envelope over the note', async () => {
    const { orch, sources } = await loaded(['violins']);
    orch.note({ instrument: 'violins', midi: 60, at: 2, duration: 2, velocity: 0.5, velocityEnd: 1 });
    const { env } = chain(sources.at(-1)!);
    expect(env.events.slice(0, 4)).toEqual([['set', 0, 2], ['ramp', 0.25, 2.003], ['ramp', 1, 4], ['set', 1, 4]]);
  });

  test('voice limit: the oldest sounding voice is faded out', async () => {
    const { orch } = await loaded(['woodblock'], { maxVoices: 2 });
    const a = orch.note({ instrument: 'woodblock', at: 2 })!;
    const b = orch.note({ instrument: 'woodblock', at: 2.1 })!;
    const endB = b.endTime;
    orch.note({ instrument: 'woodblock', at: 2.2 });
    expect(a.endTime).toBeCloseTo(2.2 + 0.05 * 1.3 + 0.01, 9);
    expect(b.endTime).toBe(endB);
    // a voice that has already ended does not count
    orch.note({ instrument: 'woodblock', at: 10 });
    expect(b.endTime).toBe(endB);
  });

  test('limiter: buses go through a compressor into the destination', () => {
    const { ctx, raw } = fakeContext();
    const orch = new Orchestra<string>(ctx, { reverb: false, limiter: true });
    const out = (orch.bus().input as unknown as FakeNode).outputs[0];
    expect(out).toBeInstanceOf(FakeCompressor);
    // then a gain that undoes the compressor's makeup gain
    const trim = (out as FakeCompressor).outputs[0] as FakeGain;
    expect(trim.gain.value).toBeCloseTo(1 / makeupGain(-3, 20), 12);
    expect(trim.outputs[0]).toBe(raw.destination);
  });
});
