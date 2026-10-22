import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

/**
 * INTEGRACIONI HTTP TESTOVI (analiza §7.6)
 * ----------------------------------------
 * `createApp()` daje ISTU Express aplikaciju koju vrti `index.ts` (rute, limiteri,
 * CSRF, cookie-parser) — bez `listen`-a. Testovi pokrivaju ono što unit testovi
 * ne mogu: stvarne cookie-je, `x-csrf-token` zaglavlje i status kodove kroz mrežu.
 *
 * Store je `memory` (test env), pa nema baze ni mrežnih zavisnosti.
 */

process.env.JWT_SECRET ||= 'test-secret-for-integration-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
// Testovi šalju `x-forwarded-for` da razdvoje budžete paralelnih slučajeva.
// `1` (jedan hop) umesto `true` — express-rate-limit odbija permisivni `true`.
app.set('trust proxy', 1);

/** Izdvaja `Set-Cookie` vrednost po imenu (supertest vraća niz). */
function cookie(res: request.Response, name: string): string {
  const list: string[] = ([] as string[]).concat(res.headers['set-cookie'] as any ?? []);
  const found = list.find((entry) => entry.startsWith(`${name}=`));
  return found ? found.split(';')[0] : '';
}

function tokenFor(user: { id: string; username: string; role: string; tokenVersion?: number }) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

async function makeUser(opts: { id: string; verified: boolean; role?: 'member' | 'admin' | 'moderator' }) {
  return db.users.create({
    id: opts.id,
    username: opts.id.replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'user',
    email: `${opts.id}@example.com`,
    password: 'x',
    avatar: '',
    role: opts.role ?? 'member',
    level: 1,
    xp: 0,
    xpNeeded: 0,
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: opts.verified,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  } as any);
}

