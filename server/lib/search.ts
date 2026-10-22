/**
 * PRETRAGA (2.6.2) — jedan ulaz za članke, teme i deal-ove
 * -------------------------------------------------------
 * `GET /api/search?q=&type=all|articles|threads|deals&limit=`
 *
 * U Supabase režimu koristi RPC funkcije iz `schema-ALL.sql`:
 * `pg_trgm` (`similarity`, `%`) toleriše greške u kucanju, `ILIKE` pokriva
 * delove reči, a `search_snippet()` daje kratak opis bez HTML-a. Rezultati se
 * spajaju u jednu listu sortiranu po `rank`-u.
 *
 * SLOJEVI RANGIRANJA (2.6.2)
 * ---------------------------
 *  1. `pg_trgm` + `ILIKE` — delimične reči i greške u kucanju (uvek dostupno),
 *  2. `tsvector`/`tsquery` sa `simple` (ne zavisi od verzije Postgresa) —
 *     normalizovani oblici reči preko `foldSrpski()` + `stemSrpski()`; vektor
 *     se pravi ručno (`array_to_tsvector`), pa nema zavisnosti od `unaccent`
 *     ili Snowball stemmera (vidi `schema-ALL.sql`, sekcija 2.6.2).
 *
 * Bez migracija (ili u memory režimu) radi **isti ugovor** preko ILIKE
 * pretrage. Zato klijent nikad ne dobija 500 zbog nedostajuće migracije.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from './store.js';
import { logger } from './logger.js';
import { isMissingSchemaError } from './presence.js';

export type SearchType = 'all' | 'articles' | 'threads' | 'deals';

export interface SearchHit {
  type: 'article' | 'thread' | 'deal';
  id: string;
  title: string;
  snippet: string;
  href: string;
  /** Kategorija / subforum / prodavnica — za značku na kartici. */
  meta?: string | null;
  image?: string | null;
  /** Sekundarna informacija: cena za deal, broj odgovora za temu. */
  extra?: string | null;
  createdAt: string;
  rank: number;
}

/** Query mora imati bar 2 znaka — trigram ispod toga nema smisla i skup je. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Tsvector konfiguracija. Podrazumevano `simple` — normalizaciju radi
 * `search_doc()` u bazi, pa nam konfiguracija sa `unaccent`/Snowball nije
 * potrebna. Menja se env-om (`SEARCH_TS_CONFIG`), bez izmena koda.
 */
export const TS_CONFIG = (process.env.SEARCH_TS_CONFIG ?? 'simple').trim() || 'simple';

/**
 * SRPSKA NORMALIZACIJA — ogledalo `unaccent` ekstenzije.
 * „Člаnci“, „članci“ i „Clanci“ moraju dati ISTU reč, jer `to_tsvector` radi
 * malim slovima i skida dijakritike. Isti tabela je i u JS fallback-u, pa se
 * memory režim i baza ponašaju jednako.
 */
const FOLD_MAP: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj', 'е': 'e', 'ж': 'z',
  'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n',
  'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's',
};

export function foldSrpski(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/č|ć/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'dj')
    // Ćirilica → latinica (čitaoci i dalje kucaju ćirilicom).
    .replace(/[\u0400-\u04FF]/g, (char) => FOLD_MAP[char] ?? char)
    // Isto što radi `unaccent`: skini sve što nije ASCII slovo/cifra (i crta
    // unutar reči ostaje razmakom, kao granica reči u `fold_srpski()`).
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LAKI SRPSKI STEMER (samo za fallback i za `simple` tsquery).
 *
 * Nije lingvistički potpun (za to služi `unaccent_srpski` iz SQL migracije):
 * skida najčešće padežne nastavke sa dovoljno dugih reči (od 5 znakova, a
 * koren ostaje bar 3), pa „igrama“ daje koren „igr“, a „popusta“/„popustima“
 * „popust“. Kraće reči („igre“, „sata“) se ne diraju — sečenje jednog znaka
 * bi dalo besmislen koren tipa „sa“.
 *
 * VAŽNO: JS i SQL (`stem_srpski()` u migraciji) moraju davati isti koren —
 * zato je lista nastavaka i prag dužine ista na oba mesta.
 */
