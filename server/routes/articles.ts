import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText, sanitizeText } from '../middleware/sanitize.js';
import type { ArticleCommentRecord } from '../lib/store.js';
import { createArticleSchema, updateArticleSchema, createReplySchema, validate } from '../lib/schemas.js';
import { isProduction } from '../lib/http.js';

const isDev = () => !isProduction();

/** F-10 — neobjavljen sadržaj vide samo staff korisnici. */
const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

/**
 * Članak dostupan javnosti: `status` mora biti `published` (NULL/legacy redovi
 * bez statusa se tretiraju kao objavljeni).
 */
const isPublicArticle = (article: { status?: string } | null | undefined) =>
  Boolean(article) && (!article!.status || article!.status === 'published');

const router = Router();

/**
 * GET /api/ticker — naslovi za breaking-news traku.
 * Dolazi iz stvarnih (najnovijih) članaka i najaktivnijih tema — nema hardkodovanih vesti.
 */
router.get('/ticker', async (_req, res, next) => {
  try {
    const [articles, threads] = await Promise.all([
      db.articles.findAll({ status: 'published' }),
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

    const filter: any = { status: 'published' };
    if (category && typeof category === 'string') filter.category = category;
    if (search && typeof search === 'string') filter.search = search;
    if (featured !== undefined) filter.featured = featured === 'true';

    const articles = await db.articles.findAll(filter);
    const take = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
    const skip = Math.max(parseInt(offset as string, 10) || 0, 0);
    const page = articles.slice(skip, skip + take);

    res.json({
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
    if (!ids.length) return res.json({ articles: [] });

    const all = await db.articles.findAll({});
    const articles = ids
      .map((id: string) => all.find((article) => article.id === id || article.slug === id))
      // F-10 — draft/embargo ne sme da procuri ni kroz /saved (osim staff-u).
      .filter((article: { id: string; status?: string } | undefined) => article && (isStaff(req.user!.role) || isPublicArticle(article)));

    res.json({ articles });
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
    res.json({ articles: all.filter((a) => ids.has(a.id) && (staff || isPublicArticle(a))) });
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

    res.json(article);
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
    res.json({ reactions, added: created });
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

    const { title, content, excerpt, category, tags, coverImage, isFeatured, status, reviewScorecard } = parsed.data;

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
      status: status === 'draft' ? 'draft' : status === 'archived' ? 'archived' : 'published',
      isFeatured: Boolean(isFeatured),
      reviewScorecard: reviewScorecard ? {
        score: typeof reviewScorecard.score === 'number' ? reviewScorecard.score : undefined,
        verdict: reviewScorecard.verdict ? sanitizeText(reviewScorecard.verdict) : undefined,
        pros: (reviewScorecard.pros ?? []).map((p) => sanitizeText(p)).filter(Boolean),
        cons: (reviewScorecard.cons ?? []).map((c) => sanitizeText(c)).filter(Boolean),
      } : null,
      views: 0,
      reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
      publishedAt: status === 'draft' ? null : now,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(newArticle);
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

    const patch: any = {};
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
      if (parsed.data.status === 'published' && !existing.publishedAt) {
        patch.publishedAt = new Date().toISOString();
      }
    }

    const updated = await db.articles.update(req.params.id, patch);
    res.json(updated);
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
    res.json({
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

    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

export default router;
