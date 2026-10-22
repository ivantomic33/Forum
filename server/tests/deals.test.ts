import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';
import {
  checkExternalUrl,
  compareDeals,
  computeDiscountPct,
  filterDeals,
  isExpiringSoon,
  mapIgdbGame,
  normalizeSlug,
  searchIgdbGames,
  timeLeftLabel,
  validateDealInput,
  type DealRecord,
} from '../lib/deals.js';

/**
 * 2.6.0 — Deals: čista logika + in-memory repo.
 * Testovi rade bez baze (CI je u `memory` režimu).
 */

const AUTHOR = 'usr_deal_author';
const VOTER = 'usr_deal_voter';

async function ensureUsers() {
  for (const id of [AUTHOR, VOTER]) {
    if (await db.users.findById(id)) continue;
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
}

const validDeal = {
  title: 'Elden Ring — akcija',
  url: 'https://store.steampowered.com/app/1245620/',
  price: 29.99,
  originalPrice: 59.99,
  store: 'Steam',
  platform: 'pc',
};

describe('validateDealInput', () => {
  it('prihvata ispravan deal i računa popust', () => {
    const result = validateDealInput(validDeal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.price).toBe(29.99);
    expect(result.value.discountPct).toBe(50);
    expect(result.value.currency).toBe('EUR');
    expect(result.value.platform).toBe('pc');
  });

  it('obračunava popust isto kao generated kolona (zaokruženo, 0..100)', () => {
    expect(computeDiscountPct(9.99, 19.99)).toBe(50);
    expect(computeDiscountPct(0, 10)).toBe(100);
    expect(computeDiscountPct(10, 10)).toBe(0);
    expect(computeDiscountPct(5, 0)).toBe(0);
  });

  it('odbija originalnu cenu manju od trenutne', () => {
    const result = validateDealInput({ ...validDeal, price: 80, originalPrice: 50 });
    expect(result.ok).toBe(false);
  });

  it('odbija deal bez popusta (cene jednake)', () => {
    const result = validateDealInput({ ...validDeal, price: 59.99 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('0%') });
  });

  it('odbija negativne i nerealne cene', () => {
    expect(validateDealInput({ ...validDeal, price: -1 }).ok).toBe(false);
    expect(validateDealInput({ ...validDeal, price: 1, originalPrice: 0 }).ok).toBe(false);
    expect(validateDealInput({ ...validDeal, price: 1, originalPrice: 10_000_000 }).ok).toBe(false);
  });

  it('odbija datum isteka u prošlosti', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = validateDealInput({ ...validDeal, expiresAt: past });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('budućnosti') });
  });

  it('prihvata datum isteka u budućnosti i normalizuje na ISO', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = validateDealInput({ ...validDeal, expiresAt: future });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.expiresAt).toBe(future);
  });

  it('zahteva prodavnicu i kratak naslov', () => {
    expect(validateDealInput({ ...validDeal, store: '' }).ok).toBe(false);
    expect(validateDealInput({ ...validDeal, title: 'ab' }).ok).toBe(false);
  });

  it('prihvata besplatan deal (price = 0) samo kad je originalna > 0', () => {
    expect(validateDealInput({ ...validDeal, price: 0 }).ok).toBe(true);
  });
});

describe('checkExternalUrl (SSRF zaštita)', () => {
  it('prihvata https link ka javnom hostu', () => {
    expect(checkExternalUrl('https://store.steampowered.com/app/1/').ok).toBe(true);
  });

  it('odbija http, javascript: i relativne linkove', () => {
    expect(checkExternalUrl('http://example.com').ok).toBe(false);
    expect(checkExternalUrl('javascript:alert(1)').ok).toBe(false);
    expect(checkExternalUrl('/deals/1').ok).toBe(false);
  });

  it('odbija lokalne adrese i cloud metadata', () => {
    expect(checkExternalUrl('https://localhost/x').ok).toBe(false);
    expect(checkExternalUrl('https://127.0.0.1/x').ok).toBe(false);
    expect(checkExternalUrl('https://192.168.1.10/x').ok).toBe(false);
    expect(checkExternalUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(checkExternalUrl('https://metadata.google.internal/computeMetadata/v1').ok).toBe(false);
  });

  it('dokaz može biti data:image, ali ne data:text', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    expect(checkExternalUrl(png, { allowDataImage: true }).ok).toBe(true);
    expect(checkExternalUrl('data:text/html;base64,PHA+', { allowDataImage: true }).ok).toBe(false);
  });
});

