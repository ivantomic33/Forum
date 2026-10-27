/**
 * JSDoc komentari u `schema-ALL.sql` → SQL komentari (`--`).
 *
 * U SQL-u zvezdica sa kosom crtom nije komentar nego greška, pa fajl koji je
 * prošao kroz JS editor ne sme da ostane takav. Skripta menja samo redove koji
 * POČINJU markerom otvaranja, zatvaranja ili zvezdicom-nastavkom, i to na `--`
 * sa istim uvlačenjem i tekstom.
 *
 * Pokretanje:  node server/scripts/jsdoc-to-sql-comments.mjs [fajl]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'server/schema-ALL.sql';
const raw = readFileSync(file, 'utf8');

let changed = 0;
const out = raw
  .split('\n')
  .map((line) => {
    // Jednolinijski: zvezdica-kosa-crta … kosa-crta-zvezdica u ISTOM redu.
    if (/^\s*\/\*.*\*\/\s*$/.test(line)) {
      changed += 1;
      return line.replace('/*', '--').replace('*/', '');
    }
    if (/^\s*\/\*\*\s*$/.test(line)) {
      changed += 1;
      return line.replace('/*', '--');
    }
    if (/^\s*\*\/\s*$/.test(line)) {
      return line.replace('/*', '--').replace('*/', '');
    }
    if (/^\s*\*( |$)/.test(line)) {
      return line.replace('*', '--');
    }
    return line;
  })
  .join('\n');

writeFileSync(file, out, 'utf8');
console.log(`[jsdoc-to-sql] ${file}: ${changed} blokova zvezdica → crtica-crtica`);
