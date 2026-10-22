import fs from 'node:fs';
import path from 'node:path';

/**
 * Diagnostika za Tailwind v4 sintaksu boja.
 *
 * Tailwind v4 arbitrary vrednosti zahtevaju `[var(--color-x)]` (ili theme
 * utility kao `bg-primary`). Zapis `bg-var(--color-x)` nije validna klasa i
 * tiho se ignoriše. Ovaj skript prijavljuje takve slučajeve.
 *
 * Pokretanje: `node scripts/check-tailwind-vars.mjs`
 */
const BROKEN = /\b(?:bg|text|border|from|to|via|ring|fill|stroke|shadow|divide|outline|decoration|placeholder|accent|caret)-var\(--[a-z0-9-]+\)/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let problems = 0;
for (const file of walk('src')) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const matches = line.match(BROKEN);
    if (!matches) return;
    problems += matches.length;
    for (const match of matches) {
      console.error(`${file}:${index + 1}  ${match}`);
    }
  });
}

if (problems) {
  console.error(`\n${problems} nevalidnih Tailwind klasa (očekivano: text-[var(--color-x)]).`);
  process.exitCode = 1;
} else {
  console.log('OK — nema `*-var(--color-*)` klasa.');
}
