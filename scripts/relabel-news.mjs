#!/usr/bin/env node
/**
 * 2.13.0 — REKLASIFIKACIJA POSTOJEĆIH VESTI
 * ----------------------------------------
 * Vesti uvezene pre pravila iz `news-rules.mjs` imaju kategoriju „Vesti“ i
 * engleske tagove (`News`, `Games`, `Hardware`). Ova skripta ih prolazi i
 * ažurira NA MESTU — bez duplikata, bez menjanja teksta, bez novih članaka.
 *
 * Šta se menja:
 *   - `category`     → prava kategorija (Konzole, Hardver, Biznis…),
 *   - `tags`         → srpski tagovi + brend iz naslova,
 *   - `event_id`     → grupa događaja (stranica „Priča se razvija“),
 *   - `news_source`  → ime izvora iz tela članka („Izvor: Polygon“ / link),
 *   - `source_url`   → originalni link (dedupe koji preživljava restart).
 *
 * Upotreba (iz root-a projekta):
 *   node scripts/relabel-news.mjs --dry-run      # samo prikaži šta bi promenio
 *   node scripts/relabel-news.mjs                # primeni
 *   node scripts/relabel-news.mjs --only-missing # samo vesti bez kategorije/tagova
 *   node scripts/relabel-news.mjs --force-tags   # prepiši i ručno unete tagove
 *
 * Čita `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` iz `server/.env` — nema potrebe
 * da API server bude pokrenut.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyArticle, buildTags, detectEvent, plainText } from './news-rules.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);

const DRY = has('dry-run');
const FORCE_TAGS = has('force-tags');

function readEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fallback na process.env */
  }
  return out;
}

const fileEnv = readEnvFile(resolve(process.cwd(), 'server/.env'));
const env = (key) => (process.env[key] ?? fileEnv[key] ?? '').trim();

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_KEY');
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Nedostaju SUPABASE_URL / SUPABASE_SERVICE_KEY (server/.env).');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/** Kolone 2.13.0 mogu da ne postoje — tada se šalje samo ono što baza prima. */
async function probeColumns() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/articles?select=source_url,news_source,event_id&limit=1`, { headers });
  const available = res.ok;
  if (!available) {
    const body = await res.text();
    console.log(`(Napomena: kolone 2.13.0 nisu u bazi — ${body.slice(0, 120)})\n`);
  }
  return available;
}

/** Izvor iz tela: „Izvor: Polygon“ ili prvi https link (originalna vest). */
function sourceFromBody(content = '') {
  const named = String(content).match(/Izvor:\s*([^<]{2,60})</i);
  const link = String(content).match(/<a\s+href="(https:\/\/[^"]+)"/i);
  const altLink = String(content).match(/Pročitaj ceo tekst na\s*([^<]{2,40})</i);
  return {
    sourceUrl: link?.[1] ? link[1].replace(/[?#].*$/, '') : null,
    newsSource: (named?.[1] || altLink?.[1] || '').trim() || null,
  };
}

const columnsAvailable = await probeColumns();

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/articles?select=id,title,excerpt,content,category,tags,cover_image,status,source_url,news_source,event_id&order=created_at.asc&limit=500`,
  { headers },
);
if (!res.ok) {
  console.error(`Ne mogu da pročitam članke: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const articles = await res.json();

const stats = { total: articles.length, changed: 0, unchanged: 0, skipped: 0, byCategory: {} };
const preview = [];

for (const article of articles) {
  const bodyText = plainText(article.content);
  const isImport =
    /Izvor:|Pročitaj ceo tekst na/i.test(String(article.content)) || Boolean(article.source_url) || Boolean(article.news_source);

  // Ručno pisane članke ne diramo (osim uz eksplicitno --all).
  if (!isImport && !has('all')) {
    stats.skipped += 1;
    continue;
  }

  // Naslov iz reda je već očišćen; tagovi su polazni signal samo ako su naši stari.
  const rawTags = Array.isArray(article.tags) ? article.tags : [];
  const category = classifyArticle({
    title: article.title,
    excerpt: article.excerpt ?? '',
    content: article.content ?? '',
    tags: rawTags,
  });

  // Novi tagovi se RAČUNAJU za poređenje; upisuju se po pravilu ispod.
  const tags = buildTags(rawTags, article.title, category);

  const event = detectEvent(article.title, tags, bodyText.slice(0, 300));
  const fromBody = sourceFromBody(article.content ?? '');

  const patch = {};
  // Kategorija: uvek po pravilima (ako se izvor promeni, vest ide u novu kategoriju).
  if (category !== article.category) patch.category = category;

  /**
   * Tagovi: prepisuju se kada su engleski (`News`, `Games`…), jer su to tagovi
   * iz feeda — a ne ručno uneti. Naši tagovi su na srpskom (`Vesti`, `Hardver`,
   * `Vodiči`) ili brend, pa oni ostaju; `--force-tags` prepisuje sve.
   */
  const OUR_TAGS = /^(Vesti|Igre|Gejming|Hardver|Konzole|Esports|Recenzije|Vodiči|Biznis|Mobilno|PC|Film|Serije|Anime)$/i;
  const hasGenericTags = rawTags.some((tag) => {
    const value = String(tag).trim();
    return !OUR_TAGS.test(value) && (/^[A-Za-z][A-Za-z &'-]*$/.test(value) || /^(action adventure|first person|now playing)$/i.test(value));
  });
  const tagKey = rawTags.map((t) => String(t).toLowerCase()).sort().join(',');
  const newTagKey = tags.map((t) => String(t).toLowerCase()).sort().join(',');
  if (tagKey !== newTagKey && (FORCE_TAGS || hasGenericTags)) patch.tags = tags;

  if (columnsAvailable) {
    if (event && article.event_id !== event.id) patch.event_id = event.id;
    if (!article.source_url && fromBody.sourceUrl) patch.source_url = fromBody.sourceUrl;
    if (!article.news_source && fromBody.newsSource) patch.news_source = fromBody.newsSource;
  }



  stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;

  if (!Object.keys(patch).length) {
    stats.unchanged += 1;
    continue;
  }

  stats.changed += 1;
  preview.push({
    title: article.title.slice(0, 64),
    from: article.category,
    to: category,
    tags: tags.join(', '),
    event: event?.id ?? '—',
    patch,
  });

  if (DRY) continue;

  const update = await fetch(`${SUPABASE_URL}/rest/v1/articles?id=eq.${article.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!update.ok) {
    console.error(`✗ ${article.title.slice(0, 50)} → HTTP ${update.status} ${(await update.text()).slice(0, 160)}`);
  }
}

preview.slice(0, 40).forEach((item) => {
  console.log(`• ${item.from} → ${item.to}  [${item.tags}]  doгађај: ${item.event}`);
  console.log(`  ${item.title}`);
});

console.log(`\nUkupno: ${stats.total} · promenjeno: ${stats.changed} · bez promene: ${stats.unchanged} · preskočeno (ručno): ${stats.skipped}`);
console.log('Kategorije posle:', JSON.stringify(stats.byCategory));
console.log(DRY ? '\n(dry-run — ništa nije upisano)' : '\nUpisano u bazu.');
