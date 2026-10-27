import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText, sanitizeText } from '../middleware/sanitize.js';
import type { ArticleCommentRecord } from '../lib/store.js';
import { createArticleSchema, ingestArticleSchema, updateArticleSchema, createReplySchema, validate } from '../lib/schemas.js';
import { isProduction } from '../lib/http.js';
import { awardXp } from '../lib/gamification.js';
import { notify, notifyMentions } from '../lib/notifications.js';
import { buildEventSummary, maybeOpenDiscussion } from '../lib/newsAutomation.js';
import { isOwnStorageUrl, mirrorRemoteImage } from '../lib/storage.js';
// N10 — ugovor front↔back: isti modul koji uvozi `src/lib/api.ts`.
import {
  articleCommentsResponseSchema,
  articleListResponseSchema,
  articleReactionsResponseSchema,
  articleResponseSchema,
  articleCommentSchema,
} from '../../contracts/index.js';
import { respond } from '../lib/respond.js';
import type { ArticleRecord } from '../lib/store.js';

const isDev = () => !isProduction();

/** F-10 — neobjavljen sadržaj vide samo staff korisnici. */
const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

/**
 * Članak dostupan javnosti: `status` mora biti `published` (NULL/legacy redovi
 * bez statusa se tretiraju kao objavljeni) i — 2.10.0 — datum objave ne sme
 * biti u budućnosti (double-check: i ako tajmer kasni, zakazan članak ostaje
 * nevidljiv javno do tačnog trenutka objave).
 */
const isPublicArticle = (article: { status?: string; publishedAt?: string | null } | null | undefined) => {
  if (!article) return false;
  if (article.status && article.status !== 'published') return false;
  if (article.publishedAt && new Date(article.publishedAt).getTime() > Date.now()) return false;
  return true;
};

const router = Router();

/**
 * GET /api/ticker — naslovi za breaking-news traku.
 * Dolazi iz stvarnih (najnovijih) članaka i najaktivnijih tema — nema hardkodovanih vesti.
 */
