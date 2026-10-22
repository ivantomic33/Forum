import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeText } from '../middleware/sanitize.js';
import { ACCESS_COOKIE } from '../lib/sessions.js';
import {
  DEAL_CURRENCIES,
  DEAL_LIMITS,
  checkExternalUrl,
  fetchOfferPreview,
  igdbSettings,
  normalizeSlug,
  searchIgdbGames,
  validateDealInput,
  type DealRecord,
  type DealSort,
} from '../lib/deals.js';
import { applyAuthorKarma } from '../lib/gamification.js';
import { isOwnStorageUrl, storageConfigured } from '../lib/storage.js';
import { notify } from '../lib/notifications.js';

/**
 * DEALS / POPUSTI — `/api/deals`, `/api/games`
 * ---------------------------------------------
 *  GET    /api/deals                     lista (sort + filteri + paginacija)
 *  POST   /api/deals                     objava (auth + verifikovan email)
 *  GET    /api/deals/mine                moji deal-ovi (uključujući istekle)
 *  GET    /api/deals/:id                 detalj (+ myVote)
 *  PATCH  /api/deals/:id                 izmena (autor ili moderator)
 *  DELETE /api/deals/:id                 soft-delete (autor ili moderator)
 *  POST   /api/deals/:id/vote            glas (up/down/null)
 *  GET    /api/games                     katalog igara iz deals-a
 *  GET    /api/games/search?q=           pretraga igara u katalogu
 *  GET    /api/games/igdb?q=             IGDB pretraga (opciono, bez ključa vraća [])
 *  GET    /api/games/:slug               igra + aktivni deal-ovi (Game Page)
 *
 * Autentifikacija je ista kao na forumu: `authenticate` čita HttpOnly cookie
 * (ili Bearer) i uvek ponovo proveri korisnika u bazi.
 */
const router = Router();

const SORTS: DealSort[] = ['newest', 'top', 'discount', 'expiring'];

/* ---------------------------- Helperi ---------------------------- */

/**
 * Opciona autentifikacija za čitanje: gost dobija listu, prijavljeni dobija
 * `myVote`. Nevažeći token NE obara listu — samo se ignoriše.
 */
async function optionalViewer(req: AuthRequest): Promise<AuthRequest['user'] | undefined> {
  if (req.user) return req.user;
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ((req as any).cookies?.[ACCESS_COOKIE] ?? (req as any).cookies?.token);
  if (!token) return undefined;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id?: string };
    if (!decoded.id) return undefined;
    const user = await db.users.findById(decoded.id);
    if (!user || user.isBanned) return undefined;
    return { id: user.id, username: user.username, role: user.role, isVerified: user.isVerified };
  } catch {
    return undefined;
  }
}

const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

/** Bezbedna konverzija u broj (string iz forme ili `number` iz JSON-a). */
const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  // Prihvati i decimalni zarez („19,99“ iz srpske tastature).
  const normalized = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
};

