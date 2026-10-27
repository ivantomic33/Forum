import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, xpForLevel } from '../lib/store.js';
import { authenticate, generateToken, invalidateSessionCache, type AuthRequest } from '../middleware/auth.js';
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
import { verificationReminder, verificationThanks, verificationWelcome } from '../lib/notifications.js';
import { sendVerificationEmail, sendPasswordResetEmail, appUrl } from '../lib/email.js';
import { sendLoginAlert } from '../lib/loginAlert.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, mfaLoginSchema, totpDisableSchema, validate } from '../lib/schemas.js';
import { AppError } from '../lib/http.js';
import { devTokensExposed } from '../lib/env.js';
import { ownerUser } from '../lib/userShape.js';
import {
  clearTrustCookies,
  deviceIdFrom,
  forgetAllDevices,
  isTrustedDevice,
  listDevices,
  rememberDevice,
  setDeviceCookie,
  TRUST_TTL_MS,
} from '../lib/trustedDevices.js';
import { getPublicSiteSettings } from './admin.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  ACCESS_TOKEN_TTL,
  clearSessionCookies,
  createRefreshSession,
  currentSessionId,
  listUserSessions,
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
  consumeEnrollment,
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
import {
  AuthPasskeyError,
  authenticationOptions,
  consumeChallenge,
  deletePasskey,
  findPasskeyByCredentialId,
  findPasskeyById,
  listPasskeys,
  newChallenge,
  passkeyCount,
  registrationOptions,
  rpId,
  savePasskey,
  touchPasskey,
  verifyAssertion,
  verifyRegistration,
} from '../lib/passkeys.js';
import { turnstileMiddleware } from '../middleware/turnstile.js';
import { setPresence, isUserOnline, presenceMap, markSignedIn } from '../lib/presence.js';
import { recordDailyLogin } from '../lib/dailyLoop.js';
import type { UserRecord } from '../lib/store.js';

const router = Router();

/** Kratki UUID helper — passkey ID (isti oblik kao `crypto.randomUUID`). */
const cryptoRandomId = () => crypto.randomUUID();

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

/**
 * 6.x — „nova prijava“: bezbednosni signal bez mejla.
 *
 * Mejl je ugašen (samo verifikacija i reset lozinke), pa upozorenje stiže kao
 * in-app `warning` u inbox/zvonce/push: uređaj, IP i vreme, sa linkom na sesije
 * gde postoji „Odjavi sve uređaje“ (odgovor na „Nisam ja“).
 */