router.get('/ticker', async (_req, res, next) => {
  try {
    const [articles, threads] = await Promise.all([
      // 2.10.0 — double-check: i zakasneli tajmer ne izlaže članak pre roka.
      db.articles.findAll({ status: 'published', publishedBefore: new Date().toISOString() }),
      db.forum.listThreads({ sort: 'hot' }),
    ]);

    const items = [
      ...articles.slice(0, 5).map((article) => ({
        id: article.id,
        label: article.title,
        href: `/article/${article.slug || article.id}`,
        kind: 'article' as const,
      })),
      ...threads.slice(0, 3).map((thread) => ({
        id: thread.id,
        label: thread.title,
        href: `/thread/${thread.id}`,
        kind: 'thread' as const,
      })),
    ];

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/articles (lista sa filterima + paginacija)
// ====================
router.get('/', async (req, res, next) => {
  try {
    const { category, search, featured, limit = '20', offset = '0' } = req.query;

    // 2.10.0 — double-check: `publishedBefore` filtrira i ako je status već
    // 'published' a `published_at` u budućnosti (npr. kasni tajmer).
    const filter: Partial<Parameters<typeof db.articles.findAll>[0]> = {
      status: 'published',
      publishedBefore: new Date().toISOString(),
    };
    if (category && typeof category === 'string') filter.category = category;
    if (search && typeof search === 'string') filter.search = search;
    if (featured !== undefined) filter.featured = featured === 'true';

    const articles = await db.articles.findAll(filter);
    const take = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
    const skip = Math.max(parseInt(offset as string, 10) || 0, 0);
    const page = articles.slice(skip, skip + take);

    respond(res, articleListResponseSchema, {
      articles: page,
      total: articles.length,
      limit: take,
      offset: skip,
      hasMore: skip + page.length < articles.length,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/articles/saved — članci koje je ulogovani korisnik sačuvao
// (bookmarks su lokalno u localStorage; server vraća pun sadržaj po ID-jevima)
router.post('/saved', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 50).map(String) : [];
    if (!ids.length) return respond(res, articleListResponseSchema, { articles: [], total: 0 });

    const all = await db.articles.findAll({});
    const staff = isStaff(req.user!.role);
    const articles: ArticleRecord[] = [];
    for (const id of ids) {
      const article = all.find((candidate) => candidate.id === id || candidate.slug === id);
      // F-10 — draft/embargo ne sme da procuri ni kroz /saved (osim staff-u).
      if (article && (staff || isPublicArticle(article))) articles.push(article);
    }

    respond(res, articleListResponseSchema, { articles, total: articles.length });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/articles/bookmarks/mine — sačuvani članci ulogovanog korisnika
// (mora biti PRE dinamičke /:idOrSlug rute)
// ====================
function resolveBookmarkArticle(idOrSlug: string) {
  return db.articles.findAll({}).then((all) =>
    all.find((a) => a.id === idOrSlug || a.slug === idOrSlug) ?? null
  );
}

router.get('/bookmarks/mine', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const bookmarks = await db.bookmarks.list(req.user!.id, 'article');
    const ids = new Set(bookmarks.map((b) => b.targetId));
    const all = await db.articles.findAll({});
    // F-10 — sačuvani draft članak ne sme da se vrati običnom korisniku.
    const staff = isStaff(req.user!.role);
    const articles = all.filter((a) => ids.has(a.id) && (staff || isPublicArticle(a)));
    respond(res, articleListResponseSchema, { articles, total: articles.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/articles/:idOrSlug
// ====================
router.get('/:idOrSlug', async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    let article = await db.articles.findById(idOrSlug);
    if (!article) {
      article = await db.articles.findBySlug(idOrSlug);
    }

    if (!article) {
      return res.status(404).json({ error: 'Članak nije pronađen.' });
    }

    // F-10 — draft/embargo: 404 za sve osim staff-a (anonimni korisnik nema rolu).
    if (!isPublicArticle(article)) {
      let role: string | undefined;
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET as string) as { id?: string };
          role = decoded.id ? (await db.users.findById(decoded.id))?.role : undefined;
        } catch {
          role = undefined;
        }
      }
      if (!isStaff(role)) {
        return res.status(404).json({ error: 'Članak nije pronađen.' });
      }
    }

    // #18 — pregledi kao atomični inkrement (RPC), ne write celog reda
    if (!isDev()) {
      await db.articles.incrementViews(article.id);
    }
    article.views += 1;

    respond(res, articleResponseSchema, article);
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/articles/:id/reactions
// ====================
router.post('/:id/reactions', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const { type } = req.body; // 'like' | 'gg' | 'hype' | 'fire' | 'mind_blown'
    const allowed = ['like', 'gg', 'hype', 'fire', 'mind_blown'];
    if (!allowed.includes(type)) {
      return res.status(400).json({ error: 'Nepoznat tip reakcije.' });
    }

    const article = await db.articles.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ error: 'Članak nije pronađen.' });
    }

    // F-12 — jedna reakcija po korisniku i tipu; ponovni klik ne uvećava brojač.
    const { created, reactions } = await db.articles.addReaction(article.id, req.user!.id, type);
    respond(res, articleReactionsResponseSchema, { reactions, added: created });
  } catch (err) {
    next(err);
  }
});

// ========================================================================
// POST /api/articles/ingest — uvoz vesti iz automatizacije (n8n RSS bot)
// ========================================================================
/**
 * Zašto posebna ruta, a ne `POST /api/articles` sa admin JWT-om:
 * n8n radi serverski, bez korisničke sesije, pa se prepoznaje po dugotrajnom
 * ključu iz `ARTICLES_INGEST_API_KEY` (header `X-Ingest-Key`). Ključ NIKAD ne
 * ide u frontend — samo u n8n kredencijale i `server/.env`.
 *
 * Deduplikacija: isti `sourceUrl` ili isti naslov unutar 24h → `duplicate: true`
 * (200, bez novog članka), pa n8n workflow ne mora sam da pamti šta je poslao.
 * Autor je admin nalog iz `ARTICLES_INGEST_AUTHOR` (ID ili username); ako nije
 * podešen — prvi admin u bazi.
 */
function validIngestKey(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/ingest', async (req, res, next) => {
  try {
    const expected = (process.env.ARTICLES_INGEST_API_KEY ?? '').trim();
    if (expected.length < 16) {
      return res.status(503).json({
        error: 'Uvoz vesti nije podešen na serveru (ARTICLES_INGEST_API_KEY).',
        code: 'INGEST_DISABLED',
      });
    }

    const provided = String(req.get('x-ingest-key') ?? '').trim();
    if (!provided || !validIngestKey(provided, expected)) {
      return res.status(401).json({ error: 'Neispravan ingest ključ.', code: 'INGEST_UNAUTHORIZED' });
    }

    const parsed = validate(ingestArticleSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }
    const {
      title, content, excerpt, category, tags, coverImage, sourceUrl, authorName, isFeatured,
      publishedAt: sourcePublishedAt, eventId, eventTitle, whyItMatters,
    } = parsed.data;

    const cleanTitle = sanitizeText(title);

    // Autor: eksplicitno podešen (ID ili username), inače prvi admin u bazi.
    const authorKey = (process.env.ARTICLES_INGEST_AUTHOR ?? '').trim();
    let author = authorKey ? await db.users.findById(authorKey) : null;
    if (!author && authorKey) author = await db.users.findByUsername(authorKey);
    if (!author) {
      const admins = (await db.users.findAll()).filter((user) => user.role === 'admin');
      author = admins[0] ?? null;
    }
    if (!author) {
      return res.status(503).json({ error: 'Nema admin naloga za autora uvezenih vesti.', code: 'INGEST_NO_AUTHOR' });
    }

    const existing = (await db.articles.findAll({})) as ArticleRecord[];
    const normalizeUrl = (value: string) => value.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();

    /**
     * Deduplikacija 1: `sourceUrl` je stabilan ID vesti (RSS link).
     * Poređenje preko `sourceUrl`, a za redove uvežene pre nego što je polje
     * postojalo — preko linka na original u `content`-u („Izvor: …“).
     */
    const sourceOf = (article: ArticleRecord): string => {
      const stored = String((article as { sourceUrl?: string | null }).sourceUrl ?? '');
      if (stored) return normalizeUrl(stored);
      const linkInBody = String(article.content ?? '').match(/<a\s+href="(https:\/\/[^"]+)"/i);
      return linkInBody ? normalizeUrl(linkInBody[1]) : '';
    };
    const sameSource = existing.find((article) => {
      const candidate = sourceOf(article);
      return candidate !== '' && candidate === normalizeUrl(sourceUrl);
    });
    if (sameSource) {
      return res.status(200).json({ duplicate: true, article: { id: sameSource.id, slug: sameSource.slug } });
    }

    /**
     * Deduplikacija 2: isti naslov u poslednja 24h (RSS stavka bez `link`-a).
     * n8n povremeno prevede naslov drugačije („i dalje“ → „još uvek“), pa se
     * poredi i bez prefiksa izvora i uz toleranciju na velika/mala slova i
     * interpunkciju.
     */
    const normTitle = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const wantedTitle = normTitle(cleanTitle);
    const sameTitle = existing.find(
      (article) =>
        normTitle(article.title) === wantedTitle &&
        new Date(article.createdAt ?? 0).getTime() > dayAgo,
    );
    if (sameTitle) {
      return res.status(200).json({ duplicate: true, article: { id: sameTitle.id, slug: sameTitle.slug } });
    }

    const baseSlug = cleanTitle
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    const now = new Date().toISOString();
    const slug = `${baseSlug || 'vest'}-${Date.now().toString(36)}`;

    // Datum izvora je tačniji od vremena uvoza — ali nikad iz budućnosti.
    const publishedAt =
      sourcePublishedAt && new Date(sourcePublishedAt).getTime() <= Date.now() ? sourcePublishedAt : now;

    /**
     * 2.13.2 — DE-DUPLIKACIJA SLIKA.
     *
     * Ista naslovna slika se često pojavi u više vesti (isti događaj iz više
     * izvora, ili izvor ponovi `og:image`). Bez ove provere svaki uvoz bi
     * napravio novi WebP u Storage — isti bajtovi, tri puta, tri URL-a.
     *
     * Pravilo: ako već postoji vest sa ISTOM originalnom slikom, koristi njen
     * finalni URL (naš WebP) i ne diraj Storage.
     *
     * Originalni URL se prepoznaje po markeru iz `content`-a
     * (`<!--source-image:…-->`) jer `cover_image` posle mirror-a sadrži naš URL.
     */
    const originalImageKey = (url: string) =>
      String(url || '').replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
    const wantedImage = originalImageKey(coverImage ?? '');
    const existingWithImage = wantedImage
      ? existing.find((article) => {
          const marker = String(article.content ?? '').match(/<!--source-image:([^>]+)-->/i);
          return marker ? originalImageKey(marker[1]) === wantedImage : false;
        })
      : undefined;

    /**
     * 2.13.0 — slika se preslikava u naš Storage (nema hotlinka na Polygon
     * CDN). Ako Storage nije podešen ili preuzimanje padne, ostaje originalni
     * URL — uvoz se nikad ne prekida zbog slike.
     */
    const mirroredCover =
      !existingWithImage && coverImage && process.env.NEWS_MIRROR_IMAGES !== '0'
        ? await mirrorRemoteImage(coverImage, { ownerId: author.id, prefix: 'news' })
        : null;
    const finalCover = existingWithImage?.coverImage || mirroredCover || coverImage || '';
    /**
     * Marker originalne slike — osnova za dedupe pri sledećem uvozu.
     * HTML komentar (a ne `<span data-…>`): sanitizator dozvoljava `span` samo
     * bez atributa, pa bi atribut bio obrisan; komentar prolazi netaknut i
     * nevidljiv je čitaocu.
     */
    const imageMarker = coverImage ? `<!--source-image:${coverImage}-->` : '';

    const created = await db.articles.create({
      id: uid('art'),
      slug,
      title: cleanTitle,
      excerpt: sanitizeText(excerpt ?? ''),
      content: `${sanitizeRichText(content)}${imageMarker}`,
      /**
       * Cover NIJE obavezan: vest bez slike je bolja od lažne generičke slike
       * (frontend ima svoj fallback). Zato `''` umesto Unsplash podrazumevane.
       */
      coverImage: finalCover,
      authorId: author.id,
      author: author.username,
      category: category || 'Vesti',
      tags: (tags ?? []).map((tag) => sanitizeText(tag)),
      status: 'published',
      isFeatured: Boolean(isFeatured),
      reviewScorecard: null,
      views: 0,
      reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
      publishedAt,
      createdAt: now,
      updatedAt: now,
      // 2.13.0 — izvor i grupa događaja (kolone postoje posle migracije;
      // do tada `store.create` upisuje bez njih, pa uvoz ne pada).
      sourceUrl,
      newsSource: authorName ?? null,
      eventId: eventId ?? null,
      eventTitle: eventTitle ?? null,
      whyItMatters: whyItMatters ?? null,
    } as never);

    // Dedupe u telu članka: radi i pre migracije i čita se bez kolone.
    if (!String(created.content ?? '').includes(sourceUrl)) {
      const withSource = `${created.content}<p><a href="${sourceUrl}" rel="nofollow noopener" target="_blank">Izvor: ${sanitizeText(authorName || 'original')}</a></p>`;
      created.content = (await db.articles.update(created.id, { content: withSource }))?.content ?? withSource;
    }

    // 2.13.0 — „hot“ vest otvara temu na forumu (greška ne utiče na odgovor).
    void maybeOpenDiscussion(created);

    respond(res, articleResponseSchema, created, 201);
  } catch (err) {
    next(err);
  }
});

// ======================================================================
// GET /api/articles/event/:eventId — vremenska linija jednog događaja
// ======================================================================
/**
 * 2.13.0 — sve vesti sa istim `eventId`, najnovija prva: „Xbox otpuštanja“
 * ili „GTA 6“ kao priča koja se razvija umesto 5 nepovezanih kartica.
 */
router.get('/event/:eventId', async (req, res, next) => {
  try {
    const eventId = String(req.params.eventId).toLowerCase();
    if (!/^[a-z0-9-]{2,120}$/.test(eventId)) {
      return res.status(400).json({ error: 'Neispravan ID događaja.' });
    }

    const nowIso = new Date().toISOString();
    let articles = (await db.articles.findByEvent?.(eventId, 30)) ?? [];
    // Fallback za baze bez `event_id` kolone (migracija nije puštena).
    if (!articles.length) {
      const all = await db.articles.findAll({ status: 'published', publishedBefore: nowIso });
      articles = all.filter((article) => article.eventId === eventId);
    }

    articles = articles.filter(isPublicArticle);
    if (!articles.length) {
      return res.status(404).json({ error: 'Događaj nije pronađen.' });
    }

    const eventTitle = articles.find((article) => article.eventTitle)?.eventTitle ?? eventId;
    // Naslov grupe je za prikaz (zaglavlje „Priča se razvija: GTA 6“).
    res.setHeader('X-Event-Title', encodeURIComponent(String(eventTitle)));

    /**
     * 2.13.2 — „Priča se razvija“ nije samo značka: sažetak od 2–3 rečenice
     * (najnovije prvo) i kratka vremenska linija sa datumima.
     */
    const summary = buildEventSummary(articles);
    const timeline = articles.slice(0, 6).map((article) => ({
      date: article.publishedAt ?? article.createdAt,
      label: article.title.slice(0, 120),
    }));

    res.json({ articles, total: articles.length, eventTitle, summary, timeline });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/articles (admin ili moderator)
// ====================
router.post('/', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(createArticleSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { title, content, excerpt, category, tags, coverImage, isFeatured, status, scheduledFor, reviewScorecard } = parsed.data;

    const cleanTitle = sanitizeText(title);
    const baseSlug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80);
    const slug = `${baseSlug || 'clanak'}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const newArticle = await db.articles.create({
      id: uid('art'),
      slug,
      title: cleanTitle,
      excerpt: sanitizeText(excerpt ?? ''),
      content: sanitizeRichText(content),
      coverImage: coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&q=80',
      authorId: req.user!.id,
      author: req.user!.username,
      category: category || 'Vesti',
      tags: (tags ?? []).map((tag) => sanitizeText(tag)),
      /**
       * 2.10.0 — `scheduled`: status ceka, a `publishedAt` drži ZAKAZANI trenutak.
       * Job ga naknadno prebacuje u 'published'; datum objave ostaje zakazano vreme.
       */
      status: status === 'draft' ? 'draft' : status === 'archived' ? 'archived' : status === 'scheduled' ? 'scheduled' : 'published',
      isFeatured: Boolean(isFeatured),
      reviewScorecard: reviewScorecard ? {
        score: typeof reviewScorecard.score === 'number' ? reviewScorecard.score : undefined,
        verdict: reviewScorecard.verdict ? sanitizeText(reviewScorecard.verdict) : undefined,
        pros: (reviewScorecard.pros ?? []).map((p) => sanitizeText(p)).filter(Boolean),
        cons: (reviewScorecard.cons ?? []).map((c) => sanitizeText(c)).filter(Boolean),
      } : null,
      views: 0,
      reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
      /**
       * 2.10.0 — `published`/`scheduled`: `publishedAt` je datum objave
       * (za scheduled to je zakazani trenutak; job ga ne pomera).
       */
      publishedAt: status === 'draft' ? null : (scheduledFor ?? now),
      createdAt: now,
      updatedAt: now,
    });

    respond(res, articleResponseSchema, newArticle, 201);
  } catch (err) {
    next(err);
  }
});

// =====================
// PUT /api/articles/:id (admin ili autor)
// ====================
router.put('/:id', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(updateArticleSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const existing = await db.articles.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Članak nije pronađen.' });
    }

    const patch: Partial<ArticleRecord> = {};
    if (parsed.data.title !== undefined) patch.title = sanitizeText(parsed.data.title);
    if (parsed.data.content !== undefined) patch.content = sanitizeRichText(parsed.data.content);
    if (parsed.data.excerpt !== undefined) patch.excerpt = sanitizeText(parsed.data.excerpt);
    if (parsed.data.category !== undefined) patch.category = parsed.data.category;
    if (parsed.data.tags !== undefined) patch.tags = parsed.data.tags.map((tag: string) => sanitizeText(tag));
    if (parsed.data.coverImage !== undefined) patch.coverImage = parsed.data.coverImage;
    if (parsed.data.isFeatured !== undefined) patch.isFeatured = parsed.data.isFeatured;
    if (parsed.data.reviewScorecard !== undefined) {
      patch.reviewScorecard = parsed.data.reviewScorecard ? {
        score: typeof parsed.data.reviewScorecard.score === 'number' ? parsed.data.reviewScorecard.score : undefined,
        verdict: parsed.data.reviewScorecard.verdict ? sanitizeText(parsed.data.reviewScorecard.verdict) : undefined,
        pros: (parsed.data.reviewScorecard.pros ?? []).map((p) => sanitizeText(p)).filter(Boolean),
        cons: (parsed.data.reviewScorecard.cons ?? []).map((c) => sanitizeText(c)).filter(Boolean),
      } : null;
    }
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      if (parsed.data.status === 'scheduled') {
        // 2.10.0 — zakazivanje: `publishedAt` nosi zakazani trenutak.
        if (parsed.data.scheduledFor) {
          patch.publishedAt = parsed.data.scheduledFor;
        }
      } else if (parsed.data.status === 'published') {
        // 2.10.0 — direktna objava briše zakazani trenutak (nema „kvasca“ u budućnosti).
        if (parsed.data.scheduledFor !== undefined) patch.publishedAt = null;
        if (!existing.publishedAt || (existing.publishedAt && new Date(existing.publishedAt) > new Date())) {
          patch.publishedAt = new Date().toISOString();
        }
      } else if (parsed.data.status === 'draft') {
        patch.publishedAt = null;
      }
    } else if (parsed.data.scheduledFor !== undefined) {
      // 2.10.0 — pomeranje zakazanog trenutka bez promene statusa (samo za scheduled članke).
      if (existing.status === 'scheduled') patch.publishedAt = parsed.data.scheduledFor;
    }

    const updated = await db.articles.update(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'Članak nije pronađen.' });
    respond(res, articleResponseSchema, updated);
  } catch (err) {
    req.log?.error({ err }, 'articles_route_failed');
    res.status(500).json({ error: 'Greška pri ažuriranju članka.' });
  }
});

// =====================
// DELETE /api/articles/:id (admin only)
// ====================
router.delete('/:id', authenticate, authorize('admin'), async (req: AuthRequest, res) => {
  try {
    const deleted = await db.articles.remove(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Članak nije pronađen.' });
    }
    res.json({ message: 'Članak je uspešno obrisan.' });
  } catch (err) {
    req.log?.error({ err }, 'articles_route_failed');
    res.status(500).json({ error: 'Greška pri brisanju članka.' });
  }
});

// =====================
// BOOKMARKS — POST/DELETE /api/articles/:id/bookmark
// Izvor istine: `article_bookmarks` (Supabase) / memory fallback.
// ====================
router.post('/:id/bookmark', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const article = await resolveBookmarkArticle(req.params.id);
    if (!article) return res.status(404).json({ error: 'Članak nije pronađen.' });

    await db.bookmarks.add(req.user!.id, 'article', article.id);
    res.json({ bookmarked: true, articleId: article.id });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/bookmark', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const article = await resolveBookmarkArticle(req.params.id);
    if (!article) return res.status(404).json({ error: 'Članak nije pronađen.' });

    await db.bookmarks.remove(req.user!.id, 'article', article.id);
    res.json({ bookmarked: false, articleId: article.id });
  } catch (err) {
    next(err);
  }
});

// =====================
// COMMENTS — GET/POST /api/articles/:id/comments (nested, soft delete)
// F-08 — čuva se u `article_comments` tabeli (Supabase) / store-u, ne u memoriji procesa.
// ====================
router.get('/:id/comments', async (req, res, next) => {
  try {
    const article = await resolveBookmarkArticle(req.params.id);
    if (!article) return res.status(404).json({ error: 'Članak nije pronađen.' });

    const comments = await db.articles.listComments(article.id);
    // Verifikaciona značka kod imena autora komentara — jedan upit po listi.
    const userIds = [...new Set(comments.map((comment) => comment.userId).filter(Boolean))];
    const verified = new Map(
      (
        await Promise.all(userIds.map((id) => db.users.findById(id).catch(() => null)))
      )
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => [user.id, user.isVerified === true]),
    );
    respond(res, articleCommentsResponseSchema, {
      comments: comments.map((comment) => ({ ...comment, authorVerified: verified.get(comment.userId) === true })),
      total: comments.length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(createReplySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const article = await resolveBookmarkArticle(req.params.id);
    if (!article) return res.status(404).json({ error: 'Članak nije pronađen.' });

    const author = await db.users.findById(req.user!.id);
    const now = new Date().toISOString();
    const comment: ArticleCommentRecord = {
      id: uid('acm'),
      articleId: article.id,
      userId: req.user!.id,
      author: req.user!.username,
      authorAvatar: author?.avatar,
      authorVerified: author?.isVerified === true,
      content: sanitizeRichText(parsed.data.content),
      parentId: parsed.data.parentId ?? null,
      isEdited: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await db.articles.createComment(comment);

    // XP za komentar članka — ovde se računa i `article_commenter` (5 komentara).
    // Greška ne pokvari čuvanje komentara (awardXp je već try/catch).
    const commentCount = (await db.articles.listComments(article.id)).filter(
      (c) => c.userId === req.user!.id && !c.isDeleted,
    ).length;
    void awardXp(req.user!.id, 5, {
      reason: 'article_comment',
      commentCount,
    }).catch(() => undefined);

    // Notifikacije (isti obrazac kao forum): autor članka → roditeljski komentar
    // → @mentions. `notify()` nikad ne baca grešku, pa odgovor ostaje sačuvan
    // čak i ako notifikacija padne. `notified` sprečava duplikat (npr. autor
    // članka koji je istovremeno i autor komentara na koji se odgovara).
    const commentLink = `/article/${article.slug || article.id}#comment-${saved.id}`;
    const notified = new Set<string>([req.user!.id]);
    const notifyOnce = async (userId: string | undefined | null, input: { title: string; message: string }) => {
      if (!userId || notified.has(userId)) return;
      notified.add(userId);
      await notify({
        userId,
        type: 'reply',
        title: input.title,
        message: input.message,
        link: commentLink,
        actorId: req.user!.id,
      });
    };

    await notifyOnce(article.authorId, {
      title: 'Novi komentar na vaš članak',
      message: `${req.user!.username} je komentarisao: ${article.title}`,
    });

    if (saved.parentId) {
      const parent = (await db.articles.listComments(article.id)).find(
        (comment) => comment.id === saved.parentId,
      );
      await notifyOnce(parent?.userId, {
        title: 'Odgovor na vaš komentar',
        message: `${req.user!.username} je odgovorio na vaš komentar: ${article.title}`,
      });
    }

    await notifyMentions({
      content: saved.content,
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      link: commentLink,
      contextTitle: article.title,
      contextLabel: 'u članku',
      excludeUserIds: notified,
    });

    respond(res, articleCommentSchema, saved, 201);
  } catch (err) {
    next(err);
  }
});

export default router;
