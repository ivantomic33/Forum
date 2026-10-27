import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText, sanitizeText } from '../middleware/sanitize.js';
import { onlineSet, presenceMap } from '../lib/presence.js';
import { ACCESS_COOKIE } from '../lib/sessions.js';
import { validatePoll, savePoll, getPollForThread } from './polls.js';
import { createThreadSchema, createReplySchema, followThreadSchema, voteSchema, moderateSchema, updatePostSchema, validate } from '../lib/schemas.js';
import { awardXp, applyAuthorKarma, XP } from '../lib/gamification.js';
import { notify, notifyMentions } from '../lib/notifications.js';
// N10 — ugovor front↔back (isti modul uvozi `src/lib/api.ts`).
import { categoriesResponseSchema, threadCreateResponseSchema, threadDetailResponseSchema, threadListResponseSchema } from '../../contracts/index.js';
import { respond } from '../lib/respond.js';
import { recordAudit } from './users.js';
import { recordDailyPost, recordDailyReply } from '../lib/dailyLoop.js';
import { sendReplyEmails } from '../lib/threadEmails.js';
import { flagForReview, isNewMember, suspiciousSignals } from '../lib/newMemberGuard.js';
import { getPublicSiteSettings } from './admin.js';

const router = Router();

/**
 * F-3 — kartica deal-a na vrhu teme otvorene iz popusta.
 *
 * Deal čitamo bez „viewer“-a (kartica je javna): uklonjen deal se NE prikazuje
 * (postaje `null`, tema ostaje čitljiva), a greška upita ne obara prikaz teme.
 */
async function linkedDealCard(dealId?: string | null) {
  if (!dealId) return null;
  const deal = await db.deals.findById(dealId).catch(() => null);
  if (!deal || deal.status === 'removed') return null;
  return {
    id: deal.id,
    title: deal.title,
    store: deal.store,
    price: deal.price,
    originalPrice: deal.originalPrice,
    currency: deal.currency,
    discountPct: deal.discountPct,
    url: deal.url,
    gameCover: deal.gameCover ?? null,
    expiresAt: deal.expiresAt ?? null,
    status: deal.status,
  };
}

