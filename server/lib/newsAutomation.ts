/**
 * 2.13.0 — AUTOMATIKA VESTI
 * -------------------------
 * Dve stvari koje pretvaraju RSS uvoz u redakciju:
 *
 * 1. `maybeOpenDiscussion()` — „hot“ vest (GTA 6, Nintendo, otkazi…) dobija
 *    temu na forumu, pa čitaoci mogu da komentarišu bez čekanja moderatora.
 *    Idempotentno: link na članak u telu teme sprečava drugu temu za istu vest.
 *
 * 2. `buildWeeklyDigest()` — 5 najčitanijih vesti protekle nedelje kao HTML
 *    za newsletter. Mejl se NE šalje odavde: `sendEmail()` pušta samo
 *    verifikaciju i reset lozinke, pa je izveštaj namenjen admin panelu/ručnom
 *    slanju (`GET /api/admin/news/digest`).
 */

import { db, uid, type ArticleRecord, type ThreadRecord } from './store.js';
import { logger } from './logger.js';

/** Subforum na koji padaju „hot“ vesti; ako ne postoji, koristi se `off-topic`. */
const DISCUSSION_SUBFORUM = 'off-topic';

/**
 * 2.13.0 — prag za „hot“: brend iz naslova ili grupa događaja. Ostale vesti
 * ostaju samo na portalu — forum ne sme da se pretvori u RSS ogledalo.
 */
const HOT_PATTERNS = /\b(gta\s*6|gta vi|fortnite|zelda|switch 2|xbox|playstation|ps5|nintendo|call of duty|silent hill|pokemon|nvidia|rtx|steam deck|otpušt|otpust|otkazi|akvizicij)\b/i;

/**
 * Otvori temu za „hot“ vest. Vraća kreiranu temu ili `null`.
 * Greška NIKAD ne obara uvoz članka (poziva se posle odgovora 201 → `void`).
 */
export async function maybeOpenDiscussion(article: ArticleRecord): Promise<ThreadRecord | null> {
  try {
    if (process.env.NEWS_FORUM_DISCUSSION === '0') return null;
    const haystack = `${article.title} ${(article.tags ?? []).join(' ')}`;
    if (!HOT_PATTERNS.test(haystack)) return null;

    const link = article.sourceUrl || '';
    const marker = `/article/${article.slug || article.id}`;

    // Idempotentno: tema koja već vodi na ovaj članak ne pravi se ponovo.
    const existing = await db.forum.listThreads({ subforum: DISCUSSION_SUBFORUM });
    if (existing.some((thread) => thread.content?.includes(marker))) return null;

    const author = await db.users.findById(article.authorId);
    if (!author) return null;

    const now = new Date().toISOString();
    const thread: ThreadRecord = {
      id: uid('thr'),
      subforum: DISCUSSION_SUBFORUM,
      title: article.title.slice(0, 150),
      content: [
        `<p>${article.excerpt || ''}</p>`,
        `<p>Pročitaj celu vest: <a href="${marker}">${article.title.slice(0, 120)}</a></p>`,
        link ? `<p><a href="${link}" rel="nofollow noopener" target="_blank">Originalni izvor</a></p>` : '',
      ].join(''),
      author: author.username,
      authorId: author.id,
      tags: (article.tags ?? []).slice(0, 3),
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 0,
      createdAt: now,
      lastReplyAt: now,
    };

    const created = await db.forum.createThread(thread);
    logger.info({ threadId: created.id, articleId: article.id }, 'news_discussion_opened');
    return created;
  } catch (error) {
    logger.warn({ err: error, articleId: article.id }, 'news_discussion_failed');
    return null;
  }
}

/**
 * 2.13.2 — SAŽETAK DOGAĐAJA („Priča se razvija“).
 *
 * Od 2–5 naslova i opisa pravi 2–3 rečenice koje kažu šta se desilo i u kom
 * pravcu ide. Bez AI-ja: koristi opise (feed ih već prevodi), a kada ih nema —
 * naslove. Redosled je hronološki, prvi je NAJNOVIJI (najsvežija informacija).
 *
 * Namenjeno prikazu ispod naslova stranice događaja, ne za SEO opis.
 */
export function buildEventSummary(articles: ArticleRecord[]): string {
  if (!articles.length) return '';

  const sorted = [...articles].sort(
    (a, b) =>
      new Date(b.publishedAt ?? b.createdAt ?? 0).getTime() - new Date(a.publishedAt ?? a.createdAt ?? 0).getTime(),
  );

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const article of sorted.slice(0, 4)) {
    const clean = (article.excerpt || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Prva rečenica opisa je najinformativnija; naslov je rezerva.
    const firstSentence = (clean.split(/(?<=[.!?])\s+/)[0] ?? '').slice(0, 220);
    const text = firstSentence.length >= 40 ? firstSentence : article.title;
    const key = text.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(text);
    if (lines.length === 3) break;
  }

  if (!lines.length) return '';
  const suffix = sorted.length > 3 ? ` (${sorted.length} vesti ukupno)` : '';
  return `${lines.join(' ')}${suffix}`;
}

/**
 * Dnevni/nedeljni digest: najčitanije i najnovije vesti u periodu.
 * Vraća i `html` (za mejl/panel) i `subject` — bez slanja.
 */
export async function buildDigest(options: { days?: number; limit?: number } = {}) {
  const days = Math.min(Math.max(options.days ?? 7, 1), 30);
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const all = await db.articles.findAll({ status: 'published' });
  const recent = all.filter((article) => new Date(article.publishedAt ?? article.createdAt ?? 0).getTime() >= since);

  const byViews = [...recent].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, limit);
  const byDate = [...recent].sort(
    (a, b) =>
      new Date(b.publishedAt ?? b.createdAt ?? 0).getTime() - new Date(a.publishedAt ?? a.createdAt ?? 0).getTime(),
  );

  const items = byViews.map((article) => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    category: article.category,
    views: article.views ?? 0,
    newsSource: article.newsSource ?? null,
    publishedAt: article.publishedAt ?? article.createdAt,
  }));

  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

  const html = [
    `<h2>NEXUS — najbolje vesti${days === 7 ? ' ove nedelje' : ` u poslednjih ${days} dana`}</h2>`,
    '<ul>',
    ...items.map(
      (item) =>
        `<li><a href="${baseUrl}/article/${item.slug}"><strong>${item.title}</strong></a>` +
        `${item.excerpt ? `<br>${item.excerpt}` : ''}</li>`,
    ),
    '</ul>',
  ].join('');

  return {
    days,
    total: recent.length,
    items,
    latest: byDate.slice(0, limit).map((article) => ({ slug: article.slug, title: article.title })),
    subject: `NEXUS — ${items.length} najčitanijih vesti${days === 7 ? ' ove nedelje' : ''}`,
    html,
  };
}
