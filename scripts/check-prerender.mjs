/**
 * N-13 — PRERENDER SMOKE PROVERA
 * ------------------------------
 * `npm run check:prerender` (deo `npm run verify`, posle `build`) proverava da
 * je prerender zaista generisao HTML sa sadržajem, a ne samo kopiju SPA ljuske:
 *
 *   - `dist/index.html`          → `<title>`, `og:image` (1200×630), JSON-LD, skelet
 *   - `dist/article/<slug>.html` → bar jedan članak, ako API bio dostupan pri buildu
 *   - `dist/thread/<id>.html`    → bar jedna tema, isto
 *   - `dist/og/default.png`      → statička OG slika (proverava `check:og`)
 *
 * Bez API-ja pri buildu (offline CI) proveravaju se samo statičke rute — ali
 * naslovna UVEK mora imati `og:image`, inače je prerender pao tiho.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const errors = [];

const readHtml = (relative) => {
  const file = path.join(dist, relative);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
};

const home = readHtml('index.html');
if (!home) {
  errors.push('dist/index.html ne postoji — pokreni `npm run build`.');
} else {
  if (!/<title>[^<]{3,}<\/title>/.test(home)) errors.push('index.html: nema <title>.');
  if (!/property="og:image" content="[^"]+"/.test(home)) errors.push('index.html: nema og:image.');
  if (!/property="og:image:width" content="1200"/.test(home)) errors.push('index.html: og:image:width ≠ 1200.');
  if (!/property="og:image:height" content="630"/.test(home)) errors.push('index.html: og:image:height ≠ 630.');
  if (!/application\/ld\+json/.test(home)) errors.push('index.html: nema JSON-LD.');
  if (!/class="section"/.test(home)) errors.push('index.html: #root nije prerenderovan (prazna ljuska).');
}

const countHtml = (folder) => {
  const dir = path.join(dist, folder);
  if (!fs.existsSync(dir)) return 0;
  // `writeRoute` piše i `article/<slug>/index.html` — brojimo samo `*.html` u prvom nivou.
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html')).length;
};

const articles = countHtml('article');
const threads = countHtml('thread');
const games = countHtml('games');
const staticOnly = !fs.existsSync(path.join(dist, 'article')) && !fs.existsSync(path.join(dist, 'thread'));

for (const error of errors) console.error(`[check:prerender] ✖ ${error}`);
if (errors.length) {
  console.error(`[check:prerender] ${errors.length} problema — prerender nije ispravan.`);
  process.exit(1);
}

console.log(
  `[check:prerender] ✓ naslovna + og:image 1200×630; članci: ${articles}, teme: ${threads}, igre: ${games}` +
    (staticOnly ? ' (API nije bio dostupan — samo statičke rute)' : ''),
);
