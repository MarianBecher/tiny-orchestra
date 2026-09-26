// Finding the attack in a sample, and undoing MP3 decoder delay.

/**
 * Onset in samples - the same computation as in the sample build (which
 * imports exactly this function): 1 ms blocks, first block above -36 dB below
 * the peak, but above four times the noise floor at the start.
 * `useFloor = false` for already trimmed files: there the start is no longer
 * noise but already the tone.
 */
export function detectOnset(x: Float32Array, sr: number, relDb = -36, useFloor = true): number {
  const hop = Math.max(1, Math.round(sr * 0.001));
  const n = Math.ceil(x.length / hop);
  const env = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(x.length, (i + 1) * hop);
    for (let j = i * hop; j < end; j++) {
      const v = x[j]!;
      const a = v < 0 ? -v : v;
      if (a > m) m = a;
    }
    env[i] = m;
    if (m > peak) peak = m;
  }
  if (peak === 0) return 0;
  const head = Array.from(env.subarray(0, 30)).sort((a, b) => a - b);
  const floor = head[Math.floor(head.length / 2)] || 0;
  const thr = Math.max(peak * Math.pow(10, relDb / 20), useFloor ? floor * 4 : 0);
  for (let i = 0; i < n; i++) if (env[i]! >= thr) return Math.max(0, (i - 2) * hop);
  return 0;
}

// LAME puts 576 samples of encoder delay in front, the decoder adds 529. A
// decoder that ignores the LAME header delivers these 1105 samples (at
// 44.1 kHz) - some additionally deliver the info frame as 1152 samples of
// silence.
export const MP3_PRIMING: readonly [number, number] = [1105 / 44100, (1105 + 1152) / 44100];

/**
 * How many seconds later the attack sits in the decoded buffer than the
 * manifest says. The manifest was measured with ffmpeg, which removes the
 * delay (as do Chrome and Firefox). If the buffer is clearly longer than
 * expected, this browser did not; then the onset measurement decides which
 * of the known priming lengths it is.
 */
export function decoderShift(
  bufferDuration: number,
  expectedDuration: number | undefined,
  foundOnset: number | null | undefined,
  mark: number | null | undefined,
): number {
  if (expectedDuration === undefined || !(expectedDuration > 0) || bufferDuration - expectedDuration < 0.01) return 0;
  if (foundOnset == null || mark == null) return MP3_PRIMING[0];
  // The onset measurement wobbles by a few milliseconds with softly starting
  // strings - so it only chooses between the known priming lengths (which
  // are 26 ms apart) instead of measuring on its own.
  const d = foundOnset - mark;
  let best = MP3_PRIMING[0];
  for (const c of MP3_PRIMING) if (Math.abs(d - c) < Math.abs(d - best)) best = c;
  return best;
}