const SUFFIXES = [
  'ovima', 'evima', 'anje', 'enje', 'ijma', 'ama', 'ima', 'ovi', 'evi', 'ija', 'ije',
  'ati', 'iti', 'eti', 'uti', 'ila', 'ile', 'ilo', 'ili', 'ala', 'ale', 'alo', 'ali',
  'om', 'em', 'im', 'ih', 'og', 'eg', 'oj', 'ej', 'ao', 'eo', 'io', 'uo',
  // Jednoslovni padežni nastavci: samo za reči koje ostavljaju koren ≥ 3
  // („popusta“ → „popust“, a „sata“ → „sata“ jer bi koren bio „sat“ = 3 …
  // zato je prag 6 za jednoslovne nastavke, vidi `MIN_STEM_BASE`).
  'a', 'e', 'i', 'o', 'u',
];

/**
 * Jednoslovni nastavci se skidaju samo ako reč ima bar 6 znakova — inače se
 * pravi koren od 3-5 znakova udara u nepovezane reči („sata“ → „sat“ je OK,
 * ali „mesta“ → „mest“ bi uhvatilo i „mesto“; zadržavamo konzervativno).
 * JS i SQL dele isti prag.
 */
export const MIN_STEM_BASE = 6;

/** Minimalna dužina reči koja se uopšte seče; kraća od toga se vraća kakva jeste. */
export const STEM_MIN_LENGTH = 5;

