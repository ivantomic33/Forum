import 'dotenv/config';

//
// Windows konzola je podrazumevano u cp1252 — Node ispisuje UTF-8, pa emoji i naša
// slova (č, ć, ž, š, đ) izlaze kao `✅`. Postavljamo UTF-8 izlaz pre bilo kog loga.
// `process.stdout.isTTY` provera: kada se izlaz preusmerava u fajl, Node ionako
// piše UTF-8 i postavka nije potrebna.
if (process.platform === 'win32') {
  try {
    process.stdout.setDefaultEncoding?.('utf8');
    process.stderr.setDefaultEncoding?.('utf8');
    process.stdout.write(''); // no-op — okida inicijalizaciju streama
  } catch {
    // ignore
  }
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import pinoHttp from 'pino-http';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// Routes
import authRoutes from './routes/auth.js';
import oauthRoutes from './routes/oauth.js';
import articleRoutes from './routes/articles.js';
import forumRoutes from './routes/forum.js';
import userRoutes from './routes/users.js';
import newsletterRoutes from './routes/newsletter.js';
import adminRoutes from './routes/admin.js';
import pollRoutes from './routes/polls.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import dealRoutes, { gamesRouter } from './routes/deals.js';
import uploadRoutes from './routes/uploads.js';
import searchRoutes from './routes/search.js';
import { db } from './lib/store.js';
import { seedInitialData } from './lib/seed.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { parseTrustProxy, positiveInt } from './lib/env.js';
import { logger, httpLoggerOptions } from './lib/logger.js';
import { csrfProtection, ACCESS_TOKEN_TTL, REFRESH_COOKIE, clearSessionCookies, rotateRefreshSession, setSessionCookies } from './lib/sessions.js';
import { generateToken } from './middleware/auth.js';
import { isUnsetValue } from './lib/env.js';
import { assertAuthFeatureConfig } from './lib/authConfig.js';
import { createClient } from '@supabase/supabase-js';
import { startPresence, useSupabasePresence, listPresence, setPresence } from './lib/presence.js';
import { initErrorTracking, captureError, flushErrorTracking } from './lib/sentry.js';

// Sentry mora biti inicijalizovan PRE ruta (Express 4 nema automatsku
// instrumentaciju, ali SDK hvata `uncaughtException`/`unhandledRejection`).
initErrorTracking();

const app = express();
const PORT = process.env.PORT || 4000;

/**
 * Render/Railway/Heroku proxy: bez ovoga `req.ip` je IP proksija i svi
 * korisnici dele jedan rate-limit budžet.
 *
 * Podrazumevano `false` — X-Forwarded-For se prihvata samo ako ga je postavio
 * proxy koji eksplicitno navedemo (broj hopova ili lista IP adresa). Inače svako
 * može da pošalje proizvoljan XFF i zaobiđe rate limit (F-05).
 *   TRUST_PROXY=1                      (jedan trusted proxy)
 *   TRUST_PROXY=10.0.0.0/8             (liste IP/CIDR adresa)
 */
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

/**
 * Produkcija bez mejl provajdera = korisnici ne mogu da verifikuju email ni
 * resetuju lozinku. Ranije je server samo logovao grešku pri slanju (F-02) —
 * bolje pasti na startu nego tiho imati polomljene tokove.
 */
function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (isUnsetValue(process.env.SUPABASE_URL) || isUnsetValue(process.env.SUPABASE_SERVICE_KEY)) {
    // Bez baze nema trajnih sesija ni 2FA — in-memory demo nije produkcija.
    logger.error('SUPABASE_URL i SUPABASE_SERVICE_KEY su obavezni u produkciji.');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY && !process.env.BREVO_API_KEY) {
    logger.error('RESEND_API_KEY ili BREVO_API_KEY je obavezan u produkciji (email verifikacija i reset lozinke).');
    process.exit(1);
  }
  if (!process.env.CLIENT_URL) {
    logger.error('CLIENT_URL je obavezan u produkciji — bez njega linkovi u mejlu vode na localhost.');
    process.exit(1);
  }
  // 2.5.4 — Turnstile / OAuth / 2FA: polovična konfiguracija ne sme tiho da degradira.
  assertAuthFeatureConfig(logger);
}
assertProductionConfig();
app.disable('x-powered-by');

