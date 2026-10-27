#!/usr/bin/env node
/**
 * IZVEŠTAJ PO F-1…F-14: šta je u šemi, šta u kodu, šta fali (`--sql`).
 * -------------------------------------------------------------------
 * Jedan izvor istine za „da li je sve ubaceno“ — pokreće se iz korena:
 *
 *   npm run check:features          # tabela u terminalu
 *   npm run check:features --sql # samo SQL koji se pušta (DDL + COMMENT ON)
 *   node scripts/qa/features-2.7.mjs --json
 *
 * Kako proverava:
 *  - **šema** — čita `server/sql/21-…`, `22-…` (i `schema-ALL.sql`) tekstualno,
 *    pa zna da li je `CREATE TABLE`/`ADD COLUMN` napisan (nema potrebe za bazom);
 *  - **kod** — traži stvarne fajlove/funkcije koje funkcionalnost koristi
 *    (npr. `router.get('/daily'`, `awardXp`, `renderDigest`);
 *  - **živa baza** — samo uz `--db` (Supabase REST, bez DDL prava).
 *
 * Izlazni kod: 0 = sve stavke imaju i šemu i kod, 1 = nešto fali.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const sqlOnly = args.includes('--sql');
const asJson = args.includes('--json');

const read = (rel) => {
  try {
    return readFileSync(resolve(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
};
const has = (rel) => existsSync(resolve(ROOT, rel));

const schema = [
  read('server/schema-ALL.sql'),
  read('server/sql/20-2.6.6-deal-topic.sql'),
  read('server/sql/21-2.7.0-retention.sql'),
  read('server/sql/22-2.7.2-email-notifikacije.sql'),
].join('\n');

const code = [
  read('server/routes/deals.ts'),
  read('server/routes/users.ts'),
  read('server/routes/forum.ts'),
  read('server/routes/admin.ts'),
  read('server/routes/live.ts'),
  read('server/routes/push.ts'),
  read('server/routes/collections.ts'),
  read('server/routes/builds.ts'),
  read('server/routes/search.ts'),
  read('server/index.ts'),
  read('server/lib/gamification.ts'),
  read('server/lib/dailyLoop.ts'),
  read('server/lib/digest.ts'),
  read('server/lib/priceAlerts.ts'),
  read('server/lib/profileCard.ts'),
  read('server/lib/threadEmails.ts'),
  read('server/lib/store.ts'),
  read('server/lib/collections.ts'),
  read('server/lib/builds.ts'),
].join('\n');

/**
 * `sql`: DDL koji mora postojati u šemi.
 * `code`: stringovi koji moraju postojati u kodu (bilo koji od — niz = „bar jedan“).
 * `files`: frontend fajlovi bez kojih UI ne postoji.
 */
