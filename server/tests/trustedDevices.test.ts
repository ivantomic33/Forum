import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateSync } from 'otplib';
import bcrypt from 'bcryptjs';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { TRUST_COOKIE, DEVICE_COOKIE, TRUST_TTL_MS } from '../lib/trustedDevices.js';

/**
 * F-15 — trusted device za 2FA.
 *
 * Provera ide kroz stvarne rute: `/login` → `/2fa/login` (sa `trustDevice`) →
 * `/login` ponovo na istom „uređaju“ (isti cookie jar) → nema 2FA koraka.
 *
 * 2FA se uključuje kroz `/2fa/setup` + `/2fa/enable` sa stvarnim TOTP kodom.
 * Server odbija replay istog `timeStep`-a (samo u memoriji procesa), pa test
 * NE unosi dva koda iz iste 30-sekundne prozora: drugi 2FA korak koristi
 * RECOVERY kod (jednokratni) — to je i realan scenario „izgubio sam telefon“.
 */

process.env.JWT_SECRET ||= 'test-secret-for-trusted-device-tests-012345';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';
process.env.TOTP_ENCRYPTION_KEY ||= 'test-totp-key-0123456789abcdef012345';
process.env.TOTP_ENCRYPTION_KEY ||= process.env.JWT_SECRET;

const app = createApp();
app.set('trust proxy', 1);

const PASSWORD = 'TestLozinka123!';
const EMAIL = 'trusted@example.com';
const USER_ID = 'trusted_user';

/** Cookie-jar: supertest agent čuva cookie-je između zahteva („isti uređaj“). */
const device = () => request.agent(app);

