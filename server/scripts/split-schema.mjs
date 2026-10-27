/**
 * `server/schema-ALL.sql` → po jedan fajl po sekciji (`server/sql/`).
 *
 * Zašto: Supabase SQL Editor pušta ceo skript u JEDNOJ transakciji i prikazuje
 * samo poslednji `SELECT`. Ako bilo šta u sredini čeka lock (GIN indeks,
 * `ALTER TABLE`), sve posle se odbije — a panel i dalje pokazuje stari broj.
 * Zato se ovako dobija `server/sql/00-…`, `01-…` … koji se puštaju jedan po
 * jedan i odmah se vidi gde je stalo.
 *
 * Sekcija 00 sadrži zaglavlje fajla (extensions + redosled), ostale su
 * kopije sekcija 1:1 — ništa se ne prepisuje, pa je izlaz uvek veran izvoru.
 *
 * Pokretanje:  node server/scripts/split-schema.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const source = join(dir, '..', 'schema-ALL.sql');
const outDir = join(dir, '..', 'sql');

const raw = readFileSync(source, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const lines = raw.split('\n');

/** `-- SEKCIJA: server/schema-2.6.4-sharing.sql` — marker svake sekcije. */
const SECTION_RE = /^-- SEKCIJA:\s*(\S+)\s*$/;

const slices = [];
let current = { name: null, lines: [] };
for (const line of lines) {
  const match = SECTION_RE.exec(line);
  if (match) {
    slices.push(current);
    current = { name: match[1], lines: [] };
  }
  current.lines.push(line);
}
slices.push(current);

// Priprema izlaznog foldera (brišemo samo sopstvene .sql fajlove).
mkdirSync(outDir, { recursive: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const isSectionTitle = (line) => /^-- SEKCIJA:/.test(line);
const isFence = (line) => /^-- ={20,}$/.test(line);

/** Zaglavlje bez `-- SEKCIJA:` linija i bez okvira prve sekcije. */
function headerLines(body) {
  const out = [];
  for (const line of body) {
    if (isSectionTitle(line)) continue;
    if (isFence(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

let index = 0;
const written = [];
for (const slice of slices) {
  const body = slice.lines;

  if (slice.name === null) {
    // Deo pre prve sekcije: extensions + zaglavlje fajla.
    const header = headerLines(body);
    if (header) {
      const name = `${String(index).padStart(2, '0')}-00-header.sql`;
      writeFileSync(join(outDir, name), `${header}\n`, 'utf8');
      written.push(name);
      index += 1;
    }
    continue;
  }

  // `server/schema-2.4.1.sql` → `01-2.4.1.sql`
  const label = slice.name.replace(/^server\//, '').replace(/^schema-?/, '').replace(/\.sql$/, '') || 'core';
  const name = `${String(index).padStart(2, '0')}-${label}.sql`;
  const content = body.join('\n').trim();
  writeFileSync(join(outDir, name), `${content}\n`, 'utf8');
  written.push(name);
  index += 1;
}

// `_all.sql` — isti sadržaj kao izvor, da CI/ručno puštanje ostane jedno.
writeFileSync(join(outDir, '_all.sql'), raw, 'utf8');

console.log(`[split-schema] ${written.length} sekcija → ${outDir}`);
for (const name of written) console.log(`  ${name}`);
