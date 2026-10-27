/**
 * F-7 — WEB PUSH SERVIS (slanje)
 * ------------------------------
 * Jedino mesto koje zna za `web-push` i VAPID ključeve:
 *  - `initPush()` — `setVapidDetails` JEDNOM pri pokretanju + upozorenje ako
 *    ključevi nedostaju (server se NE ruši: push je dodatak, inbox notifikacije
 *    su izvor istine).
 *  - `sendNotification(subscription, payload)` — šalje jednu notifikaciju;
 *    404/410 znači „pretplata mrtva“ (korisnik je opozvao dozvolu ili je
 *    endpoint istekao) pa je pozivalac dužan da je obriše iz `push_subscriptions`.
 *  - `isPushConfigured()` — za startup log i `GET /api/push/public-key`.
 *
 * Payload je validan JSON string: `{ title, body, icon, url, data }` — `public/sw.js`
 * ga parsira u `push` listener-u (`event.data.json()`).
 */

import webpush from 'web-push';
import { logger } from './logger.js';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export interface PushSubscriptionLike {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@nexusgaming.com';

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/** Pozvati JEDNOM pri pokretanju servera (vidi `index.ts`). */
export function initPush(): void {
  if (!isPushConfigured()) {
    logger.warn(
      'push_vapid_missing — WEB PUSH je ISKLJUČEN. Generiši ključeve sa `npx web-push generate-vapid-keys` ' +
      'i postavi VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT u server/.env',
    );
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  logger.info('push_initialized — VAPID detalji postavljeni, web-push aktivan.');
}

/**
 * Pošalji JEDNU notifikaciju. Baca grešku (da je pozivalac, koji zna `userId`,
 * može da obriše mrtvu pretplatu) — ali nikad ne baca greške koje nisu „mrtva
 * pretplata“: te se loguju i tretiraju kao prenosivi (retry-able) problemi.
 */
export async function sendNotification(
  subscription: PushSubscriptionLike,
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60 * 24, // 24h — notifikacija starija od toga je bezvredna
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // 404/410 — endpoint više ne postoji (mrtav token). Signal pozivaocu.
      const gone = new Error(`push_subscription_gone (${statusCode})`);
      (gone as Error & { statusCode?: number }).statusCode = statusCode;
      throw gone;
    }
    // Ostalo (mreža, 5xx push servisa, VAPID/encryption greške) — ne ruši proces.
    logger.warn({ err: error, endpoint: subscription.endpoint.slice(0, 60) }, 'push_send_failed');
  }
}
