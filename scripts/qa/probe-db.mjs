// Provera žive baze: koje tabele/kolone iz 2.7.x RADE (postoje i čitljive su).
//
// Zašto: aplikacija bez migracije ne puca — degradira (prazan blok „Danas u
// gamingu“, broj „Kupio sam“ 0, `503` na upisu). Ova skripta hvata tu razliku
// pre nego što se vidi u UI-ju.
//
// Pokretanje (iz korena projekta):
//   node scripts/qa/probe-db.mjs                 # čita server/.env
//   node scripts/qa/probe-db.mjs --json          # parsabilan izlaz
//   node scripts/qa/probe-db.mjs --rows          # + broj redova po tabeli
//
// Izlazni kodovi: 0 = sve postoji, 1 = nešto fali, 2 = nema Supabase-a (memory režim).
// Tajne se ne ispisuju.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const withRows = args.includes('--rows');

function readEnv(file) {
  const env = {};
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// `server/.env` je izvor istine (server ga učitava); root `.env` samo kao rezerva.
const env = { ...readEnv(resolve(ROOT, '.env')), ...readEnv(resolve(ROOT, 'server/.env')) };
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || url === 'memory' || !key || url.startsWith('http://localhost')) {
  console.log(
    asJson
      ? JSON.stringify({ mode: 'memory', reason: 'SUPABASE_URL/SERVICE_KEY nisu podešeni' })
      : 'Memory režim: server/.env nema pravi SUPABASE_URL + SUPABASE_SERVICE_KEY.',
  );
  process.exit(2);
}

/** Tabele po verziji — dodaj ovde kad nova migracija uvede tabelu. */
const TABLES = {
  '1-core': ['users', 'articles', 'forum_threads', 'forum_posts', 'categories', 'notifications', 'audit_log'],
  '2.6.x': ['deals', 'games', 'user_presence', 'sessions', 'thread_subscriptions', 'search_terms', 'site_meta'],
  '2.7.0 (F-1…F-14)': [
    'deal_claims',
    'deal_watches',
    'game_collections',
    'game_collection_items',
    'game_collection_votes',
    'user_warnings',
    'user_daily_activity',
    'push_subscriptions',
    'pc_components',
    'pc_builds',
    'pc_build_items',
  ],
  '2.7.2 (F-15…F-20)': ['trusted_devices', 'newsletter_campaigns'],
};

/** Kolone bez kojih funkcionalnost tiho degradira. */
const COLUMNS = [
  ['forum_threads', 'deal_id', 'F-3 deal → tema'],
  ['forum_threads', 'is_deleted', 'F-10 soft delete / restore'],
  ['thread_subscriptions', 'email_on_reply', 'email notifikacije'],
  ['deals', 'discount_pct', 'F-1 najbolji popusti'],
];

const db = createClient(url, key, { auth: { persistSession: false } });
const problems = [];
const rows = {};

for (const [group, tables] of Object.entries(TABLES)) {
  for (const table of tables) {
    const { error, count } = await db.from(table).select('*', { head: true, count: 'exact' });
    if (error) problems.push({ table, code: error.code, message: error.message.slice(0, 120), group });
    else if (typeof count === 'number') rows[table] = count;
  }
}

for (const [table, column, feature] of COLUMNS) {
  const { error } = await db.from(table).select(column).limit(1);
  if (error) problems.push({ table, column, feature, code: error.code, message: error.message.slice(0, 120) });
}

if (asJson) {
  console.log(JSON.stringify({ mode: 'supabase', ok: problems.length === 0, problems, rows: withRows ? rows : undefined }, null, 2));
} else {
  console.log(`Baza: Supabase (${url.replace(/^https?:\/\//, '').split('.')[0]}.supabase.co)`);
  if (problems.length === 0) {
    console.log('✓ Sve tabele i kolone postoje — migracija je puštena.');
  } else {
    console.log(`✗ ${problems.length} problem(a):`);
    for (const p of problems) {
      const what = p.column ? `${p.table}.${p.column}` : p.table;
      console.log(`  - ${what} [${p.code}] ${p.message}${p.feature ? ` — ${p.feature}` : ''}`);
    }
    console.log('  → Pusti server/schema-ALL.sql u Supabase SQL Editor-u (idempotentan je).');
  }
  if (withRows) {
    console.log('\nRedova:');
    for (const [table, count] of Object.entries(rows)) console.log(`  ${table.padEnd(26)} ${count}`);
  }
}

process.exit(problems.length === 0 ? 0 : 1);
