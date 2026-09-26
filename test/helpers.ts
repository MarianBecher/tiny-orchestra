import { expect } from 'vitest';

/** `a` equals `b` within `eps`. */
export function close(a: number, b: number, eps = 1e-9): void {
  expect(Math.abs(a - b), `${a} ~ ${b}`).toBeLessThanOrEqual(eps);
}
