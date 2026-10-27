/**
 * F-34 — OAUTH PRIJAVA I POVEZIVANJE
 * ----------------------------------
 * Rute (montirane pod `/api/auth/oauth`):
 *   GET  /:provider            → redirect na provajdera (login ili link)
 *   GET  /:provider/callback   → razmena koda, povezivanje/registracija, redirect na SPA
 *   GET  /accounts             → povezani OAuth identiteti trenutnog korisnika
 *   DELETE /accounts/:provider → otkači OAuth nalog (ostaje drugi način prijave)
 *
 * Poseban tok za nove korisnike:
 *   Steam ne daje email, a Discord/Google email može biti već zauzet drugim
 *   NEXUS nalogom. U tim slučajevima se ne pravi nalog „u ime“ korisnika, već
 *   se vraća kratkotrajni `signupTicket` i na `/auth/complete-signup` korisnik
 *   bira korisničko ime (i prihvata uslove).
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db, xpForLevel, type UserRecord } from '../lib/store.js';
import { authenticate, generateToken, type AuthRequest } from '../middleware/auth.js';
import { appUrl } from '../lib/email.js';import { logger } from '../lib/logger.js';
import { isDisposableEmail, validateUsername } from '../lib/validation.js';
import { ownerUser } from '../lib/userShape.js';
import { getPublicSiteSettings } from './admin.js';
import { TERMS_VERSION } from './auth.js';import {
  ACCESS_TOKEN_TTL,
  ACCESS_COOKIE,
  createRefreshSession,
  setSessionCookies,
} from '../lib/sessions.js';
import { oauthConfig, oauthRedirectUri, type OAuthProvider } from '../lib/authConfig.js';
import { markSignedIn } from '../lib/presence.js';
import {
  authorizationUrl,
  createPkce,
  exchangeCode,
  safeRedirect,
  sanitizeOAuthUsername,
  signState,
  verifyState,
  type OAuthIdentityRecord,
  type OAuthProfile,
} from '../lib/oauth.js';

const router = Router();

const clientBase = (): string => appUrl().replace(/\/$/, '');

/** Redirect na SPA sa stabilnim kodom greške (bez detalja provajdera). */
function failRedirect(res: any, code: string, extra: Record<string, string> = {}): void {
  const params = new URLSearchParams({ error: code, ...extra });
  res.redirect(302, `${clientBase()}/auth/callback?${params.toString()}`);
}

/** Novi nalog iz OAuth profila: slobodno korisničko ime, bez lozinke (password login onemogućen). */
async function uniqueUsername(desired: string): Promise<string> {
  const base = sanitizeOAuthUsername(desired);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 18)}${attempt + 1}`;
    const existing = await db.users.findByUsername(candidate);
    if (!existing) return candidate;
  }
  return `${base.slice(0, 12)}${Date.now().toString(36).slice(-6)}`;
}

async function createOAuthUser(profile: OAuthProfile, username: string): Promise<UserRecord> {
  const now = new Date().toISOString();
  return db.users.create({
    id: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    username,
    email: profile.email ?? `${profile.provider}_${profile.providerUserId}@users.nexus.invalid`,
    // Nema lozinke: bcrypt.compare sa praznim hash-om nikada ne prolazi.
    password: '',
    avatar:
      profile.avatar ??
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`,
    bio: 'Novi član NEXUS gejming zajednice.',
    role: 'member',
    level: 1,
    xp: 0,
    xpNeeded: xpForLevel(1),
    karma: 0,
    badges: [],
    connectedAccounts: { [profile.provider]: profile.providerUsername ?? profile.providerUserId },
    // Email iz Discord/Google je verifikovan od provajdera → nalog je verifikovan.
    isVerified: profile.emailVerified,
    isBanned: false,
    status: 'online',
    tokenVersion: 0,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: now,
    createdAt: now,
    lastSeenAt: now,
  });
}

/** Tiket za dovršavanje registracije (5 min) — ne sadrži ništa osetljivo osim ID-ja profila. */
interface SignupTicket {
  provider: OAuthProvider;
  providerUserId: string;
  providerUsername: string | null;
  email: string | null;
  emailVerified: boolean;
  avatar: string | null;
}

