/**
 * DEALS / POPUSTI — domenska logika
 * ---------------------------------
 * Čista logika (bez Express-a i bez baze) da bi je mogli da testiramo:
 *  - tipovi zapisa koje vraća data layer,
 *  - normalizacija prodavnice/platforme i validacija cene/popusta,
 *  - bezbedna provera linkova (samo https, bez internih adresa),
 *  - izračunavanje popusta i vremena do isteka,
 *  - IGDB klijent (OAuth2 client credentials) sa keširanim tokenom.
 *
 * Zašto ovako: `server/schema-ALL.sql` računa `discount_pct` u bazi
 * (generated column), a ovaj modul daje ISTO izračunavanje i za in-memory
 * režim i za testove — jedan izvor istine za poslovna pravila.
 */

// =====================
// Tipovi
// =====================

export interface GameRecord {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  igdbId: number | null;
  createdAt: string;
}

export type DealSort = 'newest' | 'top' | 'discount' | 'expiring';
export type DealStatus = 'active' | 'expired' | 'removed';
export type DealVote = 'up' | 'down' | null;

export interface DealRecord {
  id: string;
  authorId: string;
  /** Popunjava se u ruti (users.avatar/username/role) — baza nema join. */
  author: string;
  authorAvatar?: string;
  authorRole?: string;
  /** Da li je autor potvrdio email (verifikaciona značaka pored imena). */
  authorVerified?: boolean;
  gameId: string | null;
  gameSlug: string | null;
  gameTitle: string | null;
  gameCover: string | null;
  title: string;
  url: string;
  proofUrl: string | null;
  /** Brojevi su `number` (u bazi su NUMERIC) — lakše za UI i testove. */
  price: number;
  originalPrice: number;
  discountPct: number;
  currency: string;
  store: string;
  platform: string;
  description: string | null;
  expiresAt: string | null;
  status: DealStatus;
  isVerified: boolean;
  score: number;
  createdAt: string;
  updatedAt: string;
  /** Glas prijavljenog korisnika (`null` za goste). */
  myVote?: DealVote;
}

export interface DealFilter {
  sort?: DealSort;
  gameId?: string;
  gameSlug?: string;
  store?: string;
  platform?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  search?: string;
  /** `true` = samo deals koji ističu u narednih 72h. */
  expiringSoon?: boolean;
  /** Uključi i istekle (default: false — samo aktivni). */
  includeExpired?: boolean;
  status?: DealStatus;
  authorId?: string;
  limit?: number;
  offset?: number;
}

export interface DealStatusResult {
  /** `changed=false` kada glas nije menjao stanje (npr. isti glas dvaput). */
  changed: boolean;
  delta: number;
  score: number;
}

// =====================
// Konstante
// =====================

export const DEAL_LIMITS = {
  titleMin: 5,
  titleMax: 160,
  descriptionMax: 2000,
  storeMax: 60,
  platformMax: 32,
  /** Gornja granica za cenu — sprečava besmislene vrednosti u UI sumi. */
  priceMax: 999_999.99,
} as const;

/**
 * Prodavnice koje nudimo kao sugestiju. Nije ograničenje — korisnik može da
 * unese bilo koju prodavnicu (npr. lokalnu radnju), ali se label normalizuje
 * da bi filter i statičke liste bili dosledni.
 */
export const DEAL_STORES = [
  { value: 'steam', label: 'Steam' },
  { value: 'epic', label: 'Epic Games Store' },
  { value: 'gog', label: 'GOG' },
  { value: 'humble', label: 'Humble Bundle' },
  { value: 'fanatical', label: 'Fanatical' },
  { value: 'greenmangaming', label: 'Green Man Gaming' },
  { value: 'battlenet', label: 'Battle.net' },
  { value: 'ubisoft', label: 'Ubisoft Store' },
  { value: 'ea', label: 'EA App' },
  { value: 'xbox', label: 'Xbox Store' },
  { value: 'playstation', label: 'PlayStation Store' },
  { value: 'nintendo', label: 'Nintendo eShop' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'keyshop', label: 'Keyshop / reseller' },
  { value: 'other', label: 'Drugo' },
] as const;

export const DEAL_PLATFORMS = [
  { value: 'pc', label: 'PC' },
  { value: 'steam', label: 'Steam' },
  { value: 'epic', label: 'Epic' },
  { value: 'gog', label: 'GOG' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'switch', label: 'Nintendo Switch' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'other', label: 'Drugo' },
] as const;

