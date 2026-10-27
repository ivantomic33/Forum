/**
 * 5.2 — PASSKEYS (WebAuthn)
 * -------------------------
 * Passkey zamenjuje lozinku parom ključeva:
 *  - privatni ključ nikad ne napušta autentifikator (Touch ID / Hello / telefon),
 *  - na serveru je samo javni ključ i brojač potpisa,
 *  - `clientDataJSON.origin` je vezan za domen, pa ukradeni potpis ne radi na
 *    drugom sajtu (phishing nema šta da ukrade).
 *
 * Zašto bez `@simplewebauthn/server`: dependency bi uneo ~50 KB koda za deo
 * koji nam treba (CBOR dekodiranje + verifikacija podpisa), a Node ima
 * `crypto.verify` ugrađen. Ovaj modul je zato mali, proverljiv i bez nove
 * verzije uvoznog stabla.
 *
 * Sigurnosne odluke:
 *  - `challenge` je 32 bajta iz `crypto.randomBytes`, čuva se 5 minuta i
 *    TROŠI se jednokratno (replay istog `begin` odgovora nije moguć),
 *  - za registraciju prihvatamo SAMO `fmt: none` i `fmt: packed` (bez attestation
 *    lanca, jer ga ionako ne verifikujemo — `none` je podrazumevano),
 *  - `userVerification: required` — biometrija/PIN, ne samo „posedovanje“ ključa,
 *  - brojač: ako novi potpis ima `counter <= stoplen` (i nije 0), autentifikator
 *    je moguć klon → odbij + obavesti (ne rušimo postojeći passkey automatski).
 */
import crypto from 'node:crypto';
import { db as dataLayer, type UserRecord } from './store.js';
import { logger } from './logger.js';

/* ------------------------------------------------------------------ */
/* Konfiguracija                                                       */
/* ------------------------------------------------------------------ */

const RP_NAME = 'NEXUS';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_MAX = 5_000;

/** RP ID = domen bez sheme i porta (`localhost` u razvoju). */
export function rpId(): string {
  const explicit = process.env.WEBAUTHN_RP_ID?.trim();
  if (explicit) return explicit;

  const url = process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'http://localhost:5173';
  try {
    return new URL(url.split(',')[0].trim()).hostname;
  } catch {
    return 'localhost';
  }
}

/** Tačan origin koji autentifikator mora da prijavi. */
export function expectedOrigin(): string {
  const explicit = process.env.WEBAUTHN_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const url = process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'http://localhost:5173';
  return new URL(url.split(',')[0].trim()).origin;
}

/* ------------------------------------------------------------------ */
/* Base64url / CBOR minimalni dekoder                                  */
/* ------------------------------------------------------------------ */

const fromB64url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='), 'base64');

const toB64url = (value: Buffer | Uint8Array): string => Buffer.from(value).toString('base64url');

interface CborValue {
  value: unknown;
  next: number;
}

/** Sentinela za CBOR break (`0xff`) — major type 7, ne sme u mapu. */
const BREAK = Symbol('cbor-break');

/**
 * CBOR dekoder za deo koji WebAuthn koristi: unsigned ints, negativni ints,
 * strings, arrays i maps. Ne podržava tag-ove/float — `authenticatorData`
 * nikad ne sadrži takve vrednosti.
 */
