import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, xpForLevel } from '../lib/store.js';
import { authenticate, generateToken, type AuthRequest } from '../middleware/auth.js';
import { sanitizeRichText } from '../middleware/sanitize.js';
import {
  validateUsername,
  validateEmail,
  isPasswordValid,
  passwordError,
  getPasswordChecks,
  isDisposableEmail,
  BCRYPT_COST,
} from '../lib/validation.js';
import { createActionToken, consumeActionToken, peekActionToken } from '../lib/actionTokens.js';
import { sendVerificationEmail, sendPasswordResetEmail, emailConfigured, appUrl } from '../lib/email.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, mfaLoginSchema, totpDisableSchema, validate } from '../lib/schemas.js';
import { AppError } from '../lib/http.js';
import { devTokensExposed } from '../lib/env.js';
import { ownerUser } from '../lib/userShape.js';
import { getPublicSiteSettings } from './admin.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_TOKEN_TTL,
  clearSessionCookies,
  createRefreshSession,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshSession,
  setAccessCookie,
  setSessionCookies,
} from '../lib/sessions.js';
import {
  decryptSecret,
  encryptSecret,
  clearEnrollment,
  generateRecoveryCodes,
  isLocked,
  lockUntilIso,
  markTotpUsed,
  matchRecoveryCode,
  pendingSecret,
  resetTotpFailures,
  shouldLockAfterFailure,
  startEnrollment,
  totpQrDataUrl,
  totpUri,
  verifyTotpCode,
} from '../lib/totp.js';
import {
  oauthConfig,
  turnstileSiteKey,
  turnstileClientEnabled,
  enabledOAuthProviders,
} from '../lib/authConfig.js';
import { signState, verifyState, authorizationUrl, createPkce, safeRedirect } from '../lib/oauth.js';
import { turnstileMiddleware } from '../middleware/turnstile.js';
import { setPresence, isUserOnline, presenceMap } from '../lib/presence.js';
import type { UserRecord } from '../lib/store.js';

const router = Router();

/**
 * Poruka za klijenta bez odavanja da li nalog postoji.
 * (Verifikacija/reset vraćaju isti odgovor za postojeći i nepostojeći email.)
 */
const GENERIC_EMAIL_MESSAGE = 'Ako nalog sa tom adresom postoji, poslali smo vam email sa daljim koracima.';

/**
 * F-21 — verzija uslova korišćenja koja se beleži pri registraciji.
 * Menja se kada se tekst uslova izmeni; stari nalozi zadržavaju verziju sa kojom
 * su se saglasili. Konačan tekst i minimalni uzrast mora da potvrdi pravnik.
 */
export const TERMS_VERSION = '2026-10-20';

// =====================
// SESIJA: helperi
// =====================

/**
 * Izdaje access JWT (u HttpOnly cookie) + refresh sesiju i vraća telo odgovora.
 * JWT se NE vraća u telu: XSS ga ne može pročitati iz cookie-ja.
 */
