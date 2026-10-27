import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db, type ArticleRecord } from '../lib/store.js';
import { createArticleSchema } from '../lib/schemas.js';
import { publishScheduledArticlesJob } from '../lib/scheduledArticles.js';

/**
 * 2.10.0 — SCHEDULED PUBLISHING
 * -----------------------------
 * Scenario iz specifikacije: zakazan članak je nevidljiv javno dok traje
 * zakazani termin, job ga atomski aktivira, posle toga je javno vidljiv.
 * Plus: server validacija budućnosti (≥5 min) i javni double-check po datumu.
 */

const app = createApp();

function articleFixture(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  const now = new Date().toISOString();
  return {
    id: `art_${Math.random().toString(36).slice(2, 10)}`,
    slug: `test-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Zakazani test članak',
    excerpt: '',
    content: '<p>Sadržaj dovoljno dugačak za validaciju šeme — 20+ karaktera.</p>',
    coverImage: '',
    authorId: 'usr_sched_author',
    author: 'sched_author',
    category: 'Vesti',
    tags: [],
    status: 'scheduled',
    isFeatured: false,
    views: 0,
    reactions: {},
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe.skipIf(db.kind !== 'memory')('2.10.0 — zakazano objavljivanje članaka', () => {
  beforeAll(async () => {
    try {
      await db.users.create({
        id: 'usr_sched_author',
        username: 'sched_author',
        email: 'sched@example.com',
        password: 'x',
        avatar: '',
        role: 'admin',
        level: 1,
        xp: 0,
        xpNeeded: 0,
        karma: 0,
        badges: [],
        connectedAccounts: {},
        isVerified: true,
        isBanned: false,
        status: 'offline',
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      } as any);
    } catch {
      /* već postoji */
    }
  });

  it('šema: scheduled bez scheduledFor i u prošlosti → odbijeno; ≥5 min u budućnosti → ok', () => {
    const base = { title: 'Zakazana vest', content: '<p>Sadržaj dovoljno dugačak za šemu.</p>' };
    expect(createArticleSchema.safeParse({ ...base, status: 'scheduled' }).success).toBe(false);

    const soon = new Date(Date.now() + 60_000).toISOString(); // 1 min — premalo
    expect(createArticleSchema.safeParse({ ...base, status: 'scheduled', scheduledFor: soon }).success).toBe(false);

    const ok = new Date(Date.now() + 10 * 60_000).toISOString(); // 10 min
    expect(createArticleSchema.safeParse({ ...base, status: 'scheduled', scheduledFor: ok }).success).toBe(true);
  });

  it('šema: published sa scheduledFor prolazi (polje se ignoriše na serveru)', () => {
    const ok = new Date(Date.now() + 10 * 60_000).toISOString();
    const parsed = createArticleSchema.safeParse({
      title: 'Odmah objava',
      content: '<p>Sadržaj dovoljno dugačak za šemu.</p>',
      status: 'published',
      scheduledFor: ok,
    });
    expect(parsed.success).toBe(true);
  });

  it('publishDue aktivira samo dospelu `scheduled`, ostale ne dira; published_at = zakazani trenutak', async () => {
    const past = articleFixture({
      title: 'Dospeo članak',
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const future = articleFixture({
      title: 'Budući članak',
      publishedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    await db.articles.create(past);
    await db.articles.create(future);

    const published = await db.articles.publishDue();
    const ids = published.map((a) => a.id);
    expect(ids).toContain(past.id);
    expect(ids).not.toContain(future.id);

    const afterPast = await db.articles.findById(past.id);
    expect(afterPast?.status).toBe('published');
    // Datum objave = zakazani trenutak (job ga ne pomera).
    expect(afterPast?.publishedAt).toBe(past.publishedAt);

    const afterFuture = await db.articles.findById(future.id);
    expect(afterFuture?.status).toBe('scheduled');

    // Idempotentno: drugi tik ne vraća ništa.
    expect((await db.articles.publishDue()).map((a) => a.id)).not.toContain(past.id);
  });

  it('job publishScheduledArticlesJob: vraća broj i ne baca grešku', async () => {
    const count = await publishScheduledArticlesJob();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('javni API: zakazan članak je 404 za javnost, a posle job-a vidljiv', async () => {
    // Zakazan za 2 minuta u budućnosti — job ga JOŠ NE SME da aktivira.
    const when = new Date(Date.now() + 2 * 60_000).toISOString();
    const scheduled = articleFixture({ title: 'Zakazana e3 vest', publishedAt: when });
    await db.articles.create(scheduled);
    const slug = scheduled.slug;

    // Pre roka: javno 404 i nema ga u listi.
    expect((await request(app).get(`/api/articles/${slug}`)).status).toBe(404);
    const listBefore = await request(app).get('/api/articles');
    expect((listBefore.body.articles as Array<{ slug: string }>).some((a) => a.slug === slug)).toBe(false);
    expect((await db.articles.publishDue()).some((a) => a.slug === slug)).toBe(false);
    expect((await db.articles.findBySlug(slug))?.status).toBe('scheduled');

    // Rok je prošao (simulacija proteklih 2 minuta).
    await db.articles.update(scheduled.id, { publishedAt: new Date(Date.now() - 1000).toISOString() });

    // Job: ručno aktiviraj tik (ne čeka se 60 s tajmera).
    const published = await db.articles.publishDue();
    expect(published.some((a) => a.slug === slug)).toBe(true);

    // Posle roka: javno vidljiv.
    expect((await request(app).get(`/api/articles/${slug}`)).status).toBe(200);
    const listAfter = await request(app).get('/api/articles');
    expect((listAfter.body.articles as Array<{ slug: string }>).some((a) => a.slug === slug)).toBe(true);
  });

  it('double-check: `published` članak sa publishedAt u budućnosti je nevidljiv javno', async () => {
    const rogue = articleFixture({
      status: 'published',
      publishedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      slug: `rogue-${Math.random().toString(36).slice(2, 10)}`,
    });
    await db.articles.create(rogue);

    expect((await request(app).get(`/api/articles/${rogue.slug}`)).status).toBe(404);
    const list = await request(app).get('/api/articles');
    expect((list.body.articles as Array<{ slug: string }>).some((a) => a.slug === rogue.slug)).toBe(false);
  });
});
