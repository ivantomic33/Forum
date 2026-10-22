/**
 * HTTP-ONLY SESIJA (F-32)
 * -----------------------
 * JWT više ne živi u `localStorage` (bio je dostupan svakom XSS-u) — dolazi u
 * `HttpOnly` cookie-ju koji JavaScript ne može da pročita.
 *
 * Model:
 *  - `nx_at`  — access JWT (15 min), `HttpOnly`, `SameSite=Lax`, `Secure` u produkciji
 *  - `nx_rt`  — refresh token (7 dana ili 12h za „bez zapamti me“), `HttpOnly`,
 *               `Path=/api/auth`, server čuva samo SHA-256 hash
 *  - `nx_csrf` — NE HttpOnly čitljiv cookie (double-submit): klijent ga vraća u
 *               `X-CSRF-Token` zaglavlju; napadač sa drugog domena ne može da ga pročita
 *
 * Refresh rotacija: svaki `/auth/refresh` izdaje novi refresh token i poništava
 * stari. Ponovna upotreba već iskorišćenog tokena = krađa → briše se cela
 * „porodica“ sesija (sve grane rotacije).
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { db } from './store.js';
import { logger } from './logger.js';

export const ACCESS_COOKIE = 'nx_at';
export const REFRESH_COOKIE = 'nx_rt';
export const CSRF_COOKIE = 'nx_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Kratkotrajni access token; klijent ga tiho obnavlja refresh-om. */
export const ACCESS_TOKEN_TTL = '15m';
/** „Zapamti me“ i obična sesija (neaktivna sesija se ne obnavlja). */
export const REFRESH_TTL_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TTL_SESSION_MS = 12 * 60 * 60 * 1000;

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  rotatedAt?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
}

export interface RefreshSessionRepo {
  create(record: RefreshSessionRecord, tokenHash: string): Promise<void>;
  /** Traži sesiju po hashu tokena (uključujući poništene — za detekciju zloupotrebe). */
  findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  /** Rotacija: označi stari red kao iskorišćen i upiši novi. */
  rotate(oldId: string, next: RefreshSessionRecord, tokenHash: string): Promise<void>;
  revoke(id: string, reason: string): Promise<void>;
  revokeFamily(familyId: string, reason: string): Promise<void>;
  revokeAllForUser(userId: string, reason: string): Promise<void>;
  deleteExpired(now: string): Promise<number>;
}

// =====================
// TOKENI I HASH-EVI
// =====================

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/** Nasumični URL-safe token (32 bajta entropije → 43 karaktera base64url). */
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

export const refreshExpiryMs = (rememberMe: boolean): number =>
  rememberMe ? REFRESH_TTL_REMEMBER_MS : REFRESH_TTL_SESSION_MS;

const isProd = () => process.env.NODE_ENV === 'production';

const baseCookie = () => ({
  secure: isProd(),
  sameSite: 'lax' as const,
});

// =====================
// COOKIE HELPERS
// =====================

export function setSessionCookies(
  res: Response,
  opts: {
    accessToken: string;
    refreshToken: string;
    refreshExpiresAt: Date;
    csrfToken?: string;
  },
): string {
  const accessMaxAge = 15 * 60 * 1000;
  const csrfToken = opts.csrfToken ?? randomToken(24);

  res.cookie(ACCESS_COOKIE, opts.accessToken, {
    ...baseCookie(),
    httpOnly: true,
    path: '/',
    maxAge: accessMaxAge,
  });

  res.cookie(REFRESH_COOKIE, opts.refreshToken, {
    ...baseCookie(),
    httpOnly: true,
    // Refresh cookie ide samo na auth rute — ne putuje uz svaki API poziv.
    path: '/api/auth',
    expires: opts.refreshExpiresAt,
  });

  res.cookie(CSRF_COOKIE, csrfToken, {
    ...baseCookie(),
    httpOnly: false,
    path: '/',
    maxAge: Math.max(opts.refreshExpiresAt.getTime() - Date.now(), accessMaxAge),
  });

  return csrfToken;
}

export function clearSessionCookies(res: Response): void {
  const shared = { ...baseCookie(), path: '/' };
  res.clearCookie(ACCESS_COOKIE, shared);
  res.clearCookie(CSRF_COOKIE, shared);
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
}

/** Azurira samo access cookie (refresh je već rotiran). */
export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookie(),
    httpOnly: true,
    path: '/',
    maxAge: 15 * 60 * 1000,
  });
}

