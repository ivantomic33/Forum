import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db, uid } from '../lib/store.js';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText, sanitizeText } from '../middleware/sanitize.js';
import { onlineSet, presenceMap } from '../lib/presence.js';
import { ACCESS_COOKIE } from '../lib/sessions.js';
import { validatePoll, savePoll, getPollForThread } from './polls.js';
import { createThreadSchema, createReplySchema, voteSchema, moderateSchema, updatePostSchema, validate } from '../lib/schemas.js';
import { awardXp, applyAuthorKarma } from '../lib/gamification.js';
import { notify, notifyMentions } from '../lib/notifications.js';

const router = Router();

// =====================
// GET /api/forum/categories (dostupni subforumi sa statistikom)
// ====================
router.get('/categories', async (_req, res, next) => {
  try {
    // #13 — kategorije dolaze iz `forum_categories` (data layer), bez hardkodovane
    // liste u ruti. Isti izvor koristi i validacija novih tema.
    const categories = await db.forum.listCategories();
    res.json({ categories });
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
    const { sort, search, limit = '100', cursor } = req.query;

    // #13 — subforum se validira prema bazi; nepoznati slug ne prolazi
    if (subforum !== 'all' && !(await db.forum.categoryExists(subforum))) {
      return res.status(404).json({ error: 'Subforum ne postoji.' });
    }

    // F-18 — strana se čita u SQL-u (limit + range), a `total` dolazi iz COUNT-a
    // umesto da se cela tabela učita u memoriju.
    const take = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 200);
    const filters = {
      subforum: subforum === 'all' ? undefined : subforum,
      sort: (sort as any) || 'hot',
      search: typeof search === 'string' ? search.slice(0, 100) : undefined,
    };

    // Cursor paginacija: `cursor` je ID poslednje teme prethodne strane.
    // Keyset prístup: prvo se SQL-om dobija offset kursora (LIMIT 1), pa strana.
    let offset = 0;
    if (typeof cursor === 'string' && cursor) {
      // Prvo pročitaj ID-jeve prve strane da se nađe offset kursora — bez učitavanja PUNE liste.
      const page = await db.forum.listThreads({ ...filters, limit: 200, offset: 0 });
      const found = page.findIndex((item) => item.id === cursor);
      if (found < 0) return res.json({ threads: [], total: await db.forum.countThreads(filters), hasMore: false, nextCursor: null });
      offset = found + 1;
    }

    const [threads, total] = await Promise.all([
      db.forum.listThreads({ ...filters, limit: take, offset }),
      db.forum.countThreads(filters),
    ]);

    // `authorRole` / `authorLevel` — frontend ih koristi za rank značke na listi.
    const authorIds = [...new Set(threads.map((thread) => thread.authorId).filter(Boolean))];
    const authors = new Map(
      (await Promise.all(authorIds.map((authorId) => db.users.findById(authorId).catch(() => null))))
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => [user.id, user]),
    );
    // 2.6.1 — „Online sada“: jedan upit za sve autore na strani liste.
    // 2.6.2 — uz to stiže i `authorStatus` (`online | away | offline`).
    const presence = await presenceMap(authorIds).catch(() => new Map<string, 'online' | 'away' | 'offline'>());
    const withAuthors = threads.map((thread) => {
      const author = authors.get(thread.authorId);
      const status = presence.get(thread.authorId) ?? 'offline';
      return {
        ...thread,
        authorRole: author?.role ?? null,
        authorLevel: author?.level ?? null,
        authorVerified: author?.isVerified === true,
        authorOnline: status === 'online',
        authorStatus: status,
        authorAvatar: author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`,
      };
    });

    res.json({
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

    res.json({
      thread: {
        ...thread,
        // Označena teme — frontend prikazuje baner za obrisane teme.
        authorRole: author?.role ?? null,
        authorLevel: author?.level ?? null,
        authorVerified: author?.isVerified === true,
        authorOnline: Boolean(author?.id) && online.has(author!.id),
        authorAvatar: author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`,
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
    // #13 — subforum mora postojati u bazi; proizvoljni nazivi se odbijaju
    if (!(await db.forum.categoryExists(req.params.subforum))) {
      return res.status(400).json({ error: 'Nepoznat subforum. Izaberite jedan od ponuđenih.' });
    }

    const parsed = validate(createThreadSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { title, content, tags, isSpoiler, poll } = parsed.data;
    const now = new Date().toISOString();

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
      createdAt: now,
      lastReplyAt: now,
    });

    // #14 — XP, nivo i bedŽevi kroz jedan mehanizam (dnevni limit je unutra)
    const threadCount = (await db.forum.listThreadsByAuthor(req.user!.id, req.user!.username, 1000)).length;
    const awarded = await awardXp(req.user!.id, 20, { reason: 'thread', threadCount });

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

    req.log?.info({ threadId: newThread.id, poll: Boolean(validPoll) }, 'thread_created');
    res.status(201).json({
      ...newThread,
      poll: validPoll,
      awarded: awarded ? { xp: awarded.xpAwarded, levelUp: awarded.levelUp, newBadges: awarded.newBadges } : null,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/forum/threads/:threadId/comments (odgovor / nested reply)
// ====================
router.post('/threads/:threadId/comments', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
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

    const { content, isSpoiler, deletePost } = parsed.data;
    const patch: any = { isEdited: true };
    if (content !== undefined) patch.content = sanitizeRichText(content);
    if (isSpoiler !== undefined) patch.isSpoiler = isSpoiler;
    if (deletePost) patch.isDeleted = true;

    const updated = await db.forum.updateReply(reply.id, patch);
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
    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });
    await db.subscriptions.follow(req.user!.id, thread.id);
    res.json({ following: true, threadId: thread.id });
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
    res.json({ following });
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

    const { isPinned, isLocked, deleteThread } = parsed.data;

    const thread = await db.forum.findThread(req.params.id);
    if (!thread || thread.isDeleted) {
      return res.status(404).json({ error: 'Tema nije pronađena.' });
    }

    // Moderator "briše" temu SOFT DELETE-om: tema nestaje iz listi i vraća 404,
    // ali red i odgovori ostaju u bazi (revizija, Žalbe, mogući restore).
    if (deleteThread) {
      await db.forum.updateThread(thread.id, { isDeleted: true });
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