export function stemSrpski(word: string): string {
  const w = String(word ?? '').toLowerCase();
  if (w.length < STEM_MIN_LENGTH) return w;
  for (const suffix of SUFFIXES) {
    if (w.length < MIN_STEM_BASE && suffix.length === 1) continue;
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

/**
 * Bezbedan `websearch_to_tsquery` ulaz: navodnici i operatori (`&`, `|`, `!`,
 * `:`) bi promenili semantiku upita — svode se na razmak, pa svaka reč mora
 * da postoji (AND), kao što se korisnik i nada.
 */
export function sanitizeTsQuery(raw: string): string {
  return String(raw ?? '')
    .replace(/[&|!():*<>'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length >= MIN_QUERY_LENGTH)
    .map((token) => foldSrpski(token) || token)
    .join(' ');
}

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (db.kind !== 'supabase') return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** HTML → čist tekst za snippet; tako se „<p>Sniženje…“ ne vraća klijentu. */
export function plainText(html: string | null | undefined, max = 200): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Rang za fallback — ista težina kao SQL (`title` je najvažniji). */
function fallbackRank(title: string, body: string, term: string): number {
  const t = foldSrpski(title);
  const b = foldSrpski(body);
  const q = foldSrpski(term);
  let rank = 0;
  if (t === q) rank += 10;
  if (t.includes(q)) rank += 5;
  if (b.includes(q)) rank += 1;
  // 2.6.2 — poređenje po korenu: „igre“ pogađa „igra“ (vidi `stemSrpski`).
  const stem = stemSrpski(q);
  if (stem.length >= 3) {
    if (stemSrpski(t).includes(stem)) rank += 3;
    else if (stemSrpski(b).includes(stem)) rank += 0.5;
  }
  return rank;
}

const priceLabel = (price: number, currency: string) =>
  `${price.toFixed(2).replace('.', ',')} ${currency}`;

// =====================
// RPC (Supabase)
// =====================

async function rpcArticles(term: string, limit: number): Promise<SearchHit[]> {
  const supabaseClient = supabase();
  if (!supabaseClient) return searchArticlesFallback(term, limit);
  const { data, error } = await supabaseClient.rpc('search_articles', {
    query: term,
    ts_query: sanitizeTsQuery(term),
    ts_config: TS_CONFIG,
    max_results: limit,
  });
  if (error) {
    if (!isMissingSchemaError(error)) logger.warn({ err: error }, 'search_articles_rpc_failed');
    return searchArticlesFallback(term, limit);
  }
  return (data ?? []).map((row: any) => ({
    type: 'article' as const,
    id: row.id,
    title: row.title,
    snippet: plainText(row.snippet),
    href: `/article/${row.slug}`,
    meta: row.category ?? null,
    image: row.cover_image || null,
    createdAt: row.created_at,
    rank: Number(row.rank) || 0,
  }));
}

async function rpcThreads(term: string, limit: number): Promise<SearchHit[]> {
  const supabaseClient = supabase();
  if (!supabaseClient) return searchThreadsFallback(term, limit);
  const { data, error } = await supabaseClient.rpc('search_threads', {
    query: term,
    ts_query: sanitizeTsQuery(term),
    ts_config: TS_CONFIG,
    max_results: limit,
  });
  if (error) {
    if (!isMissingSchemaError(error)) logger.warn({ err: error }, 'search_threads_rpc_failed');
    return searchThreadsFallback(term, limit);
  }
  return (data ?? []).map((row: any) => ({
    type: 'thread' as const,
    id: row.id,
    title: row.title,
    snippet: plainText(row.snippet),
    href: `/thread/${row.id}`,
    meta: row.subforum ? row.subforum : null,
    extra: row.replies ? `${row.replies} odgovora` : null,
    createdAt: row.created_at,
    rank: Number(row.rank) || 0,
  }));
}

async function rpcDeals(term: string, limit: number): Promise<SearchHit[]> {
  const supabaseClient = supabase();
  if (!supabaseClient) return searchDealsFallback(term, limit);
  const { data, error } = await supabaseClient.rpc('search_deals', {
    query: term,
    ts_query: sanitizeTsQuery(term),
    ts_config: TS_CONFIG,
    max_results: limit,
  });
  if (error) {
    if (!isMissingSchemaError(error)) logger.warn({ err: error }, 'search_deals_rpc_failed');
    return searchDealsFallback(term, limit);
  }
  return (data ?? []).map((row: any) => ({
    type: 'deal' as const,
    id: row.id,
    title: row.title,
    snippet: plainText(row.store ?? ''),
    href: `/deals/${row.id}`,
    meta: row.store ?? null,
    extra: row.currency ? priceLabel(Number(row.price ?? 0), row.currency) : null,
    createdAt: row.created_at,
    rank: Number(row.rank) || 0,
  }));
}

// =====================
// Fallback (memory / bez migracije)
// =====================

export async function searchArticlesFallback(term: string, limit: number): Promise<SearchHit[]> {
  const articles = await db.articles.findAll({ status: 'published' });
  return articles
    .map((article) => ({
      article,
      rank: fallbackRank(article.title, `${article.excerpt} ${plainText(article.content, 5000)}`, term),
    }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || new Date(b.article.publishedAt ?? b.article.createdAt).getTime() - new Date(a.article.publishedAt ?? a.article.createdAt).getTime())
    .slice(0, limit)
    .map(({ article, rank }) => ({
      type: 'article' as const,
      id: article.id,
      title: article.title,
      snippet: plainText(article.excerpt || article.content),
      href: `/article/${article.slug}`,
      meta: article.category ?? null,
      image: article.coverImage || null,
      createdAt: article.publishedAt ?? article.createdAt,
      rank,
    }));
}

export async function searchThreadsFallback(term: string, limit: number): Promise<SearchHit[]> {
  // Repo vraća niz (ne `{ threads }`) — `search` filtrira po naslovu/sadržaju,
  // ali ovde nam treba rang, pa uzimamo širu stranu i rangiramo sami.
  const threads = await db.forum.listThreads({ limit: 200, offset: 0, sort: 'hot' });
  return threads
    .map((thread) => ({ thread, rank: fallbackRank(thread.title, plainText(thread.content, 5000), term) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || new Date(b.thread.createdAt).getTime() - new Date(a.thread.createdAt).getTime())
    .slice(0, limit)
    .map(({ thread, rank }) => ({
      type: 'thread' as const,
      id: thread.id,
      title: thread.title,
      snippet: plainText(thread.content),
      href: `/thread/${thread.id}`,
      meta: thread.subforum ?? null,
      extra: thread.replies ? `${thread.replies} odgovora` : null,
      createdAt: thread.createdAt,
      rank,
    }));
}

export async function searchDealsFallback(term: string, limit: number): Promise<SearchHit[]> {
  const { deals } = await db.deals.list({ limit: 200, offset: 0, sort: 'newest' });
  return deals
    .filter((deal) => deal.status === 'active')
    .map((deal) => ({ deal, rank: fallbackRank(deal.title, `${deal.description ?? ''} ${deal.store}`, term) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || new Date(b.deal.createdAt).getTime() - new Date(a.deal.createdAt).getTime())
    .slice(0, limit)
    .map(({ deal, rank }) => ({
      type: 'deal' as const,
      id: deal.id,
      title: deal.title,
      snippet: deal.store,
      href: `/deals/${deal.id}`,
      meta: deal.gameTitle ?? deal.store,
      image: deal.gameCover ?? null,
      extra: priceLabel(deal.price, deal.currency),
      createdAt: deal.createdAt,
      rank,
    }));
}

// =====================
// Javni ulaz
// =====================

export interface SearchOptions {
  q: string;
  type?: SearchType;
  /** Po tipu (ukupno najviše 3×); ruta sabira i seče. */
  limit?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** „Da li ste mislili…“ — samo kada pretraga nije dala ni jedan pogodak. */
  suggestion: string | null;
}

/**
 * Sugestija za prazan rezultat.
 *
 * Supabase: RPC `search_suggest` (trigram po rečniku naslova iz
 * `schema-ALL.sql`). Bez nje (ili u memory režimu) koristi se
 * lokalna lista reči iz naslova — ista ideja, bez indeksa.
 */
export async function suggestFor(q: string): Promise<string | null> {
  const term = foldSrpski(String(q ?? '').trim().slice(0, 60));
  if (term.length < 3) return null;

  const supabaseClient = supabase();
  if (supabaseClient) {
    const { data, error } = await supabaseClient.rpc('search_suggest', { query: term, max_results: 1 });
    if (!error) {
      const suggestion = (data ?? [])[0]?.suggestion;
      return suggestion && suggestion !== term ? String(suggestion) : null;
    }
    if (!isMissingSchemaError(error)) logger.warn({ err: error }, 'search_suggest_rpc_failed');
  }

  // Fallback: reči iz naslova (set) — trigram „grubo“ preko zajedničkih
  // delova reči (prefiks/sufiks), bez prave trigram matematike.
  const words = new Set<string>();
  const collect = (title: string) => {
    for (const word of foldSrpski(title).split(' ')) if (word.length >= 3) words.add(stemSrpski(word));
  };
  try {
    const articles = await db.articles.findAll({ status: 'published' });
    articles.forEach((article) => collect(article.title));
  } catch {
    /* pretraga ne sme da padne zbog sugestije */
  }

  const target = stemSrpski(term);
  let best: { word: string; score: number } | null = null;
  for (const word of words) {
    const score = commonPrefix(target, word) / Math.max(target.length, word.length);
    if (score >= 0.6 && (!best || score > best.score)) best = { word, score };
  }
  return best && best.word !== target ? best.word : null;
}

/** Dužina zajedničkog prefiksa — dovoljno za „igre“ → „igra“ tip sugestije. */
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export async function searchAll({ q, type = 'all', limit = 10 }: SearchOptions): Promise<SearchResult> {
  const term = String(q ?? '').trim().slice(0, 100);
  if (term.length < MIN_QUERY_LENGTH) return { hits: [], total: 0, suggestion: null };

  const perType = Math.min(Math.max(limit, 1), 20);
  const [articles, threads, deals] = await Promise.all([
    type === 'all' || type === 'articles' ? rpcArticles(term, perType) : Promise.resolve([]),
    type === 'all' || type === 'threads' ? rpcThreads(term, perType) : Promise.resolve([]),
    type === 'all' || type === 'deals' ? rpcDeals(term, perType) : Promise.resolve([]),
  ]);

  // U „all“ režimu svaki tip dobija najviše `perType`, pa se lista seče.
  const hits = [...articles, ...threads, ...deals].sort((a, b) => b.rank - a.rank).slice(0, perType);
  // Sugestija se računa samo kada ništa nije nađeno (jeftinije i nema zbunjivanja).
  const suggestion = hits.length === 0 ? await suggestFor(term) : null;
  return { hits, total: hits.length, suggestion };
}
