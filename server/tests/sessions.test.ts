import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../index';
import { db } from '../lib/store.js';

/**
 * 5.1 — UPRAVLJANJE SESIJAMA.
 *
 * `GET /auth/sessions` vraća po jedan red po uređaju (familyId), sa `current`
 * za sesiju iz koje je zahtev. `DELETE /auth/sessions/:id` odjavljuje samo taj
 * uređaj, `DELETE /auth/sessions` sve (uključujući tekući).
 */

process.env.JWT_SECRET ||= 'test-secret-for-session-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const EMAIL = 'sessions@example.com';
const PASSWORD = 'TestLozinka123!';

async function seedUser() {
  const existing = await db.users.findByEmail(EMAIL);
  if (existing) return existing;
  return db.users.create({
    id: 'sessions_user',
    username: 'sessions_user',
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

/** Svaki agent = drugi uređaj (sopstveni cookie jar). */
const device = (ua: string) => request.agent(app).set('user-agent', ua);

describe.skipIf(db.kind !== 'memory')('5.1 — upravljanje sesijama', () => {
  let laptop: ReturnType<typeof device>;
  let phone: ReturnType<typeof device>;
  let laptopCsrf = '';

  beforeAll(async () => {
    await seedUser();
    laptop = device('M/5.0 (Windows NT 10.0) Chrome/130.0');
    phone = device('Mozilla/5.0 (iPhone) Safari/604');
    const login = await laptop.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    laptopCsrf = String(login.body.csrfToken ?? '');
    await phone.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
  });

  it('lista vraća oba uređaja, tačno jedan je `current`', async () => {
    const res = await laptop.get('/api/auth/sessions').expect(200);
    expect(res.body.sessions.length).toBe(2);
    expect(res.body.sessions.filter((session: any) => session.current)).toHaveLength(1);
    // Tajne se ne izlažu.
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  });

  it('odjava jednog uređaja ne dira drugi', async () => {
    const list = await laptop.get('/api/auth/sessions').expect(200);
    const phoneSession = list.body.sessions.find((session: any) => !session.current);
    expect(phoneSession).toBeTruthy();

    // Poništava se SAMO druga porodica; laptop-ova sesija ostaje živa.
    await laptop
      .delete(`/api/auth/sessions/${phoneSession.id}`)
      .set('x-csrf-token', laptopCsrf)
      .expect(200);

    const after = await laptop.get('/api/auth/sessions').expect(200);
    expect(after.body.sessions).toHaveLength(1);
    expect(after.body.sessions[0].current).toBe(true);
    // „Telefon“ više ne može da osveži sesiju. 403 = CSRF (cookie postoji, svež
    // access token ne), a ne obnovljena sesija; 401 bi značio da je refresh prošao.
    const refreshed = await phone.post('/api/auth/refresh');
    expect([401, 403]).toContain(refreshed.status);
    expect(refreshed.body.csrfToken).toBeUndefined();
  });

  it('odjava sa svih uređaja gasi i tekuću sesiju', async () => {
    await laptop.delete('/api/auth/sessions').set('x-csrf-token', laptopCsrf).expect(200);
    await laptop.get('/api/auth/me').expect(401);
    // Refresh više ne važi ni za jedan uređaj.
    await laptop.post('/api/auth/refresh').expect(401);
  });

  it('tuđi ID sesije ne otkriva postojanje (404, bez enumeracije)', async () => {
    const fresh = device('Mozilla/5.0 (X11) Firefox/128');
    const login = await fresh.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    const csrf = String(login.body.csrfToken ?? '');
    await fresh
      .delete('/api/auth/sessions/00000-0000-4000-8000-000')
      .set('x-csrf-token', csrf)
      .expect(404);
  });
});
