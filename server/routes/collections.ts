import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, uid } from '../lib/store.js';
import { authenticate, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeText } from '../middleware/sanitize.js';
import { validate } from '../lib/schemas.js';
import { recordAudit } from './users.js';
import type { AuditEntry } from '../../contracts/index.js';
import {
  COLLECTION_LIMITS,
  MemoryCollectionRepo,
  SupabaseCollectionRepo,
  collectionSlug,
  type CollectionRepo,
  type CollectionRecord,
} from '../lib/collections.js';

/**
 * F-5 — KOLEKCIJE / LISTE IGARA
 * ----------------------------
 *  GET    /api/collections                 javne liste (sortirano po glasovima)
 *  GET    /api/collections/:slug            jedna lista (javno; privatna samo vlasnik)
 *  POST   /api/collections                  nova lista (auth + verifikovan email)
 *  PATCH  /api/collections/:id              naslov/opis/vidljivost (vlasnik)
 *  DELETE /api/collections/:id              brisanje (vlasnik ili staff)
 *  POST   /api/collections/:id/items        dodaj igru (vlasnik)
 *  DELETE /api/collections/:id/items/:itemId ukloni igru (vlasnik)
 *  POST   /api/collections/:id/vote          glas za listu (prijavljeni, ne vlasnik)
 */

const router = Router();

/** Repo se bira posle data layera (isti klijent kao `store.ts`). */
const repo: CollectionRepo =
  db.kind === 'supabase' && (db as any).client
    ? new SupabaseCollectionRepo((db as any).client)
    : new MemoryCollectionRepo();

const isStaff = (role?: string) => role === 'admin' || role === 'moderator';

/**
 * F-12 — prvih `limit` naslova iz kolekcija korisnika, za „gaming karticu“
 * profila. Nema posebne tabele „omiljene igre“ — lista je već to.
 */
export async function profileGames(userId: string, limit = 4): Promise<string[]> {
  const collections = await repo.listByUser(userId);
  const games: string[] = [];
  for (const collection of collections) {
    for (const item of collection.items) {
      if (games.length >= limit) return games;
      if (!games.includes(item.gameTitle)) games.push(item.gameTitle);
    }
  }
  return games;
}

/** ID prijavljenog korisnika iz cookie-ja/Bearer-a, ili `undefined` za gosta. */
async function optionalViewerId(req: AuthRequest): Promise<string | undefined> {
  const header = req.headers.authorization;
  const cookieToken = (req as any).cookies?.nx_at ?? (req as any).cookies?.token;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  if (!token) return undefined;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id?: string };
    if (!decoded.id) return undefined;
    const user = await db.users.findById(decoded.id);
    if (!user || user.isBanned) return undefined;
    return user.id;
  } catch {
    return undefined;
  }
}

function decorate(collection: CollectionRecord, authorName: string, authorAvatar?: string) {
  return {
    ...collection,
    author: authorName,
    authorAvatar: authorAvatar ?? null,
  };
}

async function withAuthor(collection: CollectionRecord) {
  const author = await db.users.findById(collection.userId).catch(() => null);
  return decorate(collection, author?.username ?? 'član', author?.avatar || undefined);
}

/** Publikuje u obliku koji očekuje `gameCollectionSchema` (bez internih polja). */
function publicShape(collection: ReturnType<typeof decorate>) {
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    isPublic: collection.isPublic,
    score: collection.score,
    authorId: collection.userId,
    author: collection.author,
    authorAvatar: collection.authorAvatar,
    items: collection.items.map((item) => ({
      id: item.id,
      gameId: item.gameId,
      gameTitle: item.gameTitle,
      gameSlug: item.gameSlug,
      gameCover: item.gameCover,
      note: item.note,
      position: item.position,
    })),
    myVote: collection.myVote,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

const createBodySchema = z.object({
  title: z.string().trim().min(3, 'Naslov liste je prekratak.').max(COLLECTION_LIMITS.titleMax),
  description: z.string().trim().max(COLLECTION_LIMITS.descriptionMax).optional().nullable(),
  isPublic: z.boolean().optional(),
});

const patchBodySchema = z.object({
  title: z.string().trim().min(3).max(COLLECTION_LIMITS.titleMax).optional(),
  description: z.string().trim().max(COLLECTION_LIMITS.descriptionMax).nullable().optional(),
  isPublic: z.boolean().optional(),
});

const itemBodySchema = z.object({
  gameId: z.string().max(64).optional().nullable(),
  gameSlug: z.string().max(200).optional().nullable(),
  gameTitle: z.string().trim().min(1, 'Izaberite igru.').max(200),
  gameCover: z.string().max(500).optional().nullable(),
  note: z.string().trim().max(COLLECTION_LIMITS.noteMax).optional().nullable(),
});

const voteBodySchema = z.object({ direction: z.enum(['up', 'down']).nullable() });

// GET /api/collections — javne liste
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 60);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined;
    const result = await repo.listPublic({ limit, offset, search });
    const collections = await Promise.all(result.collections.map(withAuthor));
    res.json({
      collections: collections.map(publicShape),
      total: result.total,
      hasMore: offset + result.collections.length < result.total,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/collections/user/:username — liste jednog korisnika
router.get('/user/:username', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    const mine = user.id === req.user!.id || isStaff(req.user!.role);
    const all = await repo.listByUser(user.id, req.user!.id);
    const visible = (mine ? all : all.filter((collection) => collection.isPublic)).map(decorateShape(user));
    res.json({ collections: visible });
  } catch (err) {
    next(err);
  }
});

