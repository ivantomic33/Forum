#!/usr/bin/env node
/**
 * Bezbedno pakovanje projekta za deljenje (F-01).
 *
 * Arhiva se pravi samo iz `git archive`-a, tj. iz sačuvanih fajlova — nikad iz
 * radnog foldera. `.env`, logovi, `node_modules`, `dist` i `server/.data` su
 * u `.gitignore`-u, pa nikad ne ulaze u arhivu. Nakon pakovanja skripta još
 * jednom proveri sadržaj zip-a i prekida se ako pronađe tajnu ili lokalni fajl.
 *
 * Usage: node scripts/pack.mjs [izlazni-fajl.zip]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? `nexus-source-${new Date().toISOString().slice(0, 10)}.zip`);

const FORBIDDEN = [
  /(^|\/)\.env$/i,
  /\.env\.(local|development|production|staging)$/i,
  /(^|\/)\.data\//i,
  /(^|\/)node_modules\//i,
  /(^|\/)dist\//i,
  /\.log$/i,
];

try {
  const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!head) throw new Error('empty');
} catch {
  console.error('Nema nijednog git commita — `git archive` ne može da napravi arhivu.');
  console.error('Sačuvaj kod u git i pokreni ponovo; ne pakuj radni folder u zip.');
  process.exit(1);
}

execFileSync('git', ['archive', '--format=zip', `--output=${out}`, 'HEAD'], { stdio: 'inherit' });

// Provеra sadržaja arhive (samo imena fajlova — sadržaj se ne čita, pa se tajne ne prikazuju).
const entries = execFileSync(
  'powershell',
  ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead($env:ZIP_PATH).Entries | ForEach-Object { $_.FullName }'],
  { encoding: 'utf8', env: { ...process.env, ZIP_PATH: out } },
)
  .split(/\r?\n/)
  .filter(Boolean);

const offending = entries.filter((name) => FORBIDDEN.some((re) => re.test(name)));
if (offending.length) {
  fs.rmSync(out, { force: true });
  console.error(`Arhiva sadrži zabranjene fajlove i obrisana je:\n${offending.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`Arhiva spremna: ${out} (${entries.length} fajlova, bez .env/logova/node_modules/dist/.data).`);