async function establishSession(
  req: AuthRequest,
  res: any,
  user: UserRecord,
  opts: { rememberMe: boolean },
): Promise<{ csrfToken: string; sessionExpiresAt: string }> {
  const token = generateToken(
    { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    ACCESS_TOKEN_TTL,
  );
  const refresh = await createRefreshSession(user.id, { rememberMe: opts.rememberMe, req });
  const csrfToken = setSessionCookies(res, {
    accessToken: token,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  });
  return { csrfToken, sessionExpiresAt: refresh.expiresAt.toISOString() };
}

/**
 * 2FA izazov posle tačne lozinke: kratkotrajni jednokratni tiket umesto sesije.
 * `mfa` u payload-u sprečava da se tiket koristi kao regularan access token
 * (već i `authenticate` odbija tokene bez `id`, a ovaj ima samo `sub`).
 */
function issueMfaTicket(user: UserRecord): string {
  return jwt.sign({ sub: user.id, mfa: 'pending' }, process.env.JWT_SECRET!, {
    expiresIn: '5m',
    audience: 'mfa-challenge',
  });
}

function readMfaTicket(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const decoded = jwt.verify(raw, process.env.JWT_SECRET!, { audience: 'mfa-challenge' }) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

/** Ban provera posle lozinke: `bans` tabela je izvor istine za istek. */
async function activeBanFor(user: UserRecord) {
  if (!user.isBanned) return null;
  const activeBan = await db.bans.findActive(user.id);
  if (activeBan) return activeBan;
  await db.users.update(user.id, { isBanned: false }).catch(() => {});
  await db.bans.lift(user.id).catch(() => {});
  user.isBanned = false;
  return null;
}

/** Metapodaci preporučeni za uparivanje sa OAuth/ticketom (ne otkrivaju tajne). */
function mfaMetadata(user: UserRecord) {
  return {
    username: user.username,
    avatar: user.avatar,
    recoveryCodesLeft: Array.isArray(user.totpRecoveryCodes) ? user.totpRecoveryCodes.length : 0,
  };
}

// Register
router.post('/register', turnstileMiddleware, async (req, res) => {
  try {
    const settings = getPublicSiteSettings();
    if (!settings.registrationOpen) {
      return res.status(403).json({ error: 'Registracija novih naloga je trenutno privremeno onemogućena od strane administratora.' });
    }

    const parsed = validate(registerSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { username, email, password, ageConfirmed } = parsed.data;

    // Terms acceptance is strictly required on the server side too.
    if (req.body.acceptedTerms !== true) {
      return res.status(400).json({ error: 'Morate prihvatiti uslove korišćenja i politiku privatnosti.' });
    }

    // F-21 — minimalni uzrast (ZZPL: 15 godina). Potvrda je eksplicitna na formi.
    if (ageConfirmed !== true) {
      return res.status(400).json({ error: 'Potvrdite da imate najmanje 15 godina.' });
    }

    const cleanUsername = username;
    const cleanEmail = email.toLowerCase();

    const usernameError = validateUsername(cleanUsername);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const emailError = validateEmail(cleanEmail);
    if (emailError) return res.status(400).json({ error: emailError });

    // Block disposable / temporary email providers.
    if (isDisposableEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Privremene (temp) email adrese nisu dozvoljene. Koristite pravu email adresu.' });
    }

    if (!isPasswordValid(password)) {
      return res.status(400).json({
        error: passwordError(password) ?? 'Lozinka ne ispunjava zahteve.',
        passwordChecks: getPasswordChecks(password),
      });
    }

    const [existingByUsername, existingByEmail] = await Promise.all([
      db.users.findByUsername(cleanUsername),
      db.users.findByEmail(cleanEmail),
    ]);

    if (existingByUsername) {
      return res.status(409).json({ error: 'Korisničko ime je već zauzeto.', field: 'username' });
    }
    if (existingByEmail) {
      return res.status(409).json({ error: 'Email adresa je već registrovana.', field: 'email' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
    const now = new Date().toISOString();

    const newUser = await db.users.create({
      id: `usr_${Date.now().toString(36)}`,
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanUsername)}`,
      bio: 'Novi član NEXUS gejming zajednice.',
      role: 'member',
      level: 1,
      xp: 0,
      xpNeeded: xpForLevel(1),
      karma: 0,
      badges: [], // first_post se dodeljuje tek na prvoj temi/odgovoru (awardXp)
      connectedAccounts: {},
      isVerified: false,
      isBanned: false,
      status: 'online',
      tokenVersion: 0,
      // F-21 — dokaz saglasnosti sa uslovima (verzija + vreme + IP).
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: now,
      termsAcceptedIp: req.ip ?? null,
      createdAt: now,
      lastSeenAt: now,
    });

    const token = generateToken({
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      tokenVersion: newUser.tokenVersion ?? 0,
    });
    void token; // JWT ide isključivo u HttpOnly cookie (ispod), nikad u telo odgovora.

    // Token za verifikaciju email-a (u produkciji se šalje mejlom)
    const verification = await createActionToken(newUser.id, 'verify_email');
    const mailSent = await sendVerificationEmail(newUser.email, newUser.username, verification.token);
    req.log?.info({ userId: newUser.id, mailSent }, 'verification_token_created');
    if (!mailSent && devTokensExposed()) {
      // B-02 — u dev režimu link mora da postoji i kada je mejl provajderu poslat
      // (odgovor verovatno nije stigao) ili nije poslat uopšte.
      req.log?.info({ verifyUrl: `${appUrl()}/verify?token=${verification.token}` }, 'dev_verification_link');
    }

    // F-32 — sesija je odmah u HttpOnly cookie-ju.
    const { csrfToken } = await establishSession(req as AuthRequest, res, newUser, { rememberMe: true });

    res.status(201).json({
      user: ownerUser(newUser),
      verificationRequired: true,
      csrfToken,
      // Token se vraća klijentu samo u lokalnom razvoju uz eksplicitni opt-in
      // (B-02 — bez uslova `!mailSent`, inače je tok „ćorsokak“ kada je mejl podešen).
      ...(devTokensExposed() ? { verificationToken: verification.token } : {}),
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    // Human-readable log prikazuje `msg`; stack je vidljiv u JSON formatu.
    req.log?.error(
      { err: error, stack: error?.stack, msg: `register_failed: ${error?.message ?? error}` },
      'register_failed',
    );
    res.status(500).json({ error: 'Greška pri registraciji. Pokušajte ponovo.' });
  }
});

// Login
router.post('/login', turnstileMiddleware, async (req, res) => {
  try {
    const parsed = validate(loginSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { email, password } = parsed.data;
    const identifier = email;
    // Normalizacija: forme često dodaju razmak na kraj unosa.
    const account = identifier.trim();
    const user = account.includes('@')
      ? await db.users.findByEmail(account.toLowerCase())
      : await db.users.findByUsername(account);

    if (!user) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
    }

    // Nalozi kreirani isključivo preko OAuth-a nemaju lozinku (bcrypt hash prazan).
    const isMatch = Boolean(user.password) && (await bcrypt.compare(password, user.password));
    if (!isMatch) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
    }

    // Ban se proverava TEK posle lozinke — ranije je 403 pre `bcrypt.compare`
    // odavao da nalog postoji (i da je banovan) bez poznavanja lozinke.
    // Privremeni ban koji je istekao ne sme da zaključa nalog: `authenticate`
    // se ne poziva pri prijavi (nema tokena), pa se istek proverava ovde.
    const activeBan = await activeBanFor(user);
    if (activeBan) {
      return res.status(403).json({
        error: activeBan.expiresAt
          ? `Vaš nalog je suspendovan do ${new Date(activeBan.expiresAt).toLocaleString('sr-RS')}.`
          : 'Vaš nalog je suspendovan. Obratite se podršci.',
        banExpiresAt: activeBan.expiresAt ?? null,
        banReason: activeBan.reason ?? null,
      });
    }

    // Transparentna migracija: legacy računi (cost 10) se rehash-uju na cost 12
    if (bcrypt.getRounds(user.password) < BCRYPT_COST) {
      try {
        await db.users.update(user.id, { password: await bcrypt.hash(password, BCRYPT_COST) });
      } catch {
        // ne blokiraj prijavu zbog rehash-a
      }
    }

    // F-33 — lozinka je tačna, ali nalog ima 2FA: NE izdajemo sesiju.
    if (user.totpEnabledAt) {
      await db.users.update(user.id, { lastSeenAt: new Date().toISOString() }).catch(() => {});
      return res.json({
        requires2fa: true,
        mfaTicket: issueMfaTicket(user),
        ...mfaMetadata(user),
      });
    }

    await db.users.update(user.id, {
      status: 'online',
      lastSeenAt: new Date().toISOString(),
    });

    // „Zapamti me“: refresh sesija 7 dana; inače 12h (access je uvek 15 min).
    const rememberMe = req.body.rememberMe === true;
    const { csrfToken } = await establishSession(req as AuthRequest, res, user, { rememberMe });

    // 2.6.1 — prisustvo posle uspešne prijave (2FA korak čeka heartbeat iz SPA-e).
    await setPresence(user.id, true).catch(() => {});

    res.json({ user: { ...ownerUser(user), isOnline: true }, rememberMe, csrfToken });
  } catch (error: any) {
    req.log?.error({ err: error }, 'login_failed');
    res.status(500).json({ error: 'Greška pri prijavi. Pokušajte ponovo.' });
  }
});

// =====================
// EMAIL VERIFIKACIJA
// =====================

// POST /api/auth/verify-email — troši token i postavlja is_verified
router.post('/verify-email', async (req, res) => {
  try {
    const token = String(req.body?.token ?? '');
    if (!token) return res.status(400).json({ error: 'Token je obavezan.' });

    /**
     * Redosled je bitan: prvo PROVERI token (ne troši ga), pa korisnika, pa
     * tek onda potroši token i upiši `is_verified`.
     *
     * Ranije se token trošio pre `db.users.update()`. Ako je update pao (npr.
     * tranzijentna greška baze), token je ostao iskorišćen a nalog neverifikovan
     * — link je bio mrtav bez mogućnosti ponovnog pokušaja.
     */
    const peek = await peekActionToken(token, 'verify_email');
    if (!peek) return res.status(400).json({ error: 'Token je nevažeći ili je istekao.' });

    const user = await db.users.findById(peek.userId);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    // Već verifikovan (npr. dvostruki klik / StrictMode) — uspeh bez trošenja.
    if (user.isVerified) {
      return res.json({ message: 'Email adresa je već verifikovana.', isVerified: true });
    }

    // Upiši verifikaciju PRE trošenja tokena: ako update padne, token ostaje važeći.
    const updated = await db.users.update(user.id, { isVerified: true });
    if (!updated?.isVerified) {
      req.log?.error({ userId: user.id }, 'verify_email_update_failed');
      return res.status(500).json({ error: 'Verifikacija nije sačuvana. Pokušajte ponovo.' });
    }

    // Tek sada potroši token (jednokratnost). Ako ovo padne, nalog je već verifikovan.
    await consumeActionToken(token, 'verify_email').catch((error) => {
      req.log?.warn({ err: error, userId: user.id }, 'verify_email_token_consume_failed');
    });

    res.json({ message: 'Email adresa je uspešno verifikovana.', isVerified: true });
  } catch (error) {
    // Ranije je `catch {}` gutao razlog — 500 bez traga u logu.
    req.log?.error({ err: error }, 'verify_email_failed');
    res.status(500).json({ error: 'Verifikacija nije uspela. Pokušajte ponovo.' });
  }
});

// GET /api/auth/verify-email/:token — provera pre klika (forma/landing)
router.get('/verify-email/:token', async (req, res) => {
  const peek = await peekActionToken(req.params.token, 'verify_email');
  res.json({ valid: Boolean(peek) });
});

// =====================
// RESET LOZINKE
// =====================

// POST /api/auth/forgot-password — uvek isti odgovor (bez enumeracije naloga)
router.post('/forgot-password', turnstileMiddleware, async (req, res) => {
  try {
    const parsed = validate(forgotPasswordSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const user = await db.users.findByEmail(parsed.data.email.toLowerCase());
    let resetToken: string | undefined;
    let mailSent = false;

    if (user && !user.isBanned) {
      const created = await createActionToken(user.id, 'reset_password');
      resetToken = created.token;
      mailSent = await sendPasswordResetEmail(user.email, user.username, created.token);
      req.log?.info({ userId: user.id, mailSent }, 'password_reset_token_created');
    }

    res.json({
      message: GENERIC_EMAIL_MESSAGE,
      ...(resetToken && devTokensExposed() ? { resetToken } : {}),
    });
  } catch {
    res.status(500).json({ error: 'Zahtev nije uspeo. Pokušajte ponovo.' });
  }
});

// POST /api/auth/reset-password — token + nova lozinka
router.post('/reset-password', async (req, res) => {
  try {
    const parsed = validate(resetPasswordSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message, details: parsed.details });
    }

    const { token, password } = parsed.data;
    const peeks = await peekActionToken(token, 'reset_password');
    if (!peeks) return res.status(400).json({ error: 'Token je nevažeći ili je istekao.' });

    if (!isPasswordValid(password)) {
      return res.status(400).json({
        error: passwordError(password) ?? 'Lozinka ne ispunjava zahteve.',
        passwordChecks: getPasswordChecks(password),
      });
    }

    const consumed = await consumeActionToken(token, 'reset_password');
    if (!consumed) return res.status(400).json({ error: 'Token je nevažeći ili je istekao.' });

    await db.users.update(consumed.userId, { password: await bcrypt.hash(password, BCRYPT_COST) });
    // F-06 — reset lozinke poništava sve postojeće sesije (uključujući napadačevu).
    await db.users.bumpSessionVersion(consumed.userId).catch((err) => {
      req.log?.error({ err, userId: consumed.userId }, 'session_version_bump_failed');
    });
    // F-32 — i refresh sesije (cookies) resetom prestaju da važe.
    await revokeAllSessions(consumed.userId, 'password_reset').catch((err) => {
      req.log?.error({ err, userId: consumed.userId }, 'session_revoke_failed');
    });
    res.json({ message: 'Lozinka je uspešno promenjena. Možete se prijaviti.' });
  } catch {
    res.status(500).json({ error: 'Promena lozinke nije uspela. Pokušajte ponovo.' });
  }
});

// Provera dostupnosti korisničkog imena (real-time na registracionoj formi)
//
// F-27 — odluka o enumeraciji (vidi `src/lib/emailPolicy.ts`): `check-username`
// i `check-email` namerno otkrivaju zauzetost da bi UX na formi bio jasan.
// Zaštita: limit 60/min po IP-u (`RATE_LIMIT_LOOKUP_MAX`, postavljen pre ruta
// u index.ts) + auth limit po IP-u; `forgot-password` ostaje bez enumeracije.
router.get('/check-username', async (req, res) => {
  try {
    const username = String(req.query.username ?? '').trim();
    if (!username) {
      return res.status(400).json({ error: 'Korisničko ime je obavezno.' });
    }
    const existing = await db.users.findByUsername(username);
    res.json({ available: !existing });
  } catch (err) {
    req.log?.error({ err }, 'auth_route_failed');
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

// Provera dostupnosti email adrese (blokira i temp mail provajdere)
router.get('/check-email', async (req, res) => {
  try {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    const emailError = validateEmail(email);
    if (emailError) {
      return res.json({ available: false, reason: 'invalid' });
    }
    if (isDisposableEmail(email)) {
      return res.json({ available: false, reason: 'disposable' });
    }
    const existing = await db.users.findByEmail(email);
    res.json({ available: !existing, reason: existing ? 'taken' : null });
  } catch (err) {
    req.log?.error({ err }, 'auth_route_failed');
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

// Trenutni ulogovani korisnik
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    // 401 (a ne 404): token postoji, ali korisnik je obrisan — sesija je gotova.
    if (!user) {
      return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });
    }
    // 2.6.1 — početno stanje. 2.6.2 — uz `online` i eksplicitan `status`
    // (`online | away`), pa i sam korisnik dobija `away` a ne lažni zeleni prsten.
    const presence = await presenceMap([user.id]).catch(() => new Map());
    const status = presence.get(user.id) ?? 'offline';
    res.json({ user: { ...ownerUser(user), status, isOnline: status === 'online' } });
  } catch (err) {
    req.log?.error({ err }, 'auth_route_failed');
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

/**
 * POST /api/auth/heartbeat — „Online sada“ (2.6.1)
 *
 * Klijent zove na mount, pri povratku u tab i na 25s dok je tab vidljiv (i na
 * 60s kao fallback da se sesija potvrdi). Bez otkucaja 90s → offline.
 * Realtime kanal sam po sebi ne zna da je korisnik prisutan (nema događaja),
 * pa je heartbeat jedini izvor istine.
 *
 * 2.6.2 — telo može nositi `status: 'away'` (tab u pozadini): server tada
 * objavi „away“ odmah, umesto da čeka sweep posle 90s.
 */
router.post('/heartbeat', authenticate, async (req: AuthRequest, res) => {
  const status = req.body?.status === 'away' ? 'away' : 'online';
  try {
    await setPresence(req.user!.id, true, { status });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ isOnline: status === 'online', status, at: new Date().toISOString() });
  } catch (err) {
    // Prisustvo je ukras — mrežni problem ne sme da prikaže grešku korisniku.
    req.log?.warn({ err }, 'presence_heartbeat_failed');
    res.json({ isOnline: status === 'online', status, at: new Date().toISOString() });
  }
});

// Logout — nužno radi i sa isteklim access tokenom (inače korisnik ostaje „prijavljen“
// dokle god je refresh cookie živ). Uvek briše cookie-je i opoziva refresh sesiju.
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    const accessToken = (req.cookies?.[ACCESS_COOKIE] as string | undefined) ?? '';

    let userId: string | null = null;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken, 'logout').catch(() => {});
    }
    if (accessToken) {
      try {
        const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as { id?: string };
        userId = decoded.id ?? null;
      } catch {
        // istekao token — samo brišemo cookie-je
      }
    }

    if (userId) {
      // F-06 — token se poništava na serveru: `tv` u JWT-u više neće odgovarati.
      await db.users.bumpSessionVersion(userId).catch((err) => {
        req.log?.error({ err, userId }, 'session_version_bump_failed');
      });
      await revokeAllSessions(userId, 'logout').catch(() => {});
      await db.users.update(userId, {
        status: 'offline',
        lastSeenAt: new Date().toISOString(),
      });
      // 2.6.1 — odmah skini zeleni prsten, bez čekanja da istekne TTL.
      await setPresence(userId, false).catch(() => {});
    }

    clearSessionCookies(res);
    res.json({ message: 'Uspešno ste se odjavili.' });
  } catch (err) {
    req.log?.error({ err }, 'auth_route_failed');
    clearSessionCookies(res);
    res.status(500).json({ error: 'Greška pri odjavi.' });
  }
});

// F-06 — „odjavi sve uređaje“ osim trenutnog: novo `tv` + nova refresh sesija,
// pa klijent dobija svež access token u cookie-ju.
router.post('/logout-all', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const tokenVersion = await db.users.bumpSessionVersion(user.id);
    await revokeAllSessions(user.id, 'logout_all').catch(() => {});
    user.tokenVersion = tokenVersion;

    const { csrfToken } = await establishSession(req, res, user, { rememberMe: true });
    res.json({ message: 'Odjavljeni ste sa svih ostalih uređaja.', csrfToken });
  } catch (err) {
    req.log?.error({ err }, 'auth_route_failed');
    res.status(500).json({ error: 'Odjava nije uspela.' });
  }
});

// =====================
// F-32 — SESIJA (cookie + refresh rotacija)
// =====================

/** Javna konfiguracija auth featura (Turnstile, OAuth provajderi) — bez tajni. */
router.get('/config', (_req, res) => {
  res.json({
    turnstile: { enabled: turnstileClientEnabled(), siteKey: turnstileSiteKey() },
    oauthProviders: enabledOAuthProviders(),
    twoFactorAvailable: true,
  });
});

/** Obnavlja access token iz HttpOnly refresh cookie-ja (uz rotaciju refresh-a). */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) {
    clearSessionCookies(res);
    return res.status(401).json({ error: 'Niste prijavljeni.', code: 'NO_SESSION' });
  }

  try {
    const result = await rotateRefreshSession(refreshToken, req);
    if (!result.ok) {
      clearSessionCookies(res);
      const code = result.reason === 'reused' ? 'REFRESH_REUSED' : 'SESSION_EXPIRED';
      return res.status(401).json({ error: 'Sesija je istekla. Prijavite se ponovo.', code });
    }

    const user = await db.users.findById(result.userId);
    if (!user || (await activeBanFor(user))) {
      await revokeRefreshToken(result.token, 'user_inactive').catch(() => {});
      clearSessionCookies(res);
      return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });
    }

    // Ako je sesija u međuvremenu poništena (odjava sa drugog uređaja), refresh
    // ne sme da je oživi — proveri `token_version` preko regularne autentifikacije.
    const token = generateToken(
      { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
      ACCESS_TOKEN_TTL,
    );
    const csrfToken = setSessionCookies(res, {
      accessToken: token,
      refreshToken: result.token,
      refreshExpiresAt: result.expiresAt,
    });
    // 2.6.1 — posle drugog koraka 2FA korisnik je stvarno prisutan.
    await setPresence(user.id, true).catch(() => {});
    res.json({ user: { ...ownerUser(user), isOnline: true }, csrfToken });
  } catch (err) {
    req.log?.error({ err }, 'refresh_failed');
    clearSessionCookies(res);
    res.status(401).json({ error: 'Sesija je istekla. Prijavite se ponovo.', code: 'SESSION_EXPIRED' });
  }
});

// =====================
// F-33 — DVOFAKTORSKA AUTENTIFIKACIJA (TOTP)
// =====================

/**
 * Proverava kod (TOTP ili recovery) uz bruteforce zaštitu.
 * Vraća null kada je kod prihvaćen, ili odgovor greške.
 */
async function checkSecondFactor(
  user: UserRecord,
  code: unknown,
): Promise<{ status: number; body: Record<string, unknown> } | { recovering: boolean; remaining: number } | null> {
  if (isLocked(user)) {
    return {
      status: 429,
      body: {
        error: 'Previše pogrešnih kodova. Sačekajte 15 minuta ili iskoristite recovery kod.',
        code: 'TOTP_LOCKED',
        lockedUntil: user.totpLockedUntil ?? null,
      },
    };
  }

  const secret = user.totpSecret ? decryptSecret(user.totpSecret) : null;
  if (!secret) {
    return { status: 409, body: { error: '2FA nije pravilno podešena. Kontaktirajte podršku.', code: 'TOTP_MISCONFIGURED' } };
  }

  const totp = await verifyTotpCode(secret, code, { lastUsedStep: user.totpLastUsedStep ?? null });
  if (totp.valid) {
    await markTotpUsed(user.id, totp.timeStep);
    await resetTotpFailures(user.id);
    return null;
  }

  // Recovery kod: jednokratni — briše se iz liste kada se iskoristi.
  const hashes = Array.isArray(user.totpRecoveryCodes) ? user.totpRecoveryCodes : [];
  const index = await matchRecoveryCode(code, hashes);
  if (index >= 0) {
    const remaining = hashes.filter((_, i) => i !== index);
    await db.users.update(user.id, { totpRecoveryCodes: remaining });
    await resetTotpFailures(user.id);
    return { recovering: true, remaining: remaining.length };
  }

  const failed = (user.totpFailedAttempts ?? 0) + 1;
  const lock = shouldLockAfterFailure(user.totpFailedAttempts ?? 0) ? lockUntilIso() : null;
  await db.users.update(user.id, {
    totpFailedAttempts: lock ? 0 : failed,
    totpLockedUntil: lock,
  }).catch(() => {});
  return { status: 401, body: { error: 'Pogrešan kod. Pokušajte ponovo.', code: 'TOTP_INVALID' } };
}
/**
 * POST /api/auth/2fa/login — drugi korak prijave.
 * Traži `mfaTicket` iz `/login` (5 min) + kod. Na uspeh izdaje punu sesiju.
 */
router.post('/2fa/login', turnstileMiddleware, async (req, res) => {
  try {
    const parsed = validate(mfaLoginSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const userId = readMfaTicket(parsed.data.mfaTicket);
    if (!userId) {
      return res.status(401).json({ error: 'Prijava je istekla. Unesite lozinku ponovo.', code: 'MFA_TICKET_INVALID' });
    }

    const user = await db.users.findById(userId);
    if (!user || !user.totpEnabledAt) {
      return res.status(401).json({ error: 'Prijava je istekla. Unesite lozinku ponovo.', code: 'MFA_TICKET_INVALID' });
    }
    if (await activeBanFor(user)) {
      return res.status(403).json({ error: 'Vaš nalog je suspendovan. Obratite se podršci.' });
    }

    const result = await checkSecondFactor(user, parsed.data.code);
    if (result && 'status' in result) {
      return res.status(result.status).json(result.body);
    }

    await db.users.update(user.id, { status: 'online', lastSeenAt: new Date().toISOString() });
    const rememberMe = parsed.data.rememberMe === true;    const refreshed = (await db.users.findById(user.id)) ?? user;
    const { csrfToken } = await establishSession(req as AuthRequest, res, refreshed, { rememberMe });

    res.json({
      user: ownerUser(refreshed),
      rememberMe,
      csrfToken,
      ...(result && 'recovering' in result
        ? { recoveryCodeUsed: true, recoveryCodesLeft: result.remaining }
        : {}),
    });
  } catch (err) {
    req.log?.error({ err }, 'mfa_login_failed');
    res.status(500).json({ error: 'Prijava nije uspela. Pokušajte ponovo.' });
  }
});

/** Status 2FA za trenutnog korisnika. */
router.get('/2fa/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    res.json({
      enabled: Boolean(user.totpEnabledAt),
      enabledAt: user.totpEnabledAt ?? null,
      recoveryCodesLeft: Array.isArray(user.totpRecoveryCodes) ? user.totpRecoveryCodes.length : 0,
      lockedUntil: isLocked(user) ? user.totpLockedUntil : null,
    });
  } catch (err) {
    req.log?.error({ err }, 'mfa_status_failed');
    res.status(500).json({ error: 'Greška na serveru.' });
  }
});

/**
 * POST /api/auth/2fa/setup — prvi korak uključivanja.
 * Vraća QR kod (data URL) i tajnu za ručni unos. 2FA se NE aktivira dok
 * korisnik ne potvrdi prvim kodom iz aplikacije.
 */
router.post('/2fa/setup', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.totpEnabledAt) {
      return res.status(409).json({ error: '2FA je već uključena.', code: 'TOTP_ALREADY_ENABLED' });
    }

    const secret = startEnrollment(user.id);
    const uri = await totpUri(user.username, secret);
    res.json({ secret, otpauthUri: uri, qrCode: await totpQrDataUrl(uri) });
  } catch (err) {
    req.log?.error({ err }, 'mfa_setup_failed');
    res.status(500).json({ error: 'Generisanje QR koda nije uspelo.' });
  }
});

/**
 * POST /api/auth/2fa/enable — potvrda prvog koda; tek sada se 2FA uključuje.
 * Recovery kodovi se prikazuju SAMO u ovom odgovoru (u bazi su bcrypt hash-evi).
 */
router.post('/2fa/enable', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (user.totpEnabledAt) {
      return res.status(409).json({ error: '2FA je već uključena.', code: 'TOTP_ALREADY_ENABLED' });
    }

    const secret = pendingSecret(user.id);
    if (!secret) {
      return res.status(400).json({ error: 'Postavka je istekla. Započnite ponovo.', code: 'TOTP_SETUP_EXPIRED' });
    }

    const check = await verifyTotpCode(secret, req.body?.code);
    if (!check.valid) {
      return res.status(400).json({ error: 'Kod nije ispravan. Proverite vreme na telefonu.', code: 'TOTP_INVALID' });
    }

    const { plain, hashes } = await generateRecoveryCodes();
    const updated = await db.users.update(user.id, {
      totpSecret: encryptSecret(secret),
      totpEnabledAt: new Date().toISOString(),
      totpRecoveryCodes: hashes,
      totpFailedAttempts: 0,
      totpLockedUntil: null,
      totpLastUsedStep: check.timeStep ?? null,
    });
    clearEnrollment(user.id);

    // Ostale sesije ne dobijaju „promociju“ — samo one otvorene posle 2FA.
    req.log?.info({ userId: user.id }, 'totp_enabled');
    res.json({
      enabled: true,
      recoveryCodes: plain,
      user: updated ? ownerUser(updated) : null,
    });
  } catch (err) {
    req.log?.error({ err }, 'mfa_enable_failed');
    res.status(500).json({ error: 'Uključivanje 2FA nije uspelo.' });
  }
});

/** POST /api/auth/2fa/disable — isključivanje traži lozinku (i kod ako postoji). */
router.post('/2fa/disable', authenticate, async (req: AuthRequest, res) => {
  try {
    const parsed = validate(totpDisableSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });
    if (!user.password) {
      return res.status(409).json({
        error: 'Nalog je kreiran preko OAuth-a i nema lozinku. Postavite lozinku pre isključivanja 2FA.',
        code: 'NO_PASSWORD',
      });
    }

    const passwordOk = await bcrypt.compare(parsed.data.password, user.password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Pogrešna lozinka.' });
    }

    const result = await checkSecondFactor(user, parsed.data.code);
    if (result && 'status' in result) {
      return res.status(result.status).json(result.body);
    }

    const updated = await db.users.update(user.id, {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryCodes: [],
      totpFailedAttempts: 0,
      totpLockedUntil: null,
      totpLastUsedStep: null,
    });
    req.log?.warn({ userId: user.id }, 'totp_disabled');
    res.json({ enabled: false, user: updated ? ownerUser(updated) : null });
  } catch (err) {
    req.log?.error({ err }, 'mfa_disable_failed');
    res.status(500).json({ error: 'Isključivanje 2FA nije uspelo.' });
  }
});

/** POST /api/auth/2fa/recovery-codes — novi set (stari prestaju da važe). */
router.post('/2fa/recovery-codes', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user?.totpEnabledAt) {
      return res.status(400).json({ error: '2FA nije uključena.', code: 'TOTP_NOT_ENABLED' });
    }

    const password = String(req.body?.password ?? '');
    if (!user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Pogrešna lozinka.' });
    }

    const { plain, hashes } = await generateRecoveryCodes();
    await db.users.update(user.id, { totpRecoveryCodes: hashes });
    res.json({ recoveryCodes: plain });
  } catch (err) {
    req.log?.error({ err }, 'mfa_recovery_failed');
    res.status(500).json({ error: 'Generisanje recovery kodova nije uspelo.' });
  }
});

export default router;
