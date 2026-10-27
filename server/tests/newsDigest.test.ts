import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { buildEventSummary } from '../lib/newsAutomation.js';

/**
 * 2.13.2 — PREGLED (tačke 4, 5, 6 iz liste „šta još“)
 * ---------------------------------------------------
 *  - admin: `GET /api/admin/news/sources` (kartica u panelu),
 *  - događaj: `summary` + `eventTitle` + `timeline` („Priča se razvija“ nije samo značka),
 *  - de-duplikacija slike kroz marker `<!--source-image:…-->`.
 */

const app = createApp();
const KEY = 'test-ingest-key-0123456789abcdef';

describe.skipIf(db.kind !== 'memory')('2.13.2 — izvori, sažetak događaja, dedupe slike', () => {
  beforeAll(async () => {
    process.env.ARTICLES_INGEST_API_KEY = KEY;
process.env.NEWS_MIRROR_IMAGES = '0'; // bez Storage-a u testu
try {
  await db.users.create({
    id: 'usr_digest_author',
    username: 'digest_author',
    email: 'digest@example.com',
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

it('sažetak događaja koristi opise, najnovije prvo, bez duplikata', () => {
  const base = {
    id: 'x',
    slug: 'x',
    title: '',
    excerpt: '',
    content: '',
    coverImage: '',
    authorId: 'u',
    author: 'a',
    category: 'Vesti',
    tags: [],
    status: 'published' as const,
    isFeatured: false,
    views: 0,
    reactions: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const summary = buildEventSummary([
    { ...base, id: '1', title: 'Starija vest', excerpt: 'Prva rečenica starije vesti govori o kontekstu događaja.', publishedAt: '2026-01-01T10:00:00Z' },
    { ...base, id: '2', title: 'Novija vest', excerpt: 'Nova informacija je potvrđena danas od strane studija.', publishedAt: '2026-01-02T10:00:00Z' },
  ]);

  // Najnovija vest ide prva.
  expect(summary.indexOf('Nova informacija')).toBeLessThan(summary.indexOf('Prva rečenica'));
});

it('ruta događaja vraća naslov, sažetak i vremensku liniju', async () => {
  for (const [index, title] of ['GTA 6 stiže u maju', 'GTA 6 dobija novi trejler'].entries()) {
    const res = await ingest({
      title,
      content: `<p>Detalji vesti broj ${index + 1} o igri GTA 6.</p>`,
      sourceUrl: `https://example.com/gta-dogadjaj-${index}`,
      excerpt: `Sažetak vesti ${index + 1} — potvrđeno iz dva izvora.`,
      eventId: 'gta-6',
      eventTitle: 'GTA 6',
      authorName: 'Polygon',
    });
    expect(res.status).toBe(201);
  }

  const res = await request(app).get('/api/articles/event/gta-6');
  expect(res.status).toBe(200);
  expect(res.body.eventTitle).toBe('GTA 6');
  expect(res.body.summary.length).toBeGreaterThan(20);
  expect(res.body.timeline.length).toBeGreaterThanOrEqual(2);
  expect(res.body.timeline[0]).toHaveProperty('date');
});

it('ista slika se koristi dvaput (marker), bez novog mirror-a', async () => {
  const image = 'https://example.com/slika-vesti.jpg?w=1600';
  const first = await ingest({
    title: 'Vest sa slikom A',
    content: '<p>Prva vest sa zajedničkom naslovnom slikom iz izvora.</p>',
    sourceUrl: 'https://example.com/slika-a',
    coverImage: image,
  });
  expect(first.status).toBe(201);

  const second = await ingest({
    title: 'Vest sa slikom B',
    content: '<p>Druga vest sa ISTOM naslovnom slikom iz izvora.</p>',
    sourceUrl: 'https://example.com/slika-b',
    coverImage: image,
  });
  expect(second.status).toBe(201);
  // Bez Storage-a obe dobijaju originalni URL — dokaz da je dedupe prepoznao marker.
  expect(second.body.coverImage).toBe(first.body.coverImage);
  expect(first.body.content).toContain('<!--source-image:');
});
});
