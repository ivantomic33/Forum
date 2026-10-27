/**
 * F-4d — SYNC STEAM CENA (periodični posao)
 * -----------------------------------------
 * Uzima sve AKTIVNE deal-ove čiji URL/proofUrl pokazuje na Steam, sekvencijalno
 * (sa pauzom — Steam limitira po IP-ju!) povlači aktuelnu cenu, upisuje promenu
 * i, kada je cena PALA, poziva postojeći `notifyPriceWatchers(dealId)` — ISTI
 * obrazac pozivanja kao create/update rute u `routes/deals.ts` (samo `dealId`).
 *
 * Ponašanje:
 *  - greška za JEDAN deal (mreža, 429, appdetails success=false) se loguje i
 *    posao ide dalje — ne prekida ceo prolaz;
 *  - `notified` se okida samo kad je nova cena STROGO niža od stare (povećanje
 *    cene se samo upisuje, bez mejlova);
 *  - throttle 24h po (korisnik, igra) već postoji u `notifyPriceWatchers`,
 *    pa dnevni prolaz ne može da spravi lavinu mejlova.
 *
 * Raspored: `startSteamPriceSync()` — isti obrazac kao `startWeeklyDigest`:
 * `setInterval` 10 min, `unref`, tick radi samo posle `STEAM_SYNC_HOUR`
 * (default 19 — nakon okretanja Steam dnevnih popusta), jednom dnevno.
 */

import { db } from './store.js';
import { logger } from './logger.js';
import { notifyPriceWatchers } from './priceAlerts.js';
import { extractSteamAppId, fetchSteamPrice, type FetchLike } from './steamPricing.js';

