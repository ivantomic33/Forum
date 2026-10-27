#!/usr/bin/env node
/**
 * BACKUP / RESTORE — `npm run backup` i `npm run restore`
 * -------------------------------------------------------
 * Dve stvari se gube pri „nesreći“ i obe su u ovom skriptu:
 *
 *  1. **Dvofaktorski podaci iz `server/.data`** (memory režim: users/threads/...
 *     i `site_meta` kao fajl) — obična kopija direktorijuma + manifest.
 *  2. **Supabase Postgres** — `pg_dump` ako je dostupan:
 *       a) `DATABASE_URL` (preporučeno; „Connection string“ iz Supabase → Project
 *          Settings → Database, port 5432 — ne pooling 6543),
 *       b) ako ga nema, pokušaj `SUPABASE_DB_URL` / `SUPABASE_DB_PASSWORD` + `SUPABASE_URL`
 *          (host `db.<ref>.supabase.co`, user `postgres`, baza `postgres`),
 *       c) ako ni to nema — dump se preskače uz jasnu poruku (backup `.data`
 *          i dalje prolazi).
 *
 * Zašto skript, a ne dokumentacija: procedura koja se ne pokreće jednom u CI-ju
 * ne postoji. `--verify` proverava da je arhiva kompletna i čitljiva, pa CI može
 * da je pokrene na svakom PR-u (bez tajni: pravi se `--data-only` + `--dry-run`).
 *
 * Korišćenje:
 *   node scripts/backup.mjs                       # ./backups/<datum>/
 *   node scripts/backup.mjs --out D:\backup       # drugo odredište
 *   node scripts/backup.mjs --data-only           # bez PG dump-a
 *   node scripts/backup.mjs --verify <arhiva>     # proveri postojeći backup
 *   node scripts/backup.mjs --restore <arhiva>    # vrati .data + (opciono) dump
 *
 * Restore NIKAD ne radi preko žive baze bez `--yes` (psql traži potvrdu).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'server', '.data');
const MANIFEST = 'manifest.json';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const readEnvFile = (path) => {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
};

/** Env: proces → `server/.env` (isti redosled kao server). */
function loadEnv() {
  return { ...readEnvFile(join(ROOT, '.env')), ...readEnvFile(join(ROOT, 'server', '.env')), ...process.env };
}

/** `DATABASE_URL` → ili izvod iz Supabase env-a; `null` = bez PG dump-a. */
function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: 'DATABASE_URL' };
  if (env.SUPABASE_DB_URL) return { url: env.SUPABASE_DB_URL, source: 'SUPABASE_DB_URL' };
  if (env.SUPABASE_URL && env.SUPABASE_DB_PASSWORD) {
    try {
      const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
      const password = encodeURIComponent(env.SUPABASE_DB_PASSWORD);
      return { url: `postgresql://postgres:${password}@db.${ref}.supabase.co:5432/postgres`, source: 'SUPABASE_*' };
    } catch {
      return null;
    }
  }
  return null;
}

const psqlAvailable = (bin) => {
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
};

/** `cp -r` bez Node API-ja — radi i na Windows-u i na Linux-u bez `fs.cpSync` varijanti. */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else writeFileSync(target, readFileSync(source));
  }
}

/** Lista fajlova sa SHA-256 i veličinom — osnova za `--verify`. */
function fingerprint(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => {
      const buffer = readFileSync(join(dir, name));
      return { path: name, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
    });
}