// === LOGGING (Pino) ===
// `lib/logger.ts` daje čitljiv format u razvoju (jedan red po zahtevu) i JSON
// u produkciji. Serializatori su obavezni — bez njih pino-http upiše ceo
// Express `req`/`res` objekat (desetine KB po zahtevu).
app.use(pinoHttp({
  ...httpLoggerOptions,
  genReqId: (req, res) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.token'],
    censor: '[redacted]',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Bez noise-a: health check, Vite HMR i statika se ne loguju
  autoLogging: {
    ignore: (req) =>
      req.url === '/api/health' ||
      req.url?.startsWith('/@vite') ||
      req.url?.startsWith('/node_modules') ||
      req.url?.endsWith('.map'),
  },
}));

// === SECURITY MIDDLEWARE ===
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const rateLimitMessage = (message: string) => ({ error: message });
const shared = { standardHeaders: true as const, legacyHeaders: false as const };

/**
 * RATE LIMITING — namerno podeljen po osetljivosti:
 *  - general  400 / 15 min  (čitanje; profil šalje 4 requesta, a aplikacione
 *                           rute više ne troše auth budžet)
 *  - auth      10 / 15 min  (samo login/register/reset — brute force)
 *  - lookup    60 / 1 min   (check-username / check-email — kucanje u formi)
 *  - subscribe 10 / 1 h     (newsletter)
 */
const generalLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: positiveInt(process.env.RATE_LIMIT_READ_MAX, 400),
  message: rateLimitMessage('Previše zahteva. Pokušajte ponovo za nekoliko minuta.'),
});

const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: positiveInt(process.env.RATE_LIMIT_AUTH_MAX, 20),
  skipSuccessfulRequests: true,
  message: rateLimitMessage('Previše pokušaja prijave. Pokušajte ponovo za 15 minuta.'),
});

const lookupLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  max: positiveInt(process.env.RATE_LIMIT_LOOKUP_MAX, 60),
  message: rateLimitMessage('Previše provera dostupnosti. Sačekajte trenutak.'),
});

const subscribeLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: rateLimitMessage('Previše pokušaja pretplate. Pokušajte kasnije.'),
});

// Kolekcije (IP ključ): SAMO kreiranje nove kolekcije (`POST /api/forum/:subforum`).
// Ne sme `app.use('/api/forum/:subforum', ...)` — poklopilo bi i GET liste tema
// (`/api/forum/:subforum/threads`) i trošilo bi 20/h budžet na obično čitanje.
const collectionLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  max: positiveInt(process.env.COLLECTION_RATE_LIMIT, 20),
  message: rateLimitMessage('Previše novih kolekcija. Pokušajte kasnije.'),
});
app.post('/api/forum/:subforum', collectionLimiter);

// Provere dostupnosti imaju svoj, labaviji limit — PRE auth limitera
app.use('/api/auth/check-username', lookupLimiter);
app.use('/api/auth/check-email', lookupLimiter);

