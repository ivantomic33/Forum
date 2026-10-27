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
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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
import guideRoutes from './routes/guides.js';
import uploadRoutes from './routes/uploads.js';
import searchRoutes from './routes/search.js';
import collectionRoutes from './routes/collections.js';
import liveRoutes from './routes/live.js';
// F-7 — oEmbed/OpenGraph preview proxy (whitelist + SSRF zaštita + keš).
import oembedRoutes from './routes/oembed.js';
import pushRoutes from './routes/push.js';
import buildRoutes from './routes/builds.js';
import { db } from './lib/store.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { parseTrustProxy, positiveInt } from './lib/env.js';
import { logger, httpLoggerOptions } from './lib/logger.js';
import { initPush } from './lib/pushNotification.js';
// N-13 — OG slika (1200×630) za prerender i mreže.
import { renderOgImage } from './lib/ogImage.js';
import { csrfProtection, ACCESS_TOKEN_TTL, CSRF_COOKIE, REFRESH_COOKIE, clearSessionCookies, rotateRefreshSession, setSessionCookies } from './lib/sessions.js';
import { generateToken } from './middleware/auth.js';
import { isUnsetValue } from './lib/env.js';
import { assertAuthFeatureConfig } from './lib/authConfig.js';
import { createClient } from '@supabase/supabase-js';
import { startPresence, useSupabasePresence, listPresence, setPresence, presenceMode } from './lib/presence.js';
import { initErrorTracking, captureError, flushErrorTracking } from './lib/sentry.js';
import { startNewsletterScheduler } from './lib/campaigns.js';
import { startWeeklyDigest } from './lib/digest.js';
import { startSteamPriceSync } from './lib/priceSync.js';
// 2.10.0 — zakazani članci (isti šablon tajmera kao newsletter).
import { startScheduledArticlePublisher } from './lib/scheduledArticles.js';
// Podešavanja sajta iz `site_meta` (prežive restart, dele se između instanci).
import { loadSiteSettings, getPublicSiteSettings, startSiteSettingsRefresher } from './lib/siteSettings.js';
import { loadIpBans, isIpBanned, startIpBansRefresher } from './lib/ipBans.js';
import dmRoutes from './routes/dm.js';

// Sentry mora biti inicijalizovan PRE ruta (Express 4 nema automatsku
// instrumentaciju, ali SDK hvata `uncaughtException`/`unhandledRejection`).
initErrorTracking();

