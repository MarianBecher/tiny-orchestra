// The Orchestra: loads the samples described by manifest.json, plays single
// notes with pitch, velocity and envelope, and plays whole scores - looped,
// too. Everything that works without an AudioContext lives in the pure
// modules next to this one; this class only wires them up.

import { decode, dirOf, limiter, withSlash } from './loader.ts';
import { detectOnset, decoderShift } from './onset.ts';
import { midiToFreq, pickSample, pickVariant, playbackRate, velocityGain } from './pitch.ts';
import { createBus, createReverb, rampFromNow } from './reverb.ts';
import { startScheduler, type Scheduler } from './scheduler.ts';
import { beatToTime, flattenScore, scoreLength, timeToBeat, wrapPosition } from './score.ts';
import type {
  Bus, BusOptions, LoadOptions, Manifest, ManifestInstrument, ManifestSample, NoteOptions, OrchestraOptions,
  Output, Performance, PlayOptions, Score, Voice,
} from './types.ts';
import type { InstrumentName } from './instruments.ts';

/** A manifest sample with its decoded audio. */
export interface LoadedSample extends ManifestSample {
  buffer: AudioBuffer;
  /** Seconds this browser's decoder moved the content (see decoderShift). */
  shift: number;
}

interface LoadedInstrument extends Omit<ManifestInstrument, 'samples'> {
  name: string;
  samples: LoadedSample[];
  /** Last unpitched sample played, for the round robin. */
  last: LoadedSample | null;
}

/** An instrument being loaded: the whole of it, and each file. */
interface Loading {
  promise: Promise<void>;
  files: Promise<unknown>[];
  /** Of the load() call that started it. */
  signal: AbortSignal | undefined;
}

// Fade-in at the offset, only against clicks - the attack is in the sample.
// Shorter for hits, where the sample already starts just before the peak.
const ATTACK = 0.003;
const ATTACK_HIT = 0.001;
const LOG = '[tiny-orchestra]';

const nodeOf = (out: Output): AudioNode => ('input' in out ? out.input : out);

/**
 * The sampler. `I` is the set of instrument names it accepts: by default the
 * bundled ones, so a typo is a compile error. With a custom manifest use
 * `new Orchestra<string>(ctx, { manifest })` (inferred when you pass a
 * `Manifest<string>` object).
 */
export class Orchestra<I extends string = InstrumentName> {
  readonly ctx: BaseAudioContext;
  /** Folder of the sample files, with a trailing slash (or empty). */
  readonly baseUrl: string;
  readonly destination: AudioNode;

  private readonly manifestUrl: string;
  private manifestData: Manifest<I> | null = null;
  private manifestPromise: Promise<Manifest<I>> | null = null;
  private readonly loading = new Map<string, Loading>();
  private readonly ready = new Map<string, LoadedInstrument>();
  private readonly fetchLimited = limiter(6);
  private readonly reverbIn: GainNode | null;
  private defaultBus: Bus | null = null;

  constructor(ctx: BaseAudioContext, options: OrchestraOptions<I> = {}) {
    const { baseUrl, destination = ctx.destination, manifest, reverb = true, reverbSeconds = 2.6 } = options;
    this.ctx = ctx;
    this.destination = destination;
    this.baseUrl = withSlash(baseUrl ?? (typeof manifest === 'string' ? dirOf(manifest) : ''));
    this.manifestUrl = typeof manifest === 'string' ? manifest : this.baseUrl + 'manifest.json';
    if (manifest && typeof manifest === 'object') {
      this.manifestData = manifest;
      this.manifestPromise = Promise.resolve(manifest);
    }
    this.reverbIn = reverb ? createReverb(ctx, destination, reverbSeconds) : null;
  }

  static midiToFreq(midi: number): number {
    return midiToFreq(midi);
  }

  /** All instrument names in the manifest (empty until it has loaded). */
  get instruments(): I[] {
    return this.manifestData ? (Object.keys(this.manifestData.instruments) as I[]) : [];
  }

  /** The loaded manifest, or null until `load()` has fetched it. */
  get manifest(): Manifest<I> | null {
    return this.manifestData;
  }

