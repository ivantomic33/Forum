import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db, levelProgress, xpForLevel } from '../lib/store.js';
import { awardXp, resetDailyXpBudget } from '../lib/gamification.js';

/**
 * 6.0.0 — ADMIN XP KOREKCIJA (§LEVEL/XP problem)
 *
 * Realan scenario: admin dodeli bonus preko panela, a korisnik i dalje piše
 * „LVL 1, 500/500“. Uzroci koje ovaj test zaključava:
 *   1. admin bonus je išao kroz `awardXp` → `spend_daily_xp`, pa ga je dnevni
 *      limit tiho odsecao na 0 (XP se NIJE menjao),
 *   2. nivo je ostao na keš koloni `users.level` iako je XP prešao prag,
 *   3. progres je meren kao `xp / xpNeeded` (ukupan XP kroz prag nivoa).
 */

process.env.JWT_SECRET ||= 'test-secret-for-admin-xp-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const ADMIN = 'adm_xp';
const MEMBER = 'adm_xp_member';

const auth = (id: string, role = 'admin') => ({
  Authorization: `Bearer ${jwt.sign({ id, username: id, role, tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' })}`,
});

async function makeUser(id: string, role: 'admin' | 'member') {
  if (await db.users.findById(id)) return;
  await db.users.create({
    id,
    username: id,
    email: `${id}@example.com`,
    password: 'x',
    avatar: '',
    role,
    level: 1,
    xp: 0,
    xpNeeded: xpForLevel(1),
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: true,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  } as never);
}

const adjust = (amount: number) =>
  request(app)
    .post(`/api/admin/users/${MEMBER}/adjust-xp`)
    .set(auth(ADMIN))
    .send({ amount, reason: 'test korekcija' });

describe.skipIf(db.kind !== 'memory')('6.0.0 — admin XP korekcija', () => {
  beforeAll(async () => {
    await makeUser(ADMIN, 'admin');
    await makeUser(MEMBER, 'member');
  });

  it('dodeljuje XP mimo dnevnog limita (potrošen budžet ne odseca bonus)', async () => {
    await resetDailyXpBudget(MEMBER);

    // Potroši ceo dnevni budžet običnim XP-om — admin bonus ne sme da se odseče.
    await awardXp(MEMBER, 300, { reason: 'reply' });
    await db.users.update(MEMBER, { xp: 0, level: 1 });

    const res = await adjust(756);
    expect(res.status).toBe(200);
    // Sa starim kodom (`awardXp` → `spend_daily_xp`) ovde je bilo 0.
    expect(res.body.applied).toBe(756);

    const after = (await db.users.findById(MEMBER))!;
    expect(after.xp).toBe(756);
  });

  it('756 XP je još nivo 1 (prag 2. nivoa je 1275), ali traka ide do 756/1275', async () => {
    const user = (await db.users.findById(MEMBER))!;
    const progress = levelProgress(user.xp);

    expect(xpForLevel(2)).toBe(1275);
    expect(progress.level).toBe(1);
    expect(progress.into).toBe(756);
    expect(progress.needed).toBe(1275);
    expect(progress.remaining).toBe(519);

    // Javni profil vraća isto — ranije je pisalo „500 / 500“ (traka puna).
    const profile = await request(app).get(`/api/users/${MEMBER}`);
    expect(profile.status).toBe(200);
    expect(profile.body.level).toBe(1);
    expect(profile.body.xpNeeded).toBe(1275);
    expect(profile.body.xpIntoLevel).toBe(756);
    expect(profile.body.xpForNext).toBe(1275);
  });

  it('prelazak praga (1275 XP) automatski podiže nivo na 2', async () => {
    const res = await adjust(1275 - 756);
    expect(res.status).toBe(200);

    const after = (await db.users.findById(MEMBER))!;
    expect(after.xp).toBe(1275);
    expect(after.level).toBe(2);
    expect(levelProgress(after.xp)).toMatchObject({ level: 2, into: 0, needed: xpForLevel(3) - 1275 });
  });

  it('negativan iznos skida XP ali nikad ispod 0 i spušta nivo', async () => {
    const res = await adjust(-5000);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(-1275); // tačno do 0, ne ispod

    const after = (await db.users.findById(MEMBER))!;
    expect(after.xp).toBe(0);
    expect(after.level).toBe(1);
  });

  it('ručni upis XP-a usklađuje keš kolonu nivoa', async () => {
    // Simulira stari podatak / direktan SQL: XP prelazi prag, `level` zaostaje.
    await db.users.update(MEMBER, { xp: xpForLevel(5) + 1, level: 1 });
    const user = (await db.users.findById(MEMBER))!;
    expect(user.level).toBe(5);
  });
});
