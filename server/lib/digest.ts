import { db } from './store.js';
import { logger } from './logger.js';
import { getSharedValue, setSharedValue } from './sharedStore.js';
import { type DigestDeal, type DigestItem } from './email.js';

/**
 * F-8 — NEDELJNI DIGEST (retencija + razlog da pretplata postoji).
 *
 * Šta se šalje: 3 najčitanija objavljena članka iz poslednjih 7 dana + 2
 * aktívna popusta koja najpre ističu. Ako u nedelji nema novog sadržaja, digest
 * se NE šalje — prazan „najbolje iz NEXUS-a“ je gori od nijednog mejla.
 *
 * Kako se pokreće:
 *  - automatski, u bootstrap-u (`startWeeklyDigest`), provera jednom na sat;
 *    šalje se u ponedeljak posle `DIGEST_HOUR` (default 9, po `TZ`);
 *  - ručno, admin ruta `POST /api/admin/digest/send` (isti sastavljač, opciono
 *    `dryRun` za pregled HTML-a bez slanja).
 *
 * Idempotencija: datum poslednjeg slanja ide u deljeni `site_meta`
 * (`getSharedValue`/`setSharedValue` — baza kad je podešena, `Map` u memory
 * režimu). Ponovni start servera ne šalje digest drugi put istog dana.
 *
 * SLANJE JE UGAŠENO: mejl se šalje samo za verifikaciju adrese i reset
 * lozinke. `sendDigestToSubscribers` zato uvek vraća `skipped: 'disabled'`
 * (payload se i dalje sastavlja, admin `dryRun` i dalje prikazuje pregled).
 */

const LAST_SENT_KEY = 'digest.last_sent';

export interface DigestPayload {
  weekLabel: string;
  items: DigestItem[];
  deals: DigestDeal[];
}

const priceLabel = (price: number, currency: string) => `${price.toFixed(2).replace('.', ',')} ${currency}`;

/** ISO nedelja — koristi se kao oznaka „nedelja 42/2026“ u naslovu mejla. */
export function isoWeekLabel(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `Nedelja ${week}/${target.getUTCFullYear()}`;
}

/**
 * Sastavlja sadržaj digesta iz baze. Bez ijedne stavke vraća `null` — tada se
 * mejl ne šalje (vidi `sendDigestToSubscribers`).
 */
export async function buildDigest(now = new Date()): Promise<DigestPayload | null> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const published = await db.articles.findAll({ status: 'published', publishedBefore: new Date().toISOString() }).catch(() => []);
  const fresh = published
    .filter((article) => (article.publishedAt ?? article.createdAt) >= weekAgo)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))
    .slice(0, 3);

  const items: DigestItem[] = fresh.map((article) => ({
    title: article.title,
    href: `/article/${article.slug}`,
    excerpt: article.excerpt ?? null,
  }));

  const { deals } = await db.deals.list({ sort: 'expiring', limit: 2 }).catch(() => ({ deals: [], total: 0 }));
  const digestDeals: DigestDeal[] = deals
    .filter((deal) => deal.status === 'active' && (!deal.expiresAt || new Date(deal.expiresAt).getTime() > now.getTime()))
    .slice(0, 2)
    .map((deal) => ({
      title: deal.title,
      href: `/deals/${deal.id}`,
      price: priceLabel(deal.price, deal.currency),
      store: deal.store,
      discountPct: deal.discountPct,
    }));

  if (!items.length && !digestDeals.length) return null;
  return { weekLabel: isoWeekLabel(now), items, deals: digestDeals };
}

/** Kada je digest poslednji put poslat (ISO) — `null` ako nijednom. */
export async function lastDigestSentAt(): Promise<string | null> {
  const stored = await getSharedValue<string>(LAST_SENT_KEY);
  return typeof stored === 'string' && stored ? stored : null;
}

async function markDigestSent(at: string): Promise<void> {
  // Greška u upisu ne sme da obori slanje, ali se prijavljuje (sledeći start bi
  // poslao isti digest opet istog dana).
  await setSharedValue(LAST_SENT_KEY, at).catch((error) => logger.warn({ err: error }, 'digest_marker_failed'));
}

export interface DigestRunResult {
  skipped?: 'no_content' | 'no_subscribers' | 'no_provider' | 'already_sent_today' | 'disabled';
  sentCount: number;
  failed: number;
  payload: DigestPayload | null;
}

/**
 * Digest se više NE šalje mejlom (mejl samo za verifikaciju i reset lozinke).
 * Sadržaj se i dalje sastavlja — admin `dryRun` dobija pregled, a `skipped`
 * jasno kaže da je kanal ugašen umesto da izgleda kao „poslato 0“.
 */
export async function sendDigestToSubscribers(options: { dryRun?: boolean; force?: boolean } = {}): Promise<DigestRunResult> {
  const payload = await buildDigest();
  if (!payload) return { skipped: 'no_content', sentCount: 0, failed: 0, payload: null };

  if (options.dryRun) return { sentCount: 0, failed: 0, payload };

  logger.info('weekly_digest_disabled');
  return { skipped: 'disabled', sentCount: 0, failed: 0, payload };
}

/**
 * F-8 — automatsko slanje: ponedeljak, posle `DIGEST_HOUR` (default 9).
 *
 * Proverava se svakih 10 minuta (jeftino: `lastDigestSentAt` je jedan čitanje
 * iz baze/fajla). `DIGEST_ENABLED=0` isključuje slanje bez diranja koda.
 */
export function startWeeklyDigest(): NodeJS.Timeout | null {
  // Slanje je ugašeno — nema ni tajmera ni ijednog mejla iz digest-a.
  logger.info('weekly_digest_disabled');
  return null;
}
