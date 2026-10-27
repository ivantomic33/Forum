/**
 * Statički server za QA snimke (`dist/`) — bez zavisnosti.
 *
 * Zašto ne `vite preview`: u ovom okruženju Vite preview proces ume da zatvori
 * listener čim se pokrene iz pozadine, pa headless brauzer dobija
 * `ERR_CONNECTION_REFUSED`. Ovaj server je jedan `node` proces u foreground-u
 * pozadinskog taska — isti `dist/`, isti `_headers` semantika (SPA fallback).
 *
 *   node scripts/qa/serve.mjs 4179
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 4179);
const root = path.resolve(process.cwd(), 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let file = path.join(root, decodeURIComponent(url.pathname));

  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (url.pathname === '/' || !path.extname(file)) {
    // SPA fallback — svaka ruta dobija index.html (kao hosting).
    file = path.join(root, 'index.html');
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, 'index.html'), (fallbackError, html) => {
        if (fallbackError) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving dist on http://127.0.0.1:${port}`);
});

// QA alat prekida proces — listener se zatvara čisto.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