export function createApp(): express.Express {
  const app = express();

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

/** `code` omogućava klijentu (5.2) da razlikuje rate limit od pogrešne lozinke. */
const rateLimitMessage = (message: string) => ({ error: message, code: 'RATE_LIMITED' });
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
  /**
   * 3.0.0 — JAVNI GET-ovi se ne broje.
   *
   * `general` budžet je bio 400/15 min po IP-u za SVE `/api/` zahteve, pa su
   * lista tema, članci, presence i notifikacije trošili isti budžet kao pisanje.
   * Posledica: posle normalnog pregleda (ili testova) server vraća 429 i na
   * `/api/auth/login` i na `/api/notifications`, pa korisnik ostane gost — a
   * profil gosta je 404 („stranica je otišla u drugi lobby“).
   *
   * Mutirajuće i osetljive rute (login, registracija, pretrage, pisanje) imaju
   * svoje, strože limitere — njih ovo ne dira.
   */
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
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
// Rotacija sesije nije pokušaj prijave, a dešava se na svakih 15 min po tabu.
// Bez ovoga `/auth/refresh` i `/auth/config` troše budžet od 20 i posle nekoliko
// sati rada blokiraju samu prijavu (429 umesto forme).
// F-33 — drugi korak 2FA je i dalje pokušaj prijave (kod od 6 cifara).
app.use('/api/auth/2fa/login', authLimiter);
// 5.2 — passkey je prijava: ista stroga politika (begin je javan).
app.use('/api/auth/passkeys/login', authLimiter);
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
 * N-13 — OG PODACI ZA PRERENDER
 * -----------------------------
 * `scripts/prerender.mjs` posle build-a pita ovaj endpoint za svaku javnu rutu
 * (`/`, `/article/:slug`, `/thread/:id`, `/games/:slug`) i u statici dobija
 * pravi `<title>`, `description` i `og:image` (1200×630). Bez baze odgovor je
 * 404 — prerender tada ostavlja SPA ljusku, ništa se ne obara.
 *
 * Registruje se PRE `userScopedLimiter` definicije da bi se izvršavao pre
 * opšteg limitera za čitanje (prerender zove serijski, iz jednog procesa).
 */
/**
 * N-13 — `GET /api/og/:type/:key` → PNG 1200×630.
 * Kešira se godinu dana; naslov dolazi iz query stringa (prerender ga upisuje u
 * `og:image`), pa je isti URL uvek ista slika.
 */
app.get('/api/og/:type/:key', async (req, res, next) => {
  try {
    const { type, key } = req.params;
    const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
    const subtitle = typeof req.query.subtitle === 'string' ? req.query.subtitle : '';
    const png = await renderOgImage({ title: title || 'NEXUS', subtitle, badge: type });
    // `key` je deo rute (`site`, `cover`) — slika je ista, menja se samo naslov.
    void key;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/png').send(png);
  } catch (err) {
    next(err);
  }
});

app.get('/api/prerender/meta', async (req, res, next) => {
  try {
    const type = String(req.query.type ?? '');
    // `sitemap-source` ne nosi ključ — samo og:image i ostale rute traže `key`.
    const key = String(req.query.key ?? req.query.slug ?? req.query.id ?? '').trim();
    if (!key && type !== 'sitemap-source' && type !== 'home') {
      return res.status(400).json({ error: 'Nedostaje `key`.' });
    }

    const base = ((process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`)
      .split(',')[0] || '').trim().replace(/\/$/, '');
    const ogImage = (title: string, subtitle?: string) =>
      `${base}/api/og/site/${encodeURIComponent(type || 'site')}` +
      `?title=${encodeURIComponent(title)}${subtitle ? `&subtitle=${encodeURIComponent(subtitle)}` : ''}`;

    if (type === 'article') {
      const article =
        (await db.articles.findBySlug(key)) ?? (await db.articles.findById(key));
      if (!article || (article.status && article.status !== 'published')) {
        return res.status(404).json({ error: 'Članak nije pronađen.' });
      }
      const description = article.excerpt || article.title;
      return res.json({
        path: `/article/${article.slug || article.id}`,
        title: article.title,
        description,
        type: 'article',
        image: article.coverImage
          ? `${base}/api/og/article/cover?src=${encodeURIComponent(article.coverImage)}&title=${encodeURIComponent(article.title)}`
          : ogImage(article.title, article.category),
        publishedTime: article.publishedAt ?? article.createdAt,
        modifiedTime: article.updatedAt,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: article.title,
          description,
          datePublished: article.publishedAt ?? article.createdAt,
          dateModified: article.updatedAt,
          author: { '@type': 'Person', name: article.author },
        },
      });
    }

    if (type === 'game') {
      const game = await db.games.findBySlug(key);
      if (!game) return res.status(404).json({ error: 'Igra nije pronađena.' });
      return res.json({
        path: `/games/${game.slug}`,
        title: `${game.title} — najbolje cene i popusti`,
        description: `Najjeftinije ponude za ${game.title} iz svih prodavnica, sa proverom cene i rokom trajanja akcije.`,
        type: 'website',
        image: game.coverUrl
          ? `${base}/api/og/article/cover?src=${encodeURIComponent(game.coverUrl)}&title=${encodeURIComponent(game.title)}`
          : ogImage(game.title, 'Popusti'),
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'VideoGame',
          name: game.title,
          image: game.coverUrl ?? undefined,
          datePublished: game.releaseDate ?? undefined,
        },
      });
    }

    if (type === 'thread') {
      const thread = await db.forum.findThread(key);
      if (!thread || thread.isDeleted) return res.status(404).json({ error: 'Tema nije pronađena.' });
      // 6.x — SEO za TEME: bogatiji opis (odgovori, rešeno) i `acceptedAnswer`
      // u JSON-LD, pa Google prikaže „Rešeno“ pitanje sa odgovorom umesto golog
      // linka. Upit je jedan (`acceptedReplyId` čita se uz temu).
      const accepted = thread.acceptedReplyId
        ? await db.forum.findReply(thread.acceptedReplyId).catch(() => null)
        : null;
      const replyWord = thread.replies === 1 ? 'odgovor' : 'odgovora';
      const description = accepted
        ? `${thread.title} — rešena diskusija u ${thread.subforum} na NEXUS forumu (${thread.replies} ${replyWord}).`
        : `${thread.title} — diskusija u ${thread.subforum} na NEXUS forumu (${thread.replies} ${replyWord}).`;
      return res.json({
        path: `/thread/${thread.id}`,
        title: thread.title,
        description,
        type: 'article',
        image: ogImage(thread.title, `${thread.subforum}${accepted ? ' · Rešeno' : ''}`),
        publishedTime: thread.createdAt,
        modifiedTime: thread.lastReplyAt ?? thread.createdAt,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'DiscussionForumPosting',
          headline: thread.title,
          datePublished: thread.createdAt,
          dateModified: thread.lastReplyAt ?? thread.createdAt,
          author: { '@type': 'Person', name: thread.author },
          // Sadržaj pitanja je HTML — crawleri ga prihvataju kao tekst bez tagova.
          articleBody: String(thread.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          commentCount: thread.replies ?? 0,
          ...(accepted && accepted.authorId
            ? {
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: String(accepted.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200),
                  dateCreated: accepted.createdAt,
                  author: { '@type': 'Person', name: accepted.author },
                },
              }
            : {}),
        },
      });
    }

    // Meta za `articles` i `threads` vraćamo u jednom pozivu (lista slugova za prerender).
    if (type === 'sitemap-source') {
      const [articles, threads, games] = await Promise.all([
        db.articles.findAll({ status: 'published', publishedBefore: new Date().toISOString() }),
        db.forum.listThreads({ sort: 'new', limit: 300 }),
        db.games.listWithDeals(60).catch(() => []),
      ]);
      return res.json({
        articles: articles.map((a) => a.slug || a.id),
        threads: threads.filter((t) => !t.isDeleted).map((t) => t.id),
        games: games.map((g) => g.slug),
      });
    }

    return res.json({
      path: '/',
      title: 'NEXUS — gejming portal i forum',
      description: 'Gejming vesti, recenzije, popusti i forum sa reputacijom — sve na jednom mestu.',
      type: 'website',
      image: ogImage('NEXUS', 'Gejming portal i forum'),
    });
  } catch (err) {
    next(err);
  }
});

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
          // Zadrži token iz zahteva — rotacija `nx_csrf` na svakom `/auth/me`
          // bi ostavila klijentovo zaglavlje zastarelim (videti `setSessionCookies`).
          currentCsrfToken: (req.cookies as Record<string, string | undefined>)?.[CSRF_COOKIE],
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

/**
 * REŽIM ODRŽAVANJA (maintenance mode)
 * -----------------------------------
 * Kada je admin uključio `maintenanceMode` (site_meta → /admin/settings), svaki
 * API zahtev osim „bezbednih“ dobija 503 sa JSON porukom i `Retry-After`.
 *
 * Izuzeci (moraju da rade da bi admin/moderator mogao da radi i da se ljudi
 * mogu prijaviti/odjaviti):
 *  - `/api/admin/*`        — admin panel (uključujući i gašenje mode-a)
 *  - `/api/auth/me`        — spa ko ko ho da zna ko je (layout/banner)
 *  - `/api/auth/login`     — prijava admina
 *  - `/api/auth/logout`    — odjava
 *  - `/api/auth/refresh`   — osvežavanje sesije
 *  - `/api/health`         — monitoring uptime-a
 *
 * Middleware se oslanja na keširana podešavanja (`getPublicSiteSettings`) koja
 * `updateSiteSettings` odmah osvežava — promena deluje trenutno, bez restarta.
 */
const MAINTENANCE_ALLOWED = (path: string): boolean => {
  // Mount je na `/api/`, pa je `req.path` relativan (`/articles`, ne `/api/articles`)
  // — pokrivamo oba oblika da middleware radi i ako se premešta.
  const p = path.startsWith('/api/') ? path.slice(4) : path;
  return (
    p === '/health' ||
    p === '/admin' ||
    p.startsWith('/admin/') ||
    p === '/auth/me' ||
    p === '/auth/login' ||
    p === '/auth/logout' ||
    p === '/auth/refresh'
  );
};

app.use('/api/', (req, res, next) => {
  // IP ban lista — banovan IP ne sme ni da vidi API (osim health da ne baca
  // monitoring alarme). Proverava se na svakom zahtevu (keš u memoriji, jeftino).
  if (isIpBanned(req.ip ?? '') && req.path !== '/health') {
    return res.status(403).json({ error: 'Pristup sa ove IP adrese je blokiran od strane administratora.', code: 'IP_BANNED' });
  }

  const settings = getPublicSiteSettings();
  if (!settings.maintenanceMode || MAINTENANCE_ALLOWED(req.path)) return next();
  // Ulogovani admin/moderator može sve i u održavanju (radi == za admin panel).
  const role = (req as any).user?.role;
  if (role === 'admin' || role === 'moderator') return next();
  res.set('Retry-After', '300');
  res.status(503).json({
    error: settings.maintenanceMessage || 'Sajt je trenutno u režimu održavanja. Vratite se uskoro!',
    maintenance: true,
  });
});

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
// 2.8.0 — community vodiči (`/api/games/:slug/guides`, `/api/guides/:id/vote`).
app.use('/api', guideRoutes);
// 2.6.2 — Supabase Storage: avatar, cover igre, dokaz deal-a.
app.use('/api/uploads', uploadRoutes);
// 2.6.2 — objedinjena pretraga (članci + teme + deal-ovi, pg_trgm).
app.use('/api/search', searchRoutes);
// F-5 — korisničke liste igara (`/collections/:slug` je javna SEO stranica).
app.use('/api/collections', collectionRoutes);
// F-6 — Twitch „uživo“ status za traku na profilu (ključevi ostaju na serveru).
app.use('/api/live', liveRoutes);
// F-7 — oEmbed/OpenGraph preview za linkove u temama i člancima.
app.use('/api', oembedRoutes);
// F-7 — web push pretplate (VAPID ključ je javan; pretplata zahteva prijavu).
app.use('/api/push', pushRoutes);
// F-11 — kalkulator build-a (katalog komponenti + deljivi build-ovi).
app.use('/api/builds', buildRoutes);
// 2.11.0 — privatne poruke (DM); razgovor je par korisnika.
app.use('/api/dm', dmRoutes);
app.use('/api/admin', adminRoutes);

// Health check
//
// F-11 iz liste 7.1 — `db` i `presence` kažu KOJI sloj je stvarno aktivan.
// Bez toga „radi lokalno, ne radi u oblaku“ izgleda isto kao nesrećan
// `SUPABASE_SERVICE_KEY`; sa njim se vidi iz jednog `curl`-a.
// `checkDb()` je opciona prava provera baze (REST HEAD na `forum_threads` u
// Supabase režimu) — ne dere bazu i ne blokira više od 2 s.
async function checkDb(): Promise<'supabase' | 'memory'> {
  if (db.kind !== 'supabase') return 'memory';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return 'memory';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    timer.unref?.();
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/forum_threads?select=id&limit=1`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok ? 'supabase' : 'memory';
  } catch {
    return 'memory';
  }
}

app.get('/api/health', async (_req, res) => {
  const [dbMode, dbOk] = await Promise.all([Promise.resolve(db.kind), checkDb()]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: dbMode === dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    db: dbOk,
    presence: presenceMode.storage(),
    realtime: presenceMode.broadcast(),
    uptime: Math.round(process.uptime()),
  });
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
      const [articles, threads, guides] = await Promise.all([
        db.articles.findAll({ status: 'published', publishedBefore: new Date().toISOString() }),
        db.forum.listThreads({ sort: 'new', limit: 500 }),
        // 2.8.0 — objavljeni vodiči (long-tail SEO: „kako preći X“, „build za Y“).
        db.guides
          ? (async () => {
              const games = await db.games.listWithDeals(200).catch(() => []);
              const out: Array<{ gameSlug: string; guideSlug: string; updatedAt: string }> = [];
              for (const game of games) {
                const { guides } = await db.guides.listByGame(game.id, { sort: 'newest', limit: 50 }).catch(() => ({ guides: [] }));
                guides.forEach((guide) => out.push({ gameSlug: game.slug, guideSlug: guide.slug, updatedAt: guide.updatedAt }));
              }
              return out;
            })()
          : Promise.resolve([]),
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
        // 2.8.0 — vodiči: `/games/:gameSlug/guides/:guideSlug` (priority 0.7).
        ...guides.map((g) => ({
          loc: `${base}/games/${g.gameSlug}/guides/${g.guideSlug}`,
          lastmod: g.updatedAt,
          priority: '0.7',
        })),
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

/**
 * RSS 2.0 FEED (`/rss.xml`) — članci + popusti
 * -------------------------------------------
 * Isti obrazac kao `/sitemap.xml`: čist XML string, bez biblioteke, in-process
 * keš 10 min (čitači (Feedly/Thunderbird) pukuju često, a sadržaj se menja
 * retko). `Cache-Control` dozvoljava i CDN-u da kešira (`s-maxage=3600`).
 *
 * Struktura: RSS 2.0 + Atom namespace za obavezan `atom:link rel="self"`.
 * Stavke: 25 objavljenih članaka + 25 aktivnih deal-ova, spojeno po datumu,
 * maks. 50. Opis ide u CDATA (excerpt članka / cena deal-a); cover članka ide
 * u `<enclosure>` (browser/feed čitač prikazuje sliku).
 */
let rssCache: { at: number; xml: string } | null = null;

const rssCdata = (value: string) => `<![CDATA[${value.replace(/]]>/g, ']]&gt;')}]]>`;

app.get('/rss.xml', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (!rssCache || now - rssCache.at > 10 * 60 * 1000) {
      const base = seoBaseUrl();
      const [articles, dealsResult] = await Promise.all([
        db.articles.findAll({ status: 'published', publishedBefore: new Date().toISOString() }).catch(() => []),
        db.deals.list({ sort: 'newest', limit: 50, offset: 0 }).catch(() => ({ deals: [], total: 0 })),
      ]);

      interface FeedItem {
        title: string;
        link: string;
        pubDate: string;
        description: string;
        image?: string;
      }
      const items: FeedItem[] = [
        ...articles
          .slice(0, 25)
          .map((a) => ({
            title: a.title,
            link: `${base}/article/${a.slug || a.id}`,
            pubDate: (a.publishedAt ?? a.createdAt).toString(),
            description: a.excerpt || a.title,
            image: a.coverImage || undefined,
          })),
        ...dealsResult.deals
          .filter((d) => d.status === 'active' && (!d.expiresAt || new Date(d.expiresAt).getTime() > now))
          .slice(0, 25)
          .map((d) => ({
            title: `[DEAL] ${d.gameTitle || d.title} — -${d.discountPct}% (${d.price} ${d.currency})`,
            link: `${base}/deals/${d.id}`,
            pubDate: (d.updatedAt ?? d.createdAt).toString(),
            description: d.description || `${d.title} — ${d.price} ${d.currency} u prodavnici ${d.store}.`,
          })),
      ]
        .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
        .slice(0, 50);

      const lastBuildDate = items[0]?.pubDate ?? new Date().toISOString();
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        '  <channel>',
        `    <title>NEXUS Gaming Portal</title>`,
        `    <link>${escapeXml(base)}</link>`,
        `    <description>${escapeXml('Gejming vesti, recenzije, popusti i forum sa reputacijom — sve na jednom mestu.')}</description>`,
        `    <language>sr</language>`,
        `    <lastBuildDate>${new Date(lastBuildDate).toUTCString()}</lastBuildDate>`,
        `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
        ...items.map(
          (item) =>
            `    <item>` +
            `<title>${escapeXml(item.title)}</title>` +
            `<link>${escapeXml(item.link)}</link>` +
            `<guid isPermaLink="true">${escapeXml(item.link)}</guid>` +
            `<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>` +
            `<description>${rssCdata(item.description)}</description>` +
            (item.image ? `<enclosure url="${escapeXml(item.image)}" type="image/jpeg" />` : '') +
            `</item>`,
        ),
        '  </channel>',
        '</rss>',
      ].join('\n');
      rssCache = { at: now, xml };
    }
    res
      .set('Cache-Control', 'public, max-age=1800, s-maxage=3600')
      .type('application/rss+xml; charset=utf-8')
      .send(rssCache.xml);
  } catch (err) {
    next(err);
  }
});

