/**
 * 5.2 — PREVOD GREŠAKA AUTENTIFIKACIJE U RADNJU
 * ---------------------------------------------
 * Server vraća `code` za slučajeve koje UI može konkretno da reši (OAuth nalog
 * bez lozinke, rate limit, ban, istekao 2FA tiket). Bez ovoga svaka greška
 * izgleda isto („Pogrešan email ili lozinka“), pa korisnik ne zna šta dalje.
 */

export type AuthErrorAction =
  /** Nalog postoji samo preko OAuth-a — vodi na provajder. */
  | { kind: 'use-oauth'; provider?: string }
  /** Previše pokušaja — sačekaj (sekunde ako ih server zna). */
  | { kind: 'rate-limited'; retryAfter: number | null }
  /** Ban sa datumom isteka i/ili razlogom. */
  | { kind: 'banned'; until: string | null; reason: string | null }
  /** 2FA tiket je istekao — vrati na korak lozinke. */
  | { kind: 'mfa-expired' }
  /** Nalog ne postoji — ponudi registraciju sa istim email-om. */
  | { kind: 'no-account' }
  /** Ostalo: samo poruka. */
  | { kind: 'message' };

export interface AuthErrorInfo {
  message: string;
  action: AuthErrorAction;
}

interface RawError {
  status?: number;
  code?: string;
  message?: string;
  banExpiresAt?: string | null;
  banReason?: string | null;
  retryAfter?: number;
}

/** Poruke koje server šalje za OAuth-only nalog (`server/routes/auth.ts`). */
const OAUTH_HINTS = [
  'preko oauth',
  'oauth',
  'discord',
  'google',
  'steam',
];

/**
 * Mapira grešku sa servera (`status`, `code`, `message`) u UI odluku.
 * Ne izmišlja tekst za server: ako `message` postoji, on ide korisniku.
 */
export function describeAuthError(error: unknown, fallback: string): AuthErrorInfo {
  const err = (error ?? {}) as RawError;
  const message = err.message || fallback;
  const lower = message.toLowerCase();

  if (err.code === 'OAUTH_ONLY_ACCOUNT' || OAUTH_HINTS.some((hint) => lower.includes(hint) && lower.includes('lozink'))) {
    const provider = ['discord', 'google', 'steam'].find((name) => lower.includes(name));
    return { message, action: { kind: 'use-oauth', provider } };
  }

  if (err.status === 429 || err.code === 'RATE_LIMITED' || err.code === 'RESEND_COOLDOWN') {
    return { message, action: { kind: 'rate-limited', retryAfter: err.retryAfter ?? null } };
  }

  if (err.status === 403 && (err.code === 'BAN_ACTIVE' || err.banExpiresAt !== undefined)) {
    return { message, action: { kind: 'banned', until: err.banExpiresAt ?? null, reason: err.banReason ?? null } };
  }

  if (err.code === 'MFA_TICKET_INVALID') {
    return { message, action: { kind: 'mfa-expired' } };
  }

  // 401 na prijavi bez dodatnog koda: server namerno ne kaže da li nalog postoji,
  // ali UI sme da ponudi registraciju — to je akcija bez otkrivanja informacija.
  if (err.status === 401 && !err.code) {
    return { message, action: { kind: 'no-account' } };
  }

  return { message, action: { kind: 'message' } };
}

/** `2026-10-26T10:00:00Z` → „26.10. u 12:00“ (lokalno vreme). */
export function formatBanExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('sr-RS', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
