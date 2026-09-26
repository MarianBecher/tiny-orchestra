// Pitch, level and sample selection - pure functions, no AudioContext.

import type { ManifestSample } from './types.ts';

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Playback rate that turns a sample of note `sampleMidi` into note `midi`.
 * `detune` is the requested detuning (cents), `tune` the measured detuning
 * of the recording (cents, from the manifest) - which is subtracted.
 */
export function playbackRate(midi: number, sampleMidi: number, detune = 0, tune = 0): number {
  return Math.pow(2, (midi - sampleMidi + (detune - tune) / 100) / 12);
}

/**
 * Gain for a velocity. Quadratic, because that sounds reasonably even across
 * the whole range (0.5 = -12 dB) and stays audible down to 0.1 (-40 dB).
 * `sampleVel` is the velocity the sample was levelled for - the quiet
 * dynamic layer is already quieter in the file, hence the quotient.
 */
export function velocityGain(velocity: number, sampleVel = 1): number {
  const v = Math.max(0, Math.min(1, velocity));
  return (v * v) / (sampleVel * sampleVel);
}

/**
 * Which dynamic layer: the quietest one that is at least as strong as
 * requested - a loud recording played softer sounds more natural than a quiet
 * one pushed up. If none is strong enough, the strongest.
 */
export function pickLayer(vels: readonly number[], velocity: number): number | undefined {
  const sorted = [...new Set(vels)].sort((a, b) => a - b);
  for (const v of sorted) if (v >= velocity - 1e-9) return v;
  return sorted[sorted.length - 1];
}

/** The fields `pickSample` looks at. */
export type PitchedSample = Pick<ManifestSample, 'vel'> & { midi?: number | null };

/**
 * Closest sample to `midi` within the matching dynamic layer. On a tie the
 * lower one (which is then tuned up) - the point is being predictable.
 */
export function pickSample<S extends PitchedSample>(samples: readonly S[], midi: number, velocity = 0.7): S | null {
  if (!samples.length) return null;
  const layer = pickLayer(samples.map((s) => s.vel ?? 1), velocity);
  let best: S | null = null;
  for (const s of samples) {
    if ((s.vel ?? 1) !== layer) continue;
    const sm = s.midi ?? 0;
    if (!best) { best = s; continue; }
    const bm = best.midi ?? 0;
    const d = Math.abs(sm - midi);
    if (d < Math.abs(bm - midi) || (d === Math.abs(bm - midi) && sm < bm)) best = s;
  }
  return best;
}

/**
 * Unpitched: random among the samples of the variant, but never the same one
 * twice in a row (you hear that immediately - the "machine gun" effect).
 * Unknown or missing variant -> the default.
 */
export function pickVariant<S extends Pick<ManifestSample, 'variant'>>(
  samples: readonly S[],
  variant: string | undefined,
  defaultVariant: string | undefined,
  last: S | null = null,
  random: () => number = Math.random,
): S | null {
  let pool = samples.filter((s) => s.variant === variant);
  if (!pool.length) pool = samples.filter((s) => s.variant === defaultVariant);
  if (!pool.length) pool = [...samples];
  if (!pool.length) return null;
  if (pool.length > 1 && last) pool = pool.filter((s) => s !== last);
  return pool[Math.floor(random() * pool.length) % pool.length] ?? null;
}
