// Loading, voices, performances and rendering of the Orchestra against the
// fake AudioContext (see orchestra.test.ts for the basics).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeupGain, Orchestra, type Score } from '../src/index.ts';
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

describe('performances', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  const wood = (extra: Partial<Score<string>> = {}): Score<string> => ({
    bpm: 120,
    parts: [{ instrument: 'woodblock', name: 'wood', notes: [[0, null, 1], [1, null, 1], [2, null, 1], [3, null, 1]] }],
    ...extra,
  });

  test('from, timeOf, endTime, nextBar, nextBeat', async () => {
    const { orch } = await loaded(['woodblock']);
    const perf = orch.play(wood({ beatsPerBar: 2 }), { at: 2, from: 1 });
    expect(perf.timeOf(1)).toBe(2);
    expect(perf.timeOf(3)).toBe(3);
    expect(perf.endTime).toBe(3.5);
    expect(perf.position).toBe(1);
    expect(perf.nextBar(2.1)).toBe(2.5);
    expect(perf.nextBar()).toBe(2.5); // before the start: the first bar line after beat 1
    expect(perf.nextBeat(2.1)).toBe(2.5);
    expect(perf.nextBar(3.4)).toBe(3.5); // the end
    const looping = orch.play(wood({ beatsPerBar: 3, lengthBeats: 4 }), { at: 2, loop: true });
    expect(looping.nextBar(3.6)).toBe(4); // bars at beats 0 and 3, and every pass starts one: beat 4 at 4 s
  });

  test('a score tempo map; the bpm option scales it', async () => {
    const { orch } = await loaded(['woodblock']);
    const perf = orch.play(wood({ tempo: [[2, 60]] }), { at: 2, bpm: 240 });
    expect(perf.bpm).toBe(240);
    expect(perf.timeOf(2)).toBe(2.5); // 2 beats at 240
    expect(perf.endTime).toBe(3.5);   // 2 beats at 120
  });

  test('setTempo applies from what is planned on', async () => {
    const { orch, raw } = await loaded(['woodblock']);
    const perf = orch.play(wood(), { at: 2 });
    perf.setTempo(60); // nothing planned yet: all of it slower
    expect(perf.bpm).toBe(60);
    expect(perf.endTime).toBe(6);
    raw.currentTime = 2.2;
    vi.advanceTimersByTime(100); // plans up to 2.7 s = beat 0.7 at 60 bpm
    perf.setTempo(120);
    expect(perf.timeOf(0.5)).toBe(2.5);
    expect(perf.timeOf(1.7)).toBeCloseTo(3.2, 9); // 2.7 s + one beat at 120
    perf.setTempo(-1);
    expect(perf.bpm).toBe(120);
  });

  test('setTranspose changes notes planned from then on', async () => {
    const { orch, sources, raw } = await loaded(['violins']);
    const perf = orch.play({ bpm: 120, parts: [{ instrument: 'violins', notes: [[0, 67, 1], [2, 67, 1]] }] }, { at: 1.1 });
    const rate0 = sources.at(-1)!.playbackRate.value;
    perf.setTranspose(-12);
    expect(perf.transpose).toBe(-12);
    raw.currentTime = 2;
    vi.advanceTimersByTime(100);
    expect(rate0).toBeCloseTo(Math.pow(2, -0.1 / 12), 9); // 67 from the G4 sample (10 cents sharp)
    expect(sources.at(-1)!.playbackRate.value).toBe(1); // 55: the G3 sample as it is
  });

  test('part(): by name or index, with its own fader', async () => {
    const { orch, sources } = await loaded(['woodblock']);
    const perf = orch.play({ ...wood(), parts: [{ ...wood().parts[0]!, gain: 0.5 }] }, { at: 1.1 });
    const fader = chain(sources.at(-1)!).out;
    expect(fader.gain.value).toBe(0.5);
    expect(perf.part('wood')?.index).toBe(0);
    perf.part(0)!.fade(0, 2);
    expect((fader.gain as unknown as FakeParam).events.at(-1)).toEqual(['ramp', 0, 3]);
    expect(perf.part('nope')).toBeNull();
    expect(perf.part(3)).toBeNull();
  });

  test('dynamics: automation on a gain of the part', async () => {
    const { orch, sources, raw } = await loaded(['woodblock']);
    orch.play(wood({ parts: [{ ...wood().parts[0]!, dynamics: [[0, 0.5], [2, 1, true]] }] }), { at: 2 });
    while (raw.currentTime < 2.55) {
      raw.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    const dyn = chain(sources.at(-1)!).out.gain as unknown as FakeParam;
    // the ramp is planned with its start, then its end point sets the level
    expect(dyn.events).toEqual([['set', 0.25, 2], ['set', 0.25, 2], ['ramp', 1, 3], ['set', 1, 3]]);
  });

  test('from inside a ramp starts at the level of that point', async () => {
    const { orch, gains } = await loaded(['woodblock']);
    const out = orch.bus();
    const before = gains.length;
    orch.play(wood({ parts: [{ ...wood().parts[0]!, dynamics: [[0, 0], [4, 1, true]] }] }), { at: 2, from: 2, out });
    const dyn = gains[before + 2]!.gain as unknown as FakeParam; // performance, part fader, dynamics
    // halfway (in gain) and the rest of the ramp: beat 4 at 3 s
    expect(dyn.events.slice(0, 2)).toEqual([['set', 0.5, 2], ['ramp', 1, 3]]);
  });

  test('fadeIn and a stop in the future', async () => {
    const { orch, gains, raw } = await loaded(['woodblock']);
    const before = gains.length;
    const perf = orch.play(wood(), { at: 2, fadeIn: 1 });
    const g = gains[before]!.gain as unknown as FakeParam;
    expect(g.events).toEqual([['set', 0, 2], ['ramp', 1, 3]]);
    perf.stop(0.5, 2.5);
    expect(g.events.slice(2)).toEqual([['hold', 2.5], ['ramp', 0, 3]]);
    expect(perf.playing).toBe(true);
    raw.currentTime = 2.6;
    expect(perf.playing).toBe(false);
    perf.stop(0.1, 2.8); // later than the first: ignored
    expect(g.events).toHaveLength(4);
  });

  test('onBeat and onBar fire at their time, not after a stop', async () => {
    const { orch, raw } = await loaded(['woodblock']);
    const perf = orch.play(wood({ beatsPerBar: 2 }), { at: 1.1 });
    const beats: number[] = [];
    const bars: [number, number][] = [];
    perf.onBeat = (b) => beats.push(b);
    perf.onBar = (bar, t) => bars.push([bar, t]);
    for (let i = 0; i < 12; i++) {
      raw.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    // at 2.2 s: beats 0, 1, 2 (1.1, 1.6, 2.1) have fired
    expect(beats).toEqual([0, 1, 2]);
    expect(bars).toEqual([[0, 1.1], [1, 2.1]]);
    perf.stop(0.02);
    vi.advanceTimersByTime(2000);
    expect(beats).toEqual([0, 1, 2]);
  });
});
