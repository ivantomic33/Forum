import { describe, expect, it, afterEach } from 'vitest';
import { verifySteamAccount, XP_FOR_VERIFIED_ACCOUNT, unverifiedMessage, STEAM_ID64_RE } from '../lib/accountVerification.js';
import { memoryPersistenceEnabled } from '../lib/store.js';
import { safeNextPath } from '../../src/lib/navigation.js';

/**
 * Regresioni testovi za P0 blok iz ANALIZA-README §5:
 *  B-01 — sesije u memorijskom režimu preživljavaju restart,
 *  B-02 — dev tokeni se vraćaju bez obzira na ishod slanja mejla,
 *  B-03 — povezani nalozi se verifikuju pre XP-a,
 *  B-06 — `?next=` posle prijave prihvata samo interne putanje.
 */

// -------------------------
// B-01
// -------------------------
describe('B-01 — perzistencija sesija u memorijskom režimu', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, SESSION_PERSISTENCE: process.env.SESSION_PERSISTENCE };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    if (original.SESSION_PERSISTENCE === undefined) delete process.env.SESSION_PERSISTENCE;
    else process.env.SESSION_PERSISTENCE = original.SESSION_PERSISTENCE;
  });

  it('test režim ne dira disk (izolovani testovi)', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SESSION_PERSISTENCE;
    expect(memoryPersistenceEnabled()).toBe(false);
  });

  it('razvoj upisuje sesije, produkcija ne', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SESSION_PERSISTENCE;
    expect(memoryPersistenceEnabled()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(memoryPersistenceEnabled()).toBe(false);
  });

  it('eksplicitni opt-in/opt-out ima prednost', () => {
    process.env.NODE_ENV = 'development';
    process.env.SESSION_PERSISTENCE = '0';
    expect(memoryPersistenceEnabled()).toBe(false);
    process.env.NODE_ENV = 'test';
    process.env.SESSION_PERSISTENCE = '1';
    expect(memoryPersistenceEnabled()).toBe(true);
  });
});

// -------------------------
// B-03 — verifikacija povezanih naloga
// -------------------------
const okSteam = (steamid: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ response: { success: 1, steamid } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('B-03 — Steam verifikacija', () => {
  const originalKey = process.env.STEAM_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.STEAM_API_KEY;
    else process.env.STEAM_API_KEY = originalKey;
  });

  it('SteamID64 se prihvata bez mrežnog poziva', async () => {
    delete process.env.STEAM_API_KEY;
    const id = '76561198000000001';
    const result = await verifySteamAccount(id, {
      fetchImpl: () => {
        throw new Error('ne sme da pozove mrežu');
      },
    });
    expect(result).toEqual({ status: 'verified', value: id });
  });

  it('vanity ime bez STEAM_API_KEY → not_configured (bez XP-a)', async () => {
    delete process.env.STEAM_API_KEY;
    const result = await verifySteamAccount('gaben');
    expect(result.status).toBe('not_configured');
  });

  it('važeći vanity ime → kanonski SteamID64', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    const id = '76561197960287930';
    let calledUrl = '';
    const result = await verifySteamAccount('gaben', {
      fetchImpl: (async (url: any) => {
        calledUrl = String(url);
        return okSteam(id);
      }) as typeof fetch,
    });
    expect(result).toEqual({ status: 'verified', value: id });
    expect(calledUrl).toContain('vanityurl=gaben');
    expect(calledUrl).not.toContain('undefined');
  });

  it('success 42 → profil ne postoji', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    const result = await verifySteamAccount('nema-ovaj-nalog', {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ response: { success: 42, message: 'No match' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });
    expect(result.status).toBe('not_found');
  });

  it('HTTP greška API-ja → error, nikad „verified“', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    const result = await verifySteamAccount('gaben', {
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });
    expect(result.status).toBe('error');
  });

  it('XP samo za verifikovan nalog; poruka za neverifikovan jasno kaže da nema XP-a', () => {
    expect(XP_FOR_VERIFIED_ACCOUNT).toBe(25);
    expect(unverifiedMessage('steam')).toMatch(/bez XP-a/);
    const bad = '76561197960287930x';
    expect(STEAM_ID64_RE.test(bad)).toBe(false);
  });
});

// -------------------------
// B-06 — safe next
// -------------------------
describe('B-06 — siguran `next` posle prijave', () => {
  it('prihvata interne putanje', () => {
    expect(safeNextPath('/admin')).toBe('/admin');
    expect(safeNextPath('/deals?page=2')).toBe('/deals?page=2');
    expect(safeNextPath(' /forum/pc-gaming ')).toBe('/forum/pc-gaming');
  });

  it('odbija eksterne i protocol-relative adrese', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath('admin')).toBe('/');
  });

  it('ne vraća na auth stranice (petlja) i toleriše nedostajuću vrednost', () => {
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath('/register?ref=x')).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(42)).toBe('/');
  });
});
