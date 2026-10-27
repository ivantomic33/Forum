/**
 * QA — renderuje PDF strane u PNG da bi se PREGLEDALE (ne samo generisale).
 *   node scripts/design/preview-pdf.mjs [pdf] [dstDir] [maxPages]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const pdfPath = path.resolve(process.argv[2] || 'docs/NEXUS-3.0-Obsidian-Violet-dizajn.pdf');
const outDir = path.resolve(process.argv[3] || '.qa/pdf-preview');
const maxPages = Number(process.argv[4] || 40);
fs.mkdirSync(outDir, { recursive: true });

const pdfjsDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/viewer.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0;background:#fff">
      <div id="out"></div>
      <script type="module">
        import * as pdfjs from '/pdf.mjs';
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
        const bytes = await (await fetch('/doc.pdf')).arrayBuffer();
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const out = document.getElementById('out');
        const n = Math.min(doc.numPages, ${maxPages});
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
          canvas.style.display = 'block'; canvas.style.margin = '0 0 12px';
          out.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        }
        window.__done = true; window.__pages = doc.numPages;
      </script></body></html>`);
    return;
  }
  if (url === '/doc.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    fs.createReadStream(pdfPath).pipe(res);
    return;
  }
  const file = path.join(pdfjsDir, url.replace(/^\//, ''));
  if (!file.startsWith(pdfjsDir) || !fs.existsSync(file)) return res.writeHead(404).end();
  const type = file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/viewer.html`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120_000 });
  const total = await page.evaluate(() => window.__pages);
  const canvases = await page.$$('canvas');
  const files = [];
  for (let i = 0; i < canvases.length; i++) {
    const file = path.join(outDir, `strana-${String(i + 1).padStart(2, '0')}.png`);
    await canvases[i].screenshot({ path: file });
    files.push(file);
  }
  console.log(`PDF: ${total} strana → ${canvases.length} pregleda u ${path.relative(process.cwd(), outDir)}`);
} finally {
  await browser.close();
  server.close();
}
