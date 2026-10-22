/**
 * OAUTH PRIJAVA / POVEZIVANJE (F-34)
 * ----------------------------------
 * Discord i Google: standardni OAuth 2.0 „authorization code“ tok.
 * Steam: OpenID 2.0 (Steam ne nudi OAuth 2.0 za korisnike).
 *
 * Bezbednosna pravila:
 *  - `state` je jednokratni, potpisan HMAC token sa TTL-om (10 min) — čuva i
 *    nameru (`login` ili `link:<userId>`) i PKCE `code_verifier` za Google.
 *  - `redirect_uri` je fiksiran na serveru (nema open redirect-a).
 *  - Greške provajdera se nikada ne prosleđuju klijentu; vodi se na
 *    `/auth/callback?error=…` sa stabilnim kodom.
 *  - Email iz provajdera se koristi za povezivanje sa postojećim nalogom SAMO
 *    ako je provajder označio email kao verifikovan.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { oauthConfig, oauthRedirectUri, type OAuthProvider, type OAuthProviderConfig } from './authConfig.js';

/**
 * Zapis provajderskog identiteta (tabela `oauth_accounts`, `server/schema-ALL.sql`).
 * Jedan korisnik može imati po jedan nalog po provajderu.
 */
export interface OAuthIdentityRecord {
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  userId: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface OAuthRepo {
  findByProvider(provider: string, providerUserId: string): Promise<OAuthIdentityRecord | null>;
  listForUser(userId: string): Promise<OAuthIdentityRecord[]>;
  link(record: OAuthIdentityRecord): Promise<void>;
  unlink(userId: string, provider: string): Promise<boolean>;
  touch(provider: string, providerUserId: string): Promise<void>;
}

const STATE_TTL_SECONDS = 10 * 60;

export interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  /** Prikazno ime kod provajdera (Discord handle, Google ime, Steam personaname). */
  providerUsername: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  avatar: string | null;
}

const jwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET nije postavljen.');
  return secret;
};

// =====================
// STATE (CSRF za OAuth + PKCE)
// =====================
export interface OAuthState {
  provider: OAuthProvider;
  mode: 'login' | 'link';
  userId?: string;
  codeVerifier?: string;
  redirect?: string;
}

export function signState(payload: OAuthState): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: STATE_TTL_SECONDS, audience: 'oauth-state' });
}

export function verifyState(raw: unknown): OAuthState | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const decoded = jwt.verify(raw, jwtSecret(), { audience: 'oauth-state' }) as jwt.JwtPayload & OAuthState;
    if (!decoded.provider) return null;
    return {
      provider: decoded.provider,
      mode: decoded.mode === 'link' ? 'link' : 'login',
      userId: decoded.userId,
      codeVerifier: decoded.codeVerifier,
      redirect: decoded.redirect,
    };
  } catch {
    return null;
  }
}

/** Dozvoljene destinacije posle prijave — samo interne putanje (bez `//evil.com`). */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) return undefined;
  return trimmed.slice(0, 300);
}

// =====================
// PKCE
// =====================
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// =====================
// URL-OVI PROVIDERA
// =====================
const SCOPES: Record<'discord' | 'google', string> = {
  discord: 'identify email',
  google: 'openid email profile',
};