  /** True once the instrument is decoded and playable. */
  has(instrument: I): boolean {
    return this.ready.has(instrument);
  }

  /**
   * Load the manifest and the instruments (no argument: all of them). Never
   * throws - whatever is missing is simply missing, with a console warning.
   * Calling it again loads nothing twice.
   */
  async load(instruments?: readonly I[], options: LoadOptions = {}): Promise<void> {
    const { onProgress, signal } = options;
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(this.manifestUrl).then(async (r) => {
        if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
        return (await r.json()) as Manifest<I>;
      });
    }
    let manifest: Manifest<I>;
    try {
      manifest = await this.manifestPromise;
      this.manifestData = manifest;
    } catch (err) {
      console.warn(`${LOG} could not load the manifest:`, err);
      this.manifestPromise = null; // try again on the next load()
      return;
    }
    if (signal?.aborted) return;
    // the manifest decides what exists at runtime, whatever the types say
    const all = Object.keys(manifest.instruments) as I[];
    const wanted = instruments ?? all;
    for (const n of wanted) if (!all.includes(n)) console.warn(`${LOG} unknown instrument: ${n}`);
    const entries = wanted.filter((n) => all.includes(n)).map((n) => this.loadInstrument(manifest, n, signal));
    let finished = false;
    if (onProgress) {
      const files = entries.flatMap((e) => e.files);
      let done = 0;
      for (const f of files) void f.then(() => { if (!finished) onProgress(++done, files.length); });
    }
    const aborted = new Promise<void>((resolve) => signal?.addEventListener('abort', () => {
      // forget right away what this call started, so the next load() starts afresh
      for (const [n, e] of this.loading) if (e.signal === signal) this.loading.delete(n);
      resolve();
    }, { once: true }));
    await Promise.race([Promise.all(entries.map((e) => e.promise)), aborted]);
    finished = true;
  }

  private loadInstrument(manifest: Manifest<I>, name: I, signal: AbortSignal | undefined): Loading {
    const known = this.loading.get(name);
    if (known) return known;
    const def = manifest.instruments[name]!;
    const files = def.samples.map((s) => this.fetchLimited(async (): Promise<LoadedSample> => {
      if (signal?.aborted) throw new Error('aborted');
      const res = await fetch(this.baseUrl + s.file, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`${s.file}: HTTP ${res.status}`);
      const buffer = await decode(this.ctx, await res.arrayBuffer());
      return { ...s, buffer, shift: shiftFor(s, buffer) };
    }).catch((err: unknown) => {
      if (!signal?.aborted) console.warn(`${LOG} ${name}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }));
    const entry: Loading = { files, signal, promise: Promise.resolve() };
    entry.promise = Promise.all(files).then((loaded) => {
      // unloaded or aborted in the meantime: forget it
      if (this.loading.get(name) !== entry || signal?.aborted) return;
      const samples = loaded.filter((s): s is LoadedSample => s !== null);
      if (!samples.length) {
        console.warn(`${LOG} ${name} is missing (no sample could be loaded)`);
        return;
      }
      // An instrument that lacks only some samples stays usable with the rest.
      this.ready.set(name, { ...def, name, samples, last: null });
    });
    this.loading.set(name, entry);
    return entry;
  }

  /**
   * Forget instruments (no argument: all of them), so their audio can be
   * garbage collected. Notes that are sounding play on; a later `load()`
   * fetches them again.
   */
  unload(instruments?: readonly I[]): void {
    const names: string[] = instruments ? [...instruments] : [...this.loading.keys(), ...this.ready.keys()];
    for (const n of names) {
      this.loading.delete(n);
      this.ready.delete(n);
    }
  }

  /**
   * Browsers keep an AudioContext suspended until the user interacts with
   * the page. This resumes it on the first click, touch or key press on
   * `target` (default: the document); the promise resolves once it runs.
   */
  unlock(target?: EventTarget): Promise<void> {
    const ctx = this.ctx as Partial<AudioContext> & BaseAudioContext;
    if (typeof ctx.resume !== 'function' || ctx.state === 'running') return Promise.resolve();
    const el = target ?? (typeof document !== 'undefined' ? document : null);
    if (!el) return ctx.resume();
    const events = ['pointerdown', 'keydown', 'touchend'];
    return new Promise((resolve) => {
      const off = () => events.forEach((e) => el.removeEventListener(e, on, true));
      const on = () => {
        void ctx.resume!().then(() => {
          if (ctx.state !== 'running') return;
          off();
          resolve();
        }, () => { /* not allowed yet - wait for the next gesture */ });
      };
      events.forEach((e) => el.addEventListener(e, on, true));
    });
  }

  private defaultOut(): AudioNode {
    this.defaultBus ??= this.bus();
    return this.defaultBus.input;
  }

  /**
   * A mixer channel: dry to `destination`, plus a `reverb` share into the
   * shared reverb. Give a game's music and its effects one each, so they can
   * be faded separately.
   */
  bus(options: BusOptions = {}): Bus {
    return createBus(this.ctx, this.destination, this.reverbIn, options);
  }

  /**
   * One note at the absolute audio-clock time `at`. Returns null when the
   * instrument is not loaded (yet) - a game should not crash just because the
   * music is still loading.
   */
  note(options: NoteOptions<I>): Voice | null {
    const { midi, at, duration, velocity = 0.7, out, pan = 0, detune = 0, variant, damp } = options;
    let instrument: string = options.instrument;
    // Timpani rolls live as an instrument of their own, but can also be
    // addressed as a variant of the timpani.
    if (instrument === 'timpani' && variant === 'roll') instrument = 'timpaniRoll';
    const inst = this.ready.get(instrument);
    if (!inst) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = Math.max(at !== undefined && Number.isFinite(at) ? at : now, now);

    let s: LoadedSample | null;
    let rate: number;
    if (inst.pitched) {
      if (typeof midi !== 'number' || !Number.isFinite(midi)) return null;
      s = pickSample(inst.samples, midi, velocity);
      if (!s) return null;
      rate = playbackRate(midi, s.midi ?? midi, detune, s.tune || 0);
    } else {
      s = pickVariant(inst.samples, variant, inst.defaultVariant, inst.last);
      inst.last = s;
      rate = Math.pow(2, detune / 1200);
    }
    if (!s) return null;

    const buf = s.buffer;
    const shift = s.shift || 0;
    const baseOffset = s.offset ?? 0;
    const offset = baseOffset + shift;
    const release = Math.max(0.01, inst.release ?? 0.3);
    const amp = (inst.gain ?? 1) * (s.gain ?? 1) * velocityGain(velocity, s.vel ?? 1);
    const hasDur = duration !== undefined && Number.isFinite(duration) && duration > 0;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    const stopper = ctx.createGain(); // only for Voice.stop(), see below
    const attack = inst.sustain ? ATTACK : ATTACK_HIT;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + attack);
    src.connect(env).connect(stopper);
    let tail: AudioNode = stopper;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      stopper.connect(p);
      tail = p;
    }
    tail.connect(out ? nodeOf(out) : this.defaultOut());

    // How long the sample lasts without looping (in real time)
    const natural = (buf.duration - offset) / rate;
    let releaseAt: number | null = null;
    if (inst.sustain) {
      if (hasDur) {
        releaseAt = t + duration;
        if (s.loopEnd && s.loopStart !== undefined && duration + release > (s.loopEnd - baseOffset) / rate - 0.02) {
          src.loop = true;
          src.loopStart = s.loopStart + shift;
          src.loopEnd = s.loopEnd + shift;
        }
      }
      // without a duration: play through once, the file fades out by itself
    } else if (hasDur && (damp ?? inst.damp)) {
      releaseAt = t + duration;
    }

    let endAt = t + natural + 0.02;
    if (releaseAt !== null) {
      const ra = Math.max(releaseAt, t + attack);
      env.gain.setValueAtTime(amp, ra);
      // Decay exponentially: with a time constant of release/5 the note is
      // at -43 dB after `release`, and inaudible when it is cut after that.
      env.gain.setTargetAtTime(0, ra, release / 5);
      const stopAt = ra + release * 1.3;
      endAt = src.loop ? stopAt : Math.min(endAt, stopAt);
    }
    src.start(t, offset);
    src.stop(endAt);

    let endTime = endAt;
    let stopFrom = Infinity;
    src.onended = () => {
      src.disconnect();
      env.disconnect();
      stopper.disconnect();
      if (tail !== stopper) tail.disconnect();
    };
    return {
      startTime: t,
      get endTime() {
        return endTime;
      },
      // Stopping goes through a gain node of its own. That way nothing of the
      // envelope above has to be cancelled (cancelScheduledValues in the
      // middle of a ramp jumps, depending on the browser) - a second fader
      // is simply turned down.
      stop: (when = ctx.currentTime, rel = 0.1) => {
        const from = Math.max(when, ctx.currentTime);
        if (from >= stopFrom) return;
        stopFrom = from;
        const r = Math.max(0.005, rel);
        stopper.gain.cancelScheduledValues(from);
        stopper.gain.setValueAtTime(1, from);
        stopper.gain.setTargetAtTime(0, from, r / 5);
        const end = from + r * 1.3 + 0.01;
        if (end < endTime) {
          endTime = end;
          try { src.stop(end); } catch { /* some browsers allow stop() only once - the fader is closed anyway */ }
        }
      },
    };
  }

  /**
   * Play a score. It is planned only a short stretch ahead (see
   * scheduler.ts), so `stop()` takes effect at once and loops run forever.
   */
  play(score: Score<I>, options: PlayOptions = {}): Performance {
    const { at, bpm, transpose = 0, out, loop = false, velocity = 1 } = options;
    const ctx = this.ctx;
    const tempo = bpm || score.bpm || 120;
    const events = flattenScore(score, { transpose, velocity });
    const lengthBeats = scoreLength(score);
    const start = Math.max(at !== undefined && Number.isFinite(at) ? at : ctx.currentTime + 0.05, ctx.currentTime);

    // A fader per performance, so stop() can fade out without touching the
    // bus, on which other things may still be playing.
    const gain = ctx.createGain();
    gain.connect(out ? nodeOf(out) : this.defaultOut());

    let stopped = false;
    let ended = false;
    let scheduler: Scheduler | null = null;

    const perf: Performance = {
      startTime: start,
      bpm: tempo,
      lengthBeats,
      loop,
      endTime: loop ? Infinity : beatToTime(lengthBeats, start, tempo),
      onEnd: null,
      get position() {
        return wrapPosition(timeToBeat(ctx.currentTime, start, tempo), lengthBeats, loop);
      },
      get playing() {
        return !stopped && !ended;
      },
      stop: (fadeSeconds = 0.5) => {
        if (stopped) return;
        stopped = true;
        const f = Math.max(0.02, fadeSeconds);
        rampFromNow(ctx, gain.gain, 0, f);
        scheduler?.stop(ctx.currentTime + f);
        setTimeout(() => gain.disconnect(), (f + 0.2) * 1000);
      },
    };

    scheduler = startScheduler({
      events,
      lengthBeats,
      loop,
      startTime: start,
      bpm: tempo,
      now: () => ctx.currentTime,
      schedule: (ev, time, duration) => this.note({
        instrument: ev.instrument as I, // came from the Score<I>
        midi: ev.midi,
        at: time,
        duration,
        velocity: ev.velocity,
        pan: ev.pan,
        variant: ev.variant,
        out: gain,
      }),
      onEnd: () => {
        ended = true;
        setTimeout(() => gain.disconnect(), 8000); // let the reverb tail ring
        perf.onEnd?.(perf);
      },
    });
    return perf;
  }
}

/** Decoder delay of this browser for one sample, see decoderShift. */
function shiftFor(s: ManifestSample, buffer: AudioBuffer): number {
  if (s.duration === undefined || !(s.duration > 0) || buffer.duration - s.duration < 0.01) return 0;
  const onset = detectOnset(buffer.getChannelData(0), buffer.sampleRate, -36, false) / buffer.sampleRate;
  return decoderShift(buffer.duration, s.duration, onset, s.mark);
}
