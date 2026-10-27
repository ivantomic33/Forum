/**
 * Provera jednog SQL fajla (`server/schema-ALL.sql`) — bez baze.
 *
 * Hvata klase grešaka na koje smo nailazili tokom spajanja migracija:
 *  1. poziv funkcije pre njene definicije (Postgres za SQL funkcije proverava
 *     postojanje u trenutku `CREATE FUNCTION` → `42883 … during inlining`),
 *  2. `CREATE INDEX` na izrazu koji koristi funkciju definisanu kasnije,
 *  3. neidempotentne komande (`CREATE INDEX` bez `IF NOT EXISTS`,
 *     `CREATE TABLE` bez `IF NOT EXISTS`, `CREATE TRIGGER` bez `DROP … IF EXISTS`,
 *     `ADD CONSTRAINT` bez `DROP CONSTRAINT IF EXISTS` pre sebe),
 *  4. ne-SQL sadržaj: mojibake (`–, š`, `đ` sa Windows konzole) i `/** … *​/`
 *     komentare koji bi u Postgresu bili sintaksna greška.
 *
 * Pokretanje:  node server/scripts/verify-schema.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const file = join(dir, '..', 'schema-ALL.sql');
const raw = readFileSync(file, 'utf8');

// Komentari se sklanjaju da regex ne dobija lažne pogotke iz objašnjenja.
const sql = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const BUILTIN = new Set([
  'lower', 'upper', 'translate', 'regexp_replace', 'regexp_split_to_table', 'btrim', 'length', 'left',
  'right', 'trim', 'nullif', 'array_length', 'array_agg', 'array_to_tsvector', 'to_tsvector', 'to_tsquery',
  'plainto_tsquery', 'ts_headline', 'numnode', 'similarity', 'now', 'count', 'sum', 'max', 'min', 'least',
  'greatest', 'substring', 'coalesce', 'concat_ws', 'jsonb_build_object', 'jsonb_set', 'jsonb_array_length',
  'to_regclass', 'to_regprocedure', 'exists', 'gen_random_uuid', 'uuid_generate_v4', 'row_number', 'rank',
  'setweight', 'ts_rank', 'date_trunc', 'matches',
]);

const issues = [];
const defined = new Map();
const tables = new Set();

for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([\w]+)\s*\(/gi)) {
  if (!defined.has(m[1])) defined.set(m[1], m.index);
}
for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([\w]+)/gi)) {
  tables.add(m[1]);
}

// 1) poziv naše funkcije pre definicije (u telima `$$ … $$`)
for (const body of sql.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
  for (const call of body[1].matchAll(/(?:public\.)?\b((?:fold|stem)_srpski|search_[a-z_]+)\s*\(/g)) {
    const name = call[1];
    if (BUILTIN.has(name) || tables.has(name)) continue;
    const at = defined.get(name);
    if (at === undefined) {
      issues.push(`poziv ${name}() — funkcija nije definisana u fajlu`);
    } else if (at > body.index) {
      issues.push(`poziv ${name}() pre definicije (funkcija je kasnije u fajlu)`);
    }
  }
}

// 2) `CREATE INDEX … (funkcija(...))`
for (const idx of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*?USING\s+\w+\s*\(([\s\S]*?)\)\s*;/gi)) {
  for (const call of idx[1].matchAll(/\b((?:fold|stem)_srpski|search_[a-z_]+)\s*\(/g)) {
    const at = defined.get(call[1]);
    if (at === undefined || at > idx.index) issues.push(`indeks koristi ${call[1]}() pre definicije`);
  }
}

// 3) idempotentnost
const checks = [
  [/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY)/gim, 'CREATE INDEX bez IF NOT EXISTS'],
  [/^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gim, 'CREATE TABLE bez IF NOT EXISTS'],
  [/^\s*CREATE\s+TRIGGER\s+(\w+)/gim, 'CREATE TRIGGER bez DROP TRIGGER IF EXISTS pre sebe'],
];
for (const [re, label] of checks) {
  for (const m of sql.matchAll(re)) {
    if (label.startsWith('CREATE TRIGGER')) {
      const before = sql.slice(Math.max(0, m.index - 600), m.index);
      if (new RegExp(`DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${m[1]}\\s+ON`, 'i').test(before)) continue;
    }
    issues.push(`${label} (blizu znaka ${m.index})`);
  }
}

// `ADD CONSTRAINT` mora imati `DROP CONSTRAINT IF EXISTS` pre sebe (isti `ALTER TABLE`).
// Izuzetak: blok `DO $$ … END $$` sa `IF NOT EXISTS (… pg_constraint …)` — tada
// je `ADD CONSTRAINT` idempotentan sam po sebi (glavni primer: `user_presence`).
for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)\s+ADD\s+CONSTRAINT\s+(\w+)/gi)) {
  const before = sql.slice(Math.max(0, m.index - 1200), m.index);
  if (new RegExp(`ALTER\\s+TABLE\\s+${m[1]}\\s+DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${m[2]}`, 'i').test(before)) continue;
  // `pg_constraint` + ime constrainta u istom `DO` bloku = već zaštićeno.
  const inDoBlock = /DO\s+\$\$/.test(before) && !/END\s+\$\$/.test(before.slice(before.lastIndexOf('DO $$')));
  if (inDoBlock && before.includes(m[2])) continue;
  issues.push(`ADD CONSTRAINT ${m[1]}.${m[2]} bez DROP CONSTRAINT IF EXISTS pre sebe`);
}

const bytes = Buffer.byteLength(raw, 'utf8');
const lines = raw.split('\n').length;

// 4) Mojibake i pseudo-komentari
//
// Na Windows-u se fajl lako sačuva kroz cp1252 („—“, „š“, „đ“) ili se
// komentar napiše kao `/** … */` (JSDoc) — Postgres to ne poznaje, pa bi
// takav red bio SQL greška, a ne komentar. Obe provere su nad CELIM fajlom,
// uključujući komentare (za razliku od ostalih, koje rade nad `sql`).
// Samo POKVARENE sekvence (UTF-8 bajtovi pročitani kao cp1252). Ispravna
// srpska slova su očekivana i ne smeju da budu u regexu.
const MOJIBAKE_RE = /\u00C3\u00A2\u20AC|\u00C3\u201E|\u00C3\u2018|\u00C3\u2020|\u00C3\u2021|\u00C3\u2026|\u00C3\u2030/u;
const mojibakeLine = raw.split('\n').findIndex((line) => MOJIBAKE_RE.test(line));
if (mojibakeLine !== -1) {
  issues.push(
    `mojibake u redu ${mojibakeLine + 1} (popravi: node scripts/fix-mojibake.mjs server/schema-ALL.sql)`,
  );
}
for (const [index, line] of raw.split('\n').entries()) {
  if (/^\s*\/\*|^\s*\*\/|^\s*\*\s/.test(line)) {
    issues.push(`C-style komentar (/* */ ili *) umesto SQL crtice-crtica, red ${index + 1}`);
    break;
  }
}

if (issues.length) {
  console.error(`schema-ALL.sql: ${issues.length} problema (${lines} linija, ${(bytes / 1024).toFixed(1)} KB)`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    `schema-ALL.sql OK — ${lines} linija, ${(bytes / 1024).toFixed(1)} KB, ${defined.size} funkcija, ${tables.size} tabela`,
  );
}
