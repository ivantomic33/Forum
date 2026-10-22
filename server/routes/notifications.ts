import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/store.js';

const router = Router();

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

    res.json({ 
      notifications: notifications || [], 
      unreadCount: unreadCount || 0 
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
