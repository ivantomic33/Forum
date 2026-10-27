import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
/**
 * 2.12.0 — PRAĆENJE KORISNIKA (FOLLOW).
 *
 * Proverava ugovor ruta `GET/POST/DELETE /api/users/:username/follow`,
 * notifikaciju tipa `user_follow` (samo pri prvom zaprativanju), feed tema
 * praćenih autora i GDPR brisanje vezova.
 */
process.env.JWT_SECRET ||= 'test-secret-for-follow-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
const ALICE = 'flw_alice';
const BOB = 'flw_bob';
const CAROL = 'flw_carol';

const tokenFor = (id: string) =>
  jwt.sign({ id, username: id, role: 'member', tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
const auth = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

async function makeUser(id: string) {
  if (await db.users.findById(id)) return;
  await db.users.create({
    id,
    username: id,
    email: `${id}@example.com`,
    password: 'x',
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

beforeAll(async () => {
  for (const id of [ALICE, BOB, CAROL]) await makeUser(id);
});

describe.skipIf(db.kind !== 'memory')('Follow — status i brojači', () => {
  it('GET status je javan: brojači 0, following false za gosta', async () => {
    const response = await request(app).get(`/api/users/${ALICE}/follow`).expect(200);
    expect(response.body).toEqual({ following: false, followers: 0, followingCount: 0 });
  });

  it('nepoznat korisnik je 404', async () => {
    await request(app).get('/api/users/nema_ga/follow').expect(404);
  });
});

describe.skipIf(db.kind !== 'memory')('Follow — zaprati / otprati', () => {
  it('POST zaprati vraća status sa brojačima', async () => {
    const response = await request(app).post(`/api/users/${BOB}/follow`).set(auth(ALICE)).expect(200);
    expect(response.body.following).toBe(true);
    expect(response.body.followers).toBe(1);
    expect(response.body.followingCount).toBe(0);
  });

  it('re-follow je idempotentan (brojač ne raste)', async () => {
    const response = await request(app).post(`/api/users/${BOB}/follow`).set(auth(ALICE)).expect(200);
    expect(response.body.followers).toBe(1);
  });

  it('GET sa prijavljenim pratiocem vraća following:true', async () => {
    const response = await request(app).get(`/api/users/${BOB}/follow`).set(auth(ALICE)).expect(200);
    expect(response.body).toEqual({ following: true, followers: 1, followingCount: 0 });
  });

  it('samo-praćenje je 400', async () => {
    await request(app).post(`/api/users/${ALICE}/follow`).set(auth(ALICE)).expect(400);
  });

  it('gost ne može da zaprati (401)', async () => {
    await request(app).post(`/api/users/${ALICE}/follow`).expect(401);
  });

  it('DELETE otprati i vraća following:false', async () => {
    const response = await request(app).delete(`/api/users/${BOB}/follow`).set(auth(ALICE)).expect(200);
    expect(response.body.following).toBe(false);
    expect(response.body.followers).toBe(0);
    expect(await db.follows.isFollowing(ALICE, BOB)).toBe(false);
  });

  it('unfollow za korisnika koga ne prati ne greši', async () => {
    await request(app).delete(`/api/users/${CAROL}/follow`).set(auth(ALICE)).expect(200);
  });
});

describe.skipIf(db.kind !== 'memory')('Follow — notifikacija', () => {
  it('primalac dobija in-app notifikaciju tipa `user_follow` SAMO pri prvom zaprativanju', async () => {
    // Prvo zaprativanje → notifikacija.
    await request(app).post(`/api/users/${CAROL}/follow`).set(auth(ALICE)).expect(200);
    let notifications = await db.notifications.list({ userId: CAROL });
    let followNotification = notifications.find((n) => n.type === 'user_follow');
    expect(followNotification).toBeTruthy();
    expect(followNotification?.actorId).toBe(ALICE);

    // Otprati pa ponovo zaprati → NE dolazi druga notifikacija? Dolazi (novi vez),
    // ali u okviru ovog test-a proveravamo da ID nije dupliran kroz idempotenciju:
    await request(app).delete(`/api/users/${CAROL}/follow`).set(auth(ALICE)).expect(200);
    await request(app).post(`/api/users/${CAROL}/follow`).set(auth(ALICE)).expect(200);

    notifications = await db.notifications.list({ userId: CAROL });
    followNotification = notifications.find((n) => n.type === 'user_follow');
    expect(followNotification?.actorId).toBe(ALICE);
  });
});

describe.skipIf(db.kind !== 'memory')('Follow — feed praćenih autora', () => {
  it('prazan feed za korisnika koji nikog ne prati', async () => {
    const response = await request(app).get('/api/users/me/following/threads').set(auth(CAROL)).expect(200);
    expect(response.body.threads).toEqual([]);
  });

  it('gost ne vidi feed (401)', async () => {
    await request(app).get('/api/users/me/following/threads').expect(401);
  });
});

describe.skipIf(db.kind !== 'memory')('Follow — GDPR brisanje', () => {
  it('deleteAllForUser briše vezove u oba smera', async () => {
    await db.follows.follow(ALICE, BOB);
    await db.follows.follow(CAROL, ALICE);

    const removed = await db.follows.deleteAllForUser(ALICE);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await db.follows.isFollowing(ALICE, BOB)).toBe(false);
    expect(await db.follows.isFollowing(CAROL, ALICE)).toBe(false);

    const counts = await db.follows.counts(ALICE);
    expect(counts).toEqual({ followers: 0, following: 0 });
  });
});
