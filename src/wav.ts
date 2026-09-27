// WAV encoding for rendered audio. Pure: works on anything shaped like an
// AudioBuffer.

/** What `encodeWav` reads of an AudioBuffer. */
export interface AudioData {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface WavOptions {
  /** 16-bit integer PCM (default) or 32-bit float. */
  bitDepth?: 16 | 32;
}

/**
 * A WAV file of the audio, e.g. of `orch.render()`:
 *
 *     const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
 *
 * 16-bit samples are clipped to -1..1 and rounded.
 */
export function encodeWav(audio: AudioData, { bitDepth = 16 }: WavOptions = {}): ArrayBuffer {
  const channels = audio.numberOfChannels;
  const bytes = bitDepth / 8;
  const size = audio.length * channels * bytes;
  const buf = new ArrayBuffer(44 + size);
  const view = new DataView(buf);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * bytes, true);
  view.setUint16(32, channels * bytes, true);
  view.setUint16(34, bitDepth, true);
  text(36, 'data');
  view.setUint32(40, size, true);
  const data = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  let at = 44;
  for (let i = 0; i < audio.length; i++) {
    for (let c = 0; c < channels; c++) {
      const v = data[c]![i]!;
      if (bitDepth === 32) view.setFloat32(at, v, true);
      else view.setInt16(at, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true);
      at += bytes;
    }
  }
  return buf;
}
