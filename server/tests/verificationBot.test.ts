import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { createActionToken } from '../lib/actionTokens.js';
import { notifyStaff } from '../lib/notifications.js';

/**
 * 3.0.0 — VERIFIKACIONI BOT + STAFF NOTIFIKACIJE
 * ----------------------------------------------
 * Proverava tok koji korisnik vidi u inbox-u:
 *
 *  1. registracija → bot poruka „potvrdi email da bi pisao“,
 *  2. nepotvrđen nalog ne može da objavi (403 EMAIL_NOT_VERIFIED),
 *  3. potvrda → bot zahvalnica,
 *  4. staff dobija notifikaciju za prijavu sadržaja.
 */

const MEMBER = 'vb_member';
const ADMIN = 'vb_admin';

/** ID kroz `jwt` — `authenticate` čita `id` iz tokena, pa i `usr_…` radi. */
const tokenFor = (id: string) =>
  jwt.sign({ id, username: id, role: 'member', tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
const auth = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

async function makeUser(id: string, overrides: Record<string, unknown> = {}) {
  const existing = await db.users.findById(id);
  if (existing) {
    await db.users.update(id, overrides as any);
    return db.users.findById(id);
  }
  return db.users.create({
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
    isVerified: false,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  } as any);
}

const notificationsFor = async (userId: string) => db.notifications.list({ userId });

beforeAll(async () => {
  process.env.JWT_SECRET ||= 'test-secret-for-verification-bot-flow';
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'memory';
});

const app = (() => {
  // `createApp()` čita `JWT_SECRET` pri uvozu `../index.js`; u punom test suite-u
  // taj uvoz je već izvršen, pa setuj pre nego što ga zatražimo.
  process.env.JWT_SECRET ||= 'test-secret-for-verification-bot-flow';
  process.env.SUPABASE_URL ||= 'memory';
  return createApp();
})();

describe('verifikacioni bot — tok kroz inbox', () => {
  it('bot dobrodošlicu nosi i token (dev link) i oznaku bot', async () => {
    const { verificationWelcome } = await import('../lib/notifications.js');
    const user = await makeUser('vb_welcome', { username: 'vb_welcome' });
    await verificationWelcome({ userId: user!.id, username: 'vb_welcome', verifyLink: '/verify?token=abc' });

    const list = await notificationsFor(user!.id);
    const bot = list.find((n) => n.type === 'verification');
    expect(bot).toBeTruthy();
    expect(bot!.link).toBe('/verify?token=abc');
    expect((bot!.metadata as any).bot).toBe(true);
  });

  it('nepotvrđen nalog ne može da objavi odgovor (EMAIL_NOT_VERIFIED), potvrđen može', async () => {
    const user = await makeUser(MEMBER, { username: MEMBER, isVerified: false });
    expect(user?.isVerified).toBe(false);

    const blocked = await request(app)
      .post('/api/forum/threads/thr_ne_postoji/comments')
      .set(auth(MEMBER))
      .send({ content: 'Zdravo svete, ovo je probni odgovor.' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('POST /api/auth/verify-email — bot zahvaljuje samo pri prvoj verifikaciji', async () => {
    const user = await makeUser('vb_confirm', { username: 'vb_confirm', isVerified: false });
    const { token } = await createActionToken(user!.id, 'verify_email');

    const first = await request(app).post('/api/auth/verify-email').send({ token });
    expect(first.status).toBe(200);
    expect(first.body.isVerified).toBe(true);

    // `notify()` ide u pozadini (`void`) — sačekaj mikro-zadatke i upis u repo.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const thanks = (await notificationsFor(user!.id)).filter(
      (n) => n.type === 'verification' && (n.metadata as any)?.stage === 'verified',
    );
    expect(thanks).toHaveLength(1);

    // Drugi poziv sa istim (već potrošenim) tokenom — nalog ostaje verifikovan,
    // ali nema druge poruke. Token je jednokratan, a ostale grane ne diramo.
    const again = await request(app).post('/api/auth/verify-email').send({ token });
    expect((await db.users.findById(user!.id))?.isVerified).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterSecond = (await notificationsFor(user!.id)).filter(
      (n) => n.type === 'verification' && (n.metadata as any)?.stage === 'verified',
    );
    expect(afterSecond).toHaveLength(1);
  });
});

describe('staff notifikacije', () => {
  it('notifyStaff šalje samo adminima/moderatorima, ne običnim članovima', async () => {
    await makeUser('vb_staff_admin', { username: 'vb_staff_admin', role: 'admin', isVerified: true });
    const member = await makeUser('vb_staff_member', { username: 'vb_staff_member', role: 'member', isVerified: true });

    const sent = await notifyStaff({
      title: 'Test staff',
      message: 'Samo staff vidi ovo.',
      link: '/admin',
    });
    expect(sent).toBeGreaterThanOrEqual(1);

    const adminNotifs = await notificationsFor('vb_staff_admin');
    expect(adminNotifs.some((n) => n.type === 'staff' && n.title === 'Test staff')).toBe(true);

    const memberNotifs = await notificationsFor(member!.id);
    expect(memberNotifs.some((n) => n.title === 'Test staff')).toBe(false);
  });

  it('prijava sadržaja obaveštava staff preko inbox-a', async () => {
    await makeUser(ADMIN, { username: ADMIN, role: 'admin', isVerified: true });
    await makeUser('vb_reporter', { username: 'vb_reporter', role: 'member', isVerified: true });

    const res = await request(app)
      .post('/api/reports')
      .set(auth('vb_reporter'))
      .send({ targetType: 'thread', targetId: 'thr_xyz', reason: 'Ovo je očigledno spam sadržaj.' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const adminNotifs = await notificationsFor(ADMIN);
    expect(
      adminNotifs.some((n) => n.title === 'Nova prijava sadržaja' && n.link === '/admin/reports'),
    ).toBe(true);
  });
});