export function authorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  pkce?: { challenge: string },
): string {
  const redirectUri = oauthRedirectUri(config.provider);

  if (config.provider === 'steam') {
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${redirectUri}?state=${encodeURIComponent(state)}`,
      'openid.realm': `${new URL(redirectUri).origin}/`,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return `https://steamcommunity.com/openid/login?${params.toString()}`;
  }

  if (config.provider === 'discord') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      scope: SCOPES.discord,
      redirect_uri: redirectUri,
      state,
      prompt: 'consent',
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    scope: SCOPES.google,
    redirect_uri: redirectUri,
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  if (pkce) {
    params.set('code_challenge', pkce.challenge);
    params.set('code_challenge_method', 'S256');
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// =====================
// RAZMENA KODA (OAuth 2.0)
// =====================
const httpError = (message: string) => Object.assign(new Error(message), { oauthFailed: true });

async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(`token_exchange_failed_${res.status}`);
  return data;
}

async function getJson(url: string, accessToken: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw httpError(`profile_fetch_failed_${res.status}`);
  return res.json().catch(() => ({}));
}

async function exchangeDiscord(code: string): Promise<OAuthProfile> {
  const config = oauthConfig('discord')!;
  const token = await postForm('https://discord.com/api/oauth2/token', {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirectUri('discord'),
  });
  const user = await getJson('https://discord.com/api/users/@me', String(token.access_token ?? ''));
  if (!user?.id) throw httpError('discord_profile_missing');

  const isDefaultAvatar = String(user.avatar ?? '').trim() === '';
  return {
    provider: 'discord',
    providerUserId: String(user.id),
    username: String(user.global_name || user.username || `discord_${user.id}`),
    providerUsername: String(user.username || user.global_name || `discord_${user.id}`),
    email: typeof user.email === 'string' ? user.email.toLowerCase() : null,
    emailVerified: user.verified === true,
    avatar: isDefaultAvatar || !user.avatar
      ? null
      : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`,
  };
}

async function exchangeGoogle(code: string, codeVerifier?: string): Promise<OAuthProfile> {
  const config = oauthConfig('google')!;
  const body: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirectUri('google'),
  };
  if (codeVerifier) body.code_verifier = codeVerifier;

  const token = await postForm('https://oauth2.googleapis.com/token', body);
  const user = await getJson('https://openidconnect.googleapis.com/v1/userinfo', String(token.access_token ?? ''));
  if (!user?.sub) throw httpError('google_profile_missing');

  return {
    provider: 'google',
    providerUserId: String(user.sub),
    username: String(user.name || user.email?.split('@')[0] || `google_${user.sub}`),
    providerUsername: String(user.name || user.email?.split('@')[0] || user.sub),
    email: typeof user.email === 'string' ? user.email.toLowerCase() : null,
    emailVerified: user.email_verified === true,
    avatar: typeof user.picture === 'string' ? user.picture : null,
  };
}

/**
 * Steam OpenID 2.0: parametri se vraćaju u query-ju; opsesivna provera je
 * POST na `openid.mode=check_authentication` (server-to-server).
 */
async function exchangeSteam(query: Record<string, unknown>): Promise<OAuthProfile> {
  const claimedId = String(query['openid.claimed_id'] ?? '');
  const match = claimedId.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (!match) throw httpError('steam_claimed_id_invalid');

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('openid.') && typeof value === 'string' && key !== 'openid.mode') {
      params.set(key, value);
    }
  }
  params.set('openid.mode', 'check_authentication');

  const res = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text().catch(() => '');
  if (!/is_valid\s*:\s*true/i.test(text)) throw httpError('steam_openid_invalid');

  const steamId = match[1];
  let username = `steam_${steamId}`;
  let avatar: string | null = null;

  // Opciono: profil preko Web API-ja (sprečava lažne naloge tipa `steam_123`).
  const apiKey = (process.env.STEAM_API_KEY ?? '').trim();
  if (apiKey) {
    try {
      const profile = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`,
        { signal: AbortSignal.timeout(8_000) },
      ).then((r) => r.json() as { response?: { players?: Array<{ personaname?: string; avatarfull?: string }> } });
      const player = profile?.response?.players?.[0];
      if (player?.personaname) username = String(player.personaname);
      if (typeof player?.avatarfull === 'string') avatar = player.avatarfull;
    } catch {
      // Profil nije obavezan za prijavu.
    }
  }

  return {
    provider: 'steam',
    providerUserId: steamId,
    username,
    providerUsername: username,
    email: null,
    emailVerified: false,
    avatar,
  };
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  opts: { codeVerifier?: string; query?: Record<string, unknown> } = {},
): Promise<OAuthProfile> {
  if (provider === 'discord') return exchangeDiscord(code);
  if (provider === 'google') return exchangeGoogle(code, opts.codeVerifier);
  if (provider === 'steam') return exchangeSteam(opts.query ?? {});
  throw httpError('provider_unsupported');
}

/**
 * Korisničko ime iz provajdera mora da zadovolji naša pravila (3–25, dozvoljeni
 * znakovi). Ako ne može — dodajemo sufiks; jedinstvenost rešava pozivalac.
 */
export function sanitizeOAuthUsername(raw: string): string {
  const base = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `gamer${crypto.randomInt(1000, 9999)}`;
}
