// Node-only entry: where the bundled samples live on disk, so build scripts
// can copy them into a project's public folder.
//
//   import { cp } from 'node:fs/promises';
//   import { samplesDir } from 'tiny-orchestra/node';
//   await cp(samplesDir(), 'public/audio/samples', { recursive: true });

import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the package's `samples/` folder (manifest.json plus one
 * folder of MP3s per instrument), without a trailing separator.
 */
export function samplesDir(): string {
  // dist/node.js (or src/node.ts) -> ../samples
  return fileURLToPath(new URL('../samples', import.meta.url));
}
