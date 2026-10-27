import { Router } from 'express';
import { db } from '../lib/store.js';
import { authenticate, authorize, invalidateSessionCache, type AuthRequest } from '../middleware/auth.js';
import { getAuditLog, recordAudit } from './users.js';
import { BADGE_CATALOG } from '../lib/gamification.js';
import { newsletterCampaignSchema, validate } from '../lib/schemas.js';
import { parseSegment, sanitizeSubject, subscriberSegment } from '../lib/newsletter.js';
import { cancelScheduled, listScheduled, scheduleCampaign } from '../lib/campaigns.js';
import { notify } from '../lib/notifications.js';

/** Slug iz naziva kategorije (latinica-friendly); prazno ako nema validnih znakova. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
import { MAX_UPLOAD_BYTES, STORAGE_BUCKET, deleteMedia, listMedia, storageConfigured } from '../lib/storage.js';
import { lastDigestSentAt, sendDigestToSubscribers } from '../lib/digest.js';
import { buildDigest } from '../lib/newsAutomation.js';
import { syncSteamPrices } from '../lib/priceSync.js';
import { logger } from '../lib/logger.js';
import { positiveInt } from '../lib/env.js';
import { isPushConfigured } from '../lib/pushNotification.js';
import { presenceMode } from '../lib/presence.js';
import { addIpBan, isIpBanned, isValidIp, loadIpBans, normalizeIp, removeIpBan } from '../lib/ipBans.js';

// =====================
// F-7b — ANALITIKA: in-memory keš za /stats (5 min TTL po range-u)
// Admin refreshi ne smeju da pogađaju GROUP BY agregacije na svaki klik.
// =====================
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const statsCache = new Map<string, { data: StatsCacheable; expiresAt: number }>();

/** Dozvoljeni range parametri — sve ostalo pada na 7d (bez SQL injection-a kroz query). */
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lista dana YYYY-MM-DD od `from` do `to` (uključivo) — za 0-popunjenu seriju. */
function daysBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    days.push(isoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

interface TopItem {
  id: string;
  title: string;
  slug?: string | null;
  kind: 'article' | 'thread';
  views: number;
  author?: string | null;
}
interface StatsCacheable {
  overview: { periodViews: number; viewsGrowth: number };
  viewsOverTime: { date: string; views: number }[];
  topArticles: TopItem[];
  retentionOrEngagement: { category: string; views: number; percentage: number }[];
}

const router = Router();

// Konfiguracija portala (Announcement banner, maintenance mode, registracija).
// Izvor istine je `site_meta` (`lib/siteSettings.ts`) — ne `let` u modulu, pa
// podešavanja prežive restart i vide ih sve instance. `admin.ts` samo re-eksportuje
// `getPublicSiteSettings` jer ga `routes/auth.ts` i `routes/oauth.ts` već uvoze odavde.
import { getPublicSiteSettings, updateSiteSettings } from '../lib/siteSettings.js';
export { getPublicSiteSettings };

// JAVNI GET za layout i banner (bez auth ili pre admin provere)
router.get('/settings/public', (_req, res) => {
  res.json({ settings: getPublicSiteSettings() });
});

// Sve ostale rute ispod zahtevaju admin rolu
router.use(authenticate, authorize('admin'));

// =====================
// GET & PUT /api/admin/settings
// =====================
router.get('/settings', (_req: AuthRequest, res) => {
  res.json({ settings: getPublicSiteSettings() });
});

router.put('/settings', async (req: AuthRequest, res) => {
  const updated = await updateSiteSettings(req.body ?? {});

  await recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    targetId: 'system',
    targetUsername: 'Portal Settings',
    action: 'role_change',
    from: 'Podešavanja sajta ažurirana',
    to: updated,
  });

  res.json({ message: 'Podešavanja su ažurirana.', settings: updated });
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
// - SLANJE JE UGAŠENO: mejl ide samo za verifikaciju adrese i reset lozinke.
//   Ruta ostaje (kompatibilnost UI-ja) i zakazivanje se i dalje upisuje u red,
//   ali se ništa ne šalje — odgovor to eksplicitno kaže.
router.post('/broadcast', async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(newsletterCampaignSchema, req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }
    const { content, segment = 'active' } = parsed.data;
    const subject = sanitizeSubject(parsed.data.subject);
    const altSubject = parsed.data.subjectB ? sanitizeSubject(parsed.data.subjectB) : null;

    // Zakazivanje ide istim telom: ako je `scheduledAt` u budućnosti, kampanja se
    // upisuje u red (red se čuva radi pregleda/otkazivanja; slanje je ugašeno).
    if (parsed.data.scheduledAt) {
      const when = new Date(parsed.data.scheduledAt);
      if (when.getTime() > Date.now()) {
        try {
          const campaign = await scheduleCampaign({
            subject,
            subjectB: altSubject,
            content,
            segment: segment === 'unsubscribed' ? 'active' : segment,
            scheduledAt: when.toISOString(),
            createdBy: req.user!.username,
          });
          return res.status(202).json({
            message: `Kampanja je zakazana za ${when.toLocaleString('sr-RS')}, ali slanje mejlom je ugašeno.`,
            scheduled: campaign,
            disabled: true,
          });
        } catch (error: any) {
          return res.status(400).json({ error: error?.message ?? 'Zakazivanje nije uspelo.' });
        }
      }
    }

    res.json({
      message: 'Slanje newslettera mejlom je ugašeno — mejl se šalje samo za verifikaciju adrese i reset lozinke.',
      disabled: true,
      sentCount: 0,
      failed: 0,
      segment,
      abTest: altSubject ? { subjectA: subject, subjectB: altSubject, sentB: 0, sentA: 0 } : null,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET/DELETE /api/admin/newsletter/scheduled — red zakazanih kampanja
// =====================
router.get('/newsletter/scheduled', async (_req, res, next) => {
  try {
    res.json({ campaigns: await listScheduled() });
  } catch (err) {
    next(err);
  }
});

router.delete('/newsletter/scheduled/:id', async (req: AuthRequest, res, next) => {
  try {
    const cancelled = await cancelScheduled(String(req.params.id));
    if (!cancelled) return res.status(404).json({ error: 'Zakazana kampanja nije pronađena ili je već poslata.' });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: 'newsletter',
      targetUsername: `kampanja ${req.params.id}`,
      action: 'role_change',
      from: 'Zakazana kampanja',
      to: { cancelled: req.params.id },
    }).catch(() => undefined);
    res.json({ message: 'Kampanja je otkazana.', cancelled: true });
  } catch (err) {
    next(err);
  }
});

// =====================
// F-8 — GET/POST /api/admin/digest (nedeljni „Najbolje iz NEXUS-a“)
// =====================
// `GET` pokazuje kada je poslednji put poslat (tajmer šalje ponedeljkom).
// `POST` { dryRun?, force? } šalje odmah; `dryRun` vraća HTML payload bez mejla.
router.get('/digest', async (_req, res, next) => {
  try {
    res.json({ lastSentAt: await lastDigestSentAt() });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/news/digest — 2.13.0 pregled dnevnog/nedeljnog digest-a
// =====================
// Vraća sastav (naslov, 5 najčitanijih vesti, HTML) BEZ slanja — mejl pušta
// samo verifikaciju i reset, pa admin vidi tačno šta bi otišlo pretplatnicima.
router.get('/news/digest', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const digest = await buildDigest({
      days: Number(req.query.days ?? 7),
      limit: Number(req.query.limit ?? 5),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(digest);
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/news/sources — 2.13.0 koliko vesti dolazi iz kojeg izvora
// =====================
router.get('/news/sources', authenticate, authorize('admin', 'moderator'), async (_req: AuthRequest, res, next) => {
  try {
    const articles = await db.articles.findAll({ status: 'published' });
    const bySource: Record<string, { total: number; lastAt: string | null; last7d: number }> = {};
    const byCategory: Record<string, number> = {};
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const article of articles) {
      byCategory[article.category] = (byCategory[article.category] ?? 0) + 1;
      const source = article.newsSource || '(ručno)';
      const entry = (bySource[source] ??= { total: 0, lastAt: null, last7d: 0 });
      entry.total += 1;
      const stamp = article.publishedAt ?? article.createdAt;
      if (stamp && (!entry.lastAt || stamp > entry.lastAt)) entry.lastAt = stamp;
      if (stamp && new Date(stamp).getTime() > weekAgo) entry.last7d += 1;
    }

    /**
     * 2.13.2 — poslednja 10 uvezenih vesti sa signalima kvaliteta: bez slike,
     * kratak tekst. Ovo je jedino mesto gde admin vidi problem PRE nego što ga
     * čitalac primeti na naslovnoj.
     */
    const recent = [...articles]
      .filter((article) => article.newsSource || article.sourceUrl)
      .sort(
        (a, b) =>
          new Date(b.publishedAt ?? b.createdAt).getTime() - new Date(a.publishedAt ?? a.createdAt).getTime(),
      )
      .slice(0, 10)
      .map((article) => ({
        title: article.title,
        newsSource: article.newsSource ?? null,
        publishedAt: article.publishedAt ?? article.createdAt,
        hasImage: Boolean(article.coverImage),
        length: (article.content ?? '').length,
      }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({ total: articles.length, bySource, byCategory, recent });
  } catch (err) {
    next(err);
  }
});

router.post('/digest/send', async (req: AuthRequest, res, next) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const force = req.body?.force === true;
    const result = await sendDigestToSubscribers({ dryRun, force });
    if (result.skipped && result.skipped !== 'already_sent_today') {
      const reason: Record<string, string> = {
        no_content: 'Nema novog sadržaja u poslednjih 7 dana — digest se ne šalje.',
        no_subscribers: 'Nema potvrđenih pretplatnika.',
        no_provider: 'Mejl provajder nije podešen (RESEND_API_KEY / BREVO_API_KEY).',
        disabled: 'Slanje digest-a mejlom je ugašeno (mejl samo za verifikaciju i reset lozinke).',
      };
      return res.status(409).json({ skipped: result.skipped, error: reason[result.skipped] ?? result.skipped });
    }
    if (!dryRun && !result.skipped) {
      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: 'newsletter',
        targetUsername: 'nedeljni digest',
        action: 'role_change',
        from: 'Digest',
        to: { sentCount: result.sentCount, failed: result.failed },
      }).catch(() => undefined);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/health (dijagnostika za admin panel)
// =====================
// Proširuje javni `/api/health`: Storage, Email provajder, Steam sync, verzija,
// uptime. Nikad ne izlaže ključeve.
/** Jefitina provera baze (REST HEAD na `forum_threads` u Supabase režimu). */
async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number }> {
  if (db.kind !== 'supabase') return { ok: true, latencyMs: 0 };
  const url = process.env.SUPABASE_URL;
  if (!url) return { ok: false, latencyMs: 0 };
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/rest/v1/forum_threads?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY ?? '', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY ?? ''}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: res.ok, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

router.get('/health', async (_req: AuthRequest, res, next) => {
  try {
    const dbHealth = await checkDbHealth();

    // Tabela `site_meta` je kritična za podešavanja i ban listu — proveri je.
    let metaOk = false;
    if (db.client) {
      try {
        const { error } = await db.client.from('site_meta').select('key').limit(1);
        metaOk = !error;
      } catch {
        metaOk = false;
      }
    } else {
      metaOk = true; // memory režim nema tabelu — nije greška
    }

    const emailProvider = process.env.RESEND_API_KEY ? 'resend' : process.env.BREVO_API_KEY ? 'brevo' : null;

    res.json({
      status: dbHealth.ok && metaOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? 'dev',
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      db: {
        mode: db.kind,
        ok: dbHealth.ok,
        latencyMs: dbHealth.latencyMs,
        siteMeta: metaOk,
      },
      storage: {
        configured: storageConfigured(),
        bucket: STORAGE_BUCKET,
      },
      email: {
        provider: emailProvider,
        configured: Boolean(emailProvider),
        // 6.x — mejl je NAMERNO samo za verifikaciju i reset lozinke; admin
        // panel prikazuje to stanje umesto da izgleda kao „polupodešeno“.
        purpose: 'transactional_only',
        notificationsEnabled: false,
        allowedTypes: ['verification', 'password_reset'],
      },
      // 6.x — kanali notifikacija: inbox je uvek aktivan, push/realtime zavise
      // od env-a. Ovo je mesto gde se vidi da nešto `ne zvoni` a da nije greška.
      notifications: {
        inbox: true,
        realtime: presenceMode.broadcast() === 'supabase',
        push: isPushConfigured(),
        quietHoursSupported: true,
      },
      steamSync: {
        enabled: (process.env.STEAM_SYNC_ENABLED ?? '1') !== '0',
      },
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/rate-limits (pregled aktivnih rate limita)
// =====================
// Limiti su env-driven; ruta samo prikazuje trenutne vrednosti sa istim
// `process.env` ključevima koje limiteri koriste pri startu.
router.get('/rate-limits', (_req: AuthRequest, res) => {
  const pi = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : fallback;
  };
  res.json({
    limits: [
      { name: 'general', label: 'Opšti API (čitanje)', window: '15 min', max: pi(process.env.RATE_LIMIT_READ_MAX, 400) },
      { name: 'auth', label: 'Prijava / registracija', window: '15 min', max: pi(process.env.RATE_LIMIT_AUTH_MAX, 20) },
      { name: 'lookup', label: 'Provera dostupnosti (username/email)', window: '1 min', max: pi(process.env.RATE_LIMIT_LOOKUP_MAX, 60) },
      { name: 'account', label: 'Akcije nad nalogom', window: '15 min', max: pi(process.env.RATE_LIMIT_ACCOUNT_MAX, 10) },
      { name: '2fa', label: '2FA kodovi', window: '15 min', max: pi(process.env.RATE_LIMIT_2FA_MAX, 8) },
      { name: 'search', label: 'Pretraga', window: '1 min', max: pi(process.env.RATE_LIMIT_SEARCH_MAX, 30) },
      { name: 'thread', label: 'Nove teme (po korisniku)', window: '10 min', max: pi(process.env.THREAD_RATE_LIMIT, 10) },
      { name: 'reply', label: 'Odgovori (po korisniku)', window: '10 min', max: pi(process.env.REPLY_RATE_LIMIT, 30) },
      { name: 'deal', label: 'Novi popusti', window: '1 h', max: pi(process.env.DEAL_RATE_LIMIT, 10) },
      { name: 'deal_vote', label: 'Glasovi na popustima', window: '10 min', max: pi(process.env.DEAL_VOTE_RATE_LIMIT, 60) },
      { name: 'deal_preview', label: 'Provera deal linkova', window: '10 min', max: pi(process.env.DEAL_PREVIEW_RATE_LIMIT, 40) },
      { name: 'collection', label: 'Nove kolekcije', window: '1 h', max: pi(process.env.COLLECTION_RATE_LIMIT, 20) },
    ],
    note: 'Vrednosti se podešavaju preko env promenljivih (RATE_LIMIT_*, THREAD_RATE_LIMIT, DEAL_*). Izmena zahteva restart procesa.',
  });
});

// =====================
// IP BAN LISTA (GET / POST / DELETE)
// =====================
router.get('/ip-bans', async (_req: AuthRequest, res, next) => {
  try {
    res.json({ bans: await loadIpBans() });
  } catch (err) {
    next(err);
  }
});

router.post('/ip-bans', async (req: AuthRequest, res, next) => {
  try {
    const ip = normalizeIp(String(req.body?.ip ?? ''));
    const reason = String(req.body?.reason ?? 'Ručni IP ban').slice(0, 200);
    if (!isValidIp(ip)) {
      return res.status(400).json({ error: 'Nevažeća IP adresa.' });
    }
    const ban = await addIpBan(ip, reason, req.user!.username);
    if (!ban) return res.status(400).json({ error: 'Nevažeća IP adresa.' });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: ban.ip,
      targetUsername: 'IP',
      action: 'ban',
      from: null,
      to: { ip: ban.ip, reason },
    }).catch(() => undefined);
    res.status(201).json({ message: `IP ${ban.ip} je banovan.`, ban });
  } catch (err) {
    next(err);
  }
});

router.delete('/ip-bans/:ip', async (req: AuthRequest, res, next) => {
  try {
    const removed = await removeIpBan(req.params.ip);
    if (!removed) return res.status(404).json({ error: 'IP ban nije pronađen.' });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: req.params.ip,
      targetUsername: 'IP',
      action: 'unban',
      from: { ip: req.params.ip },
      to: null,
    }).catch(() => undefined);
    res.json({ message: 'IP ban je uklonjen.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/export/:dataset (CSV export za admine)
// =====================
// Datasetovi: `users`, `subscribers`, `reports`, `audit`.
// CSV je ručno generisan string (bez biblioteke), keširana 1 min; svi redovi
// iz ugovora; nikad ne izlaže hash lozinke, verification toka ni session verze.
const EXPORT_DATASETS = new Set(['users', 'subscribers', 'reports', 'audit']);
router.get('/export/:dataset', async (req: AuthRequest, res, next) => {
  try {
    const dataset = String(req.params.dataset ?? '');
    if (!EXPORT_DATASETS.has(dataset)) {
      return res.status(404).json({ error: `Nepoznat dataset. Dozvoljeno: ${[...EXPORT_DATASETS].join(', ')}.` });
    }

    // CSV escape: koma, novi red, dvostruki navodnik; BOM za Excel latinicu.
    const escapeCsv = (value: unknown): string => {
      const text = value == null ? '' : String(value);
      if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    };
    const toCsv = (headers: string[], rows: unknown[][]): string =>
      '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');

    let csv = '';
    if (dataset === 'users') {
      const users = await db.users.findAll();
      csv = toCsv(
        ['id', 'username', 'email', 'role', 'isBanned', 'isVerified', 'xp', 'level', 'karma', 'createdAt'],
        users.map((u) => [u.id, u.username, u.email, u.role, u.isBanned, u.isVerified, u.xp, u.level, u.karma, u.createdAt])
      );
    } else if (dataset === 'subscribers') {
      const subs = await db.newsletter.findAll();
      csv = toCsv(
        ['email', 'isActive', 'subscribedAt', 'confirmedAt', 'unsubscribedAt'],
        subs.map((s) => [s.email, s.isActive, s.subscribedAt, s.confirmedAt ?? '', s.unsubscribedAt ?? ''])
      );
    } else if (dataset === 'reports') {
      const reports = await db.reports.list({});
      csv = toCsv(
        ['id', 'reporterId', 'targetType', 'targetId', 'reason', 'status', 'createdAt'],
        reports.map((r) => [r.id, r.reporterId, r.targetType, r.targetId, r.reason, r.status, r.createdAt])
      );
    } else {
      const entries = await getAuditLog(500);
      csv = toCsv(
        ['at', 'actorId', 'actorUsername', 'action', 'targetId', 'targetUsername'],
        entries.map((e) => [e.at, e.actorId, e.actorUsername, e.action, e.targetId, e.targetUsername])
      );
    }

    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: `export/${dataset}`,
      targetUsername: 'CSV export',
      action: 'role_change',
      from: null,
      to: null,
    }).catch(() => undefined);

    res.type('text/csv; charset=utf-8').set(
      'Content-Disposition',
      `attachment; filename=nexus-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`
    ).send(csv);
  } catch (err) {
    next(err);
  }
});

// =====================
// F-4d — POST /api/admin/steam-price-sync (ručni okidač sinhronizacije cena)
// =====================
// Tajmer (`startSteamPriceSync`) pokreće posao jednom dnevno posle
// `STEAM_SYNC_HOUR`; ovde admin može da ga okine odmah (test/dev ili upravo
// objavljen deal). Sekvencijalno + pauza — Steam limitira po IP-ju.
router.post('/steam-price-sync', async (req: AuthRequest, res, next) => {
  try {
    const result = await syncSteamPrices({ delayMs: Number(req.body?.delayMs) || undefined });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: 'steam-price-sync',
      targetUsername: 'sinhronizacija cena',
      action: 'role_change',
      from: 'SteamSync',
      to: { total: result.total, checked: result.checked, changed: result.changed, alerts: result.alerts, errors: result.errors },
    }).catch(() => undefined);
    res.json(result);
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

    const { badgeCode, xpBonus, reason } = req.body ?? {};

    // 3.0.0 — validacija na serveru (ranije je bilo šta prošlo i upisivalo se
    // u `user_badges`, pa je profil prikazivao nepoznat kod ili ništa).
    const requestedBadge = badgeCode ? String(badgeCode) : '';
    if (requestedBadge && !(requestedBadge in BADGE_CATALOG)) {
      return res.status(400).json({ error: `Nepoznat bedž: ${requestedBadge}.` });
    }
    const bonus = Math.round(Number(xpBonus) || 0);
    if (bonus < 0 || bonus > 10_000) {
      return res.status(400).json({ error: 'XP bonus mora biti između 0 i 10.000.' });
    }
    if (!requestedBadge && bonus <= 0) {
      return res.status(400).json({ error: 'Izaberite bedž ili unesite XP bonus.' });
    }
    const alreadyOwned = requestedBadge ? (target.badges ?? []).includes(requestedBadge) : false;

    const tasks: Promise<unknown>[] = [];
    if (requestedBadge && !alreadyOwned) {
      tasks.push(db.users.addBadge(target.id, requestedBadge));
    }
    if (bonus > 0) {
      // NE kroz `awardXp`: ono prolazi kroz dnevni budžet (`spend_daily_xp`) i
      // tiho odseca bonus na 0 kada je korisnik potrošio dnevnu kvotu.
      tasks.push(db.users.bumpXp(target.id, bonus));
    }
    await Promise.all(tasks);

    // 3.0.0 — dodela od admina je lični događaj: korisnik dobija poruku u inbox.
    // Bedž nosi IME iz kataloga (ne sirovi kod); razlog (ako ga je admin ostavio)
    // je deo poruke, da nagrada ima kontekst.
    const awardReason = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
    const awardBadgeCode = requestedBadge && !alreadyOwned ? requestedBadge : '';
    const badgeName = requestedBadge
      ? (BADGE_CATALOG as Record<string, { name: string }>)[requestedBadge]?.name ?? requestedBadge
      : '';

    // Nema šta da se pošalje (duplikat bedža bez XP bonusa) — ne pravimo praznu
    // notifikaciju; revizorski trag i poruka adminu i dalje postoje.
    if (!awardBadgeCode && bonus <= 0) {
      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: target.id,
        targetUsername: target.username,
        action: 'badge_awarded',
        from: null,
        to: { badgeCode: null, xpBonus: 0, reason: awardReason || null, skippedDuplicate: true },
      });
      return res.json({
        message: `Korisnik ${target.username} već ima bedž „${badgeName}“ — ništa nije promenjeno.`,
        badgeCode: null,
        xpBonus: 0,
        skippedDuplicate: true,
      });
    }

    void notify({
      userId: target.id,
      type: 'badge_earned',
      title: awardBadgeCode ? `Nova značka: ${badgeName} 🏅` : 'Dobio/la si XP nagradu',
      message: [
        awardBadgeCode ? `Administracija ti je dodelila značku „${badgeName}“.` : '',
        bonus > 0 ? `Bonus: +${bonus} XP.` : '',
        awardReason ? `Poruka: ${awardReason}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      link: `/profile/${encodeURIComponent(target.username)}?tab=badges`,
      actorId: req.user!.id,
      metadata: { badgeCode: awardBadgeCode || null, xpBonus: bonus || 0 },
    }).catch(() => null);

    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: target.id,
      targetUsername: target.username,
      action: 'badge_awarded',
      from: null,
      to: {
        badgeCode: awardBadgeCode || null,
        xpBonus: bonus,
        reason: awardReason || null,
        skippedDuplicate: alreadyOwned,
      },
    });

    res.json({
      message: alreadyOwned
        ? `Korisnik ${target.username} već ima bedž „${badgeName}“ — dodeljen je samo XP bonus.`
        : `Nagrada je uspešno dodeljena korisniku ${target.username}.`,
      badgeCode: awardBadgeCode || null,
      xpBonus: bonus,
      skippedDuplicate: alreadyOwned,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/admin/users/:id/adjust-xp (Ručna XP korekcija sa razlogom)
// =====================
// Oba smera idu kroz `db.users.bumpXp` — atomična promena XP-a MIMO dnevnog
// limita (RPC `bump_user_xp`); nivo se izvodi iz XP-a, nikad ručno.
router.post('/users/:id/adjust-xp', async (req: AuthRequest, res, next) => {
  try {
    const target = await db.users.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'Količina XP-a mora da bude ne-nula broj.' });
    }
    const reason = typeof req.body?.reason === 'string' ? String(req.body.reason).slice(0, 200) : '';
    if (!reason.trim()) {
      return res.status(400).json({ error: 'Razlog XP korekcije je obavezan (revizorski trag).' });
    }

    // Admin korekcija NE ide kroz `awardXp()`: taj put prolazi kroz dnevni budžet
    // (`spend_daily_xp`), pa je bonus tiho isecao na 0 kada je korisnik već
    // potrošio dnevnu kvotu — admin je dobijao „uspešno“, a XP se nije menjao.
    // `bumpXp` pomera samo `xp`, a nivo se iz njega izvodi.
    const delta = Math.round(amount);
    const updated = await db.users.bumpXp(target.id, delta);
    if (!updated) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // Stvarno primenjeno (XP nikad ispod 0), ne traženo.
    const applied = updated.xp - target.xp;
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: target.id,
      targetUsername: target.username,
      action: 'xp_adjusted',
      from: { xp: target.xp, level: target.level },
      to: { xp: updated.xp, level: updated.level, reason },
    });

    const levelUp = updated.level > target.level;
    void notify({
      userId: target.id,
      // Isti tip kao kod `awardXp` — profil koji level-up inače prikazuje kao `level_up`.
      type: levelUp ? 'level_up' : 'system',
      title: levelUp ? `Novi nivo: ${updated.level} 🎉` : delta > 0 ? 'Dobio/la si XP od administracije' : 'XP korekcija',
      message: `${delta > 0 ? '+' : ''}${applied} XP — razlog: ${reason}. Sada imaš ${updated.xp.toLocaleString('sr-Latn-RS')} XP (nivo ${updated.level}).`,
      // `/profile/{username}` — ranije `/{username}` (404, „stranica je otišla u drugi lobby“)
      link: `/profile/${encodeURIComponent(target.username)}`,
      actorId: req.user!.id,
    }).catch(() => null);

    res.json({
      message:
        delta > 0
          ? `Korisniku je dodeljeno ${applied} XP (ukupno ${updated.xp}).`
          : `Korisniku je oduzeto ${Math.abs(applied)} XP (ukupno ${updated.xp}).`,
      applied,
      user: updated,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/admin/users/bulk (Bulk akcije nad korisnicima)
// =====================
// Telo: { ids: string[], action: 'ban' | 'unban' | 'mute', days?, reason?, muteHours? }
// Zaštite: nikad nad samim sobom i nikad nad admin nalogima (isti princip kao
// pojedinačne rute); svaka akcija ide kroz isti repo kod kao pojedinačna.
const BULK_ACTIONS = new Set(['ban', 'unban', 'mute']);
router.post('/users/bulk', async (req: AuthRequest, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const action = String(req.body?.action ?? '');
    if (!ids.length) return res.status(400).json({ error: 'Nije izabran nijedan korisnik.' });
    if (ids.length > 100) return res.status(400).json({ error: 'Maksimalno 100 korisnika po bulk akciji.' });
    if (!BULK_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'Nepoznata bulk akcija. Dozvoljeno: ban, unban, mute.' });
    }
    const reason = typeof req.body?.reason === 'string' ? String(req.body.reason).slice(0, 200) : 'Bulk moderacija';
    const days = Number(req.body?.days) > 0 ? Number(req.body.days) : null;
    const muteHours = Number(req.body?.muteHours) > 0 ? Number(req.body.muteHours) : null;

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        const target = await db.users.findById(id);
        if (!target) {
          results.push({ id, ok: false, error: 'nema naloga' });
          continue;
        }
        if (target.id === req.user!.id) {
          results.push({ id, ok: false, error: 'sopstveni nalog' });
          continue;
        }
        if (target.role === 'admin') {
          results.push({ id, ok: false, error: 'admin nalog' });
          continue;
        }
        // 3.0.0 — svaka bulk akcija ostavlja notifikaciju u inbox-u cilja.
        if (action === 'ban') {
          invalidateSessionCache(id);
          await db.bans.ban({
            userId: id,
            reason,
            expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
            bannedBy: req.user!.id,
            createdAt: new Date().toISOString(),
          });
          await db.users.update(id, { isBanned: true });
          void notify({
            userId: id,
            type: 'warning',
            title: 'Nalog je suspendovan',
            message: `Suspendovao te je ${req.user!.username} — razlog: ${reason}.`,
            link: '/notifications',
            actorId: req.user!.id,
          }).catch(() => null);
        } else if (action === 'unban') {
          invalidateSessionCache(id);
          await db.bans.lift(id);
          await db.users.update(id, { isBanned: false });
          void notify({
            userId: id,
            type: 'staff',
            title: 'Nalog je reaktiviran',
            message: `Nalog ti je reaktivirao ${req.user!.username}.`,
            link: '/notifications',
            actorId: req.user!.id,
          }).catch(() => null);
        } else {
          const mutedUntil = muteHours
            ? new Date(Date.now() + muteHours * 3_600_000).toISOString()
            : new Date(Date.now() + 24 * 3_600_000).toISOString();
          await db.users.update(id, { mutedUntil });
          void notify({
            userId: id,
            type: 'warning',
            title: 'Privremeno si ućutkan (mute)',
            message: `Ne možeš objavljivati do ${new Date(mutedUntil).toLocaleString('sr-Latn-RS')}.`,
            link: '/notifications',
            actorId: req.user!.id,
          }).catch(() => null);
        }
        results.push({ id, ok: true });
      } catch (error: any) {
        results.push({ id, ok: false, error: error?.message ?? 'greška' });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: 'bulk',
      targetUsername: `${succeeded}/${ids.length} korisnika`,
      action: 'ban',
      from: { action },
      to: { succeeded, failed: ids.length - succeeded, reason, days, muteHours },
    });
    res.json({ message: `Izvršeno nad ${succeeded} od ${ids.length} korisnika.`, results });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/admin/categories (Subforumi za admin editor)
// =====================
router.get('/categories', async (_req: AuthRequest, res, next) => {
  try {
    res.json({ categories: await db.forum.listCategories() });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/admin/categories (Kreiraj/izmeni subforum)
// =====================
router.post('/categories', async (req: AuthRequest, res, next) => {
  try {
    const slug = slugify(String(req.body?.slug ?? ''));
    const name = typeof req.body?.name === 'string' ? String(req.body.name).trim().slice(0, 60) : '';
    if (!slug || !name) {
      return res.status(400).json({ error: 'Slug i naziv kategorije su obavezni.' });
    }
    const icon = typeof req.body?.icon === 'string' ? String(req.body.icon).slice(0, 8) : '💬';
    const description = typeof req.body?.description === 'string' ? String(req.body.description).slice(0, 200) : '';
    const color = typeof req.body?.color === 'string' ? String(req.body.color).slice(0, 20) : undefined;

    const category = await db.forum.upsertCategory({ id: slug, slug, name, description, icon, color });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: category.slug,
      targetUsername: category.name,
      action: 'role_change',
      from: 'Kategorija sačuvana',
      to: { slug, name, icon, description, color },
    });
    res.json({ message: 'Kategorija je sačuvana.', category });
  } catch (err) {
    next(err);
  }
});

// =====================
// DELETE /api/admin/categories/:slug (Soft-delete subforuma)
// =====================
router.delete('/categories/:slug', async (req: AuthRequest, res, next) => {
  try {
    const deleted = await db.forum.deleteCategory(req.params.slug);
    if (!deleted) return res.status(404).json({ error: 'Kategorija nije pronađena.' });
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: req.params.slug,
      targetUsername: req.params.slug,
      action: 'comment_deleted',
      from: 'Kategorija',
      to: null,
    });
    res.json({ message: 'Kategorija je obrisana (sakrivena).' });
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
router.get('/stats', async (req: AuthRequest, res, next) => {
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
    // B-13 — bedž na dashboardu prikazuje SAMO „pending“ prijave; `total` iz
    // /api/admin/stats je sabirao i rešene, pa je broj bio pogrešan.
    const pendingCount = await db.reports.count('pending').catch(() => 0);

    // ---- F-7b — vremenska analitika (keširano 5 min po range-u) ----
    const rangeKey = String(req.query.range ?? '7d');
    const days = RANGE_DAYS[rangeKey] ?? 7;
    const cacheKey = `analytics:${rangeKey}`;

    let analytics: StatsCacheable | null = null;
    const cached = statsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      analytics = cached.data;
    } else {
      analytics = await buildAnalytics(days).catch((error) => {
        logger.warn({ error: (error as Error).message }, 'admin_stats_analytics_failed');
        return null;
      });
      if (analytics) {
        statsCache.set(cacheKey, { data: analytics, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
      }
    }

    res.json({
      totalUsers,
      moderators,
      totalArticles,
      publishedArticles,
      totalThreads,
      totalSubscribers,
      totalViews: views + threadViews,
      pendingCount,
      // F-7b analitika (null u in-memory demo režimu — frontend prikazuje empty state)
      analytics,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * F-7b — agregacije za grafikone iz `daily_views` (migracija 25-2.9.0).
 * Serija se 0-popunjava za dane bez pregleda (Chart.js kontinuitet).
 */
async function buildAnalytics(days: number): Promise<StatsCacheable> {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  from.setUTCHours(0, 0, 0, 0);
  const fromIso = isoDay(from);
  const toIso = isoDay(to);

  // Uporedni period (za growth %): prethodnih `days` dana.
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));

  const [currentByDay, prevByDay, topEntities] = await Promise.all([
    db.dailyViews.sumByDay(fromIso, toIso),
    db.dailyViews.sumByDay(isoDay(prevFrom), isoDay(prevTo)),
    db.dailyViews.topEntities(fromIso, toIso, 20),
  ]);

  const allDays = daysBetween(from, to);
  const viewsOverTime = allDays.map((date) => ({ date, views: currentByDay[date] ?? 0 }));
  const periodViews = viewsOverTime.reduce((sum, day) => sum + day.views, 0);
  const prevViews = Object.values(prevByDay).reduce((sum, n) => sum + n, 0);
  const viewsGrowth = prevViews > 0
    ? Math.round(((periodViews - prevViews) / prevViews) * 1000) / 10
    : periodViews > 0 ? 100 : 0;

  // Imena/slugovi za top entitete — jedan upit po tipu.
  const articleIds = topEntities.filter((e) => e.entityType === 'article').map((e) => e.entityId);
  const threadIds = topEntities.filter((e) => e.entityType === 'thread').map((e) => e.entityId);
  const [articleRows, threadRows] = await Promise.all([
    articleIds.length ? db.articles.findByIds(articleIds) : Promise.resolve([]),
    threadIds.length ? db.forum.findThreadsByIds(threadIds) : Promise.resolve([]),
  ]);
  const articleMap = new Map(articleRows.map((row: any) => [row.id, row]));
  const threadMap = new Map(threadRows.map((row: any) => [row.id, row]));

  const topArticles = (
    topEntities
      .map((entity): TopItem | null => {
        if (entity.entityType === 'article') {
          const row = articleMap.get(entity.entityId) as any;
          if (!row) return null;
          return { id: entity.entityId, title: row.title ?? '(bez naslova)', slug: row.slug, kind: 'article', views: entity.views, author: row.author ?? null };
        }
        const row = threadMap.get(entity.entityId) as any;
        if (!row) return null;
        return { id: entity.entityId, title: row.title ?? '(bez naslova)', slug: row.slug ?? entity.entityId, kind: 'thread', views: entity.views, author: row.author ?? null };
      })
      .filter((item): item is TopItem => item !== null)
      .slice(0, 10)
  );

  // Angažovanje: članci vs forum (za izabrani period).
  const articlePeriodViews = topEntities.filter((e) => e.entityType === 'article').reduce((sum, e) => sum + e.views, 0);
  const threadPeriodViews = topEntities.filter((e) => e.entityType === 'thread').reduce((sum, e) => sum + e.views, 0);
  const totalPeriod = articlePeriodViews + threadPeriodViews;
  const pct = (part: number) => (totalPeriod > 0 ? Math.round((part / totalPeriod) * 1000) / 10 : 0);
  const retentionOrEngagement = totalPeriod > 0 ? [
    { category: 'Članci', views: articlePeriodViews, percentage: pct(articlePeriodViews) },
    { category: 'Forum', views: threadPeriodViews, percentage: pct(threadPeriodViews) },
  ] : [];

  return { overview: { periodViews, viewsGrowth }, viewsOverTime, topArticles, retentionOrEngagement };
}

// =====================
// GET /api/admin/audit-log (revizorski trag admin akcija)
// =====================
router.get('/audit-log', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    // N-09 — limit je u upitu (baza vraća samo poslednjih N), ne `slice` nad celim logom.
    res.json({ entries: await getAuditLog(limit) });
  } catch (err) {
    next(err);
  }
});



export default router;