function decorateShape(user: { id: string; username: string; avatar?: string }) {
  return (collection: CollectionRecord) => publicShape(decorate(collection, user.username, user.avatar || undefined));
}

// GET /api/collections/:slug — jedna lista
router.get('/:slug', async (req, res, next) => {
  try {
    // `viewer` za `myVote` i privatne liste — opciona autentifikacija: gost
    // dobija listu bez glasa, nevažeći cookie se samo ignoriše.
    const viewerId = await optionalViewerId(req);

    const collection = await repo.findBySlug(req.params.slug, viewerId);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (!collection.isPublic && collection.userId !== viewerId) {
      return res.status(404).json({ error: 'Lista nije pronađena.' });
    }
    res.json({ collection: publicShape(await withAuthor(collection)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections — nova lista
router.post('/', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(createBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });

    const title = sanitizeText(parsed.data.title);
    // Slug mora biti jedinstven; sufiks `-2`, `-3`… umesto 409 (korisnik ne bi
    // shvatio grešku „naslov već postoji“ za listu koja je njegova).
    const base = collectionSlug(title);
    let slug = base;
    for (let index = 2; index < 50; index += 1) {
      const existing = await repo.findBySlug(slug);
      if (!existing) break;
      slug = `${base}-${index}`;
    }

    const created = await repo.create({
      id: uid('col'),
      userId: req.user!.id,
      title,
      slug,
      description: parsed.data.description ? sanitizeText(parsed.data.description) : null,
      isPublic: parsed.data.isPublic !== false,
      score: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.status(201).json({ collection: publicShape(await withAuthor(created)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/collections/:id — izmena (vlasnik ili staff)
router.patch('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(patchBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });

    const collection = await repo.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (collection.userId !== req.user!.id && !isStaff(req.user!.role)) {
      return res.status(403).json({ error: 'Možete menjati samo svoje liste.' });
    }

    const updated = await repo.update(collection.id, {
      ...(parsed.data.title !== undefined ? { title: sanitizeText(parsed.data.title) } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description ? sanitizeText(parsed.data.description) : null }
        : {}),
      ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'Lista nije pronađena.' });
    res.json({ collection: publicShape(await withAuthor(updated)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const collection = await repo.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (collection.userId !== req.user!.id && !isStaff(req.user!.role)) {
      return res.status(403).json({ error: 'Možete brisati samo svoje liste.' });
    }
    await repo.remove(collection.id);
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: collection.id,
      targetUsername: collection.userId,
      action: 'comment_deleted' satisfies AuditEntry['action'],
      from: { collection: collection.title },
      to: null,
    });
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/:id/items — dodaj igru
router.post('/:id/items', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(itemBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });

    const collection = await repo.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (collection.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Samo autor može menjati sadržaj liste.' });
    }
    if (collection.items.length >= COLLECTION_LIMITS.itemsMax) {
      return res.status(400).json({ error: `Lista može imati najviše ${COLLECTION_LIMITS.itemsMax} igara.` });
    }

    // Igra iz kataloga ako postoji; inače se pamti naslov (lista nije katalog).
    const game = parsed.data.gameId
      ? await db.games.findById(parsed.data.gameId)
      : parsed.data.gameSlug
        ? await db.games.findBySlug(parsed.data.gameSlug)
        : null;
    const gameTitle = game?.title ?? sanitizeText(parsed.data.gameTitle);
    const gameSlug = game?.slug ?? (parsed.data.gameSlug ?? collectionSlug(gameTitle));

    if (collection.items.some((item) => item.gameSlug === gameSlug)) {
      return res.status(409).json({ error: 'Ta igra je već na listi.' });
    }

    const item = await repo.addItem({
      id: uid('colitem'),
      collectionId: collection.id,
      gameId: game?.id ?? null,
      gameTitle,
      gameSlug,
      gameCover: game?.coverUrl ?? parsed.data.gameCover ?? null,
      note: parsed.data.note ? sanitizeText(parsed.data.note) : null,
      position: collection.items.length,
    });

    const refreshed = await repo.findById(collection.id);
    res.status(201).json({ item, collection: refreshed ? publicShape(await withAuthor(refreshed)) : null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/items/:itemId
router.delete('/:id/items/:itemId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const collection = await repo.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (collection.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Samo autor može menjati sadržaj liste.' });
    }
    const removed = await repo.removeItem(collection.id, req.params.itemId);
    if (!removed) return res.status(404).json({ error: 'Stavka nije pronađena.' });
    const refreshed = await repo.findById(collection.id);
    res.json({ removed: true, collection: refreshed ? publicShape(await withAuthor(refreshed)) : null });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/:id/vote — glas (ne za sopstvenu listu)
router.post('/:id/vote', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(voteBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neispravan glas.' });

    const collection = await repo.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Lista nije pronađena.' });
    if (collection.userId === req.user!.id) {
      return res.status(400).json({ error: 'Ne možete glasati za sopstvenu listu.' });
    }
    if (!collection.isPublic) {
      return res.status(400).json({ error: 'Privatna lista ne može da prima glasove.' });
    }
    res.json(await repo.vote(req.user!.id, collection.id, parsed.data.direction));
  } catch (err) {
    next(err);
  }
});

export default router;