const FEATURES = [
  {
    id: 'F-1',
    name: '„Danas u gamingu“ (3 vesti + 2 deal-a + 2 teme, jedan poziv)',
    sql: null,
    code: ["router.get('/daily'", 'Promise.all(', 'pickImportant', 'liveliest'],
    files: ['src/pages/HomeMagazine.tsx'],
    note: 'Ruta je /api/deals/daily (ne /home/feed); nema nove tabele.',
  },
  {
    id: 'F-2',
    name: 'Dnevni loop: streak, dnevni kvest, +XP za prvi post, „novi nivo“',
    sql: 'CREATE TABLE IF NOT EXISTS user_daily_activity',
    columns: [['user_daily_activity', 'bonus_claimed'], ['user_daily_activity', 'quest_completed']],
    code: ['recordDailyPost', 'recordDailyReply', "type: 'level_up'"],
    files: ['src/components/profile/DailyLoopCard.tsx'],
    note: 'Level-up notifikacija je u awardXp (gamification.ts).',
  },
  {
    id: 'F-3',
    name: 'Deal → tema („Diskutuj o ovom popustu“)',
    sql: 'ADD COLUMN IF NOT EXISTS deal_id',
    columns: [['forum_threads', 'deal_id']],
    code: ['dealId'],
    files: ['src/components/forum/LinkedDealCard.tsx'],
  },
  {
    id: 'F-4',
    name: 'Wishlist / price alert (mejl kada cena padne ispod praga)',
    sql: 'CREATE TABLE IF NOT EXISTS deal_watches',
    columns: [['deal_watches', 'target_price'], ['deal_watches', 'notified_at']],
    code: ['notifyPriceWatchers', 'deal_watches'],
    files: ['src/components/deals/PriceWatchButton.tsx'],
    note: 'Oglas se šalje na create/update deal-a (nema periodične provere cena).',
  },
  {
    id: 'F-5',
    name: 'Kolekcije igara sa glasanjem (javna SEO stranica)',
    sql: 'CREATE TABLE IF NOT EXISTS game_collections',
    also: ['game_collection_items', 'game_collection_votes'],
    code: ['game_collection_votes', 'collections'],
    files: ['src/pages/CollectionsPage.tsx', 'src/pages/CollectionPage.tsx'],
  },
  {
    id: 'F-6',
    name: 'Live stream traka (Twitch)',
    sql: null,
    code: ["router.get('/twitch'", 'TWITCH_CLIENT_ID'],
    files: ['src/components/profile/TwitchLive.tsx'],
    note: 'Nema tabele (kanal je u connected_accounts). Traka je link, ne iframe.',
  },
  {
    id: 'F-7',
    name: 'PWA + web push (manifest, offline skela, push)',
    sql: 'CREATE TABLE IF NOT EXISTS push_subscriptions',
    columns: [['push_subscriptions', 'endpoint']],
    code: ['sendPushToUser', "/subscribe'"],
    files: ['public/sw.js', 'public/manifest.webmanifest', 'src/pages/OfflinePage.tsx'],
    note: 'Slanje traži `npm i --prefix server web-push` + VAPID_* (paket još nije instaliran).',
  },
  {
    id: 'F-8',
    name: 'Nedeljni email digest',
    sql: 'CREATE TABLE IF NOT EXISTS site_meta',
    columns: [['site_meta', 'value']],
    code: ['sendDigestToSubscribers', 'startWeeklyDigest()', "router.post('/digest/send'"],
    files: [],
    note: 'Nema sopstvene tabele — marker u site_meta (migracija 22).',
  },
  {
    id: 'F-9',
    name: '„Kupio sam“ na deal-u (socijalni dokaz)',
    sql: 'CREATE TABLE IF NOT EXISTS deal_claims',
    columns: [['deal_claims', 'deal_id'], ['deal_claims', 'user_id']],
    code: ["/:id/claim", 'deal_claims'],
    files: ['src/pages/DealPage.tsx'],
    note: 'UNIQUE (deal_id, user_id); broj se vidi na detalju, ne u listi.',
  },
  {
    id: 'F-10',
    name: 'Moderatori: upozorenja + restore teme',
    sql: 'CREATE TABLE IF NOT EXISTS user_warnings',
    columns: [['user_warnings', 'reason'], ['forum_threads', 'is_deleted']],
    code: ['restoreThread', 'user_warnings'],
    files: ['src/components/profile/WarningBanner.tsx'],
  },
  {
    id: 'F-11',
    name: 'Kalkulator build-a (hardver → cene kod domaćih prodavnica)',
    sql: 'CREATE TABLE IF NOT EXISTS pc_components',
    also: ['pc_builds', 'pc_build_items'],
    code: ['pc_components', 'share_id'],
    files: ['src/pages/BuildPlannerPage.tsx'],
  },
  {
    id: 'F-12',
    name: 'Gaming kartica profila 1200×630',
    sql: null,
    code: ["card.png", '1200', 'renderProfileCard'],
    files: ['src/components/profile/ShareProfileCard.tsx'],
    note: 'Nema tabele; slika se generiše u letu (SVG → PNG).',
  },
  {
    id: 'F-13',
    name: '⌘K globalna pretraga',
    sql: null,
    code: ["SearchType[] = ['all'", 'replies'],
    files: ['src/components/CommandPalette.tsx'],
    note: 'Nema tabele (GIN indeksi iz 2.6.2).',
  },
  {
    id: 'F-14',
    name: 'Light + print tema',
    sql: null,
    code: [],
    files: ['src/lib/theme.ts', 'src/components/ThemeToggle.tsx', 'src/styles/components/theme.css'],
    note: 'Nema tabele; `data-theme` + @media print.',
  },
];