// Strogi limit samo za osetljive auth akcije
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
// F-33 — drugi korak 2FA je i dalje pokušaj prijave (kod od 6 cifara).
app.use('/api/auth/2fa/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

/**
 * Limit po nalogu (email), nezavisno od IP-a. IP limiter sam ne pomaže protiv
 * botnete sa rotirajućim IP-jevima; ovaj broji pokušaje za isti email.
 * Registruje se pre `express.json()`, pa se email čita u buffered keyGenerator-u
 * (telu je dostupno jer rate-limit 7 podržava async keyGenerator).
 */
const emailKeyedLimiter = (options: { windowMs: number; max: number; message: string }) => {
  return rateLimit({
    ...options,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: async (req) => {
      const raw = (req as any).body?.email;
      const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return email ? `email:${email}` : `ip:${req.ip ?? 'unknown'}`;
    },
    // Bez email-a (neispravan zahtev) — ne troši budžet.
    skip: (req) => typeof (req as any).body?.email !== 'string' || !(req as any).body.email.trim(),
  });
};

const accountLimiter = emailKeyedLimiter({
  windowMs: 15 * 60 * 1000,
  max: positiveInt(process.env.RATE_LIMIT_ACCOUNT_MAX, 10),
  message: 'Previše pokušaja za ovaj nalog. Sačekajte 15 minuta.',
});
app.use('/api/auth/login', accountLimiter);
app.use('/api/auth/forgot-password', accountLimiter);
// F-33 — 2FA korak ima svoj, stroži budžet po tiketu (tiket je vezan za nalog).
app.use(
  '/api/auth/2fa/login',
  rateLimit({
    ...shared,
    windowMs: 15 * 60 * 1000,
    max: positiveInt(process.env.RATE_LIMIT_2FA_MAX, 8),
    skipSuccessfulRequests: true,
    message: rateLimitMessage('Previše pokušaja koda. Sačekajte 15 minuta.'),
  }),
);

app.use('/api/newsletter/subscribe', subscribeLimiter);

/**
 * 2.6.2 — pretraga (`/api/search`) je javna i skupa (trigram RPC): sopstveni
 * budžet po IP-u, da kucanje u navbaru ne troši opšti limit čitanja.
 */
const searchLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  max: positiveInt(process.env.RATE_LIMIT_SEARCH_MAX, 30),
  message: rateLimitMessage('Previše pretraga. Sačekajte trenutak.'),
});
app.use('/api/search', searchLimiter);

/**
 * Limit po korisniku (ne samo po IP-u): spročava da jedan nalog zatrpa forum.
 * Ključ je `userId` iz verifikovanog tokena; gosti padaju na IP iz `authenticate`.
 *
 * Registruje se PRE `app.use('/api/forum', ...)` — middleware posle rute se
 * nikad ne izvrši. Limiter ne čita telo zahteva, pa je mesto ispravno i pre
 * `express.json()`.
 */
function userScopedLimiter(options: { windowMs: number; max: number; message: string }) {
  return rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth = (req as any).user as { id?: string } | undefined;
      if (auth?.id) return `user:${auth.id}`;
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : ((req as any).cookies?.nx_at ?? (req as any).cookies?.token);
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id?: string };
          if (decoded.id) return `user:${decoded.id}`;
        } catch {
          // nevažeći token → IP limit (sam `authenticate` će vratiti 401)
        }
      }
      return `ip:${req.ip ?? 'unknown'}`;
    },
  });
}

// Teme: 10 na 10 min po korisniku; odgovori: 30 na 10 min po korisniku.
const threadCreateLimiter = userScopedLimiter({
  windowMs: 10 * 60 * 1000,
  max: positiveInt(process.env.THREAD_RATE_LIMIT, 10),
  message: 'Previše novih tema. Sačekajte nekoliko minuta pre sledeće.',
});
const replyCreateLimiter = userScopedLimiter({
  windowMs: 10 * 60 * 1000,
  max: positiveInt(process.env.REPLY_RATE_LIMIT, 30),
  message: 'Previše odgovora u kratkom periodu. Sačekajte nekoliko minuta.',
});
app.post('/api/forum/:subforum/threads', threadCreateLimiter);
app.post('/api/forum/threads/:threadId/comments', replyCreateLimiter);
app.post('/api/articles/:id/comments', replyCreateLimiter);

/** 2.6.0 — objava deal-ova i glasovi (po korisniku, ne po IP-u). */
const dealCreateLimiter = userScopedLimiter({
  windowMs: 60 * 60 * 1000,
  max: positiveInt(process.env.DEAL_RATE_LIMIT, 10),
  message: 'Previše novih deal-ova. Sačekajte nekoliko minuta.',
});
const dealVoteLimiter = userScopedLimiter({
  windowMs: 10 * 60 * 1000,
  max: positiveInt(process.env.DEAL_VOTE_RATE_LIMIT, 60),
  message: 'Previše glasova u kratkom periodu. Sačekajte trenutak.',
});
// Precizne putanje (ne `/api/deals` u celini) — čitanje liste ne troši budžet.
app.post('/api/deals', dealCreateLimiter);
app.post('/api/deals/:id/vote', dealVoteLimiter);
// 2.6.2 — čitanje ponude je serverski fetch: ograničeno po korisniku.
app.get('/api/deals/preview', userScopedLimiter({
  windowMs: 10 * 60 * 1000,
  max: positiveInt(process.env.DEAL_PREVIEW_RATE_LIMIT, 40),
  message: 'Previše provera linkova. Sačekajte nekoliko minuta.',
}));

