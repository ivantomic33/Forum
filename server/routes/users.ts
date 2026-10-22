import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { db } from '../lib/store.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { updateProfileSchema, connectAccountSchema, rolePatchSchema, validate } from '../lib/schemas.js';
import { awardXp } from '../lib/gamification.js';
import { sanitizeText } from '../middleware/sanitize.js';
import {
  verifyAccount,
  XP_FOR_VERIFIED_ACCOUNT,
  unverifiedMessage,
} from '../lib/accountVerification.js';
import { ownerUser, publicUser } from '../lib/userShape.js';
import { onlineSet, isUserOnline, presenceMap, userStatus } from '../lib/presence.js';

const router = Router();

/** Revizorski trag (ko je koga menjao). U produkciji ide u `audit_log` tabelu. */
interface AuditEntry {
  id: string;
  actorId: string;
  actorUsername: string;
  targetId: string;
  targetUsername: string;
  action: 'role_change' | 'ban' | 'unban' | 'badge_awarded' | 'comment_deleted';
  from: unknown;
  to: unknown;
  at: string;
}
const auditLog: AuditEntry[] = [];
const auditDb = db.kind === 'supabase'
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })
  : null;

export async function recordAudit(entry: Omit<AuditEntry, 'id' | 'at'>) {
  const at = new Date().toISOString();
  auditLog.push({ ...entry, id: `aud_${Date.now().toString(36)}`, at });
  if (auditLog.length > 1000) auditLog.shift();

  if (auditDb) {
    const { error } = await auditDb.from('audit_log').insert({
      actor_id: entry.actorId,
      target_id: entry.targetId,
      action: entry.action,
      details: {
        actorUsername: entry.actorUsername,
        targetUsername: entry.targetUsername,
        from: entry.from,
        to: entry.to,
      },
      created_at: at,
    });
    if (error) {
      // Do not fail the admin action if `server/schema-ALL.sql` has not been applied.
      reqLoggerWarn(error.message);
    }
  }
}

function reqLoggerWarn(message: string) {
  console.warn(`[audit] persistent audit unavailable: ${message}`);
}

export async function getAuditLog() {
  if (auditDb) {
    const { data, error } = await auditDb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (!error && data) {
      return data.map((row: any) => ({
        id: row.id,
        actorId: row.actor_id,
        targetId: row.target_id,
        action: row.action,
        at: row.created_at,
        ...row.details,
      }));
    }
  }
  return [...auditLog].reverse();
}

// =====================
// GET /api/users/leaderboard/top (mora biti pre /:username rute)
// ====================
router.get('/leaderboard/top', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    // Rang-lista je javna: email, ban status i druga interna polja ne izlaze.
    const sort = req.query.sort === 'level' ? 'level' : 'karma';
    // F-18 — sortiranje i limit u SQL-u (ranije: svi korisnici u memoriju, pa sort/slice).
    const [top, total] = await Promise.all([
      db.users.leaderboard({ sort, limit }),
      db.users.count({ excludeBanned: true }),
    ]);
    // 2.6.1 — „Online sada“: jedan upit za celu rang-listu.
    // 2.6.2 — `status` je `online | away | offline`; `onlineSet` je ostao isti API.
    const presence = await presenceMap(top.map((u) => u.id)).catch(() => new Map());
    const sorted = top.map((u) => {
      const status = presence.get(u.id) ?? 'offline';
      return { ...publicUser(u), status, isOnline: status === 'online' };
    });

    res.json({ users: sorted, total, sort });
  } catch (err) {
    // F-24 — detalji greške samo u log, klijent dobija generičku poruku iz centralnog handlera.
    next(err);
  }
});

