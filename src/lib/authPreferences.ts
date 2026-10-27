/**
 * 5.4 — PAMĆENJE IZBORA NA AUTH STRANI
 * -------------------------------------
 * Male, nekritične stvari koje ne smeju da budu cookie: izbor „zapamti me“ i
 * poslednji uspešan način prijave. Sesija ostaje isključivo u HttpOnly cookie-ju
 * (F-32) — ovde nema nijedne tajne, samo korisnički preferens.
 *
 * `localStorage` može da baci (privatni režim, zabranjen storage) — svaki pristup
 * je u `try/catch`, a pad znači samo „nema pamćenja“, nikad rušenje forme.
 */

export type LoginMethod = 'password' | 'passkey' | 'discord' | 'google' | 'steam';

export interface AuthPreferences {
  rememberMe: boolean;
  lastLogin: {
    method: LoginMethod;
    /** Username za prefill/hint (nije tajna). */
    username?: string;
    at: string;
  } | null;
}

const STORAGE_KEY = 'nexus.auth.v1';

export const DEFAULT_AUTH_PREFERENCES: AuthPreferences = { rememberMe: true, lastLogin: null };

/** `auth:last` iz brisanja sesije: posle odjave „zapamti me“ i dalje važi. */
export function loadAuthPreferences(): AuthPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTH_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<AuthPreferences>;
    const method = parsed.lastLogin?.method;
    const validMethods: LoginMethod[] = ['password', 'passkey', 'discord', 'google', 'steam'];
    return {
      rememberMe: parsed.rememberMe !== false,
      lastLogin:
        parsed.lastLogin && method && validMethods.includes(method)
          ? {
            method,
            username: typeof parsed.lastLogin.username === 'string' ? parsed.lastLogin.username : undefined,
            at: typeof parsed.lastLogin.at === 'string' ? parsed.lastLogin.at : new Date().toISOString(),
          }
          : null,
    };
  } catch {
    return { ...DEFAULT_AUTH_PREFERENCES };
  }
}

export function saveAuthPreferences(next: AuthPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage nedostupan — preferens se ne pamti, aplikacija radi isto.
  }
}

/** Beleži uspešan način prijave (za hint „prošli put ste ušli preko Discord-a“). */
export function rememberLastLogin(method: LoginMethod, username?: string): AuthPreferences['lastLogin'] {
  const next: AuthPreferences = {
    ...loadAuthPreferences(),
    lastLogin: { method, username, at: new Date().toISOString() },
  };
  saveAuthPreferences(next);
  return next.lastLogin;
}

/** 5.5 — ime OAuth provajdera za UI. */
export function providerLabel(provider: string): string {
  switch (provider) {
    case 'discord':
      return 'Discord';
    case 'google':
      return 'Google';
    case 'steam':
      return 'Steam';
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

/** 5.5 — poruka hint-a: „Prošli put ste ušli preko …“. */
export function lastLoginHint(prefs: AuthPreferences): string | null {
  if (!prefs.lastLogin) return null;
  if (prefs.lastLogin.method === 'passkey') return 'Prošli put ste ušli pomoću passkey-a — možete isto i sada.';
  if (prefs.lastLogin.method === 'password') return null;
  return `Prošli put ste ušli preko ${providerLabel(prefs.lastLogin.method)}.`;
}

/** 5.5 — da li je poslednja prijava bila OAuth (formu skrivamo iza dugmeta). */
export function lastLoginWasOAuth(prefs: AuthPreferences): boolean {
  return prefs.lastLogin?.method === 'discord' || prefs.lastLogin?.method === 'google' || prefs.lastLogin?.method === 'steam';
}
