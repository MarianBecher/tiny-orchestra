import { isAbsolute, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { samplesDir } from '../src/node.ts';

test('samplesDir: absolute path of the samples folder at the package root', () => {
  const dir = samplesDir();
  expect(isAbsolute(dir)).toBe(true);
  expect(dir).toBe(join(resolve(import.meta.dirname, '..'), 'samples'));
});