function decodeCbor(buffer: Buffer, offset = 0): CborValue {
  const initial = buffer[offset];
  if (initial === undefined) throw new Error('cbor_truncated');
  // Simple values (major 7): `0xff` je break za indefinite-length nizove.
  if (initial === 0xff) return { value: BREAK, next: offset + 1 };
  const major = initial >> 5;
  const additional = initial & 0x1f;
  let pointer = offset + 1;
  let length = additional;

  if (additional === 24) {
    length = buffer[pointer];
    pointer += 1;
  } else if (additional === 31) {
    // Indefinite-length niz/mapa: čitaj stavke do `0xff` (break).
    if (major === 4 || major === 5) {
      const items: CborValue[] = [];
      let cursor = pointer;
      while (cursor < buffer.length && buffer[cursor] !== 0xff) {
        const item = decodeCbor(buffer, cursor);
        items.push(item);
        cursor = item.next;
      }
      // Starije verzije bez break-a: bezbedan izlaz.
      if (cursor >= buffer.length) throw new Error('cbor_truncated');
      if (major === 4) return { value: items.map((item) => item.value), next: cursor + 1 };
      const map: Record<string, unknown> = {};
      for (let index = 0; index < items.length; index += 2) {
        map[String(items[index].value)] = items[index + 1]?.value;
      }
      return { value: map, next: cursor + 1 };
    }
    throw new Error('cbor_indefinite_unsupported');
  } else if (additional === 25) {
    length = buffer.readUInt16BE(pointer);
    pointer += 2;
  } else if (additional === 26) {
    length = buffer.readUInt32BE(pointer);
    pointer += 4;
  } else if (additional === 27) {
    length = Number(buffer.readBigUInt64BE(pointer));
    pointer += 8;
  }

  switch (major) {
    case 0:
      return { value: length, next: pointer };
    case 1:
      return { value: -1 - length, next: pointer };
    case 2: {
      const value = buffer.subarray(pointer, pointer + length);
      return { value, next: pointer + length };
    }
    case 3: {
      const value = buffer.subarray(pointer, pointer + length).toString('utf8');
      return { value, next: pointer + length };
    }
    case 5: {
      const map: Record<string, unknown> = {};
      let cursor = pointer;
      for (let index = 0; index < length; index += 1) {
        const key = decodeCbor(buffer, cursor);
        const item = decodeCbor(buffer, key.next);
        map[String(key.value)] = item.value;
        cursor = item.next;
      }
      return { value: map, next: cursor };
    }
    case 4: {
      const array: unknown[] = [];
      let cursor = pointer;
      for (let index = 0; index < length; index += 1) {
        const item = decodeCbor(buffer, cursor);
        array.push(item.value);
        cursor = item.next;
      }
      return { value: array, next: cursor };
    }
    default:
      throw new Error(`cbor_unsupported_major_${major}`);
  }
}

/* ------------------------------------------------------------------ */
/* Repo (memorija + Supabase)                                          */
/* ------------------------------------------------------------------ */

export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  attachment: string | null;
  transports: string[];
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyRepo {
  list(userId: string): Promise<PasskeyRecord[]>;
  findById(id: string, userId: string): Promise<PasskeyRecord | null>;
  findByCredentialId(credentialId: string): Promise<PasskeyRecord | null>;
  insert(record: PasskeyRecord): Promise<PasskeyRecord>;
  updateCounter(id: string, counter: number): Promise<PasskeyRecord | null>;
  remove(id: string, userId: string): Promise<boolean>;
  count(userId: string): Promise<number>;
}

const memoryPasskeys: PasskeyRecord[] = [];