app.use('/api/', generalLimiter);

// HPP protection (HTTP Parameter Pollution)
app.use(hpp());

// === GENERAL MIDDLEWARE ===
// CLIENT_URL može biti lista domena razdvojena zapetom (www + apex + preview).
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Bez `Origin` zaglavlja (server→server, curl, health check) — dozvoli.
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
      // F-25 — nedozvoljen Origin NIJE greška servera: `callback(new Error(...))`
      // je ranije davalo 500 (i stack u razvoju). CORS middleware preskače
      // zaglavlja, a odbijanje se vraća kao 403 ispod.
      return callback(null, false);
    },
    credentials: true,
  }),
);

// F-25 — eksplicitno 403 za browser zahteve sa nedozvoljenog origina.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || !req.path.startsWith('/api/')) return next();
  if (allowedOrigins.includes(origin.replace(/\/$/, ''))) return next();
  return res.status(403).json({ error: 'Origin nije dozvoljen.' });
});

/**
 * F-32 — access cookie se izdaje sa 15 min rokom. SPA koja ostane otvorena
 * duže od toga mora da i dalje bude prijavljena, a `/auth/me` NE sme da odgovori
 * 401 samo zato što je access istekao: klijent bi pomislio da je sesija mrtva.
 * Zato GET `/auth/me` tiho rotira refresh cookie pre nego što ga obradi.
 */
