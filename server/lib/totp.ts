/**
 * TOTP DVOFAKTORSKA AUTENTIFIKACIJA (F-33)
 * ----------------------------------------
 * - Tajna je enkriptovana AES-256-GCM pre upisa u bazu (`users.totp_secret`).
 *   Ključ se izvodi iz `TOTP_ENCRYPTION_KEY` (ako nije postavljen, iz `JWT_SECRET`)
 *   preko HKDF — kompromitovana baza sama po sebi ne daje važeće TOTP tajne.
 * - QR kod je `data:` URL (klijent ga prikaže u <img>), bez treće strane.
 * - Recovery kodovi: 10 jednokratnih kodova, u bazi samo bcrypt hash-evi.
 * - Replay zaštita: isti 30s korak (`timeStep`) ne može da se iskoristi dvaput.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { generate, verify, generateSecret, generateURI } from 'otplib';
import { db, type UserRecord } from './store.js';
import { logger } from './logger.js';
import { markSignedIn } from './presence.js';
import { isSharedFallbackError, sharedClient, sharedKey, sha256, warnSharedOnce, withLock } from './sharedStore.js';

const ISSUER = 'NEXUS';
const RECOVERY_CODE_COUNT = 10;
// B22 — recovery kodovi: cost 10 (test: 4, kao lozinke).
const RECOVERY_BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 10;

/** Maksimalno neuspelih TOTP pokušaja pre privremenog zaključavanja. */
export const TOTP_MAX_FAILED = 5;
export const TOTP_LOCK_MS = 15 * 60 * 1000;
/** Tolerancija za sat na telefonu (±1 korak od 30s). */
const TOTP_WINDOW_SECONDS = 30;

function encryptionKey(): Buffer {
  const secret = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('TOTP_ENCRYPTION_KEY/JWT_SECRET nije postavljen.');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'nexus-totp', 'totp-secret-v1', 32));
}

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string | null {
  try {
    const [version, iv, tag, data] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function createTotpSecret(): string {
  return generateSecret();
}

export async function totpUri(username: string, secret: string): Promise<string> {
  return generateURI({ issuer: ISSUER, label: username, secret });
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
}

/** Normalizuje korisnički unos: „123 456“ → „123456“. */
const normalizeCode = (raw: unknown) => String(raw ?? '').replace(/[\s-]/g, '');

export interface TotpCheckResult {
  valid: boolean;
  /** Vremenski korak koji je kod potvrdio (za replay zaštitu). */
  timeStep?: number;
  /** Kod je recovery kod (jednokratni). */
  recovery?: boolean;
  /** Indeks iskorišćenog recovery koda. */
  recoveryIndex?: number;
}

/**
 * Proverava 6-cifreni TOTP kod ili recovery kod.
 * TOTP: `otplib.verify` toleriše ±1 korak; replay se sprečava poredjenjem koraka.
 */
export async function verifyTotpCode(
  secret: string,
  rawCode: unknown,
  opts: { lastUsedStep?: number | null } = {},
): Promise<TotpCheckResult> {
  const code = normalizeCode(rawCode);
  if (!/^\d{6}$/.test(code)) return { valid: false };

  const result = await verify({
    secret,
    token: code,
    epochTolerance: TOTP_WINDOW_SECONDS,
  });
  if (!result.valid) return { valid: false };

  // Trenutni korak je jedini koji smemo da upišemo (stariji korak iz tolerancije
  // ne sme da zaključa trenutni). Replay istog koraka — odbij.
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  if (typeof opts.lastUsedStep === 'number' && opts.lastUsedStep >= timeStep) {
    return { valid: false };
  }
  return { valid: true, timeStep };
}

/** Generiše N recovery kodova i vraća ih u čistom obliku (prikazuju se samo jednom). */
export async function generateRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    // 10 heksadecimalnih karaktera + crtica, lako za prepisivanje.
    const raw = crypto.randomBytes(5).toString('hex');
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  const hashes = await Promise.all(plain.map((code) => bcrypt.hash(normalizeRecovery(code), RECOVERY_BCRYPT_COST)));
  return { plain, hashes };
}

export const normalizeRecovery = (raw: unknown) => String(raw ?? '').toLowerCase().replace(/[\s-]/g, '');

/** Vraća indeks potrošenog recovery koda ili -1. */
export async function matchRecoveryCode(rawCode: unknown, hashes: string[]): Promise<number> {
  const code = normalizeRecovery(rawCode);
  if (code.length !== 10 || !/^[0-9a-f]+$/.test(code)) return -1;
  for (let i = 0; i < hashes.length; i += 1) {
    if (await bcrypt.compare(code, hashes[i])) return i;
  }
  return -1;
}

// =====================
// PENDING ENROLLMENT
// =====================
/**
 * N-09 — tajna tokom uključivanja čeka potvrdu prvog koda i čuva se u tabeli
 * `totp_pending` (user_id, TTL 10 min), kao `secret_hash` (SHA-256) i
 * `secret_enc` (isti AES-GCM kao `users.totp_secret`).
 *
 * Ranije je `Map` živeo u procesu: sa 2 instance `/2fa/setup` na jednoj a
 * `/2fa/enable` na drugoj = „2FA nije pravilno podešena“. Memorija je ostala
 * samo za demo/test režim.
 *
 * Trošenje je uvek atomično — `consume_totp_enrollment` radi `DELETE` sa
 * `RETURNING`, pa dva paralelna `enable` poziva ne mogu oba da prođu.
 */
const pending = new Map<string, { secret: string; createdAt: number }>();
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_SECONDS = Math.floor(PENDING_TTL_MS / 1000);

function pendingFromMemory(userId: string): string | null {
  const entry = pending.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) {
    pending.delete(userId);
    return null;
  }
  return entry.secret;
}