// Prijazni aliasi — stariji čitači i ljudi pamte `/feed`; sve vodi na `/rss.xml`.
const redirectRss = (_req: express.Request, res: express.Response) => res.redirect(301, '/rss.xml');
app.get('/feed', redirectRss);
app.get('/feed.xml', redirectRss);
app.get('/rss', redirectRss);

// 404 i centralni error handler (generičke poruke u produkciji + Pino log)
app.use(notFoundHandler);
app.use(errorHandler);

  return app;
}

const PORT = process.env.PORT || 4000;

/**
 * Integracioni testovi (analiza §7.6) dobijaju ISTU aplikaciju bez `listen`-a —
 * inače bi rute/limiteri mogli da se razlikuju od produkcije. Zato se sve vezuje
 * kroz `createApp()`; na dnu `index.ts` samo sluša na portu.
 */
/**
 * N10 + N11 — START SAMO KADA JE OVO ULAZNI MODUL.
 *
 * `server/e2e/server.ts` uvozi `createApp` iz ovog fajla; bez zaštite bi se pri
 * tome pokrenuo i DRUGI `listen` (port 4000) i E2E bi dobio dve baze. Zato se
 * slušanje vezuje za direktno pokretanje (`tsx index.ts` / `node dist/server/index.js`).
 */