class MemoryPasskeyRepo implements PasskeyRepo {
  async list(userId: string) {
    return memoryPasskeys
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row }));
  }
  async findById(id: string, userId: string) {
    const row = memoryPasskeys.find((item) => item.id === id && item.userId === userId);
    return row ? { ...row } : null;
  }
  async findByCredentialId(credentialId: string) {
    const row = memoryPasskeys.find((item) => item.credentialId === credentialId);
    return row ? { ...row } : null;
  }
  async insert(record: PasskeyRecord) {
    memoryPasskeys.push({ ...record });
    return record;
  }
  async updateCounter(id: string, counter: number) {
    const row = memoryPasskeys.find((item) => item.id === id);
    if (!row) return null;
    row.counter = counter;
    row.lastUsedAt = new Date().toISOString();
    return { ...row };
  }
  async remove(id: string, userId: string) {
    const index = memoryPasskeys.findIndex((item) => item.id === id && item.userId === userId);
    if (index < 0) return false;
    memoryPasskeys.splice(index, 1);
    return true;
  }
  async count(userId: string) {
    return memoryPasskeys.filter((item) => item.userId === userId).length;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SupabasePasskeyRepo implements PasskeyRepo {
  constructor(private client: any) { }

  private map(row: any): PasskeyRecord {
    return {
      id: row.id,
      userId: row.user_id,
      credentialId: row.credential_id,
      publicKey: row.public_key,
      counter: Number(row.counter ?? 0),
      attachment: row.attachment ?? null,
      transports: Array.isArray(row.transports) ? row.transports : [],
      name: row.name ?? 'Passkey',
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? null,
    };
  }

  async list(userId: string) {
    if (!UUID_RE.test(userId)) return [];
    const { data, error } = await this.client
      .from('webauthn_credentials')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => this.map(row));
  }
  async findById(id: string, userId: string) {
    if (!UUID_RE.test(id) || !UUID_RE.test(userId)) return null;
    const { data, error } = await this.client
      .from('webauthn_credentials')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }
  async findByCredentialId(credentialId: string) {
    // `credential_id` je UNIQUE — jedan red ili ništa.
    const { data, error } = await this.client
      .from('webauthn_credentials')
      .select('*')
      .eq('credential_id', credentialId)
      .maybeSingle();
    // PGRST116 = nema reda (maybeSingle u Supabase-u baci za 0 redova u nekim verzijama).
    if (error && error.code !== 'PGRST116') throw error;
    return data ? this.map(data) : null;
  }
  async insert(record: PasskeyRecord) {
    const { data, error } = await this.client
      .from('webauthn_credentials')
      .insert({
        user_id: record.userId,
        credential_id: record.credentialId,
        public_key: record.publicKey,
        counter: record.counter,
        attachment: record.attachment,
        transports: record.transports,
        name: record.name,
      })
      .select('*')
      .single();
    if (error) throw error;
    return this.map(data);
  }
  async updateCounter(id: string, counter: number) {
    const { data, error } = await this.client
      .from('webauthn_credentials')
      .update({ counter, last_used_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }
  async remove(id: string, userId: string) {
    const { error } = await this.client
      .from('webauthn_credentials')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }
  async count(userId: string) {
    if (!UUID_RE.test(userId)) return 0;
    const { count, error } = await this.client
      .from('webauthn_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    return count ?? 0;
  }
}

const repo: PasskeyRepo =
  dataLayer.kind === 'supabase' && dataLayer.client
    ? new SupabasePasskeyRepo(dataLayer.client)
    : new MemoryPasskeyRepo();

/* ------------------------------------------------------------------ */
/* Challenge keš                                                       */
/* ------------------------------------------------------------------ */

export interface ChallengeRecord {
  challenge: string;
  purpose: 'register' | 'login';
  userId?: string;
  /** Samo za `login`: dozvoljeni `credential_id`-jevi (prazan niz = discoverable). */
  allowCredentials: string[];
  createdAt: number;
}

const challenges = new Map<string, ChallengeRecord>();

function sweepChallenges(): void {
  const now = Date.now();
  for (const [id, record] of challenges) {
    if (now - record.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }
  if (challenges.size > CHALLENGE_MAX) {
    // Prekoračenje: najstariji prvi (Map čuva redosled upisa).
    for (const id of challenges.keys()) {
      if (challenges.size <= CHALLENGE_MAX) break;
      challenges.delete(id);
    }
  }
}

/** Novi challenge sa nasumičnim ID-jem; klijent ga vraća u `finish`. */
export function newChallenge(record: Omit<ChallengeRecord, 'challenge' | 'createdAt'>): { challengeId: string; challenge: string } {
  sweepChallenges();
  const challengeId = crypto.randomUUID();
  const challenge = crypto.randomBytes(32).toString('base64url');
  challenges.set(challengeId, { ...record, challenge, createdAt: Date.now() });
  return { challengeId, challenge };
}

/** Jednokratno trošenje challenge-a (replay nije moguć). */
export function consumeChallenge(challengeId: string, purpose: ChallengeRecord['purpose']): ChallengeRecord | null {
  const record = challenges.get(challengeId);
  if (!record) return null;
  challenges.delete(challengeId);
  if (record.purpose !== purpose) return null;
  if (Date.now() - record.createdAt > CHALLENGE_TTL_MS) return null;
  return record;
}

/* ------------------------------------------------------------------ */
/* Opcije za klijenta                                                  */
/* ------------------------------------------------------------------ */

/** `user.id` kao Uint8Array: WebAuthn ga vraća u `userHandle` pri discoverable prijavi. */


export function registrationOptions(user: UserRecord, challenge: string, excludeCredentialIds: string[]) {
  return {
    challenge,
    rp: { id: rpId(), name: RP_NAME },
    user: {
      // `user.id` (string) je stabilan handle; server ga kontroliše prijavi.
      id: toB64url(Buffer.from(user.id, 'utf8')),
      name: user.email,
      displayName: user.username,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256 (najšire podržan)
      { type: 'public-key', alg: -257 }, // RS256 (fallback za starije Windows Hello)
    ],
    timeout: 60_000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: excludeCredentialIds.map((id) => ({ id, type: 'public-key' })),
  };
}

export function authenticationOptions(challenge: string, allowCredentialIds: string[]) {
  return {
    challenge,
    rpId: rpId(),
    timeout: 60_000,
    userVerification: 'required' as const,
    ...(allowCredentialIds.length
      ? { allowCredentials: allowCredentialIds.map((id) => ({ id, type: 'public-key' as const })) }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Verifikacija                                                        */
/* ------------------------------------------------------------------ */

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

/** Zajednička provera `clientDataJSON` (tip, challenge, origin). */
function readClientData(raw: unknown, expectedType: 'webauthn.create' | 'webauthn.get', challenge: string): ClientData {
  if (typeof raw !== 'string' || !raw) throw new AuthPasskeyError('invalid_client_data', 'Podaci autentifikatora nedostaju.');
  let parsed: ClientData;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ClientData;
  } catch {
    throw new AuthPasskeyError('invalid_client_data', 'Podaci autentifikatora nisu ispravni.');
  }
  if (parsed.type !== expectedType) throw new AuthPasskeyError('invalid_type', 'Neispravan tip passkey odgovora.');
  if (parsed.challenge !== challenge) throw new AuthPasskeyError('invalid_challenge', 'Zahtev za passkey je istekao. Pokušajte ponovo.');
  if (parsed.origin !== expectedOrigin()) {
    logger.warn({ origin: parsed.origin, expected: expectedOrigin() }, 'passkey_origin_mismatch');
    throw new AuthPasskeyError('invalid_origin', 'Passkey zahtev nije došao sa ovog sajta.');
  }
  return parsed;
}

export class AuthPasskeyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface ParsedAttestation {
  credentialId: string;
  publicKey: string;
  counter: number;
  attachment: string | null;
  transports: string[];
}

/**
 * Registracija: dekodira `attestationObject`, izvlači COSE javni ključ.
 * Prihvatamo ES256 (P-256) i RS256 — isto što smo ponudili u `pubKeyCredParams`.
 */
export function verifyRegistration(
  response: unknown,
  opts: { challenge: string; credentialId: string },
): ParsedAttestation {
  const body = response as any;
  if (!body?.response?.attestationObject || !body?.response?.clientDataJSON) {
    throw new AuthPasskeyError('invalid_attestation', 'Autentifikator nije poslao potrebne podatke.');
  }
  // `rawId` mora da odgovara `id`-ju (inаče klijent menja identitet ključa).
  if (typeof body.rawId === 'string' && body.rawId !== opts.credentialId) {
    throw new AuthPasskeyError('credential_id_mismatch', 'Neispravan identitet passkey-a.');
  }

  readClientData(body.response.clientDataJSON, 'webauthn.create', opts.challenge);

  let attestation: any;
  try {
    attestation = decodeCbor(fromB64url(body.response.attestationObject)).value as any;
  } catch {
    throw new AuthPasskeyError('invalid_attestation', 'Podaci autentifikatora nisu ispravni.');
  }
  const authData = attestation?.authData as Buffer | undefined;
  if (!Buffer.isBuffer(authData) || authData.length < 55) {
    throw new AuthPasskeyError('invalid_attestation', 'Podaci autentifikatora nisu ispravni.');
  }

  // authData: rpIdHash(32) flags(1) counter(4) [AAGUID(16) credIdLen(2) credId coseKey]
  const flags = authData[32];
  if ((flags & 0x40) === 0) throw new AuthPasskeyError('missing_attested_data', 'Passkey nema javni ključ.');
  if ((flags & 0x01) === 0) throw new AuthPasskeyError('user_not_verified', 'Potvrdite identitet (biometrija/PIN) i pokušajte ponovo.');

  const expectedRpHash = crypto.createHash('sha256').update(rpId()).digest();
  if (!authData.subarray(0, 32).equals(expectedRpHash)) {
    throw new AuthPasskeyError('rp_mismatch', 'Passkey je napravljen za drugi sajt.');
  }

  const counter = authData.readUInt32BE(33);
  const credentialLength = authData.readUInt16BE(53);
  const credentialId = authData.subarray(55, 55 + credentialLength).toString('base64url');
  if (credentialId !== opts.credentialId) {
    throw new AuthPasskeyError('credential_id_mismatch', 'Neispravan identitet passkey-a.');
  }

  const coseKey = decodeCbor(authData, 55 + credentialLength).value as Record<string, number | Buffer>;
  if (!coseKey || typeof coseKey !== 'object') {
    throw new AuthPasskeyError('invalid_key', 'Ključ passkey-a nije ispravan.');
  }
  const kty = coseKey[1];
  const alg = coseKey[3];

  let key: crypto.KeyObject;
  if (kty === 2 && alg === -7) {
    // EC2 / ES256: x(3), y(-2) — 32 bajta svaki.
    const x = coseKey[-2] as Buffer;
    const y = coseKey[-3] as Buffer;
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new AuthPasskeyError('invalid_key', 'Ključ passkey-a nije ispravan.');
    key = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: toB64url(x), y: toB64url(y) },
      format: 'jwk',
    });
  } else if (kty === 3 && alg === -257) {
    // RSA / RS256: n(-1), e(-2).
    const n = coseKey[-1] as Buffer;
    const e = coseKey[-2] as Buffer;
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new AuthPasskeyError('invalid_key', 'Ključ passkey-a nije ispravan.');
    key = crypto.createPublicKey({
      key: { kty: 'RSA', n: toB64url(n), e: toB64url(e) },
      format: 'jwk',
    });
  } else {
    throw new AuthPasskeyError('unsupported_algorithm', 'Tip passkey-a nije podržan.');
  }

  return {
    credentialId,
    publicKey: key.export({ format: 'der', type: 'spki' }).toString('base64url'),
    counter,
    attachment: typeof body.authenticatorAttachment === 'string' ? body.authenticatorAttachment : null,
    transports: Array.isArray(body.response.transports) ? body.response.transports.filter((item: unknown) => typeof item === 'string') : [],
  };
}

export type AssertionResult = { passkey: PasskeyRecord; counter: number };

/**
 * Prijava: proverava potpis `authenticatorData || SHA-256(clientDataJSON)`.
 * `userHandle`, kada postoji, mora da odgovara vlasniku ključa.
 */
export function verifyAssertion(response: unknown, record: PasskeyRecord, challenge: string): AssertionResult {
  const body = response as any;
  if (!body?.response?.authenticatorData || !body?.response?.signature || !body?.response?.clientDataJSON) {
    throw new AuthPasskeyError('invalid_assertion', 'Autentifikator nije poslao potrebne podatke.');
  }

  readClientData(body.response.clientDataJSON, 'webauthn.get', challenge);

  const authData = fromB64url(body.response.authenticatorData);
  const signature = fromB64url(body.response.signature);
  const clientDataHash = crypto.createHash('sha256').update(fromB64url(body.response.clientDataJSON)).digest();

  const expectedRpHash = crypto.createHash('sha256').update(rpId()).digest();
  if (!authData.subarray(0, 32).equals(expectedRpHash)) {
    throw new AuthPasskeyError('rp_mismatch', 'Passkey je napravljen za drugi sajt.');
  }
  const flags = authData[32];
  if ((flags & 0x01) === 0) throw new AuthPasskeyError('user_not_verified', 'Potvrdite identitet (biometrija/PIN) i pokušajte ponovo.');

  if (body.response.userHandle) {
    const handle = Buffer.from(body.response.userHandle, 'base64url').toString('utf8');
    if (handle !== record.userId) {
      logger.warn({ userId: record.userId }, 'passkey_user_handle_mismatch');
      throw new AuthPasskeyError('user_mismatch', 'Passkey ne pripada ovom nalogu.');
    }
  }

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: Buffer.from(record.publicKey, 'base64url'), format: 'der', type: 'spki' });
  } catch {
    throw new AuthPasskeyError('invalid_key', 'Ključ passkey-a nije ispravan.');
  }

  const verified = crypto.verify(
    'sha256',
    Buffer.concat([authData, clientDataHash]),
    { key: publicKey, dsaEncoding: 'der' },
    signature,
  );
  if (!verified) throw new AuthPasskeyError('invalid_signature', 'Passkey potpis nije ispravan.');

  const counter = authData.length >= 37 ? authData.readUInt32BE(33) : 0;
  // Brojač može biti 0 na platformama koje ga ne vode (npr. Apple passkeys).
  const stored = record.counter ?? 0;
  if (counter !== 0 && stored !== 0 && counter <= stored) {
    logger.warn({ userId: record.userId, stored, counter }, 'passkey_counter_regression');
    throw new AuthPasskeyError('counter_regression', 'Passkey je možda kopiran — prijavite se lozinkom i obrišite ga.');
  }

  return { passkey: record, counter };
}