// =====================
// GET /api/forum/categories (dostupni subforumi sa statistikom)
// ====================
router.get('/categories', async (_req, res, next) => {
  try {
    // #13 — kategorije dolaze iz `forum_categories` (data layer), bez hardkodovane
    // liste u ruti. Isti izvor koristi i validacija novih tema.
    const categories = await db.forum.listCategories();
    respond(res, categoriesResponseSchema, { categories });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/forum/:subforum/threads (ili sve teme)
// ====================
router.get('/:subforum/threads', async (req, res, next) => {
  try {
    const { subforum } = req.params;
    // 6.x — `solved=no` prikazuje samo teme bez prihvaćenog odgovora („Nerešeno“).
    const { sort, search, limit = '100', cursor, solved } = req.query;

    // #13 — subforum se validira prema bazi; nepoznati slug ne prolazi
    if (subforum !== 'all' && !(await db.forum.categoryExists(subforum))) {
      return res.status(404).json({ error: 'Subforum ne postoji.' });
    }

    // F-18 — strana se čita u SQL-u (limit + range), a `total` dolazi iz COUNT-a
    // umesto da se cela tabela učita u memoriju.
    const take = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 200);
    const filters: {
      subforum?: string;
      sort: 'hot' | 'new' | 'top';
      search?: string;
      unsolved?: boolean;
    } = {
      subforum: subforum === 'all' ? undefined : subforum,
      sort: sort === 'new' || sort === 'top' ? sort : 'hot',
      search: typeof search === 'string' ? search.slice(0, 100) : undefined,
      unsolved: solved === 'no',
    };

    // B-10 — cursor paginacija: `cursor` je ID poslednje teme prethodne strane.
    // Offset se računa u bazi (COUNT redova „pre“ kursora po istom sortu), a ne
    // učitavanjem prvih 200 redova u JS — zato strana 3+ nikad ne vraća prazno.
    let offset = 0;
    if (typeof cursor === 'string' && cursor) {
      const cursorOffset = await db.forum.threadCursorOffset(filters, cursor);
      if (cursorOffset === null) {
        return respond(res, threadListResponseSchema, {
          threads: [],
          total: await db.forum.countThreads(filters),
          hasMore: false,
          nextCursor: null,
        });
      }
      offset = cursorOffset;
    }

    const [threads, total] = await Promise.all([
      db.forum.listThreads({ ...filters, limit: take, offset }),
      db.forum.countThreads(filters),
    ]);

    // B-11 — autori stranice u jednom upitu (`users.id IN (…)`), ne N+1.
    const authorIds = [...new Set(threads.map((thread) => thread.authorId).filter(Boolean))];
    const authorList = await db.users.findByIds(authorIds).catch(() => []);
    const authors = new Map(authorList.map((user) => [user.id, user]));
    // 2.6.1 — „Online sada“: jedan upit za sve autore na strani liste.
    // 2.6.2 — uz to stiže i `authorStatus` (`online | away | offline`).
    const presence = await presenceMap(authorIds).catch(() => new Map<string, 'online' | 'away' | 'offline'>());
    const withAuthors = threads.map((thread) => {
      const author = authors.get(thread.authorId);
      const status = presence.get(thread.authorId) ?? 'offline';
      return {
        ...thread,
        // 6.x — značka „Rešeno“ u listi (autor teme/staff označio prihvaćen odgovor).
        solved: Boolean(thread.acceptedReplyId),
        authorRole: author?.role ?? null,
        authorLevel: author?.level ?? null,
        authorVerified: author?.isVerified === true,
        authorOnline: status === 'online',
        authorStatus: status,
        authorAvatar: author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`,
      };
    });

    respond(res, threadListResponseSchema, {
      threads: withAuthors,
      // F-18 — total iz COUNT-a; `hasMore` odluka umesto poređenja sa punom listom.
      total,
      hasMore: offset + threads.length < total,
      nextCursor: offset + threads.length < total ? withAuthors[withAuthors.length - 1]?.id ?? null : null,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/forum/threads/:id (tema sa nested odgovorima)
// ====================
router.get('/threads/:id', async (req, res, next) => {
  try {
    const thread = await db.forum.findThread(req.params.id);
    if (!thread) {
      return res.status(404).json({ error: 'Tema nije pronađena.' });
    }

    // Opciona autentifikacija (za `myVote` u anketi i za soft-deleted teme)
    let viewerId: string | undefined;
    let viewerRole: string | undefined;
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ((req as any).cookies?.[ACCESS_COOKIE] ?? (req as any).cookies?.token);
    if (token) {
      try {
        // Bez hardkodovanog fallback-a: secret dolazi isključivo iz env-a
        // (middleware/auth.ts prekida start ako nije postavljen).
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
        viewerId = decoded.id;
        viewerRole = (await db.users.findById(decoded.id))?.role;
      } catch {
        viewerId = undefined;
      }
    }

    // Obrisana tema nije dostupna preko direktnog linka (404), osim autoru i
    // moderatorima/adminima koji je mogu videti radi revizije/restore-a.
    if (thread.isDeleted) {
      const isStaff = viewerRole === 'admin' || viewerRole === 'moderator';
      const isAuthor = Boolean(viewerId) && viewerId === thread.authorId;
      if (!isStaff && !isAuthor) {
        return res.status(404).json({ error: 'Tema nije pronađena.' });
      }
    }

    const [allReplies, poll] = await Promise.all([
      db.forum.listReplies(req.params.id),
      // F-22 — greška ankete ne obara prikaz teme, ali se prijavljuje (503 za glasanje).
      getPollForThread(req.params.id, viewerId).catch((error) => {
        req.log?.warn({ err: error, threadId: req.params.id }, 'poll_load_failed');
        return null;
      }),
    ]);
    // Obrisani odgovori se ne prikazuju ni u memory režimu.
    const replies = allReplies.filter((reply) => !reply.isDeleted);

    // Blokirani korisnici: njihovi odgovori se sakrivaju od prijavljenog korisnika.
    let visibleReplies = replies;
    if (viewerId) {
      const blocked = await db.blocks.blockedIds(viewerId).catch(() => new Set<string>());
      if (blocked.size) visibleReplies = replies.filter((reply) => !blocked.has(reply.authorId));
    }

    // #18 — pregled se inkrementira atomično (SQL UPDATE), a ne read-modify-write;
    // greška u brojanju ne sme da obori prikaz teme.
    db.forum.incrementViews(thread.id).catch(() => {});
    thread.views += 1;

    const author = await db.users.findByUsername(thread.author);

    // `authorRole` / `authorLevel` za rank značke na kartici teme i odgovorima.
    const replyAuthorIds = [...new Set(visibleReplies.map((reply) => reply.authorId).filter(Boolean))];
    const replyAuthors = new Map(
      (await Promise.all(replyAuthorIds.map((replyAuthorId) => db.users.findById(replyAuthorId).catch(() => null))))
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => [user.id, user]),
    );
    const online = await onlineSet([...replyAuthorIds, thread.authorId, author?.id])
      .catch(() => new Set<string>());
    const repliesWithAuthors = visibleReplies.map((reply) => {
      const replyAuthor = replyAuthors.get(reply.authorId);
      return {
        ...reply,
        authorRole: replyAuthor?.role ?? null,
        authorLevel: replyAuthor?.level ?? null,
        authorVerified: replyAuthor?.isVerified === true,
        authorOnline: Boolean(reply.authorId) && online.has(reply.authorId),
        authorAvatar: replyAuthor?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${reply.author}`,
      };
    });

    respond(res, threadDetailResponseSchema, {
      thread: {
        ...thread,
        // Označena teme — frontend prikazuje baner za obrisane teme.
        authorRole: author?.role ?? null,
        authorLevel: author?.level ?? null,
        authorVerified: author?.isVerified === true,
        authorOnline: Boolean(author?.id) && online.has(author!.id),
        authorAvatar: author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`,
        linkedDeal: await linkedDealCard(thread.dealId),
      },
      replies: repliesWithAuthors,
      poll,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/:subforum/threads (kreiraj temu)
// ====================
// F-11 — objavljivanje sadržaja (teme, odgovori, glasovi) zahteva verificiran email.
router.post('/:subforum/threads', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    // Admin podešavanja: zatvoren priliv novih tema / forum samo za čitanje.
    const siteSettings = getPublicSiteSettings();
    const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (siteSettings.readOnlyForum && !isStaff) {
      return res.status(403).json({ error: 'Forum je trenutno u režimu samo za čitanje.' });
    }
    if (siteSettings.disableNewThreads && !isStaff) {
      return res.status(403).json({ error: 'Otvaranje novih tema je trenutno onemogućeno od strane administratora.' });
    }

    // Najmanji XP za otvaranje teme (0 = svi mogu) — XP dohvatamo iz baze.
    if (!isStaff && siteSettings.minXpToPost > 0) {
      const full = await db.users.findById(req.user!.id);
      if (full && full.xp < siteSettings.minXpToPost) {
        return res.status(403).json({
          error: `Za otvaranje nove teme potrebno je najmanje ${siteSettings.minXpToPost} XP. Trenutno imaš ${full.xp}.`,
        });
      }
    }

    // Dnevni limit tema (0 = bez limita) — po korisniku, UTC dan.
    if (!isStaff && siteSettings.threadsPerDay > 0) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const allMine = await db.forum.listThreadsByAuthor(req.user!.id, req.user!.username, 1000);
      const todayCount = allMine.filter((thread) => (thread.createdAt ?? '').startsWith(todayIso)).length;
      if (todayCount >= siteSettings.threadsPerDay) {
        return res.status(429).json({ error: `Dostigao si dnevni limit od ${siteSettings.threadsPerDay} tema. Pokušaj sutra.` });
      }
    }

    // #13 — subforum mora postojati u bazi; proizvoljni nazivi se odbijaju
    if (!(await db.forum.categoryExists(req.params.subforum))) {
      return res.status(400).json({ error: 'Nepoznat subforum. Izaberite jedan od ponuđenih.' });
    }

    const parsed = validate(createThreadSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { title, content, tags, isSpoiler, poll, dealId } = parsed.data;
    const now = new Date().toISOString();

    // F-3 — tema iz deal-a: deal mora postojati i ne sme biti uklonjen, inače
    // kartica na vrhu teme vodi u 404. Nepostojeći ID ne pravi temu (a ne tiho
    // ignoriše grešku kao kod `gameId`).
    let linkedDeal: Awaited<ReturnType<typeof db.deals.findById>> = null;
    if (dealId) {
      linkedDeal = await db.deals.findById(dealId, req.user!.id);
      if (!linkedDeal || linkedDeal.status === 'removed') {
        return res.status(404).json({ error: 'Popust za koji se otvara tema ne postoji ili je uklonjen.' });
      }
    }

    const newThread = await db.forum.createThread({
      id: uid('thr'),
      subforum: req.params.subforum,
      // #16 — naslov je plain text, sadrŽaj je sanitizovani HTML
      title: sanitizeText(title),
      content: sanitizeRichText(content),
      author: req.user!.username,
      authorId: req.user!.id,
      tags: (tags ?? []).map((tag) => sanitizeText(tag)),
      karma: 1,
      views: 1,
      replies: 0,
      isPinned: false,
      isLocked: false,
      isSpoiler: Boolean(isSpoiler),
      dealId: linkedDeal ? linkedDeal.id : null,
      createdAt: now,
      lastReplyAt: now,
    });

    // #14 — XP, nivo i bedŽevi kroz jedan mehanizam (dnevni limit je unutra)
    const threadCount = (await db.forum.listThreadsByAuthor(req.user!.id, req.user!.username, 1000)).length;
    const awarded = await awardXp(req.user!.id, 20, { reason: 'thread', threadCount });
    // F-2 — streak + bonus za prvi post dana (ne blokira odgovor).
    void recordDailyPost(req.user!.id);

    // Anketa je pravi entitet, ne tekst u sadrŽaju
    const validPoll = validatePoll(poll);
    if (validPoll) {
      try {
        await savePoll(newThread.id, validPoll);
      } catch (error) {
        // F-22 — anketa nije sačuvana u bazi: ne tvrdimo da tema ima anketu.
        req.log?.warn({ err: error, threadId: newThread.id }, 'poll_save_failed');
        return res.status(503).json({
          error: 'Tema je objavljena, ali anketa nije sačuvana. Pokušajte ponovo.',
          thread: newThread,
        });
      }
    }

    // 6.x — anti-spam: prvih nekoliko objava novog člana ide kroz blagi filter.
    // Objava živi odmah; sumnjiva se samo upiše u moderacioni red (`reports`).
    void (async () => {
      if (isStaff) return;
      if (!(await isNewMember(req.user!.id, req.user!.username))) return;
      const signals = suspiciousSignals({
        content: `${newThread.title} ${newThread.content}`,
        recentContents: (await db.forum.listThreadsByAuthor(req.user!.id, req.user!.username, 5))
          .filter((item) => item.id !== newThread.id)
          .map((item) => item.title),
      });
      if (signals.length) {
        await flagForReview({ authorId: req.user!.id, targetType: 'thread', targetId: newThread.id, signals });
      }
    })().catch(() => undefined);

    req.log?.info({ threadId: newThread.id, poll: Boolean(validPoll), dealId: newThread.dealId ?? null }, 'thread_created');
    // 2.6.6 — odgovor se orezuje ugovorom (`threadSchema` je išeovao nove
    // zadate polja: `authorRole`, `dealId`), da klijent ne bi dobio oblik koji
    // ne prolazi `threadSchema` validaciju u development modu.
    respond(res, threadCreateResponseSchema, {
      ...newThread,
      poll: validPoll,
      awarded: awarded ? { xp: awarded.xpAwarded, levelUp: awarded.levelUp, newBadges: awarded.newBadges } : null,
    }, 201);
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/threads/:threadId/comments (odgovor / nested reply)
// ====================
router.post('/threads/:threadId/comments', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    // Admin podešavanja: forum samo za čitanje (staff izuzet).
    const siteSettings = getPublicSiteSettings();
    const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (siteSettings.readOnlyForum && !isStaff) {
      return res.status(403).json({ error: 'Forum je trenutno u režimu samo za čitanje.' });
    }

    // Dnevni limit odgovora (0 = bez limita) — po korisniku, UTC dan.
    if (!isStaff && siteSettings.postsPerDay > 0) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const allMine = await db.forum.listRepliesByAuthor(req.user!.id, req.user!.username, 1000).catch(() => []);
      const todayCount = allMine.filter((reply) => (reply.createdAt ?? '').startsWith(todayIso)).length;
      if (todayCount >= siteSettings.postsPerDay) {
        return res.status(429).json({ error: `Dostigao si dnevni limit od ${siteSettings.postsPerDay} odgovora. Pokušaj sutra.` });
      }
    }

    const parsed = validate(createReplySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const thread = await db.forum.findThread(req.params.threadId);
    if (!thread || thread.isDeleted) {
      return res.status(404).json({ error: 'Tema nije pronađena.' });
    }
    if (thread.isLocked) {
      return res.status(403).json({ error: 'Ova tema je zaključana za nove komentare.' });
    }

    const { content, parentId, isSpoiler } = parsed.data;

    // `parentId` mora da pripada ISTOJ temi — ranije se odgovor mogao zakačiti
    // na komentar iz druge teme (nested grana je izgledala slomljeno/prazno).
    if (parentId) {
      const parent = await db.forum.findReply(parentId);
      if (!parent || parent.threadId !== thread.id || parent.isDeleted) {
        return res.status(400).json({ error: 'Komentar na koji odgovarate ne postoji u ovoj temi.' });
      }
    }

    const newReply = await db.forum.createReply({
      id: uid('rep'),
      threadId: req.params.threadId,
      parentId: parentId || null,
      author: req.user!.username,
      authorId: req.user!.id,
      content: sanitizeRichText(content),
      karma: 0,
      isSpoiler: Boolean(isSpoiler),
      createdAt: new Date().toISOString(),
    });

    await awardXp(req.user!.id, 5, { reason: 'reply' });
    // F-2 — prvi post dana (streak + bonus) i dnevni kvest „odgovori 1 temi“.
    void recordDailyPost(req.user!.id);
    void recordDailyReply(req.user!.id);

    // Notifikacije: jedan primaílac = jedna notifikacija.
    // Ranije je autor teme koji je ujedno pratioc ili roditelj odgovora dobijao
    // 2–3 identične notifikacije (autor + pratioci + roditelj).
    const threadLink = `/thread/${thread.id}`;
    const notified = new Set<string>([req.user!.id]);

    const notifyOnce = async (userId: string | undefined | null, input: { title: string; message: string }) => {
      if (!userId || notified.has(userId)) return;
      notified.add(userId);
      await notify({
        userId,
        type: 'reply',
        title: input.title,
        message: input.message,
        link: threadLink,
        actorId: req.user!.id,
      });
    };

    // 1. Autor teme (osim ako odgovara na sopstvenu temu)
    await notifyOnce(thread.authorId, {
      title: 'Novi odgovor u vašoj temi',
      message: `${req.user!.username} je odgovorio u temi: ${thread.title}`,
    });

    // 2. Roditeljski komentar (nested reply)
    if (parentId) {
      const parent = await db.forum.findReply(parentId);
      await notifyOnce(parent?.authorId, {
        title: 'Odgovor na vaš komentar',
        message: `${req.user!.username} je odgovorio na vaš komentar u temi: ${thread.title}`,
      });
    }

    // 3. Pratioci teme (thread_subscriptions) — preskaču se već obavešteni
    // Notifikacija ne sme da obori odgovor: greška pretplate se samo loguje.
    const followers = await db.subscriptions.followers(thread.id).catch((error) => {
      req.log?.warn({ err: error, threadId: thread.id }, 'followers_lookup_failed');
      return [] as string[];
    });
    for (const followerId of followers) {
      await notifyOnce(followerId, {
        title: 'Nova aktivnost u praćenoj temi',
        message: `${req.user!.username} je odgovorio u: ${thread.title}`,
      });
    }

    // 4. @mentions iz sadrŽaja (ne duplira autore već obaveštenih)
    await notifyMentions({
      content: newReply.content,
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      link: threadLink,
      contextTitle: thread.title,
      excludeUserIds: notified,
    });

    // 5. Mejl pratiocima je UGAŠEN (mejl samo za verifikaciju i reset lozinke) —
    // `sendReplyEmails` je sada no-op i ostaje pozvan samo radi kompatibilnosti.
    void sendReplyEmails({
      threadId: thread.id,
      threadTitle: thread.title,
      threadPath: `${threadLink}#post-${newReply.id}`,
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      replyContent: newReply.content,
    });

    // 6.x — anti-spam za odgovore novih članova (isti princip, bez blokiranja).
    if (!isStaff) {
      void (async () => {
        if (!(await isNewMember(req.user!.id, req.user!.username))) return;
        const signals = suspiciousSignals({
          content: newReply.content,
          recentContents: (await db.forum.listRepliesByAuthor(req.user!.id, req.user!.username, 10))
            .filter((item) => item.id !== newReply.id)
            .map((item) => item.content),
        });
        if (signals.length) {
          await flagForReview({ authorId: req.user!.id, targetType: 'reply', targetId: newReply.id, signals });
        }
      })().catch(() => undefined);
    }

    res.status(201).json(newReply);
  } catch (error) {
    next(error);
  }
});

// =====================
// POST /api/forum/threads/:id/vote (glasanje za temu)
// ====================
router.post('/threads/:id/vote', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(voteSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Smer glasa mora biti "up", "down" ili null.' });
    }

    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });

    const before = thread.karma;
    const result = await db.forum.vote(req.user!.id, req.params.id, parsed.data.direction);
    const delta = result.karma - before;
    // F-17 — `changed === false` znači da se glas nije promenio (idempotentan ponovni
    // poziv): bez karme autora, XP-a i notifikacije.
    const changed = (result as { changed?: boolean }).changed !== false;

    // #14 — karma autora prati glasove (ne i za sopstveni glas)
    if (changed && delta !== 0 && thread.authorId !== req.user!.id) {
      await applyAuthorKarma(thread.authorId, delta);
      if (parsed.data.direction === 'up') {
        await awardXp(thread.authorId, 1, { reason: 'upvote_received' });
        await notify({
          userId: thread.authorId,
          type: 'upvote',
          title: 'Neko je glasao za vašu temu',
          message: `${req.user!.username} je glasao za: ${thread.title}`,
          link: `/thread/${thread.id}`,
          actorId: req.user!.id,
        });
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/replies/:id/vote (glasanje za odgovor)
// ====================
router.post('/replies/:id/vote', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(voteSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Smer glasa mora biti "up", "down" ili null.' });
    }

    const reply = await db.forum.findReply(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Odgovor nije pronađen.' });

    // F-13 — glas na obrisan odgovor ne sme da proizvede karmu ni notifikaciju.
    if (reply.isDeleted) return res.status(404).json({ error: 'Odgovor nije pronađen.' });

    const before = reply.karma;
    const result = await db.forum.vote(req.user!.id, req.params.id, parsed.data.direction);
    const delta = result.karma - before;
    const changed = (result as { changed?: boolean }).changed !== false;

    if (changed && delta !== 0 && reply.authorId !== req.user!.id) {
      await applyAuthorKarma(reply.authorId, delta);
      if (parsed.data.direction === 'up') {
        await notify({
          userId: reply.authorId,
          type: 'upvote',
          title: 'Neko je glasao za vaš odgovor',
          message: `${req.user!.username} je glasao za vaš odgovor.`,
          link: `/thread/${reply.threadId}`,
          actorId: req.user!.id,
        });
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =====================
// PUT /api/forum/threads/:id (izmena sopstvene teme)
// ====================
router.put('/threads/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(updatePostSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });

    const isOwner = thread.authorId === req.user!.id;
    const isModerator = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Možete menjati samo sopstvene teme.' });
    }

    const { title, content, tags, isSpoiler, deletePost } = parsed.data;
    const patch: any = { isEdited: true };
    if (title !== undefined) patch.title = sanitizeText(title);
    if (content !== undefined) patch.content = sanitizeRichText(content);
    if (tags !== undefined) patch.tags = tags.map((tag) => sanitizeText(tag));
    if (isSpoiler !== undefined) patch.isSpoiler = isSpoiler;
    if (deletePost) patch.isDeleted = true;

    const updated = await db.forum.updateThread(thread.id, patch);
    req.log?.info({ threadId: thread.id, editedBy: req.user!.id, deleted: Boolean(deletePost) }, 'thread_updated');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// =====================
// DELETE /api/forum/threads/:id (soft delete sopstvene teme)
// ====================
router.delete('/threads/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });

    const isOwner = thread.authorId === req.user!.id;
    const isModerator = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Možete brisati samo sopstvene teme.' });
    }

    await db.forum.updateThread(thread.id, { isDeleted: true } as any);
    req.log?.info({ threadId: thread.id, deletedBy: req.user!.id }, 'thread_soft_deleted');
    res.json({ message: 'Tema je obrisana.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// PUT /api/forum/replies/:id (izmena sopstvenog odgovora)
// ====================
router.put('/replies/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(updatePostSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const reply = await db.forum.findReply(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Odgovor nije pronađen.' });

    // F-13 — obrisani odgovor ne postoji za korisnika (moderator može samo da ga vidi u bazi).
    const isModerator = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (reply.isDeleted && !isModerator) return res.status(404).json({ error: 'Odgovor nije pronađen.' });

    const isOwner = reply.authorId === req.user!.id;
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Možete menjati samo sopstvene odgovore.' });
    }

    const { content, isSpoiler, deletePost, reason } = parsed.data;
    const patch: any = { isEdited: true };
    if (content !== undefined) patch.content = sanitizeRichText(content);
    if (isSpoiler !== undefined) patch.isSpoiler = isSpoiler;
    if (deletePost) patch.isDeleted = true;

    const updated = await db.forum.updateReply(reply.id, patch);
    // 6.x — kada odgovor UKLONI moderator (ne kad ga autor sam obriše), autor
    // dobija razlog u inbox-u. Razlog stiže kroz telo `moderate` rute za odgovore
    // ako postoji, inače uopštena poruka.
    const removalReason = reason ? sanitizeText(reason).slice(0, 300) : '';
    if (deletePost && isModerator && !isOwner && reply.authorId) {
      void notify({
        userId: reply.authorId,
        type: 'warning',
        title: 'Vaš odgovor je uklonjen',
        message: removalReason
          ? `Odgovor je uklonjen od strane ${req.user!.username}. Razlog: ${removalReason}`
          : `Odgovor je uklonjen od strane ${req.user!.username}.`,
        link: '/notifications',
        actorId: req.user!.id,
        metadata: { replyId: reply.id, reason: removalReason || null },
      }).catch(() => null);
    }
    req.log?.info({ replyId: reply.id, editedBy: req.user!.id, deleted: Boolean(deletePost) }, 'reply_updated');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// =====================
// DELETE /api/forum/replies/:id (soft delete sopstvenog odgovora)
// ====================
router.delete('/replies/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const reply = await db.forum.findReply(req.params.id);
    if (!reply) return res.status(404).json({ error: 'Odgovor nije pronađen.' });

    const isOwner = reply.authorId === req.user!.id;
    const isModerator = req.user!.role === 'admin' || req.user!.role === 'moderator';
    // F-13 — brisanje obrisanog odgovora je idempotentno za vlasnika, 404 za ostale.
    if (reply.isDeleted && !isModerator) {
      return isOwner
        ? res.json({ message: 'Odgovor je već obrisan.' })
        : res.status(404).json({ error: 'Odgovor nije pronađen.' });
    }
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Možete brisati samo sopstvene odgovore.' });
    }

    await db.forum.updateReply(reply.id, { isDeleted: true } as any);
    // 6.x — moderator koji ukloni TUĐI odgovor prati razlog autoru (vidi `moderate` rutu).
    const deleteReason = typeof (req.body as { reason?: unknown })?.reason === 'string'
      ? sanitizeText(String((req.body as { reason?: string }).reason)).slice(0, 300)
      : '';
    if (isModerator && !isOwner && reply.authorId) {
      void notify({
        userId: reply.authorId,
        type: 'warning',
        title: 'Vaš odgovor je uklonjen',
        message: deleteReason
          ? `Odgovor je uklonjen od strane ${req.user!.username}. Razlog: ${deleteReason}`
          : `Odgovor je uklonjen od strane ${req.user!.username}.`,
        link: '/notifications',
        actorId: req.user!.id,
        metadata: { replyId: reply.id, reason: deleteReason || null },
      }).catch(() => null);
    }
    req.log?.info({ replyId: reply.id, deletedBy: req.user!.id }, 'reply_soft_deleted');
    res.json({ message: 'Odgovor je obrisan.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/threads/:id/bookmark — sačuvaj temu
// ====================
router.post('/threads/:id/bookmark', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });
    await db.bookmarks.add(req.user!.id, 'thread', thread.id);
    res.json({ bookmarked: true, threadId: thread.id });
  } catch (err) {
    next(err);
  }
});

router.delete('/threads/:id/bookmark', authenticate, async (req: AuthRequest, res, next) => {
  try {
    await db.bookmarks.remove(req.user!.id, 'thread', req.params.id);
    res.json({ bookmarked: false, threadId: req.params.id });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/threads/:id/follow — prati temu
// ====================
router.post('/threads/:id/follow', authenticate, async (req: AuthRequest, res, next) => {
  try {
    // F-7.1 #8 — `{ email: true }` uz praćenje uključuje i mejl na novi odgovor;
    // bez tela ostaje samo in-app praćenje (kompatibilno sa starijim klijentom).
    const parsed = validate(followThreadSchema, req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }
    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });
    const email = parsed.data.email === true;
    await db.subscriptions.follow(req.user!.id, thread.id, email);
    res.json({ following: true, email, threadId: thread.id });
  } catch (err) {
    next(err);
  }
});

router.delete('/threads/:id/follow', authenticate, async (req: AuthRequest, res, next) => {
  try {
    await db.subscriptions.unfollow(req.user!.id, req.params.id);
    res.json({ following: false, threadId: req.params.id });
  } catch (err) {
    next(err);
  }
});

router.get('/threads/:id/follow', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const following = await db.subscriptions.isFollowing(req.user!.id, req.params.id);
    // `email` je `false` i kada pretplata još nema kolonu `email_on_reply`
    // (stara baza) — praćenje tada radi, samo bez mejla.
    const email = following ? await db.subscriptions.isEmailOnReply(req.user!.id, req.params.id) : false;
    res.json({ following, email });
  } catch (err) {
    next(err);
  }
});

// =====================
// 2.11.0 — PATCH /api/forum/threads/:threadId/accept/:replyId
// „Prihvaćen odgovor“ (accepted answer): označava SAMO autor teme (ili staff).
// `replyId = "none"` ponovo odznača rešenje. XP ide autoru odgovora samo pri
// PRVOM prihvatanju u temi — inače bi prebacivanje izbora farmovalo XP.
//
// 6.x — REPUTACIJA: pored XP-a raste i brojač `solvedAnswers` (`users.solved_answers`),
// koji se prikazuje na profilu odvojeno od karme (glasova). Brojač se odznačanjem
// NE smanjuje — reputacija je „koliko puta ti je odgovor pomogao“, ne trenutno stanje.
// ====================
const ACCEPTED_ANSWER_XP = XP.ACCEPTED_ANSWER;

router.patch('/threads/:threadId/accept/:replyId', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const thread = await db.forum.findThread(req.params.threadId);
    if (!thread) return res.status(404).json({ error: 'Tema nije pronađena.' });

    const isAuthor = thread.authorId === req.user!.id;
    const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (!isAuthor && !isStaff) {
      return res.status(403).json({ error: 'Samo autor teme može označiti prihvaćen odgovor.' });
    }

    const hadAccepted = Boolean(thread.acceptedReplyId);

    if (req.params.replyId === 'none') {
      const updated = await db.forum.updateThread(thread.id, { acceptedReplyId: null });
      return res.json({
        message: 'Prihvaćen odgovor je uklonjen.',
        threadId: thread.id,
        acceptedReplyId: null,
        thread: updated,
      });
    }

    const reply = await db.forum.findReply(req.params.replyId);
    if (!reply || reply.threadId !== thread.id) {
      return res.status(404).json({ error: 'Odgovor ne pripada ovoj temi.' });
    }
    if (reply.isDeleted) {
      return res.status(400).json({ error: 'Obrisan odgovor ne može biti prihvaćen.' });
    }

    const updated = await db.forum.updateThread(thread.id, { acceptedReplyId: reply.id });

    if (!hadAccepted && reply.authorId && reply.authorId !== req.user!.id) {
      // XP po događaju (dnevni budžet važi)…
      void awardXp(reply.authorId, ACCEPTED_ANSWER_XP, {
        reason: 'accepted_answer',
      }).catch(() => undefined);
      // …i reputacija +1 (`solved_answers` nije XP, pa ga dnevni budžet ne kroji).
      void awardXp(reply.authorId, 0, { reason: 'solved_answers' }).catch(() => undefined);
    }

    if (reply.authorId && reply.authorId !== req.user!.id) {
      void notify({
        userId: reply.authorId,
        type: 'upvote',
        title: 'Tvoj odgovor je prihvaćen kao rešenje!',
        message: `U temi: ${thread.title}`,
        link: `/forum/thread/${thread.id}#post-${reply.id}`,
        actorId: req.user!.id,
      }).catch(() => null);
    }

    res.json({
      message: 'Odgovor je označen kao rešenje.',
      threadId: thread.id,
      acceptedReplyId: reply.id,
      awardedXp: !hadAccepted ? ACCEPTED_ANSWER_XP : 0,
      thread: updated,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// PATCH /api/forum/threads/:id/moderate (pin/lock/delete - mod/admin)
// ====================
router.patch('/threads/:id/moderate', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(moderateSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const { isPinned, isLocked, deleteThread, restoreThread } = parsed.data;
    // 6.x — razlog uklanjanja ide autoru u inbox (mejl je ugašen, a "zašto mi je
    // nestao post" poruke su bile jedini način da se to sazna).
    const removalReason = parsed.data.reason ? sanitizeText(parsed.data.reason).slice(0, 300) : '';

    const thread = await db.forum.findThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Tema nije pronađena.' });

    // F-10 — vraćanje soft-deleted teme. Ranije je to bilo moguće samo ručno
    // u bazi; sada je isto dugme u adminu (i moderacija ga sme koristiti).
    if (restoreThread) {
      if (!thread.isDeleted) {
        return res.status(409).json({ error: 'Tema nije obrisana — nema šta da se vrati.' });
      }
      const restored = await db.forum.updateThread(thread.id, { isDeleted: false });
      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: thread.id,
        targetUsername: thread.authorId,
        action: 'thread_restore',
        from: { isDeleted: true },
        to: { isDeleted: false },
      });
      req.log?.info({ threadId: thread.id, restoredBy: req.user!.id }, 'thread_moderated_restored');
      return res.json({ message: 'Tema je vraćena.', threadId: thread.id, isDeleted: false, thread: restored });
    }

    if (thread.isDeleted) {
      return res.status(404).json({ error: 'Tema nije pronađena.' });
    }

    // Moderator "briše" temu SOFT DELETE-om: tema nestaje iz listi i vraća 404,
    // ali red i odgovori ostaju u bazi (revizija, žalbe, mogući restore).
    if (deleteThread) {
      await db.forum.updateThread(thread.id, { isDeleted: true });
      await recordAudit({
        actorId: req.user!.id,
        actorUsername: req.user!.username,
        targetId: thread.id,
        targetUsername: thread.authorId,
        action: 'thread_delete',
        from: { isDeleted: false },
        to: { isDeleted: true, ...(removalReason ? { reason: removalReason } : {}) },
      });
      // 6.x — autor saznaje ŠTA je uklonjeno i ZAŠTO (staff ne dobija poruku o svom potezu).
      if (thread.authorId && thread.authorId !== req.user!.id) {
        void notify({
          userId: thread.authorId,
          type: 'warning',
          title: 'Vaša tema je uklonjena',
          message: removalReason
            ? `Tema „${thread.title}“ je uklonjena od strane ${req.user!.username}. Razlog: ${removalReason}`
            : `Tema „${thread.title}“ je uklonjena od strane ${req.user!.username}.`,
          link: '/notifications',
          actorId: req.user!.id,
          metadata: { threadId: thread.id, reason: removalReason || null },
        }).catch(() => null);
      }
      req.log?.info({ threadId: thread.id, deletedBy: req.user!.id }, 'thread_moderated_deleted');
      return res.json({ message: 'Tema je obrisana.', threadId: thread.id, isDeleted: true });
    }

    const patch: any = {};
    if (isPinned !== undefined) patch.isPinned = isPinned;
    if (isLocked !== undefined) patch.isLocked = isLocked;

    const updated = await db.forum.updateThread(req.params.id, patch);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
