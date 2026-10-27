import fs from 'node:fs';
import path from 'node:path';
import { BASELINE } from './qa/css-token-baseline.mjs';
import { fileURLToPath } from 'node:url';

/**
 * N-08 — provera „jedan izvor za boje/radius/senke".
 *
 * `src/styles/tokens.css` je jedini fajl u kojem smeju da postoje konkretne
 * vrednosti. Ostali slojevi (`base.css`, `components/*.css`) koriste
 * `var(--color-*)`, `var(--radius-*)`, `var(--shadow-*)`…
 *
 * Skript prijavljuje:
 *  - `#hex`, `rgb()/rgba()`, `hsl()` van `tokens.css`,
 *  - `box-shadow`, `text-shadow`, `border-radius` koji ne koriste token,
 *  - `--color-*` / `--radius-*` / `--shadow-*` deklaracije van `tokens.css`,
 *    koje vraćaju dupli izvor (izuzetak: `--color-*` u `@theme`, što je token).
 *
 * Pokretanje: `node scripts/check-css-tokens.mjs` (exit 1 na prekršaje).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/styles');
const TOKENS = path.join(ROOT, 'tokens.css');

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(\s*[\d.]/g;
const HSL = /\bhsla?\(/g;
const TOKEN_DECL = /^\s*--(?:color|radius|shadow|glow|gradient)-[a-z0-9-]+\s*:/i;
const SHADOW_PROP = /^\s*(?:box-shadow|text-shadow|border-radius)\s*:\s*(.+);/i;

/** Dozvoljeni izuzeci: vrednosti koje namerno nisu tokeni. */
const ALLOW = [
  // `transparent`/`currentColor` nisu boje iz palete.
  /^\s*(?:transparent|none|inherit|initial|unset|currentColor|0)\b/,
  // Vrednosti koje su samo var() reference.
  /^[\s\w(),./+-]*var\(--[a-z0-9-]+\)[\s\w(),./+-]*$/i,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.css') && full !== TOKENS) out.push(full);
  }
  return out;
}

/** Uklanja komentare i `url(data:…)` blobove pre analize. */
function strip(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(\s*["']?data:[^)]*\)/g, 'url(data:…)');
}

let violations = 0;
const perFile = new Map();
const bump = (file) => perFile.set(file, (perFile.get(file) ?? 0) + 1);
const report = (file, line, message) => {
  bump(file);
  violations += 1;
  console.error(`${path.relative(process.cwd(), file)}:${line}  ${message}`);
};

for (const file of walk(ROOT)) {
  // Legacy sloj je mapiranje starih Tailwind boja — nestaje sam sa sobom.
  if (path.basename(file) === 'legacy-palette.css') continue;
  // U-08 — `theme.css` sadrži DRUGU paletu (`[data-theme='light']`), tj. isti
  // status kao `tokens.css`: to su vrednosti tokena, ne boje u komponenti.
  if (path.basename(file) === 'theme.css') continue;
  const lines = strip(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('/*')) return;

    for (const pattern of [HEX, RGB, HSL]) {
      const matches = line.match(pattern);
      if (matches) report(file, index + 1, `boja van tokena: ${matches[0]}`);
    }

    if (TOKEN_DECL.test(line)) {
      report(file, index + 1, `deklaracija tokena van tokens.css: ${line.split(':')[0].trim()}`);
    }

    const shadow = line.match(SHADOW_PROP);
    if (shadow && !ALLOW.some((allow) => allow.test(shadow[1]))) {
      // `box-shadow: rgba(...)` bez var() je vec prijavljen kao boja.
      if (!/rgba?\(|hsla?\(/i.test(shadow[1])) {
        report(file, index + 1, `senka/radius van tokena: ${shadow[1].trim().slice(0, 60)}`);
      }
    }
  });
}

// N-08 — dug se meri po fajlu protiv baseline-a: novo povećanje pada odmah,
// a postojeći prekršaji se prijavljuju kao upozorenje (dug koji se smanjuje).
let regressions = 0;
for (const [file, count] of perFile) {
  const key = path.relative(ROOT, file).split(path.sep).join('/');
  const allowed = BASELINE[key] ?? 0;
  if (count > allowed) {
    regressions += 1;
    console.error(`\n${key}: ${count} vrednosti van tokena, baseline dozvoljava ${allowed}.`);
  }
}

if (regressions) {
  process.exitCode = 1;
} else if (violations) {
  console.warn(`\n${violations} postojećih vrednosti van tokena (isti iznos kao baseline) — nove ne dodavati.`);
} else {
  console.log('OK — boje, senke i radius u src/styles koriste tokene.');
}

export { violations, regressions };
