import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/store.js';
import { logger } from '../lib/logger.js';
import { notify } from '../lib/notifications.js';
import { authenticate, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { sanitizeText } from '../middleware/sanitize.js';
import { getPublicSiteSettings } from './admin.js';

/**
 * PRIVATNE PORUKE (DM) — 2.11.0
 * -----------------------------
 * Razgovor je PAR korisnika, ne „thread“ objekat — zato nema duplikata A→B/B→A
 * (`findOrCreateConversation` uvek sređuje par). Sve rute zahtevaju prijavu.
 *
 * Bezbednost:
 *  - svaka ruta sa `:id` proverava da je zalogovani korisnik ČLAN razgovora
 *    (`isParticipant`); bez toga je odgovor 404 (ne 403 — ne otkrivamo
 *    postojanje tuđeg razgovora),
 *  - blokada radi u OBA smera: ako je bilo ko blokirao drugog, slanje je odbijeno,
 *  - `requireVerified` za slanje poruke (isto pravilo kao teme/odgovori),
 *  - sadržaj se čisti od markupa (`sanitizeText`) i ograničen je na 4.000 znakova.
 */

const router = Router();

const MAX_MESSAGE_LENGTH = 4000;

const sendMessageSchema = z.object({
  /** Alternativno `conversationId` ili `toUsername` (nov/tražeći razgovor). */
  conversationId: z.string().min(1).max(64).optional(),
  toUsername: z.string().min(3).max(32).optional(),
  content: z
    .string()
    .trim()
    .min(1, 'Poruka ne može biti prazna.')
    .max(MAX_MESSAGE_LENGTH, `Poruka može imati najviše ${MAX_MESSAGE_LENGTH} znakova.`),
}).refine((value) => Boolean(value.conversationId || value.toUsername), {
  message: 'Nedostaje `conversationId` ili `toUsername`.',
});

/** 404 za svaki razgovor u koji korisnik nije uključen (ne odajemo da postoji). */
async function requireConversation(id: string, userId: string) {
  const conversation = await db.dm.findConversation(id);
  if (!conversation) return null;
  if (conversation.userLow !== userId && conversation.userHigh !== userId) return null;
  return conversation;
}

const partnerOf = (conversation: { userLow: string; userHigh: string }, userId: string) =>
  conversation.userLow === userId ? conversation.userHigh : conversation.userLow;

// GET /api/dm — lista razgovora (najskoriji prvi) + ukupno nepročitanih
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversations = await db.dm.listConversations(req.user!.id);
    const unreadCount = await db.dm.countUnread(req.user!.id);
    res.json({ conversations, unreadCount });
  } catch (err) {
    next(err);
  }
});