function issueSignupTicket(ticket: SignupTicket): string {
  return jwt.sign(ticket, process.env.JWT_SECRET!, { expiresIn: '10m', audience: 'oauth-signup' });
}

function readSignupTicket(raw: unknown): SignupTicket | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return jwt.verify(raw, process.env.JWT_SECRET!, { audience: 'oauth-signup' }) as SignupTicket;
  } catch {
    return null;
  }
}

/** Zajednički završetak prijave: sesija + redirect na SPA. */
async function completeLogin(req: any, res: any, user: UserRecord, redirect: string | undefined) {
  const token = generateToken(
    { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    ACCESS_TOKEN_TTL,
  );
  const refresh = await createRefreshSession(user.id, { rememberMe: true, req });
  setSessionCookies(res, {
    accessToken: token,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  });

  await db.users.update(user.id, { status: 'online', lastSeenAt: new Date().toISOString() }).catch(() => {});
  // B-15 — isto kao lozinka: `users.status` je keš, prisustvo je `user_presence`.
  await markSignedIn(user);
  const target = safeRedirect(redirect) ?? '/';
  res.redirect(302, `${clientBase()}/auth/callback?ok=1&next=${encodeURIComponent(target)}`);
}

// =====================
// GET /api/auth/oauth/:provider
// =====================
router.get('/:provider', async (req, res) => {
  const provider = String(req.params.provider) as OAuthProvider;
  const config = oauthConfig(provider);
  if (!config) {
    return failRedirect(res, 'provider_disabled');
  }

  // Povezivanje zahteva aktivnu sesiju (identifikujemo korisnika iz access cookie-ja).
  const wantsLink = req.query.mode === 'link';
  let linkUserId: string | undefined;
  if (wantsLink) {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    try {
      const decoded = jwt.verify(token ?? '', process.env.JWT_SECRET!) as { id?: string };
      linkUserId = decoded.id;
    } catch {
      linkUserId = undefined;
    }
    if (!linkUserId) return failRedirect(res, 'link_requires_login');
  }

  const redirect = safeRedirect(req.query.redirect);
  const pkce = provider === 'google' ? createPkce() : undefined;
  const state = signState({
    provider,
    mode: wantsLink ? 'link' : 'login',
    userId: linkUserId,
    codeVerifier: pkce?.verifier,
    redirect,
  });

  res.redirect(302, authorizationUrl(config, state, pkce));
});

// =====================
// GET /api/auth/oauth/:provider/callback
// =====================
router.get('/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider) as OAuthProvider;
  const config = oauthConfig(provider);
  if (!config) return failRedirect(res, 'provider_disabled');

  // Steam vraća `state` unutar `openid.return_to`, ostali u `state`.
  let rawState = req.query.state;
  if (!rawState && typeof req.query['openid.return_to'] === 'string') {
    try {
      rawState = new URL(String(req.query['openid.return_to'])).searchParams.get('state') ?? undefined;
    } catch {
      rawState = undefined;
    }
  }

  const state = verifyState(rawState);
  if (!state || state.provider !== provider) {
    return failRedirect(res, 'invalid_state');
  }

  // Korisnik je odbio pristup ili provajder javlja grešku.
  if (req.query.error) {
    req.log?.info({ provider, error: req.query.error }, 'oauth_provider_error');
    return failRedirect(res, state.mode === 'link' ? 'link_cancelled' : 'cancelled');
  }

  try {
    const profile = await exchangeCode(provider, String(req.query.code ?? ''), {
      codeVerifier: state.codeVerifier,
      query: req.query as Record<string, unknown>,
    });

    // ---------- POVEZIVANJE SA POSTOJEĆIM NALOGOM ----------
    if (state.mode === 'link' && state.userId) {
      const user = await db.users.findById(state.userId);
      if (!user) return failRedirect(res, 'link_requires_login');

      const taken = await db.oauth.findByProvider(provider, profile.providerUserId);
      if (taken && taken.userId !== user.id) return failRedirect(res, 'already_linked_elsewhere');

      // Isti provajder se ne može povezati na dva načina — stariji link se zamenjuje.
      await db.oauth.link({
        provider,
        providerUserId: profile.providerUserId,
        providerUsername: profile.providerUsername ?? profile.username,
        userId: user.id,
      });
      const connectedAccounts = {
        ...(user.connectedAccounts ?? {}),
        [provider]: profile.providerUsername ?? profile.providerUserId,
      };
      await db.users.update(user.id, { connectedAccounts }).catch(() => {});
      await db.users.setConnectedAccount(user.id, provider, profile.providerUsername ?? profile.providerUserId).catch(() => {});

      return res.redirect(
        302,
        `${clientBase()}/profile/${encodeURIComponent(user.username)}?oauth=linked&provider=${provider}`,
      );
    }


    // ---------- PRIJAVA ----------
    const identity = await db.oauth.findByProvider(provider, profile.providerUserId);
    if (identity) {
      const user = await db.users.findById(identity.userId);
      if (!user) return failRedirect(res, 'account_not_found');
      if (user.isBanned) return failRedirect(res, 'account_suspended');
      await db.oauth.touch(provider, profile.providerUserId).catch(() => {});
      return completeLogin(req, res, user, state.redirect);
    }

    // Postojeći nalog sa istim (verifikovanim) email-om — poveži, ne pravi duplikat.
    if (profile.email && profile.emailVerified) {
      const existing = await db.users.findByEmail(profile.email);
      if (existing) {
        await db.oauth.link({
          provider,
          providerUserId: profile.providerUserId,
          providerUsername: profile.providerUsername ?? profile.username,
          userId: existing.id,
        });
        const connectedAccounts = { ...(existing.connectedAccounts ?? {}), [provider]: profile.username };
        await db.users.update(existing.id, { connectedAccounts }).catch(() => {});
        if (existing.isBanned) return failRedirect(res, 'account_suspended');
        return completeLogin(req, res, existing, state.redirect);
      }
    }

    // ---------- NOVI KORISNIK ----------
    if (!getPublicSiteSettings().registrationOpen) {
      return failRedirect(res, 'registration_closed');
    }

    // Steam nema email → korisnik mora da izabere ime. Discord/Google takođe idu
    // kroz izbor imena kako ne bismo pravili nalog bez saglasnosti sa uslovima.
    const suggested = await uniqueUsername(profile.username);
    const ticket = issueSignupTicket({
      provider,
      providerUserId: profile.providerUserId,
      providerUsername: profile.providerUsername ?? profile.username,
      email: profile.email,
      emailVerified: profile.emailVerified,
      avatar: profile.avatar,
    });
    const params = new URLSearchParams({
      ticket,
      suggested,
      provider,
      email: profile.email ?? '',
    });
    return res.redirect(302, `${clientBase()}/auth/complete-signup?${params.toString()}`);
  } catch (error: any) {
    req.log?.error({ err: error, provider }, 'oauth_callback_failed');
    logger.warn({ provider, message: error?.message }, 'oauth_callback_failed');
    return failRedirect(res, 'provider_error');
  }
});

