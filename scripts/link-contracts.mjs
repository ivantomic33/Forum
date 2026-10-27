#!/usr/bin/env node
/**
 * N10 — `node_modules` EHVI ZA `contracts/` I `server/`
 * ----------------------------------------------------
 * `contracts/index.ts` uvozi `zod`, koji je instaliran u `server/node_modules`.
 * Node ESM razrešava bare oznake od foldera fajla (`contracts/` → `Forum/node_modules`),
 * pa bi `tsx`/`node` pali na `ERR_MODULE_NOT_FOUND` pre instalacije frontenda.
 *
 * Rešenje bez dupliranja zavisnosti: `contracts/node_modules/zod` je **simlink**
 * na `server/node_modules/zod`, a `server/node_modules/contracts` simlink na
 * koren `contracts/` (da Node ne izbaci „outside package“ grešku pri uvozu iz
 * `server/routes/*`). Oba su git-ignored i pravi ih ovaj skript (postinstall).
 *
 * Windows: `junction` — ne traži admin prava. Linux/macOS: relativni `dir`
 * (portabilno u CI-ju i kontejnerima).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const zodSource = path.join(root, 'server', 'node_modules', 'zod');
const contractsSource = path.join(root, 'contracts');

const links = [
  { link: path.join(root, 'contracts', 'node_modules', 'zod'), target: zodSource, type: 'dir' },
  { link: path.join(root, 'server', 'node_modules', 'contracts'), target: contractsSource, type: 'dir' },
];

function isLinkTo(link, target) {
  try {
    return fs.realpathSync(link) === fs.realpathSync(target);
  } catch {
    return false;
  }
}

if (!fs.existsSync(zodSource)) {
  console.warn('[link-contracts] server/node_modules/zod ne postoji — pokreni `npm install --prefix server`.');
  process.exit(0);
}

for (const { link, target, type } of links) {
  if (isLinkTo(link, target)) continue;
  if (fs.existsSync(link)) {
    // Pravi folder (ne simlink) — ne diramo ga; upozoravamo da Node može videti drugu verziju.
    console.warn(`[link-contracts] ${path.relative(root, link)} već postoji i nije simlink — preskačem.`);
    continue;
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    if (process.platform === 'win32') {
      const flag = type === 'dir' ? ['/J'] : [];
      execFileSync('cmd', ['/c', 'mklink', ...flag, link, target], { stdio: 'ignore' });
    } else {
      fs.symlinkSync(path.relative(path.dirname(link), target), link, type);
    }
  } catch (error) {
    console.warn(`[link-contracts] ${path.relative(root, link)}: ${error?.message ?? error}`);
  }
}
