/**
 * U-08 — uklanja BOM iz CSS fajlova u `src/styles`.
 *
 * Lightning CSS ubaci U+FEFF ispred `@layer …{` kada ga nađe u fajlu; pravila
 * posle njega izađu iz sloja i izgube od Tailwind tokena (light tema nije
 * radila). BOM nije potreban ni za jednu boju/znak u ovim fajlovima.
 *
 *   node scripts/qa/strip-css-bom.mjs          # ispravi
 *   node scripts/qa/strip-css-bom.mjs --check  # samo prijavi (exit 1)
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/styles');
const checkOnly = process.argv.includes('--check');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.css')) files.push(full);
  }
};
walk(root);

let found = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('\uFEFF')) {
    found += 1;
    console.error(`${path.relative(process.cwd(), file)}: BOM (U+FEFF)`);
    if (!checkOnly) fs.writeFileSync(file, source.replaceAll('\uFEFF', ''));
  }
}

if (!found) console.log('OK — nema BOM-a u src/styles.');
else if (checkOnly) process.exitCode = 1;
else console.log(`${found} fajl(ova) očišćeno.`);