describe('filterDeals i sortiranje', () => {
  const base = (patch: Partial<DealRecord>): DealRecord => ({
    id: 'd',
    authorId: AUTHOR,
    author: 'a',
    gameId: 'g1',
    gameSlug: 'elden-ring',
    gameTitle: 'Elden Ring',
    gameCover: null,
    title: 'Deal',
    url: 'https://example.com',
    proofUrl: null,
    price: 10,
    originalPrice: 20,
    discountPct: 50,
    currency: 'EUR',
    store: 'Steam',
    platform: 'pc',
    description: null,
    expiresAt: null,
    status: 'active',
    isVerified: false,
    score: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  });

  it('default vraća samo aktivne i neistekle deal-ove', () => {
    const now = new Date('2026-06-01T00:00:00.000Z').getTime();
    const deals = [
      base({ id: 'active' }),
      base({ id: 'expired-status', status: 'expired' }),
      base({ id: 'overdue', expiresAt: '2026-05-01T00:00:00.000Z' }),
      base({ id: 'removed', status: 'removed' }),
    ];
    expect(filterDeals(deals, {}, now).map((d) => d.id)).toEqual(['active']);
  });

  it('includeExpired zadržava istekle ali ne uklonjene', () => {
    const deals = [base({ id: 'a' }), base({ id: 'b', status: 'expired' }), base({ id: 'c', status: 'removed' })];
    expect(filterDeals(deals, { includeExpired: true }).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('filteri po igri, prodavnici, ceni i popustu', () => {
    const deals = [
      base({ id: '1', store: 'Steam', price: 5, discountPct: 75 }),
      base({ id: '2', store: 'GOG', price: 15, discountPct: 25 }),
      base({ id: '3', store: 'Steam', gameSlug: 'other', price: 40, discountPct: 20 }),
    ];
    expect(filterDeals(deals, { store: 'steam' }).map((d) => d.id)).toEqual(['1', '3']);
    expect(filterDeals(deals, { gameSlug: 'other' }).map((d) => d.id)).toEqual(['3']);
    expect(filterDeals(deals, { maxPrice: 15 }).map((d) => d.id)).toEqual(['1', '2']);
    expect(filterDeals(deals, { minDiscount: 50 }).map((d) => d.id)).toEqual(['1']);
  });

  it('sortiranje: top, najveći popust, isteče uskoro, najnoviji', () => {
    const deals = [
      base({ id: 'new', createdAt: '2026-05-01T00:00:00.000Z', score: 1, discountPct: 10 }),
      base({ id: 'top', createdAt: '2026-04-01T00:00:00.000Z', score: 30, discountPct: 20 }),
      base({ id: 'discount', createdAt: '2026-03-01T00:00:00.000Z', score: 5, discountPct: 90 }),
      base({ id: 'soon', createdAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-06-02T00:00:00.000Z' }),
    ];
    expect([...deals].sort((a, b) => compareDeals(a, b, 'newest'))[0].id).toBe('new');
    expect([...deals].sort((a, b) => compareDeals(a, b, 'top'))[0].id).toBe('top');
    expect([...deals].sort((a, b) => compareDeals(a, b, 'discount'))[0].id).toBe('discount');
    expect([...deals].sort((a, b) => compareDeals(a, b, 'expiring'))[0].id).toBe('soon');
  });

  it('ističe uskoro = rok u narednih 72h', () => {
    const now = Date.now();
    expect(isExpiringSoon(base({ expiresAt: new Date(now + 60 * 60 * 1000).toISOString() }), now)).toBe(true);
    expect(isExpiringSoon(base({ expiresAt: new Date(now + 30 * 86_400_000).toISOString() }), now)).toBe(false);
    expect(isExpiringSoon(base({ expiresAt: null }), now)).toBe(false);
  });

  it('timeLeftLabel daje čitljiv tekst', () => {
    const now = Date.now();
    expect(timeLeftLabel(new Date(now + 30 * 60_000).toISOString(), now)).toMatch(/za \d+ min/);
    expect(timeLeftLabel(new Date(now + 3 * 3_600_000).toISOString(), now)).toBe('za 3 h');
    expect(timeLeftLabel(new Date(now - 1000).toISOString(), now)).toBe('istekao');
    expect(timeLeftLabel(null, now)).toBeNull();
  });
});

describe('normalizeSlug / IGDB mapping', () => {
  it('normalizuje naslove sa dijakriticima u slug', () => {
    expect(normalizeSlug('God of War Ragnarök')).toBe('god-of-war-ragnarok');
    expect(normalizeSlug('  Čudesna   Igra!! ')).toBe('cudesna-igra');
  });

  it('mapira IGDB cover na veću rezoluciju i https', () => {
    const game = mapIgdbGame({
      id: 119133,
      name: 'Elden Ring',
      slug: 'elden-ring',
      cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/co4jni.jpg' },
      first_release_date: 1645488000,
    });
    expect(game).toMatchObject({
      igdbId: 119133,
      slug: 'elden-ring',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
      releaseDate: '2022-02-22',
    });
  });

  it('searchIgdbGames bez podešenog ključa vraća praznu listu (bez mreže)', async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const games = await searchIgdbGames('elden', 5, {} as NodeJS.ProcessEnv, fakeFetch);
    expect(games).toEqual([]);
    expect(called).toBe(false);
  });

  it('searchIgdbGames ne šalje navodnike iz unosa u Apicalypse upit', async () => {
    const bodies: string[] = [];
    const fakeFetch = (async (input: any, init: any) => {
      const url = String(input);
      if (url.includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify([{ id: 1, name: 'Elden Ring', slug: 'elden-ring' }]), { status: 200 });
    }) as unknown as typeof fetch;

    const games = await searchIgdbGames(
      'elden" ; limit 500; "',
      5,
      { IGDB_CLIENT_ID: 'id', IGDB_CLIENT_SECRET: 'secret' } as unknown as NodeJS.ProcessEnv,
      fakeFetch,
    );
    expect(games[0]).toMatchObject({ igdbId: 1, slug: 'elden-ring' });
    expect(bodies[0]).not.toContain('"; limit 500');
    expect(bodies[0]).toContain('limit 5;');
  });
});

describe.skipIf(db.kind !== 'memory')('deals repo (in-memory)', () => {
  beforeEach(ensureUsers);

  async function makeDeal(patch: Partial<Parameters<typeof db.deals.create>[0]> = {}) {
    const now = new Date().toISOString();
    const price = patch.price ?? 20;
    const originalPrice = patch.originalPrice ?? 40;
    return db.deals.create({
      id: `deal_test_${Math.random().toString(36).slice(2, 8)}`,
      authorId: AUTHOR,
      author: 'author',
      gameId: null,
      gameSlug: null,
      gameTitle: null,
      gameCover: null,
      title: 'Test deal',
      url: `https://example.com/${Math.random().toString(36).slice(2)}`,
      proofUrl: null,
      price,
      originalPrice,
      discountPct: computeDiscountPct(price, originalPrice),
      currency: 'EUR',
      store: 'Steam',
      platform: 'pc',
      description: null,
      expiresAt: null,
      status: 'active',
      isVerified: false,
      score: 0,
      createdAt: now,
      updatedAt: now,
      ...patch,
    });
  }

  it('jedan glas po korisniku: promena glasa menja score, otkaz ga vraća na 0', async () => {
    const deal = await makeDeal();

    const up = await db.deals.vote(VOTER, deal.id, 'up');
    expect(up).toMatchObject({ changed: true, delta: 1, score: 1 });

    const down = await db.deals.vote(VOTER, deal.id, 'down');
    expect(down).toMatchObject({ changed: true, delta: -2, score: -1 });

    const cleared = await db.deals.vote(VOTER, deal.id, null);
    expect(cleared).toMatchObject({ changed: true, delta: 1, score: 0 });

    const stored = await db.deals.findById(deal.id, VOTER);
    expect(stored?.myVote).toBeNull();
  });

  it('myVote je vidljiv samo prijavljenom korisniku', async () => {
    const deal = await makeDeal();
    await db.deals.vote(VOTER, deal.id, 'up');

    expect((await db.deals.findById(deal.id, VOTER))?.myVote).toBe('up');
    expect((await db.deals.findById(deal.id))?.myVote).toBeUndefined();
  });

  it('lista vraća total pre paginacije i poštuje limit/offset', async () => {
    for (let i = 0; i < 4; i += 1) await makeDeal({ title: `deal ${i}` });
    const page = await db.deals.list({ limit: 2, offset: 0 }, VOTER);
    expect(page.deals).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(4);
  });

  it('update ne prihvata discountPct od klijenta (računa se iz cena)', async () => {
    const deal = await makeDeal({ price: 20, originalPrice: 40 });
    const updated = await db.deals.update(deal.id, { price: 10, discountPct: 99 });
    expect(updated?.discountPct).toBe(75);
  });

  it('remove je soft-delete (deal ostaje sa statusom removed)', async () => {
    const deal = await makeDeal();
    expect(await db.deals.remove(deal.id)).toBe(true);
    const stored = await db.deals.findById(deal.id, AUTHOR);
    expect(stored?.status).toBe('removed');
  });

  it('expireOverdue zaključava istekle deal-ove', async () => {
    const overdue = await makeDeal({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await db.deals.expireOverdue();
    expect((await db.deals.findById(overdue.id, AUTHOR))?.status).toBe('expired');
  });

  it('games.upsert je idempotentan po slug-u i popunjava samo prazna polja', async () => {
    const first = await db.games.upsert({
      slug: 'test-game',
      title: 'Test Game',
      coverUrl: null,
      releaseDate: null,
      igdbId: null,
    });
    const second = await db.games.upsert({
      slug: 'test-game',
      title: 'Test Game',
      coverUrl: 'https://images.igdb.com/cover.jpg',
      releaseDate: '2020-01-01',
      igdbId: 42,
    });
    expect(second.id).toBe(first.id);
    expect(second.coverUrl).toBe('https://images.igdb.com/cover.jpg');
    expect(second.igdbId).toBe(42);
  });

  it('deal sa igrom vraća gameSlug/gameTitle (link ka Game Page)', async () => {
    const game = await db.games.upsert({
      slug: 'linked-game',
      title: 'Linked Game',
      coverUrl: 'https://images.igdb.com/linked.jpg',
      releaseDate: null,
      igdbId: null,
    });
    // Regresija: `create` je vraćao deal bez relacija, pa kartica nije imala
    // link ka `/games/:slug` sve dok se lista ne osveži.
    const deal = await makeDeal({ gameId: game.id, gameSlug: null, gameTitle: null, gameCover: null });
    expect(deal.gameSlug).toBe('linked-game');
    expect(deal.gameTitle).toBe('Linked Game');
    expect(deal.gameCover).toBe('https://images.igdb.com/linked.jpg');

    const found = await db.deals.findById(deal.id);
    expect(found?.gameSlug).toBe('linked-game');
  });
});