export const DEAL_CURRENCIES = ['EUR', 'USD', 'RSD', 'GBP'] as const;

/** Deals koji ističu u naredna 3 dana dobijaju „Ističe uskoro“ značku. */
export const EXPIRING_SOON_MS = 72 * 60 * 60 * 1000;

// =====================
// Normalizacija i validacija
// =====================

export const normalizeSlug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // skini dijakritike (č → c, ć → c…)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);

/** Label prodavnice iz slobodnog unosa: trim + kolabovanje razmaka. */
export const normalizeStore = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, DEAL_LIMITS.storeMax);

export const normalizePlatform = (value: unknown): string =>
  String(value ?? 'pc')
    .trim()
    .toLowerCase()
    .slice(0, DEAL_LIMITS.platformMax) || 'pc';

// =====================
// Normalizacija prodavnice / platforme
// =====================

/**
 * 2.6.2 — da li je Storage podešen (bez pravljenja klijenta). Import je ovde,
 * posle tipova — `storage.ts` ne uvozi `deals.ts`, pa nema kružne zavisnosti.
 */
import { storageConfigured } from './storage.js';

export const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? 'EUR').trim().toUpperCase();
  return (DEAL_CURRENCIES as readonly string[]).includes(code) ? code : 'EUR';
};

/** Label za prikaz prodavnice/platforme (`steam` → `Steam`). */
export const storeLabel = (value: string): string =>
  DEAL_STORES.find((item) => item.value === value.toLowerCase())?.label ?? value;

export const platformLabel = (value: string): string =>
  DEAL_PLATFORMS.find((item) => item.value === value.toLowerCase())?.label ?? value;

/**
 * Popust u procentima — isti izraz kao generated kolona u migraciji.
 * Cene se zaokružuju na dve decimale pre računa da 9.99/19.99 ne bi dalo 50.0/49.9.
 */
export function computeDiscountPct(price: number, originalPrice: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(originalPrice)) return 0;
  if (originalPrice <= 0 || price >= originalPrice) return 0;
  const pct = Math.round((1 - price / originalPrice) * 100);
  return Math.min(100, Math.max(0, pct));
}

const roundPrice = (value: number): number => Math.round(value * 100) / 100;

export interface DealInput {
  title: string;
  url: string;
  proofUrl?: string | null;
  price: number;
  originalPrice: number;
  currency?: string;
  store: string;
  platform?: string;
  description?: string | null;
  expiresAt?: string | null;
}

export type DealValidation =
  | {
    ok: true; value: Required<Omit<DealInput, 'proofUrl' | 'description' | 'expiresAt'>> & {
      proofUrl: string | null;
      description: string | null;
      expiresAt: string | null;
      discountPct: number;
    }
  }
  | { ok: false; error: string };

/**
 * Validira deal iz korisničkog unosa.
 *
 * Pravila koja su namerna (i testirana):
 *  - `price < originalPrice` — deal bez popusta nije deal (Original bi bio jednak ceni).
 *  - `originalPrice >= price` — omogućava „besplatno“ deal (price = 0).
 *  - `expiresAt` u prošlosti se odbija — sprečava „deal“ koji je već mrtav.
 *  - linkovi: samo `https://`, bez localhost/private IP — SSRF kroz „proveri link“.
 */
