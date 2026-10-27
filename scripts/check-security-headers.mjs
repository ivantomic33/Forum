import fs from 'node:fs';
import { themeScriptHash } from './theme-script-hash.mjs';

/**
 * F-20 — provera da `public/_headers` ima ISTI hash inline skripte kao
 * `index.html`.
 *
 * Bez ovoga hash u statičkim zaglavljima tiho ostane star kada se promeni
 * inline skript teme, a simptom je stranica koja se učita prazna (CSP blokira
 * skript, bez greške van konzole). Pokreće se u CI-ju.
 *
 *   node scripts/check-security-headers.mjs          # provera (exit 1 ako se razlikuje)
 *   node scripts/check-security-headers.mjs --print  # samo ispiše trenutni hash
 */
const expected = themeScriptHash();

if (process.argv.includes('--print')) {
  console.log(expected);
  process.exit(0);
}

const file = new URL('../public/_headers', import.meta.url);
const text = fs.readFileSync(file, 'utf8');
const csp = text.split(/\r?\n/).find((line) => line.includes('Content-Security-Policy'));

if (!csp) {
  console.error('public/_headers: CSP red nije pronađen.');
  process.exit(1);
}

if (!csp.includes(expected)) {
  console.error(
    `public/_headers: hash inline skripte NIJE ažuran.\n  očekivano: ${expected}\n  u fajlu:   ${csp.match(/'sha256-[^']+'/)?.[0] ?? '(nema)'}\n` +
      'Ažuriraj `script-src` u `public/_headers` na vrednost iz `node scripts/check-security-headers.mjs --print`.',
  );
  process.exit(1);
}

console.log(`public/_headers OK — ${expected}`);
