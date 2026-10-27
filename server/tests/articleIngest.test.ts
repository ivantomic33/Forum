import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

/**
 * 2.12.0 — UVOZ VESTI IZ n8n-a
 * ---------------------------
 * `POST /api/articles/ingest` je jedina ruta koju zove automatizacija (n8n).
 * Test pokriva: ključ nije podešen → 503, pogrešan ključ → 401, prvi uvoz → 201,
 * ponovni isti `sourceUrl` → `duplicate: true` bez novog reda.
 */

const app = createApp();
const KEY = 'test-ingest-key-0123456789abcdef';

describe.skipIf(db.kind !== 'memory')('2.12.0 — POST /api/articles/ingest', () => {
  const original = process.env.ARTICLES_INGEST_API_KEY;

  beforeAll(async () => {
    try {
      await db.users.create({
        id: 'usr_ingest_author',
        username: 'ingest_author',
        email: 'ingest@example.com',
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

  afterAll(() => {
    if (original === undefined) delete process.env.ARTICLES_INGEST_API_KEY;
    else process.env.ARTICLES_INGEST_API_KEY = original;
  });

  const body = {
    title: 'Nova vest iz RSS bota',
    content: '<p>Sadržaj vesti koji ima više od dvadeset karaktera.</p>',
    sourceUrl: 'https://example.com/vest/42',
    category: 'Vesti',
    tags: ['esports'],
    authorName: 'Example Feed',
  };

  it('bez podešenog ključa → 503 INGEST_DISABLED', async () => {
    delete process.env.ARTICLES_INGEST_API_KEY;
    const res = await request(app).post('/api/articles/ingest').send(body);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('INGEST_DISABLED');
  });

  it('pogrešan ključ → 401', async () => {
    process.env.ARTICLES_INGEST_API_KEY = KEY;
    const res = await request(app)
      .post('/api/articles/ingest')
      .set('X-Ingest-Key', 'pogresan-kljuc-0123456789')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('ispravan ključ → 201, objavljeno odmah; drugi put isti sourceUrl → duplicate', async () => {
    process.env.ARTICLES_INGEST_API_KEY = KEY;
    const first = await request(app).post('/api/articles/ingest').set('X-Ingest-Key', KEY).send(body);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('published');
    expect(first.body.sourceUrl).toBe(body.sourceUrl);

    const before = (await db.articles.findAll({})).length;
    const second = await request(app)
      .post('/api/articles/ingest')
      .set('X-Ingest-Key', KEY)
      .send({ ...body, sourceUrl: `${body.sourceUrl}?utm_source=rss` });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect((await db.articles.findAll({})).length).toBe(before);
  });

  it('link koji nije https → 400', async () => {
    process.env.ARTICLES_INGEST_API_KEY = KEY;
    const res = await request(app)
      .post('/api/articles/ingest')
      .set('X-Ingest-Key', KEY)
      .send({ ...body, sourceUrl: 'http://insecure.example.com/vest' });
    expect(res.status).toBe(400);
  });
});
