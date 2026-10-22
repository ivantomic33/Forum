import { Router } from 'express';
import { db } from '../lib/store.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { getAuditLog, recordAudit } from './users.js';
import { awardXp } from '../lib/gamification.js';
import { sendNewsletterCampaign, appUrl } from '../lib/email.js';
import { newsletterCampaignSchema, validate } from '../lib/schemas.js';
import { parseSegment, sanitizeSubject, subscriberSegment } from '../lib/newsletter.js';
import { unsubscribePageUrl } from './newsletter.js';
import { MAX_UPLOAD_BYTES, STORAGE_BUCKET, deleteMedia, listMedia, storageConfigured } from '../lib/storage.js';

const router = Router();

// In-memory konfiguracija portala (Announcement banner, maintenance mode, registracija)
interface SiteSettings {
  announcement: {
    active: boolean;
    message: string;
    tone: 'info' | 'warning' | 'danger';
    link?: string;
  };
  registrationOpen: boolean;
  maintenanceMode: boolean;
}

let currentSettings: SiteSettings = {
  announcement: {
    active: false,
    message: '',
    tone: 'info',
    link: '',
  },
  registrationOpen: true,
  maintenanceMode: false,
};

export function getPublicSiteSettings() {
  return currentSettings;
}

// JAVNI GET za layout i banner (bez auth ili pre admin provere)
router.get('/settings/public', (_req, res) => {
  res.json({ settings: currentSettings });
});

// Sve ostale rute ispod zahtevaju admin rolu
router.use(authenticate, authorize('admin'));

// =====================
// GET & PUT /api/admin/settings
// =====================
router.get('/settings', (_req: AuthRequest, res) => {
  res.json({ settings: currentSettings });
});

router.put('/settings', async (req: AuthRequest, res) => {
  const { announcement, registrationOpen, maintenanceMode } = req.body ?? {};
  if (announcement !== undefined) {
    currentSettings.announcement = {
      active: Boolean(announcement.active),
      message: String(announcement.message || '').slice(0, 300),
      tone: announcement.tone === 'warning' || announcement.tone === 'danger' ? announcement.tone : 'info',
      link: announcement.link ? String(announcement.link).slice(0, 200) : '',
    };
  }
  if (registrationOpen !== undefined) {
    currentSettings.registrationOpen = Boolean(registrationOpen);
  }
  if (maintenanceMode !== undefined) {
    currentSettings.maintenanceMode = Boolean(maintenanceMode);
  }

  await recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    targetId: 'system',
    targetUsername: 'Portal Settings',
    action: 'role_change',
    from: 'Podešavanja sajta ažurirana',
    to: currentSettings,
  });

  res.json({ message: 'Podešavanja su ažurirana.', settings: currentSettings });
});

// =====================
// GET /api/admin/media (2.6.2) — stanje Supabase Storage za admin panel
// =====================
// Bez ovoga admin ne zna zašto je dugme „Otpremi“ vratilo 503: bucket se
// pravi SQL migracijom, a ključevi env promenljivama. Ruta vraća samo
// boolean-e — nijedan ključ ne izlazi napolje.
router.get('/media', (_req: AuthRequest, res) => {
  res.json({
    configured: storageConfigured(),
    bucket: STORAGE_BUCKET,
    maxUploadMb: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024),
  });
});

// =====================
// GET /api/admin/media/items (2.6.3) — medijska galerija (lista + brisanje)
// =====================
router.get('/media/items', authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    if (!storageConfigured()) {
      return res.json({ configured: false, items: [] });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    res.json({ configured: true, items: await listMedia(limit) });
  } catch (err) {
    next(err);
  }
});