export interface SyncResult {
  /** Ukupan broj aktivnih Steam deal-ova pronađenih u bazi. */
  total: number;
  /** Koliko je uspešno provereno (`found` + `free`). */
  checked: number;
  /** Koliko deal-ova je imalo promenu cene (upisano u bazu). */
  changed: number;
  /** Koliko `notifyPriceWatchers` obaveštenja je okinuto (cena pala) — in-app. */
  alerts: number;
  /** Mrežne/parse greške i `not_found`. */
  errors: number;
  /** Da li je Steam javio 429 (posao je prekinuo dalje pozivanje). */
  rateLimited: boolean;
  /** Pauza između zahteva (ms) — izlogovano radi dijagnostike. */
  delayMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_DELAY_MS = 1500;

/** Kod države za `cc=` — iz valute deal-a kad je poznata, inače `STEAM_CC`. */
function countryCode(dealCurrency: string | undefined): string {
  const configured = (process.env.STEAM_CC ?? '').trim();
  if (configured) return configured;
  const map: Record<string, string> = { RSD: 'rs', EUR: 'de', USD: 'us', GBP: 'uk' };
  return map[(dealCurrency ?? '').toUpperCase()] ?? 'rs';
}

/** Provera cene za jedan deal. Izdvojeno radi testova. */
export async function syncDealPrice(
  deal: { id: string; url: string; proofUrl: string | null; price: number; originalPrice: number; currency: string },
  deps: { fetch?: FetchLike; delayMs?: number } = {},
): Promise<{ action: 'checked' | 'changed' | 'alert' | 'skipped'; newPrice?: number }> {
  const appId = extractSteamAppId(deal.url) ?? extractSteamAppId(deal.proofUrl);
  if (!appId) return { action: 'skipped' };

  const result = await fetchSteamPrice(appId, countryCode(deal.currency), deps.fetch);
  if (result.status !== 'found' && result.status !== 'free') {
    const reason = result.reason ?? result.status;
    if (result.status === 'rate_limited') {
      const error = new Error('steam_rate_limited');
      (error as Error & { rateLimited?: boolean }).rateLimited = true;
      throw error;
    }
    logger.warn({ dealId: deal.id, appId, reason }, 'steam_price_unavailable');
    return { action: 'skipped' };
  }

  const fresh = result.price!;
  // Tolerancija 0.005 na zaokruživanje (centi → decimala).
  const priceChanged = Math.abs(fresh.price - deal.price) > 0.005;
  if (!priceChanged) return { action: 'checked' };

  await db.deals.update(deal.id, {
    price: fresh.price,
    originalPrice: fresh.originalPrice || deal.originalPrice,
    currency: fresh.currency || deal.currency,
  });
  logger.info({ dealId: deal.id, appId, oldPrice: deal.price, newPrice: fresh.price }, 'steam_price_changed');

  // Cena je pala → isto IN-APP obaveštenje kao pri kreiranju/izmeni deal-a.
  if (fresh.price < deal.price) {
    await notifyPriceWatchers(deal.id);
    return { action: 'alert', newPrice: fresh.price };
  }
  return { action: 'changed', newPrice: fresh.price };
}

/**
 * Jedan prolaz kroz sve aktivne Steam deal-ove. Sekvencijalno, sa pauzom
 * `STEAM_SYNC_DELAY_MS` (default 1500ms, minimum 1200ms) između zahteva.
 */
export async function syncSteamPrices(deps: { fetch?: FetchLike; delayMs?: number } = {}): Promise<SyncResult> {
  const delayMs = Math.max(1200, deps.delayMs ?? Number(process.env.STEAM_SYNC_DELAY_MS ?? DEFAULT_DELAY_MS));
  const result: SyncResult = {
    total: 0, checked: 0, changed: 0, alerts: 0, errors: 0, rateLimited: false, delayMs,
  };

  const { deals } = await db.deals.list({ sort: 'newest', limit: 500, offset: 0 });
  const steamDeals = deals.filter(
    (deal) =>
      deal.status === 'active' &&
      Boolean(extractSteamAppId(deal.url) ?? extractSteamAppId(deal.proofUrl)),
  );
  result.total = steamDeals.length;
  if (!steamDeals.length) {
    logger.info({ ...result }, 'steam_price_sync_done');
    return result;
  }

  for (const deal of steamDeals) {
    try {
      const outcome = await syncDealPrice(deal, deps);
      if (outcome.action === 'alert') { result.checked += 1; result.changed += 1; result.alerts += 1; }
      else if (outcome.action === 'changed') { result.checked += 1; result.changed += 1; }
      else if (outcome.action === 'checked') { result.checked += 1; }
      else { result.errors += 1; }
    } catch (error) {
      if ((error as { rateLimited?: boolean })?.rateLimited) {
        // 429 — nema smisla gnjaviti dalje u istom prolazu; sledeći tik pokušava opet.
        result.rateLimited = true;
        logger.warn({ dealId: deal.id }, 'steam_price_sync_rate_limited');
        break;
      }
      result.errors += 1;
      logger.warn({ err: error, dealId: deal.id }, 'steam_price_sync_deal_failed');
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  logger.info(
    { total: result.total, checked: result.checked, changed: result.changed, alerts: result.alerts, errors: result.errors, rateLimited: result.rateLimited },
    'steam_price_sync_done',
  );
  return result;
}

/**
 * Registracija u tajmer infrastrukturu (isti obrazac kao digest/kampanje):
 * `setInterval` 10 min + `unref`; tick radi samo jednom dnevno, posle
 * `STEAM_SYNC_HOUR` (default 19 — Steam okreće dnevne popuste oko 19h CET).
 * `STEAM_SYNC_ENABLED=0` gasi posao (testovi/CI).
 */
export function startSteamPriceSync(): NodeJS.Timeout | null {
  if (process.env.STEAM_SYNC_ENABLED === '0') {
    logger.info('steam_price_sync_disabled');
    return null;
  }
  const hour = Number(process.env.STEAM_SYNC_HOUR ?? 19);
  let lastRunDay = -1;
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (now.getHours() < hour || now.getDate() === lastRunDay) return;
    running = true;
    lastRunDay = now.getDate();
    try {
      await syncSteamPrices();
    } catch (error) {
      logger.warn({ err: error }, 'steam_price_sync_failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 10 * 60_000);
  timer.unref?.();
  logger.info({ hour, intervalMinutes: 10 }, 'steam_price_sync_started');
  return timer;
}
