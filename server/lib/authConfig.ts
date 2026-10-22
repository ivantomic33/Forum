/**
 * KONFIGURACIJA BEZBEDNOSNIH FEATURA (2.5.4)
 * ------------------------------------------
 * Sve opcije su namerno „fail-closed“ u produkciji: ako je provajder delimično
 * podešen (npr. samo `DISCORD_CLIENT_ID` bez secret-a), server se ne podiže —
 * bolje pasti na startu nego izgubiti prijavu korisnika u toku.
 */

export type OAuthProvider = 'discord' | 'google' | 'steam';

export interface OAuthProviderConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  /** Steam koristi OpenID 2.0 (bez client secret-a). */
  openId?: boolean;
}

const trim = (value: string | undefined): string => (value ?? '').trim();

/** Turnstile site key (javni — šalje se klijentu preko `/api/auth/config`). */
export const turnstileSiteKey = (): string => trim(process.env.TURNSTILE_SITE_KEY);

/** Da li je Turnstile uključen na serveru (secret key). */
export const turnstileEnabled = (): boolean => Boolean(trim(process.env.TURNSTILE_SECRET_KEY));

/**
 * U razvoju bez `TURNSTILE_SECRET_KEY` captcha je isključena (ne blokira lokalni rad).
 * U produkciji je uključena čim postoji secret; klijent prikazuje widget samo kad
 * server javi `enabled: true` preko `/api/auth/config`.
 */
export const turnstileRequired = (): boolean =>
  turnstileEnabled() && (process.env.NODE_ENV === 'production' || process.env.TURNSTILE_ENFORCE === '1');

/** Cloudflare test key (uvek prolazi) — dokumentovan, koristi se samo u razvoju. */
export const TURNSTILE_ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA';

export const turnstileSecret = (): string =>
  turnstileEnabled() ? trim(process.env.TURNSTILE_SECRET_KEY) : TURNSTILE_ALWAYS_PASS_SECRET;

/**
 * Uključuje li KLIJENT Turnstile widget. Widget se prikazuje kada je site key
 * postavljen; server ga striktno proverava kada je `turnstileRequired` true.
 */
export const turnstileClientEnabled = (): boolean =>
  turnstileEnabled() && (process.env.NODE_ENV === 'production' || process.env.TURNSTILE_ENFORCE === '1');

/** Javni URL API-ja (OAuth redirect_uri mora da se poklapa sa registrovanim). */
export const apiPublicUrl = (): string => {
  const explicit = trim(process.env.API_PUBLIC_URL);
  if (explicit) return explicit.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 4000}`;
};

const providerConfig = (provider: OAuthProvider): OAuthProviderConfig | null => {
  if (provider === 'discord') {
    const clientId = trim(process.env.DISCORD_CLIENT_ID);
    const clientSecret = trim(process.env.DISCORD_CLIENT_SECRET);
    return clientId && clientSecret ? { provider, clientId, clientSecret } : null;
  }
  if (provider === 'google') {
    const clientId = trim(process.env.GOOGLE_CLIENT_ID);
    const clientSecret = trim(process.env.GOOGLE_CLIENT_SECRET);
    return clientId && clientSecret ? { provider, clientId, clientSecret } : null;
  }
  if (provider === 'steam') {
    // Steam OpenID 2.0: nema client secret, samo „API key“ je opcion (za profil).
    return { provider, clientId: 'steam', clientSecret: '', openId: true };
  }
  return null;
};

const ALL_PROVIDERS: OAuthProvider[] = ['discord', 'google', 'steam'];

/** Provajderi koji su stvarno konfigurisani (klijent crta samo njih). */
export const enabledOAuthProviders = (): OAuthProvider[] => {
  const steamEnabled = process.env.STEAM_OAUTH_ENABLED === '1' || Boolean(trim(process.env.STEAM_API_KEY));
  return ALL_PROVIDERS.filter((provider) => {
    if (provider === 'steam') return steamEnabled;
    return providerConfig(provider) !== null;
  });
};

export const oauthConfig = (provider: string): OAuthProviderConfig | null => {
  if (!ALL_PROVIDERS.includes(provider as OAuthProvider)) return null;
  const config = providerConfig(provider as OAuthProvider);
  if (!config) return null;
  if (provider === 'steam' && !enabledOAuthProviders().includes('steam')) return null;
  return config;
};

export const oauthRedirectUri = (provider: OAuthProvider): string =>
  `${apiPublicUrl()}/api/auth/oauth/${provider}/callback`;

/**
 * Produkcija: OAuth provajderi moraju biti ili potpuno konfigurisani ili odsutni.
 * Polovična konfiguracija je skoro uvek greška u deploy-u — ne dopuštamo je.
 */
export function assertAuthFeatureConfig(log: { error: (message: string) => void }): void {
  if (process.env.NODE_ENV !== 'production') return;

  const pairs: Array<[string, string, string]> = [
    ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'Discord'],
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'Google'],
  ];
  for (const [idKey, secretKey, label] of pairs) {
    const hasId = Boolean(trim(process.env[idKey]));
    const hasSecret = Boolean(trim(process.env[secretKey]));
    if (hasId !== hasSecret) {
      log.error(`${label} OAuth: postavite i ${idKey} i ${secretKey} (ili nijedno).`);
      process.exit(1);
    }
  }

  if (turnstileSiteKey() && !turnstileEnabled()) {
    log.error('TURNSTILE_SITE_KEY je postavljen bez TURNSTILE_SECRET_KEY — captcha ne bi radila.');
    process.exit(1);
  }

  if (trim(process.env.TOTP_ENCRYPTION_KEY) && trim(process.env.TOTP_ENCRYPTION_KEY).length < 32) {
    log.error('TOTP_ENCRYPTION_KEY mora imati najmanje 32 karaktera.');
    process.exit(1);
  }
}