async function seedUser() {
  const existing = await db.users.findByEmail(EMAIL);
  if (existing) return existing;
  return db.users.create({
    id: USER_ID,
    username: 'trusted_user',
    email: EMAIL,
    password: await bcrypt.hash(PASSWORD, 10),
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

const tokenFor = (id: string) =>
  jwt.sign({ id, username: id, role: 'member', tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });

describe.skipIf(db.kind !== 'memory')('F-15 — trusted device za 2FA', () => {
  let recoveryCodes: string[] = [];

  beforeAll(async () => {
    await seedUser();
    // Jedna prijava lozinkom → sesija za uključivanje 2FA.
    const agent = device();
    const login = await agent.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    const csrf = String(login.body.csrfToken ?? '');
    const auth = { Authorization: `Bearer ${tokenFor(USER_ID)}`, 'x-csrf-token': csrf };

    const setup = await agent.post('/api/auth/2fa/setup').set(auth).expect(200);
    const enable = await agent
      .post('/api/auth/2fa/enable')
      .set(auth)
      .send({ code: generateSync({ secret: setup.body.secret }) })
      .expect(200);
    expect(enable.body.enabled).toBe(true);
    recoveryCodes = enable.body.recoveryCodes;
    expect(recoveryCodes.length).toBeGreaterThan(0);
  });

  it('lozinka → requires2fa; recovery kod + trustDevice pamti uređaj; sledeća prijava ne traži kod', async () => {
    // 1. Prva prijava sa ovog uređaja: lozinka → `mfaTicket`, bez sesije.
    const phone = device();
    const login = await phone.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(login.body.requires2fa).toBe(true);
    expect(login.body.mfaTicket).toBeTruthy();

    // 2. Drugi korak: recovery kod + „zapamti uređaj“.
    // Čist agent nema `nx_at`/`nx_rt` cookie, pa CSRF double-submit ne važi za njega
    // (isto kao mobilni klijent pre prve sesije).
    const mfa = await phone
      .post('/api/auth/2fa/login')
      .send({ mfaTicket: login.body.mfaTicket, code: recoveryCodes[0], trustDevice: true })
      .expect(200);
    expect(mfa.body.trustedDevice).toBe(true);
    expect(mfa.body.user?.id).toBe(USER_ID);
    const cookies = ([] as string[]).concat(mfa.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toContain(`${TRUST_COOKIE}=`);
    expect(cookies).toContain(`${DEVICE_COOKIE}=`);

    // 3. Isti uređaj: lozinka je dovoljna (2FA korak se preskače).
    // Agent sada ima cookie sesiju, pa se pošalje i CSRF token (double-submit).
    const csrf = String(mfa.body.csrfToken ?? '');
    const again = await phone
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    expect(again.body.requires2fa).toBeUndefined();
    expect(again.body.trustedDevice).toBe(true);
    expect(again.body.user?.id).toBe(USER_ID);
  });

  it('GET /2fa/devices prikazuje uređaj; DELETE ga zaboravi (2FA se ponovo traži)', async () => {
    const auth = tokenFor(USER_ID);

    const devices = await request(app).get('/api/auth/2fa/devices').set('Authorization', `Bearer ${auth}`).expect(200);
    expect(devices.body.devices.length).toBeGreaterThan(0);
    expect(devices.body.ttlDays).toBe(30);
    const deviceId = devices.body.devices[0].deviceId;

    // Bez CSRF-a bi DELETE bio 403 (cookie sesija postoji) — Bearer klijent šalje token.
    await request(app)
      .delete('/api/auth/2fa/devices')
      .set('Authorization', `Bearer ${auth}`)
      .expect(200);

    const afterForget = await device().post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    expect(afterForget.body.requires2fa).toBe(true);
    expect(deviceId).toBeTruthy();
  });

  it('isključivanje 2FA (lozinka + kod) briše zapamćene uređaje', async () => {
    await db.trustedDevices.save({
      userId: USER_ID,
      deviceId: 'device_for_disable',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + TRUST_TTL_MS).toISOString(),
    });
    expect(await db.trustedDevices.list(USER_ID)).not.toHaveLength(0);

    const agent = device();
    const login = await agent.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    const csrf = String(login.body.csrfToken ?? '');
    const auth = { Authorization: `Bearer ${tokenFor(USER_ID)}`, 'x-csrf-token': csrf };

    const disabled = await agent
      .post('/api/auth/2fa/disable')
      .set(auth)
      .send({ password: PASSWORD, code: recoveryCodes[1] })
      .expect(200);
    expect(disabled.body.enabled).toBe(false);
    expect(await db.trustedDevices.list(USER_ID)).toHaveLength(0);
  });

  it('repo: token se rotira, klizni rok produžava, istekao uređaj ne prolazi', async () => {
    const future = new Date(Date.now() + TRUST_TTL_MS).toISOString();
    await db.trustedDevices.save({ userId: USER_ID, deviceId: 'dev_a', tokenHash: 'hash_a', expiresAt: future });

    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_a', 'hash_a')).toBe(true);
    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_a', 'hash_b')).toBe(false);
    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_other', 'hash_a')).toBe(false);

    // Rotacija: novi hash zamenjuje stari (ukradeni cookie prestaje da važi).
    await db.trustedDevices.save({ userId: USER_ID, deviceId: 'dev_a', tokenHash: 'hash_b', expiresAt: future });
    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_a', 'hash_a')).toBe(false);
    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_a', 'hash_b')).toBe(true);

    // Isteci rok → ni tačan hash ne prolazi, a lista ga više ne prikazuje.
    await db.trustedDevices.save({
      userId: USER_ID,
      deviceId: 'dev_expired',
      tokenHash: 'hash_c',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await db.trustedDevices.isTrusted(USER_ID, 'dev_expired', 'hash_c')).toBe(false);
    expect((await db.trustedDevices.list(USER_ID)).map((d) => d.deviceId)).not.toContain('dev_expired');
  });

  it('konstante: 30 dana i imena cookie-ja', () => {
    expect(TRUST_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(TRUST_COOKIE).toBe('nx_trust');
    expect(DEVICE_COOKIE).toBe('nx_dev');
  });
});