// =====================
// DELETE /api/admin/media/items?path=<userId>/<file> (2.6.3)
// =====================
router.delete('/media/items', authorize('admin'), async (req: AuthRequest, res, next) => {
  try {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!path) return res.status(400).json({ error: 'Nedostaje putanja fajla.' });
    await deleteMedia(path);
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: path,
      targetUsername: path,
      action: 'comment_deleted',
      from: { media: path },
      to: null,
    }).catch(() => undefined);
    res.json({ message: 'Fajl je obrisan.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/admin/broadcast (2.6.2) — newsletter kampanja po segmentu
// =====================
// - Segment: `active` (podrazumevano), `pending`, `unsubscribed`, `all`.
// - Svaki mejl nosi vlastiti potpisani link za odjavu (`/newsletter/unsubscribe`).
// - `testEmail` šalje samo JEDAN mejl — kampanja se ne pokreće.
// - Odgovor NE otkriva pojedinačne adrese, samo broj poslatih/neuspešnih.
router.post('/broadcast', async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(newsletterCampaignSchema, req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }
    const { content, segment = 'active', testEmail } = parsed.data;
    const subject = sanitizeSubject(parsed.data.subject);
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;line-height:1.6;">${content}</div>`;

    if (testEmail) {
      const sent = await sendNewsletterCampaign(testEmail, {
        subject: `[TEST] ${subject}`,
        html,
        unsubscribeUrl: `${appUrl()}/newsletter/unsubscribe`,
      });
      return res.json({ message: sent ? 'Test mejl je poslat.' : 'Test mejl nije poslat — proveri EMAIL provajdera.', test: true, sentCount: sent ? 1 : 0 });
    }

    // 2.6.2 — `unsubscribed` je samo za pregled: kampanja ga nikad ne šalje,
    // čak i ako je segment u zahtevu namerno izabran (zaštita od greške u UI-ju).
    if (segment === 'unsubscribed') {
      return res.status(400).json({ error: 'Odjavljeni pretplatnici se ne kontaktiraju. Izaberi drugi segment ili „test“.' });
    }

    const subscribers = await db.newsletter.findAll();
    const targets = subscribers.filter((sub) => segment === 'all' || subscriberSegment(sub) === segment);

    let sentCount = 0;
    let failed = 0;
    for (const sub of targets) {
      const ok = await sendNewsletterCampaign(sub.email, {
        subject,
        html,
        unsubscribeUrl: unsubscribePageUrl(sub.email),
      });
      if (ok) sentCount++;
      else failed++;
    }

    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: 'newsletter',
      targetUsername: `${sentCount} pretplatnika (${segment})`,
      action: 'role_change',
      from: 'Newsletter kampanja',
      to: { subject, segment, sentCount, failed },
    });

    res.json({
      message: `Newsletter poslat na ${sentCount} adresa${failed ? `, ${failed} neuspešno` : ''}.`,
      sentCount,
      failed,
      segment,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/admin/users/:id/award (Ručna dodela bedža i XP-a)
// =====================
router.post('/users/:id/award', async (req: AuthRequest, res, next) => {
  try {
    const target = await db.users.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const { badgeCode, xpBonus } = req.body ?? {};
    if (badgeCode) {
      await db.users.addBadge(target.id, String(badgeCode));
    }
    if (Number(xpBonus) > 0) {
      await awardXp(target.id, Number(xpBonus), { reason: 'admin_award' });
    }

    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: target.id,
      targetUsername: target.username,
      action: 'badge_awarded',
      from: null,
      to: { badgeCode, xpBonus },
    });

    res.json({ message: `Nagrada je uspešno dodeljena korisniku ${target.username}.` });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET & DELETE /api/admin/comments (Moderacija komentara na člancima)
// =====================
router.get('/comments', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const comments = await db.articles.listAllComments(limit);
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

router.delete('/comments/:id', async (req: AuthRequest, res, next) => {
  try {
    const ok = await db.articles.deleteComment(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Komentar nije pronađen.' });

    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: req.params.id,
      targetUsername: 'Article Comment',
      action: 'comment_deleted',
      from: null,
      to: null,
    });

    res.json({ message: 'Komentar je obrisan.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/stats (metrike za komandnu tablu)
// ====================
router.get('/stats', async (_req: AuthRequest, res, next) => {
  try {
    // F-18 — metrike preko COUNT-a, ne učitavanjem celih tabela.
    // `totalViews` zalteva SUM; ide preko agregatnog upita u data layer-u.
    const [totalUsers, moderators, totalArticles, publishedArticles, totalThreads, totalSubscribers] = await Promise.all([
      db.users.count(),
      db.users.countStaff(),
      db.articles.count(),
      db.articles.count({ status: 'published' }),
      db.forum.countThreads(),
      db.newsletter.countActive(),
    ]);

    const views = await db.articles.sumViews().catch(() => 0);
    const threadViews = await db.forum.sumViews().catch(() => 0);

    res.json({
      totalUsers,
      moderators,
      totalArticles,
      publishedArticles,
      totalThreads,
      totalSubscribers,
      totalViews: views + threadViews,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/audit-log (revizorski trag admin akcija)
// =====================
router.get('/audit-log', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ entries: (await getAuditLog()).slice(0, limit) });
  } catch (err) {
    next(err);
  }
});

export default router;
