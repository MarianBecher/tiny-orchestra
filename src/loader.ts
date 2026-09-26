// Fetching and decoding helpers.

/** Decode an audio file. Safari long knew only the callback form; cover both. */
export function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/** Run at most `n` tasks at once - a server on the LAN should not choke. */
export function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = (): void => {
    if (active >= n) return;
    const start = queue.shift();
    if (!start) return;
    active++;
    start();
  };
  return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task().then(resolve, reject).finally(() => { active--; next(); });
    });
    next();
  });
}

/** `"a/b"` -> `"a/b/"`; empty stays empty (relative to the page). */
export const withSlash = (url: string): string => (url && !url.endsWith('/') ? url + '/' : url);

/** Folder part of a URL: `"/audio/manifest.json"` -> `"/audio/"`. */
export const dirOf = (url: string): string => url.slice(0, url.lastIndexOf('/') + 1);
