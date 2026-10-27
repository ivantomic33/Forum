import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../lib/store.js';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { newsletterResendSchema, subscribeSchema, validate } from '../lib/schemas.js';
import { isDisposableEmail } from '../lib/validation.js';
import { appUrl } from '../lib/email.js';
import { logger } from '../lib/logger.js';
import { parseSegment, subscriberSegment } from '../lib/newsletter.js';

const router = Router();

const NEWSLETTER_SECRET = process.env.NEWSLETTER_SECRET || process.env.JWT_SECRET || 'nexus-newsletter-secret';
/** Potvrda pretplate važi 48h — isti TTL u mejlu i u tokenu. */
const CONFIRM_TTL = '48h';

/**
 * Odjava mora biti potpisana za taj email — bez tokena niko ne može da
 * odjavi tuđu adresu (#22). Token je vezan SAMO za unsubscribe akciju.
 */
export function signUnsubscribeToken(email: string): string {
  return jwt.sign({ email, purpose: 'newsletter_unsubscribe' }, NEWSLETTER_SECRET, { expiresIn: '30d' });
}

function verifyUnsubscribeToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, NEWSLETTER_SECRET) as { email?: string; purpose?: string };
    if (payload.purpose !== 'newsletter_unsubscribe' || !payload.email) return null;
    return payload.email;
  } catch {
    return null;
  }
}

/** Potvrda je vezana za TAČNU adresu (`email` iz tokena), TTL 48h. */
export function signConfirmToken(email: string): string {
  return jwt.sign({ email, purpose: 'newsletter_confirm' }, NEWSLETTER_SECRET, { expiresIn: CONFIRM_TTL });
}

function verifyConfirmToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, NEWSLETTER_SECRET) as { email?: string; purpose?: string };
    if (payload.purpose !== 'newsletter_confirm' || !payload.email) return null;
    return payload.email;
  } catch {
    return null;
  }
}

/**
 * Link za odjavu u mejlu — vodi na STRANICU (odjava je POST zbog CSRF-a),
 * a ne direktno na API rutu.
 */
export const unsubscribePageUrl = (email: string): string =>
  `${appUrl()}/newsletter/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(email))}`;

// =====================
// POST /api/newsletter/subscribe (double opt-in)
// ====================
router.post('/subscribe', async (req, res, next) => {
  try {
    const parsed = validate(subscribeSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const email = parsed.data.email.toLowerCase();
    if (isDisposableEmail(email)) {
      return res.status(400).json({ error: 'Privremene (temp) email adrese nisu dozvoljene.' });
    }

    await db.newsletter.subscribe(email);
    // F-07 — double opt-in: ovde se upisuje samo PRETPLATA NA ČEKANJU.
    // Potvrda mejlom je ugašena (mejl samo za verifikaciju naloga i reset
    // lozinke), pa pretplata ostaje na čekanju — kampanje/digest se ionako ne
    // šalju mejlom.
    res.status(201).json({
      message: 'Pretplata je zabeležena. Mejl potvrde nije poslat jer su mejl notifikacije ugašene.',
      mailSent: false,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/newsletter/confirm?token=...
// =====================
router.get('/confirm', async (req, res) => {
  // 2.6.2 — narušen `try` uklonjen: `verifyConfirmToken` nikad ne baca, a
  // greška baze više ne izgleda kao „nevažeći token“ (400).
  const email = verifyConfirmToken(String(req.query.token ?? ''));
  if (!email) {
    return res.status(400).json({ error: 'Token je nevažeći ili je istekao.' });
  }

  // F-07 — aktivacija TEK ovde; čuva se dokaz saglasnosti (vreme, IP, UA).
  const confirmed = await db.newsletter.confirm(email, {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  if (!confirmed) {
    return res.status(404).json({ error: 'Pretplata nije pronađena. Pretplatite se ponovo sa sajta.' });
  }

  res.json({
    message: 'Pretplata je potvrđena.',
    unsubscribeToken: signUnsubscribeToken(email),
  });
});

// =====================
// POST /api/newsletter/unsubscribe (signed token)
// ====================
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const token = String(req.body?.token ?? '');
    const targetEmail = verifyUnsubscribeToken(token);
    if (!targetEmail) {
      return res.status(400).json({ error: 'Nevažeći ili istekao link za odjavu.' });
    }

    const ok = await db.newsletter.unsubscribe(targetEmail);
    res.json({ message: ok ? 'Uspešno odjavljeni.' : 'Pretplatnik nije pronađen.' });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/newsletter/subscribers?segment=&search=&limit=&offset= (admin)
// ====================
// 2.6.2 — segment + pretraga + paginacija. `total` je broj za prosleđeni
// segment (ranije: samo dužina vraćene liste).
router.get('/subscribers', authenticate, authorize('admin'), async (req: AuthRequest, res, next) => {
  try {
    const segment = parseSegment(req.query.segment);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120).toLowerCase() : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const all = await db.newsletter.findAll();
    const counts = { all: all.length, active: 0, pending: 0, unsubscribed: 0 };
    for (const sub of all) counts[subscriberSegment(sub)]++;

    const filtered = all.filter(
      (sub) =>
        (segment === 'all' || subscriberSegment(sub) === segment) &&
        (!search || sub.email.toLowerCase().includes(search)),
    );
    filtered.sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime());

    res.json({
      subscribers: filtered.slice(offset, offset + limit),
      total: filtered.length,
      counts,
      segment,
      limit,
      offset,
      hasMore: offset + limit < filtered.length,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// POST /api/newsletter/resend (admin) — ponovo pošalji potvrdu
// ====================
// Za pretplatnike koji su se prijavili, a mejl nije stigao (spam filter,
// istekao link). Odjavljena adresa se NE vraća u „pending“ — ponovna potvrda
// bi bila zaobilaženje odjave.
router.post('/resend', authenticate, authorize('admin', 'moderator'), async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(newsletterResendSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const email = parsed.data.email.toLowerCase();
    const subscribers = await db.newsletter.findAll();
    const match = subscribers.find((sub) => sub.email.toLowerCase() === email);
    if (!match) {
      return res.status(404).json({ error: 'Pretplatnik sa tom adresom nije pronađen.' });
    }
    if (match.unsubscribedAt) {
      return res.status(409).json({ error: 'Adresa se odjavila — potvrda mora krenuti ponovo sa sajta.' });
    }
    if (match.isActive) {
      return res.status(409).json({ error: 'Pretplata je već potvrđena.' });
    }

    // Mejl potvrde je ugašen (mejl samo za verifikaciju naloga i reset lozinke).
    logger.info({ actor: req.user!.id }, 'newsletter_confirmation_resent');
    res.json({
      message: 'Mejl potvrde se ne šalje — mejl notifikacije su ugašene.',
      sent: false,
    });
  } catch (err) {
    next(err);
  }
});

// =====================
// GET /api/newsletter/export?segment= (admin) — CSV za spoljni mailing alat
// ====================
router.get('/export', authenticate, authorize('admin'), async (req: AuthRequest, res, next) => {
  try {
    const segment = parseSegment(req.query.segment);
    const all = await db.newsletter.findAll();
    const rows = all
      .filter((sub) => segment === 'all' || subscriberSegment(sub) === segment)
      .map((sub) =>
        [sub.email, subscriberSegment(sub), sub.subscribedAt, sub.confirmedAt ?? '']
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(','),
      );

    const csv = ['"email","status","subscribed_at","confirmed_at"', ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nexus-newsletter-${segment}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