/**
 * Sačuvaj novu pending tajnu.
 *
 * `ON CONFLICT (user_id) DO UPDATE` preko kratkog `select`+`upsert` pod
 * `withLock`-om (jedan korisnik ne može da ima dva setup-a u istom procesu).
 * Greška u bazi ne blokira setup — upozori jednom i koristi memoriju.
 */
export async function startEnrollment(userId: string): Promise<string> {
  const secret = createTotpSecret();

  await withLock(sharedKey('totp_pending', userId), async () => {
    const client = sharedClient();
    if (client) {
      const { error } = await client
        .from('totp_pending')
        .upsert(
          {
            user_id: userId,
            secret_hash: sha256(secret),
            secret_enc: encryptSecret(secret),
            created_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

      if (!error) return;
      if (!isSharedFallbackError(error)) logger.error({ err: error, userId }, 'totp_pending_write_failed');
      else warnSharedOnce('totp_pending_write', error);
    }

    pending.set(userId, { secret, createdAt: Date.now() });
  });

  return secret;
}

/** Nepotrošena provera (npr. za poruku „setup istekao“ pre nego što se potroši). */
export async function pendingSecret(userId: string): Promise<string | null> {
  const client = sharedClient();
  if (client) {
    const { data, error } = await client.rpc('peek_totp_enrollment', {
      p_user_id: userId,
      p_ttl_seconds: PENDING_TTL_SECONDS,
    });
    const row = !error && Array.isArray(data) ? data[0] : null;
    if (row?.secret_enc) return decryptSecret(row.secret_enc);

    if (error && !isSharedFallbackError(error)) logger.error({ err: error, userId }, 'totp_pending_peek_failed');
    else if (error) warnSharedOnce('totp_pending_peek', error);
  }
  return pendingFromMemory(userId);
}

/**
 * Potvrđivanje prvog koda troši enrollment. `secret_hash` je zaštita od TOCTOU:
 * tajna iz `startEnrollment` mora da bude ista ona nad kojom je kod proveren.
 */
export async function consumeEnrollment(userId: string, secret: string): Promise<boolean> {
  return withLock(sharedKey('totp_pending', userId), async () => {
    const client = sharedClient();
    if (client) {
      const { data, error } = await client.rpc('consume_totp_enrollment', {
        p_user_id: userId,
        p_ttl_seconds: PENDING_TTL_SECONDS,
      });
      const row = !error && Array.isArray(data) ? data[0] : null;
      if (row) {
        const stored = decryptSecret(row.secret_enc);
        const sameSecret = stored === secret;
        // Nepoklopljena tajna je ipak potrošena — setup se prekida, ne ponavlja.
        if (!sameSecret) logger.warn({ userId }, 'totp_enrollment_secret_mismatch');
        return sameSecret;
      }

      if (error && !isSharedFallbackError(error)) logger.error({ err: error, userId }, 'totp_pending_consume_failed');
      else if (error) warnSharedOnce('totp_pending_consume', error);
    }

    const remembered = pendingFromMemory(userId);
    pending.delete(userId);
    return remembered !== null && remembered === secret;
  });
}

export async function clearEnrollment(userId: string): Promise<void> {
  pending.delete(userId);

  const client = sharedClient();
  if (!client) return;
  try {
    const { error } = await client.from('totp_pending').delete().eq('user_id', userId);
    if (error) warnSharedOnce('totp_pending_clear', error);
  } catch (err) {
    warnSharedOnce('totp_pending_clear', err);
  }
}

// =====================
// BRUTEFORCE ZAŠTITA
// =====================
export function isLocked(user: { totpLockedUntil?: string | null }): boolean {
  if (!user.totpLockedUntil) return false;
  return new Date(user.totpLockedUntil).getTime() > Date.now();
}

export function lockUntilIso(): string {
  return new Date(Date.now() + TOTP_LOCK_MS).toISOString();
}

/** Da li bi sledeći neuspeli pokušaj zaključao nalog. */
export function shouldLockAfterFailure(failedAttempts: number): boolean {
  return failedAttempts + 1 >= TOTP_MAX_FAILED;
}

// =====================
// BILANJE (persist)
// =====================
export async function markTotpUsed(userId: string, timeStep: number | undefined): Promise<void> {
  if (typeof timeStep === 'number') {
    await db.users.update(userId, { totpLastUsedStep: timeStep }).catch(() => {});
  }
}

export async function resetTotpFailures(userId: string): Promise<void> {
  await db.users.update(userId, { totpFailedAttempts: 0, totpLockedUntil: null }).catch(() => {});
}
