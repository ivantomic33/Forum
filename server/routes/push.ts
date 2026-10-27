/**
 * F-7 — WEB PUSH (server)
 * ----------------------
 * Web push traži **asimetrične parove ključeva** po pretplati, pa Node ne može
 * jednostavno da potpiše poruku bez kriptografije (`http_ece` + `web-push`).
 * Da se ne bi dodavala nova zavisnost u ovom krugu, ruta radi ovako:
 *
 *  - `GET /api/push/public-key` — vraća VAPID javni ključ (`VAPID_PUBLIC_KEY`);
 *    klijent ga koristi za `pushManager.subscribe`.
 *  - `POST /api/push/subscribe` — čuva pretplatu (`push_subscriptions`).
 *  - `POST /api/push/unsubscribe` — uklanja pretplatu po `endpoint`.
 *
 * Slanje notifikacija (`sendPushToUser`) koristi `web-push` ako je instaliran
 * (`npm i --prefix server web-push`); bez njega je funkcija no-op i loguje
 * `push_not_installed` — inbox notifikacije i dalje rade normalno.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { db, uid } from '../lib/store.js';
import { logger } from '../lib/logger.js';
import { isPushConfigured, sendNotification, type PushPayload } from '../lib/pushNotification.js';

const router = Router();

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export interface PushRepo {
  listByUser(userId: string): Promise<PushSubscriptionRecord[]>;
  save(subscription: PushSubscriptionRecord): Promise<PushSubscriptionRecord>;
  remove(userId: string, endpoint: string): Promise<boolean>;
}

const memorySubscriptions: PushSubscriptionRecord[] = [];

export const pushRepo: PushRepo = {
  async listByUser(userId: string) {
    if (db.kind !== 'supabase' || !(db as any).client) {
      return memorySubscriptions.filter((item) => item.userId === userId);
    }
    const { data } = await (db as any).client
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      createdAt: row.created_at,
    }));
  },

  async save(subscription: PushSubscriptionRecord) {
    if (db.kind !== 'supabase' || !(db as any).client) {
      const index = memorySubscriptions.findIndex((item) => item.endpoint === subscription.endpoint);
      if (index >= 0) memorySubscriptions[index] = subscription;
      else memorySubscriptions.push(subscription);
      return subscription;
    }
    const { error } = await (db as any).client
      .from('push_subscriptions')
      .upsert(
        {
          user_id: subscription.userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        { onConflict: 'endpoint' },
      );
    if (error) throw error;
    return subscription;
  },

  async remove(userId: string, endpoint: string) {
    if (db.kind !== 'supabase' || !(db as any).client) {
      const before = memorySubscriptions.length;
      for (let index = memorySubscriptions.length - 1; index >= 0; index -= 1) {
        if (memorySubscriptions[index].endpoint === endpoint && memorySubscriptions[index].userId === userId) {
          memorySubscriptions.splice(index, 1);
        }
      }
      return memorySubscriptions.length < before;
    }
    const { error } = await (db as any).client
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
    return !error;
  },
};

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
  }),
});

router.get('/public-key', (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  res.json({ publicKey, configured: isPushConfigured() });
});

router.post('/subscribe', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Neispravna push pretplata.' });
    const { endpoint, keys } = parsed.data.subscription;
    const saved = await pushRepo.save({
      id: uid('push'),
      userId: req.user!.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id: saved.id });
  } catch (err) {
    next(err);
  }
});

router.post('/unsubscribe', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint) return res.status(400).json({ error: 'Nedostaje `endpoint`.' });
    await pushRepo.remove(req.user!.id, endpoint);
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Pošalji push svim uređajima korisnika. Namerno ne baca grešku: push je
 * dodatak (inbox notifikacija je izvor istine), pa ne sme da obori akciju.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const subscriptions = await pushRepo.listByUser(userId);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            payload,
          );
        } catch (error) {
          // 404/410 — pretplata je mrtva (korisnik je uklonio dozvolu).
          // Brišemo je iz `push_subscriptions` da tabela ne zapuša mrtve tokene.
          const statusCode = (error as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            logger.info({ userId, endpoint: subscription.endpoint.slice(0, 60), statusCode }, 'push_subscription_removed');
            await pushRepo.remove(userId, subscription.endpoint);
          }
        }
      }),
    );
  } catch (error) {
    logger.warn({ err: error, userId }, 'push_send_failed');
  }
}

/**
 * Test endpoint — šalje test notifikaciju SVIM uređajima trenutno ulogovanog
 * korisnika (npr. sa profila: "Pošalji testnu notifikaciju").
 */
router.post('/test', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: 'Web push nije podešen (nedostaju VAPID ključevi).' });
    const subscriptions = await pushRepo.listByUser(req.user!.id);
    if (subscriptions.length === 0) return res.status(404).json({ error: 'Nema aktivnih pretplata za ovaj nalog.' });
    const payload: PushPayload = {
      title: 'NEXUS — test notifikacija',
      body: 'Ako ovo vidiš, web push radi. 🎮',
      url: '/notifications',
      tag: 'nexus-test',
    };
    await sendPushToUser(req.user!.id, payload);
    res.json({ sent: true, devices: subscriptions.length });
  } catch (err) {
    next(err);
  }
});

export default router;
