import crypto from 'node:crypto';

/** Node 20 ne eksportuje `JsonWebKey` tip iz `node:crypto` — lokalna definicija. */
type JsonWebKey = { kty?: string; x?: string; y?: string; n?: string; e?: string };
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../index';
import { db } from '../lib/store.js';
import {
  AuthPasskeyError,
  consumeChallenge,
  expectedOrigin,
  newChallenge,
  resetPasskeyStateForTests,
  rpId,
  verifyAssertion,
  verifyRegistration,
  type PasskeyRecord,
} from '../lib/passkeys';

/**
 * 5.2 — PASSKEY (WebAuthn).
 *
 * Testovi prave STVARNE ES256 ključeve i STVARNE potpise (Node `crypto`), pa
 * prolaze kroz isti CBOR/potpis put kao browser:
 *  - registracija: `none` attestation sa `authData` = rpIdHash|flags|counter|AAGUID|credId|coseKey,
 *  - prijava: potpis nad `authData || sha256(clientDataJSON)`.
 *
 * Hvatamo i napade koje WebAuthn treba da zaustavi: replay challenge-a,
 * pogrešan origin, klonirani autentifikator (counter regresija).
 */

process.env.JWT_SECRET ||= 'test-secret-for-passkey-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const EMAIL = 'passkey@example.com';
const PASSWORD = 'TestLozinka123!';

const b64url = (value: Buffer) => value.toString('base64url');



const cborText = (value: string) => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([0x60 | bytes.length]), bytes]);
};

const cborBytes = (value: Buffer) => {
  if (value.length < 24) return Buffer.concat([Buffer.from([0x40 | value.length]), value]);
  if (value.length < 256) return Buffer.concat([Buffer.from([0x58, value.length]), value]);
  const header = Buffer.alloc(3);
  header[0] = 0x59;
  header.writeUInt16BE(value.length, 1);
  return Buffer.concat([header, value]);
};

/**
 * COSE_Key za ES256: kty(1)=2, alg(3)=-7, crv(-1)=1, x(-2), y(-3).
 * Negativni ključevi: major 1, vrednost `-1 - n` → -2 = 0x21, -3 = 0x22.
 */
function coseKeyFromJwk(jwk: JsonWebKey): Buffer {
  const x = Buffer.from(jwk.x as string, 'base64url');
  const y = Buffer.from(jwk.y as string, 'base64url');
  return Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]),
    Buffer.from([0x03, 0x26]),
    Buffer.from([0x20, 0x01]),
    Buffer.from([0x21]),
    cborBytes(x),
    Buffer.from([0x22]),
    cborBytes(y),
  ]);
}

interface KeyPair {
  privateKey: crypto.KeyObject;
  jwk: JsonWebKey;
}

function newKey(): KeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) as JsonWebKey };
}

function authDataFor(rp: string, flags: number, counter: number, credentialId: Buffer, cose: Buffer): Buffer {
  const rpIdHash = crypto.createHash('sha256').update(rp).digest();
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  const aaguid = Buffer.alloc(16);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credentialId.length);
  return Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf, aaguid, credIdLen, credentialId, cose]);
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin = expectedOrigin()) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

/** Attestation object (`fmt: none`) — CBOR mapa {fmt, attStmt, authData}. */
function attestationObject(authData: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa3]),
    cborText('fmt'),
    cborText('none'),
    cborText('attStmt'),
    Buffer.from([0xa0]),
    cborText('authData'),
    cborBytes(authData),
  ]);
}

function registrationCredential(challenge: string, key: KeyPair, counter = 0) {
  const credentialId = crypto.randomBytes(16);
  const authData = authDataFor(rpId(), 0x45, counter, credentialId, coseKeyFromJwk(key.jwk));
  return {
    credentialId: b64url(credentialId),
    credential: {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientData('webauthn.create', challenge)),
        attestationObject: b64url(attestationObject(authData)),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    },
  };
}

function assertionCredential(challenge: string, key: KeyPair, credentialId: string, counter: number, origin?: string) {
  const authData = authDataFor(rpId(), 0x05, counter, Buffer.from(credentialId, 'base64url'), Buffer.alloc(0));
  const client = clientData('webauthn.get', challenge, origin);
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([authData, crypto.createHash('sha256').update(client).digest()]),
    key.privateKey,
  );
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: b64url(client),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}

async function seedUser(id = 'passkey_user') {
  const existing = await db.users.findByEmail(EMAIL);
  if (existing) return existing;
  return db.users.create({
    id,
    username: 'passkey_user',
    email: EMAIL,
    password: await bcrypt.hash(PASSWORD, 4),
    avatar: '',
    role: 'member',
    level: 1,
    xp: 0,
    xpNeeded: 100,
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: true,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  } as any);
}

