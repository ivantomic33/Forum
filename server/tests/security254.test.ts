import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Regresije 2.5.4 — bezbednost i onboarding:
 *  - F-32 refresh sesije: hash tokena, rotacija, detekcija ponovne upotrebe;
 *  - F-33 TOTP: enkripcija tajne, provera koda, replay i recovery kodovi;
 *  - F-34 OAuth: potpisani state, sanitizacija korisničkog imena, bez open redirect-a;
 *  - F-35 Turnstile: provera preko Cloudflare-a (test secret uvek prolazi).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'x'.repeat(48);

const { db } = await import('../lib/store.js');
import type { RefreshSessionRecord } from '../lib/sessions.js';
const sessions = await import('../lib/sessions.js');
const totp = await import('../lib/totp.js');
const oauth = await import('../lib/oauth.js');
const turnstile = await import('../middleware/turnstile.js');
const { generate } = await import('otplib');

const testUser = (id: string, username = 'SessionTester') => ({
  id,
  username,
  email: `${id}@example.com`,
  password: 'hash',
  avatar: '',
  bio: '',
  role: 'member' as const,
  level: 1,
  xp: 0,
  xpNeeded: 100,
  karma: 0,
  badges: [],
  connectedAccounts: {},
  isVerified: true,
  isBanned: false,
  status: 'offline' as const,
  tokenVersion: 0,
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
});

const fakeReq = (ip = '127.0.0.1') => ({ ip, get: () => 'vitest-agent' }) as any;

