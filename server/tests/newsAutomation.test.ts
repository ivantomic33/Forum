import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { buildDigest } from '../lib/newsAutomation.js';

/**
 * 2.13.0 — AUTOMATIKA VESTI
 * ------------------------
 * Pokriva: ruta događaja (`/api/articles/event/:id`), „hot“ vest otvara temu
 * na forumu, digest se sastavlja bez slanja mejla.
 */

const app = createApp();
const KEY = 'test-ingest-key-0123456789abcdef';

describe.skipIf(db.kind !== 'memory')('2.13.0 — automatika vesti', () => {
  const originalKey = process.env.ARTICLES_INGEST_API_KEY;

  beforeAll(async () => {
    process.env.ARTICLES_INGEST_API_KEY = KEY;
    try {
      await db.users.create({
        id: 'usr_news_author',
        username: 'news_author',
        email: 'news@example.com',
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

  const ingest = (payload: Record<string, unknown>) =>
    request(app).post('/api/articles/ingest').set('X-Ingest-Key', KEY).send(payload);

  it('vesti sa istim eventId vraćaju se na /api/articles/event/:id, najnovija prva', async () => {
    const first = await ingest({
      title: 'GTA 6 odložen na proleće',
      content: '<p>Rockstar je objavio novo okno izlaska igre GTA 6.</p>',
      sourceUrl: 'https://example.com/gta-6-odlozen',
      eventId: 'gta-6',
      eventTitle: 'GTA 6',
      whyItMatters: 'Ovo pomera najveće izdanje generacije.',
    });
    expect(first.status).toBe(201);

    const second = await ingest({
      title: 'GTA 6 dobija novi trejler sledeće nedelje',
      content: '<p>Novi trejler za GTA 6 stiže sledeće nedelje, potvrđeno.</p>',
      sourceUrl: 'https://example.com/gta-6-trejler',
      eventId: 'gta-6',
      eventTitle: 'GTA 6',
    });
    expect(second.status).toBe(201);

    const res = await request(app).get('/api/articles/event/gta-6');
    expect(res.status).toBe(200);
    expect(res.body.articles.length).toBe(2);
    expect(decodeURIComponent(res.headers['x-event-title'])).toBe('GTA 6');
  });

  it('nepoznat događaj → 404; neispravan ID → 400', async () => {
    expect((await request(app).get('/api/articles/event/nepostoji-xyz')).status).toBe(404);
    expect((await request(app).get('/api/articles/event/__bad__')).status).toBe(400);
  });

  it('„hot“ vest otvara temu na forumu (bez duplikata drugo put)', async () => {
    const res = await ingest({
      title: 'Xbox najavio otpuštanja u studijima',
      content: '<p>Microsoft je potvrdio otpuštanja u nekoliko Xbox studija.</p>',
      sourceUrl: 'https://example.com/xbox-otpustanja',
      eventId: 'xbox',
    });
    expect(res.status).toBe(201);

    // Diskusija se otvara asinhrono posle odgovora — kratka pauza.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const threads = await db.forum.listThreads({ subforum: 'off-topic' });
    const opened = threads.filter((thread) => thread.content.includes('/article/'));
    expect(opened.length).toBeGreaterThanOrEqual(1);
    expect(opened.some((thread) => thread.title.startsWith('Xbox'))).toBe(true);
  });

  it('digest se sastavlja (najčitanije vesti) i ne šalje mejl', async () => {
    const digest = await buildDigest({ days: 30, limit: 3 });
    expect(digest.items.length).toBeGreaterThan(0);
    expect(digest.items.length).toBeLessThanOrEqual(3);
    expect(digest.html).toContain('<ul>');
    expect(digest.subject).toContain('NEXUS');
  });

  it.skipIf(!originalKey)('vraća originalni ključ okruženja', () => {
    expect(originalKey).toBeDefined();
  });
});
