import fs from 'node:fs';
import path from 'node:path';

/**
 * Pronalazi (i po potrebi popravlja) mojibake u izvornom kodu celog projekta.
 *
 * Isključeni folderi: `node_modules`, `dist`, `test-results`, `docs` (arhiva
 * snimaka), `.git`. Ekstenzije: kod, stilovi, markdown i skripte.
 *
 * Pokretanje:
 *   node scripts/qa/fix-mojibake-all.mjs           # samo prikaži (exit 1 ako ima)
 *   node scripts/qa/fix-mojibake-all.mjs --write   # popravi i prikaži
 *   node scripts/qa/fix-mojibake-all.mjs --check   # isto kao bez argumenata (za CI)
 */

const ROOTS = ['src', 'server', 'scripts', 'contracts', 'public'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.md', '.html', '.mjs', '.json', '.sql', '.example']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', 'docs', '.git', 'coverage', '.data']);
// Alati koji SAMI sadrže pokvarene sekvence (mapa popravke) — inače bi
// prijavili sami sebe i CI bi uvek padao.
const SKIP_FILES = new Set([
  'scripts/qa/fix-mojibake.mjs',
  'scripts/qa/fix-mojibake-all.mjs',
  'server/scripts/verify-schema.mjs',
]);

// KLJUČ je pokvarena sekvenca (UTF-8 pročitan kao cp1252), VREDNOST je
// ispravan znak. Gradivo mora da bude ovako — ako se ključ i vrednost poklope,
// alat „popravlja“ ispravan tekst u samog sebe i lažno prijavljuje sve fajlove.
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

// Samo POKVARENE sekvence — ispravna srpska slova (đ, ć, č, š, ž) su očekivana.
const MOJIBAKE_RE = /(?:â€|Ä‘|Ä‡|ÄŒ|Ä†|Å¡|Å¾)/u;
const write = process.argv.includes('--write');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let affected = 0;
let unresolved = 0;

for (const file of ROOTS.flatMap((root) => walk(root))) {
  if (SKIP_FILES.has(path.relative(process.cwd(), file).replaceAll('\\', '/'))) continue;
  const original = fs.readFileSync(file, 'utf8');
  if (!MOJIBAKE_RE.test(original)) continue;

  let fixed = original;
  for (const [from, to] of Object.entries(MAP)) fixed = fixed.split(from).join(to);

  const remaining = MOJIBAKE_RE.test(fixed);
  affected += 1;
  if (remaining) unresolved += 1;

  const relative = path.relative(process.cwd(), file);
  if (!write) {
    console.log(`${relative}${remaining ? ' (nepoznata sekvenca)' : ''}`);
    continue;
  }

  fs.writeFileSync(file, fixed, 'utf8');
  console.log(`fixed ${relative}${remaining ? ' (ostala nepoznata sekvenca)' : ''}`);
}

if (affected === 0) {
  console.log('Nema mojibake-a. ✔');
} else if (!write) {
  console.log(`\n${affected} fajl(ova) sa mojibake-om. Pokreni sa --write da ih popraviš.`);
}

process.exitCode = unresolved > 0 ? 1 : 0;
