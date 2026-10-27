/**
 * 2.8.0 — GAME GUIDES (repo + javne rute)
 * ---------------------------------------
 * Repo logika (lista/sort/slug dedup/glasanje) se testira direktno nad
 * in-memory `db` (isti obrazac kao deals testovi) — auth slovo za POST je
 * pokriveno E2E (verifikovan email + CSRF). Javne GET rute idu kroz `createApp`.
 */

process.env.JWT_SECRET ||= 'test-secret-for-guides-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db, uid } from '../lib/store.js';
import type { GuideRecord } from '../lib/deals.js';

const app = createApp();

const AUTHOR = 'usr_guide_author';
const VOTER = 'usr_guide_voter';
const GAME_SLUG = 'guide-test-game';
let gameId = '';

async function ensureUser(id: string) {
  if (await db.users.findById(id)) return;
  await db.users.create({
    id,
    username: id,
    email: `${id}@example.com`,
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
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
}

function makeGuide(overrides: Partial<GuideRecord> = {}): GuideRecord {
  const now = new Date().toISOString();
  return {
    id: uid('guide'),
    gameId,
    authorId: AUTHOR,
    slug: `vodic-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Vodič za test igru',
    summary: null,
    content: `<p>${'Detaljan tekst. '.repeat(10)}</p>`,
    category: 'general',
    score: 0,
    viewsCount: 0,
    status: 'published',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureUser(AUTHOR);
  await ensureUser(VOTER);
  const game = await db.games.upsert({ slug: GAME_SLUG, title: 'Guide Test Game', coverUrl: null, releaseDate: null, igdbId: null });
  gameId = game.id;
});

describe('2.8.0 — GET /api/games/:slug/guides (javna ruta)', () => {
  it('vraća praznu listu i total 0 za igru bez vodiča', async () => {
    const response = await request(app).get(`/api/games/${GAME_SLUG}/guides`);
    expect(response.status).toBe(200);
    expect(response.body.guides).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('404 za nepostojeću igru', async () => {
    const response = await request(app).get('/api/games/nepostojeca-igra/guides');
    expect(response.status).toBe(404);
  });
});

describe('2.8.0 — GuideRepo (in-memory)', () => {
  it('create + listByGame: sort top (score) i newest', async () => {
    const t1 = new Date(Date.now() - 60000).toISOString();
    const t2 = new Date(Date.now() - 30000).toISOString();
    await db.guides.create(makeGuide({ title: 'A vodič', score: 5, createdAt: t1, updatedAt: t1 }));
    await db.guides.create(makeGuide({ title: 'B vodič', score: 10, createdAt: t2, updatedAt: t2 }));
    await db.guides.create(makeGuide({ title: 'C vodič', score: 0, status: 'draft' }));

    const top = await db.guides.listByGame(gameId, { sort: 'top' });
    expect(top.total).toBe(2); // draft nije vidljiv
    expect(top.guides[0].score).toBe(10);

    const newest = await db.guides.listByGame(gameId, { sort: 'newest' });
    // C je draft → ne sme biti u listi; najnoviji published je B (kreiran drugi).
    expect(newest.guides[0].title).toBe('B vodič');
    expect(newest.guides.every((g) => g.status === 'published')).toBe(true);

    const filtered = await db.guides.listByGame(gameId, { category: 'builds' });
    expect(filtered.total).toBe(0);
  });

  it('findBySlug i slugExists', async () => {
    const guide = await db.guides.findBySlug((await db.guides.listByGame(gameId, { sort: 'top' })).guides[0].slug);
    expect(guide).not.toBeNull();
    expect(await db.guides.slugExists(guide!.slug)).toBe(true);
    expect(await db.guides.slugExists('ne-postoji-ovaj-slug')).toBe(false);
  });

  it('vote: up → promena na down → otkaz; score prati delta', async () => {
    const guide = (await db.guides.listByGame(gameId, { sort: 'top' })).guides[0];
    const baseline = (await db.guides.findById(guide.id))!.score;
    const up = await db.guides.vote(VOTER, guide.id, 'up');
    expect(up).toMatchObject({ changed: true, delta: 1, myVote: 'up' });
    expect(up.score).toBe(baseline + 1);

    const down = await db.guides.vote(VOTER, guide.id, 'down');
    expect(down).toMatchObject({ changed: true, delta: -2, myVote: 'down' });

    const cancel = await db.guides.vote(VOTER, guide.id, null);
    expect(cancel).toMatchObject({ changed: true, delta: 1, myVote: null });
    expect((await db.guides.findById(guide.id))!.score).toBe(guide.score);

    expect(await db.guides.myVote(VOTER, guide.id)).toBeNull();
    expect(await db.guides.myVote(undefined, guide.id)).toBeNull();
  });

  it('nepoznat vodič → changed=false', async () => {
    const result = await db.guides.vote(VOTER, 'guide_ne_postoji', 'up');
    expect(result.changed).toBe(false);
  });
});

describe('2.8.0 — javna ruta sa podacima', () => {
  it('lista vraća dekorisane vodiče (autor, gameSlug)', async () => {
    const response = await request(app).get(`/api/games/${GAME_SLUG}/guides`);
    expect(response.status).toBe(200);
    expect(response.body.guides.length).toBeGreaterThan(0);
    const guide = response.body.guides[0];
    expect(guide.author).toBe(AUTHOR);
    expect(guide.gameSlug).toBe(GAME_SLUG);
    expect(guide.myVote).toBeNull(); // bez sesije
  });

  it('detalj inkrementuje views i vraća sadržaj', async () => {
    const list = await request(app).get(`/api/games/${GAME_SLUG}/guides`);
    const slug = list.body.guides[0].slug;
    const detail = await request(app).get(`/api/games/${GAME_SLUG}/guides/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.guide.viewsCount).toBeGreaterThanOrEqual(1);
    expect(detail.body.guide.content).toContain('Detaljan tekst');
  });
});
