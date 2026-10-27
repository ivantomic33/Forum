/**
 * F-4d — STEAM PRICE API KLIJENT
 * ------------------------------
 * Povlači aktuelnu cenu sa Steam Store API-ja:
 *
 *   https://store.steampowered.com/api/appdetails?appids={ID}&cc={CC}&filters=price_overview
 *
 * Namerno bez novih zavisnosti (koristi globalni `fetch`, Node ≥ 18).
 *
 * Bitne karakteristike:
 *  - Steam agresivno limitira zahteve po IP-ju (HTTP 429) — pozivalac MORA da
 *    zove sekvencijalno sa pauzom (vidi `syncSteamPrices` u `priceSync.ts`);
 *    ovaj modul je jednostavno „jedan upit“ bez internog čekanja.
 *  - Free-to-play naslovi nemaju `price_overview` (`is_free: true`) — vraćamo
 *    `{ price: 0, originalPrice: 0, currency }` (legalna cena, ne greška).
 *  - Steam vraća cene u CENTIMA (`final` / `initial`), pa se konvertuju deljenjem.
 *  - `fetch` je inject-ovan (zadnji opcioni argument) da bi testovi radili bez mreže.
 */

import { logger } from './logger.js';

export interface SteamPrice {
  /** Aktuelna cena u standardnim decimalnim jedinicama valute (npr. 19.99). */
  price: number;
  /** Regularna cena pre popusta. */
  originalPrice: number;
  /** ISO kod valute iz Steam odgovora (npr. `RSD`, `EUR`, `USD`). */
  currency: string;
  discountPct: number;
}

export interface SteamPriceResult {
  /** `found` = Steam je odgovorio podatkom o ceni (uključujući free-to-play). */
  status: 'found' | 'free' | 'not_found' | 'rate_limited' | 'error';
  price?: SteamPrice;
  /** Ljudski čitljiv razlog kad status nije `found`/`free`. */
  reason?: string;
}

/** Izvuci Steam App ID iz URL-a (`store.steampowered.com/app/{ID}/...`, `steam://.../{ID}`). */
export function extractSteamAppId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /(?:store\.steampowered\.com\/app|steam:\/\/(?:store|rungame))\/(\d{2,10})/i.exec(url);
  return match ? match[1] : null;
}

/** Interfejs koji delimo sa testovima — `Response`-liki objekat. */
export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

/**
 * Jedan upit ka Steam API-ju. Nikad ne baca — greške su `status: 'error'`
 * (ili `'rate_limited'` za 429) da posao može da nastavi sa sledećim deal-om.
 */
export async function fetchSteamPrice(
  appId: string,
  countryCode = 'rs',
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SteamPriceResult> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=${encodeURIComponent(countryCode)}&filters=price_overview`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (response.status === 429) {
      return { status: 'rate_limited', reason: 'HTTP 429 — Steam rate limit' };
    }
    if (!response.ok) {
      return { status: 'error', reason: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as Record<string, any>;
    const entry = body?.[appId];
    if (!entry || entry.success !== true) {
      return { status: 'not_found', reason: 'appdetails success=false' };
    }
    // Free-to-play: nema `price_overview`, ali je legalna cena 0.
    if (entry.data?.is_free === true) {
      return { status: 'free', price: { price: 0, originalPrice: 0, currency: 'USD', discountPct: 0 } };
    }
    const overview = entry.data?.price_overview;
    if (!overview || typeof overview.final !== 'number') {
      return { status: 'not_found', reason: 'nema price_overview' };
    }
    // Steam: `initial`/`final` u centima; `final_formatted` je string ("1 999,00 RSD").
    const price = overview.final / 100;
    const originalPrice = typeof overview.initial === 'number' ? overview.initial / 100 : price;
    return {
      status: 'found',
      price: {
        price,
        originalPrice,
        currency: typeof overview.currency === 'string' ? overview.currency : countryCode.toUpperCase(),
        discountPct: typeof overview.discount_percent === 'number' ? overview.discount_percent : 0,
      },
    };
  } catch (error) {
    logger.warn({ err: error, appId }, 'steam_price_fetch_failed');
    return { status: 'error', reason: (error as Error)?.message ?? 'network error' };
  }
}
