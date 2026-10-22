import { Router } from 'express';
import { db, MEMORY_CATEGORIES } from '../lib/store.js';

const router = Router();

/**
 * GET /api/categories — public lista kategorija (subforuma).
 * `forum_categories` tabela se popunjava seedom iz MEMORY_CATEGORIES
 * (vidi seed.ts), pa su slugovi uvek validni za panele i forme.
 */
router.get('/', async (_req, res, next) => {
  try {
    const categories = await db.forum.listCategories();
    res.json({ categories: categories.length ? categories : MEMORY_CATEGORIES });
  } catch (err) {
    next(err);
  }
});

export default router;
