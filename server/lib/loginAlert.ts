/**
 * 6.x — PRIJAVA SA NOVOG UREĐAJA/IP-a (in-app)
 * ------------------------------------------
 * Mejl za „nova prijava“ je ugašen (mejl samo za verifikaciju i reset lozinke),
 * ali bezbednosni signal ostaje: u inbox stiže `warning` notifikacija sa
 * uređajem, IP adresom i vremenom, a link vodi na sesije gde postoji
 * „Odjavi sve uređaje“ (dugme „Nisam ja“).
 *
 * Pravila protiv šuma (isto kao kod ugašenog mejla):
 *  - prva sesija ikada ne pravi notifikaciju (korisnik upravo potvrđuje nalog),
 *  - isti `userAgent + ip` par se ne ponavlja 24 h — novi tab ili novi dan nisu
 *    „nova prijava“.
 */

import { db } from './store.js';
import { logger } from './logger.js';
import { notify } from './notifications.js';

/** 24 h — isti uređaj/IP ne pravi drugu notifikaciju u tom periodu. */
export const LOGIN_ALERT_TTL_MS = 24 * 60 * 60 * 1000;

const sentKeys = new Map<string, number>();

/** Kratak, čitljiv opis uređaja iz `User-Agent` (bez biblioteke). */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? '');
  if (!ua) return 'Nepoznat uređaj';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Nepoznat OS';
  return `${browser} na ${os}`;
}

export interface LoginAlertInput {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
  /** Aktivne sesije PRE nove prijave (za „prva prijava ikada“). */
  knownBefore?: Array<{ userAgent: string | null; ip: string | null }>;
}

/**
 * Napravi in-app obaveštenje o novoj prijavi. Nikad ne baca i nikad ne
 * blokira prijavu. Vraća `true` kada je notifikacija zaista upisana.
 */
export async function sendLoginAlert(input: LoginAlertInput): Promise<boolean> {
  try {
    const userAgent = (input.userAgent ?? '').slice(0, 160) || null;
    const ip = input.ip ?? null;
    const known = input.knownBefore ?? [];

    // Prva sesija ikada (ili nijedna poznata) — nema šta da se javlja.
    if (known.length === 0) return false;
    if (known.some((row) => row.userAgent === userAgent && row.ip === ip)) return false;

    const key = `${input.userId}:${userAgent}:${ip}`;
    const now = Date.now();
    const previous = sentKeys.get(key) ?? 0;
    if (now - previous < LOGIN_ALERT_TTL_MS) return false;

    const user = await db.users.findById(input.userId).catch(() => null);
    if (!user || user.isBanned) return false;

    sentKeys.set(key, now);
    if (sentKeys.size > 5_000) {
      for (const [entry, at] of sentKeys) if (now - at > LOGIN_ALERT_TTL_MS) sentKeys.delete(entry);
    }

    const ipChanged = !known.some((row) => row.ip === ip);
    const device = describeDevice(userAgent);
    const when = new Date().toLocaleString('sr-Latn-RS');

    const created = await notify({
      userId: input.userId,
      type: 'warning',
      title: 'Nova prijava na tvoj nalog',
      message:
        `${device}${ip ? ` · IP ${ip}` : ''} · ${when}. ` +
        (ipChanged ? 'Prijava je sa nove IP adrese. ' : '') +
        'Ako to nisi bio ti, odmah odjavi sve uređaje i promeni lozinku.',
      // „Nisam ja“ je akcija u profilu → modal → tab Bezbednost (sesije).
      link: '/profile?settings=security',
      actorId: null,
      metadata: {
        security: 'new_login',
        device,
        ip,
        ipChanged,
        userAgent,
        at: new Date().toISOString(),
      },
    });
    return Boolean(created);
  } catch (error) {
    // Signal je dodatak; prijava je već uspela.
    logger.warn({ err: error, userId: input.userId }, 'login_alert_failed');
    return false;
  }
}

/** Za testove: očisti keš 24 h markera. */
export function __resetLoginAlerts() {
  sentKeys.clear();
}
