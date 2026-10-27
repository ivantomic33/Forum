/**
 * NEXUS 3.0 — generiše PDF dizajn dokumenta iz HTML-a
 * ---------------------------------------------------
 *   node scripts/design/build-design-pdf.mjs
 *
 * Ulaz:  docs/dizajn-3.0/03-NEXUS-3.0-Obsidian-Violet-dizajn.html  (aktuelni dokument)
 *        docs/dizajn-3.0/pre/03-...-dizajn.html                (arhiva analize 3.0.0)
 *        docs/dizajn-3.0/posle/*-1920x1080.png                 (stanje POSLE 3.0)
 *        docs/dizajn-3.0/pre/*-1920x1080.png                   (stanje PRE — analiza)
 * Izlaz: docs/NEXUS-3.0-Obsidian-Violet-dizajn.pdf
 *        docs/NEXUS-3.0-Obsidian-Violet-dizajn-pre.pdf
 *        docs/dizajn-3.0/snimci-1920x1080.pdf
 *
 * Dokument ima dve vrste slika: originalne snimke (analiza 3.0.0) i, ako
 * postoje, nove snimke u `posle/` — dokument ih prikazuje kao dokaz primene.
 * Arhivska verzija (`pre/`) prikazuje samo stare snimke, pa analiza ostaje tačna.
 *
 * Playwright (Chromium) je već devDependency — nema novih paketa. HTML se
 * otvara preko http servera (ne file://), da bi relativne putanje slika radile.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'docs', 'dizajn-3.0');
const SOURCE = path.join(DIR, '03-NEXUS-3.0-Obsidian-Violet-dizajn.html');
const SOURCE_PRE = path.join(DIR, 'pre', path.basename(SOURCE));
const OUT_PDF = path.join(ROOT, 'docs', 'NEXUS-3.0-Obsidian-Violet-dizajn.pdf');
const OUT_PDF_PRE = path.join(ROOT, 'docs', 'NEXUS-3.0-Obsidian-Violet-dizajn-pre.pdf');
const OUT_SHOTS_PDF = path.join(DIR, 'snimci-1920x1080.pdf');

if (!fs.existsSync(SOURCE)) {
  console.error('Nema HTML izvora:', SOURCE);
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  // Putanja može biti "pre/…" — CSS `url(data:…)` i slike nisu u requestu.
  const file = path.join(DIR, rel === '/' ? path.basename(SOURCE) : rel.replace(/^\//, ''));
  // `path.join` normalizuje ("pre/../.."), pa se assert radi nad DIR, ne nad prefiksom URL-a.
  if (!path.resolve(file).startsWith(path.resolve(DIR)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    console.log('404', req.url);
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`FAILED ${r.url()}`));

  await page.goto(`http://127.0.0.1:${port}/${path.basename(SOURCE)}`, { waitUntil: 'networkidle' });
  const fontOk = await page.evaluate(() => document.fonts.check('700 16px Manrope'));
  console.log('font Manrope:', fontOk ? 'učitan' : 'NIJE učitan (fallback Segoe UI)');
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  });
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
  const missing = await page.evaluate(() => [...document.images].filter((i) => !i.getAttribute('src')).length);

  await page.emulateMedia({ media: 'print' });
  const pdfOptions = {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:7px;color:#7B7699;padding:0 14mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif;">' +
      '<span>NEXUS 3.0 — OBSIDIAN VIOLET</span><span class="pageNumber"></span></div>',
  };
  await page.pdf({ ...pdfOptions, path: OUT_PDF });

  // Snimci 1:1 — svaka slika 1920x1080 na svojoj A4 strani (landscape nije potreban: fit po širini).
  const shotPage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await shotPage.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      body { margin:0; background:#050408; font-family: Segoe UI, system-ui, sans-serif; color:#F1EFFA; }
      figure { margin:0; padding:14mm 12mm; break-inside: avoid; page-break-inside: avoid; }
      figure:last-child { break-after: auto; }
      img { display:block; width:100%; height:auto; border:1px solid #262243; border-radius:3mm; break-inside: avoid; page-break-inside: avoid; }
      figcaption { margin-top:4mm; font-size:10pt; color:#B6B2D0; display:flex; justify-content:space-between; gap:6mm; }
      .id { font-family: Consolas, monospace; font-size:9pt; color:#A78BFA; }
      h1 { font-size:16pt; margin:0 0 6mm; }
      .cover { height: 268mm; display:flex; flex-direction:column; justify-content:center; }
      .cover h1 { font-size:34pt; letter-spacing:-.03em; margin:0 0 4mm; }
      .cover p { font-size:11pt; color:#B6B2D0; max-width:150mm; }
    </style></head><body>
    <div class="cover">
      <div style="width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:linear-gradient(135deg,#8B5CF6,#3B4BFF);margin-bottom:10mm;">N</div>
      <h1>NEXUS 3.0 — snimci ekrana</h1>
      <p>1920 × 1080 px, tamna tema, pravi podaci (in-memory API + seed). Snimci su stanje POSLE primene 3.0 (OBSIDIAN VIOLET), prikazani 1:1 po širini strane.</p>
    </div>
    ${['01-pocetna', '02-forum', '03-popusti', '04-rang-lista', '05-clanak', '06-prijava']
      .map((id) => {
        const before = path.join(DIR, `${id}-1920x1080.png`);
        const after = path.join(DIR, 'posle', `${id}-1920x1080.png`);
        const hasAfter = fs.existsSync(after);
        const file = hasAfter ? after : before;
        if (!fs.existsSync(file)) return '';
        const src = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
        const label = hasAfter ? `${id}-1920x1080.png · OBSIDIAN VIOLET 3.0` : `${id}-1920x1080.png`;
        return `<figure><img src="${src}" alt="${id}" /><figcaption><span class="id">${label}</span><span>1920 × 1080 px</span></figcaption></figure>`;
      })
      .join('\n')}
    </body></html>`,
    { waitUntil: 'load' },
  );
  await shotPage.pdf({ path: OUT_SHOTS_PDF, format: 'A4', printBackground: true, preferCSSPageSize: true });

  /*
   * Arhiva analize (stanje 3.0.0): isti render, ali sa svojim HTML-om iz
   * `pre/` (koji slike vuče iz `pre/` i nema sekciju „posle“). Ako HTML
   * arhive ne postoji, pravi se skriptom `archive-before-design.mjs`.
   */
  let preOk = false;
  if (fs.existsSync(SOURCE_PRE)) {
    const prePage = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    await prePage.goto(`http://127.0.0.1:${port}/${path.relative(DIR, SOURCE_PRE).split(path.sep).join('/')}`, { waitUntil: 'networkidle' });
    await prePage.evaluate(async () => {
      await document.fonts?.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
    });
    const preBroken = await prePage.evaluate(() =>
      [...document.images].filter((i) => !i.naturalWidth).map((i) => `${i.getAttribute('src')} (${i.complete})`),
    );
    if (preBroken.length) console.log('  pre/ neuspele:', preBroken.join(', '));
    await prePage.emulateMedia({ media: 'print' });
    await prePage.pdf({ ...pdfOptions, path: OUT_PDF_PRE });
    console.log(`✓ ${path.relative(ROOT, OUT_PDF_PRE)} (${(fs.statSync(OUT_PDF_PRE).size / 1024).toFixed(0)} KB, neuspele slike: ${preBroken.length})`);
    preOk = true;
    await prePage.close();
  } else {
    console.log('! arhiva pre/ ne postoji — PDF analize (pre) preskočen');
  }

  const pages = await page.evaluate(() => document.querySelectorAll('section').length);
  console.log(`✓ ${path.relative(ROOT, OUT_PDF)} (${(fs.statSync(OUT_PDF).size / 1024).toFixed(0)} KB, ${pages} sekcija)`);
  console.log(`✓ ${path.relative(ROOT, OUT_SHOTS_PDF)} (${(fs.statSync(OUT_SHOTS_PDF).size / 1024).toFixed(0)} KB)`);
  console.log(`slike: ${await page.evaluate(() => document.images.length)}, bez izvora: ${missing}, neuspele: ${broken.length}`);
  if (!preOk) console.log('  (PDF analize: —)');
  if (broken.length) console.log('  ', broken.join('\n   '));
  if (errors.length) console.log('konzola:', errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server.close();
}
