#!/usr/bin/env node
/**
 * n8n RSS → NEXUS uvoz vesti
 * --------------------------
 * Povlači RSS feed koji emituje n8n workflow, pretvara `<item>` u telo za
 * `POST /api/articles/ingest` i šalje ga serveru (koji radi deduplikaciju).
 *
 * Zašto skripta, a ne HTTP node u n8n-u: feed ima 30 stavki sa 35-minutnim
 * intervalom, pa bi n8n poslao sve iste stavke svaki put. `ingest` ih odbija
 * kao `duplicate`, ali to troši rate limit i log. Ovako se pokreće kad treba
 * (Cron / Task Scheduler / ručno), a ponovno pokretanje je bezbedno.
 *
 * Upotreba (iz root-a projekta):
 *   node scripts/ingest-rss.mjs
 *   node scripts/ingest-rss.mjs --dry-run
 *   node scripts/ingest-rss.mjs --limit=5 --exclude=Guides --exclude=Reviews
 *   node scripts/ingest-rss.mjs --feed=https://... --api=http://localhost:4000
 *
 * Env (iz server/.env ili okruženja):
 *   RSS_FEED_URL          default: https://dexter1221.app.n8n.cloud/webhook/gaming-news-rss
 *   API_URL               default: http://localhost:4000
 *   ARTICLES_INGEST_API_KEY  obavezan (isti ključ kao na serveru)
 *   RSS_EXCLUDE_CATEGORIES comma lista kategorija koje se preskaču (default: Guides,Reviews)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyArticle, buildTags, detectEvent, whyItMatters } from './news-rules.mjs';
import { buildBilingualBody, looksSerbian, extractKeySentences } from './translate-news.mjs';
import {
  translateWithAI,
  translateTitleFallback,
  expandShortText,
  classifyWithAI,
  aiTranslationAvailable,
  translationReport,
  saveCache,
} from './ai-translate.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

/** Minimalno čitanje `server/.env` — bez zavisnosti i bez prepisivanja procesa. */
function readEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* fajl ne postoji — koristi samo process.env */
  }
  return out;
}

const fileEnv = readEnvFile(resolve(process.cwd(), 'server/.env'));
const env = (key, fallback = '') => process.env[key] ?? fileEnv[key] ?? fallback;

/**
 * 2.13.3 — modul za AI prevod čita `process.env`, pa vrednosti iz `server/.env`
 * moraju da se prenesu pre nego što se modul učita (uvoz na vrhu fajla).
 */
for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'AI_TRANSLATE', 'AI_TRANSLATE_MAX_PER_RUN']) {
  if (!process.env[key] && fileEnv[key]) process.env[key] = fileEnv[key];
}

