// Static server for fixture pages. Port 5177 is the main origin; 5178 serves the same
// files as a second origin for cross-origin iframe fixtures.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../pages/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
};

export function serve(port) {
  const server = createServer(async (req, res) => {
    // ?delay=ms slows a response down, to make lazy loading observable in fixtures.
    const delay = Number(new URL(req.url, 'http://x').searchParams.get('delay') ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ports = [Number(process.env.PORT ?? 5177), Number(process.env.PORT2 ?? 5178)];
  for (const p of ports) await serve(p);
  console.log(`fixtures on http://localhost:${ports[0]}/ and http://localhost:${ports[1]}/`);
}
