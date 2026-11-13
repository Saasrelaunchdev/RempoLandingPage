// A tiny static server for the render page (ES modules need http, not file://). Serves hero-video/ and, under
// /site/, the landing page's own fonts and media, so the video uses exactly the page's type and art.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const SITE = dirname(HERE);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.jpg': 'image/jpeg' };

export function serve(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const base = url.startsWith('/site/') ? SITE : HERE;
    const rel = normalize(url.startsWith('/site/') ? url.slice(5) : url).replace(/^(\.\.[/\\])+/, '');
    let file = join(base, rel);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await serve(Number(process.argv[2] || 8790));
  console.log(`http://127.0.0.1:${s.address().port}/src/`);
}