// =====================
// USER BLOCKS — zaštita od uznemiravanja (tabela `user_blocks`)
// Rute moraju biti PRE /:username, inače bi ih dinamička ruta uhvatila.
// ====================
router.get('/blocks/mine', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const blockedIds = await db.blocks.list(req.user!.id);
    const users = await db.users.findAll();
    res.json({
      blocked: users
        .filter((u) => blockedIds.includes(u.id))
        .map((u) => ({ id: u.id, username: u.username, avatar: u.avatar })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/block', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const targetId = String(req.body?.userId ?? '');
    if (!targetId || targetId === req.user!.id) {
      return res.status(400).json({ error: 'Nevažeći korisnik.' });
    }

    const target = await db.users.findById(targetId);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    await db.blocks.block(req.user!.id, targetId);

    req.log?.info({ blocker: req.user!.id, blocked: targetId }, 'user_blocked');
    res.json({ message: `${target.username} je blokiran.`, userId: targetId });
  } catch (err) {
    next(err);
  }
});

router.delete('/block/:userId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    await db.blocks.unblock(req.user!.id, req.params.userId);
    res.json({ message: 'Korisnik je odblokiran.', userId: req.params.userId });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/users/:username (profil)
// ====================
router.get('/:username', async (req, res) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    // Javni profil: bez email-a i bez internih polja (ban status, lastSeen...).
    // 2.6.2 — `status` je `online | away | offline` iz `user_presence` (TTL 90s).
    const status = await userStatus(user.id).catch(() => 'offline' as const);
    res.json({ ...publicUser(user), status, isOnline: status === 'online' });
  } catch (err) {
    req.log?.error({ err }, 'users_route_failed');
    res.status(500).json({ error: 'Greška pri dohvatanju profila.' });
  }
});

