/**
 * NEXUS 3.0 — iz HTML dokumenta u korenu `docs/dizajn-3.0/` pravi arhivsku
 * kopiju analize ("stanje 3.0.0" PRE primene) u `docs/dizajn-3.0/pre/`.
 *
 * Zašto: originalni snimci su zamenjeni novima (stanje POSLE), pa je analiza
 * u sekcijama 1 i 1b morala da ostane vezana za svoje, stare snimke. Arhiva
 * koristi iste fajlove iz `pre/`, pa više ne pokazuje nove ekrane uz opis
 * "gde dizajn radi, a gde ne".
 *
 * Idempotentno: jednom napravljena `pre/` verzija se ne prepisuje (osim sa
 * `--force`), jer bi naredni `shot:design` inače upisao novo stanje u analizu.
 *
 *   node scripts/design/archive-before-design.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'docs', 'dizajn-3.0');
const SRC = path.join(DIR, '03-NEXUS-3.0-Obsidian-Violet-dizajn.html');
const PRE_DIR = path.join(DIR, 'pre');
const OUT = path.join(PRE_DIR, path.basename(SRC));
const force = process.argv.includes('--force');

if (!fs.existsSync(SRC)) {
  console.error('Nema HTML izvora:', SRC);
  process.exit(1);
}

if (fs.existsSync(OUT) && !force) {
  console.log(`pre/ već postoji (${path.relative(ROOT, OUT)}) — preskačem. Za prepis: --force`);
  process.exit(0);
}

fs.mkdirSync(PRE_DIR, { recursive: true });

let html = fs.readFileSync(SRC, 'utf8');

// 1) Nova sekcija "03 — primena (stanje posle)" ne pripada analizi od 3.0.0.
//    Markeri su dugi nizovi „=", pa seče po indeksima (regex je krhak).
const at = (needle) => html.search(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const m3b = at('3b. POSLE');
const m4 = at('4. PRIMENA');
if (m3b !== -1 && m4 !== -1 && m4 > m3b) {
  const from = html.lastIndexOf('<!--', m3b);
  const to = html.lastIndexOf('<!--', m4);
  html = `${html.slice(0, from)}<!-- ============================================================ 4. PRIMENA -->${html.slice(html.indexOf('-->', to) + 3)}`;
} else {
  console.log('! sekcija 3b nije nađena — arhiva bi mogla da sadrži i stanje posle');
}

// 2) Snimci koje analiza pominje u tekstu moraju biti stari — u `pre/`.
//    Arhivski HTML i sam živi u `pre/`, pa relacije idu bez prefiksa
//    („pre/pre/…“ bi bio 404). Idempotentno za sve tri varijante.
html = html.replace(/(<img src=")(?:\.\.\/)+posle\/posle\//g, '$1');
html = html.replace(/(<img src=")(?:\.\.\/)+posle\//g, '$1');
html = html.replace(/(<img src=")(?:\.\.\/)+pre\//g, '$1');
html = html.replace(/(<img src=")pre\/(?=pre\/)/g, '$1');
html = html.replace(/(<img src=")posle\//g, '$1');

// 3) Prilog iz arhive ne sme da tvrdi da sadrži stanje posle.
html = html.replace(
  /\s*<tr><td><code>posle\/\*-1920x1080\.png<\/code><\/td><td>[^<]*<\/td><\/tr>/,
  '\n    <tr><td><code>pre/*-1920x1080.png</code></td><td>Snimci stanja 3.0.0 — analiza u sekcijama 1 i 1b</td></tr>',
);

// 4) Naslov strane razlikuje arhivu od aktuelnog dokumenta.
html = html.replace(
  '<title>NEXUS 3.0 — OBSIDIAN VIOLET</title>',
  '<title>NEXUS 3.0 — OBSIDIAN VIOLET (analiza stanja 3.0.0)</title>',
);

const changed = html !== fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(OUT, html);

const oldShots = (html.match(/<img src="\d{2}-/g) ?? []).length;
const afterShots = (html.match(/<img src="[.\/]*posle\//g) ?? []).length;
console.log(`✓ ${path.relative(ROOT, OUT)} — ${oldShots} starih snimaka, ${afterShots} novih`);
if (!changed) console.log('! HTML nije promenjen (proveri da li u izvoru još postoje sekcija 3b i snimci)');
