/**
 * F-4d — testovi za Steam price sync
 * ----------------------------------
 *  1. `extractSteamAppId` — svi uobičajeni oblici Steam URL-ova (i negativi).
 *  2. `fetchSteamPrice` — parsing centi → decimala, free-to-play, 429, greška,
 *     `success=false` (mock `fetch`, bez mreže).
 *  3. `syncDealPrice` — cena ista (skip), pad cene (update + alert), rast cene
 *     (update bez alerta), deal bez Steam ID-a (skip).
 * Testovi rade u in-memory režimu (`db` bez Supabase-a).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { extractSteamAppId, fetchSteamPrice, type FetchLike } from '../lib/steamPricing.js';
import { syncDealPrice } from '../lib/priceSync.js';
import { db } from '../lib/store.js';
import type { DealRecord } from '../lib/deals.js';
import bcrypt from 'bcryptjs';

function jsonResponse(status: number, body: unknown): FetchLike {
  return (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as FetchLike;
}

function appDetails(appId: string, data: unknown, success = true) {
  return jsonResponse(200, { [appId]: { success, data } });
}

const baseDeal = {
  id: 'deal_sync_test',
  url: 'https://store.steampowered.com/app/1091500/Cyberpunk_2077/',
  proofUrl: null as string | null,
  price: 3599,
  originalPrice: 3599,
  currency: 'RSD',
};

describe('F-4d — extractSteamAppId', () => {
  it('izvlači ID iz standardnih oblika URL-a', () => {
    expect(extractSteamAppId('https://store.steampowered.com/app/1091500/Cyberpunk_2077/')).toBe('1091500');
    expect(extractSteamAppId('https://store.steampowered.com/app/570/dota_2')).toBe('570');
    expect(extractSteamAppId('steam://store/440')).toBe('440');
    expect(extractSteamAppId('steam://rungame/730/')).toBe('730');
  });

  it('vraća null za ne-Steam URL-ove', () => {
    expect(extractSteamAppId('https://www.epicgames.com/store/p/xyz')).toBeNull();
    expect(extractSteamAppId('')).toBeNull();
    expect(extractSteamAppId(null)).toBeNull();
  });
});

describe('F-4d — fetchSteamPrice', () => {
  it('parsira cenu iz centi u decimalu', async () => {
    const fetchImpl = appDetails('1091500', {
      price_overview: { initial: 359900, final: 179950, discount_percent: 50, currency: 'RSD' },
    });
    const result = await fetchSteamPrice('1091500', 'rs', fetchImpl);
    expect(result.status).toBe('found');
    expect(result.price).toMatchObject({ price: 1799.5, originalPrice: 3599, currency: 'RSD', discountPct: 50 });
  });

  it('free-to-play naslov vraća cenu 0', async () => {
    const fetchImpl = appDetails('570', { is_free: true });
    const result = await fetchSteamPrice('570', 'rs', fetchImpl);
    expect(result.status).toBe('free');
    expect(result.price?.price).toBe(0);
  });

  it('HTTP 429 → rate_limited (ne baca)', async () => {
    const result = await fetchSteamPrice('570', 'rs', jsonResponse(429, {}));
    expect(result.status).toBe('rate_limited');
  });

  it('success=false → not_found', async () => {
    const result = await fetchSteamPrice('1', 'rs', appDetails('1', {}, false));
    expect(result.status).toBe('not_found');
  });

  it('mrežna greška → error (ne baca)', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as FetchLike;
    const result = await fetchSteamPrice('570', 'rs', fetchImpl);
    expect(result.status).toBe('error');
  });
});

describe('F-4d — syncDealPrice', () => {
  const TEST_USER = 'usr_price_sync_test';

  beforeEach(async () => {
    if (!(await db.users.findById(TEST_USER))) {
      await db.users.create({
        id: TEST_USER,
        username: 'price_sync_tester',
        email: 'price-sync@test.local',
        password: bcrypt.hashSync('test-password', 4),
        role: 'member',
        avatar: '',
        level: 1,
        xp: 0,
        xpNeeded: 100,
        karma: 0,
        badges: [],
        status: 'offline',
        isVerified: true,
        isBanned: false,
        connectedAccounts: {},
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      } as any);
    }
  });

  async function seedDeal(patch: Partial<DealRecord> = {}): Promise<DealRecord> {
    const deal = await db.deals.create({
      id: 'deal_sync_test',
      authorId: TEST_USER,
      author: 'test',
      title: 'Cyberpunk 2077',
      url: baseDeal.url,
      proofUrl: null,
      price: 3599,
      originalPrice: 3599,
      discountPct: 0,
      currency: 'RSD',
      store: 'Steam',
      platform: 'PC',
      description: null,
      expiresAt: null,
      status: 'active',
      score: 0,
      isVerified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gameId: null,
      ...patch,
    } as unknown as DealRecord);
    return deal;
  }

  it('cena ista → checked, bez upisa', async () => {
    await seedDeal();
    const fetchImpl = appDetails('1091500', {
      price_overview: { initial: 359900, final: 359900, discount_percent: 0, currency: 'RSD' },
    });
    const outcome = await syncDealPrice(baseDeal, { fetch: fetchImpl, delayMs: 0 });
    expect(outcome.action).toBe('checked');
  });

  it('cena pala → upis + alert', async () => {
    await seedDeal();
    const fetchImpl = appDetails('1091500', {
      price_overview: { initial: 359900, final: 179950, discount_percent: 50, currency: 'RSD' },
    });
    const outcome = await syncDealPrice(baseDeal, { fetch: fetchImpl, delayMs: 0 });
    expect(outcome.action).toBe('alert');
    expect(outcome.newPrice).toBe(1799.5);
    const updated = await db.deals.findById('deal_sync_test');
    expect(updated?.price).toBe(1799.5);
  });

  it('cena porasla → upis, bez alerta', async () => {
    await seedDeal();
    const fetchImpl = appDetails('1091500', {
      price_overview: { initial: 359900, final: 419900, discount_percent: 0, currency: 'RSD' },
    });
    const outcome = await syncDealPrice(baseDeal, { fetch: fetchImpl, delayMs: 0 });
    expect(outcome.action).toBe('changed');
    const updated = await db.deals.findById('deal_sync_test');
    expect(updated?.price).toBe(4199);
  });

  it('deal bez Steam ID-a → skipped', async () => {
    const outcome = await syncDealPrice(
      { ...baseDeal, url: 'https://gog.com/game/xyz', proofUrl: null },
      { fetch: jsonResponse(200, {}), delayMs: 0 },
    );
    expect(outcome.action).toBe('skipped');
  });
});
