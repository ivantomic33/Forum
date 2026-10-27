import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, setSessionCookies } from '../lib/sessions.js';

/**
 * CSRF i PRIJAVA
 * --------------
 * Double-submit CSRF traži `nx_csrf` cookie I istoimeno zaglavlje. Prijava je
 * jedina ruta gde klijent još nema taj token — izdaje se u odgovoru. Zato:
 *
 *  1. `POST /auth/login` ne sme da padne na CSRF proveri samo zato što je
 *     browser poslao `nx_at`/`nx_rt` (npr. sam je ugasio `nx_csrf` ili je
 *     ostao refresh cookie posle restarta) — ranije je to bio 403 pre nego što
 *     se lozinka uopšte proveri.
 *  2. Ostale mutacije sa access cookie-jem I DALJE traže poklapanje.
 *  3. Token koji je klijent poslao se ne rotira pri osvežavanju sesije
 *     (`setSessionCookies`), inače sledeći paralelni zahtev padne na 403.
 */

process.env.JWT_SECRET ||= 'test-secret-for-csrf-login-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
const USER_ID = 'csrf_login_user';
const CREDENTIALS = { email: 'csrf@example.com', password: 'CsrfTest123!' };

beforeEach(async () => {
  const existing = await db.users.findById(USER_ID);
  if (!existing) {
    await db.users.create({
      id: USER_ID,
      username: 'csrf_login_user',
      email: CREDENTIALS.email,
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
});

/** Najmanji mogući Express `Response` da se odakle se cookie postavlja vidi. */
function fakeRes() {
  const cookies: Record<string, { value: string; opts: any }> = {};
  const res = {
    cookie(name: string, value: string, opts: any) {
      cookies[name] = { value, opts };
      return res;
    },
  };
  return { res: res as any, cookies };
}

describe('CSRF — prijava bez `nx_csrf` cookie-ja', () => {
  it('sa `nx_at` i `nx_rt` (bez `nx_csrf`) zahtev STIŽE do provere lozinke', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Cookie', `${ACCESS_COOKIE}=stale-access; ${REFRESH_COOKIE}=stale-refresh`)
      .send(CREDENTIALS);

    // Nije 403 CSRF_FAILED — lozinka se proverava (u testu je hash 'x', pa 401).
    expect(response.status).not.toBe(403);
    expect((response.body as any).code).not.toBe('CSRF_FAILED');
  });

  it('registracija takođe prolazi CSRF (token se izdaje u odgovoru)', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Cookie', `${ACCESS_COOKIE}=stale-access`)
      .send({});

    expect((response.body as any).code).not.toBe('CSRF_FAILED');
  });

  it('mutacija sa access cookie-jem BEZ zaglavlja i dalje dobija 403', async () => {
    const response = await request(app)
      .post('/api/articles/art_csrf_test/comments')
      .set('Cookie', `${ACCESS_COOKIE}=a; ${CSRF_COOKIE}=token-abc`)
      .send({ content: 'hi' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'CSRF_FAILED' });
  });

  it('poklapanje cookie-ja i zaglavlja propušta zahtev dalje od CSRF-a', async () => {
    const response = await request(app)
      .post('/api/articles/art_csrf_test/comments')
      .set('Cookie', `${ACCESS_COOKIE}=a; ${CSRF_COOKIE}=token-abc`)
      .set('X-CSRF-Token', 'token-abc')
      .send({ content: 'hi' });

    expect(response.body?.code).not.toBe('CSRF_FAILED');
  });
});

describe('setSessionCookies — CSRF token se ne rotira bez potrebe', () => {
  const opts = {
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshExpiresAt: new Date(Date.now() + 3600_000),
  };

  it('prva prijava (bez pristiglog tokena) izdaje novi token', () => {
    const { res, cookies } = fakeRes();
    const token = setSessionCookies(res, opts);

    expect(token).toHaveLength(32);
    expect(cookies[CSRF_COOKIE].value).toBe(token);
  });

  it('osvežavanje zadržava token koji je klijent poslao', () => {
    const { res, cookies } = fakeRes();
    const token = setSessionCookies(res, { ...opts, currentCsrfToken: 'client-token' });

    expect(token).toBe('client-token');
    expect(cookies[CSRF_COOKIE].value).toBe('client-token');
  });

  it('eksplicitan `csrfToken` ima prednost nad pristiglim', () => {
    const { res } = fakeRes();
    expect(setSessionCookies(res, { ...opts, csrfToken: 'explicit', currentCsrfToken: 'client' })).toBe('explicit');
  });

  it('prazan pristigli token tretira se kao „nema“ i pravi se novi', () => {
    const { res } = fakeRes();
    const token = setSessionCookies(res, { ...opts, currentCsrfToken: '' });
    expect(token).toHaveLength(32);
  });
});
