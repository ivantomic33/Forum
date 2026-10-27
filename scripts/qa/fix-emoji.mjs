import fs from 'node:fs';

/**
 * Popravlja emoji mojibake iz fajlova sačuvanih kroz Windows konzolu
 * (UTF-8 bajtovi pročitani kao cp1252 → „ðŸŽ®“). Vrednosti su Unicode escape
 * sekvence, pa skripta radi bez obzira na kodnu stranu terminala.
 *
 * Pokretanje: `node scripts/fix-emoji.mjs <fajl> [...]`
 */
const EMOJI = {
  'ðŸŽ®': '\u{1F3AE}',
  'ðŸ“…': '\u{1F4CC}',
  'ðŸ”’': '\u{1F512}',
  'ðŸ“Š': '\u{1F4CA}',
  'ðŸ†': '\u{1F3C6}',
  'ðŸ”–': '\u{1F516}',
  'ðŸ¥‡': '\u{1F947}',
  'ðŸ¥ˆ': '\u{1F948}',
  'ðŸ¥‰': '\u{1F949}',
  'ðŸ‘‘': '\u{1F451}',
  'ðŸ”¥': '\u{1F525}',
  'ðŸ–¥ï¸': '\u{1F5A5}\uFE0F',
  'ðŸ‘¥': '\u{1F465}',
  'ðŸ’¬': '\u{1F4AC}',
  'âš™ï¸': '\u2699\uFE0F',
  'â­': '\u2B50',
  'Å AMPION': 'ŠAMPION',
  'Å AMPION': 'ŠAMPION',
};

const MOJIBAKE_RE = /(?:ðŸ|âš|Â|Ã)/;

let failed = 0;
for (const file of process.argv.slice(2)) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of Object.entries(EMOJI)) {
    text = text.split(from).join(to);
  }
  if (MOJIBAKE_RE.test(text)) {
    console.warn(`[fix-emoji] NEPOPRAVLJENO u ${file}`);
    failed += 1;
  }
  fs.writeFileSync(file, text, 'utf8');
  console.log(`fixed ${file}`);
}

process.exitCode = failed ? 1 : 0;