async function maybeSendLoginAlert(
  user: UserRecord,
  req: AuthRequest,
  knownBefore: Array<{ userAgent: string | null; ip: string | null }> = [],
): Promise<void> {
  await sendLoginAlert({
    userId: user.id,
    userAgent: req.get('user-agent'),
    ip: req.ip ?? null,
    knownBefore,
  });
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

    // Admin podešavanja: blocklist/allowlist email domena (blocklist ima prednost).
    const domain = cleanEmail.split('@')[1] ?? '';
    if (settings.blockedEmailDomains.includes(domain)) {
      return res.status(400).json({ error: 'Registracija sa ovog email domena nije dozvoljena.' });
    }
    if (settings.allowedEmailDomains.length > 0 && !settings.allowedEmailDomains.includes(domain)) {
      return res.status(400).json({
        error: `Registracija je dozvoljena samo sa sledećih domena: ${settings.allowedEmailDomains.join(', ')}.`,
      });
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

    // Prvi registrovani korisnik postaje admin — bez demo seed-a ovo je jedini
    // način da nastane administratorski nalog (idempotentno: kasnije registracije
    // uvek dobijaju 'member').
    const isFirstUser = (await db.users.count({ excludeBanned: true })) === 0;
    const role = isFirstUser ? 'admin' : 'member';
    if (isFirstUser) {
      req.log?.info({ email: cleanEmail }, 'first_user_promoted_to_admin');
    }

    const newUser = await db.users.create({
      id: `usr_${Date.now().toString(36)}`,
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(cleanUsername)}`,
      bio: 'Novi član NEXUS gejming zajednice.',
      role,
      level: 1,
      xp: 0,
      xpNeeded: xpForLevel(1),
      karma: 0,
      badges: [], // first_post se dodeljuje tek na prvoj temi/odgovoru (awardXp)
      connectedAccounts: {},
      isVerified: isFirstUser,
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

    // 3.0.0 — verifikacioni bot: poruka u inbox odmah posle registracije.
    // Link sa tokenom SAMO kada je mejl zaista poslat ili kada je dev režim
    // eksplicitno uključen — inače bi poruka vodila na mrtav `/verify?token=`.
    // `void` — notifikacija ne sme da obori registraciju.
    if (!newUser.isVerified) {
      void verificationWelcome({
        userId: newUser.id,
        username: newUser.username,
        verifyLink: devTokensExposed()
          ? `/verify?token=${encodeURIComponent(verification.token)}`
          : null,
        emailSent: mailSent,
      }).catch(() => null);
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
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.', code: 'INVALID_CREDENTIALS' });
    }

    // Nalozi kreirani isključivo preko OAuth-a nemaju lozinku (bcrypt hash prazan).
    // 5.2 — umesto generičkog „pogrešna lozinka“ kažemo korisniku šta stварno treba
    // (inače traži reset lozinke koja nikad nije ni postojala). Ovo je namerno:
    // nalog i provajder se saznaju već iz `check-email`-a na registraciji.
    if (!user.password) {
      const providers = await db.oauth.listForUser(user.id).catch(() => []);
      const provider = providers[0]?.provider ?? null;
      return res.status(409).json({
        error: provider
          ? `Ovaj nalog koristi prijavu preko ${provider}. Prijavite se preko tog provajdera.`
          : 'Ovaj nalog nema lozinku. Prijavite se preko povezanog provajdera ili resetujte lozinku.',
        code: 'OAUTH_ONLY_ACCOUNT',
        provider,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka.', code: 'INVALID_CREDENTIALS' });
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
        code: 'BAN_ACTIVE',
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

    // F-15 — trusted uređaj preskače TOTP korak. Provera je posle lozinke
    // (cookie sam po sebi nikad nije dokaz) i nikad ne baca — greška baze
    // znači „nije trusted“, pa se traži kod.
    if (user.totpEnabledAt) {
      const trusted = await isTrustedDevice(req, user.id, req.get('user-agent'));
      if (trusted) {
        await db.users.update(user.id, { status: 'online', lastSeenAt: new Date().toISOString() });
        await markSignedIn(user);
        const rememberMe = req.body.rememberMe === true;
        const { csrfToken } = await establishSession(req as AuthRequest, res, user, { rememberMe });
        await setPresence(user.id, true).catch(() => {});
        // 5.3 — prijava je aktivnost za streak (i trustovan uređaj je prijava).
        const daily = await recordDailyLogin(user.id);
        req.log?.info({ userId: user.id }, 'mfa_skipped_trusted_device');
        return res.json({
          user: { ...ownerUser(user), isOnline: true },
          rememberMe,
          csrfToken,
          trustedDevice: true,
          loginBonus: daily.bonusXp > 0 ? { xp: daily.bonusXp, streak: daily.streakDays } : null,
        });
      }
    }

    // F-33 — lozinka je tačna, ali nalog ima 2FA: NE izdajemo sesiju.
    // 5.2 — ako nalog ima i passkey, drugi faktor može biti passkey umesto koda
    // (biometrija je jača od prepisivanja 6 cifara). `challengeId` ide uz opcije.
    if (user.totpEnabledAt) {
      await db.users.update(user.id, { lastSeenAt: new Date().toISOString() }).catch(() => {});
      let passkeyOptions: Record<string, unknown> | null = null;
      try {
        const credentials = await listPasskeys(user.id);
        if (credentials.length) {
          const allowCredentials = credentials.map((row) => row.credentialId);
          const challenge = newChallenge({ purpose: 'login', allowCredentials });
          passkeyOptions = {
            ...authenticationOptions(challenge.challenge, allowCredentials),
            __challengeId: challenge.challengeId,
          };
        }
      } catch {
        // Passkey je dodatak; bez njega 2FA korak nastavlja sa TOTP kodom.
      }
      return res.json({
        requires2fa: true,
        mfaTicket: issueMfaTicket(user),
        ...mfaMetadata(user),
        ...(passkeyOptions ? { passkeyOptions } : {}),
      });
    }

    await db.users.update(user.id, {
      status: 'online',
      lastSeenAt: new Date().toISOString(),
    });
    // B-15 — `users.status` je samo keš; prisustvo je red u `user_presence`.
    await markSignedIn(user);

    // 5.5 — stanje PRE nove sesije (za „nova prijava“ mejl).
    const knownSessions = await db.sessions.listActiveForUser(user.id).catch(() => []);

    // „Zapamti me“: refresh sesija 7 dana; inače 12h (access je uvek 15 min).
    const rememberMe = req.body.rememberMe === true;
    const { csrfToken } = await establishSession(req as AuthRequest, res, user, { rememberMe });

    // 2.6.1 — prisustvo posle uspešne prijave (2FA korak čeka heartbeat iz SPA-e).
    await setPresence(user.id, true).catch(() => {});
    // 5.5 — „nova prijava“ mejl. Snimak sesija se pravi PRE izdavanja nove
    // (inače bi nova sesija bila „poznata“ i mejl nikad ne bi otišao).
    void maybeSendLoginAlert(user, req as AuthRequest, knownSessions);
    // 5.3 — dnevni streak/bonus (idempotentno po danu).
    const daily = await recordDailyLogin(user.id);

    res.json({
      user: { ...ownerUser(user), isOnline: true },
      rememberMe,
      csrfToken,
      loginBonus: daily.bonusXp > 0 ? { xp: daily.bonusXp, streak: daily.streakDays } : null,
      loginStreak: daily.streakDays,
    });
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

    // Već verifikovan (npr. dvostruki klik / StrictMode) — uspeh bez trošenja
    // i bez druge bot poruke (ne spamujemo zahvalnicu).
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

    // 3.0.0 — bot zahvaljuje i objašnjava šta je sada otključano.
    void verificationThanks({ userId: user.id, username: user.username }).catch(() => null);

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

/**
 * GET /api/auth/verification-status — za trajni banner „potvrdi email“.
 * Namerno NE vraća token: ponovno slanje ide kroz `resend-verification`.
 */
router.get('/verification-status', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ isVerified: Boolean(user.isVerified), email: user.email });
  } catch (err) {
    req.log?.error({ err }, 'verification_status_failed');
    res.status(500).json({ error: 'Status verifikacije nije dostupan.' });
  }
});

/**
 * POST /api/auth/resend-verification — novi link za verifikaciju email-a.
 *
 * Anti-abuse: 30 s po nalogu — bez toga bi dugme u banneru bilo mašina za
 * generisanje mejlova. Stari tokeni ostaju u tabeli do isteka (24h) i svi
 * važeći tokeni za isti nalog verifikuju isti email, pa stari link nije rizik.
 */
const RESEND_COOLDOWN_MS = 30_000;
const lastResendAt = new Map<string, number>();

router.post('/resend-verification', authenticate, turnstileMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });
    if (user.isVerified) {
      return res.status(409).json({ error: 'Email adresa je već verifikovana.', code: 'ALREADY_VERIFIED' });
    }

    const now = Date.now();
    const previous = lastResendAt.get(user.id) ?? 0;
    if (now - previous < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (now - previous)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Sačekajte još ${retryAfter} s pre novog zahteva.`,
        code: 'RESEND_COOLDOWN',
        retryAfter,
      });
    }
    lastResendAt.set(user.id, now);
    if (lastResendAt.size > 5_000) {
      // Prosečan ~30 s po nalogu; stariji unosi se brišu kada mapa poraste.
      for (const [id, at] of lastResendAt) if (now - at > 10 * 60_000) lastResendAt.delete(id);
    }

    const verification = await createActionToken(user.id, 'verify_email');
    const sent = await sendVerificationEmail(user.email, user.username, verification.token);
    req.log?.info({ userId: user.id, sent }, 'verification_email_resent');

    // 3.0.0 — bot podseća u inbox-u (i nosi link u dev režimu, kada mejl
    // provajder nije podešen). Ne blokira odgovor.
    if (sent || devTokensExposed()) {
      void verificationReminder({
        userId: user.id,
        username: user.username,
        verifyLink: devTokensExposed() ? `/verify?token=${encodeURIComponent(verification.token)}` : null,
      }).catch(() => null);
    } else {
      req.log?.warn({ userId: user.id }, 'verification_email_not_sent');
    }
    res.json({
      message: 'Poslali smo novi link za potvrdu email adrese.',
      sent,
      ...(devTokensExposed() ? { verificationToken: verification.token } : {}),
    });
  } catch (err) {
    req.log?.error({ err }, 'resend_verification_failed');
    res.status(500).json({ error: 'Slanje mejla nije uspelo. Pokušajte ponovo.' });
  }
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
    // N-04 — keš `tv` se briše odmah (inače bi do 30 s stari token još prolazio).
    invalidateSessionCache(consumed.userId);
    await db.users.bumpSessionVersion(consumed.userId).catch((err) => {
      req.log?.error({ err, userId: consumed.userId }, 'session_version_bump_failed');
    });
    // F-32 — i refresh sesije (cookies) resetom prestaju da važe.
    await revokeAllSessions(consumed.userId, 'password_reset').catch((err) => {
      req.log?.error({ err, userId: consumed.userId }, 'session_revoke_failed');
    });
    // F-15 — „zapamti ovaj uređaj“ se briše resetom: trusted cookie je napravljen
    // pod starom lozinkom, pa ne sme da preskoči 2FA posle reset-a.
    await forgetAllDevices(consumed.userId);
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
      invalidateSessionCache(userId);
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

    // N-04 — „odjavi se svuda“ mora da važi odmah na ovoj instanci: obriši keš
    // pre povećanja verzije, pa već sledeći zahtev sa starim `tv` dobija 401.
    invalidateSessionCache(user.id);
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

