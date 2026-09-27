// The Orchestra class against a minimal fake AudioContext. Only the wiring
// that does not need real audio is checked here - how it sounds, and that
// attacks land on time, is the job of `npm run check:browser`.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { INSTRUMENT_NAMES, Orchestra, type InstrumentName, type NoteOptions, type Score } from '../src/index.ts';
import { fakeContext, manifest, stubFetch, type FakeParam } from './fake-audio.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Orchestra', () => {
  test('loads from baseUrl, warns about what is missing, never throws', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = fakeContext();
    const orch = new Orchestra<string>(ctx, { baseUrl: '/audio/samples', reverb: false });
    expect(orch.instruments).toEqual([]);
    await orch.load(['violins', 'broken', 'nope']);
    expect(urls[0]).toBe('/audio/samples/manifest.json');
    expect(urls).toContain('/audio/samples/violins/G3.mp3');
    expect(orch.has('violins')).toBe(true);
    expect(orch.has('broken')).toBe(false);
    expect(orch.has('woodblock')).toBe(false);
    expect(orch.instruments).toEqual(['violins', 'woodblock', 'broken']);
    expect(orch.manifest?.version).toBe(1);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/unknown instrument: nope[\s\S]*broken/);
    // a second load fetches nothing twice
    const before = urls.length;
    await orch.load(['violins']);
    expect(urls.length).toBe(before);
  });

  test('a manifest URL sets the sample folder; a failed manifest is retried', async () => {
    const urls: string[] = [];
    stubFetch(urls, /never/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orch = new Orchestra<string>(fakeContext().ctx, { manifest: 'https://cdn.example/o/manifest.json', reverb: false });
    expect(orch.baseUrl).toBe('https://cdn.example/o/');
    await orch.load(['woodblock']);
    expect(urls).toEqual(['https://cdn.example/o/manifest.json', 'https://cdn.example/o/woodblock/hit1.mp3']);

    stubFetch([], /manifest/);
    const failing = new Orchestra<string>(fakeContext().ctx, { reverb: false });
    await expect(failing.load()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    stubFetch(urls, /never/);
    await failing.load(['woodblock']);
    expect(failing.has('woodblock')).toBe(true);
  });

  test('a manifest object is used without fetching it', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const orch = new Orchestra<string>(fakeContext().ctx, { manifest, baseUrl: 's/', reverb: false });
    expect(orch.instruments).toContain('violins');
    await orch.load(['woodblock']);
    expect(urls).toEqual(['s/woodblock/hit1.mp3']);
  });

  test('note: null when not playable, otherwise a voice at the right time, rate and offset', async () => {
    stubFetch([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, sources } = fakeContext();
    const orch = new Orchestra<string>(ctx, { baseUrl: '', reverb: false });
    expect(orch.note({ instrument: 'violins', midi: 60 })).toBeNull(); // not loaded yet
    await orch.load(['violins', 'woodblock']);
    expect(orch.note({ instrument: 'nope', midi: 60 })).toBeNull();
    expect(orch.note({ instrument: 'violins' })).toBeNull(); // pitched without midi

    const v = orch.note({ instrument: 'violins', midi: 66, at: 2, duration: 1, velocity: 1 });
    expect(v?.startTime).toBe(2);
    const src = sources.at(-1)!;
    expect(src.started).toEqual([2, 0.01]);
    // 66 is closest to the G4 sample (67), which was recorded 10 cents sharp
    expect(src.playbackRate.value).toBeCloseTo(Math.pow(2, (-1 - 0.1) / 12), 12);
    expect(src.loop).toBe(false); // one second fits into the file
    expect(v!.endTime).toBeCloseTo(3 + 0.35 * 1.3, 12);

    orch.note({ instrument: 'violins', midi: 55, at: 0, duration: 7 });
    const long = sources.at(-1)!;
    expect(long.started?.[0]).toBe(1); // in the past -> now
    expect([long.loop, long.loopStart, long.loopEnd]).toEqual([true, 1.26, 2.86]);

    // unpitched ignores midi; timpani + roll maps to timpaniRoll (not loaded here)
    expect(orch.note({ instrument: 'woodblock', midi: 99 })).not.toBeNull();
    expect(orch.note({ instrument: 'timpani', variant: 'roll', midi: 50 })).toBeNull();
  });

  test('voice.stop ramps a separate fader and shortens the voice', async () => {
    stubFetch([]);
    const { ctx } = fakeContext();
    const orch = new Orchestra<string>(ctx, { reverb: false });
    await orch.load(['violins']);
    const v = orch.note({ instrument: 'violins', midi: 60, at: 1, duration: 5 })!;
    const end = v.endTime;
    v.stop(2, 0.1);
    expect(v.endTime).toBeCloseTo(2 + 0.13 + 0.01, 12);
    expect(v.endTime).toBeLessThan(end);
    v.stop(3); // later stop does not undo the earlier one
    expect(v.endTime).toBeCloseTo(2.14, 12);
  });

  test('play: performance fields, position, stop fades and ends playing', async () => {
    vi.useFakeTimers();
    try {
      stubFetch([]);
      const { ctx, raw } = fakeContext();
      const orch = new Orchestra<string>(ctx, { reverb: false });
      await orch.load(['woodblock']);
      const perf = orch.play({ bpm: 120, parts: [{ instrument: 'woodblock', notes: [[0, null, 1], [2, null, 1]] }] }, { at: 2 });
      expect([perf.startTime, perf.bpm, perf.lengthBeats, perf.loop, perf.endTime]).toEqual([2, 120, 4, false, 4]);
      expect(perf.playing).toBe(true);
      raw.currentTime = 3;
      expect(perf.position).toBe(2);
      perf.stop(0.5);
      expect(perf.playing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('bus: fade and set ramp the input gain', () => {
    const { ctx } = fakeContext();
    const orch = new Orchestra<string>(ctx, { reverb: false });
    const bus = orch.bus({ gain: 0.5, pan: -0.2 });
    const g = bus.input.gain as unknown as FakeParam;
    expect(g.value).toBe(0.5);
    bus.fade(0, 2);
    expect(g.events.at(-1)).toEqual(['ramp', 0, 3]);
    bus.set(1);
    expect(g.events.at(-1)).toEqual(['ramp', 1, 1.02]);
  });

  test('midiToFreq is also a static', () => {
    expect(Orchestra.midiToFreq(57)).toBeCloseTo(220, 9);
  });

  test('instrument names are typed: the bundled ones by default, any string on request', () => {
    const { ctx } = fakeContext();
    const bundled = new Orchestra(ctx, { reverb: false });
    expect(bundled.has('violins')).toBe(false);
    // @ts-expect-error - 'violin' is not a bundled instrument
    expect(bundled.note({ instrument: 'violin', midi: 60 })).toBeNull();
    // @ts-expect-error - typos in scores are caught, too
    const typo: Score = { bpm: 90, parts: [{ instrument: 'tympani', notes: [] }] };
    const ok: NoteOptions = { instrument: 'timpani', variant: 'roll', midi: 45 };
    const name: InstrumentName = INSTRUMENT_NAMES[0];
    expect([typo.parts.length, ok.instrument, name]).toEqual([1, 'timpani', 'violins']);

    // a Manifest<string> object makes the orchestra accept any name
    const custom = new Orchestra(ctx, { manifest, reverb: false });
    expect(custom.instruments).toContain('broken');
    expect(custom.has('broken')).toBe(false);
  });
});
