import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

/**
 * TOKENI ZA EMAIL AKCIJE
 * ----------------------
 * Verifikacija email-a i reset lozinke koriste kriptografski random token.
 * U bazi se čuva **samo SHA-256 hash** tokena (nikad plain vrednost).
 *
 * Perzistencija (2.4.4):
 *   - sa Supabase konfiguracijom → tabela `auth_tokens` (preživljava restart,
 *     radi na više instanci; `consume_auth_token` RPC troši token atomično),
 *   - bez baze → in-memory fallback (samo za razvoj/demo).
 */

export type TokenKind = 'verify_email' | 'reset_password';

const TOKEN_TTL_MS: Record<TokenKind, number> = {
  verify_email: 24 * 60 * 60 * 1000, // 24h
  reset_password: 30 * 60 * 1000, // 30 min
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/* -------------------------- in-memory fallback -------------------------- */

interface StoredToken {
  hash: string;
  userId: string;
  kind: TokenKind;
  expiresAt: number;
  used: boolean;
}

const tokensByHash = new Map<string, StoredToken>();

/* ------------------------------ Supabase -------------------------------- */

let client: SupabaseClient | null = null;
let clientChecked = false;

function getClient(): SupabaseClient | null {
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

/** UTC ISO string — poređenje sa TIMESTAMPTZ u bazi. */
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

/* -------------------------------- API ----------------------------------- */

/** Kreira token; sirova vrednost ide korisniku mejlom, u bazu samo hash. */
export async function createActionToken(
  userId: string,
  kind: TokenKind,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[kind]);
  const hash = hashToken(token);

  const db = getClient();
  if (db) {
    // Stari neiskorišćeni tokeni istog tipa više ne važe (jedan aktivan token).
    await db.from('auth_tokens').delete().eq('user_id', userId).eq('type', kind).is('used_at', null);
    const { error } = await db.from('auth_tokens').insert({
      user_id: userId,
      type: kind,
      hash,
      expires_at: expiresAt.toISOString(),
    });
    if (error) {
      logger.error({ err: error, userId, kind }, 'auth_token_persist_failed');
      throw new Error('Token nije mogao biti sačuvan.');
    }
  } else {
    tokensByHash.set(hash, { hash, userId, kind, expiresAt: expiresAt.getTime(), used: false });
    cleanup();
  }

  return { token, expiresAt };
}

/** Validira i troši token. Atomično u bazi; jednokratno u oba režima. */
export async function consumeActionToken(token: string, kind: TokenKind): Promise<{ userId: string } | null> {
  const hash = hashToken(token);
  const db = getClient();

  if (db) {
    const { data, error } = await db.rpc('consume_auth_token', { p_hash: hash, p_type: kind });
    if (!error && Array.isArray(data) && data[0]?.user_id) {
      return { userId: data[0].user_id };
    }
    // RPC nedostaje (migracija 2.4.4 nije puštena) — fallback na dve operacije.
    if (error) {
      const { data: row } = await db
        .from('auth_tokens')
        .select('id, user_id, expires_at, used_at')
        .eq('hash', hash)
        .eq('type', kind)
        .maybeSingle();
      if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
      const { error: updateError } = await db
        .from('auth_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('used_at', null);
      return updateError ? null : { userId: row.user_id };
    }
    return null;
  }

  const stored = tokensByHash.get(hash);
  if (!stored) return null;
  if (stored.kind !== kind) return null;
  if (stored.used) return null;
  if (stored.expiresAt < Date.now()) {
    tokensByHash.delete(hash);
    return null;
  }

  // Timing-safe poređenje (defanzivno — ključ je ionako hash)
  const a = Buffer.from(stored.hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  stored.used = true;
  return { userId: stored.userId };
}

/** Nepotrošena provera (npr. za prikaz forme pre klika). */
export async function peekActionToken(token: string, kind: TokenKind): Promise<{ userId: string } | null> {
  const hash = hashToken(token);
  const db = getClient();

  if (db) {
    const { data } = await db
      .from('auth_tokens')
      .select('user_id, expires_at, used_at')
      .eq('hash', hash)
      .eq('type', kind)
      .maybeSingle();
    if (!data || data.used_at || new Date(data.expires_at) < new Date()) return null;
    return { userId: data.user_id };
  }

  const stored = tokensByHash.get(hash);
  if (!stored || stored.kind !== kind || stored.used || stored.expiresAt < Date.now()) return null;
  return { userId: stored.userId };
}

function cleanup() {
  const now = Date.now();
  for (const [hash, stored] of tokensByHash) {
    if (stored.expiresAt < now || stored.used) tokensByHash.delete(hash);
  }
}

/** Za testove. */
export function clearActionTokens() {
  tokensByHash.clear();
}

/** Expiry kao ISO — koristi se u mejlu/linku. */
export const tokenExpiryIso = (kind: TokenKind) => isoIn(TOKEN_TTL_MS[kind]);