// =====================
// QUESTS — GET /api/users/:username/quests (samo vlasnik)
// Profil prikazuje progres iz `quests` + `user_quests`.
// ====================
router.get('/:username/quests', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.id !== req.user!.id && req.user!.role === 'member') {
      return res.status(403).json({ error: 'Kvestovi su vidljivi samo vlasniku profila.' });
    }

    const quests = await db.quests.listForUser(user.id);
    res.json({
      quests,
      completed: quests.filter((q) => q.completed).length,
      total: quests.length,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/users/:username/saved (samo vlasnik) — sačuvani članci + teme
// ====================
router.get('/:username/saved', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.id !== req.user!.id) {
      return res.status(403).json({ error: 'Sačuvani sadržaj je vidljiv samo vlasniku profila.' });
    }

    const bookmarks = await db.bookmarks.list(user.id);
    const articleIds = new Set(bookmarks.filter((b) => b.kind === 'article').map((b) => b.targetId));
    const threadIds = new Set(bookmarks.filter((b) => b.kind === 'thread').map((b) => b.targetId));

    const [articles, threads] = await Promise.all([
      db.articles
        .findAll({})
        // F-10 — sačuvani draft članci se ne vraćaju (osim staff korisnicima).
        .then((all) =>
          all.filter(
            (a) =>
              articleIds.has(a.id) &&
              (req.user!.role === 'admin' || req.user!.role === 'moderator' || !a.status || a.status === 'published'),
          ),
        ),
      Promise.all([...threadIds].map((id) => db.forum.findThread(id))),
    ]);

    res.json({
      savedArticles: articles,
      // Obrisane teme nestaju i iz sačuvanih.
      savedThreads: threads.filter((thread) => thread && !thread.isDeleted),
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/users/:username/threads (teme koje je korisnik objavio)
// ====================
router.get('/:username/threads', async (req, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const threads = (await db.forum.listThreadsByAuthor(user.id, user.username, limit)).filter(
      (thread) => !thread.isDeleted,
    );
    res.json({ threads, total: threads.length });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/users/:username/replies (odgovori koje je korisnik napisao)
// ====================
router.get('/:username/replies', async (req, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    // #18 — direktan upit po author_id (index idx_forum_replies_author_created),
    // bez listanja svih tema i N+1 upita.
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const replies = (await db.forum.listRepliesByAuthor(user.id, user.username, limit)).filter(
      (reply) => !reply.isDeleted,
    );
    res.json({ replies, total: replies.length });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/users/:username/activity (nedavna aktivnost korisnika)
// ====================
router.get('/:username/activity', async (req, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    const userThreads = await db.forum.listThreadsByAuthor(user.id, user.username, 50);

    // F-31 — stvarni datumi: `user_badges.awarded_at`, `connected_accounts.created_at`.
    // Bez datuma događaj se NE prikazuje sa izmišljenim `'2026-01-01'`; datum ostaje null
    // i UI ga prikazuje kao nepoznato.
    const [badgeAwards, accountDates] = await Promise.all([
      db.users.listBadgeAwards(user.id).catch(() => []),
      db.users.listConnectedAccountDates(user.id).catch(() => []),
    ]);
    const badgeDate = new Map(badgeAwards.map((entry) => [entry.code, entry.awardedAt]));
    const accountDate = new Map(accountDates.map((entry) => [entry.platform, entry.connectedAt]));

    const activities: Array<{ id: string; type: 'thread' | 'badge' | 'account'; text: string; date: string | null }> = [];

    // Teme
    userThreads.forEach((t) => {
      activities.push({
        id: `t-${t.id}`,
        type: 'thread',
        text: `Objavio/la temu: "${t.title}" u ${t.subforum}`,
        date: t.createdAt,
      });
    });

    // Povezani nalozi — datum povezivanja iz normalizovane tabele (null = nepoznat)
    if (user.connectedAccounts) {
      Object.entries(user.connectedAccounts).forEach(([platform, handle]) => {
        activities.push({
          id: `acc-${platform}`,
          type: 'account',
          text: `Povezao/la ${platform} nalog: ${handle}`,
          date: accountDate.get(platform) ?? null,
        });
      });
    }

    // Bedževi — datum dodele iz `user_badges` (null = nepoznat)
    if (user.badges && Array.isArray(user.badges)) {
      user.badges.forEach((b) => {
        activities.push({
          id: `badge-${b}`,
          type: 'badge',
          text: `Osvojen bedž: ${b.toUpperCase()}`,
          date: badgeDate.get(b) ?? null,
        });
      });
    }

    // Događaji bez datuma idu na kraj (ranije su dobijali izmišljeni 01.01.2026.).
    activities.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    res.json({ activities });
  } catch (err) {
    next(err);
  }
});

// =====================
// PUT /api/users/profile (ažuriraj sopstveni profil)
// ====================
router.put('/profile', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(updateProfileSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const user = await db.users.findById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    const patch: any = {};
    if (parsed.data.avatar !== undefined) patch.avatar = parsed.data.avatar;
    if (parsed.data.bio !== undefined) patch.bio = sanitizeText(parsed.data.bio);
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;

    const updated = await db.users.update(user.id, patch);
    res.json(ownerUser(updated!));
  } catch (err) {
    next(err);
  }
});

// =====================
// F-09 — GDPR/ZZPL: izvoz i brisanje sopstvenog naloga
// (mora biti PRE dinamičke /:username rute)
// ====================

/** Sve lične podatke korisnika spakuje u jedan JSON (pravo na pristup/prenosivost). */
router.get('/me/export', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const [threads, replies, bookmarks, notifications, newsletter, reports] = await Promise.all([
      db.forum.listThreadsByAuthor(user.id, user.username, 500),
      db.forum.listRepliesByAuthor(user.id, user.username, 500),
      db.bookmarks.list(user.id),
      db.notifications.list({ userId: user.id, limit: 500 }),
      db.newsletter.findAll(),
      db.reports.list({ limit: 500 }),
    ]);

    const own = ownerUser(user) as Record<string, unknown>;
    delete own.password;

    res.json({
      exportedAt: new Date().toISOString(),
      account: own,
      threads,
      replies,
      bookmarks,
      notifications,
      newsletter: newsletter.filter((n) => n.email.toLowerCase() === user.email.toLowerCase()),
      reportsFiledByUser: reports.filter((r) => r.reporterId === user.id),
      notice:
        'Izvoz sadrži podatke koje aplikacija čuva o vašem nalogu. Lozinka (hash) i interni sigurnosni tokeni nisu uključeni.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Brisanje naloga: lični podaci se brišu, javni sadržaj (teme/odgovori) se
 * anonimizuje — ostaje bez autora i sa EIČ podacima uklonjenim, zatim se izvodi
 * soft-delete zapisa korisnika pod anonimnim imenom („obrisani-nalog“).
 */
router.delete('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admin nalog ne može da se obriše preko API-ja. Obratite se podršci.' });
    }

    // 1) Pretplate: odjava newslettera (bez lične adrese u daljoj obradi)
    await db.newsletter.unsubscribe(user.email).catch((err) => {
      // isti log kao audit; brisanje se ne prekida zbog newsletter tabele
      reqLoggerWarn(`newsletter unsubscribe failed during account delete: ${err?.message ?? err}`);
    });

    // 2) Javni sadržaj: anonimizacija (autor → anonimno ime, bez authorId veze)
    const anonymous = 'obrisani-nalog';
    const threads = await db.forum.listThreadsByAuthor(user.id, user.username, 1000);
    await Promise.all(
      threads.map((thread) =>
        db.forum
          .updateThread(thread.id, { author: anonymous, isDeleted: true })
          .catch(() => null),
      ),
    );

    // 3) Lični podaci: email/lozinka/avatar/bio/nalozi/bedževi
    await db.users.update(user.id, {
      email: `${user.id}@deleted.invalid`,
      password: '!', // hash koji ne može da se pogodi (bcrypt compare uvek pada)
      avatar: '',
      bio: '',
      badges: [],
      connectedAccounts: {},
      status: 'offline',
      isBanned: false,
    });

    // 4) Poništi sve sesije
    await db.users.bumpSessionVersion(user.id).catch(() => 0);

    res.json({ message: 'Nalog je obrisan. Lični podaci su uklonjeni, a objavljivan sadržaj je anonimizovan.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/users/accounts/connect (poveži gaming nalog)
// ====================
router.post('/accounts/connect', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(connectAccountSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const { platform, platformUsername } = parsed.data;

    const user = await db.users.findById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    const value = sanitizeText(platformUsername);
    const previous = user.connectedAccounts?.[platform];

    // B-03 — XP za povezivanje samo posle stvarne verifikacije naloga.
    // Steam: ResolveVanityURL / SteamID64; Discord: OAuth link; ostalo: bez provere.
    const verification = await verifyAccount(platform, value);
    const verified = verification.status === 'verified';
    const canonicalValue = verified ? verification.value : value;

    // XP se dodeljuje samo PRVI put za dati nalog, ili kada se promeni ID.
    // Odvajanje NE poništava istoriju (`connected_accounts.revoked_at`), pa
    // ponovno povezivanje istog naloga posle odvajanja više ne daje +25 XP.
    const isNewConnection =
      verified &&
      previous !== canonicalValue &&
      !(await db.users.hasConnectedAccountHistory(user.id, platform, canonicalValue));

    // Normalizovana tabela `connected_accounts` je izvor istine; kolona je keš.
    await db.users.setConnectedAccount(user.id, platform, canonicalValue);
    const connectedAccounts = { ...user.connectedAccounts, [platform]: canonicalValue };
    const verifiedPlatforms = verified
      ? Array.from(new Set([...(user.verifiedPlatforms ?? []), platform]))
      : (user.verifiedPlatforms ?? []).filter((p) => p !== platform);
    await db.users.update(user.id, { connectedAccounts, verifiedPlatforms });

    const awarded = isNewConnection
      ? await awardXp(user.id, XP_FOR_VERIFIED_ACCOUNT, {
          reason: 'account_connected',
          connectedCount: Object.keys(connectedAccounts).length,
        })
      : null;

    const refreshed = (await db.users.findById(user.id))!;
    res.json({
      connectedAccounts: refreshed.connectedAccounts,
      verifiedPlatforms: refreshed.verifiedPlatforms ?? verifiedPlatforms,
      user: ownerUser(refreshed),
      verified,
      message: !verified
        ? unverifiedMessage(platform)
        : isNewConnection
          ? `Uspešno povezan ${platform} nalog!`
          : `${platform} nalog je ažuriran.`,
      awarded: awarded ? { xp: awarded.xpAwarded, newBadges: awarded.newBadges } : null,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// DELETE /api/users/accounts/:platform (otkači nalog)
// ====================
router.delete('/accounts/:platform', authenticate, async (req: AuthRequest, res) => {
  try {
    const { platform } = req.params;
    const user = await db.users.findById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    }

    const connectedAccounts = { ...user.connectedAccounts };
    delete connectedAccounts[platform];

    // `users.connected_accounts` (keš) se briše, a red u `connected_accounts`
    // ostaje sa `revoked_at` — istorija sprečava farmovanje XP-a ponovnim
    // povezivanjem istog naloga.
    await db.users.revokeConnectedAccount(user.id, platform);
    const updated = await db.users.update(user.id, { connectedAccounts });
    res.json({ connectedAccounts: updated?.connectedAccounts ?? connectedAccounts, user: updated ? ownerUser(updated) : null });
  } catch (err) {
    req.log?.error({ err }, 'users_route_failed');
    res.status(500).json({ error: 'Greška pri uklanjanju naloga.' });
  }
});

// =====================
// GET /api/users (samo admin - pregled svih korisnika)
// ====================
router.get('/', authenticate, authorize('admin'), async (_req: AuthRequest, res, next) => {
  try {
    const all = await db.users.findAll();
    // Admin pregled namerno uključuje email i ban status (potrebno za moderaciju).
    const safe = all.map(ownerUser);
    res.json({ users: safe, total: safe.length });
  } catch (err) {
    next(err);
  }
});

// =====================
// PATCH /api/users/:id/role (admin - promeni rolu ili banuj)
// ====================
router.patch('/:id/role', authenticate, authorize('admin'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(rolePatchSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const targetId = req.params.id;
    const target = await db.users.findById(targetId);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // #23 — admin ne može da menja sopstvenu rolu/ban (sprečava lockout)
    if (target.id === req.user!.id) {
      return res.status(403).json({ error: 'Ne možete menjati sopstvenu ulogu ili status.' });
    }

    // #23 — drugi admini se ne smeju degradirati/banovati bez posebnog procesa
    if (target.role === 'admin' && (parsed.data.role !== undefined && parsed.data.role !== 'admin' || parsed.data.isBanned === true)) {
      return res.status(403).json({ error: 'Ne možete degradirati ili banovati drugog administratora.' });
    }

    // Redosled: PRVO ban u `bans` tabeli, pa `users.is_banned`. Ako tabela ne
    // postoji, akcija pada (500) umesto da flag ostane bez izvora istine — ranije
    // je flag bio postavljen, a `authenticate` je grešku `findActive` tumačio kao
    // „ban je istekao“ i automatski odbanovao korisnika.
    // Ban sa razlogom i rokom trajanja (schema-2.4.3 — tabela `bans`)
    const banInfo = parsed.data.isBanned
      ? {
          reason: parsed.data.banReason!,
          expiresAt: parsed.data.banDays
            ? new Date(Date.now() + parsed.data.banDays * 86_400_000).toISOString()
            : null,
        }
      : null;

    if (banInfo) {
      await db.bans.ban({
        userId: targetId,
        reason: banInfo.reason,
        expiresAt: banInfo.expiresAt,
        bannedBy: req.user!.id,
        createdAt: new Date().toISOString(),
      });
    } else if (parsed.data.isBanned === false) {
      await db.bans.lift(targetId);
    }

    const patch: any = {};
    if (parsed.data.role !== undefined) patch.role = parsed.data.role;
    if (parsed.data.isBanned !== undefined) patch.isBanned = parsed.data.isBanned;
    if (parsed.data.muteHours !== undefined) {
      if (parsed.data.muteHours === 0 || parsed.data.muteHours === null) {
        patch.mutedUntil = null;
      } else {
        patch.mutedUntil = new Date(Date.now() + parsed.data.muteHours * 3600 * 1000).toISOString();
      }
    }

    const updated = await db.users.update(targetId, patch);
    if (!updated) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // Revizorski trag — ko je šta uradio
    await recordAudit({
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetId: updated.id,
      targetUsername: updated.username,
      action: parsed.data.isBanned !== undefined ? (parsed.data.isBanned ? 'ban' : 'unban') : 'role_change',
      from: { role: target.role, isBanned: target.isBanned },
      to: { ...patch, ...(banInfo ? { banReason: banInfo.reason, banExpiresAt: banInfo.expiresAt } : {}) },
    });
    req.log?.info({ actor: req.user!.username, target: updated.username, patch, banInfo }, 'admin_user_patch');

    res.json(ownerUser(updated));
  } catch (err) {
    next(err);
  }
});

export default router;