// =====================
// POST /api/auth/oauth/complete-signup
// =====================
router.post('/complete-signup', async (req, res) => {
  try {
    const ticket = readSignupTicket(req.body?.ticket);
    if (!ticket) {
      return res.status(401).json({ error: 'Registracija je istekla. Pokušajte ponovo.', code: 'SIGNUP_EXPIRED' });
    }
    if (req.body?.acceptedTerms !== true) {
      return res.status(400).json({ error: 'Morate prihvatiti uslove korišćenja i politiku privatnosti.' });
    }
    if (req.body?.ageConfirmed !== true) {
      return res.status(400).json({ error: 'Potvrdite da imate najmanje 15 godina.' });
    }
    if (!getPublicSiteSettings().registrationOpen) {
      return res.status(403).json({ error: 'Registracija novih naloga je trenutno onemogućena.' });
    }

    // Ponovni poziv posle uspešne prijave ne sme da napravi drugi nalog.
    const already = await db.oauth.findByProvider(ticket.provider, ticket.providerUserId);
    if (already) {
      return res.status(409).json({ error: 'Ovaj nalog je već povezan. Prijavite se.', code: 'ALREADY_LINKED' });
    }

    const username = String(req.body?.username ?? '').trim();
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError, field: 'username' });
    if (await db.users.findByUsername(username)) {
      return res.status(409).json({ error: 'Korisničko ime je već zauzeto.', field: 'username' });
    }

    if (ticket.email) {
      if (isDisposableEmail(ticket.email)) {
        return res.status(400).json({ error: 'Privremene (temp) email adrese nisu dozvoljene.', field: 'email' });
      }
      if (await db.users.findByEmail(ticket.email)) {
        return res.status(409).json({ error: 'Email adresa je već registrovana.', field: 'email' });
      }
    }

    const user = await createOAuthUser(
      {
        provider: ticket.provider,
        providerUserId: ticket.providerUserId,
        providerUsername: ticket.providerUsername ?? ticket.providerUserId,
        username,
        email: ticket.email,
        emailVerified: ticket.emailVerified,
        avatar: ticket.avatar,
      },
      username,
    );

    await db.oauth.link({
      provider: ticket.provider,
      providerUserId: ticket.providerUserId,
      providerUsername: ticket.providerUsername,
      userId: user.id,
      lastLoginAt: new Date().toISOString(),
    });

    const token = generateToken(
      { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
      ACCESS_TOKEN_TTL,
    );
    const refresh = await createRefreshSession(user.id, { rememberMe: true, req });
    const csrfToken = setSessionCookies(res, {
      accessToken: token,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    });

    req.log?.info({ userId: user.id, provider: ticket.provider }, 'oauth_signup_completed');
    res.status(201).json({ user: ownerUser(user), csrfToken });
  } catch (error: any) {
    req.log?.error({ err: error }, 'oauth_signup_failed');
    res.status(500).json({ error: 'Registracija nije uspela. Pokušajte ponovo.' });
  }
});