function backup() {
  const outRoot = resolve(valueOf('--out') ?? join(ROOT, 'backups'));
  const target = join(outRoot, stamp());
  mkdirSync(target, { recursive: true });

  const env = loadEnv();
  const manifest = {
    createdAt: new Date().toISOString(),
    app: 'nexus',
    note: 'Backup server/.data + opcioni Postgres dump. Ne sadrži tajne — .env fajlovi se NE kopiraju.',
    data: { source: relative(ROOT, DATA_DIR), files: [] },
    database: { dumped: false, reason: null, file: null },
  };

  // 1. server/.data (memory režim: users.json, threads.json, site_meta.json…)
  if (existsSync(DATA_DIR)) {
    copyDir(DATA_DIR, join(target, 'data'));
    manifest.data.files = fingerprint(join(target, 'data'));
    console.log(`✓ server/.data → ${join(target, 'data')} (${manifest.data.files.length} fajlova)`);
  } else {
    manifest.data.reason = 'server/.data ne postoji (Supabase režim ili prazna instalacija).';
    console.log('· server/.data ne postoji — preskočeno');
  }

  // 2. Postgres dump
  const db = has('--data-only') ? null : resolveDatabaseUrl(env);
  if (!db) {
    manifest.database.reason = has('--data-only')
      ? 'Preskočeno sa --data-only.'
      : 'Nema DATABASE_URL/SUPABASE_DB_URL/SUPABASE_DB_PASSWORD+SUPABASE_URL.';
    console.warn(`! PG dump preskočen: ${manifest.database.reason}`);
  } else if (!psqlAvailable('pg_dump')) {
    manifest.database.reason = 'pg_dump nije instaliran (Postgres client tools).';
    console.warn('! pg_dump nije instaliran — PG dump preskočen. Instaliraj Postgres client tools.');
  } else {
    const dumpFile = join(target, 'postgres.sql.gz');
    try {
      execFileSync(
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32'
          ? ['/c', `pg_dump "${db.url}" --no-owner --no-privileges --clean --if-exists | gzip > "${dumpFile}"`]
          : ['-c', `pg_dump "${db.url}" --no-owner --no-privileges --clean --if-exists | gzip > "${dumpFile}"`],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
      if (!existsSync(dumpFile) || statSync(dumpFile).size === 0) throw new Error('dump je prazan');
      manifest.database = {
        dumped: true,
        source: db.source,
        file: 'postgres.sql.gz',
        bytes: statSync(dumpFile).size,
        sha256: createHash('sha256').update(readFileSync(dumpFile)).digest('hex'),
      };
      console.log(`✓ Postgres dump → ${dumpFile} (${(manifest.database.bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (error) {
      manifest.database.reason = `pg_dump nije uspeo: ${error?.message ?? error}`;
      console.error(`! PG dump nije uspeo: ${error?.message ?? error}`);
    }
  }

  writeFileSync(join(target, MANIFEST), JSON.stringify(manifest, null, 2));
  console.log(`\nBackup: ${target}`);
  return target;
}

function verify(dir) {
  const target = resolve(dir);
  const manifestPath = join(target, MANIFEST);
  if (!existsSync(manifestPath)) {
    console.error(`✗ Nema ${MANIFEST} u ${target}`);
    return 1;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const problems = [];

  for (const entry of manifest.data?.files ?? []) {
    const path = join(target, 'data', entry.path);
    if (!existsSync(path)) {
      problems.push(`nedostaje ${entry.path}`);
      continue;
    }
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (hash !== entry.sha256) problems.push(`izmenjen ${entry.path}`);
  }

  if (manifest.database?.dumped) {
    const dump = join(target, manifest.database.file);
    if (!existsSync(dump)) problems.push(`nedostaje ${manifest.database.file}`);
    else {
      const hash = createHash('sha256').update(readFileSync(dump)).digest('hex');
      if (hash !== manifest.database.sha256) problems.push('izmenjen postgres dump');
    }
  }

  if (problems.length) {
    console.error(`✗ Backup nije ispravan:\n  - ${problems.join('\n  - ')}`);
    return 1;
  }
  console.log(
    `✓ Backup je ispravan: ${manifest.data?.files?.length ?? 0} fajlova` +
    (manifest.database?.dumped ? `, dump ${(manifest.database.bytes / 1024 / 1024).toFixed(1)} MB` : ', bez PG dump-a'),
  );
  return 0;
}

function restore(dir) {
  const target = resolve(dir);
  if (verify(target) !== 0) return 1;
  const manifest = JSON.parse(readFileSync(join(target, MANIFEST), 'utf8'));

  if (manifest.data?.files?.length) {
    // Stari `.data` se čuva pored — restore nikad ne briše podatke bez kopije.
    const safety = `${DATA_DIR}.bak-${stamp()}`;
    if (existsSync(DATA_DIR)) {
      copyDir(DATA_DIR, safety);
      console.log(`· Prethodni server/.data sačuvan u ${safety}`);
    }
    // Restore je zamena, ne spajanje: stari fajlovi koji nisu u arhivi ne smeju da ostanu.
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    copyDir(join(target, 'data'), DATA_DIR);
    console.log(`✓ server/.data vraćen (${manifest.data.files.length} fajlova)`);
  }

  if (manifest.database?.dumped) {
    const env = loadEnv();
    const db = resolveDatabaseUrl(env);
    if (!db) {
      console.error('! Nema DATABASE_URL — PG dump NIJE vraćen. Komanda za ručni restore:');
      console.error(`    gunzip -c "${join(target, manifest.database.file)}" | psql <DATABASE_URL>`);
      return 1;
    }
    if (!has('--yes')) {
      console.error('! Vraćanje baze prepisuje podatke. Ponovi sa `--yes` da potvrdiš.');
      console.error(`    gunzip -c "${join(target, manifest.database.file)}" | psql "${db.url}"`);
      return 1;
    }
    execFileSync(
      process.platform === 'win32' ? 'cmd.exe' : 'sh',
      process.platform === 'win32'
        ? ['/c', `gunzip -c "${join(target, manifest.database.file)}" | psql "${db.url}"`]
        : ['-c', `gunzip -c "${join(target, manifest.database.file)}" | psql "${db.url}"`],
      { stdio: 'inherit' },
    );
    console.log('✓ Postgres dump vraćen');
  }
  return 0;
}

if (has('--help') || has('-h')) {
  console.log('Korišćenje: node scripts/backup.mjs [--out DIR] [--data-only] | --verify DIR | --restore DIR [--yes]');
  process.exit(0);
}
if (has('--verify')) process.exit(verify(valueOf('--verify')));
else if (has('--restore')) process.exit(restore(valueOf('--restore')));
else backup();
