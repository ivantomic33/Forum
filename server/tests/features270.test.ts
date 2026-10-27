import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { computeStreak, dayKey, type DailyRow } from '../lib/dailyLoop.js';
import { summarizeBuild } from '../lib/builds.js';

/**
 * 2.7.0 — testovi za F-2 / F-4 / F-5 / F-9 / F-10 / F-11.
 *
 * Store je uvek memorijski (`NODE_ENV=test`), pa su ovo i integracioni testovi
 * kroz stvarni Express (cookie, Zod, status kodovi) i unit testovi čiste logike
 * (streak, sabiranje build-a).
 */

process.env.JWT_SECRET ||= 'test-secret-for-270-tests-0123456789abcd';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
app.set('trust proxy', 1);

const now = () => new Date().toISOString();

async function makeUser(id: string, overrides: Record<string, unknown> = {}) {
  return db.users.create({
    id,
    username: id,
    email: `${id}@example.com`,
    password: 'x',
    avatar: '',
    role: 'member',
    level: 1,
    xp: 0,
    xpNeeded: 100,
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: true,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: now(),
    lastSeenAt: now(),
    ...overrides,
  } as any);
}

function tokenFor(id: string) {
  return jwt.sign({ id, username: id, role: 'member', tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function makeDeal(id: string, authorId: string, overrides: Record<string, unknown> = {}) {
  const price = Number(overrides.price ?? 10);
  const originalPrice = Number(overrides.originalPrice ?? 20);
  return db.deals.create({
    id,
    authorId,
    author: authorId,
    gameId: null,
    gameSlug: null,
    gameTitle: null,
    gameCover: null,
    title: 'Deal',
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
  } as any);
}

describe.skipIf(db.kind !== 'memory')('2.7.0 — integracija', () => {
  let sellerToken = '';
  let buyerToken = '';

  beforeAll(async () => {
    await makeUser('seller');
    await makeUser('buyer');
    await makeUser('moder', { role: 'moderator' });
    sellerToken = tokenFor('seller');
    buyerToken = tokenFor('buyer');
  });

  describe('F-9 — „Kupio sam“', () => {
    it('prvi klik upisuje oznaku, drugi ne duplira broj, DELETE je uklanja', async () => {
      const deal = await makeDeal('deal_claim_1', 'seller');

      const first = await request(app).post(`/api/deals/${deal.id}/claim`).set(auth(buyerToken)).expect(200);
      expect(first.body).toEqual({ claimed: true, count: 1 });

      // Idempotentno: UNIQUE (deal, user) — drugi klik ne pravi drugi red.
      const second = await request(app).post(`/api/deals/${deal.id}/claim`).set(auth(buyerToken)).expect(200);
      expect(second.body.count).toBe(1);

      const detail = await request(app).get(`/api/deals/${deal.id}`).set(auth(buyerToken)).expect(200);
      expect(detail.body.deal.claimCount).toBe(1);
      expect(detail.body.deal.myClaim).toBe(true);

      const removed = await request(app).delete(`/api/deals/${deal.id}/claim`).set(auth(buyerToken)).expect(200);
      expect(removed.body).toEqual({ claimed: false, count: 0 });
    });

    it('gost ne može da potvrdi, a autor ne može sopstveni deal', async () => {
      const deal = await makeDeal('deal_claim_2', 'seller');
      await request(app).post(`/api/deals/${deal.id}/claim`).expect(401);
      await request(app).post(`/api/deals/${deal.id}/claim`).set(auth(sellerToken)).expect(400);
    });
  });

  describe('F-4 — praćenje cene', () => {
    it('drugi POST za istu igru samo menja prag (nema duplikata)', async () => {
      const game = await db.games.upsert({ slug: 'price-test-game', title: 'Price Test', coverUrl: null, releaseDate: null, igdbId: null });

      const first = await request(app)
        .post('/api/deals/watch')
        .set(auth(buyerToken))
        .send({ gameId: game.id, targetPrice: 30 })
        .expect(201);
      expect(first.body.updated).toBe(false);

      const second = await request(app)
        .post('/api/deals/watch')
        .set(auth(buyerToken))
        .send({ gameId: game.id, targetPrice: 20 })
        .expect(200);
      expect(second.body.updated).toBe(true);
      expect(second.body.watch.targetPrice).toBe(20);

      const mine = await request(app).get('/api/deals/watch').set(auth(buyerToken)).expect(200);
      expect(mine.body.watches.filter((w: any) => w.gameId === game.id)).toHaveLength(1);
    });

    it('lista praćenja je privatna (gost dobija 401)', async () => {
      await request(app).get('/api/deals/watch').expect(401);
    });
  });

  describe('F-5 — kolekcije', () => {
    it('kreira listu, dodaje igre i odbija duplikat', async () => {
      const created = await request(app)
        .post('/api/collections')
        .set(auth(buyerToken))
        .send({ title: 'Top 10 RPG 2026', description: 'Najbolji RPG naslovi' })
        .expect(201);
      const slug = created.body.collection.slug;
      expect(slug).toBe('top-10-rpg-2026');

      const id = created.body.collection.id;
      await request(app)
        .post(`/api/collections/${id}/items`)
        .set(auth(buyerToken))
        .send({ gameTitle: "Baldur's Gate 3" })
        .expect(201);
      await request(app)
        .post(`/api/collections/${id}/items`)
        .set(auth(buyerToken))
        .send({ gameTitle: "Baldur's Gate 3" })
        .expect(409);

      const detail = await request(app).get(`/api/collections/${slug}`).expect(200);
      expect(detail.body.collection.items).toHaveLength(1);
      expect(detail.body.collection.author).toBe('buyer');
    });

    it('drugi korisnik ne može da menja tuđu listu, ali može da glasa', async () => {
      const created = await request(app)
        .post('/api/collections')
        .set(auth(buyerToken))
        .send({ title: 'Co-op igre' })
        .expect(201);
      const id = created.body.collection.id;

      await request(app)
        .post(`/api/collections/${id}/items`)
        .set(auth(sellerToken))
        .send({ gameTitle: 'It Takes Two' })
        .expect(403);

      const vote = await request(app).post(`/api/collections/${id}/vote`).set(auth(sellerToken)).send({ direction: 'up' }).expect(200);
      expect(vote.body).toMatchObject({ score: 1, myVote: 'up' });

      // Vlasnik ne glasa za sebe.
      await request(app).post(`/api/collections/${id}/vote`).set(auth(buyerToken)).send({ direction: 'up' }).expect(400);
    });

    it('privatna lista vraća 404 gostu', async () => {
      const created = await request(app)
        .post('/api/collections')
        .set(auth(buyerToken))
        .send({ title: 'Tajna lista', isPublic: false })
        .expect(201);
      await request(app).get(`/api/collections/${created.body.collection.slug}`).expect(404);
    });
  });

  describe('F-10 — upozorenja i vraćanje teme', () => {
    const moderToken = () => jwt.sign({ id: 'moder', username: 'moder', role: 'moderator', tv: 0 }, process.env.JWT_SECRET as string);

    it('moderator upozorava korisnika; običan član ne može', async () => {
      await request(app)
        .post('/api/users/buyer/warnings')
        .set(auth(buyerToken))
        .send({ reason: 'Probni razlog zbog pravila' })
        .expect(403);

      const created = await request(app)
        .post('/api/users/buyer/warnings')
        .set(auth(moderToken()))
        .send({ reason: 'Vređanje u temi — pravilo 3.2', expiresInDays: 30 })
        .expect(201);
      expect(created.body.activeCount).toBe(1);

      const mine = await request(app).get('/api/users/buyer/warnings').set(auth(buyerToken)).expect(200);
      expect(mine.body.activeCount).toBe(1);

      // Potvrda skida baner, ali upozorenje ostaje u istoriji.
      await request(app).post(`/api/users/buyer/warnings/${created.body.warning.id}/acknowledge`).set(auth(buyerToken)).expect(200);
      const afterAck = await request(app).get('/api/users/buyer/warnings').set(auth(buyerToken)).expect(200);
      expect(afterAck.body.warningCount ?? afterAck.body.warnings[0].acknowledgedAt).toBeTruthy();
    });

    it('tema se soft-briše i vraća preko `restoreThread`', async () => {
      const thread = await db.forum.createThread({
        id: 'thr_restore_1',
        subforum: 'pc-gaming',
        title: 'Tema za vraćanje',
        content: '<p>x</p>',
        author: 'buyer',
        authorId: 'buyer',
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
      } as any);

      await request(app).patch(`/api/forum/threads/${thread.id}/moderate`).set(auth(moderToken())).send({ deleteThread: true }).expect(200);
      expect((await db.forum.findThread(thread.id))?.isDeleted).toBe(true);

      await request(app)
        .patch(`/api/forum/threads/${thread.id}/moderate`)
        .set(auth(moderToken()))
        .send({ restoreThread: true })
        .expect(200);
      expect((await db.forum.findThread(thread.id))?.isDeleted).toBe(false);
    });
  });

  describe('F-11 — kalkulator build-a', () => {
    const staffToken = () => jwt.sign({ id: 'moder', username: 'moder', role: 'moderator', tv: 0 }, process.env.JWT_SECRET as string);

    it('staff puni katalog, korisnik pravi build sa deljivim linkom', async () => {
      const cpu = await request(app)
        .post('/api/builds/catalog')
        .set(auth(staffToken()))
        .send({ category: 'cpu', name: 'Ryzen 7 7800X3D', price: 45000, store: 'Gigatron', currency: 'RSD' })
        .expect(201);
      const gpu = await request(app)
        .post('/api/builds/catalog')
        .set(auth(staffToken()))
        .send({ category: 'gpu', name: 'RTX 4070', price: 90000, store: 'Emmi', currency: 'RSD' })
        .expect(201);

      await request(app)
        .post('/api/builds/catalog')
        .set(auth(buyerToken))
        .send({ category: 'cpu', name: 'X', price: 1, store: 'X' })
        .expect(403);

      const created = await request(app)
        .post('/api/builds')
        .set(auth(buyerToken))
        .send({
          title: 'Build za 1440p',
          items: [
            { componentId: cpu.body.component.id, qty: 1 },
            { componentId: gpu.body.component.id, qty: 1 },
          ],
        })
        .expect(201);

      expect(created.body.build.total).toBe(135000);
      expect(created.body.build.complete).toBe(false);
      expect(created.body.build.missing.length).toBeGreaterThan(0);

      // Deljivi link radi bez prijave.
      const shared = await request(app).get(`/api/builds/${created.body.build.shareId}`).expect(200);
      expect(shared.body.build.title).toBe('Build za 1440p');
      expect(shared.body.build.parts).toHaveLength(2);
    });

    it('summarizeBuild sabira količine i vraća nedostajuće obavezne delove', () => {
      const components = [
        { id: 'a', category: 'cpu', name: 'CPU', brand: null, spec: null, price: 100, currency: 'RSD', store: 'S', url: null, imageUrl: null, createdBy: null, updatedAt: now() },
        { id: 'b', category: 'ram', name: 'RAM', brand: null, spec: null, price: 50, currency: 'RSD', store: 'S', url: null, imageUrl: null, createdBy: null, updatedAt: now() },
      ] as any[];
      const summary = summarizeBuild(components, [
        { componentId: 'a', qty: 1 },
        { componentId: 'b', qty: 2 },
      ]);
      expect(summary.total).toBe(200);
      expect(summary.missing).toContain('Grafička kartica');
      expect(summary.complete).toBe(false);
    });
  });

  describe('F-2 — dnevni loop', () => {
    it('streak broji uzastopne dane i prekida se na praznini', () => {
      const day = (offset: number) => {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        return dayKey(date);
      };
      const rows: DailyRow[] = [
        { userId: 'u', day: day(0), posts: 1, xp: 10, bonusClaimed: true, questCompleted: false },
        { userId: 'u', day: day(1), posts: 2, xp: 5, bonusClaimed: true, questCompleted: true },
        { userId: 'u', day: day(2), posts: 1, xp: 5, bonusClaimed: true, questCompleted: false },
        // day(3) namerno fali — streak se prekida
        { userId: 'u', day: day(4), posts: 1, xp: 5, bonusClaimed: true, questCompleted: false },
      ];
      const { streak, best } = computeStreak(rows);
      expect(streak).toBe(3);
      expect(best).toBe(3);
    });

    it('`GET /api/users/me/daily` vraća 7 dana i dnevni kvest', async () => {
      const res = await request(app).get('/api/users/me/daily').set(auth(buyerToken)).expect(200);
      expect(res.body.days).toHaveLength(7);
      expect(res.body.quest.target).toBe(1);
      expect(typeof res.body.streak).toBe('number');
    });
  });
});
