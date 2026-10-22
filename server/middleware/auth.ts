import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../lib/store.js';
import { ACCESS_COOKIE } from '../lib/sessions.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET nije postavljen ili je prekratak (minimum 32 karaktera).');
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    /** `dev` je kozmetička uloga (značka/okvir) — nema moderatorske dozvole. */
    role: 'admin' | 'dev' | 'moderator' | 'member';
    isVerified: boolean;
  };
}

/**
 * Verzija sesije (F-06): token nosi `tv`, a izvor istine je `users.token_version`.
 * Svako povećanje poništava SVE ranije izdate tokene (odjava, „odjavi sve
 * uređaje“, promena/reset lozinke, brisanje naloga).
 *
 * Legacy tokeni bez `tv` tretiraju se kao verzija 0 — važe dok se verzija prvi
 * put ne poveća, pa postojeće sesije ne padaju pri deploy-u.
 */
export function sessionVersionOf(user: { tokenVersion?: number }): number {
  return typeof user.tokenVersion === 'number' ? user.tokenVersion : 0;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;
  // F-32 — access JWT je od 2.5.4 u HttpOnly cookie-ju `nx_at`; `token` je legacy
  // naziv iz CookieStorage ere i čitao se samo zato što se ime nikad nije prenelo.
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : ((req.cookies?.[ACCESS_COOKIE] ?? req.cookies?.token) as string | undefined);

  if (!token) return res.status(401).json({ error: 'Prijavite se.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id?: string; tv?: number };
    if (!decoded.id) return res.status(401).json({ error: 'Nevažeći ili istekao token.' });

    // Payload JWT nije izvor istine: proveri aktuelnog korisnika i ban/role iz baze.
    // Greška baze = 503 (ne 401): sesija nije nevažeća, samo je status nepoznat —
    // frontend ne sme da obriše token zbog privremenog pada baze.
    let user;
    try {
      user = await db.users.findById(decoded.id);
    } catch (error) {
      req.log?.error({ err: error, userId: decoded.id }, 'auth_user_lookup_failed');
      return res.status(503).json({ error: 'Autentifikacija trenutno nije dostupna. Pokušajte ponovo.' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Nalog nije aktivan.' });
    }

    // F-06 — token izdate pre odjave/reseta lozinke više ne važi.
    if ((decoded.tv ?? 0) !== sessionVersionOf(user)) {
      return res.status(401).json({ error: 'Sesija je istekla. Prijavite se ponovo.', code: 'SESSION_REVOKED' });
    }

    if (user.isBanned) {
      // Ban sa istekom: `bans` tabela je izvor istine; ako je istekao, ukini ga.
      // Greška baze NE sme da znači „ban je istekao“ (fail-closed, ne fail-open).
      let activeBan;
      try {
        activeBan = await db.bans.findActive(user.id);
      } catch (error) {
        req.log?.error({ err: error, userId: user.id }, 'ban_lookup_failed');
        return res.status(503).json({ error: 'Status naloga trenutno nije moguće proveriti. Pokušajte kasnije.' });
      }

      if (activeBan) {
        return res.status(401).json({ error: 'Nalog nije aktivan.' });
      }

      await db.users.update(user.id, { isBanned: false }).catch(() => {});
      await db.bans.lift(user.id).catch(() => {});
      user.isBanned = false;
    }

    req.user = { id: user.id, username: user.username, role: user.role, isVerified: user.isVerified };
    return next();
  } catch (error) {
    // Greška van jwt provere ne sme da bude 401 — token bi bio obrisan bez razloga.
    req.log?.error({ err: error }, 'auth_lookup_failed');
    return res.status(503).json({ error: 'Autentifikacija trenutno nije dostupna. Pokušajte ponovo.' });
  }
};

export const authorize = (...roles: Array<'admin' | 'dev' | 'moderator' | 'member'>) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Neautorizovano.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Nemate dozvolu za ovu akciju.' });
    }

    next();
  };
};

export const generateToken = (
  user: { id: string; username: string; role: string; tokenVersion?: number },
  expiresIn: NonNullable<jwt.SignOptions['expiresIn']> = '7d'
) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      // F-06 — verzija sesije; `authenticate` je poredi sa `users.token_version`.
      tv: typeof user.tokenVersion === 'number' ? user.tokenVersion : 0,
    },
    JWT_SECRET,
    { expiresIn }
  );
};

/**
 * Vrednost env promenljive „kao da nije postavljena“.
 * `.env` fajl i `dotenv` ne prepisuju već postojeće promenljive, pa prazan
 * string (`SUPABASE_URL=`) ne isključuje Supabase — za test/dev režim se
 * koristi eksplicitna oznaka `memory`.
 */
/**
 * F-11 — zahtev za promenu sadržaja samo za verifikovane naloge.
 * Nalepi posle `authenticate`; admin i moderator su izuzeti (administriraju i
 * pre nego što potvrde email).
 */
export const requireVerified = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: 'Prijavite se.' });
  if (req.user.role === 'admin' || req.user.role === 'moderator') return next();

  // Provera za Mute / Timeout
  const fullUser = await db.users.findById(req.user.id);
  if (fullUser?.mutedUntil) {
    const until = new Date(fullUser.mutedUntil);
    if (until.getTime() > Date.now()) {
      return res.status(403).json({
        error: `Vaš nalog je privremeno ućutkan (mute) do ${until.toLocaleString('sr-Latn-RS')}. Ne možete objavljivati poruke ni komentare.`,
        code: 'USER_MUTED',
      });
    }
  }

  if (!req.user.isVerified) {
    return res.status(403).json({
      error: 'Potvrdite email adresu pre objavljivanja sadržaja.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }
  return next();
};
