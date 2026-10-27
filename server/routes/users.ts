import { Router } from 'express';
import { z } from 'zod';
import { db, uid, type ThreadRecord } from '../lib/store.js';
import { sharedClient, warnSharedOnce } from '../lib/sharedStore.js';
import { logger } from '../lib/logger.js';
import { authenticate, authorize, invalidateSessionCache, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { updateProfileSchema, connectAccountSchema, rolePatchSchema, validate, guestbookUpsertSchema } from '../lib/schemas.js';
import { guestbookEntrySchema, guestbookResponseSchema } from '../../contracts/index.js';
import { awardXp } from '../lib/gamification.js';
import { sanitizeText } from '../middleware/sanitize.js';
import {
  verifyAccount,
  XP_FOR_VERIFIED_ACCOUNT,
  unverifiedMessage,
} from '../lib/accountVerification.js';
import { ownerUser, publicUser } from '../lib/userShape.js';
import { onlineSet, isUserOnline, presenceMap, userStatus } from '../lib/presence.js';
// N10 — ugovor front↔back (isti modul uvozi `src/lib/api.ts`).
import {
  publicUserSchema,
  ownerUserSchema,
  questListResponseSchema,
  threadListResponseSchema,
  replyListResponseSchema,
  userActivityResponseSchema,
  userSavedResponseSchema,
  userLeaderboardResponseSchema,
  ownerUserListResponseSchema,
  dailyLoopResponseSchema,
} from '../../contracts/index.js';
import { respond } from '../lib/respond.js';
import { getDailyLoop } from '../lib/dailyLoop.js';
import { notify, notifyStaff } from '../lib/notifications.js';
import { renderProfileCard } from '../lib/profileCard.js';
import type { AuditEntry } from '../../contracts/index.js';

/** Akcija audit loga — jedinstveni union iz ugovora. */
type AuditAction = AuditEntry['action'];

const router = Router();

/** Revizorski trag (ko je koga menjao) — autoritet je `audit_log` u bazi.
 *
 * N-09: ranije je svaka instanca čuvala svoj niz od 1000 zapisa, pa je
 * `/api/admin/audit` vraćao samo ono što je TA instanca upisala. Sada se piše u
 * bazu, a niz je samo keš za slučaj da migracija nije puštena (i izvor za
 * `details` koje `audit_log` nema kao kolone — vidi `writeAudit`).
 */
interface AuditRow {
  id: string;
  actorId: string;
  actorUsername: string;
  targetId: string;
  targetUsername: string;
  // F-10 — `thread_delete`/`thread_restore`/`warning_*` dolaze iz ugovora.
  action: AuditAction;
  from: unknown;
  to: unknown;
  at: string;
}
const auditLog: AuditRow[] = [];

/** Red iz `audit_log` → oblik koji admin UI već poznaje. */
function fromRow(row: any): AuditRow {
  const details = row.details ?? {};
  return {
    id: String(row.id),
    actorId: row.actor_id,
    targetId: row.target_id,
    action: row.action,
    at: row.created_at,
    actorUsername: details.actorUsername ?? '',
    targetUsername: details.targetUsername ?? '',
    from: details.from ?? null,
    to: details.to ?? null,
  };
}

export async function recordAudit(entry: Omit<AuditRow, 'id' | 'at'>) {
  const at = new Date().toISOString();
  const local: AuditRow = { ...entry, id: `aud_${Date.now().toString(36)}`, at };
  auditLog.push(local);
  if (auditLog.length > 1000) auditLog.shift();

  const auditDb = sharedClient();
  if (!auditDb) return;

  const { error } = await auditDb.from('audit_log').insert({
    actor_id: entry.actorId || null,
    target_id: entry.targetId || null,
    action: entry.action,
    details: {
      actorUsername: entry.actorUsername,
      targetUsername: entry.targetUsername,
      from: entry.from,
      to: entry.to,
    },
    created_at: at,
  });
  // Do not fail the admin action if `server/schema-ALL.sql` has not been applied.
  if (error) warnSharedOnce('audit_write', error);
}

export async function getAuditLog(limit = 200): Promise<AuditRow[]> {
  const auditDb = sharedClient();
  if (auditDb) {
    const { data, error } = await auditDb
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 200));
    if (!error && data) return data.map(fromRow);
    if (error) warnSharedOnce('audit_read', error);
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

    respond(res, userLeaderboardResponseSchema, { users: sorted, total, sort });
  } catch (err) {
    // F-24 — detalji greške samo u log, klijent dobija generičku poruku iz centralnog handlera.
    next(err);
  }
});

