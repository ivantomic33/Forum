#!/usr/bin/env node
/**
 * CI/pre-commit provera: u git-u ne sme biti `.env`, logova, `.data` ni
 * očiglednih tajni u praćenim fajlovima (F-01). Vrednosti se nikad ne ispisuju.
 *
 * Usage: node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// `*.env.example` je ŠABLON koji sme (i treba) da bude u gitu — bez njega niko ne
// zna koje promenljive su potrebne. Zabranjen je samo stvarni `.env`
// (`.env`, `.env.local`, `server/.env`, …).
const FORBIDDEN_TRACKED = [/(^|\/)\.env(\.|$)/i, /\.log$/i, /(^|\/)\.data\//i];
const isEnvExample = (file) => /(^|\/)\.env\.example$/i.test(file);

// Placeholder-i iz `.env.example` (`re_xxxx…`, `xkeysib-xxxx…`) nisu tajne —
// negativni lookahead ih preskače, pa šablon ne zaustavlja CI.
const SECRET_PATTERNS = [
  { name: 'Supabase service_role JWT', re: /"role"\s*:\s*"service_role"/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'JWT_SECRET dodeljena vrednost', re: /^\s*JWT_SECRET\s*=\s*(?!replace|change|<|\$)[^\s#]{16,}/m },
  { name: 'Resend ključ', re: /\bre_(?!x{4,})[A-Za-z0-9]{20,}/ },
  { name: 'Brevo ključ', re: /\bxkeysib-(?!x{4,})[A-Za-z0-9-]{20,}/ },
];

let tracked = '';
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
} catch {
  console.log('check-secrets: nema git repozitorijuma, preskačem.');
  process.exit(0);
}

const files = tracked.split('\0').filter(Boolean);
const problems = [];

for (const file of files) {
  if (!isEnvExample(file) && FORBIDDEN_TRACKED.some((re) => re.test(file))) {
    problems.push(`${file}: praćen fajl koji ne sme biti u gitu`);
    continue;
  }
  if (!/\.(ts|tsx|js|mjs|cjs|json|yml|yaml|md|example|sql)$/i.test(file) && !/\.env\.example$/i.test(file)) continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) problems.push(`${file}: izgleda da sadrži tajnu (${name})`);
  }
}

if (problems.length) {
  console.error('Provera tajni nije prošla:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`check-secrets: ${files.length} praćenih fajlova, nema tajni ni zabranjenih fajlova.`);
