import { Router } from 'express';
import { z } from 'zod';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { sanitizeText } from '../middleware/sanitize.js';
import { validate } from '../lib/schemas.js';
import {
  COMPONENT_CATEGORIES,
  MemoryBuildRepo,
  MemoryComponentRepo,
  SupabaseBuildRepo,
  SupabaseComponentRepo,
  shareId,
  summarizeBuild,
  type BuildRepo,
  type ComponentCategory,
  type ComponentRepo,
  type PcBuild,
} from '../lib/builds.js';

/**
 * F-11 — KALKULATOR BUILD-a
 * ------------------------
 *  GET    /api/builds/catalog?category=cpu   katalog komponenti (javno)
 *  POST   /api/builds/catalog                nova komponenta (staff)
 *  PATCH  /api/builds/catalog/:id            nova cena/spec (staff)
 *  DELETE /api/builds/catalog/:id            uklanjanje (staff)
 *
 *  GET    /api/builds/:shareId               deljivi build (javno ako `isPublic`)
 *  POST   /api/builds                        sačuvaj build (auth)
 *  PATCH  /api/builds/:id                    izmeni (vlasnik)
 *  DELETE /api/builds/:id                    obriši (vlasnik)
 */

const router = Router();

const client = db.kind === 'supabase' ? (db as any).client : null;
const components: ComponentRepo = client ? new SupabaseComponentRepo(client) : new MemoryComponentRepo();
const builds: BuildRepo = client ? new SupabaseBuildRepo(client) : new MemoryBuildRepo();

const categoryIds = COMPONENT_CATEGORIES.map((category) => category.id) as [ComponentCategory, ...ComponentCategory[]];

const componentBodySchema = z.object({
  category: z.enum(categoryIds),
  name: z.string().trim().min(2, 'Naziv komponente je prekratak.').max(140),
  brand: z.string().trim().max(60).optional().nullable(),
  spec: z.string().trim().max(160).optional().nullable(),
  price: z.number().positive('Cena mora biti veća od nule.').max(10_000_000),
  currency: z.enum(['RSD', 'EUR']).optional(),
  store: z.string().trim().min(2, 'Navedite prodavnicu.').max(80),
  url: z.string().url('Unesite ispravan link.').max(1000).optional().nullable(),
  imageUrl: z.string().url().max(1000).optional().nullable(),
});

const itemSchema = z.object({
  componentId: z.string().min(1),
  qty: z.number().int().min(1).max(10).optional(),
});

const buildBodySchema = z.object({
  title: z.string().trim().min(3, 'Naslov build-a je prekratak.').max(120),
  items: z.array(itemSchema).max(30),
  isPublic: z.boolean().optional(),
});

// GET /api/builds/catalog — katalog (javno; bez kodiranja kategorija u UI)
router.get('/catalog', async (req, res, next) => {
  try {
    const raw = typeof req.query.category === 'string' ? req.query.category : undefined;
    const category = raw && categoryIds.includes(raw as ComponentCategory) ? (raw as ComponentCategory) : undefined;
    const list = await components.list(category);
    res.json({ components: list, categories: COMPONENT_CATEGORIES });
  } catch (err) {
    next(err);
  }
});

// POST /api/builds/catalog — staff unosi/obnavlja cenu
router.post('/catalog', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(componentBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });
    const created = await components.create({
      id: uid('part'),
      category: parsed.data.category,
      name: sanitizeText(parsed.data.name),
      brand: parsed.data.brand ? sanitizeText(parsed.data.brand) : null,
      spec: parsed.data.spec ? sanitizeText(parsed.data.spec) : null,
      price: parsed.data.price,
      currency: parsed.data.currency ?? 'RSD',
      store: sanitizeText(parsed.data.store),
      url: parsed.data.url ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      createdBy: req.user!.id,
      updatedAt: new Date().toISOString(),
    });
    res.status(201).json({ component: created });
  } catch (err) {
    next(err);
  }
});

router.patch('/catalog/:id', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(componentBodySchema.partial(), req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });
    const updated = await components.update(req.params.id, {
      ...parsed.data,
      ...(parsed.data.name ? { name: sanitizeText(parsed.data.name) } : {}),
      ...(parsed.data.store ? { store: sanitizeText(parsed.data.store) } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'Komponenta nije pronađena.' });
    res.json({ component: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/catalog/:id', authenticate, authorize('admin', 'moderator'), async (req, res, next) => {
  try {
    const removed = await components.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Komponenta nije pronađena.' });
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/builds/mine — moji sačuvani build-ovi
router.get('/mine', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const list = await builds.listByUser(req.user!.id);
    res.json({ builds: list });
  } catch (err) {
    next(err);
  }
});

/** Deljeni oblik: component + qty + subtotal + ukupna cena i nedostajući delovi. */
async function publicBuild(build: PcBuild) {
  const all = await components.list();
  const summary = summarizeBuild(all, build.items);
  return {
    id: build.id,
    shareId: build.shareId,
    title: build.title,
    ownerId: build.userId,
    isPublic: build.isPublic,
    createdAt: build.createdAt,
    total: summary.total,
    missing: summary.missing,
    complete: summary.complete,
    parts: summary.parts.map((part) => ({
      component: part.component,
      qty: part.qty,
      subtotal: part.subtotal,
    })),
  };
}

// GET /api/builds/:shareId — deljivi build (bez prijave ako je javan)
router.get('/:shareId', async (req, res, next) => {
  try {
    const build = await builds.findByShareId(req.params.shareId);
    if (!build) return res.status(404).json({ error: 'Build nije pronađen.' });
    if (!build.isPublic) return res.status(404).json({ error: 'Build nije pronađen.' });
    res.json({ build: await publicBuild(build) });
  } catch (err) {
    next(err);
  }
});

// POST /api/builds — sačuvaj build (i vrati deljivi link)
router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(buildBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });

    // Filtriraj nepostojeće komponente (klijent može da pošalje stale katalog).
    const known = new Set((await components.list()).map((component) => component.id));
    const items = parsed.data.items
      .filter((item) => known.has(item.componentId))
      .map((item) => ({ componentId: item.componentId, qty: item.qty ?? 1 }));
    if (!items.length) return res.status(400).json({ error: 'Izaberite bar jednu komponentu.' });

    const now = new Date().toISOString();
    const build = await builds.create({
      id: uid('build'),
      userId: req.user!.id,
      title: sanitizeText(parsed.data.title),
      items,
      isPublic: parsed.data.isPublic !== false,
      shareId: shareId(),
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ build: await publicBuild(build) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const build = await builds.findById(req.params.id);
    if (!build) return res.status(404).json({ error: 'Build nije pronađen.' });
    if (build.userId !== req.user!.id) return res.status(403).json({ error: 'Možete menjati samo svoje build-ove.' });

    const parsed = validate(buildBodySchema.partial(), req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });
    const updated = await builds.update(build.id, {
      ...(parsed.data.title ? { title: sanitizeText(parsed.data.title) } : {}),
      ...(parsed.data.items
        ? { items: parsed.data.items.map((item) => ({ componentId: item.componentId, qty: item.qty ?? 1 })) }
        : {}),
      ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'Build nije pronađen.' });
    res.json({ build: await publicBuild(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const build = await builds.findById(req.params.id);
    if (!build) return res.status(404).json({ error: 'Build nije pronađen.' });
    if (build.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Možete brisati samo svoje build-ove.' });
    }
    await builds.remove(build.id);
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

export default router;