const compact = (value) => value.replace(/[\r\n\t ]+/g, '').trim();
const schemaCompact = compact(schema).toLowerCase();
const codeCompact = compact(code);

const results = FEATURES.map((feature) => {
  const missing = [];

  if (feature.sql) {
    if (!schemaCompact.includes(compact(feature.sql).toLowerCase())) missing.push(`SQL: ${feature.sql}`);
    for (const table of feature.also ?? []) {
      if (!schemaCompact.includes(`createtableifnotexists${table}`)) missing.push(`SQL: tabela ${table}`);
    }
  }
  for (const [table, column] of feature.columns ?? []) {
    // Kolona može biti u `CREATE TABLE` ili u `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
    // (tako su dodate F-3 deal_id i F-10 is_deleted).
    const start = schemaCompact.indexOf(`createtableifnotexists${table}(`);
    const createPart = start >= 0 ? schemaCompact.slice(start, start + 4000) : '';
    const inCreate = createPart.includes(column) && createPart.indexOf(column) < createPart.indexOf(');');
    const alterRe = new RegExp(`ALTERTABLE${table}[^;]*${column}(UUID|BOOLEAN|TIMESTAMPTZ|TEXT|INTEGER|DATE)`, 'i');
    if (!inCreate && !alterRe.test(schemaCompact)) missing.push(`SQL: kolona ${table}.${column}`);
  }
  for (const token of feature.code ?? []) {
    if (!codeCompact.includes(compact(token))) missing.push(`kod: ${token}`);
  }
  for (const file of feature.files ?? []) {
    if (!has(file)) missing.push(`fajl: ${file}`);
  }

  return { ...feature, ok: missing.length === 0, missing };
});

/* ------------------------------- izlaz ------------------------------- */

if (sqlOnly) {
  // Samo ono što ide u SQL Editor, redom: tabele → kolone → komentari.
  const lines = [
    '-- NEXUS 2.7.x — šema po F-stavkama (isti sadržaj kao server/sql/21 + 22)',
    '-- Idempotentno. Pusti posle server/schema-ALL.sql ili umesto njega na praznu bazu.',
    '',
  ];
  const blocks = [
    ['F-3', read('server/sql/20-2.6.6-deal-topic.sql')],
    ['F-1…F-14', read('server/sql/21-2.7.0-retention.sql')],
    ['2.7.2', read('server/sql/22-2.7.2-email-notifikacije.sql')],
  ];
  for (const [label, body] of blocks) {
    lines.push(`-- ========== ${label} ==========`);
    lines.push(body.trim(), '');
  }
  lines.push(read('server/sql/23-2.7.2-verify.sql').trim());
  console.log(lines.join('\n'));
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`\n${pad('ID', 6)}${pad('ŠEMA', 7)}${pad('KOD/UI', 8)}Stavka`);
console.log('─'.repeat(96));
for (const result of results) {
  const schemaOk = result.missing.filter((m) => m.startsWith('SQL')).length === 0;
  const codeOk = result.missing.filter((m) => !m.startsWith('SQL')).length === 0;
  console.log(`${pad(result.id, 6)}${pad(schemaOk ? '✓' : '✗', 7)}${pad(codeOk ? '✓' : '✗', 8)}${result.name}`);
  for (const item of result.missing) console.log(`${' '.repeat(14)}→ FALI: ${item}`);
  if (result.note) console.log(`${' '.repeat(14)}  ${result.note}`);
}
const failed = results.filter((r) => !r.ok);
console.log('─'.repeat(96));
console.log(
  failed.length
    ? `✗ ${failed.length} od ${results.length} stavki nije kompletno — vidi „FALI“ iznad.`
    : `✓ Sve ${results.length} stavke (F-1…F-14): šema i kod postoje.`,
);
console.log('SQL za puštanje: npm run check:features --sql\n');
process.exit(failed.length ? 1 : 0);
