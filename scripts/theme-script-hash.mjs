import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * F-20 — CSP hash za inline skript teme iz `index.html` (U-08).
 *
 * `script-src 'self'` blokira svaki inline skript, a tema se postavlja pre
 * prvog paint-a upravo inline skriptom. Ranije je u `script-src` bio hash samo
 * za Vite React Refresh preambulu, pa se dev stranica učitavala sa statusom 200
 * i praznim `#root` — bez greške bilo gde osim u konzoli (CSP blokada).
 *
 * Hash se RAČUNA iz `index.html`, ne prepisuje ručno: kada se inline skript
 * promeni, dozvola se menja sama. Koristi ga `security-headers.mjs`, a
 * `scripts/check-security-headers.mjs` proverava da `public/_headers` nije
 * zastareo.
 */
export const THEME_SCRIPT_MARKER = 'nexus-theme';

export function themeScriptHash(indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')) {
  const bodies = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const theme = bodies.find((body) => body.includes(THEME_SCRIPT_MARKER));
  if (!theme) {
    throw new Error('index.html: inline skript za temu (nexus-theme) nije pronađen — CSP hash ne može da se izračuna.');
  }
  return `'sha256-${crypto.createHash('sha256').update(theme, 'utf8').digest('base64')}'`;
}
