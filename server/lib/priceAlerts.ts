/**
 * F-4 — PRICE ALERT („prati igru → obaveštenje kada cena padne ispod praga“)
 * -------------------------------------------------------------------------
 * Kada se objavi ili izmeni deal, proveravamo ko prati tu igru i da li je nova
 * cena ispod njegovog praga. Obaveštenje je IN-APP (`notify`: inbox + zvonce +
 * Realtime + web push) — mejl se šalje samo za verifikaciju adrese i reset
 * lozinke, pa ovde nema mejla.
 *
 * Pravila:
 *
 *  - obaveštenje ide samo kada je cena NIŽA od one o kojoj je korisnik poslednji
 *    put obavešten (`notifiedAt` postoji, ali istu cenu ne šaljemo dvaput);
 *  - najviše jednom u 24 h po (korisnik, igra) — štiti od lavine pri promeni
 *    cene nekoliko puta dnevno.
 *
 * Greške se loguju i ne obaraju objavu deal-a: deal je već sačuvan, a
 * obaveštenje je sekundarni efekat.
 */

import { db } from './store.js';
import { logger } from './logger.js';
import { notify } from './notifications.js';

const THROTTLE_MS = 24 * 60 * 60 * 1000;

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('sr-Latn-RS', { style: 'currency', currency: currency || 'EUR' }).format(value);

export async function notifyPriceWatchers(dealId: string): Promise<{ sent: number; skipped: number }> {
  const result = { sent: 0, skipped: 0 };
  try {
    const deal = await db.deals.findById(dealId);
    if (!deal || !deal.gameId || deal.status !== 'active') return result;
    if (deal.expiresAt && new Date(deal.expiresAt).getTime() <= Date.now()) return result;

    const watchers = await db.watches.listByGame(deal.gameId);
    if (!watchers.length) return result;

    for (const watch of watchers) {
      // Prag je u valuti praćenja; deal u drugoj valuti ne poredimo (lažni alarm).
      if (watch.currency && deal.currency && watch.currency !== deal.currency) {
        result.skipped += 1;
        continue;
      }
      if (deal.price > watch.targetPrice) {
        result.skipped += 1;
        continue;
      }
      if (watch.notifiedAt && Date.now() - new Date(watch.notifiedAt).getTime() < THROTTLE_MS) {
        result.skipped += 1;
        continue;
      }

      const user = await db.users.findById(watch.userId).catch(() => null);
      if (!user || user.isBanned) {
        result.skipped += 1;
        continue;
      }

      const gameTitle = watch.gameTitle || deal.gameTitle || deal.title;
      const created = await notify({
        userId: watch.userId,
        type: 'price_alert',
        title: `Cena je pala: ${gameTitle}`,
        message: `${money(deal.price, deal.currency)} (cilj ${money(watch.targetPrice, watch.currency || deal.currency)}) u prodavnici ${deal.store}.`,
        link: `/deals/${deal.id}`,
      }).catch((error) => {
        logger.warn({ err: error, dealId, userId: watch.userId }, 'price_alert_send_failed');
        return null;
      });

      if (created) {
        await db.watches.update(watch.id, { notifiedAt: new Date().toISOString() }).catch(() => null);
        result.sent += 1;
      } else {
        result.skipped += 1;
      }
    }
  } catch (error) {
    logger.warn({ err: error, dealId }, 'price_alert_failed');
  }
  return result;
}
