// Tiny static server for the demo - no packages, just node:http.
//
// It serves the whole project directory, so the demo can load the library
// from dist/ and the samples from samples/, just as an app would from its
// own public folder.
//
//   npm run demo            -> http://localhost:8321/demo/
//   PORT=9000 npm run demo

import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/vsco.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

// never served: downloads, dependencies, the repository itself
const HIDDEN = ['cache', 'node_modules', '.git'].map((d) => `${sep}${d}${sep}`);

export function startServer(port = Number(process.env['PORT']) || 8321, { quiet = false } = {}): Promise<Server> {
  const root = normalize(ROOT);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/demo/' });
        res.end();
        return;
      }
      let path = normalize(join(root, decodeURIComponent(url.pathname)));
      // nothing outside the project (../../etc/passwd)
      if (!path.startsWith(root) || HIDDEN.some((h) => (path + sep).includes(h))) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        let st = await stat(path);
        if (st.isDirectory()) {
          path = join(path, 'index.html');
          st = await stat(path);
        }
        res.writeHead(200, {
          'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-cache',
        });
        createReadStream(path).pipe(res);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      if (!quiet) console.log(`Demo: http://localhost:${(server.address() as AddressInfo).port}/demo/`);
      resolve(server);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void startServer();