/**
 * `invalidateSessionCache` štiti `tv` (verziju) od keša od 30 s, ali access JWT
 * i dalje fizički postoji i `authenticate` ga prihvata. Zato posle poništavanja
 * sesija klijentu skinemo i `nx_at` (refresh rotacija ga ne može oživeti jer je
 * i refresh opozvan). „Odjavi ostale uređaje“ zato ne dira ovu sesiju — njoj
 * ostaje cookie, a `tv` se odabere u serveru.
 */
function dropAccessCookie(res: any) {
  res.clearCookie(ACCESS_COOKIE, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

/* ----------------------------------------------------------------
 * 5.1 — UPRAVLJANJE SESIJAMA (profil → Sesije)
 * ---------------------------------------------------------------- */

/** GET /api/auth/sessions — aktivne sesije (jedan red po uređaju/porodici). */
router.get('/sessions', authenticate, async (req: AuthRequest, res) => {
  try {
    const sessions = await listUserSessions(req, req.user!.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sessions, count: sessions.length });
  } catch (err) {
    req.log?.error({ err }, 'sessions_list_failed');
    res.status(500).json({ error: 'Lista sesija nije dostupna.' });
  }
});

/**
 * DELETE /api/auth/sessions/:id — odjava jedne sesije (uređaja).
 * `id` je `familyId` porodice rotacije, a ne pojedinačni red: poništava se ceo
 * lanac, jer bi inače sledeća rotacija oživela sesiju iz istog lanca.
 *
 * Ako korisnik odjavi sesiju iz koje je zahtev došao, cookie-ji se brišu i
 * klijent dobija `current: true` da zna da je i on sam odjavljen.
 */
router.delete('/sessions/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const familyId = String(req.params.id ?? '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(familyId)) {
      return res.status(400).json({ error: 'Neispravan ID sesije.' });
    }

    const current = await currentSessionId(req);
    const revoked = await db.sessions.revokeFamilyForUser(req.user!.id, familyId, 'session_revoked').catch(() => false);
    if (!revoked) return res.status(404).json({ error: 'Sesija nije pronađena.' });

    // Brisanje cookie-ja ima smisla SAMO za tekući uređaj; `clearCookie` za tuđu
    // porodicu bi odjavio i laptop koji je zahtev poslao.
    const isCurrent = current === familyId;
    if (isCurrent) clearSessionCookies(res);
    req.log?.info({ userId: req.user!.id, familyId }, 'session_revoked_by_user');
    res.json({ revoked: true, current: isCurrent });
  } catch (err) {
    req.log?.error({ err }, 'session_revoke_failed');
    res.status(500).json({ error: 'Odjava sesije nije uspela.' });
  }
});