const isEntrypoint = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(fs.realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
})();

const app = createApp();

if (isEntrypoint) {
  app.listen(PORT, async () => {
  // F-7 — web-push inicijalizacija: `setVapidDetails` jednom + upozorenje ako
  // ključevi nedostaju (server radi, ali push je isključen).
  initPush();

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

  // Demo seed je uklonjen — aplikacija startuje sa praznom, realnom bazom.
  // 2.6.1 — prisustvo: Supabase tabela (ako je baza podešena) + TTL sweeper.
  if (db.kind === 'supabase') {
    useSupabasePresence(
      createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
        auth: { persistSession: false },
      }),
    );
  }
  startPresence();
  // Podešavanja sajta (`site_meta`): keš se puni PRE saobraćaja, pa `/auth/register`
  // vidi ispravan `registrationOpen` već na prvom zahtevu posle restarta.
  await loadSiteSettings();
  // Režim održavanja i ostala podešavanja: osvežavaj keš svakih 60 s, pa se
  // promena upisana u bazu (ili sa druge instance) vidi bez restarta.
  startSiteSettingsRefresher();
  // IP ban lista: učitaj pre saobraćaja i osvežavaj svakih 60 s (druga instanca).
  await loadIpBans();
  startIpBansRefresher();
  // Zakazane newsletter kampanje (A/B + `scheduledAt`): tajmer 60 s, preživljava restart.
  startNewsletterScheduler();
  // F-8 — nedeljni digest (ponedeljak posle `DIGEST_HOUR`); `DIGEST_ENABLED=0` ga gasi.
  startWeeklyDigest();
  // F-4d — dnevna sinhronizacija Steam cena (posle `STEAM_SYNC_HOUR`, default 19);
  // `STEAM_SYNC_ENABLED=0` ga gasi. Cena pala → `notifyPriceWatchers` (in-app obaveštenje).
  startSteamPriceSync();
  // 2.10.0 — zakazani članci: `scheduled` → `published` kad istekne `published_at`;
  // tajmer 60 s, `SCHEDULED_ARTICLES_ENABLED=0` ga gasi.
  startScheduledArticlePublisher();

  logger.info(`NEXUS API Server running on http://localhost:${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/api/health`);
  });
}

// Greške van HTTP ciklusa (background task, odbijen promise) idu u Sentry i log.
if (isEntrypoint) {
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
}
