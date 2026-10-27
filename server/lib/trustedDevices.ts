/**
 * F-15 — TRUSTED DEVICE ZA 2FA („zapamti ovaj uređaj 30 dana“)
 * -------------------------------------------------------------
 * Bez ovoga korisnik sa uključenom 2FA unosi kod pri svakoj prijavi — najčešći
 * razlog zašto ljudi isključe 2FA. Model:
 *
 *  1. Na `POST /2fa/login` sa `trustDevice: true` (ili pri uključivanju 2FA) server
 *     izdaje NASUMIČNI token (32 bajta, base64url) → cookie `nx_trust`
 *     (HttpOnly, 30 dana), a u bazu ide samo SHA-256 hash + `device_id`.
 *  2. Uz cookie ide i `device_id` (javni, čitljiv cookie `nx_dev`): služi samo da
 *     se prepozna ISTI uređaj, nikad kao dokaz. Dokaz je `token_hash`.
 *  3. Pri sledećoj prijavi `POST /login` vidi cookie, poredi hash i, ako uređaj
 *     nije istekao, preskače TOTP korak. Token se pritom ROTIRA (nov hash, nov
 *     cookie) — ukraden cookie važi najviše do sledeće uspešne prijave.
 *  4. Važenje se produžava na 30 dana pri svakoj uspešnoj prijavi sa uređaja.
 *
 * Bezbednosna pravila:
 *  - isključivanje 2FA (`/2fa/disable`), promena/reset lozinke i `DELETE /2fa/devices`
 *    brišu uređaje — inače bi „trusted“ nadživeo upravo radnju kojom se 2FA skida;
 *  - `trustDevice` bez tačnog koda ne izdaje cookie (čeka drugi korak);
 *  - bez tabele (`schema-ALL.sql` nije pušten) prijava i dalje radi: uređaj se
 *    prosto ne pamti, a greška se loguje kao `debug` (nikad ne obara login).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { db, TRUSTED_DEVICE_TTL_MS } from './store.js';
import { logger } from './logger.js';
import { isProduction } from './http.js';

export const TRUST_COOKIE = 'nx_trust';
export const DEVICE_COOKIE = 'nx_dev';
export const TRUST_TTL_MS = TRUSTED_DEVICE_TTL_MS;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const baseCookie = () => ({ secure: isProduction(), sameSite: 'lax' as const });

const readCookie = (req: Request, name: string): string | null => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  return cookies[name] ?? null;
};

/** Javni ID uređaja — isti uređaj se prepoznaje po njemu, ali nije dokaz. */
export function deviceIdFrom(req: Request): string | null {
  const id = readCookie(req, DEVICE_COOKIE);
  return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

export function setDeviceCookie(res: Response, deviceId: string): void {
  res.cookie(DEVICE_COOKIE, deviceId, {
    ...baseCookie(),
    httpOnly: false,
    path: '/',
    maxAge: TRUST_TTL_MS,
  });
}

export function clearTrustCookies(res: Response): void {
  res.clearCookie(TRUST_COOKIE, { ...baseCookie(), httpOnly: true, path: '/' });
  res.clearCookie(DEVICE_COOKIE, { ...baseCookie(), path: '/' });
}

/**
 * Proverava da li je uređaj iz cookie-ja trusted za korisnika.
 *
 * `true` znači „2FA korak se preskače“. Nikad ne baca — greška baze se tretira
 * kao „nije trusted“ (korisnik unese kod, što je bezbednija strana greške).
 */
export async function isTrustedDevice(req: Request, userId: string, userAgent?: string | null): Promise<boolean> {
  const token = readCookie(req, TRUST_COOKIE);
  const deviceId = deviceIdFrom(req);
  if (!token || !deviceId) return false;
  try {
    return await db.trustedDevices.isTrusted(userId, deviceId, hashToken(token), userAgent);
  } catch (error) {
    logger.debug({ err: error, userId }, 'trusted_device_check_failed');
    return false;
  }
}

/**
 * Upisuje/obnavlja trusted uređaj i postavlja cookie.
 *
 * Vraća `false` kada baza nema tabelu — pozivalac tada ne sme da tvrdi da je
 * uređaj zapamćen.
 */
export async function rememberDevice(
  res: Response,
  userId: string,
  userAgent?: string | null,
  existingDeviceId?: string | null,
): Promise<boolean> {
  const deviceId = existingDeviceId ?? randomBytes(18).toString('base64url');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TRUST_TTL_MS).toISOString();

  try {
    await db.trustedDevices.save({
      userId,
      deviceId,
      tokenHash: hashToken(token),
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt,
    });
  } catch (error) {
    logger.warn({ err: error, userId }, 'trusted_device_save_failed');
    return false;
  }

  res.cookie(TRUST_COOKIE, token, {
    ...baseCookie(),
    httpOnly: true,
    path: '/',
    expires: new Date(expiresAt),
  });
  setDeviceCookie(res, deviceId);
  return true;
}

/** „Odjavi sve trusted uređaje“ i pri isključivanju 2FA / resetu lozinke. */
export async function forgetAllDevices(userId: string, res?: Response): Promise<number> {
  if (res) clearTrustCookies(res);
  try {
    return await db.trustedDevices.deleteByUser(userId);
  } catch (error) {
    logger.warn({ err: error, userId }, 'trusted_device_delete_failed');
    return 0;
  }
}

/** Lista uređaja za profil (bez hash-eva i tokena). */
export async function listDevices(userId: string) {
  try {
    return await db.trustedDevices.list(userId);
  } catch (error) {
    logger.debug({ err: error, userId }, 'trusted_device_list_failed');
    return [];
  }
}
