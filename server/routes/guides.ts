import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, uid } from '../lib/store.js';
import type { GameRecord, GuideRecord } from '../lib/deals.js';
import { normalizeSlug } from '../lib/deals.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText, sanitizeText } from '../middleware/sanitize.js';
import { logger } from '../lib/logger.js';

/**
 * 2.8.0 — GAME GUIDES (community vodiči)
 * --------------------------------------
 *   GET  /api/games/:gameSlug/guides                lista (filter kategorija, sort top/newest)
 *   GET  /api/games/:gameSlug/guides/:guideSlug     detalj (+1 views, + myVote)
 *   POST /api/games/:gameSlug/guides                kreiranje (auth + verifikovan email)
 *   POST /api/guides/:id/vote                       glas (up/down/null; atomičan RPC)
 *
 * SEO: svaki vodič ima javni URL `/games/:gameSlug/guides/:guideSlug`
 * (frontend stranica `GuidePage`), pa su vodiči long-tail ulazne tačke
 * („kako preći misiju X“, „najbolji build za Y“).
 */

const router = Router();

/**
 * Viewer bez autentifikacije: ako JWT postoji (cookie ili Bearer), povuci
 * `userId` za `myVote`; inače javni pregled. Isti obrazac kao u collections.ts.
 */
async function optionalViewer(req: AuthRequest): Promise<{ id: string } | undefined> {
  const header = req.headers.authorization;
  const cookieToken = (req as any).cookies?.nx_at ?? (req as any).cookies?.token;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  if (!token) return undefined;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id?: string };
    if (!decoded.id) return undefined;
    const user = await db.users.findById(decoded.id);
    if (!user || user.isBanned) return undefined;
    return { id: user.id };
  } catch {
    return undefined;
  }
}

export const GUIDE_CATEGORIES = ['walkthrough', 'builds', 'achievements', 'tips', 'general'] as const;
export type GuideCategoryApi = (typeof GUIDE_CATEGORIES)[number];

/** Javni oblik vodiča (bez internih polja; autor dekorisan). */
function publicShape(guide: GuideRecord, author: { username: string; avatar: string | null; role: string | null } | null, myVote: 'up' | 'down' | null, gameTitle?: string | null, gameSlug?: string | null) {
  return {
    id: guide.id,
    gameSlug: gameSlug ?? null,
    gameTitle: gameTitle ?? null,
    authorId: guide.authorId,
    author: author?.username ?? 'član',
    authorAvatar: author?.avatar ?? null,
    authorRole: author?.role ?? null,
    slug: guide.slug,
    title: guide.title,
    summary: guide.summary,
    content: guide.content,
    category: guide.category,
    score: guide.score,
    viewsCount: guide.viewsCount,
    status: guide.status,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    myVote,
  };
}

async function decorate(guide: GuideRecord, myVote: 'up' | 'down' | null, game?: GameRecord | null) {
  const author = await db.users.findById(guide.authorId).catch(() => null);
  return publicShape(
    guide,
    author ? { username: author.username, avatar: author.avatar || null, role: author.role } : null,
    myVote,
    game?.title ?? null,
    game?.slug ?? null,
  );
}

const createSchema = z.object({
  title: z.string().trim().min(10).max(160),
  summary: z.string().trim().max(300).optional().or(z.literal('')),
  content: z.string().trim().min(200),
  category: z.enum(GUIDE_CATEGORIES).default('general'),
  status: z.enum(['published', 'draft']).default('published'),
});

const voteSchema = z.object({
  vote: z.enum(['up', 'down', 'null']).nullable().optional(),
});

/** Slug iz naslova (latinica-friendly); dedup sufiks rješava rutu u `create`. */
function slugifyTitle(title: string): string {
  return (
    normalizeSlug(title)
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 140) || 'vodic'
  );
}