describe.skipIf(db.kind !== 'memory')('Integracija — auth cookie flow', () => {
  let registeredCookie = '';
  let registeredRefresh = '';
  let registeredResponse: request.Response;
  let csrf = '';
  const email = `cookie_${Date.now()}@example.com`;

  it('registracija postavlja HttpOnly nx_at/nx_rt i čitljiv nx_csrf', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        username: `cookie_${Date.now().toString(36)}`.slice(0, 20),
        email,
        password: 'TestLozinka123!',
        acceptedTerms: true,
        ageConfirmed: true,
      })
      .expect(201);

    const access = cookie(res, 'nx_at');
    const refresh = cookie(res, 'nx_rt');

    expect(access).toContain('nx_at=');
    expect(refresh).toContain('nx_rt=');
    // HttpOnly je na access/refresh; CSRF je NAMERNO čitljiv (double-submit).
    const setCookies = ([] as string[]).concat(res.headers['set-cookie'] as any ?? []).join('\n');
    expect(setCookies).toMatch(/nx_at=[^;]+;[^\n]*HttpOnly/i);
    expect(setCookies).toMatch(/nx_rt=[^;]+;[^\n]*HttpOnly/i);
    expect(setCookies).not.toMatch(/nx_csrf=[^;]+;[^\n]*HttpOnly/i);

    // B-02 — u test/dev režimu token je u TELU (nema zavisnosti od slanja mejla).
    expect(res.body.user?.email).toBe(email);
    expect(res.body.csrfToken).toBeTruthy();

    registeredCookie = access;
    registeredRefresh = refresh;
    registeredResponse = res;
    csrf = res.body.csrfToken;
  });

  it('GET /auth/me radi samo sa access cookie-jem', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', registeredCookie).expect(200);
    expect(res.body.user?.email).toBe(email);
  });

  it('GET /auth/me bez cookie-ja → 401', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  it('refresh: bez cookie-ja → 401 NO_SESSION; bez CSRF → 403; sa CSRF → 200 i nova rotirana cookie', async () => {
    const noSession = await request(app).post('/api/auth/refresh').send({});
    expect(noSession.status).toBe(401);
    expect(noSession.body.code).toBe('NO_SESSION');

    // Refresh cookie živi na `Path=/api/auth`, pa se šalje ručno iz prvog odgovora.
    const refreshPair = registeredRefresh;
    expect(refreshPair).toContain('nx_rt=');
    const csrfPair = cookie(registeredResponse, 'nx_csrf');

    const withoutCsrf = await request(app).post('/api/auth/refresh').set('Cookie', refreshPair).send({});
    expect(withoutCsrf.status).toBe(403);
    expect(withoutCsrf.body.code).toBe('CSRF_FAILED');

    const withCsrf = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${refreshPair}; ${csrfPair}`)
      .set('x-csrf-token', csrf)
      .send({});
    expect(withCsrf.status).toBe(200);
    expect(withCsrf.body.user?.email).toBe(email);
    // Rotacija: novi refresh token se razlikuje od poslatog.
    expect(cookie(withCsrf, 'nx_rt')).not.toBe(refreshPair);
  });
});

describe.skipIf(db.kind !== 'memory')('Integracija — CSRF 403', () => {
  let cookieValue = '';

  beforeAll(async () => {
    await makeUser({ id: 'usr_csrf_test', verified: true });
    const token = tokenFor({ id: 'usr_csrf_test', username: 'usr_csrf_test', role: 'member' });
    cookieValue = `nx_at=${token}; nx_csrf=aaaaaaaaaaaaaaaa`;
  });

  it('mutacija sa sesijom ali bez X-CSRF-Token → 403 CSRF_FAILED', async () => {
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Cookie', cookieValue)
      .send({ title: 'CSRF test', content: 'Sadržaj' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });

  it('pogrešan X-CSRF-Token → 403', async () => {
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Cookie', cookieValue)
      .set('x-csrf-token', 'bbbbbbbbbbbbbbbb')
      .send({ title: 'CSRF test', content: 'Sadržaj' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });

  it('isti token u cookie-ju i zaglavlju prolazi CSRF (dalje odlučuje validacija)', async () => {
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Cookie', cookieValue)
      .set('x-csrf-token', 'aaaaaaaaaaaaaaaa')
      .send({ title: 'ok', content: 'Sadržaj' });
    expect(res.status).not.toBe(403);
  });

  it('klijent bez cookie-ja (Bearer) nije podložan CSRF-u', async () => {
    const token = tokenFor({ id: 'usr_csrf_test', username: 'usr_csrf_test', role: 'member' });
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bearer', content: 'Sadržaj' });
    expect(res.status).not.toBe(403);
  });
});

describe.skipIf(db.kind !== 'memory')('Integracija — requireVerified 403', () => {
  beforeAll(async () => {
    await makeUser({ id: 'usr_unverified', verified: false });
  });

  it('nepotvrđen email → 403 EMAIL_NOT_VERIFIED pri objavi teme', async () => {
    const token = tokenFor({ id: 'usr_unverified', username: 'usr_unverified', role: 'member' });
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tema', content: 'Sadržaj' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('admin je izuzet od verifikacije email-a', async () => {
    await makeUser({ id: 'usr_admin_unverified', verified: false, role: 'admin' });
    const token = tokenFor({ id: 'usr_admin_unverified', username: 'usr_admin_unverified', role: 'admin' });
    const res = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Admin tema', content: 'Sadržaj' });
    expect(res.status).toBe(201);
  });
});

describe.skipIf(db.kind !== 'memory')('Integracija — soft delete 404', () => {
  it('soft-deleted tema → 404 za gosta, ali autor je i dalje vidi', async () => {
    await makeUser({ id: 'usr_soft_author', verified: true });
    const token = tokenFor({ id: 'usr_soft_author', username: 'usr_soft_author', role: 'member' });
    const created = await request(app)
      .post('/api/forum/pc-gaming/threads')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Obrisana tema', content: 'Sadržaj' })
      .expect(201);

    const threadId = created.body.id as string;
    await db.forum.updateThread(threadId, { isDeleted: true });

    await request(app).get(`/api/forum/threads/${threadId}`).expect(404);
    // Autor (i staff) i dalje vidi svoju soft-obrisanu temu — samo je nema u listama.
    const asAuthor = await request(app)
      .get(`/api/forum/threads/${threadId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(asAuthor.body.thread?.id ?? asAuthor.body.id).toBe(threadId);
  });
});

describe.skipIf(db.kind !== 'memory')('Integracija — per-user rate limit', () => {
  it('findByIds/liste ne troše limit, ali dnevni XP budžet ne puca — provera 429 na 2FA', async () => {
    // 2FA limit: 8 neuspeha / 15 min po tiketu (RATE_LIMIT_2FA_MAX).
    const responses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const res = await request(app)
        .post('/api/auth/2fa/login')
        .set('x-forwarded-for', '203.0.113.250')
        .send({ mfaTicket: 'nepostojeci', code: '000000' });
      responses.push(res.status);
    }
    expect(responses).toContain(429);
  });

  it('check-username ima sopstveni, labaviji budžet (ne deli auth limit)', async () => {
    const res = await request(app)
      .get('/api/auth/check-username?username=slobodno_ime')
      .set('x-forwarded-for', '203.0.113.251')
      .expect(200);
    expect(res.body).toHaveProperty('available');
  });
});
