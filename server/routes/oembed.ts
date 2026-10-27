import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger.js';

/**
 * F-7 — OEMBED / OPENGRAPH PREVIEW PROXY
 * --------------------------------------
 * `GET /api/oembed?url=<https-url>` vraća metapodatke (naslov, opis, thumbnail,
 * autora) za preview kartice u forumskim temama i člancima.
 *
 * Bezbednost:
 *  1. WHITELIST — samo poznati embed provajderi vraćaju iframe HTML (klijent ga
 *     ionako ne koristi sirovog; koristi programski sklopljen iframe iz
 *     `src/lib/mediaEmbeds.ts`). Svi ostali domeni -> samo og metapodatci,
 *     bez ikakvog HTML-a.
 *  2. SSRF zaštita — URL se validira PRE fetch-a: samo http(s), blok
 *     localhost/privatni/link-local IP rasponi po imenu hosta i rešenim IP-jem.
 *  3. Keš — in-memory Map sa TTL (isti obrazac kao `routes/live.ts`), da
 *     ne pogađamo spoljni svet za svaki prikaz iste teme.
 *  4. Rate limit + timeout — bez beskonačnih kačenja na spoljne hostove.
 */

const router = express.Router();

const oembedLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Previše oEmbed zahteva. Sačekajte minut.' },
});

/** In-memory keš: url -> { data, expiresAt }. */
const cache = new Map<string, { data: PreviewPayload; expiresAt: number }>();
const TTL_MS = 30 * 60 * 1000; // 30 min
const CACHE_MAX = 500; // cap memorije (LRF: evict najstariji)

export interface PreviewPayload {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  author?: string;
  provider?: string;
}

/** SSRF: hostname / IP dozvoljeni SAMO ako su javni. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  // IPv4 literal — privatni rezervisani rasponi
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
  }
  // IPv6 literal — loopback, link-local, ULA, NAT64
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '');
    if (h === '::' || h === '::1') return true;
    if (/^f[cd]/i.test(h)) return true; // fc00::/7 ULA
    if (/^fe[89ab]/i.test(h)) return true; // link-local
    if (h.startsWith('::ffff:')) return isBlockedHost(h.slice(7));
  }
  return false;
}

/** DNS rezolucija i provera rešene IP (protiv DNS-rebinding SSRF-a). */
async function resolvesToPublicIp(hostname: string): Promise<boolean> {
  const dns = await import('node:dns/promises');
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return false;
    return records.every((r) => !isBlockedHost(r.address));
  } catch {
    return false; // ne-rezolviran domen -> ne pokušavamo fetch
  }
}

/** OpenGraph/HTML meta ekstrakcija (bez HTML parsera — meta tag regexi). */
export function extractMeta(html: string, baseUrl: string): PreviewPayload {
  const pick = (pattern: RegExp): string | undefined => {
    const value = html.match(pattern)?.[1];
    if (!value) return undefined;
    // Escape za bezbedan JSON/HTML consumer — skidamo kontrolne znakove.
    return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 300) || undefined;
  };
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<title[^>]*>([^<]+)<\/title>/i);
  const rawImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  let image: string | undefined;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      image = resolved.protocol === 'https:' ? resolved.href : undefined;
    } catch {
      /* ignore */
    }
  }
  return {
    url: baseUrl,
    title,
    description: pick(/<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["']/i),
    image,
    author: pick(/<meta[^>]+(?:name=["']author["']|property=["']og:site_name["'])[^>]+content=["']([^"']+)["']/i),
  };
}

router.get('/oembed', oembedLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = String(req.query.url ?? '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'Neispravan URL.' });
    }
    if (url.protocol !== 'https:') {
      return res.status(400).json({ error: 'Dozvoljen je samo https URL.' });
    }
    if (isBlockedHost(url.hostname)) {
      return res.status(400).json({ error: 'URL nije dozvoljen.' });
    }
    if (!(await resolvesToPublicIp(url.hostname))) {
      return res.status(400).json({ error: 'URL nije dozvoljen.' });
    }

    const cacheKey = url.href;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
      headers: { 'User-Agent': 'NexusForumBot/1.0 (+preview)', Accept: 'text/html' },
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'Izvor nije dostupan.' });
    }
    // Limitiran response — ne čitamo gigabajt "HTML-a"
    const maxBytes = 512 * 1024;
    const buffer = await response.arrayBuffer();
    const html = new TextDecoder().decode(buffer.slice(0, maxBytes));

    const data = extractMeta(html, url.href);
    data.provider = url.hostname;

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });

    return res.json(data);
  } catch (error) {
    // Timeout/ abdominal greške — loguj, vrati 502 (nemoj rušiti request pipeline)
    logger.warn({ error: (error as Error).message }, 'oembed_fetch_failed');
    return next(error);
  }
});

export default router;