// GET /api/games/:gameSlug/guides?category=&sort=&limit=&offset=
router.get('/games/:gameSlug/guides', async (req: AuthRequest, res, next) => {
  try {
    const game = await db.games.findBySlug(req.params.gameSlug);
    if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });

    const viewer = await optionalViewer(req);
    const category = typeof req.query.category === 'string' && GUIDE_CATEGORIES.includes(req.query.category as GuideCategoryApi)
      ? (req.query.category as GuideCategoryApi)
      : undefined;
    const sort = req.query.sort === 'newest' ? 'newest' : 'top';
    const limit = Math.min(Number(req.query.limit) || 24, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { guides, total } = await db.guides.listByGame(game.id, { category, sort, limit, offset });
    const decorated = await Promise.all(
      guides.map(async (guide) => {
        const myVote = viewer ? await db.guides.myVote(viewer.id, guide.id) : null;
        return decorate(guide, myVote, game);
      }),
    );
    res.json({ guides: decorated, total, game: { slug: game.slug, title: game.title } });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/:gameSlug/guides/:guideSlug
router.get('/games/:gameSlug/guides/:guideSlug', async (req: AuthRequest, res, next) => {
  try {
    const game = await db.games.findBySlug(req.params.gameSlug);
    if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });

    const guide = await db.guides.findBySlug(req.params.guideSlug);
    if (!guide || guide.gameId !== game.id) return res.status(404).json({ error: 'Vodič nije pronađen.' });

    const isOwner = req.user?.id === guide.authorId;
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'moderator';
    if (guide.status !== 'published' && !isOwner && !isStaff) {
      return res.status(404).json({ error: 'Vodič nije pronađen.' });
    }

    const viewer = await optionalViewer(req);
    const myVote = viewer ? await db.guides.myVote(viewer.id, guide.id) : null;
    // Pregledi: inkrement za javno vidljive vodiče (draft se ne broji).
    if (guide.status === 'published') {
      await db.guides.incrementViews(guide.id).catch((error) => {
        logger.warn({ err: error, guideId: guide.id }, 'guide_views_increment_failed');
      });
    }
    res.json({ guide: await decorate(guide, myVote, game) });
  } catch (err) {
    next(err);
  }
});

// POST /api/games/:gameSlug/guides
router.post('/games/:gameSlug/guides', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const game = await db.games.findBySlug(req.params.gameSlug);
    if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });

    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Neispravni podaci vodiča (naslov 10–160 znakova, sadržaj najmanje 200 znakova).',
      });
    }

    // Sanitizacija: isti mehanizam kao teme/članci (odbrana u dubini pre UI-ja).
    const content = sanitizeRichText(parsed.data.content);
    const title = sanitizeText(parsed.data.title);
    const summary = parsed.data.summary ? sanitizeText(parsed.data.summary) : null;

    // Jedinstven slug: `naslov`, `naslov-2`, `naslov-3`…
    let slug = slugifyTitle(title);
    for (let attempt = 2; await db.guides.slugExists(slug); attempt += 1) {
      slug = `${slugifyTitle(title)}-${attempt}`.slice(0, 160);
    }

    const guide = await db.guides.create({
      id: uid('guide'),
      gameId: game.id,
      authorId: req.user!.id,
      slug,
      title,
      summary,
      content,
      category: parsed.data.category,
      score: 0,
      viewsCount: 0,
      status: parsed.data.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.status(201).json({ guide: await decorate(guide, null, game) });
  } catch (err) {
    next(err);
  }
});

// POST /api/guides/:id/vote — atomičan glas (RPC), isti oblik kao deal vote.
router.post('/guides/:id/vote', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const guide = await db.guides.findById(req.params.id);
    if (!guide || guide.status !== 'published') {
      return res.status(404).json({ error: 'Vodič nije pronađen.' });
    }

    const parsed = voteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Neispravan glas.' });
    const raw = parsed.data.vote;
    const type = raw === 'up' ? 'up' : raw === 'down' ? 'down' : null;

    const result = await db.guides.vote(req.user!.id, guide.id, type);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