describe.skipIf(db.kind !== 'memory')('F-32 — refresh sesije', () => {
  const USER = 'usr_254_sessions';

  beforeAll(async () => {
    if (!(await db.users.findById(USER))) await db.users.create(testUser(USER));
  });

  it('čuva samo SHA-256 hash refresh tokena', async () => {
    const created = await sessions.createRefreshSession(USER, { rememberMe: true, req: fakeReq() });
    const stored = (await db.sessions.findByTokenHash(sessions.hashToken(created.token))) as unknown as
      | (RefreshSessionRecord & { tokenHash: string })
      | null;
    expect(stored).not.toBeNull();
    // Čist token se nikada ne upisuje.
    expect(stored!.tokenHash).not.toBe(created.token);
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.userId).toBe(USER);
  });

  it('rotira token i detektuje ponovnu upotrebu starog (opoziva celu porodicu)', async () => {
    const first = await sessions.createRefreshSession(USER, { rememberMe: false, req: fakeReq() });
    const rotated = await sessions.rotateRefreshSession(first.token, fakeReq());
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.token).not.toBe(first.token);

    // Napadač ponovo šalje stari token → porodica je opozvana.
    const reuse = await sessions.rotateRefreshSession(first.token, fakeReq());
    expect(reuse).toEqual({ ok: false, reason: 'reused' });

    // Ni novi (legitimni) token više ne radi.
    const afterReuse = await sessions.rotateRefreshSession(rotated.token, fakeReq());
    expect(afterReuse.ok).toBe(false);
  });

  it('nepoznat token je odbijen', async () => {
    const result = await sessions.rotateRefreshSession('nepostojeci-token', fakeReq());
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('„zapamti me“ daje sedmodnevni refresh, sesija bez njega 12h', () => {
    expect(sessions.refreshExpiryMs(true)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(sessions.refreshExpiryMs(false)).toBe(12 * 60 * 60 * 1000);
  });

  it('CSRF: GET prolazi, mutirajući cookie zahtev bez zaglavlja pada', () => {
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    sessions.csrfProtection({ method: 'GET', cookies: { nx_at: 'a' } } as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    sessions.csrfProtection({ method: 'POST', cookies: { nx_at: 'a', nx_csrf: 'abc' }, get: () => '' } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    sessions.csrfProtection(
      { method: 'POST', cookies: { nx_at: 'a', nx_csrf: 'abc' }, get: () => 'abc' } as any,
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('F-33 — TOTP', () => {
  it('enkriptuje tajnu (AES-GCM) i odbija izmenu ciphertext-a', () => {
    const secret = totp.createTotpSecret();
    const encrypted = totp.encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(totp.decryptSecret(encrypted)).toBe(secret);

    const tampered = `${encrypted.slice(0, -2)}AA`;
    expect(totp.decryptSecret(tampered)).not.toBe(secret);
  });

  it('prihvata važeći kod, odbija pogrešan i isti korak dvaput (replay)', async () => {
    const secret = totp.createTotpSecret();
    const code = await generate({ secret });

    const ok = await totp.verifyTotpCode(secret, code);
    expect(ok.valid).toBe(true);
    expect(typeof ok.timeStep).toBe('number');

    const replay = await totp.verifyTotpCode(secret, code, { lastUsedStep: ok.timeStep ?? null });
    expect(replay.valid).toBe(false);

    expect((await totp.verifyTotpCode(secret, '000000')).valid).toBe(false);
    expect((await totp.verifyTotpCode(secret, 'abc')).valid).toBe(false);
  });

  it('generiše 10 recovery kodova koji se match-uju jednokratno', async () => {
    const { plain, hashes } = await totp.generateRecoveryCodes();
    expect(plain).toHaveLength(10);
    expect(hashes).toHaveLength(10);

    const index = await totp.matchRecoveryCode(plain[3].replace('-', ''), hashes);
    expect(index).toBe(3);
    expect(await totp.matchRecoveryCode('dead-beef00', hashes)).toBe(-1);
  });

  it('zaključava nalog posle 5 neuspelih pokušaja', () => {
    expect(totp.shouldLockAfterFailure(3)).toBe(false);
    expect(totp.shouldLockAfterFailure(4)).toBe(true);
    expect(totp.isLocked({ totpLockedUntil: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
    expect(totp.isLocked({ totpLockedUntil: new Date(Date.now() - 60_000).toISOString() })).toBe(false);
  });
});

describe('F-34 — OAuth', () => {
  it('state je potpisan i nosi nameru; izmena ga poništava', () => {
    const state = oauth.signState({ provider: 'discord', mode: 'link', userId: 'usr_1', redirect: '/forum' });
    const decoded = oauth.verifyState(state);
    expect(decoded).toMatchObject({ provider: 'discord', mode: 'link', userId: 'usr_1', redirect: '/forum' });

    const [header, payload, signature] = state.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), userId: 'usr_admin' }),
    ).toString('base64url');
    expect(oauth.verifyState(`${header}.${forged}.${signature}`)).toBeNull();
    expect(oauth.verifyState('nije-token')).toBeNull();
  });

  it('redirect posle prijave dozvoljava samo interne putanje', () => {
    expect(oauth.safeRedirect('/forum?sort=new')).toBe('/forum?sort=new');
    expect(oauth.safeRedirect('//evil.com')).toBeUndefined();
    expect(oauth.safeRedirect('https://evil.com')).toBeUndefined();
    expect(oauth.safeRedirect('/\\evil.com')).toBeUndefined();
    expect(oauth.safeRedirect(42)).toBeUndefined();
  });

  it('korisničko ime iz provajdera se normalizuje u naše pravilo', () => {
    expect(oauth.sanitizeOAuthUsername('Đorđe Šarić')).toMatch(/^[a-zA-Z0-9_.-]{3,20}$/);
    expect(oauth.sanitizeOAuthUsername('😀')).toMatch(/^gamer\d{4}$/);
    expect(oauth.sanitizeOAuthUsername('a')).toMatch(/^gamer\d{4}$/);
  });

  it('PKCE challenge odgovara verifier-u (S256)', async () => {
    const { verifier, challenge } = oauth.createPkce();
    const { createHash } = await import('node:crypto');
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});

describe('F-35 — Turnstile', () => {
  it('u razvoju bez secret-a provera je onemogućena', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('TURNSTILE_ENFORCE', '');
    expect(await turnstile.verifyTurnstile('', '127.0.0.1')).toEqual({ ok: true });
  });

  it('sa uključenom proverom: prazan token se odbija, validan prihvata', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA');
    vi.stubEnv('TURNSTILE_ENFORCE', '1');

    expect((await turnstile.verifyTurnstile('', '127.0.0.1')).ok).toBe(false);

    const fakeFetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    const result = await turnstile.verifyTurnstile('token', '127.0.0.1', fakeFetch as any);
    expect(result.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledWith(turnstile.TURNSTILE_VERIFY_URL, expect.objectContaining({ method: 'POST' }));

    // Cloudflare odbija → zahtev je odbijen (fail-closed).
    const rejected = vi.fn().mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
    expect((await turnstile.verifyTurnstile('token', '127.0.0.1', rejected as any)).ok).toBe(false);

    // Cloudflare nedostupan → takođe odbijeno.
    const offline = vi.fn().mockRejectedValue(new Error('network'));
    expect((await turnstile.verifyTurnstile('token', '127.0.0.1', offline as any)).ok).toBe(false);

    vi.unstubAllEnvs();
  });
});