describe('5.2 — WebAuthn verifikacija (unit)', () => {
  it('registracija: prihvata važeći attestation i izvlači SPKI javni ključ', () => {
    resetPasskeyStateForTests();
    const key = newKey();
    const challenge = 'challenge-register-1';
    const { credential, credentialId } = registrationCredential(challenge, key);
    const parsed = verifyRegistration(credential, { challenge, credentialId });
    expect(parsed.credentialId).toBe(credentialId);
    expect(parsed.counter).toBe(0);
    expect(parsed.attachment).toBe('platform');
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(parsed.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(publicKey.asymmetricKeyType).toBe('ec');
  });

  it('registracija: odbija pogrešan challenge i pogrešan origin', () => {
    const key = newKey();
    const { credential, credentialId } = registrationCredential('pravi-challenge', key);
    expect(() => verifyRegistration(credential, { challenge: 'drugi-challenge', credentialId })).toThrow(
      AuthPasskeyError,
    );

    const { credential: evil, credentialId: evilId } = registrationCredential('c1', key);
    evil.response.clientDataJSON = b64url(clientData('webauthn.create', 'c1', 'https://evil.example'));
    expect(() => verifyRegistration(evil, { challenge: 'c1', credentialId: evilId })).toThrow(/sajta/);
  });

  it('prijava: prihvata tačan potpis, odbija tuđi ključ i counter regresiju', () => {
    const key = newKey();
    const challenge = 'login-challenge-1';
    const { credential, credentialId } = registrationCredential('reg', key, 0);
    const parsed = verifyRegistration(credential, { challenge: 'reg', credentialId });

    const record: PasskeyRecord = {
      id: 'pk_1',
      userId: 'passkey_user',
      credentialId,
      publicKey: parsed.publicKey,
      counter: 0,
      attachment: 'platform',
      transports: ['internal'],
      name: 'Laptop',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    // Ispravan potpis.
    const good = assertionCredential(challenge, key, credentialId, 5);
    expect(verifyAssertion(good, record, challenge).counter).toBe(5);

    // Tuđi ključ (napadač bez privatnog dela).
    const attacker = newKey();
    const forged = assertionCredential(challenge, attacker, credentialId, 6);
    expect(() => verifyAssertion(forged, record, challenge)).toThrow(/potpis/);

    // Kloniran autentifikator: counter ne raste.
    const replayCounter = assertionCredential(challenge, key, credentialId, 2);
    expect(() => verifyAssertion(replayCounter, { ...record, counter: 5 }, challenge)).toThrow(/kopiran/);
  });
});

describe.skipIf(db.kind !== 'memory')('5.2 — passkey rute (integracija)', () => {
  let csrf = '';
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    resetPasskeyStateForTests();
    await seedUser();
    agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    csrf = String(login.body.csrfToken ?? '');
  });

  it('registracija kroz API: begin → finish → lista → brisanje', async () => {
    const begin = await agent
      .post('/api/auth/passkeys/register/begin')
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(begin.body.challengeId).toBeTruthy();
    expect(begin.body.options.rp.id).toBe(rpId());

    const key = newKey();
    const { credential } = registrationCredential(begin.body.options.challenge, key);
    const finish = await agent
      .post('/api/auth/passkeys/register/finish')
      .set('x-csrf-token', csrf)
      .send({ challengeId: begin.body.challengeId, name: 'Test laptop', credential })
      .expect(201);
    expect(finish.body.passkey.name).toBe('Test laptop');
    // Javni ključ NIKAD ne ide klijentu.
    expect(finish.body.passkey.publicKey).toBeUndefined();

    const list = await agent.get('/api/auth/passkeys').expect(200);
    expect(list.body.passkeys).toHaveLength(1);

    await agent
      .delete(`/api/auth/passkeys/${finish.body.passkey.id}`)
      .set('x-csrf-token', csrf)
      .expect(200);
    const after = await agent.get('/api/auth/passkeys').expect(200);
    expect(after.body.passkeys).toHaveLength(0);
  });

  it('challenge je jednokratan: drugi finish sa istim challengeId padа', async () => {
    const begin = await agent
      .post('/api/auth/passkeys/register/begin')
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    const key = newKey();
    const { credential } = registrationCredential(begin.body.options.challenge, key);
    await agent
      .post('/api/auth/passkeys/register/finish')
      .set('x-csrf-token', csrf)
      .send({ challengeId: begin.body.challengeId, credential })
      .expect(201);

    await agent
      .post('/api/auth/passkeys/register/finish')
      .set('x-csrf-token', csrf)
      .send({ challengeId: begin.body.challengeId, credential })
      .expect(400);
  });

  it('prijava passkey-om izdaje sesiju (discoverable tok)', async () => {
    // Pripremi passkey za nalog.
    const begin = await agent
      .post('/api/auth/passkeys/register/begin')
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    const key = newKey();
    const { credential, credentialId } = registrationCredential(begin.body.options.challenge, key);
    await agent
      .post('/api/auth/passkeys/register/finish')
      .set('x-csrf-token', csrf)
      .send({ challengeId: begin.body.challengeId, credential })
      .expect(201);

    // Novi klijent (bez sesije) — passkey prijava.
    const fresh = request.agent(app);
    const loginBegin = await fresh.post('/api/auth/passkeys/login/begin').send({}).expect(200);
    const assertion = assertionCredential(loginBegin.body.options.challenge, key, credentialId, 1);
    const finish = await fresh
      .post('/api/auth/passkeys/login/finish')
      .send({ challengeId: loginBegin.body.challengeId, credential: assertion })
      .expect(200);
    expect(finish.body.user.username).toBe('passkey_user');
    expect(finish.body.csrfToken).toBeTruthy();
  });

  it('nepoznat credential je odbijen bez otkrivanja detalja', async () => {
    const fresh = request.agent(app);
    const begin = await fresh.post('/api/auth/passkeys/login/begin').send({}).expect(200);
    const key = newKey();
    const assertion = assertionCredential(begin.body.options.challenge, key, b64url(crypto.randomBytes(16)), 1);
    const res = await fresh
      .post('/api/auth/passkeys/login/finish')
      .send({ challengeId: begin.body.challengeId, credential: assertion })
      .expect(401);
    expect(res.body.code).toBe('PASSKEY_UNKNOWN');
  });

  it('`newChallenge` vezuje namenu: login challenge ne važi za registraciju', () => {
    resetPasskeyStateForTests();
    const created = newChallenge({ purpose: 'login', allowCredentials: [] });
    // Konzumiranje sa pogrešnom namenom troši challenge (jednokratnost) i vraća null.
    expect(consumeChallenge(created.challengeId, 'register')).toBeNull();
  });
});