export function validateDealInput(input: DealInput): DealValidation {
  const title = String(input.title ?? '').trim();
  if (title.length < DEAL_LIMITS.titleMin) {
    return { ok: false, error: `Naslov mora imati najmanje ${DEAL_LIMITS.titleMin} karaktera.` };
  }
  if (title.length > DEAL_LIMITS.titleMax) {
    return { ok: false, error: `Naslov može imati najviše ${DEAL_LIMITS.titleMax} karaktera.` };
  }

  const url = String(input.url ?? '').trim();
  const urlCheck = checkExternalUrl(url, { field: 'Link prodavnice' });
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };

  const proof = input.proofUrl ? String(input.proofUrl).trim() : '';
  if (proof) {
    // `data:image` je legacy put (base64 u telu) — dozvoljen samo dok Storage
    // nije podešen, jer sa upload-om slika ima pravi URL i proveru host-a.
    const proofCheck = checkExternalUrl(proof, { field: 'Dokaz (screenshot)', allowDataImage: !storageConfigured() });
    if (!proofCheck.ok) return { ok: false, error: proofCheck.error };
  }

  const price = roundPrice(Number(input.price));
  const originalPrice = roundPrice(Number(input.originalPrice));

  if (!Number.isFinite(price) || !Number.isFinite(originalPrice)) {
    return { ok: false, error: 'Cena i originalna cena moraju biti brojevi.' };
  }
  if (price < 0 || originalPrice <= 0) {
    return { ok: false, error: 'Cena ne može biti negativna, a originalna cena mora biti veća od 0.' };
  }
  if (price > DEAL_LIMITS.priceMax || originalPrice > DEAL_LIMITS.priceMax) {
    return { ok: false, error: 'Cena je nerealno visoka. Proverite unete vrednosti.' };
  }
  if (originalPrice < price) {
    return { ok: false, error: 'Originalna cena ne može biti manja od trenutne cene.' };
  }
  if (price >= originalPrice) {
    return { ok: false, error: 'Popust je 0% — unesite akcijsku cenu manju od originalne.' };
  }

  const store = normalizeStore(input.store);
  if (store.length < 2) return { ok: false, error: 'Unesite prodavnicu (npr. Steam, Epic, GOG).' };

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Datum isteka nije ispravan.' };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ok: false, error: 'Datum isteka mora biti u budućnosti.' };
    }
    expiresAt = parsed.toISOString();
  }

  const description = input.description ? String(input.description).trim() : '';
  if (description.length > DEAL_LIMITS.descriptionMax) {
    return { ok: false, error: `Opis može imati najviše ${DEAL_LIMITS.descriptionMax} karaktera.` };
  }

  return {
    ok: true,
    value: {
      title,
      url,
      proofUrl: proof || null,
      price,
      originalPrice,
      currency: normalizeCurrency(input.currency),
      store,
      platform: normalizePlatform(input.platform),
      description: description || null,
      expiresAt,
      discountPct: computeDiscountPct(price, originalPrice),
    },
  };
}

// =====================
// Bezbednost linkova (SSRF)
// =====================

/** Hostovi koji pokazuju na lokalnu mrežu ili cloud metadata servis. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);
const PRIVATE_IP_RE =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export interface UrlCheckOptions {
  field?: string;
  /** Dozvoli `data:image/...` (samo za dokaz — baza čuva kao inline sliku). */
  allowDataImage?: boolean;
}

/**
 * Prihvata samo apsolutne `https://` linkove ka javnim hostovima.
 * `javascript:`, `data:` (osim slika za dokaz), `file:`, `ftp:` i privatni
 * hostovi se odbijaju — link se kasnije otvara korisniku i server ga nikad ne fetuje.
 */
export function checkExternalUrl(raw: string, options: UrlCheckOptions = {}): { ok: true } | { ok: false; error: string } {
  const field = options.field ?? 'Link';
  if (!raw) return { ok: false, error: `${field} je obavezan.` };
  if (raw.length > 2048) return { ok: false, error: `${field} je predugačak.` };

  if (options.allowDataImage && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(raw)) {
    return { ok: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: `${field} mora biti pun URL (npr. https://store.steampowered.com/...).` };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `${field} mora počinjati sa https://` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: `${field} ne sme sadržati korisničke podatke.` };
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || PRIVATE_IP_RE.test(host)) {
    return { ok: false, error: `${field} ne sme pokazivati na lokalnu adresu.` };
  }
  // IPv6 u zagradama (`[::1]` / `[fd00::1]`)
  if (host.startsWith('[') && (host.includes('::1') || host.startsWith('[fd') || host.startsWith('[fc'))) {
    return { ok: false, error: `${field} ne sme pokazivati na lokalnu adresu.` };
  }

  return { ok: true };
}

// =====================
// Sortiranje i stanje
// =====================

export const isExpired = (deal: Pick<DealRecord, 'expiresAt' | 'status'>, now = Date.now()): boolean => {
  if (deal.status === 'expired') return true;
  return Boolean(deal.expiresAt && new Date(deal.expiresAt).getTime() <= now);
};