// =====================
// SESIJE U BAZI
// =====================

/**
 * Kreira novu refresh sesiju (familiju) za korisnika.
 * Vraća čist refresh token — postavlja se u cookie, a u bazu ide samo hash.
 */
export async function createRefreshSession(
  userId: string,
  opts: { rememberMe: boolean; req: Request },
): Promise<{ token: string; expiresAt: Date; familyId: string }> {
  const token = randomToken();
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + refreshExpiryMs(opts.rememberMe));

  await db.sessions.create(
    {
      id: crypto.randomUUID(),
      userId,
      familyId,
      expiresAt: expiresAt.toISOString(),
      userAgent: (opts.req.get('user-agent') ?? '').slice(0, 300) || null,
      ip: opts.req.ip ?? null,
      createdAt: new Date().toISOString(),
    },
    hashToken(token),
  );

  return { token, expiresAt, familyId };
}

export type RotateResult =
  | { ok: true; userId: string; token: string; expiresAt: Date; familyId: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'reused' | 'revoked' };

/**
 * Rotira refresh token. `rememberMe` se nasleđuje iz trajanja stare sesije
 * (novi TTL = isti broj milisekundi od sada).
 */
export async function rotateRefreshSession(
  presentedToken: string,
  req: Request,
): Promise<RotateResult> {
  const record = await db.sessions.findByTokenHash(hashToken(presentedToken));
  if (!record) return { ok: false, reason: 'invalid' };

  // Ponovna upotreba već rotiranog/opozvanog tokena → kompromitovana porodica.
  if (record.revokedAt || record.rotatedAt) {
    await db.sessions.revokeFamily(record.familyId, 'reuse_detected').catch((err) => {
      logger.error({ err, userId: record.userId }, 'refresh_family_revoke_failed');
    });
    logger.warn({ userId: record.userId, familyId: record.familyId }, 'refresh_token_reuse_detected');
    return { ok: false, reason: 'reused' };
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await db.sessions.revoke(record.id, 'expired').catch(() => { });
    return { ok: false, reason: 'expired' };
  }

  const token = randomToken();
  const ttl = Math.max(new Date(record.expiresAt).getTime() - new Date(record.createdAt).getTime(), 60_000);
  const expiresAt = new Date(Date.now() + ttl);

  await db.sessions.rotate(
    record.id,
    {
      id: crypto.randomUUID(),
      userId: record.userId,
      familyId: record.familyId,
      expiresAt: expiresAt.toISOString(),
      userAgent: (req.get('user-agent') ?? '').slice(0, 300) || null,
      ip: req.ip ?? null,
      createdAt: new Date().toISOString(),
    },
    hashToken(token),
  );

  return { ok: true, userId: record.userId, token, expiresAt, familyId: record.familyId };
}

export async function revokeRefreshToken(token: string, reason = 'logout'): Promise<void> {
  const record = await db.sessions.findByTokenHash(hashToken(token));
  if (record && !record.revokedAt) await db.sessions.revoke(record.id, reason);
}

export async function revokeAllSessions(userId: string, reason = 'logout_all'): Promise<void> {
  await db.sessions.revokeAllForUser(userId, reason);
}

/**
 * CSRF provera (O-04): double-submit cookie.
 * Primenjuje se na state-changing zahteve koji se oslanjaju na cookie sesiju.
 * Zahtev bez ijdnog cookie-ja (čist Bearer klijent) nije ranjiv na CSRF.
 */
export function csrfProtection(req: Request, res: Response, next: (err?: unknown) => void): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const usesCookies = Boolean(cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]);
  if (!usesCookies) return next();

  const header = req.get(CSRF_HEADER) ?? '';
  const cookie = cookies[CSRF_COOKIE] ?? '';

  // Refresh/logout su vezani za HttpOnly refresh cookie (path /api/auth), a origin
  // je već proveren CORS-om; ipak tražimo token kada postoji da bismo bili strogi.
  const valid =
    header.length > 0 && cookie.length > 0 && header.length === cookie.length &&
    crypto.timingSafeEqual(Buffer.from(header), Buffer.from(cookie));

  if (!valid) {
    res.status(403).json({ error: 'CSRF provera nije prošla. Osvežite stranicu i pokušajte ponovo.', code: 'CSRF_FAILED' });
    return;
  }
  return next();
}
