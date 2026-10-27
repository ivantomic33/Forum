import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/store.js';
import { notificationListResponseSchema } from '../../contracts/index.js';
import { respond } from '../lib/respond.js';
import {
  EMAIL_NOTIFICATION_TYPES,
  getNotificationEmailPrefs,
  setNotificationEmailPrefs,
} from '../lib/notifications.js';
// Mejl kanal notifikacija je ugašen (mejl samo za verifikaciju i reset lozinke).
import { emailConfigured } from '../lib/email.js';
import { getNotificationPreferences, setNotificationPreferences, PUSH_MUTABLE_TYPES } from '../lib/notificationPreferences.js';
import { isPushConfigured } from '../lib/pushNotification.js';

const router = Router();

// =====================
// 2.11.0 — MEJL KANAL NOTIFIKACIJA (podešavanja)
// GET  /api/notifications/email-prefs — `{ enabled, muted, providerConfigured, availableTypes }`
// PUT  /api/notifications/email-prefs — `{ enabled?, muted? }`
// =====================
//
// Mejl kanal je UGAŠEN: notifikacije ne idu mejlom ni za jedan tip — mejl se
// šalje samo za verifikaciju adrese i reset lozinke. Rute ostaju radi
// kompatibilnosti klijenta i vraćaju prazan `availableTypes`.
router.get('/email-prefs', authenticate, async (req: AuthRequest, res) => {
  try {
    const prefs = await getNotificationEmailPrefs(req.user!.id);
    res.json({
      ...prefs,
      // UI prikazuje napomenu kada provajder nije podešen na serveru.
      providerConfigured: emailConfigured(),
      availableTypes: [...EMAIL_NOTIFICATION_TYPES],
    });
  } catch (err) {
    req.log?.error({ err }, 'notification_email_prefs_failed');
    res.status(500).json({ error: 'Podešavanja nisu dostupna.' });
  }
});

router.put('/email-prefs', authenticate, async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {};
    const muted = Array.isArray(body.muted)
      ? body.muted.filter((type: unknown) => typeof type === 'string' && EMAIL_NOTIFICATION_TYPES.has(type as any))
      : undefined;

    const prefs = await setNotificationEmailPrefs(req.user!.id, {
      enabled: body.enabled === undefined ? undefined : body.enabled === true,
      muted,
    });
    res.json({ ...prefs, providerConfigured: emailConfigured() });
  } catch (err) {
    req.log?.error({ err }, 'notification_email_prefs_update_failed');
    res.status(500).json({ error: 'Podešavanja nisu sačuvana.' });
  }
});

// =====================
// 6.x — TIŠI SATI + IZBOR TIPOVA ZA PUSH
// GET  /api/notifications/prefs — `{ quietHours, pushMuted, availableTypes }`
// PUT  /api/notifications/prefs — `{ quietHours?, pushMuted? }`
// =====================
//
// Zvonce/inbox se NIKAD ne isključuju — ovo menja samo da li uređaj zvoni
// (web push). U tihim satima notifikacija i dalje ulazi u inbox, samo bez zvuka.
router.get('/prefs', authenticate, async (req: AuthRequest, res) => {
  try {
    const prefs = await getNotificationPreferences(req.user!.id);
    res.json({ ...prefs, availableTypes: PUSH_MUTABLE_TYPES, pushConfigured: isPushConfigured() });
  } catch (err) {
    req.log?.error({ err }, 'notification_prefs_failed');
    res.status(500).json({ error: 'Podešavanja nisu dostupna.' });
  }
});

router.put('/prefs', authenticate, async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {};
    const prefs = await setNotificationPreferences(req.user!.id, {
      quietHours: body.quietHours,
      pushMuted: body.pushMuted,
    });
    res.json({ ...prefs, availableTypes: PUSH_MUTABLE_TYPES, pushConfigured: isPushConfigured() });
  } catch (err) {
    req.log?.error({ err }, 'notification_prefs_update_failed');
    res.status(500).json({ error: 'Podešavanja nisu sačuvana.' });
  }
});

// GET /api/notifications - Lista notifikacija za trenutnog korisnika
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { limit = '50', offset = '0', unreadOnly } = req.query;

    const notifications = await db.notifications?.list({
      userId,
      unreadOnly: unreadOnly === 'true',
      limit: Math.min(parseInt(limit as string, 10) || 50, 100),
      offset: parseInt(offset as string, 10) || 0,
    });

    const unreadCount = await db.notifications?.countUnread(userId);

    respond(res, notificationListResponseSchema, {
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    });
  } catch (err: any) {
    req.log?.error({ err }, 'notifications_list_failed');
    res.status(500).json({ error: 'Greška pri učitavanju notifikacija.' });
  }
});

// GET /api/notifications/unread-count — lagani brojač za zvonce (bez liste)
router.get('/unread-count', authenticate, async (req: AuthRequest, res) => {
  try {
    const unreadCount = await db.notifications.countUnread(req.user!.id);
    res.json({ unreadCount: unreadCount || 0 });
  } catch (err: any) {
    req.log?.error({ err }, 'unread_count_failed');
    res.status(500).json({ error: 'Greška pri brojanju notifikacija.' });
  }
});

// PATCH /api/notifications/read - Označi sve kao pročitano
router.patch('/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { notificationIds } = req.body;

    if (notificationIds && Array.isArray(notificationIds)) {
      // Označi samo specifične notifikacije
      await db.notifications?.markAsRead(userId, notificationIds);
    } else {
      // Označi sve notifikacije korisnika kao pročitane
      await db.notifications?.markAllAsRead(userId);
    }

    res.json({ message: 'Notifikacije su označene kao pročitane.' });
  } catch (err: any) {
    req.log?.error({ err }, 'mark_read_failed');
    res.status(500).json({ error: 'Greška pri ažuriranju notifikacija.' });
  }
});

// DELETE /api/notifications/:id - Obriši notifikaciju
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    const notification = await db.notifications?.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ error: 'Notifikacija nije pronađena.' });
    }

    if (notification.userId !== userId) {
      return res.status(403).json({ error: 'Nemate dozvolu za brisanje ove notifikacije.' });
    }

    await db.notifications?.delete(notificationId);
    res.json({ message: 'Notifikacija je obrisana.' });
  } catch (err: any) {
    req.log?.error({ err }, 'notification_delete_failed');
    res.status(500).json({ error: 'Greška pri brisanju notifikacije.' });
  }
});

export default router;