const FEED = flag('feed', env('RSS_FEED_URL', 'https://dexter1221.app.n8n.cloud/webhook/gaming-news-rss'));
const API = flag('api', env('API_URL', 'http://localhost:4000')).replace(/\/$/, '');
const KEY = flag('key', env('ARTICLES_INGEST_API_KEY'));
const LIMIT = Number(flag('limit', '30'));
const DRY = has('dry-run');
const EXCLUDE = new Set(
  flag('exclude', env('RSS_EXCLUDE_CATEGORIES', 'Guides,Reviews'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
/**
 * Starost se NE filtrira podrazumevano: n8n feed vraća istih 30 stavki, pa bi
 * „samo sveže“ značilo da vesti koje se pojave u feedu posle sat vremena nikad
 * ne uđu. Deduplikaciju ionako radi server (`sourceUrl`). `--max-age=N` je tu
 * za ručno pokretanje kada želiš samo poslednjih N minuta; `0` = bez limita.
 */
const MAX_AGE_MIN = Number(flag('max-age', '0'));

/**
 * Pun tekst se vadi sa originalne stranice. Feed n8n-a nema `content:encoded`,
 * pa bez ovoga članak ima samo 1–2 rečenice opisa. `--no-scrape` = samo feed.
 */
const FULL_TEXT = !has('no-scrape');
/** 2.13.3 — AI prevod tela: `--no-ai` gasi, `--ai` uključuje uz upozorenje. */
const AI_TRANSLATE = !has('no-ai') && aiTranslationAvailable();
const MAX_PARAGRAPHS = Number(flag('paragraphs', '8'));
/** Pauza između zahteva ka istom sajtu (uljudnost / protiv 429). */
const SCRAPE_DELAY_MS = Number(flag('delay', '400'));

if (!DRY && !KEY) {
  console.error('Nedostaje ARTICLES_INGEST_API_KEY (server/.env ili --key=...).');
  process.exit(1);
}

/**
 * 2.13.6 — RANA PROVERA API-ja (bitno za cron!).
 *
 * Cron pokreće skriptu bez nadzora. Ako API nije pokrenut (localhost) ili URL
 * nije podešen, skripta bi inače potrošila vreme na skrejpovanje 30 stranica i
 * PA ONDA pala na svakom POST-u — plaćen AI prevod bi već bio obavljen.
 * Zato: jedan `HEAD /api/health` pre bilo kakvog rada.
 */
if (!DRY) {
  try {
    const health = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(8_000) });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (error) {
    console.error(
      `API nije dostupan na ${API} (${error.message}).\n` +
        'Pokreni server (`npm run server:dev`) ili postavi API_URL u server/.env.',
    );
    process.exit(1);
  }
}

if (AI_TRANSLATE) console.log(`AI prevod: uključen (${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'})`);

/* ------------------------------ RSS parsing ------------------------------ */

const decode = (value = '') =>
  String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const tag = (xml, name) => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]).trim() : '';
};
const attr = (xml, name, attrName) => {
  const match = xml.match(new RegExp(`<${name}\\s[^>]*${attrName}="([^"]*)"`));
  return match ? decode(match[1]).trim() : '';
};
const allTags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => decode(m[1]).trim());