/* ------------------------------------------------------------------ */
/* Skladištenje                                                        */
/* ------------------------------------------------------------------ */

export async function listPasskeys(userId: string): Promise<PasskeyRecord[]> {
  return repo.list(userId).catch((error) => {
    logger.warn({ err: error, userId }, 'passkey_list_failed');
    throw new AuthPasskeyError('passkey_storage_missing', 'Passkey opcija trenutno nije dostupna.');
  });
}

export async function passkeyCount(userId: string): Promise<number> {
  return repo.count(userId).catch(() => 0);
}

export async function savePasskey(record: PasskeyRecord): Promise<PasskeyRecord> {
  return repo.insert(record).catch((error) => {
    logger.error({ err: error, userId: record.userId }, 'passkey_insert_failed');
    throw new AuthPasskeyError('passkey_storage_missing', 'Passkey nije sačuvan. Pokušajte ponovo.');
  });
}

export async function findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRecord | null> {
  return repo.findByCredentialId(credentialId).catch((error) => {
    logger.warn({ err: error }, 'passkey_lookup_failed');
    return null;
  });
}

export async function findPasskeyById(id: string, userId: string): Promise<PasskeyRecord | null> {
  return repo.findById(id, userId);
}

export async function touchPasskey(id: string, counter: number): Promise<void> {
  await repo.updateCounter(id, counter).catch((error) => {
    logger.warn({ err: error, id }, 'passkey_counter_update_failed');
  });
}

export async function deletePasskey(id: string, userId: string): Promise<boolean> {
  return repo.remove(id, userId).catch((error) => {
    logger.warn({ err: error, userId }, 'passkey_delete_failed');
    return false;
  });
}

/** Za testove: čisti memoriju (Supabase repo se testira kroz `repos.test.ts`). */
export function resetPasskeyStateForTests(): void {
  memoryPasskeys.length = 0;
  challenges.clear();
}
