// Loading, voices, performances and rendering of the Orchestra against the
// fake AudioContext (see orchestra.test.ts for the basics).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { Orchestra } from '../src/index.ts';
import { fakeContext, manifest, stubFetch } from './fake-audio.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

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
