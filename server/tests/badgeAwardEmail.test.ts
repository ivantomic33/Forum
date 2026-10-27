import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { clearSharedValues } from '../lib/sharedStore.js';

/**
 * REGRESIJA (6.x) — „sam sam sebi setovao bedž i opet mi je stigao mejl“.
 *
 * Admin dodela bedža (`POST /api/admin/users/:id/award`) NE SME da pošalje mejl:
 * mejl je dozvoljen samo za verifikaciju adrese i reset lozinke. Test presreće
 * Resend/Brevo na nivou `fetch`-a, pa tvrdi da nijedan poziv nije otišao — i da
 * in-app notifikacija IPAK stigne (da politika ne ućutka i zvonce).
 */

process.env.JWT_SECRET ||= 'test-secret-for-badge-award-email-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
const ADMIN = 'award_admin';
const TARGET = 'award_target';

const tokenFor = (id: string, role: 'admin' | 'member') =>
  jwt.sign({ id, username: id, role, tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });

async function makeUser(id: string, role: 'admin' | 'member') {
  const existing = await db.users.findById(id);
  if (existing) return existing;
  return db.users.create({
    id,
    username: id,
    email: `${id}@example.com`,
    password: 'x',
    avatar: '',
    role,
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

describe.skipIf(db.kind !== 'memory')('admin dodela bedža — nema mejla', () => {
  const original = { RESEND_API_KEY: process.env.RESEND_API_KEY, BREVO_API_KEY: process.env.BREVO_API_KEY };
  let mails: Array<{ to: unknown; subject: string }> = [];
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    clearSharedValues();
    mails = [];
    // Provajder JE podešen — da test ne prođe samo zato što nema ključa.
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.BREVO_API_KEY;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.resend.com') || url.includes('api.brevo.com')) {
        mails.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'captured' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };

    await makeUser(ADMIN, 'admin');
    await makeUser(TARGET, 'member');
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    for (const key of ['RESEND_API_KEY', 'BREVO_API_KEY'] as const) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('dodela bedža sebi: inbox dobija notifikaciju, mejl NE odlazi', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${ADMIN}/award`)
      .set({ Authorization: `Bearer ${tokenFor(ADMIN, 'admin')}` })
      .send({ badgeCode: 'veteran', reason: 'qa self badge' })
      .expect(200);

    expect(res.body.badgeCode).toBe('veteran');

    // Notifikacija u aplikaciji mora postojati — politika gasi samo mejl.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const list = await db.notifications.list({ userId: ADMIN, limit: 10 });
    const badgeNote = list.find((item) => item.type === 'badge_earned');
    expect(badgeNote).toBeTruthy();
    expect(badgeNote?.title).toContain('Veteran');

    // Nijedan mejl nije otišao (Resend/Brevo nisu pozvani).
    expect(mails).toHaveLength(0);
  });

  it('promena uloge (takođe „notifyByEmail: true“ na serveru) ne šalje mejl', async () => {
    await request(app)
      .patch(`/api/users/${TARGET}/role`)
      .set({ Authorization: `Bearer ${tokenFor(ADMIN, 'admin')}` })
      .send({ role: 'moderator' })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mails).toHaveLength(0);

    const list = await db.notifications.list({ userId: TARGET, limit: 10 });
    expect(list.some((item) => item.type === 'staff')).toBe(true);
  });
});