/** Feed emituje GMT datum kao 15:46 po srednje-evropskom vremenu — svodimo na stvarni UTC. */
function parseDate(raw) {
  const match = String(raw).match(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date(raw);
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [, , day, mon, year, hh, mm, ss] = match;
  const dt = new Date(Date.UTC(+year, months[mon] ?? 0, +day, +hh, +mm, +ss));
  const offset = Number(flag('feed-offset', '60')); // GMT+1 (CET); u letnjem vremenu CEST = 120
  return new Date(dt.getTime() - offset * 60 * 1000);
}

const stripTags = (html) =>
  decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Reže na granici reči (max 150 za naslov, 300 za opis) — feed često pređe limit. */
const clip = (value, max) => {
  const text = String(value).trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`;
};

/** „[Polygon] Naslov“ → izvor `Polygon` (ime feed-a čuva se u `authorName`). */
const titleSource = (rawTitle) => rawTitle.match(/^\s*\[([^\]]+)\]\s*/)?.[1]?.trim() ?? '';

/**
 * 2.13.4 — naslovi iz nekih feedova dolaze skraćeni wildcardom.
 * „Magic The Gathering x Teenage Mutant Ninja T…“ izgleda kao greška na sajtu;
 * zato se takav naslov seče na POSLEDNJU CELU reč, bez „…“ (npr. „…Ninja Turtles“).
 */
const trimDanglingWord = (title) =>
  String(title)
    .replace(/\s*[…\.]{2,}$/, '')
    .replace(/[\s\-–:,(]+\b[A-Z]\b$/, '')
    .trim();

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------ Mapiranje ------------------------------ */

/**
 * Naslov: feed dodaje prefiks izvora „[Polygon] …“. Prefiks skidamo (izvor ide u
 * `authorName`) jer šema dozvoljava 150 karaktera, a sa prefiksom naslovi pucaju.
 */
function mapTitle(rawTitle, fallback) {
  const source = titleSource(rawTitle);
  const bare = rawTitle.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || rawTitle.trim() || fallback;
  // 2.13.4 — skrati na celoj reči i očisti zaostali „…“ (wildcard iz feeda).
  return { title: trimDanglingWord(clip(bare.trimEnd(), 150)), source };
}

/* --------------------- Kategorije i srpski tagovi --------------------- */
/*
 * 2.13.0 — PRAVILA ŽIVE U `news-rules.mjs`.
 * Isti modul koristi i `relabel-news.mjs` (reklasifikacija starih vesti), pa se
 * pravilo menja na JEDNOM mestu — uvoz i backfill ne mogu da se raziđu.
 */

/** Kategorija iz naslova/tela/tagova feeda. */
const mapCategory = ({ categories, title, description, content }) =>
  classifyArticle({ title, excerpt: description, content, tags: categories });

/** Srpski tagovi + brend iz naslova. */
const mapTags = (categories, title, category) => buildTags(categories, title, category);

/** Grupa događaja (njen naslov ide u `eventTitle`). */
const detectEventSafe = (title, categories, description) => detectEvent(title, categories, description);

/** „Zašto je bitno“ — rečenica ili `null` (bez izmišljanja). */
const whyItMattersSafe = (category, eventLabel) => whyItMatters(category, eventLabel);

/* ------------------------- Bolje slike (CDN) ------------------------- */

/**
 * Feed daje slike u veličini koju je sajt ostavio u RSS-u: Polygon/PC Gamer
 * često pošalju 640–800px, Eurogamer još i `?width=690`, pa naslovna izgleda
 * mutno. CDN-ovi prihvataju parametre veličine — tražimo 1600px.
 */
function upscaleImage(url) {
  if (!url.startsWith('https://')) return '';
  // WordPress (Polygon, Kotaku, GameSpot): `?w=640` → `?w=1600`; `-1024x576` → original.
  if (/polygonimages\.com|kotaku\.com\/app\/uploads|gamespot\.com\/a\/uploads/.test(url)) {
    if (/\?/.test(url)) return url.replace(/([?&])w=\d+/, '$1w=1600');
    return url.replace(/-(\d{2,4})x(\d{2,4})(\.(?:jpe?g|png|webp))/i, '$3');
  }
  // Future plc (PC Gamer, GamesRadar, TechRadar): `…-1920-80.jpg` = 1920w, quality 80.
  if (/futurecdn\.net/.test(url)) {
    const base = url.replace(/-\d{3,4}-\d{2}(\.(?:jpe?g|png|webp))/i, '-1920-100$1');
    return base;
  }
  // Eurogamer / Gamer Network (`?width=690&quality=85&format=jpg`).
  if (/assetsio\.gnwcdn\.com|eurogamer\.net/.test(url)) {
    return url.replace(/([?&])width=\d+/, '$1width=1600').replace(/([?&])quality=\d+/, '$1quality=90');
  }
  // IGN: `assets-prd.ignimgs.com` prima `?width=`.
  if (/ignimgs\.com/.test(url)) {
    return url.includes('?') ? `${url}&width=1600` : `${url}?width=1600`;
  }
  return url;
}

/* ------------------------- Pun tekst sa izvora ------------------------- */

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9,sr;q=0.8',
};

/** Tekst od 200+ znakova sa nekoliko rečenica je verovatno telo članka. */
const looksLikeArticle = (text) => (text.match(/[.!?]\s/g) ?? []).length >= 2 && text.length >= 200;

/** Blokovi koji nikad nisu deo teksta vesti (reklame, komentari, newsletter). */
const JUNK =
  /comment|newsletter|sign[- ]?up|subscribe|related|promo|advert|ad-slot|sponsored|share|social|podcast|read more|most popular|trending|outbrain|taboola|recirc|breadcrumb|caption|byline|contributor|privacy policy|terms & |cookies?|consent|gdpr|biometric|inbox|keep exploring|collect badges|handpicked|register|your information/i;

/**
 * 2.13.4 — SADRŽAJ SAM PO SEBI, ne okolni boilerplate.
 *
 * PC Gamer/GamesRadar ubacuju paragrafe o privatnosti, newsletteru i značkama
 * u isti DOM; filter po `class`-u ih ne uhvati (nema „newsletter“ u klasi).
 * Zato se pasus odbacuje i kada njegov TEKST zvuči kao pravni/newsletter blok.
 */
const BOILERPLATE_TEXT =
  /(by submitting your information|privacy policy|terms (?:&|and) conditions|geographical rules|keep exploring|collect badges|earn badges|delivered to your inbox|you can turn them off|handpicked|cookie|subscribe to|sign up for|already a member)/i;

const isContentParagraph = (text) => text.length >= 60 && !BOILERPLATE_TEXT.test(text);

/**
 * Povlači originalnu stranicu i vadi: pravi datum objave, veću sliku i telo.
 * RSS feed n8n-a nema `content:encoded`, pa je opis od 1–2 rečenice sve što bi
 * inače otišlo na portal. Greška (403/404/timeout) NIKAD ne obara uvoz —
 * tada ostaje ono što feed daje.
 */
async function fetchSourcePage(url) {
  if (!/^https:\/\/[^\s]+$/.test(url)) return null;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    if (!res.ok) return null;
    const html = await res.text();

    const publishedAt =
      (html.match(/"datePublished"\s*:\s*"([^"]+)"/) ?? [])[1] ||
      (html.match(/property="article:published_time"\s+content="([^"]+)"/) ?? [])[1] ||
      '';
    const ogImage = decode(
      (html.match(/property="og:image"\s+content="([^"]+)"/) ?? [])[1] ||
        (html.match(/content="([^"]+)"\s+property="og:image"/) ?? [])[1] ||
        '',
    );

    /**
     * 2.13.1 — TELO SE VADI U TRI KORAKA (sve više agresivno):
     *
     * 1. `<p>` unutar `articleBody`/`article` (JSON-LD) — najčistije;
     * 2. svi `<p>` van navigacije/futera/reklama — radi na 90% sajtova;
     * 3. div-blokovi koji liče na pasus — za sajtove koji ne koriste `<p>`
     *    (npr. neki WordPress templejti, Polygon `duet--article--…`).
     *
     * Ranije je korak 3 nedostajao, pa su neke vesti dobĳale samo 1–2 pasusa.
     */
    const cleanText = (raw) =>
      decode(raw.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();

    const scrapeParagraphs = (fragment) =>
      [...fragment.matchAll(/<p(?:\s[^>]*)?>([\s\S]{25,2000}?)<\/p>/gi)]
        .filter((m) => !JUNK.test(m[0].slice(0, 300)))
        .map((m) => cleanText(m[1]))
        // 2.13.4 — odbaci pravni/newsletter tekst čak i kad nema „newsletter“ u klasi.
        .filter(isContentParagraph)
        .filter((t, index, all) => all.indexOf(t) === index);

    // Korak 1: JSON-LD `articleBody` (najtačniji, ali nije na svim sajtovima).
    const jsonLdBody = [...html.matchAll(/"articleBody"\s*:\s*"([\s\S]{200,40000}?)"\s*[,}]/g)]
      .map((m) => m[1].replace(/\\n{2,}/g, '\n\n').replace(/\\"/g, '"').replace(/\\u0026/g, '&'))
      .filter((body) => looksLikeArticle(body))
      .sort((a, b) => b.length - a.length)[0];
    let paragraphs = jsonLdBody
      ? jsonLdBody
          .split(/\n{2,}/)
          .map((block) => cleanText(block))
          .filter(isContentParagraph)
          .slice(0, 20)
      : [];

    /**
     * 2.13.4 — KORAK 2 SAMO KADA NEMA JSON-LD TELA.
     *
     * Ranije se korak 2 puštao i kad JSON-LD ima telo, a „ako je duže — uzmi“
     * je ubacivalo newsletter/pravne pasuse sa cele stranice umesto vesti.
     * Sada: JSON-LD telo je prioritet; cela stranica je rezerva. Kada se ipak
     * koristi, zadržavaju se samo pasusi DUŽI od prosečnog (boilerplate je kratak).
     */
    if (paragraphs.length === 0) {
      const mainOnly = html
        .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<div[^>]*(ad-slot|advert|newsletter|related|promo|newsletter-signup)[^>]*>[\s\S]*?<\/div>/gi, ' ');
      paragraphs = scrapeParagraphs(mainOnly);
    }

    // Korak 3: div-blokovi (kada `<p>` nema) — samo oni duži od pasusa.
    if (paragraphs.length < 2) {
      const divBlocks = [...html.matchAll(/<div[^>]*class="[^"]*(article|content|body|text|s-content)[^"]*"[^>]*>([\s\S]{120,6000}?)<\/div>/gi)]
        .map((m) => cleanText(m[2]))
        .filter((t) => t.length >= 120 && !JUNK.test(t.slice(0, 200)))
        .filter((t, index, all) => all.indexOf(t) === index);
      if (divBlocks.length > paragraphs.length) paragraphs = divBlocks;
    }

    /**
     * Zadrži samo pasuse duže od 60% proseka — vesti imaju ujednačenu dužinu,
     * a reklame/navigacija su kratke. Nikad ne skrati ispod 3 pasusa.
     */
    if (paragraphs.length >= 5) {
      const lengths = paragraphs.map((p) => p.length).sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      const filtered = paragraphs.filter((p) => p.length >= median * 0.6);
      if (filtered.length >= 3) paragraphs = filtered;
    }

    paragraphs = paragraphs.slice(0, 14);

    return { publishedAt, ogImage, paragraphs };
  } catch {
    return null;
  }
}

/**
 * Telо članka: SRPSKI sažetak gore, original ISPOD u označenom bloku.
 *
 * 2.13.1 — ranije je telo bilo engleski tekst bez oznake jezika, ili go link
 * na izvor. Sada: sažetak iz feeda (n8n ga prevodi) vodi članak, a original
 * sledi kao citat izvora — čitalac uvek zna šta je naše, a šta nije.
 * Ako je original već na srpskom, blok se ne dodaje (nema dvostrukog teksta).
 */
async function buildContent({ feedBody, feedText, source, title, link, sourceName, maxParagraphs }) {
  const paragraphs = source?.paragraphs?.slice(0, maxParagraphs) ?? [];
  const originalText = paragraphs.length
    ? paragraphs.join('\n\n')
    : feedBody.includes('<') && stripTags(feedBody).length >= 20
      ? stripTags(feedBody)
      : '';

  /**
   * 2.13.3 — AI PREVOD (opciono, Gemini).
   *
   * Kada je ključ podešen, telo se prevodi na srpski i ide kao NAŠ tekst, bez
   * bloka „Original“. Kada nije (ili model padne), ostaje dvostruko telo:
   * srpski sažetak + označen original. Uvoz se nikad ne prekida zbog prevoda.
   */
  if (originalText && !looksSerbian(originalText) && AI_TRANSLATE) {
    const { text: translated, translated: ok } = await translateWithAI(originalText);
    if (ok) {
      /**
       * 2.13.5 — KRATAK TEKST SE DOPUNJUJE.
       * Izvor katkad daje samo 2–3 rečenice (kratka objava), pa članak deluje
       * prazno. Model pravi sažetak od 3–4 rečenice ISKLJUČIVO iz tog teksta;
       * ako previše „napiše“, `expandShortText` odbija rezultat i ostaje original.
       */
      const { text: expanded } = await expandShortText({ title, text: translated });
      const html = expanded
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => (block.startsWith('<') ? block : `<p>${escapeHtml(block)}</p>`))
        .join('');
      // Link na izvor se dodaje kao JEDAN pasus na kraju (model ga ne kopira).
      return `${html}<p><a href="${escapeHtml(link)}" rel="nofollow noopener noreferrer" target="_blank">Pročitaj ceo tekst na ${escapeHtml(sourceName || 'izvoru')}</a></p>`.slice(
        0,
        50_000,
      );
    }
  }

  // Sažetak iz feeda može biti na engleskom (n8n prevodi samo naslove) — tada
  // ga NE stavljamo iznad kao „naš“ tekst; vodi ga prva ključna rečenica.
  const summaryIsSerbian = looksSerbian(feedText);
  const lead = summaryIsSerbian ? feedText : (paragraphs[0] ?? feedText);

  return buildBilingualBody({
    excerpt: lead,
    // Original ide ispod samo ako nije isti tekst kao lead.
    original: originalText === lead ? '' : originalText,
    originalIsSerbian: looksSerbian(originalText),
    sourceName: sourceName || title,
    link,
  });
}

async function toArticle(item) {
  const rawTitle = tag(item, 'title');
  const link = tag(item, 'link') || tag(item, 'guid');
  const categories = allTags(item, 'category');
  const description = tag(item, 'description');
  const body = tag(item, 'content:encoded') || description;
  const feedImage =
    attr(item, 'enclosure', 'url') ||
    attr(item, 'media:thumbnail', 'url') ||
    attr(item, 'media:content', 'url') ||
    (body.match(/<img[^>]+src="([^"]+)"/i) ?? [])[1] ||
    '';

  const feedText = stripTags(description || body);
  const { title: rawCleanTitle, source: sourceName } = mapTitle(rawTitle || feedText, link);

  /**
   * 2.13.3 — NASLOV SE PREVODI AKO NIJE SRPSKI.
   *
   * n8n prevodi samo NEKE naslove (mešovito: „OSVRT: …“ pored „Street Fighter V
   * temporarily delisted“), pa bi sajt imao pola srpskih, pola engleskih naslova.
   * Kada je AI uključen, engleski naslov ide kroz isti model — kratak je (jedan
   * poziv je jeftiniji od tela), a keš znači da se isti naslov nikad ne plaća dvaput.
   */
  let title = rawCleanTitle;
  if (!looksSerbian(title)) {
    let translatedTitle = null;
    if (AI_TRANSLATE) {
      const result = await translateWithAI(title, { maxChars: 400, kind: 'title' });
      if (result.translated) translatedTitle = result.text;
    }
    /**
     * 2.13.4 — AI je prvi izbor, deterministički prevod je mreža ispod.
     * Model povremeno vrati isti naslov (ne greška, samo ne prevede) — tada
     * bolje poluprevod sa srpskim rečima nego ceo naslov na engleskom.
     */
    if (!translatedTitle) translatedTitle = translateTitleFallback(title);
    if (translatedTitle) title = trimDanglingWord(clip(translatedTitle.replace(/^["„']|["“']$/g, ''), 150));
  }

  // Pun tekst + bolja slika sa originalne stranice (osim uz --no-scrape).
  const source = FULL_TEXT ? await fetchSourcePage(link) : null;
  const image = upscaleImage(source?.ogImage || '') || upscaleImage(feedImage);

  const content = await buildContent({
    feedBody: body,
    feedText,
    source,
    title,
    link,
    sourceName,
    maxParagraphs: MAX_PARAGRAPHS,
  });

  /**
   * 2.13.0 — kategorija/tagovi iz SADRŽAJA (ne iz `News/Games` tagova feeda).
   * 2.13.5 — pravila prvo; ako padne na „Vesti“, pita se AI (isti model koji je
   * već prevodio, pa nema novog provajdera ni podešavanja).
   */
  let category = mapCategory({ categories, title, description: feedText, content });
  if (AI_TRANSLATE && category === 'Vesti') {
    const aiCategory = await classifyWithAI({ title, excerpt: feedText, content });
    if (aiCategory) category = aiCategory;
  }

  const event = detectEventSafe(title, categories, feedText);

  return {
    payload: {
      title,
      content,
      excerpt: clip(feedText || '', 300),
      category,
      tags: mapTags(categories, title, category),
      coverImage: image || undefined,
      sourceUrl: link,
      authorName: sourceName || undefined,
      // 2.13.0 — grupa događaja i kratko „zašto je bitno“.
      eventId: event?.id,
      eventTitle: event?.title,
      newsSource: sourceName || undefined,
      whyItMatters: whyItMattersSafe(category, event?.title) || undefined,
    },
    categories,
    category,
    eventId: event?.id || '',
    publishedAt: source?.publishedAt || '',
    paragraphs: source?.paragraphs?.length ?? 0,
    keySentences: source?.paragraphs?.length ? extractKeySentences(source.paragraphs.join(' '), 2) : [],
  };
}

/* -------------------------------- Main -------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 2.13.0 — RETRY sa backoff-om.
 * Feed (n8n cloud) i izvori povremeno vrate 502/429/timeout. Bez retry-a jedna
 * mrežna stihija = propuštena vest (i ponovo se čeka ceo ciklus).
 */
async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, options);
      // 429/5xx su prolazni; 4xx (osim 429) ne ponavljamo — nema smisla.
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(attempt * 1500);
  }
  throw lastError ?? new Error('fetch failed');
}

/* ---------------- 2.13.0 — INKREMENTALNI UVOZ (`--since`) ---------------- */

/** Stanje zadnjeg uspešnog uvoza — da cron ne šalje istih 30 stavki svaki put. */
const STATE_FILE = resolve(process.cwd(), env('RSS_STATE_FILE', '.rss-state.json'));

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    /* stanje nije kritično — sledeći run će ponovo proveriti sve */
  }
}

const state = readState();
/**
 * `--since=30m|6h|2026-10-27T10:00Z` ili `RSS_SINCE`.
 * Bez vrednosti se koristi vreme zadnjeg uspešnog uvoza iz `.rss-state.json`
 * (pomak 10 min preko toga, da se ne propuste vesti objavljene u međuvremenu).
 * `--since=0` / `--full` isključuje inkrementalni režim.
 */
function resolveSince() {
  const explicit = flag('since', env('RSS_SINCE', ''));
  if (has('full') || explicit === '0') return null;
  if (explicit) {
    const relative = explicit.match(/^(\d+)\s*(m|min|h|d)$/i);
    if (relative) {
      const unit = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2].toLowerCase()];
      return Date.now() - Number(relative[1]) * unit;
    }
    const parsed = Date.parse(explicit);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return state.lastRunAt ? Date.parse(state.lastRunAt) - 10 * 60_000 : null;
}

const SINCE_MS = resolveSince();

const response = await fetchWithRetry(FEED, { headers: { accept: 'application/rss+xml, application/xml' } });
if (!response.ok) {
  console.error(`Feed ${FEED} → HTTP ${response.status}`);
  process.exit(1);
}
const xml = await response.text();
const allItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

// Inkrementalno: preskačemo stare stavke PRE skrejpovanja (osnova uštede vremena).
const items = allItems
  .filter((item) => {
    if (!SINCE_MS) return true;
    const published = parseDate(tag(item, 'pubDate')).getTime();
    return !Number.isNaN(published) && published >= SINCE_MS;
  })
  .slice(0, LIMIT);

const now = Date.now();
const stats = { sent: 0, duplicate: 0, skipped: 0, failed: 0, quality: [] };
const runStartedAt = new Date(now).toISOString();
const perSource = {};

console.log(
  `Feed: ${allItems.length} stavki` +
    (SINCE_MS ? `, ${items.length} novijih od ${new Date(SINCE_MS).toLocaleString('sr-Latn-RS')}` : ` → ${items.length}`) +
    ` → ${API}${DRY ? ' (dry-run)' : ''}`,
);

const lastHit = new Map();

for (const item of items) {
  // Pauza po domenu: 8 stavki sa Polygon-a u nizu je za njihov CDN „bot napad“.
  const host = (tag(item, 'link').match(/^https:\/\/([^/]+)/) ?? [])[1] ?? '';
  const wait = SCRAPE_DELAY_MS - (Date.now() - (lastHit.get(host) ?? 0));
  if (FULL_TEXT && wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const { payload, categories, publishedAt, paragraphs } = await toArticle(item);
  const feedPublished = parseDate(tag(item, 'pubDate'));
  // Pravi datum objave sa izvora je tačniji od onog u feedu (feed ga pomera).
  const published = publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Date(publishedAt) : feedPublished;
  const ageMin = (now - published.getTime()) / 60_000;

  if (EXCLUDE.size && categories.some((c) => EXCLUDE.has(c.toLowerCase()))) {
    stats.skipped += 1;
    console.log(`skip (kategorija ${categories.join('/')})  ${payload.title.slice(0, 70)}`);
    continue;
  }
  if (!payload.sourceUrl.startsWith('https://') || payload.title.length < 3) {
    stats.skipped += 1;
    console.log(`skip (nema https link / kratak naslov)  ${payload.title.slice(0, 70)}`);
    continue;
  }
  if (ageMin < -10 || (MAX_AGE_MIN > 0 && ageMin > MAX_AGE_MIN)) {
    stats.skipped += 1;
    console.log(`skip (star ${Math.round(ageMin)} min)  ${payload.title.slice(0, 70)}`);
    continue;
  }

  if (DRY) {
    stats.sent += 1;
    console.log(`would send [${payload.category}] ${payload.title.slice(0, 80)}`);
    continue;
  }

  const bucket = (perSource[payload.authorName ?? 'nepoznat'] ??= { sent: 0, duplicate: 0, failed: 0 });

  /**
   * 2.13.1 — KVALITET UVEZA po vesti: bez slike, bez teksta (samo link),
   * nepoznata kategorija. Ovo su stvarni problemi koje korisnik vidi na sajtu,
   * a ne u brojaču „Novo: N“.
   */
  const qualityFlags = [];
  if (!payload.coverImage) qualityFlags.push('bez slike');
  if ((payload.content.length ?? 0) < 400) qualityFlags.push('kratak tekst');
  if (payload.category === 'Vesti' && !payload.eventId) qualityFlags.push('nema žanr');
  if (payload.content.includes('Original (engleski)')) qualityFlags.push('engleski original');
  if (qualityFlags.length) stats.quality.push({ title: payload.title, flags: qualityFlags });

  try {
    const res = await fetchWithRetry(`${API}/api/articles/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': KEY },
      // `publishedAt` opciono: server ga koristi ako je u prošlosti (tačan datum izvora).
      body: JSON.stringify({ ...payload, publishedAt: publishedAt || undefined }),
    }, 2);
    const data = await res.json().catch(() => ({}));
    if (res.status === 201) {
      stats.sent += 1;
      bucket.sent += 1;
      const size = `${payload.content.length} znakova, ${paragraphs} pasusa`;
      const group = payload.eventId ? ` ⟨${payload.eventId}⟩` : '';
      console.log(`✓ [${payload.category}] [${size}]${group} ${payload.title.slice(0, 62)} → /article/${data.slug}`);
    } else if (res.status === 200 && data.duplicate) {
      stats.duplicate += 1;
      bucket.duplicate += 1;
      console.log(`= duplikat  ${payload.title.slice(0, 70)}`);
    } else {
      stats.failed += 1;
      bucket.failed += 1;
      console.log(`✗ HTTP ${res.status}  ${data.error ?? ''}  ${payload.title.slice(0, 60)}`);

      if (res.status === 401 || res.status === 503) break; // ključ/config — dalje nema smisla
    }
  } catch (error) {
    stats.failed += 1;
    bucket.failed += 1;
    console.log(`✗ ${error.message}  ${payload.title.slice(0, 60)}`);
  }
}

