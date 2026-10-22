import fs from 'node:fs';

/**
 * Popravlja UTF-8 tekst koji je prošao kroz cp1252 dekodiranje
 * (npr. „Ä‘“ → „đ“, „â€““ → „–“). Alat je idempotentan i bezbedan za više
 * pokretanja; koristi se za fajlove sačuvane kroz Windows konzolu.
 *
 * Pokretanje: `node scripts/fix-mojibake.mjs <fajl> [...]`
 */
const MAP = {
  'â€”': '—',
  'â€“': '–',
  'â€ž': '„',
  'â€œ': '“',
  'â€™': '’',
  'â€¦': '…',
  'â€¢': '•',
  'â‚¬': '€',
  'Ä‘': 'đ',
  'Ä‡': 'ć',
  'Ä': 'č',
  'ÄŒ': 'Č',
  'Ä†': 'Ć',
  'Å¡': 'š',
  'Å¾': 'ž',
  'Ã©': 'é',
};

const MOJIBAKE_RE = /(?:â€|Ä‘|Ä‡|ÄŒ|Ä†|Å¡|Å¾)/u;

let failed = 0;
for (const file of process.argv.slice(2)) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of Object.entries(MAP)) {
    text = text.split(from).join(to);
  }
  if (MOJIBAKE_RE.test(text)) {
    console.warn(`[fix-mojibake] NEPOPRAVLJENO u ${file} (nepoznata sekvenca)`);
    failed += 1;
  }
  fs.writeFileSync(file, text, 'utf8');
  console.log(`fixed ${file}`);
}

process.exitCode = failed ? 1 : 0;