export const isExpiringSoon = (deal: Pick<DealRecord, 'expiresAt' | 'status'>, now = Date.now()): boolean => {
  if (!deal.expiresAt || isExpired(deal, now)) return false;
  const left = new Date(deal.expiresAt).getTime() - now;
  return left <= EXPIRING_SOON_MS;
};

/** Ljudski „ističe za 5h“ / „za 3 dana“ za kartice i detalje. */
export function timeLeftLabel(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(left)) return null;
  if (left <= 0) return 'istekao';
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `za ${hours} h`;
  const days = Math.round(hours / 24);
  return `za ${days} dana`;
}

/** Komparator za sve redisortove u in-memory adapteru i testove. */
export function compareDeals(a: DealRecord, b: DealRecord, sort: DealSort): number {
  const byNew = () => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  switch (sort) {
    case 'top':
      return b.score - a.score || byNew();
    case 'discount':
      return b.discountPct - a.discountPct || b.score - a.score || byNew();
    case 'expiring': {
      // Deals bez roka idu na kraj; najbliži rok prvi.
      const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || byNew();
    }
    case 'newest':
    default:
      return byNew();
  }
}

/**
 * Filtrira listu deal-ova. Koristi je in-memory adapter i ruta (za Supabase
 * filteri idu u SQL, ali `search` se ovde normalizuje na isti način).
 */
