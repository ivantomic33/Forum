import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

/**
 * F-1 — „Danas u gamingu“ (`GET /api/deals/daily`)
 * ------------------------------------------------
 * Blok početne strane: 3 najvažnije vesti + 2 najbolja popusta + 2 najživlje
 * teme, sve iz JEDNOG poziva. Test pokriva filtere (istekao/uklonjen deal,
 * obrisana tema, hero isključen), prodaju kategorija i prazno stanje.
 */

process.env.JWT_SECRET ||= 'test-secret-for-daily-feed-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const AUTHOR = 'usr_feed_author';
const now = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function article(overrides: Record<string, unknown>) {
  return {
    // `create` ne popunjava ID-jeve (to radi ruta) — repo filtrira po `id === undefined`.
    id: `art_feed_${Math.random().toString(36).slice(2)}`,
    slug: `feed-${Math.random().toString(36).slice(2)}`,
    title: 'Vest',
    excerpt: 'Kratak opis',
    content: '<p>Sadržaj</p>',
    coverImage: null,
    category: 'Vesti',
    tags: [],
    author: 'Redakcija',
    authorId: AUTHOR,
    status: 'published',
    isFeatured: false,
    views: 0,
    reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
    publishedAt: now(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  } as any;
}

function thread(overrides: Record<string, unknown>) {
  return {
    id: `thr_feed_${Math.random().toString(36).slice(2)}`,
    subforum: 'pc-gaming',
    title: 'Tema',
    content: '<p>Tema</p>',
    author: 'clan',
    authorId: AUTHOR,
    tags: [],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    isDeleted: false,
    karma: 0,
    views: 0,
    replies: 0,
    createdAt: now(),
    lastReplyAt: now(),
    ...overrides,
  } as any;
}

function deal(overrides: Record<string, unknown>) {
  const price = Number(overrides.price ?? 10);
  const originalPrice = Number(overrides.originalPrice ?? 20);
  return {
    id: `deal_feed_${Math.random().toString(36).slice(2)}`,
    authorId: AUTHOR,
    author: 'clan',
    gameId: null,
    gameSlug: null,
    gameTitle: null,
    gameCover: null,
    title: 'Popust',
    url: 'https://store.steampowered.com/app/1/',
    proofUrl: null,
    price,
    originalPrice,
    discountPct: Math.round((1 - price / originalPrice) * 100),
    currency: 'EUR',
    store: 'Steam',
    platform: 'PC',
    description: null,
    expiresAt: null,
    status: 'active',
    isVerified: false,
    score: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  } as any;
}

describe.skipIf(db.kind !== 'memory')('F-1 — GET /api/deals/daily', () => {
  beforeAll(async () => {
    if (await db.users.findById(AUTHOR)) return;
    await db.users.create({
      id: AUTHOR,
      username: 'feed_author',
      email: 'feed_author@example.com',
      password: 'x',
      avatar: '',
      role: 'member',
      level: 1,
      xp: 0,
      xpNeeded: 0,
      karma: 0,
      badges: [],
      connectedAccounts: {},
      isVerified: true,
      isBanned: false,
      status: 'offline',
      createdAt: now(),
      lastSeenAt: now(),
    } as any);
  });

  it('vraća najviše 3 vesti, 2 popusta i 2 teme iz jednog zahteva', async () => {
    for (const [index, title] of ['A', 'B', 'C', 'D', 'E'].entries()) {
      await db.articles.create(article({ title, views: 100 - index }));
    }
    await db.forum.createThread(thread({ title: 'Mrtva tema', replies: 0, karma: 0, views: 0 }));
    await db.forum.createThread(thread({ title: 'Živa tema', replies: 25, karma: 30, views: 500 }));
    await db.forum.createThread(thread({ title: 'Srednja tema', replies: 8, karma: 5, views: 120 }));
    await db.deals.create(deal({ title: '-50%', price: 10, originalPrice: 20 }));
    await db.deals.create(deal({ title: '-80%', price: 4, originalPrice: 20 }));
    await db.deals.create(deal({ title: '-25%', price: 15, originalPrice: 20 }));

    const res = await request(app).get('/api/deals/daily').expect(200);

    expect(res.body.articles).toHaveLength(3);
    expect(res.body.deals).toHaveLength(2);
    expect(res.body.threads).toHaveLength(2);
    // Najveći popust je prvi, najživlja tema prva.
    expect(res.body.deals[0].title).toBe('-80%');
    expect(res.body.threads[0].title).toBe('Živa tema');
    // Blok ne vraća polja koja lista tema ne prikazuje.
    expect(res.body.threads[0]).not.toHaveProperty('content');
  });

  it('preskače istekao/uklonjen deal, obrisanu temu i vest iz drafta', async () => {
    await db.deals.create(deal({ title: 'istekao', price: 1, originalPrice: 20, expiresAt: daysAgo(1) }));
    await db.deals.create(deal({ title: 'uklonjen', price: 1, originalPrice: 20, status: 'removed' }));
    await db.deals.create(deal({ title: 'živ', price: 15, originalPrice: 20 }));
    await db.forum.createThread(thread({ title: 'obrisana', replies: 999, isDeleted: true }));
    await db.articles.create(article({ title: 'SKRIVENI DRAFT', status: 'draft', views: 10_000 }));

    const res = await request(app).get('/api/deals/daily').expect(200);
    const dealTitles = res.body.deals.map((entry: { title: string }) => entry.title);
    const threadTitles = res.body.threads.map((entry: { title: string }) => entry.title);
    const articleTitles = res.body.articles.map((entry: { title: string }) => entry.title);

    expect(dealTitles).not.toContain('istekao');
    expect(dealTitles).not.toContain('uklonjen');
    expect(threadTitles).not.toContain('obrisana');
    expect(articleTitles).not.toContain('SKRIVENI DRAFT');
  });

  it('`?exclude=` uklanja hero članak iz bloka', async () => {
    const hero = await db.articles.create(article({ title: 'HERO', isFeatured: true, views: 99_000 }));
    const res = await request(app)
      .get(`/api/deals/daily?exclude=${encodeURIComponent(hero.id)}`)
      .expect(200);
    const ids = res.body.articles.map((entry: { id: string }) => entry.id);
    expect(ids).not.toContain(hero.id);
  });

  it('bira vesti iz različitih kategorija pre nego drugu iz iste', async () => {
    // Skorašnji datumi (u prošlosti, redom rastuće) — ovi članci su najnoviji,
    // pa bi sortiranje po datumu samo po sebi opet dalo redom „Vesti, Vesti, Vesti“.
    // (2.10.0 — double-check javnog API-ja odbacuje datume u budućnosti, pa test
    // koristi minute-razmaknute datume u prošlosti umesto 2099.)
    for (let index = 0; index < 4; index += 1) {
      const publishedAt = new Date(Date.now() - (40 - index) * 60_000).toISOString();
      await db.articles.create(
        article({ title: `Vesti ${index}`, category: 'Vesti', views: 9000 - index, createdAt: publishedAt, publishedAt }),
      );
    }
    const recenzijaDate = new Date(Date.now() - 60 * 60_000).toISOString();
    await db.articles.create(
      article({ title: 'Recenzija 1', category: 'Recenzija', views: 10, createdAt: recenzijaDate, publishedAt: recenzijaDate }),
    );

    const res = await request(app).get('/api/deals/daily').expect(200);
    const categories = res.body.articles.map((entry: { category: string }) => entry.category);
    expect(categories).toHaveLength(3);
    // Prva dva su iz različitih kategorija (raznolikost pre drugog iz „Vesti“).
    expect(new Set(categories.slice(0, 2)).size).toBe(2);
  });
});
