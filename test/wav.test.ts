import { expect, test } from 'vitest';
import { encodeWav } from '../src/wav.ts';

const audio = (channels: Float32Array[], sampleRate = 44100) => ({
  numberOfChannels: channels.length,
  sampleRate,
  length: channels[0]!.length,
  getChannelData: (c: number) => channels[c]!,
});

const str = (v: DataView, at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

test('16-bit stereo: header and interleaved, clipped samples', () => {
  const buf = encodeWav(audio([new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2])], 48000));
  const v = new DataView(buf);
  expect(buf.byteLength).toBe(44 + 3 * 2 * 2);
  expect([str(v, 0, 4), str(v, 8, 4), str(v, 12, 4), str(v, 36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
  expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  expect(v.getUint16(20, true)).toBe(1);
  expect(v.getUint16(22, true)).toBe(2);
  expect(v.getUint32(24, true)).toBe(48000);
  expect(v.getUint32(28, true)).toBe(48000 * 4);
  expect(v.getUint16(32, true)).toBe(4);
  expect(v.getUint16(34, true)).toBe(16);
  expect(v.getUint32(40, true)).toBe(12);
  const samples = Array.from({ length: 6 }, (_, i) => v.getInt16(44 + i * 2, true));
  expect(samples).toEqual([0, 16384, 32767, 32767, -32767, -32767]);
});

test('32-bit float keeps the values', () => {
  const buf = encodeWav(audio([new Float32Array([0.25, -1.5])]), { bitDepth: 32 });
  const v = new DataView(buf);
  expect(v.getUint16(20, true)).toBe(3);
  expect(v.getUint16(34, true)).toBe(32);
  expect([v.getFloat32(44, true), v.getFloat32(48, true)]).toEqual([0.25, -1.5]);
});