/** DELETE /api/auth/sessions — odjava sa SVIH uređaja (i ovog). */
router.delete('/sessions', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    invalidateSessionCache(userId);
    await db.users.bumpSessionVersion(userId).catch((err) => {
      req.log?.error({ err, userId }, 'session_version_bump_failed');
    });
    await revokeAllSessions(userId, 'logout_all_devices').catch(() => {});
    await forgetAllDevices(userId).catch(() => {});
    await db.users.update(userId, { status: 'offline', lastSeenAt: new Date().toISOString() }).catch(() => {});
    await setPresence(userId, false).catch(() => {});
    clearSessionCookies(res);
    dropAccessCookie(res);
    clearTrustCookies(res);
    res.json({ revoked: true, all: true });
  } catch (err) {
    req.log?.error({ err }, 'sessions_revoke_all_failed');
    res.status(500).json({ error: 'Odjava sa svih uređaja nije uspela.' });
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
      // Zadrži token koji je klijent poslao — bez ovoga se `nx_csrf` rotira
      // na svakom refresh-u i paralelni zahtevi padaju na CSRF proveri.
      currentCsrfToken: req.cookies?.[CSRF_COOKIE],
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

  // 5.1 — zaključavanje 2FA je znak napada: sve sesije (i refresh-ovi) idu na
  // odjavu. Napadač koji je već držao sesiju ne sme da je nastavi; korisnik se
  // ponovo prijavljuje kad lock istekne (ili recovery kodom posle njega).
  if (lock) {
    invalidateSessionCache(user.id);
    await db.users.bumpSessionVersion(user.id).catch(() => {});
    await revokeAllSessions(user.id, 'totp_lockout').catch(() => {});
    // Mejl alert ugašen: obaveštenje o zaključanom 2FA ostaje u aplikaciji.
  }
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

    // F-15 — uređaj je već zapamćen (npr. drugi tab), a korisnik ponovo traži
    // „ne traži kod“: ne izdajemo novu sesiju (ovo je drugi korak, kod je obavezan),
    // samo javimo klijentu da uređaj važi — bez trošenja tokena i bez 401.
    if (parsed.data.trustDevice === true && (await isTrustedDevice(req, user.id, req.get('user-agent')))) {
      return res.status(200).json({
        trustedDevice: true,
        alreadyTrusted: true,
        message: 'Ovaj uređaj je već zapamćen — prijavite se lozinkom.',
      });
    }
    if (await activeBanFor(user)) {
      return res.status(403).json({ error: 'Vaš nalog je suspendovan. Obratite se podršci.', code: 'BAN_ACTIVE' });
    }

    const result = await checkSecondFactor(user, parsed.data.code);
    if (result && 'status' in result) {
      return res.status(result.status).json(result.body);
    }

    await db.users.update(user.id, { status: 'online', lastSeenAt: new Date().toISOString() });
    await markSignedIn(user);
    const rememberMe = parsed.data.rememberMe === true;
    const sessionsBefore = await db.sessions.listActiveForUser(user.id).catch(() => []);
    const refreshed = (await db.users.findById(user.id)) ?? user;
    const { csrfToken } = await establishSession(req as AuthRequest, res, refreshed, { rememberMe });

    // F-15 — „zapamti ovaj uređaj 30 dana“: token ide u HttpOnly cookie, u bazu samo hash.
    // Isti `device_id` uvek rotira token (ukradeni cookie važi do sledeće prijave).
    const trusted = parsed.data.trustDevice === true
      ? await rememberDevice(res, user.id, req.get('user-agent'), deviceIdFrom(req))
      : false;
    void maybeSendLoginAlert(user, req as AuthRequest, sessionsBefore);
    const daily = await recordDailyLogin(user.id);

    res.json({
      user: ownerUser(refreshed),
      rememberMe,
      csrfToken,
      trustedDevice: trusted,
      loginBonus: daily.bonusXp > 0 ? { xp: daily.bonusXp, streak: daily.streakDays } : null,
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

    const secret = await startEnrollment(user.id);
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

    const secret = await pendingSecret(user.id);
    if (!secret) {
      return res.status(400).json({ error: 'Postavka je istekla. Započnite ponovo.', code: 'TOTP_SETUP_EXPIRED' });
    }

    const check = await verifyTotpCode(secret, req.body?.code);
    if (!check.valid) {
      return res.status(400).json({ error: 'Kod nije ispravan. Proverite vreme na telefonu.', code: 'TOTP_INVALID' });
    }

    // N-09 — enrollment se troši pre upisa: dva paralelna `enable` zahteva ne
    // smeju oba da aktiviraju 2FA (drugi bi pregazio recovery kodove prvog).
    if (!(await consumeEnrollment(user.id, secret))) {
      return res.status(409).json({
        error: 'Postavka je promenjena ili istekla. Započnite ponovo.',
        code: 'TOTP_SETUP_SUPERSEDED',
      });
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
    // F-15 — bez 2FA „trusted“ uređaj ne sme da ostane zapamćen: sledeća prijava
    // bi preskočila step koji više ne postoji (i ostala bi upisana u bazi).
    await forgetAllDevices(user.id, res);
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

/* ----------------------------------------------------------------
 * 5.2 — PASSKEY / WEBAUTHN
 * ---------------------------------------------------------------- */

/** Passkey rute vraćaju 503 ako `webauthn_credentials` nije puštena. */
function passkeyFailure(req: AuthRequest, res: any, error: unknown) {
  if (error instanceof AuthPasskeyError) {
    const status = error.code === 'passkey_storage_missing' ? 503 : 400;
    return res.status(status).json({ error: error.message, code: error.code.toUpperCase() });
  }
  req.log?.error({ err: error }, 'passkey_route_failed');
  return res.status(500).json({ error: 'Passkey radnja nije uspela. Pokušajte ponovo.' });
}

/** GET /api/auth/passkeys — lista passkey-a za profil (bez javnog ključa). */
router.get('/passkeys', authenticate, async (req: AuthRequest, res) => {
  try {
    const rows = await listPasskeys(req.user!.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      passkeys: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        transports: row.transports,
      })),
      rpId: rpId(),
    });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

/**
 * POST /api/auth/passkeys/register/begin — opcije za `navigator.credentials.create`.
 * Traži prijavu: passkey se dodaje postojećem nalogu (nikad ne pravi novi).
 */
router.post('/passkeys/register/begin', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await db.users.findById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });
    if (await passkeyCount(user.id) >= 10) {
      return res.status(409).json({ error: 'Najviše 10 passkey-a po nalogu.', code: 'PASSKEY_LIMIT' });
    }
    const existing = await listPasskeys(user.id).catch(() => []);
    const { challengeId, challenge } = newChallenge({
      purpose: 'register',
      userId: user.id,
      allowCredentials: [],
    });
    res.json({
      challengeId,
      username: user.username,
      options: registrationOptions(user, challenge, existing.map((row) => row.credentialId)),
    });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

/**
 * POST /api/auth/passkeys/register/finish — verifikuje attestation i čuva ključ.
 * Sav rad je u `verifyRegistration`; ovde je samo HTTP + upis.
 */
router.post('/passkeys/register/finish', authenticate, async (req: AuthRequest, res) => {
  try {
    const { challengeId, credential, name } = (req.body ?? {}) as any;
    const record = consumeChallenge(String(challengeId ?? ''), 'register');
    if (!record || record.userId !== req.user!.id) {
      return res.status(400).json({ error: 'Registracija passkey-a je istekla. Pokušajte ponovo.', code: 'CHALLENGE_EXPIRED' });
    }

    const credentialId = String(credential?.id ?? credential?.rawId ?? '');
    if (!credentialId) return res.status(400).json({ error: 'Passkey podaci nedostaju.', code: 'INVALID_CREDENTIAL' });

    const parsed = verifyRegistration(credential, { challenge: record.challenge, credentialId });
    // Ključ koji već postoji (drugi nalog ili ponovljena registracija) ne sme da se prepiše.
    if (await findPasskeyByCredentialId(parsed.credentialId)) {
      return res.status(409).json({ error: 'Ovaj passkey je već registrovan.', code: 'PASSKEY_EXISTS' });
    }

    const saved = await savePasskey({
      id: cryptoRandomId(),
      userId: req.user!.id,
      credentialId: parsed.credentialId,
      publicKey: parsed.publicKey,
      counter: parsed.counter,
      attachment: parsed.attachment,
      transports: parsed.transports,
      name: String(name ?? '').trim().slice(0, 60) || 'Passkey',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    req.log?.info({ userId: req.user!.id, passkeyId: saved.id }, 'passkey_registered');
    res.status(201).json({
      passkey: {
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        lastUsedAt: saved.lastUsedAt,
        transports: saved.transports,
      },
    });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

/**
 * POST /api/auth/passkeys/login/begin — javna ruta (bez sesije).
 * `discoverable`: bez email-a — autentifikator sam izabere ključ. Ako klijent
 * pošalje `email`, sužavamo `allowCredentials` na taj nalog.
 */
router.post('/passkeys/login/begin', turnstileMiddleware, async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const allowCredentials: string[] = [];

    if (email) {
      const user = await db.users.findByEmail(email);
      if (user) {
        const credentials = await listPasskeys(user.id).catch(() => []);
        allowCredentials.push(...credentials.map((row) => row.credentialId));
      }
      // Namerno ne odajemo da li email postoji: bez ključa i dalje ide discoverable.
      if (!allowCredentials.length) allowCredentials.length = 0;
    }

    const { challengeId, challenge } = newChallenge({ purpose: 'login', allowCredentials });
    res.json({ challengeId, options: authenticationOptions(challenge, allowCredentials) });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

/**
 * POST /api/auth/passkeys/login/finish — verifikacija + izdavanje sesije.
 * Dva režima: (a) puna prijava (bez tiketa), (b) passkey kao DRUGI faktor uz
 * `mfaTicket` iz `/login` — tada se sesija izdaje tek ako je i tiket važeći.
 */
router.post('/passkeys/login/finish', turnstileMiddleware, async (req, res) => {
  try {
    const { challengeId, credential, mfaTicket, rememberMe } = (req.body ?? {}) as any;
    const challenge = consumeChallenge(String(challengeId ?? ''), 'login');
    if (!challenge) {
      return res.status(400).json({ error: 'Prijava passkey-om je istekla. Pokušajte ponovo.', code: 'CHALLENGE_EXPIRED' });
    }

    const credentialId = String(credential?.id ?? credential?.rawId ?? '');
    const record = await findPasskeyByCredentialId(credentialId);
    if (!record) return res.status(401).json({ error: 'Passkey nije prepoznat.', code: 'PASSKEY_UNKNOWN' });
    // `allowCredentials` iz `begin` je suzio izbor — ključ van liste je odbijen.
    if (challenge.allowCredentials.length && !challenge.allowCredentials.includes(record.credentialId)) {
      return res.status(401).json({ error: 'Passkey ne pripada ovom nalogu.', code: 'PASSKEY_NOT_ALLOWED' });
    }

    const assertion = verifyAssertion(credential, record, challenge.challenge);
    const user = await db.users.findById(record.userId);
    // 5.5 — stanje pre izdavanja nove sesije (za „nova prijava“ mejl).
    const knownSessions = user ? await db.sessions.listActiveForUser(user.id).catch(() => []) : [];
    if (!user) return res.status(401).json({ error: 'Nalog nije aktivan.', code: 'SESSION_REVOKED' });

    const activeBan = await activeBanFor(user);
    if (activeBan) {
      return res.status(403).json({
        error: activeBan.expiresAt
          ? `Vaš nalog je suspendovan do ${new Date(activeBan.expiresAt).toLocaleString('sr-RS')}.`
          : 'Vaš nalog je suspendovan. Obratite se podršci.',
        code: 'BAN_ACTIVE',
        banExpiresAt: activeBan.expiresAt ?? null,
        banReason: activeBan.reason ?? null,
      });
    }

    // Drugi faktor: passkey sme da zameni TOTP kod SAMO uz važeći tiket prvog faktora.
    if (mfaTicket) {
      const ticketUserId = readMfaTicket(mfaTicket);
      if (!ticketUserId || ticketUserId !== user.id) {
        return res.status(401).json({ error: 'Prijava je istekla. Unesite lozinku ponovo.', code: 'MFA_TICKET_INVALID' });
      }
    }

    await touchPasskey(record.id, assertion.counter);
    await db.users.update(user.id, { status: 'online', lastSeenAt: new Date().toISOString() });
    await markSignedIn(user);
    const { csrfToken } = await establishSession(req as AuthRequest, res, user, { rememberMe: rememberMe === true });
    await setPresence(user.id, true).catch(() => {});
    void maybeSendLoginAlert(user, req as AuthRequest, knownSessions);
    const daily = await recordDailyLogin(user.id);
    req.log?.info({ userId: user.id, passkeyId: record.id, secondFactor: Boolean(mfaTicket) }, 'passkey_login');
    res.json({
      user: { ...ownerUser(user), isOnline: true },
      csrfToken,
      method: 'passkey',
      loginBonus: daily.bonusXp > 0 ? { xp: daily.bonusXp, streak: daily.streakDays } : null,
      loginStreak: daily.streakDays,
    });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

/** DELETE /api/auth/passkeys/:id — brisanje passkey-a (samo sopstvenog). */
router.delete('/passkeys/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id ?? '');
    const existing = await findPasskeyById(id, req.user!.id);
    if (!existing) return res.status(404).json({ error: 'Passkey nije pronađen.' });

    const removed = await deletePasskey(id, req.user!.id);
    req.log?.info({ userId: req.user!.id, passkeyId: id }, 'passkey_removed');
    res.json({ removed });
  } catch (error) {
    passkeyFailure(req, res, error);
  }
});

export default router;

/* ----------------------------------------------------------------
 * F-15 — UPRAVLJANJE TRUSTED UREĐAJIMA (profil → Bezbednost)
 * ---------------------------------------------------------------- */

/** GET /api/auth/2fa/devices — zapamćeni uređaji (bez hash-eva). */
router.get('/2fa/devices', authenticate, async (req: AuthRequest, res) => {
  const devices = await listDevices(req.user!.id);
  res.json({
    devices,
    currentDeviceId: deviceIdFrom(req),
    ttlDays: Math.round(TRUST_TTL_MS / 86_400_000),
  });
});

/** DELETE /api/auth/2fa/devices/:deviceId — zaboravi jedan uređaj. */
router.delete('/2fa/devices/:deviceId', authenticate, async (req: AuthRequest, res) => {
  const deviceId = String(req.params.deviceId ?? '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) {
    return res.status(400).json({ error: 'Neispravan ID uređaja.' });
  }
  const removed = await db.trustedDevices.deleteOne(req.user!.id, deviceId).catch(() => false);
  if (deviceIdFrom(req) === deviceId) clearTrustCookies(res);
  res.json({ removed });
});

/** DELETE /api/auth/2fa/devices — „zaboravi sve uređaje“ (bez diranja 2FA). */
router.delete('/2fa/devices', authenticate, async (req: AuthRequest, res) => {
  const removed = await forgetAllDevices(req.user!.id, res);
  res.json({ removed });
});