/** ID-ovi autorizovanih prijavljivača — za dodavanje avatar URL-a. */
async function decorateAuthors(deals: DealRecord[]): Promise<DealRecord[]> {
  const ids = [...new Set(deals.map((deal) => deal.authorId).filter(Boolean))];
  if (!ids.length) return deals;
  const users = await Promise.all(ids.map((id) => db.users.findById(id).catch(() => null)));
  const map = new Map(users.filter(Boolean).map((user) => [user!.id, user!]));
  return deals.map((deal) => {
    const user = map.get(deal.authorId);
    return {
      ...deal,
      author: deal.author || user?.username || 'član',
      authorAvatar:
        deal.authorAvatar || user?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(deal.authorId)}`,
      authorRole: deal.authorRole ?? user?.role ?? 'member',
      authorVerified: user?.isVerified === true,
    };
  });
}

/**
 * Rešava igru iz forme: `gameId` (postojeća iz kataloga), `gameSlug`/`gameTitle`
 * (nova igra ili postojeća po naslovu). `igdbId` se prihvata da bi se sačuvao
 * cover iz IGDB pretrage.
 */
async function resolveGame(body: any): Promise<string | null> {
  if (body.gameId) {
    const byId = await db.games.findById(String(body.gameId));
    if (byId) return byId.id;
    // Nepostojeći ID iz forme ne sme da obori objavu — nastavi kao slobodan unos.
  }
  if (body.igdbGame) {
    const raw = body.igdbGame;
    const title = sanitizeText(String(raw.name ?? '')).slice(0, 200);
    if (title) {
      const slug = normalizeSlug(String(raw.slug ?? title));
      const igdbId = Number(raw.igdbId);
      const cover = typeof raw.coverUrl === 'string' ? raw.coverUrl : null;
      if (cover && !checkExternalUrl(cover).ok) {
        // Ne prihvataj proizvoljan URL kao cover iz klijenta.
        return (await db.games.upsert({ slug, title, coverUrl: null, releaseDate: null, igdbId: Number.isFinite(igdbId) ? igdbId : null })).id;
      }
      const game = await db.games.upsert({
        slug,
        title,
        coverUrl: cover,
        releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate.slice(0, 10) : null,
        igdbId: Number.isFinite(igdbId) ? igdbId : null,
      });
      return game.id;
    }
  }
  const title = sanitizeText(String(body.gameTitle ?? body.gameSlug ?? '')).slice(0, 200);
  if (!title) return null;
  const slug = normalizeSlug(body.gameSlug || title);
  if (!slug) return null;
  const existing = await db.games.findBySlug(slug);
  if (existing) return existing.id;
  const game = await db.games.upsert({ slug, title, coverUrl: null, releaseDate: null, igdbId: null });
  return game.id;
}

/* ---------------------------- Liste ---------------------------- */

// GET /api/deals — lista sa sortiranjem i filterima
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const viewer = await optionalViewer(req);
    const sortRaw = String(req.query.sort ?? 'newest');
    const sort = (SORTS.includes(sortRaw as DealSort) ? sortRaw : 'newest') as DealSort;

    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { deals, total } = await db.deals.list(
      {
        sort,
        gameId: typeof req.query.game === 'string' ? req.query.game : undefined,
        gameSlug: typeof req.query.gameSlug === 'string' ? req.query.gameSlug : undefined,
        store: typeof req.query.store === 'string' ? req.query.store : undefined,
        platform: typeof req.query.platform === 'string' ? req.query.platform : undefined,
        minPrice: parseNumber(req.query.minPrice),
        maxPrice: parseNumber(req.query.maxPrice),
        minDiscount: parseNumber(req.query.minDiscount),
        search: typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined,
        expiringSoon: req.query.expiringSoon === 'true',
        limit,
        offset,
      },
      viewer?.id,
    );

    res.json({
      deals: await decorateAuthors(deals),
      total,
      hasMore: offset + deals.length < total,
      sort,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/preview?url= — 2.6.2: meta podaci ponude (naslov, og:image, cena)
//
// Serverski fetch, pa je obavezna prijava + rate limit po korisniku: ruta ne
// sme da postane otvoren proxy. Istu logiku koristi i `POST /api/deals` kada
// proof nije naš upload — dokaz se tada povlači sa prodavnice (`og:image`).
// Rate limit živi u `index.ts` (posle `authenticate`, pa je ključ userId).
router.get('/preview', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'Nedostaje `url`.' });
    const preview = await fetchOfferPreview(url);
    // 200 i sa `error`-om: forma prikazuje upozorenje, ali link ostaje unet.
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/mine — moji deal-ovi (uključujući istekle i uklonjene)
router.get('/mine', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { deals, total } = await db.deals.list(
      { authorId: req.user!.id, includeExpired: true, sort: 'newest', limit: 100 },
      req.user!.id,
    );
    res.json({ deals, total });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/:id — detalj
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const viewer = await optionalViewer(req);
    const deal = await db.deals.findById(req.params.id, viewer?.id);
    if (!deal) return res.status(404).json({ error: 'Deal nije pronađen.' });

    // Uklonjen deal vide samo autor i moderacija (kao soft-deleted tema).
    if (deal.status === 'removed' && viewer?.id !== deal.authorId && !isStaff(viewer?.role)) {
      return res.status(404).json({ error: 'Deal nije pronađen.' });
    }

    const [decorated] = await decorateAuthors([deal]);
    res.json({ deal: decorated });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Objava / izmena ---------------------------- */

const dealBodySchema = z.object({
  title: z.string().max(DEAL_LIMITS.titleMax + 20).optional(),
  url: z.string().max(2048).optional(),
  /** Dokaz je URL; `data:image` se prihvata samo dok Storage nije podešen. */
  proofUrl: z
    .string()
    .max(2_500_000)
    .refine((value) => !(storageConfigured() && value.startsWith('data:')), {
      message: 'Slika dokaza se sada šalje preko upload-a (POST /api/uploads/proof).',
    })
    .nullable()
    .optional(),
  price: z.union([z.number(), z.string()]).optional(),
  originalPrice: z.union([z.number(), z.string()]).optional(),
  currency: z.enum(DEAL_CURRENCIES as unknown as [string, ...string[]]).optional(),
  store: z.string().max(DEAL_LIMITS.storeMax + 20).optional(),
  platform: z.string().max(DEAL_LIMITS.platformMax + 10).optional(),
  description: z.string().max(DEAL_LIMITS.descriptionMax + 100).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  gameId: z.string().max(100).nullable().optional(),
  gameTitle: z.string().max(200).nullable().optional(),
  igdbGame: z
    .object({
      name: z.string().max(200),
      slug: z.string().max(200).optional(),
      igdbId: z.number().optional(),
      coverUrl: z.string().max(500).optional().nullable(),
      releaseDate: z.string().max(20).optional().nullable(),
    })
    .optional()
    .nullable(),
});

// POST /api/deals — objava
router.post('/', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = dealBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Neispravan zahtev.' });
    }
    const body: any = parsed.data;

    // Duplikat istog linka od istog korisnika — česta greška dvostrukog klika.
    const existing = await db.deals.list({ authorId: req.user!.id, includeExpired: true, limit: 100 }, req.user!.id);
    if (existing.deals.some((deal) => deal.url === body.url && deal.status === 'active')) {
      return res.status(409).json({ error: 'Već ste objavili deal sa ovim linkom.' });
    }

    const validated = validateDealInput({
      title: sanitizeText(body.title),
      url: String(body.url ?? ''),
      proofUrl: body.proofUrl,
      price: parseNumber(body.price) ?? NaN,
      originalPrice: parseNumber(body.originalPrice) ?? NaN,
      currency: body.currency,
      store: sanitizeText(body.store),
      platform: body.platform,
      description: body.description ? sanitizeText(body.description) : null,
      expiresAt: body.expiresAt,
    });
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    // 2.6.2 — dokaz: naš upload ili `data:image` (dok Storage nije podešen).
    // Eksterni URL se **proverava** i, ako stranica ima `og:image`, dokaz se
    // povlači sa prodavnice (origin odbijen kad nije javni host).
    let proofUrl = validated.value.proofUrl;
    if (proofUrl && !isOwnStorageUrl(proofUrl) && !proofUrl.startsWith('data:')) {
      try {
        const proofCheck = checkExternalUrl(proofUrl, { field: 'Dokaz (screenshot)' });
        if (!proofCheck.ok) return res.status(400).json({ error: proofCheck.error });
        const preview = await fetchOfferPreview(proofUrl);
        if (preview.error) return res.status(400).json({ error: `Dokaz nije dostupan: ${preview.error}` });
        // `og:image` je najčešće upravo screenshot ponude; bolje od generičkog URL-a.
        if (preview.imageUrl && checkExternalUrl(preview.imageUrl).ok) proofUrl = preview.imageUrl;
      } catch {
        return res.status(400).json({ error: 'Dokaz nije mogao da se proveri. Otpremi screenshot preko upload-a.' });
      }
    }

    const gameId = await resolveGame(body).catch((error) => {
      req.log?.warn({ err: error }, 'deal_game_resolve_failed');
      return null;
    });

    const now = new Date().toISOString();
    const deal = await db.deals.create({
      id: uid('deal'),
      authorId: req.user!.id,
      author: req.user!.username,
      gameId,
      gameSlug: null,
      gameTitle: null,
      gameCover: null,
      title: validated.value.title,
      url: validated.value.url,
      proofUrl,
      price: validated.value.price,
      originalPrice: validated.value.originalPrice,
      discountPct: validated.value.discountPct,
      currency: validated.value.currency,
      store: validated.value.store,
      platform: validated.value.platform,
      description: validated.value.description,
      expiresAt: validated.value.expiresAt,
      status: 'active',
      isVerified: false,
      score: 0,
      createdAt: now,
      updatedAt: now,
    });

    req.log?.info({ dealId: deal.id, gameId }, 'deal_created');
    // `create` vraća zapis bez relacija — dovuci igru da odgovor bude isti kao `GET /deals/:id`.
    const created = (await db.deals.findById(deal.id, req.user!.id)) ?? deal;
    const [decorated] = await decorateAuthors([created]);
    res.status(201).json({ deal: decorated });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/deals/:id — izmena (autor ili moderacija)
router.patch('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const deal = await db.deals.findById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal nije pronađen.' });

    const canEdit = deal.authorId === req.user!.id || isStaff(req.user!.role);
    if (!canEdit) return res.status(403).json({ error: 'Možete menjati samo sopstvene deal-ove.' });

    const parsed = dealBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Neispravan zahtev.' });
    }
    const body: any = parsed.data;

    // Moderacija može da označi deal kao uklonjen/proveren bez ponovne validacije cene.
    if (isStaff(req.user!.role) && (body.status || body.isVerified !== undefined)) {
      const updated = await db.deals.update(deal.id, {
        status: body.status === 'removed' ? 'removed' : body.status === 'active' ? 'active' : deal.status,
        ...(body.isVerified !== undefined ? { isVerified: Boolean(body.isVerified) } : {}),
      });
      return res.json({ deal: updated });
    }

    const validated = validateDealInput({
      title: sanitizeText(body.title ?? deal.title),
      url: body.url ?? deal.url,
      proofUrl: body.proofUrl !== undefined ? body.proofUrl : deal.proofUrl,
      price: parseNumber(body.price) ?? deal.price,
      originalPrice: parseNumber(body.originalPrice) ?? deal.originalPrice,
      currency: body.currency ?? deal.currency,
      store: body.store !== undefined ? sanitizeText(body.store) : deal.store,
      platform: body.platform ?? deal.platform,
      description: body.description !== undefined ? (body.description ? sanitizeText(body.description) : null) : deal.description,
      expiresAt: body.expiresAt !== undefined ? body.expiresAt : deal.expiresAt,
    });
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    let gameId = deal.gameId;
    if (body.gameId !== undefined || body.gameTitle || body.igdbGame) {
      gameId = await resolveGame(body).catch(() => deal.gameId);
    }

    const updated = await db.deals.update(deal.id, {
      ...validated.value,
      gameId,
      // Autor je izmenio sadržaj — moderatorska verifikacija se poništava.
      isVerified: isStaff(req.user!.role) ? deal.isVerified : false,
    });
    req.log?.info({ dealId: deal.id, editedBy: req.user!.id }, 'deal_updated');
    const [decorated] = await decorateAuthors([updated!]);
    res.json({ deal: decorated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/deals/:id — soft-delete
router.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const deal = await db.deals.findById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal nije pronađen.' });

    if (deal.authorId !== req.user!.id && !isStaff(req.user!.role)) {
      return res.status(403).json({ error: 'Možete brisati samo sopstvene deal-ove.' });
    }

    await db.deals.remove(deal.id);
    req.log?.info({ dealId: deal.id, deletedBy: req.user!.id }, 'deal_removed');
    res.json({ message: 'Deal je obrisan.' });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Glasanje ---------------------------- */

// POST /api/deals/:id/vote — up / down / null (toggle)
router.post('/:id/vote', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down' && direction !== null) {
      return res.status(400).json({ error: 'Smer glasa mora biti "up", "down" ili null.' });
    }

    const deal = await db.deals.findById(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal nije pronađen.' });
    if (deal.status === 'removed') {
      return res.status(404).json({ error: 'Deal nije pronađen.' });
    }

    // Autor ne može da glasa za sopstveni deal (nema samo-lajkova na top listi).
    if (deal.authorId === req.user!.id) {
      return res.status(403).json({ error: 'Ne možete glasati za sopstveni deal.' });
    }

    const result = await db.deals.vote(req.user!.id, deal.id, direction);

    if (result.changed && result.delta !== 0) {
      await applyAuthorKarma(deal.authorId, result.delta);
      if (direction === 'up') {
        await notify({
          userId: deal.authorId,
          type: 'upvote',
          title: 'Neko je glasao za tvoj deal',
          message: `${req.user!.username} je glasao za: ${deal.title}`,
          link: `/deals/${deal.id}`,
          actorId: req.user!.id,
        }).catch(() => {});
      }
    }

    res.json({ ...result, myVote: direction });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Igre (Game Pages) ---------------------------- */

export const gamesRouter = Router();

// GET /api/games — igre koje imaju aktivne deal-ove
gamesRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 100);
    const games = await db.games.listWithDeals(limit);
    res.json({ games });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/search?q= — autocomplete iz lokalnog kataloga
gamesRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    const games = await db.games.search(q, 10);
    res.json({ games });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/igdb?q= — IGDB pretraga (bez ključa vraća praznu listu)
gamesRouter.get('/igdb', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    if (!q.trim()) return res.json({ games: [], configured: igdbSettings().configured });
    const games = await searchIgdbGames(q, 10);
    res.json({ games, configured: igdbSettings().configured });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/games/:slug/cover — staff postavlja cover (upload iz admina)
//
// Cover inače dolazi iz IGDB-a, a bez IGDB ključa katalog ostaje bez slika.
// Ovde se prihvata URL iz `POST /api/uploads/cover` (naš bucket) ili IGDB
// `images.igdb.com` URL; proizvoljni eksterni host se odbija.
gamesRouter.patch('/:slug/cover', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const url = typeof req.body?.coverUrl === 'string' ? req.body.coverUrl.trim() : '';
    if (!url) return res.status(400).json({ error: 'Nedostaje `coverUrl`.' });
    if (url.length > 500) return res.status(400).json({ error: 'URL cover-a je predugačak.' });

    const ownStorage = isOwnStorageUrl(url);
    const igdbImage = /^https:\/\/images\.igdb\.com\//i.test(url);
    if (!ownStorage && !igdbImage) {
      return res.status(400).json({ error: 'Cover mora biti upload-ovan u naš storage ili IGDB slika.' });
    }

    const game = await db.games.findBySlug(req.params.slug);
    if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });

    const updated = await db.games.setCover(game.id, url);
    if (!updated) return res.status(404).json({ error: 'Igra nije pronađena.' });
    req.log?.info({ gameId: game.id, actor: req.user!.id }, 'game_cover_updated');
    res.json({ game: updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/:slug — igra + aktivni deals (Game Page)
gamesRouter.get('/:slug', async (req: AuthRequest, res, next) => {
  try {
    const game = await db.games.findBySlug(req.params.slug);
    if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });

    const viewer = await optionalViewer(req);
    const { deals, total } = await db.deals.list(
      { gameId: game.id, sort: 'top', limit: 24 },
      viewer?.id,
    );
    res.json({
      game,
      deals: await decorateAuthors(deals),
      total,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
