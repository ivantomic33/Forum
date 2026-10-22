import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/store.js';
import { plainText, searchAll, searchArticlesFallback, MIN_QUERY_LENGTH } from '../lib/search.js';

/**
 * PRETRAGA (2.6.2)
 * -----------------
 * Testovi rade u memory režimu, gde `searchAll` koristi fallback (isti ugovor
 * kao pg_trgm RPC). Proveravaju: minimalnu dužinu upita, rangiranje (naslov
 * pre sadržaja), normalizaciju HTML-a u snippet i vidljivost (draft članci se
 * ne vraćaju).
 */

const SUFFIX = Date.now().toString(36);

async function seed() {
  const now = new Date().toISOString();
  const author = await db.users.create({
    id: `usr_search_${SUFFIX}`,
    username: `search_${SUFFIX}`,
    email: `search_${SUFFIX}@example.com`,
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
    createdAt: now,
    lastSeenAt: now,
  });

  const base = {
    excerpt: 'RPG iz Wizarding World sveta.',
    coverImage: '',
    authorId: author.id,
    author: author.username,
    category: 'recenzije',
    tags: [],
    isFeatured: false,
    views: 0,
    reactions: {},
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };

  await db.articles.create({
    ...base,
    id: `art_hit_${SUFFIX}`,
    slug: `hogwarts-${SUFFIX}`,
    title: 'Hogwarts Legacy — recenzija',
    content: '<p>Magija, škola i zmajevi u Hogwarts dvorcu.</p>',
    status: 'published',
  });

  await db.articles.create({
    ...base,
    id: `art_draft_${SUFFIX}`,
    slug: `hogwarts-draft-${SUFFIX}`,
    title: 'Hogwarts Legacy — draft',
    content: '<p>Nije objavljeno.</p>',
    status: 'draft',
  });
}

describe('search (2.6.2)', () => {
  beforeEach(async () => {
    await seed();
  });

  it('upit kraći od minimuma ne pokreće pretragu', async () => {
    const short = await searchAll({ q: 'a' });
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(short).toEqual({ hits: [], total: 0, suggestion: null });

    const trimmed = await searchAll({ q: '   ' });
    expect(trimmed.total).toBe(0);
  });

  it('pogađa naslov i NE vraća draft članke', async () => {
    const { hits } = await searchAll({ q: 'hogwarts', type: 'articles' });
    const titled = hits.filter((hit) => hit.title.includes('Hogwarts'));
    expect(titled.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.title.includes('draft'))).toBe(false);
    expect(hits[0]).toMatchObject({ type: 'article', href: expect.stringContaining('/article/') });
  });

  it('naslov ima veći rang od pogotka samo u sadržaju', async () => {
    const hits = await searchArticlesFallback('zmajevi', 10);
    const contentHit = hits.find((hit) => hit.title.includes('Hogwarts Legacy — recenzija'));
    expect(contentHit).toBeTruthy();
    expect(contentHit!.rank).toBeGreaterThan(0);

    const titleHits = await searchArticlesFallback('recenzija', 10);
    expect(titleHits[0].rank).toBeGreaterThan(contentHit!.rank);
  });

  it('snippet je čist tekst (bez HTML tagova)', () => {
    expect(plainText('<p>Magija, <strong>škola</strong> i zmajevi.</p>')).toBe('Magija, škola i zmajevi.');
    expect(plainText(undefined)).toBe('');
  });

  it('pretraga po tipu ne vraća ostale tipove', async () => {
    const { hits } = await searchAll({ q: 'hogwarts', type: 'threads' });
    expect(hits.every((hit) => hit.type === 'thread')).toBe(true);
  });
});