// =====================
// 2.12.0 — PRAĆENJE KORISNIKA (FOLLOW) — tabela `user_follows`
// Rute moraju biti PRE /:username, inače bi ih dinamička ruta uhvatila.
// ====================

const followCountsSchema = z.object({ followers: z.number(), following: z.number() });

async function followTargetByUsername(username: string) {
  const target = await db.users.findByUsername(username);
  return target ?? null;
}

// GET /api/users/:username/follow — status praćenja + brojači (javno, bez prijave:
// brojači su javni podatak profila; `following` je true samo za prijavljenog).
router.get('/:username/follow', async (req, res, next) => {
  try {
    const target = await followTargetByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const counts = await db.follows.counts(target.id);
    let following = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      // Lagano „ko je pozvao“ bez punog middleware-a: ruta je javna, a
      // neispravan/istekao token samo znači „gost“ (bez statusa praćenja).
      try {
        const jwt = (await import('jsonwebtoken')).default;
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as { id?: string };
        if (decoded.id) following = await db.follows.isFollowing(decoded.id, target.id);
      } catch {
        // nepoznat/istekao token → gost
      }
    }
    res.json({ following, followers: counts.followers, followingCount: counts.following });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/:username/follow — zaprati korisnika (idempotentno)
router.post('/:username/follow', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const target = await followTargetByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (target.id === req.user!.id) {
      return res.status(400).json({ error: 'Ne možeš zapratiti samog sebe.' });
    }

    // Blokada u oba smera — isto pravilo kao DM.
    const [myBlocks, theirBlocks] = await Promise.all([
      db.blocks.blockedIds(req.user!.id),
      db.blocks.blockedIds(target.id),
    ]);
    if (myBlocks.has(target.id)) {
      return res.status(403).json({ error: 'Blokirali ste ovog korisnika.' });
    }
    if (theirBlocks.has(req.user!.id)) {
      return res.status(403).json({ error: 'Ovaj korisnik te ne prima.' });
    }

    const created = await db.follows.follow(req.user!.id, target.id);
    if (created) {
      // Notifikacija samo pri prvom zapratiivanju (re-follow ne spamuje).
      void notify({
        userId: target.id,
        type: 'user_follow',
        title: `${req.user!.username} te je zapratio`,
        message: `${req.user!.username} je sada pratio tvoj profil.`,
        link: `/profile/${req.user!.username}`,
        actorId: req.user!.id,
        metadata: { followerId: req.user!.id },
      }).catch(() => null);
      req.log?.info({ follower: req.user!.id, following: target.id }, 'user_followed');
    }

    const counts = await db.follows.counts(target.id);
    res.json({ following: true, followers: counts.followers, followingCount: counts.following });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:username/follow — otprati korisnika (idempotentno)
router.delete('/:username/follow', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const target = await followTargetByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    await db.follows.unfollow(req.user!.id, target.id);
    const counts = await db.follows.counts(target.id);
    res.json({ following: false, followers: counts.followers, followingCount: counts.following });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me/following/threads — feed tema isključivo praćenih autora.
// Registracija PRE `/:username` route (isti razlog kao gore).
router.get('/me/following/threads', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const ids = await db.follows.followingIds(req.user!.id);
    if (ids.length === 0) {
      return res.json({ threads: [], total: 0, authors: 0 });
    }
    // Liste po autoru (bez `IN (…)` u PostgREST-u — autor-po-autor dohvat je
    // ograničen na max 50 pratilaca i 100 tema po autoru).
    const perAuthor = await Promise.all(
      ids.slice(0, 50).map(async (authorId) => {
        const author = await db.users.findById(authorId).catch(() => null);
        if (!author) return [];
        return db.forum.listThreadsByAuthor(authorId, author.username, 100);
      }),
    );
    const threads = perAuthor
      .flat()
      .filter((t) => !t.isDeleted)
      .sort((a, b) => (b.lastReplyAt ?? b.createdAt).localeCompare(a.lastReplyAt ?? a.createdAt))
      .slice(0, 100);

    // 6.x — „Pratim“ tab na forumu koristi ISTI red teme kao glavna lista, pa
    // vraćamo iste dodatke (autor info, prisustvo, `solved`) — bez toga bi red
    // izgledao drugačije (bez avatara, bez značke „Rešeno“).
    const authorIds = [...new Set(threads.map((thread) => thread.authorId).filter(Boolean))];
    const authorList = await db.users.findByIds(authorIds).catch(() => []);
    const authors = new Map(authorList.map((user) => [user.id, user]));
    const presence = await presenceMap(authorIds).catch(() => new Map<string, 'online' | 'away' | 'offline'>());
    const enriched = threads.map((thread) => {
      const author = authors.get(thread.authorId);
      const status = presence.get(thread.authorId) ?? 'offline';
      return {
        ...thread,
        solved: Boolean(thread.acceptedReplyId),
        authorRole: author?.role ?? null,
        authorLevel: author?.level ?? null,
        authorVerified: author?.isVerified === true,
        authorOnline: status === 'online',
        authorStatus: status,
        authorAvatar: author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`,
      };
    });
    res.json({ threads: enriched, total: enriched.length, authors: ids.length });
  } catch (err) {
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
// F-12 — GET /api/users/:username/card.png („gaming kartica“ 1200×630)
//
// Deljiva slika za mreže: nivo, bedževi i top igre. Kešira se godinu dana
// (immutable) — kartica se menja samo kad se profil promeni, a tada se menja
// i URL (`?v=<level>-<xp>`).
// ====================
router.get('/:username/card.png', async (req, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // Top igre: prve stavke javnih kolekcija korisnika (najbliže „omiljenim
    // igrama“ bez nove tabele). Greška u kolekcijama ne obara karticu.
    const games: string[] = [];
    try {
      const { profileGames } = await import('./collections.js');
      games.push(...(await profileGames(user.id, 4)));
    } catch {
      // bez kolekcija: red „top igre“ ostaje prazan
    }

    // Broj objava = teme + odgovori. `users` nema keš kolonu za to (ranije je
    // kartica uvek pisala 0), pa se broji preko istog repoa kao lista tema.
    const [threads, replyRows] = await Promise.all([
      db.forum.countThreads({ authorId: user.id }).catch(() => 0),
      db.forum.listRepliesByAuthor(user.id, user.username, 5000).catch(() => [] as unknown[]),
    ]);

    const png = await renderProfileCard({
      username: user.username,
      level: user.level,
      xp: user.xp,
      xpNeeded: user.xpNeeded,
      karma: user.karma,
      posts: threads + replyRows.length,
      badges: (user.badges ?? []).slice(0, 5),
      topGames: games,
    });
    // F-12 — kartica zavisi od nivoa/XP/karme; keš je kratak (1 h), pa se
    // posle promene profila ne vraća zaglavljena slika sa starim brojevima.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('image/png').send(png);
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
    // #2 — brojači za mini-progress zaključanih bedževa (teme/odgovori).
    const [threadCount, replyCount] = await Promise.all([
      db.forum.listThreadsByAuthor(user.id, user.username, 1000).then((t) => t.length),
      db.forum.listRepliesByAuthor(user.id, user.username, 1000).then((r) => r.length),
    ]);
    respond(res, publicUserSchema, {
      ...publicUser(user),
      status,
      isOnline: status === 'online',
      stats: { threads: threadCount, replies: replyCount },
    });
  } catch (err) {
    req.log?.error({ err }, 'users_route_failed');
    res.status(500).json({ error: 'Greška pri dohvatanju profila.' });
  }
});

// =====================
// #5 — GG GUESTBOOK (komentari na profilu)
// GET  /api/users/:username/guestbook — javno
// PUT  /api/users/:username/guestbook — prijavljeni, jedna poruka po autoru (upsert)
// DELETE /api/users/:username/guestbook — autor briše svoju poruku
// ====================
router.get('/:username/guestbook', async (req, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    // 3.0.0 — migracija nije puštena → `profile_guestbook` ne postoji. Profil
    // je tada prikazivao 500 i praznu stranicu; prazna lista je tačan odgovor.
    const entries = await db.guestbook.list(user.id).catch((error) => {
      req.log?.warn({ err: error }, 'guestbook_list_failed');
      return [];
    });
    respond(res, guestbookResponseSchema, { entries });
  } catch (err) {
    next(err);
  }
});

router.put('/:username/guestbook', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(guestbookUpsertSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }
    const profile = await db.users.findByUsername(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (profile.id === req.user!.id) {
      return res.status(400).json({ error: 'Ne možeš ostaviti GG na svom profilu.' });
    }

    const author = await db.users.findById(req.user!.id)!;
    // GG poruka je jedan po paru (profil, autor) — upsert. Zato se PRE upisa
    // pamti raniji tekst: ako se menja, vlasnik profila dobija notifikaciju
    // „izmenio GG“; ako je nova poruka, „ostavio GG“.
    const previous = (await db.guestbook.list(profile.id)).find((e) => e.authorUserId === req.user!.id);
    const entry = await db.guestbook.upsert({
      id: `gb_${Date.now()}`,
      profileUserId: profile.id,
      authorUserId: req.user!.id,
      author: req.user!.username,
      authorAvatar: author?.avatar,
      message: sanitizeText(parsed.data.message),
      createdAt: new Date().toISOString(),
    });

    // Notifikacija vlasniku profila (jedna po autoru — upsert, ne spam).
    void notify({
      userId: profile.id,
      type: 'guestbook',
      title: previous
        ? `${req.user!.username} je izmenio GG na tvom profilu`
        : `${req.user!.username} ti je ostavio GG!`,
      message: entry.message,
      link: `/profile/${profile.username}#guestbook`,
      actorId: req.user!.id,
    }).catch(() => null);

    respond(res, guestbookEntrySchema, entry, 201);
  } catch (err) {
    next(err);
  }
});

router.delete('/:username/guestbook', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const profile = await db.users.findByUsername(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    const removed = await db.guestbook.remove(profile.id, req.user!.id);
    if (!removed) return res.status(404).json({ error: 'Poruka nije pronađena.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =====================
// QUESTS — GET /api/users/:username/quests (samo vlasnik)
// Profil prikazuje progres iz `quests` + `user_quests`.
// ====================
// ====================
// F-2 — GET /api/users/me/daily (streak + dnevni kvest)
//
// Mora PRE `/:username/*` ruta, inače bi „me“ bio protumačen kao korisničko ime.
// ====================
router.get('/me/daily', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const data = await getDailyLoop(req.user!.id);
    respond(res, dailyLoopResponseSchema, data);
  } catch (err) {
    next(err);
  }
});

router.get('/:username/quests', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.id !== req.user!.id && req.user!.role === 'member') {
      return res.status(403).json({ error: 'Kvestovi su vidljivi samo vlasniku profila.' });
    }

    const quests = await db.quests.listForUser(user.id);
    respond(res, questListResponseSchema, {
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

    respond(res, userSavedResponseSchema, {
      savedArticles: articles,
      // Obrisane teme nestaju i iz sačuvanih.
      savedThreads: threads.filter((thread): thread is ThreadRecord => thread !== null && !thread.isDeleted),
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
    respond(res, threadListResponseSchema, { threads, total: threads.length, nextCursor: null });
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
    respond(res, replyListResponseSchema, { replies, total: replies.length });
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

    const activities: Array<{
      id: string;
      type: 'thread' | 'reply' | 'solved' | 'badge' | 'account';
      text: string;
      date: string | null;
    }> = [];

    // Teme
    userThreads.forEach((t) => {
      activities.push({
        id: `t-${t.id}`,
        type: 'thread',
        text: `Objavio/la temu: "${t.title}" u ${t.subforum}`,
        date: t.createdAt,
      });
    });

    // 6.x — ODGOVORI i PRIHVAĆENI ODGOVORI: profil je ranije bio samo lista
    // tema, pa je najčešća aktivnost (pomoć u tuđim temama) bila nevidljiva.
    // Čitaju se kroz postojeći upit po autoru (nema N+1 po temi).
    const recentReplies = (await db.forum.listRepliesByAuthor(user.id, user.username, 40).catch(() => []))
      // Soft-obrisan odgovor se ne prikazuje u aktivnosti.
      .filter((reply) => !reply.isDeleted);
    for (const reply of recentReplies) {
      const thread = await db.forum.findThread(reply.threadId).catch(() => null);
      if (!thread || thread.isDeleted) continue;
      const solvedHere = thread.acceptedReplyId === reply.id;
      activities.push({
        id: `${solvedHere ? 'solved' : 'r'}-${reply.id}`,
        type: solvedHere ? 'solved' : 'reply',
        text: solvedHere
          ? `Odgovor prihvaćen kao rešenje u: "${thread.title}"`
          : `Odgovorio/la u: "${thread.title}"`,
        date: reply.createdAt,
      });
    }

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
    // 6.x — lista je sada duža (teme + odgovori + bedževi), pa se šalje samo vrh;
    // profil prikazuje „poslednjih 5“, a tab sve.
    activities.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    respond(res, userActivityResponseSchema, { activities: activities.slice(0, 80) });
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
    // #4 — cover preset; prazan string znači "vrati na podrazumevani violet".
    if (parsed.data.coverPreset !== undefined) patch.coverPreset = parsed.data.coverPreset || null;

    const updated = await db.users.update(user.id, patch);
    if (!updated) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    respond(res, ownerUserSchema, ownerUser(updated));
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
      // Log preko `logger`-a; brisanje se ne prekida zbog newsletter tabele.
      logger.warn({ err }, 'newsletter_unsubscribe_failed_on_account_delete');
    });

    // 2) Javni sadržaj: anonimizacija (autor → anonimno ime, bez authorId veze)
    //
    // GDPR (pravo na brisanje) traži da posle ovog poziva NIJEDAN red ne nosi
    // `userId` obrisanog naloga. Ranije su se anonimizirale samo TEME, a
    // odgovori, komentari na članke i GG poruke ostajali su vezani za korisnika
    // (iako je javno ime izgledalo anonimno). Sve četiri vrste se sada sređuju;
    // uspeh/skok jednog koraka se loguje, ali ne prekida brisanje naloga.
    const anonymous = 'obrisani-nalog';
    const results = await Promise.allSettled([
      db.forum.listThreadsByAuthor(user.id, user.username, 1000).then((threads) =>
        Promise.all(
          threads.map((thread) =>
            db.forum.updateThread(thread.id, { author: anonymous, isDeleted: true }).catch(() => null),
          ),
        ),
      ),
      db.forum.listAllRepliesByAuthor(user.id).then((replies) =>
        Promise.all(
          replies.map((reply) =>
            db.forum.updateReply(reply.id, { isDeleted: true } as any).catch(() => null),
          ),
        ),
      ),
      db.articles.anonymizeCommentsByUser(user.id),
      db.guestbook.removeAllByAuthor(user.id),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason, userId: user.id }, 'account_delete_anonymize_failed');
      }
    }

    // 2b) Notifikacije i liste čuvanja nose `userId` — brišu se, ne anonimiziraju.
    await Promise.allSettled([
      db.notifications.deleteAllForUser(user.id),
      db.bookmarks.removeAllForUser(user.id),
      db.sessions.revokeAllForUser(user.id, 'account_deleted'),
      // 2.11.0 — privatne poruke su lični podaci obe strane; razgovori se brišu.
      db.dm.deleteAllForUser(user.id),
      // 2.12.0 — vezovi praćenja u oba smera ( CASCADE bi ih obrisao u bazi,
      // ali memory sloj i GDPR log zahtevaju eksplicitno brisanje).
      db.follows.deleteAllForUser(user.id),
    ]);

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

    // 4) Poništi sve sesije (N-04 — keš `tv` se briše odmah, ne posle 30 s)
    invalidateSessionCache(user.id);
    await db.users.bumpSessionVersion(user.id).catch(() => 0);
    // 5) 2FA tajne i trusted uređaji ne smeju da ostanu (lični podaci)
    await Promise.allSettled([
      db.trustedDevices.deleteByUser(user.id),
      db.users.update(user.id, {
        totpSecret: null,
        totpEnabledAt: null,
        totpRecoveryCodes: [],
        totpLockedUntil: null,
        termsAcceptedIp: null,
      } as any),
    ]);

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
      awarded: awarded ? { xp: awarded.xpAwarded, levelUp: awarded.levelUp, newBadges: awarded.newBadges } : null,
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
    respond(res, ownerUserListResponseSchema, { users: safe, total: safe.length });
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
      // N-04 — ban važi odmah (keš bi ga odložio do 30 s).
      invalidateSessionCache(targetId);
      await db.bans.ban({
        userId: targetId,
        reason: banInfo.reason,
        expiresAt: banInfo.expiresAt,
        bannedBy: req.user!.id,
        createdAt: new Date().toISOString(),
      });
    } else if (parsed.data.isBanned === false) {
      invalidateSessionCache(targetId);
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

    if (!updated) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // 3.0.0 — korisnik saznaje za promenu U APLIKACIJI (ne samo posle odjave),
    // a staff dobija zapis o promeni rola ali i kad su ovi sistemski događaji.
    if (patch.role !== undefined && patch.role !== target.role) {
      const becameStaff = patch.role === 'admin' || patch.role === 'moderator';
      void notify({
        userId: updated.id,
        type: 'staff',
        title: becameStaff ? 'Dobio/la si staff pristup' : 'Promenjena ti je uloga',
        message: becameStaff
          ? `Uloga ti je promenjena u „${patch.role}“. Otključani su moderatorski alati (prijave, upozorenja, brisanje sadržaja).`
          : `Uloga ti je promenjena u „${patch.role}“ od strane ${req.user!.username}.`,
        link: `/profile/${encodeURIComponent(updated.username)}`,
        actorId: req.user!.id,
        // 6.0.0 — dodela uloge je jedan od DVA događaja koji ide i mejlom
        // (drugi je bedž). Ostale notifikacije žive samo u inbox-u/zvonu.
        notifyByEmail: true,
      }).catch(() => null);
    }
    if (parsed.data.isBanned !== undefined && parsed.data.isBanned !== target.isBanned) {
      void notify({
        userId: updated.id,
        type: parsed.data.isBanned ? 'warning' : 'staff',
        title: parsed.data.isBanned ? 'Nalog je suspendovan' : 'Nalog je reaktiviran',
        message: parsed.data.isBanned
          ? `Suspendovao te je ${req.user!.username}${banInfo?.reason ? ` — razlog: ${banInfo.reason}` : ''}.`
          : `Nalog ti je reaktivirao ${req.user!.username}.`,
        link: '/notifications',
        actorId: req.user!.id,
      }).catch(() => null);
    }
    if (parsed.data.muteHours !== undefined) {
      const muted = Boolean(patch.mutedUntil);
      void notify({
        userId: updated.id,
        type: 'warning',
        title: muted ? 'Privremeno si ućutkan (mute)' : 'Mute je uklonjen',
        message: muted
          ? `Ne možeš objavljivati do ${new Date(patch.mutedUntil).toLocaleString('sr-Latn-RS')} (odluka: ${req.user!.username}).`
          : 'Ponovo možeš da objavljuješ teme i odgovore.',
        link: '/notifications',
        actorId: req.user!.id,
      }).catch(() => null);
    }
    respond(res, ownerUserSchema, ownerUser(updated));
  } catch (err) {
    next(err);
  }
});

/* ------------------- F-10 — upozorenja (pre bana) ------------------- */

const warningSchema = z.object({
  reason: z.string().trim().min(5, 'Razlog upozorenja je prekratak (min. 5 znakova).').max(500),
  targetType: z.enum(['thread', 'reply', 'article', 'comment', 'user', 'deal']).optional().nullable(),
  targetId: z.string().max(64).optional().nullable(),
  /** Rok važenja u danima; bez vrednosti upozorenje ne ističe (opoziva se ručno). */
  expiresInDays: z.number().int().min(1).max(365).optional().nullable(),
});

const MAX_ACTIVE_WARNINGS = 3;

/**
 * F-10 — moderator upozorava korisnika PRE bana.
 *
 * Ban je poslednja mera: upozorenje nosi razlog (obavezno), vezu na sadržaj
 * koji je prekršio pravila i rok. Korisnik dobija notifikaciju i baner u UI-ju;
 * posle `MAX_ACTIVE_WARNINGS` aktivnih upozorenja ruta savetuje ban (ne
 * primenjuje ga automatski — odluka ostaje na moderatoru).
 */
router.post(
  '/:id/warnings',
  authenticate,
  authorize('admin', 'moderator'),
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = validate(warningSchema, req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.details[0].message });

      const target = await db.users.findById(req.params.id);
      if (!target) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
      if (target.role === 'admin') {
        return res.status(403).json({ error: 'Administratoru se ne mogu izdavati upozorenja.' });
      }
      if (target.id === req.user!.id) {
        return res.status(400).json({ error: 'Ne možete upozoriti sami sebe.' });
      }

      const now = new Date();
      const warning = await db.warnings.create({
        id: uid('warn'),
        userId: target.id,
        reason: parsed.data.reason,
        targetType: parsed.data.targetType ?? null,
        targetId: parsed.data.targetId ?? null,
        issuedBy: req.user!.id,
        expiresAt: parsed.data.expiresInDays
          ? new Date(now.getTime() + parsed.data.expiresInDays * 86_400_000).toISOString()
          : null,
        acknowledgedAt: null,
        revokedAt: null,
        revokedBy: null,
        createdAt: now.toISOString(),
      });

      await notify({
        userId: target.id,
        type: 'warning',
        title: 'Upozorenje moderatora',
        message: parsed.data.reason,
        link: '/notifications',
      }).catch(() => null);

      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: target.id,
        targetUsername: target.username,
        action: 'warning_issue',
        from: null,
        to: { reason: parsed.data.reason, expiresAt: warning.expiresAt },
      });

      const activeCount = (await db.warnings.listActive(target.id)).length;
      res.status(201).json({ warning, activeCount, suggestBan: activeCount >= MAX_ACTIVE_WARNINGS });
    } catch (err) {
      next(err);
    }
  },
);