export function filterDeals(deals: DealRecord[], filter: DealFilter = {}, now = Date.now()): DealRecord[] {
  const q = filter.search?.trim().toLowerCase();
  return deals.filter((deal) => {
    if (filter.status) {
      if (deal.status !== filter.status) return false;
    } else if (filter.includeExpired) {
      if (deal.status === 'removed') return false;
    } else if (deal.status !== 'active' || isExpired(deal, now)) {
      return false;
    }
    if (filter.authorId && deal.authorId !== filter.authorId) return false;
    if (filter.gameId && deal.gameId !== filter.gameId) return false;
    if (filter.gameSlug && deal.gameSlug !== filter.gameSlug) return false;
    if (filter.store && deal.store.toLowerCase() !== filter.store.toLowerCase()) return false;
    if (filter.platform && deal.platform.toLowerCase() !== filter.platform.toLowerCase()) return false;
    if (typeof filter.minPrice === 'number' && deal.price < filter.minPrice) return false;
    if (typeof filter.maxPrice === 'number' && deal.price > filter.maxPrice) return false;
    if (typeof filter.minDiscount === 'number' && deal.discountPct < filter.minDiscount) return false;
    if (filter.expiringSoon && !isExpiringSoon(deal, now)) return false;
    if (q) {
      const haystack = `${deal.title} ${deal.store} ${deal.gameTitle ?? ''} ${deal.description ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// =====================
// IGDB klijent
// =====================

export interface IgdbSettings {
  clientId: string;
  clientSecret: string;
  configured: boolean;
}

/**
 * IGDB ne koristi jedan API key: prijava ide preko Twitch aplikacije
 * (dev.twitch.tv → Register Your Application), a IGDB traži
 * OAuth2 „client credentials“ tok. Podržavamo i `IGDB_API_KEY`, tj. već
 * izdat access token (korisno za testiranje).
 */
export function igdbSettings(env: NodeJS.ProcessEnv = process.env): IgdbSettings {
  const clientId = String(env.IGDB_CLIENT_ID ?? '').trim();
  const clientSecret = String(env.IGDB_CLIENT_SECRET ?? '').trim();
  const apiKey = String(env.IGDB_API_KEY ?? '').trim();
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && (clientSecret || apiKey)),
  };
}

export interface IgdbGame {
  igdbId: number;
  name: string;
  slug: string;
  coverUrl: string | null;
  releaseDate: string | null;
}

const IGDB_TOKEN_TTL_MS = 50 * 24 * 60 * 60 * 1000; // IGDB token traje ~60 dana
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Za testove / reset. */
export function resetIgdbTokenCache(): void {
  cachedToken = null;
}

/**
 * Dohvata (`raw`) preko IGDB API-ja. `cache: 'no-store'` jer server kešira token
 * sam; ako IGDB padne, vraćamo praznu listu — pretraga igre je opciona i ne sme
 * da obori formu za objavu deal-a.
 */
export async function igdbQuery<T = IgdbGame>(
  endpoint: 'games',
  body: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<T[]> {
  const settings = igdbSettings(env);
  if (!settings.configured) return [];

  try {
    let token = env.IGDB_API_KEY?.trim() || '';
    if (!token) {
      if (!cachedToken || cachedToken.expiresAt <= Date.now()) {
        const tokenRes = await fetchImpl('https://id.twitch.tv/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            grant_type: 'client_credentials',
          }).toString(),
        });
        if (!tokenRes.ok) return [];
        const tokenData = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
        if (!tokenData.access_token) return [];
        token = tokenData.access_token;
        cachedToken = {
          token,
          expiresAt: Date.now() + Math.min((tokenData.expires_in ?? 3600) * 1000, IGDB_TOKEN_TTL_MS),
        };
      } else {
        token = cachedToken.token;
      }
    }

    const res = await fetchImpl(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': settings.clientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      body,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

/** Mapira IGDB red u domenski oblika (cover je `//images.igdb.com/...`). */
export function mapIgdbGame(row: any): IgdbGame | null {
  if (!row || typeof row.id !== 'number' || !row.name) return null;
  let coverUrl: string | null = null;
  if (row.cover?.url) {
    coverUrl = String(row.cover.url).replace(/^\/\//, 'https://').replace('/t_thumb/', '/t_cover_big/');
  }
  let releaseDate: string | null = null;
  if (typeof row.first_release_date === 'number') {
    releaseDate = new Date(row.first_release_date * 1000).toISOString().slice(0, 10);
  }
  return {
    igdbId: row.id,
    name: String(row.name),
    slug: normalizeSlug(String(row.slug || row.name)),
    coverUrl,
    releaseDate,
  };
}

/**
 * Pretraga igara na IGDB-u. Escapuje korisnički unos jer je IGDB query jezik
 * (Apicalypse) — navodnici i backslash bi polomili upit.
 */
export async function searchIgdbGames(
  query: string,
  limit = 10,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<IgdbGame[]> {
  const term = String(query ?? '').trim().slice(0, 100);
  if (!term || !igdbSettings(env).configured) return [];
  const safe = term.replace(/["\\]/g, '');
  const body = `search "${safe}"; fields id,name,slug,cover.url,first_release_date; limit ${Math.min(Math.max(limit, 1), 20)};`;
  const rows = await igdbQuery<any>('games', body, env, fetchImpl);
  return rows.map(mapIgdbGame).filter((game): game is IgdbGame => Boolean(game));
}
// =====================
// „Osveži cenu“ — OG/meta čitanje prodavnice (2.6.2)
// =====================
//
// Cene su i dalje ručne (prodavnice nemaju jedinstven API — Steam/Epic/GOG
// imaju svoje), ali server sada može da **pročita naslov i og:image** sa
// stranice ponude, pa se dokaz (screenshot) povlači sa prodavnice bez
// ruskog uploada, a korisnik/urednik dobija predlog cene ako je struktuirana
// (`<meta property="product:price:amount">`, Steam `data-price-final`).
//
// Bezbednost (isto pravilo kao `checkExternalUrl`):
//  - samo https, javni host (blocklist iznad), bez kredencijala;
//  - DNS se rešava **pre** zahteva i privatne/metadata adrese se odbijaju,
//    što sprečava DNS rebinding na `169.254.169.254` i sl.;
//  - `redirect: 'manual'` — server ne prati redirect na koji ne može da
//    primeni istu proveru;
//  - limit tela + timeout + POST zabranjen.

const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export interface OfferPreview {
  url: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  store: string | null;
  /** Zbog čega je čitanje odbijeno (IP, status, prevelik odgovor). */
  error?: string;
}

/** Radi i u testovima (injektovan `lookup`) da se ne dira pravi DNS. */
export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = async (host) => {
  const { lookup } = await import('node:dns/promises');
  return lookup(host, { all: true, verbatim: true });
};

const isPrivateAddress = (address: string): boolean => {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return PRIVATE_IP_RE.test(address);
};

/** Proveri host i SVE njegove IP adrese (sprema DNS rebinding). */
export async function assertPublicHost(host: string, lookup: LookupFn = defaultLookup): Promise<void> {
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new Error('Adresa nije javna.');
  }
  if (PRIVATE_IP_RE.test(host)) throw new Error('Adresa nije javna.');

  // Host je već IP — DNS nije potreban.
  const addresses = /^[0-9.]+$/.test(host) ? [{ address: host, family: 4 }] : await lookup(host);
  if (!addresses.length) throw new Error('Domen nije mogao da se reši.');
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error('Adresa nije javna.');
  }
}

const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const attr = (html: string, name: string): string | null => {
  // `<meta property="og:title" content="…">` / obrnut redosled atributa.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return null;
};

const numberOrNull = (raw: string | null): number | null => {
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Realne valute u kojima prodavnice objavljuju cene (prošireno kad zatreba). */
const ISO_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'RSD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
  'BGN', 'HRK', 'TRY', 'UAH', 'CAD', 'AUD', 'NZD', 'BRL', 'MXN', 'ARS', 'JPY', 'KRW',
  'CNY', 'INR', 'RUB', 'ZAR', 'SGD', 'HKD', 'TWD', 'THB', 'IDR', 'MYR', 'PHP', 'VND',
]);

/** Čist parser (bez mreže) — testira se zasebno na sačuvanim delovima HTML-a. */
export function parseOfferHtml(html: string, url: string): Omit<OfferPreview, 'url'> {
  const title = attr(html, 'og:title') ?? attr(html, 'twitter:title') ?? (decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim()) || null);

  // Slika: og:image ili Steam `capsule_image`/`header_image` u JSON bloku.
  let imageUrl = attr(html, 'og:image') ?? attr(html, 'twitter:image');
  if (!imageUrl) {
    const steam = html.match(/"header_image"\s*:\s*"([^"]+)"/i)?.[1] ?? html.match(/"capsule_image"\s*:\s*"([^"]+)"/i)?.[1];
    if (steam) imageUrl = steam.replace(/\\\//g, '/');
  }
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) imageUrl = null;

  const price =
    numberOrNull(attr(html, 'product:price:amount')) ??
    numberOrNull(html.match(/"price":\s*"?([\d.,]+)"?/i)?.[1] ?? null) ??
    numberOrNull(html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i)?.[1] ?? null);

  const currencyRaw = attr(html, 'product:price:currency') ?? html.match(/"priceCurrency":\s*"([A-Za-z]{3})"/i)?.[1] ?? null;
  const currencyUpper = currencyRaw ? currencyRaw.toUpperCase() : '';
  const currency = ISO_CURRENCIES.has(currencyUpper) ? currencyUpper : null;

  let store: string | null = null;
  try {
    store = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    store = null;
  }

  return { title, imageUrl, price, currency, store };
}

/**
 * Pročitaj stranicu ponude. Nikad ne baca (vraća `error` u rezultatu) —
 * pozivalac odlučuje da li je greška korisnički vidljiva.
 */
export async function fetchOfferPreview(rawUrl: string, deps: { lookup?: LookupFn; fetch?: typeof fetch } = {}): Promise<OfferPreview> {
  const empty: OfferPreview = { url: rawUrl, title: null, imageUrl: null, price: null, currency: null, store: null };

  const check = checkExternalUrl(rawUrl, { field: 'Link ponude' });
  if (!check.ok) return { ...empty, error: check.error };

  const parsed = new URL(rawUrl);
  try {
    await assertPublicHost(parsed.hostname.toLowerCase(), deps.lookup);
  } catch (err: any) {
    return { ...empty, error: err?.message ?? 'Adresa nije javna.' };
  }

  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(rawUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        // Prodavnice rutinski blokiraju botove bez UA; predstavljamo se jasno.
        'User-Agent': 'NEXUS-DealBot/1.0 (+https://github.com/nexusgaming)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      return { ...empty, error: 'Prodavnica preusmerava link — proveri da li je ponuda još aktivna.' };
    }
    if (!res.ok) return { ...empty, error: `Prodavnica je odgovorila ${res.status}.` };

    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { ...empty, error: 'Link ne vraća HTML stranicu.' };
    }

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_HTML_BYTES) return { ...empty, error: 'Stranica je prevelika za čitanje.' };

    const reader = res.body?.getReader();
    if (!reader) return { ...empty, error: 'Odgovor nije mogao da se pročita.' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }

    const html = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return { url: rawUrl, ...parseOfferHtml(html, rawUrl) };
  } catch (err: any) {
    return { ...empty, error: err?.name === 'TimeoutError' ? 'Prodavnica nije odgovorila na vreme.' : 'Stranicu nije moguće pročitati.' };
  }
}