// =====================
// GET /api/auth/oauth/accounts — povezani identiteti
// =====================
router.get('/accounts', authenticate, async (req: AuthRequest, res) => {
  try {
    const linked = await db.oauth.listForUser(req.user!.id).catch(() => []);
    res.json({
      accounts: (linked as OAuthIdentityRecord[]).map((entry) => ({
        provider: entry.provider,
        username: entry.providerUsername,
        linkedAt: entry.createdAt ?? null,
      })),
    });
  } catch (err) {
    req.log?.error({ err }, 'oauth_accounts_failed');
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

// =====================
// DELETE /api/auth/oauth/accounts/:provider — otkači
// =====================
router.delete('/accounts/:provider', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const provider = String(req.params.provider);
    const linked = await db.oauth.listForUser(user.id).catch(() => []);
    const isLastLoginMethod = !user.password && linked.length <= 1;
    if (!user.password && isLastLoginMethod) {
      return res.status(409).json({
        error: 'Ovo je jedini način prijave na nalog. Prvo postavite lozinku.',
        code: 'LAST_LOGIN_METHOD',
      });
    }

    const removed = await db.oauth.unlink(user.id, provider).catch(() => false);
    if (!removed) return res.status(404).json({ error: 'Nalog nije povezan.' });

    const connectedAccounts = { ...(user.connectedAccounts ?? {}) };
    delete connectedAccounts[provider];
    await db.users.update(user.id, { connectedAccounts }).catch(() => {});

    // Access token ostaje isti (`tv` nije menjan); refresh cookie ostaje kao je.
    res.json({ message: `Nalog za ${provider} je otkačen.`, connectedAccounts });
  } catch (err) {
    req.log?.error({ err }, 'oauth_unlink_failed');
    res.status(500).json({ error: 'Otkačivanje nije uspelo.' });
  }
});

export default router;
export { oauthRedirectUri };
