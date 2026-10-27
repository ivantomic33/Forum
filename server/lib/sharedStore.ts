import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from './presence.js';
import { logger } from './logger.js';

/**
 * DELJENO STANJE IZMEĐU INSTANCI (N-09 / B-15)
 * -------------------------------------------
 * Jedno mesto za Supabase klijenta i za podelu stanja koje je ranije živelo u
 * `Map`-u procesa. Sa 2+ API instance memorija nije „optimizacija“ nego greška:
 *
 *   * XP budžet   — limit se resetovao po instanci (farmovanje).
 *   * 2FA setup   — tajna iz `/2fa/setup` nije postojala na drugoj instanci.
 *   * audit log   — svaka instanca je imala svoju istoriju.
 *   * prisustvo   — `users.status` je memorijski keš, nije znak prisustva.
 *
 * Pravila kojih se sve funkcije ovde drže:
 *   1. **Baza je jedini izvor istine** kada je podešena (`db.kind === 'supabase'`).
 *      Memorija je keš i fallback, nikad drugi autoritet.
 *   2. **Nema read-modify-write** preko mreže: brojač se menja jednim RPC-om
 *      (`spend_daily_xp`, `consume_totp_enrollment`) koji u SQL-u radi upsert ili
 *      `DELETE ... RETURNING`. Time su paralelni zahtevi atomični i unutar
 *      instance (mutex ispod) i između instanci (red u bazi).
 *   3. **Testovi nikad ne pišu u pravu bazu** (isti uslov kao data layer).
 *   4. Nedostajuća migracija ne ruši zahtev — upozori jednom i radi u memoriji.
 */

let client: SupabaseClient | null = null;
let clientChecked = false;

/** Supabase klijent za deljeno stanje ili `null` (memory režim, testovi, migracija ne postoji). */
export function sharedClient(): SupabaseClient | null {
  if (clientChecked) return client;
  clientChecked = true;

  // Isti uslov kao u data layer-u: testovi NIKAD ne pišu u pravu bazu.
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_SUPABASE_IN_TESTS !== '1') return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || url.includes('your-project') || key.length < 20) return null;

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Za testove / promenu env-a unutar istog procesa. */
export function resetSharedClient() {
  client = null;
  clientChecked = false;
}

export function isSharedEnabled(): boolean {
  return sharedClient() !== null;
}

/** Deterministički ključ za `Map` fallback (nikad se ne šalje u bazu). */
export function sharedKey(...parts: Array<string | number | null | undefined>): string {
  return parts.filter((part) => part !== null && part !== undefined).join(':');
}

/** Ostalo je samo in-memory — u produkciji to znači da migracija nije puštena. */
export function sharedWarning(kind: 'schema' | 'write') {
  logger.warn(
    { kind },
    'Deljeno stanje (XP budžet, 2FA setup, audit, prisustvo) koristi memoriju procesa — pokreni server/schema-ALL.sql.',
  );
}

/**
 * Greške pri kojima se sme preći na memoriju bez prekidanja akcije.
 *
 * „Migracija nije puštena“ (pa funkcija/tabela ne postoji) i privremena mrežna
 * greška vraćaju `true`; ostalo (npr. kršeno ograničenje) je pravi bug i mora
 * da se vidi u logu, ne da tiho nestane u lokalnom `Map`-u.
 */
export function isSharedFallbackError(err: unknown): boolean {
  if (isMissingSchemaError(err)) return true;
  const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? '');
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|timeout/i.test(message);
}

/** Upozori jednom po `kind` — otkucaj svakih 25 s ne sme da zatrpa log. */
const warnedKinds = new Set<string>();
export function warnSharedOnce(kind: string, err?: unknown) {
  if (warnedKinds.has(kind)) return;
  warnedKinds.add(kind);
  logger.warn({ err }, `shared_store_${kind}_fallback`);
}

/** Za testove. */
export function clearSharedWarnings() {
  warnedKinds.clear();
}

/**
 * Sitni mutex unutar procesa.
 *
 * Baza garantuje atomičnost **između** instanci, ali u jednom Node procesu
 * paralelni `await`-ovi na fallback putanji (bez RPC-a) i dalje mogu da se
 * preklope. Ovim se kritična sekcija serijalizuje bez eksternih biblioteka.
 * Zaključavanje je po ključu, pa XP budžet jednog korisnika ne blokira drugog.
 */
const locks = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(
    key,
    previous.then(() => current).catch(() => current),
  );

  try {
    await previous.catch(() => undefined);
    return await fn();
  } finally {
    release();
    // Očisti lanac kada nema nikoga iza sebe (Map ne sme da raste u nedogled).
    const tail = locks.get(key);
    if (tail === current) locks.delete(key);
  }
}

/** UTC `YYYY-MM-DD` — isti format koji koristi `xp_budget.day` (`DATE`). */
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** SHA-256 hex — za hashiranje pending tajni (nikad se ne čuva plain). */
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
/* ----------------------------- site_meta ----------------------------- */

/**
 * SITNI DELJENI KLJUČ–VREDNOST (`site_meta`).
 *
 * Za „kada je poslednji put poslat digest“ i slične markere koji moraju da
 * prežive restart servera. U memory režimu je `Map` (testovi), u Supabase
 * režimu tabela `site_meta (key TEXT PRIMARY KEY, value JSONB, updated_at)`.
 * Ako tabela ne postoji, upis pada tiho uz `warnSharedOnce` — pozivaoci
 * (`digest.ts`) tretiraju marker kao „nema podatka“, ne kao grešku.
 */
const META_TABLE = 'site_meta';
const metaFallback = new Map<string, unknown>();

export async function getSharedValue<T = unknown>(key: string): Promise<T | null> {
  const client = sharedClient();
  if (!client) return (metaFallback.get(key) as T | undefined) ?? null;
  try {
    const { data, error } = await client.from(META_TABLE).select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return ((data?.value as T | undefined) ?? null) as T | null;
  } catch (err) {
    if (!isSharedFallbackError(err)) logger.warn({ err, key }, 'site_meta_read_failed');
    return (metaFallback.get(key) as T | undefined) ?? null;
  }
}

export async function setSharedValue(key: string, value: unknown): Promise<void> {
  metaFallback.set(key, value);
  const client = sharedClient();
  if (!client) return;
  try {
    const { error } = await client
      .from(META_TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
  } catch (err) {
    if (!isSharedFallbackError(err)) logger.warn({ err, key }, 'site_meta_write_failed');
    else warnSharedOnce('site_meta', err);
  }
}

/** Za testove — briše memory deo (Supabase se ne dira). */
export function clearSharedValues(): void {
  metaFallback.clear();
}