app.use('/api/auth/me', async (req, res, next) => {
  const refreshToken = (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE];
  if (!refreshToken) return next();

  try {
    const rotated = await rotateRefreshSession(refreshToken, req);
    if (rotated.ok) {
      const user = await db.users.findById(rotated.userId);
      // 2.6.1 — klijent zove `/auth/me` i pri povratku u tab: to je i otkucaj.
      if (user) setPresence(user.id, true).catch(() => {});
      if (user) {
        setSessionCookies(res, {
          accessToken: generateToken(
            { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
            ACCESS_TOKEN_TTL,
          ),
          refreshToken: rotated.token,
          refreshExpiresAt: rotated.expiresAt,
        });
      }
    } else {
      clearSessionCookies(res);
    }
  } catch (err) {
    // Ne blokiraj `/auth/me` — `authenticate` će odlučiti (401) ako nema sesije.
    req.log?.warn({ err }, 'silent_refresh_failed');
  }
  return next();
});

app.use(compression());

/**
 * Body limit: 100 KB za sve rute (dovoljno za tekst/teme/članke).
 * Veći limit ide samo na eksplicitne upload rute.
 */
const BODY_LIMIT = process.env.BODY_LIMIT || '100kb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(cookieParser());

/**
 * F-32 — CSRF zaštita (double-submit cookie).
 * Primenjuje se na mutirajuće API zahteve koji se oslanjaju na HttpOnly cookie
 * sesiju; čist Bearer/Swagger klijent bez cookie-ja prolazi nepromenjen.
 */
app.use('/api/', csrfProtection);

// === ROUTES ===
app.use('/api/auth/oauth', oauthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/forum', pollRoutes);
app.use('/api/users', userRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/deals', dealRoutes);
// Game Pages — isti prefiks `/api/games`; ruta `/:slug` vraća aktivne deal-ove.
app.use('/api/games', gamesRouter);
// 2.6.2 — Supabase Storage: avatar, cover igre, dokaz deal-a.
app.use('/api/uploads', uploadRoutes);
// 2.6.2 — objedinjena pretraga (članci + teme + deal-ovi, pg_trgm).
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 2.6.1 — „Online sada“: početno stanje za klijente bez Realtime WebSocket-a
 * (proxy koji ne propušta WS). `GET /api/auth/me` nosi sopstveni `isOnline`.
 *
 * 2.6.2 — dodato `statuses` (`{ userId: 'online' | 'away' }`); `online` ostaje
 * kao lista ID-jeva radi kompatibilnosti sa starijim klijentima.
 */
app.get('/api/presence', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const presence = await listPresence();
    const statuses: Record<string, string> = {};
    for (const entry of presence) statuses[entry.userId] = entry.status;
    res.json({
      online: presence.filter((entry) => entry.status === 'online').map((entry) => entry.userId),
      statuses,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * F-19 — SEO fajlovi.
 *
 * SPA build servira `index.html` za svaku putanju, pa `/robots.txt` i
 * `/sitemap.xml` moraju da postanu prave rute. Sitemap se gradi iz baze
 * (objavljeni članci + aktivne teme); kešira se 10 minuta.
 */
const seoBaseUrl = () =>
  (process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || `http://localhost:${PORT}`)
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

app.get('/robots.txt', (_req, res) => {
  const base = seoBaseUrl();
  res
    .type('text/plain')
    .send(['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', `Sitemap: ${base}/sitemap.xml`, ''].join('\n'));
});

let sitemapCache: { at: number; xml: string } | null = null;
const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);

app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (!sitemapCache || now - sitemapCache.at > 10 * 60 * 1000) {
      const base = seoBaseUrl();
      const [articles, threads] = await Promise.all([
        db.articles.findAll({ status: 'published' }),
        db.forum.listThreads({ sort: 'new', limit: 500 }),
      ]);
      const urls = [
        { loc: `${base}/`, lastmod: new Date().toISOString(), priority: '1.0' },
        { loc: `${base}/forum`, lastmod: new Date().toISOString(), priority: '0.8' },
        ...articles.map((a) => ({
          loc: `${base}/article/${a.slug || a.id}`,
          lastmod: a.updatedAt ?? a.publishedAt ?? a.createdAt,
          priority: '0.9',
        })),
        ...threads
          .filter((t) => !t.isDeleted)
          .map((t) => ({ loc: `${base}/thread/${t.id}`, lastmod: t.lastReplyAt ?? t.createdAt, priority: '0.6' })),
      ];
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(
          (u) =>
            `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}<priority>${u.priority}</priority></url>`,
        ),
        '</urlset>',
      ].join('\n');
      sitemapCache = { at: now, xml };
    }
    res.type('application/xml').send(sitemapCache.xml);
  } catch (err) {
    next(err);
  }
});

// 404 i centralni error handler (generičke poruke u produkciji + Pino log)
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, async () => {
  // F-32 — bez `auth_sessions` nijedna prijava ne bi radila (500 na login).
  // Bolje pasti na startu sa jasnom porukom nego otkriti to u produkciji.
  try {
    await db.sessions.deleteExpired(new Date(0).toISOString());
  } catch (err: any) {
    logger.error(
      { err },
      'Tabela auth_sessions nije dostupna — pokreni`server/schema-ALL.sql` u Supabase SQL editoru.',
    );
    if (process.env.NODE_ENV === 'production') process.exit(1);
  }

  // Demo seed data must never be inserted into staging/production databases.
  if (process.env.NODE_ENV === 'development') {
    try {
      await seedInitialData(db);
    } catch (err) {
      logger.error({ err }, 'seed_failed');
    }
  } else {
    logger.info('Skipping demo seed outside development.');
  }
  // 2.6.1 — prisustvo: Supabase tabela (ako je baza podešena) + TTL sweeper.
  if (db.kind === 'supabase') {
    useSupabasePresence(
      createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
        auth: { persistSession: false },
      }),
    );
  }
  startPresence();

  logger.info(`NEXUS API Server running on http://localhost:${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/api/health`);
});

// Greške van HTTP ciklusa (background task, odbijen promise) idu u Sentry i log.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled_rejection');
  captureError(reason, { source: 'unhandledRejection' });
});
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'uncaught_exception');
  captureError(error, { source: 'uncaughtException' });
});

// Graceful shutdown: isprazni Sentry red pre nego što proces nestane.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void flushErrorTracking().finally(() => process.exit(0));
  });
}
