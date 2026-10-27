/**
 * N-11 — PRETEST PROVERA INSTALACIJE
 * ----------------------------------
 * Projekat ima dva manifesta (`package.json` + `server/package.json`) i dva
 * lockfile-a. Kada se jedan od njih izmeni bez `npm install`, lokalno radi
 * (stari `node_modules`), a CI pukne na `npm ci` — ili obrnuto. Ova skripta
 * pokreće se pre `npm test` i pre prve CI instalacije:
 *
 *  - poredi hash svakog `package.json`-a sa zapisom u `.npm-install-state.json`
 *    (upisuje ga `postinstall`) — upozorava da `node_modules` nije osvežen;
 *  - proverava da **oba** lockfile-a postoje i da su u `git`-u (bez njih
 *    instalacija nije ponovljiva);
 *  - proverava da nema trećeg `node_modules` van korena i `server/` (npr.
 *    zaboravljen `npm install` unutar podfoldera).
 *
 * Exit kod 0 = sve u redu (upozorenja idu na stderr), 1 = blokirajuća greška.
 * Namerno bez zavisnosti: radi i pre `npm install`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const STATE_FILE = path.join(root, '.npm-install-state.json');

const manifests = [
  { name: 'root', dir: root, lock: 'package-lock.json' },
  { name: 'server', dir: path.join(root, 'server'), lock: path.join('server', 'package-lock.json') },
];

const errors = [];
const warnings = [];

const hashOf = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Da li je fajl u git-u (tracked ili staged). Van git repo-a se ne proverava. */
function isTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const inGit = fs.existsSync(path.join(root, '.git'));
const state = readState();

for (const manifest of manifests) {
  const pkgPath = path.join(manifest.dir, 'package.json');
  const lockPath = path.join(root, manifest.lock);

  if (!fs.existsSync(lockPath)) {
    errors.push(`${manifest.name}: nedostaje ${manifest.lock} — instalacija nije ponovljiva.`);
  } else if (inGit && !isTracked(manifest.lock)) {
    errors.push(`${manifest.name}: ${manifest.lock} nije u git-u — CI i lokalno bi se razlikovali.`);
  }

  const expected = state?.manifests?.[manifest.name];
  if (expected && expected !== hashOf(pkgPath)) {
    warnings.push(
      `${manifest.name}: package.json je izmenjen posle poslednjeg instaliranja ` +
        `(${manifest.dir === root ? 'npm install' : 'npm install --prefix server'}).`,
    );
  }
}

if (!state) {
  warnings.push('Nema .npm-install-state.json — pokreni `npm install` (upisuje ga postinstall).');
}

// Treći `node_modules` (zaboravljen instal u podfolderu) — jedan lockfile po paket-rutu.
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
  // `contracts/` ima `node_modules/zod` kao simlink na server instalaciju
  // (`scripts/link-contracts.mjs`) — nije treći instal.
  if (entry.name === 'server' || entry.name === 'contracts') continue;
  if (fs.existsSync(path.join(root, entry.name, 'package.json'))) {
    warnings.push(`${entry.name}/package.json — nije deo workspace-a; njegove zavisnosti idu u root.`);
  }
  if (fs.existsSync(path.join(root, entry.name, 'node_modules'))) {
    warnings.push(`${entry.name}/node_modules — treći instal; obriši ga, zavisnosti idu u root.`);
  }
}

for (const warning of warnings) console.warn(`[check-install] ⚠ ${warning}`);
for (const error of errors) console.error(`[check-install] ✖ ${error}`);

if (errors.length) {
  console.error(`[check-install] ${errors.length} blokirajućih problema.`);
  process.exit(1);
}

console.log(
  `[check-install] OK${warnings.length ? ` (${warnings.length} upozorenja)` : ''} — ` +
    'root + server instalacija su usklađene.',
);
