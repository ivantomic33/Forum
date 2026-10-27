#!/usr/bin/env node
/**
 * 2.13.5 — DOPUNA POSTOJEĆIH VESTI
 * -------------------------------
 * Posle promene pravila (nove kategorije, proširena lista događaja) stare vesti
 * ostaju sa starim vrednostima. Ova skripta ih prolazi i ažurira NA MESTU:
 *
 *  1. `category`  — pravila + AI kada pravila padnu na „Vesti“,
 *  2. `event_id`  — proširena lista događaja,
 *  3. `content`   — kratak tekst (2–3 rečenice) dopunjava AI sažetkom iz istog
 *                   teksta (ne izmišlja: `expandShortText` odbija predugačak izlaz).
 *
 * Upotreba (iz root-a projekta):
 *   node scripts/enrich-news.mjs --dry-run
 *   node scripts/enrich-news.mjs
 *   node scripts/enrich-news.mjs --no-ai        # samo pravila, bez modela
 *   node scripts/enrich-news.mjs --limit=20
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyArticle, detectEvent, plainText } from './news-rules.mjs';
import { classifyWithAI, expandShortText, translationReport, saveCache } from './ai-translate.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY = has('dry-run');
const USE_AI = !has('no-ai');
const LIMIT = Number(flag('limit', '200'));

function readEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fallback */
  }
  return out;
}

const fileEnv = readEnvFile(resolve(process.cwd(), 'server/.env'));
for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'AI_TRANSLATE_MAX_PER_RUN', 'AI_TRANSLATE_FALLBACK_MODEL']) {
  if (!process.env[key] && fileEnv[key]) process.env[key] = fileEnv[key];
}

const url = (fileEnv.SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = fileEnv.SUPABASE_SERVICE_KEY ?? '';
if (!url || !serviceKey) {
  console.error('Nedostaju SUPABASE_URL / SUPABASE_SERVICE_KEY (server/.env).');
  process.exit(1);
}
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

const res = await fetch(
  `${url}/rest/v1/articles?select=id,title,excerpt,content,category,tags,event_id,news_source&order=created_at.desc&limit=${LIMIT}`,
  { headers },
);
if (!res.ok) {
  console.error(`Ne mogu da pročitam članke: HTTP ${res.status}`);
  process.exit(1);
}
const articles = await res.json();

const stats = { total: articles.length, category: 0, event: 0, expanded: 0, aiCalls: 0 };
const byCategory = {};

for (const article of articles) {
  const patch = {};

  // 1. Kategorija.
  let category = classifyArticle({
    title: article.title,
    excerpt: article.excerpt ?? '',
    content: article.content ?? '',
    tags: Array.isArray(article.tags) ? article.tags : [],
  });

  if (category === 'Vesti' && USE_AI) {
    const ai = await classifyWithAI({ title: article.title, excerpt: article.excerpt ?? '', content: article.content ?? '' });
    if (ai) {
      category = ai;
      stats.aiCalls += 1;
    }
  }
  byCategory[category] = (byCategory[category] ?? 0) + 1;
  if (category !== article.category) patch.category = category;

  // 2. Grupa događaja.
  const event = detectEvent(article.title, Array.isArray(article.tags) ? article.tags : [], plainText(article.content ?? '').slice(0, 300));
  if (event && article.event_id !== event.id) {
    patch.event_id = event.id;
    stats.event += 1;
  }

  // 3. Kratak tekst.
  const text = article.content ?? '';
  /**
   * 2.13.5 — dve stvari pre AI poziva:
   *
   * 1. dopuna se meri na VIDLJIVOM tekstu (HTML `<p>` dodaje ~200 znakova, pa
   *    vest od 450 znakova izgleda kao 700);
   * 2. vest koja je već dopunjena se ne dopunjava PONOVO — marker
   *    `<!--expanded:-->` sprečava novi plaćeni poziv za isti članak.
   */
  const alreadyExpanded = /<!--expanded:/.test(text);
  const visibleLength = plainText(text).length;
  if (USE_AI && !alreadyExpanded && visibleLength < 700 && visibleLength >= 120) {
    const { text: expanded, expanded: ok } = await expandShortText({
      title: article.title,
      text: plainText(text).slice(0, 3_000),
      minChars: 700,
    });
    if (ok) {
      patch.content = expanded
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => `<p>${block.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch])}</p>`)
        .join('');
      /**
       * Marker se stavlja samo ako je tekst zaista DUŽI.
       * Kada izvor daje 3 rečenice, sažetak ne može biti duži — vest ostaje
       * kratka (i to je u redu: kratka objava je kratka objava). Bez ovog
       * uslova marker je tvrdio da je „dopunjeno“ i blokirao buduće pokušaje.
       */
      if (plainText(patch.content).length > visibleLength) {
        patch.content = `${patch.content}<!--expanded:2.13.5-->`;
        stats.expanded += 1;
      } else {
        delete patch.content;
      }
    }
  }

  if (!Object.keys(patch).length) continue;
  if (patch.category || patch.event_id) stats.category += patch.category ? 1 : 0;

  if (!DRY) {
    // Sanitizacija: tekst iz modela ide kao čist tekst, bez tuđeg HTML-a.
    const update = await fetch(`${url}/rest/v1/articles?id=eq.${article.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!update.ok) console.log(`✗ ${article.title.slice(0, 50)} → HTTP ${update.status}`);
  }

  const changes = Object.keys(patch).join(', ');
  console.log(`• [${changes}] ${article.category} → ${category}${event ? ` ⟨${event.id}⟩` : ''}  ${article.title.slice(0, 52)}`);
}

const report = translationReport();
console.log(
  `\nUkupno: ${stats.total} · kategorija: ${stats.category} · nov događaj: ${stats.event} · dopunjen tekst: ${stats.expanded}` +
  `\nPoziva: ${report.calls} · tokena: ${report.tokensIn + report.tokensOut} · ~$${report.estimatedCostUsd.toFixed(4)}` +
  `\nKategorije: ${JSON.stringify(byCategory)}`,
);
console.log(DRY ? '\n(dry-run — ništa nije upisano)' : '\nUpisano u bazu.');
saveCache();