// GET /api/dm/unread-count — lagani brojač za zvonce (bez liste)
router.get('/unread-count', authenticate, async (req: AuthRequest, res, next) => {
  try {
    res.json({ unreadCount: await db.dm.countUnread(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/dm — pronađi ili napravi razgovor sa korisnikom `{ username }`
router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    // Admin podešavanja: DM potpuno isključen ili limit razgovora po korisniku.
    const dmSettings = getPublicSiteSettings();
    const isStaff = req.user!.role === 'admin' || req.user!.role === 'moderator';
    if (dmSettings.dmDisabled && !isStaff) {
      return res.status(403).json({ error: 'Privatne poruke su trenutno isključene od strane administratora.' });
    }
    if (!isStaff && dmSettings.dmMaxThreadsPerUser > 0) {
      const mine = await db.dm.listConversations(req.user!.id);
      if (mine.length >= dmSettings.dmMaxThreadsPerUser) {
        return res.status(403).json({ error: `Dostigao si maksimalan broj razgovora (${dmSettings.dmMaxThreadsPerUser}).` });
      }
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) return res.status(400).json({ error: 'Nedostaje `username`.' });

    const partner = await db.users.findByUsername(username);
    if (!partner) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (partner.id === req.user!.id) {
      return res.status(400).json({ error: 'Ne možeš razgovarati sam sa sobom.' });
    }

    // Blokada u oba smera — ne otvaramo razgovor sa korisnikom koji te je blokirao.
    const [myBlocks, theirBlocks] = await Promise.all([
      db.blocks.blockedIds(req.user!.id),
      db.blocks.blockedIds(partner.id),
    ]);
    if (myBlocks.has(partner.id)) {
      return res.status(403).json({ error: 'Blokirali ste ovog korisnika. Odblokirajte ga u podešavanjima.' });
    }
    if (theirBlocks.has(req.user!.id)) {
      return res.status(403).json({ error: 'Ovaj korisnik trenutno ne prima poruke.' });
    }

    const conversation = await db.dm.findOrCreateConversation(req.user!.id, partner.id);
    res.status(201).json({
      conversation: {
        id: conversation.id,
        partnerId: partner.id,
        partnerUsername: partner.username,
        partnerAvatar: partner.avatar,
        lastMessage: null,
        lastMessageAt: conversation.lastMessageAt,
        lastMessageFromMe: false,
        unreadCount: 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dm/:id — poruke razgovora; `?before=<ISO>&limit=50` za starije
router.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversation = await requireConversation(req.params.id, req.user!.id);
    if (!conversation) return res.status(404).json({ error: 'Razgovor nije pronađen.' });

    const limit = Number(req.query.limit ?? 50);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const messages = await db.dm.listMessages(conversation.id, {
      limit: Number.isFinite(limit) ? limit : 50,
      before,
    });

    // Otvaranje razgovora je čitanje — označi primljene kao pročitane.
    await db.dm.markRead(conversation.id, req.user!.id).catch((err) => {
      logger.warn({ err, conversationId: conversation.id }, 'dm_mark_read_failed');
    });

    const partnerId = partnerOf(conversation, req.user!.id);
    const partner = await db.users.findById(partnerId).catch(() => null);

    res.json({
      conversation: {
        id: conversation.id,
        partnerId,
        partnerUsername: partner?.username ?? '',
        partnerAvatar: partner?.avatar ?? '',
      },
      messages,
      hasMore: messages.length === Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/dm/:id/messages — pošalji poruku u POSTOJEĆI razgovor
router.post('/:id/messages', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const conversation = await requireConversation(req.params.id, req.user!.id);
    if (!conversation) return res.status(404).json({ error: 'Razgovor nije pronađen.' });

    const partnerId = partnerOf(conversation, req.user!.id);

    // Blokada u OBA smera: blokiran korisnik ne može da pošalje poruku, a ni
    // onaj koji ga je blokirao ne može da mu piše dok je blokada aktivna.
    const [myBlocks, theirBlocks] = await Promise.all([
      db.blocks.blockedIds(req.user!.id),
      db.blocks.blockedIds(partnerId),
    ]);
    if (myBlocks.has(partnerId) || theirBlocks.has(req.user!.id)) {
      return res.status(403).json({ error: 'Poruka nije poslata — jedan od korisnika je blokirao drugog.' });
    }

    const message = await db.dm.createMessage({
      conversationId: conversation.id,
      senderId: req.user!.id,
      content: sanitizeText(parsed.data.content),
    });

    // Notifikacija primaocu (inbox + push preko `notify`). Neuspeh ne obara slanje.
    void notify({
      userId: partnerId,
      type: 'dm',
      title: `Nova poruka od ${req.user!.username}`,
      message: message.content.slice(0, 140),
      link: `/messages/${conversation.id}`,
      actorId: req.user!.id,
      metadata: { conversationId: conversation.id },
    }).catch(() => null);

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

// POST /api/dm/send — pošalji poruku bez prethodnog pravljenja razgovora
// (`toUsername`), ili u razgovor ako je poslat `conversationId`.
router.post('/send', authenticate, requireVerified, async (req: AuthRequest, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    let conversation;
    let partnerId: string;

    if (parsed.data.conversationId) {
      const existing = await requireConversation(parsed.data.conversationId, req.user!.id);
      if (!existing) return res.status(404).json({ error: 'Razgovor nije pronađen.' });
      conversation = existing;
      partnerId = partnerOf(existing, req.user!.id);
    } else {
      const partner = await db.users.findByUsername(parsed.data.toUsername!);
      if (!partner) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
      if (partner.id === req.user!.id) {
        return res.status(400).json({ error: 'Ne možeš razgovarati sam sa sobom.' });
      }
      partnerId = partner.id;
      conversation = await db.dm.findOrCreateConversation(req.user!.id, partner.id);
    }

    const [myBlocks, theirBlocks] = await Promise.all([
      db.blocks.blockedIds(req.user!.id),
      db.blocks.blockedIds(partnerId),
    ]);
    if (myBlocks.has(partnerId) || theirBlocks.has(req.user!.id)) {
      return res.status(403).json({ error: 'Poruka nije poslata — jedan od korisnika je blokirao drugog.' });
    }

    const message = await db.dm.createMessage({
      conversationId: conversation.id,
      senderId: req.user!.id,
      content: sanitizeText(parsed.data.content),
    });

    void notify({
      userId: partnerId,
      type: 'dm',
      title: `Nova poruka od ${req.user!.username}`,
      message: message.content.slice(0, 140),
      link: `/messages/${conversation.id}`,
      actorId: req.user!.id,
      metadata: { conversationId: conversation.id },
    }).catch(() => null);

    res.status(201).json({ conversationId: conversation.id, message });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dm/:id/read — označi primljene kao pročitane (klijent može i bez GET-a)
router.patch('/:id/read', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const conversation = await requireConversation(req.params.id, req.user!.id);
    if (!conversation) return res.status(404).json({ error: 'Razgovor nije pronađen.' });
    const marked = await db.dm.markRead(conversation.id, req.user!.id);
    res.json({ marked });
  } catch (err) {
    next(err);
  }
});

export default router;