/* ------------------- 2.13.0 — IZVEŠTAJ O UVOZU ------------------- */

console.log(`\nPo izvoru:`);
for (const [source, counts] of Object.entries(perSource).sort((a, b) => b[1].sent - a[1].sent)) {
  console.log(`  ${source.padEnd(22)} novo ${String(counts.sent).padStart(2)} · duplikati ${String(counts.duplicate).padStart(2)} · greške ${counts.failed}`);
}

/* 2.13.1 — KVALITET: šta bi korisnik odmah primetio na sajtu. */
if (stats.quality.length && !DRY) {
  console.log(`\nKvalitet (${stats.quality.length} vesti):`);
  const byFlag = {};
  for (const item of stats.quality) for (const flag of item.flags) byFlag[flag] = (byFlag[flag] ?? 0) + 1;
  console.log(`  ${Object.entries(byFlag).map(([flag, count]) => `${flag}: ${count}`).join(' · ')}`);
  stats.quality.slice(0, 8).forEach((item) => console.log(`  - [${item.flags.join(', ')}] ${item.title.slice(0, 60)}`));
}

/* 2.13.3 — AI prevod: koliko je prevedeno i koliko je koštalo. */
if (AI_TRANSLATE) {
  const report = translationReport();
  console.log(
    `\nAI prevod: ${report.calls} poziva · ${report.cached} iz keša · ${report.failed} neuspeha` +
      ` · ${report.tokensIn + report.tokensOut} tokena · ~$${report.estimatedCostUsd.toFixed(4)}`,
  );
  saveCache();
}

console.log(
  `\nNovo: ${stats.sent} · Duplikati: ${stats.duplicate} · Preskočeno: ${stats.skipped} · Greške: ${stats.failed}` +
    `${FULL_TEXT ? '' : ' · pun tekst isključen (--no-scrape)'}`,
);

// Stanje se pamti samo ako run nije imao greške — inače sledeći prolaz ponavlja.
if (!DRY && stats.failed === 0) {
  writeState({
    lastRunAt: runStartedAt,
    lastRunStats: { sent: stats.sent, duplicate: stats.duplicate, failed: stats.failed },
    qualityFlags: stats.quality.reduce((acc, item) => {
      for (const flag of item.flags) acc[flag] = (acc[flag] ?? 0) + 1;
      return acc;
    }, {}),
    feed: FEED,
  });
}

// Ne-nula izlazni kod da cron/monitoring vidi problem.
if (stats.failed > 0) process.exitCode = 1;

