/**
 * GET /api/search — objedinjena pretraga (2.6.2)
 *
 *   /api/search?q=hogwarts                    → po 10 članaka/tema/deal-ova
 *   /api/search?q=hogwarts&type=threads&limit=20
 *   /api/search?q=hogwarts&type=replies      → pogoci u odgovorima foruma
 *   /api/search?q=ho                           → 400 (minimum 2 znaka)
 *
 * Ruta je javna (gost pretražuje isto što i prijavljeni); rate limit je u
 * `index.ts` po IP-u. Logika i fallback su u `lib/search.ts`.
 */
import { Router } from 'express';
import { searchAll, MIN_QUERY_LENGTH, TS_CONFIG, type SearchType } from '../lib/search.js';

const router = Router();

const TYPES: SearchType[] = ['all', 'articles', 'threads', 'replies', 'deals'];

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < MIN_QUERY_LENGTH) {
      return res.status(400).json({
        error: `Unesite najmanje ${MIN_QUERY_LENGTH} znaka za pretragu.`,
        code: 'QUERY_TOO_SHORT',
        hits: [],
        total: 0,
      });
    }

    const type = (TYPES as string[]).includes(String(req.query.type)) ? (req.query.type as SearchType) : 'all';
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);
    const { hits, total, suggestion } = await searchAll({ q, type, limit });

    // Rezultati zavise od query-ja — nikad iz keša.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ query: q, type, hits, total, suggestion, tsConfig: TS_CONFIG });
  } catch (err) {
    next(err);
  }
});

export default router;