/** Javna (staff + vlasnik) lista upozorenja jednog korisnika. */
router.get('/:id/warnings', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const isStaffViewer = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (!isStaffViewer && req.user!.id !== req.params.id) {
      return res.status(403).json({ error: 'Nemate pristup upozorenjima ovog korisnika.' });
    }
    const warnings = await db.warnings.list(req.params.id);
    const active = warnings.filter(
      (warning) => !warning.revokedAt && (!warning.expiresAt || new Date(warning.expiresAt).getTime() > Date.now()),
    );
    res.json({ warnings, activeCount: active.length });
  } catch (err) {
    next(err);
  }
});

/** Vlasnik potvrđuje da je video upozorenje (briše baner). */
router.post('/:id/warnings/:warningId/acknowledge', authenticate, async (req: AuthRequest, res, next) => {
  try {
    if (req.user!.id !== req.params.id) {
      return res.status(403).json({ error: 'Možete potvrditi samo svoja upozorenja.' });
    }
    const warning = await db.warnings.acknowledge(req.user!.id, req.params.warningId);
    if (!warning) return res.status(404).json({ error: 'Upozorenje nije pronađeno.' });
    res.json({ warning });
  } catch (err) {
    next(err);
  }
});

/** Moderator opoziva upozorenje (pogrešna prijava). */
router.delete(
  '/:id/warnings/:warningId',
  authenticate,
  authorize('admin', 'moderator'),
  async (req: AuthRequest, res, next) => {
    try {
      const warning = await db.warnings.revoke(req.params.warningId, req.user!.id);
      if (!warning) return res.status(404).json({ error: 'Upozorenje nije pronađeno.' });
      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: warning.userId,
        targetUsername: '',
        action: 'warning_revoke',
        from: { reason: warning.reason },
        to: { revokedAt: warning.revokedAt },
      });
      res.json({ warning });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

