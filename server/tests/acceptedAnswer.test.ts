import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db, type ThreadRecord } from '../lib/store.js';

/**
 * 2.11.0 — PRIHVAĆEN ODGOVOR (accepted answer).
 *
 * Pravila: označava SAMO autor teme (ili staff); XP ide autoru odgovora samo
 * pri PRVOM prihvatanju; `"none"` odznačava; odgovor tuđe teme je 404.
 */

process.env.JWT_SECRET ||= 'test-secret-for-accepted-answer-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const ASKER = 'acc_asker';
const HELPER = 'acc_helper';
const OTHER = 'acc_other';
const THREAD = 'thr_acc_test';

const tokenFor = (id: string, role = 'member') =>
  jwt.sign({ id, username: id, role, tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
const auth = (id: string, role = 'member') => ({ Authorization: `Bearer ${tokenFor(id, role)}` });

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

let helperReplyId = '';

beforeAll(async () => {
  for (const id of [ASKER, HELPER, OTHER]) await makeUser(id);

  if (!(await db.forum.findThread(THREAD))) {
    const thread: ThreadRecord = {
      id: THREAD,
      subforum: 'PC Gaming',
      title: 'Koji 1440p monitor do 300 evra?',
      content: 'Treba mi preporuka.',
      author: ASKER,
      authorId: ASKER,
      tags: [],
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 1,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
    };
    await db.forum.createThread(thread);
  }

  // Odgovor „pomagača“ — jednom, da se XP može uporediti pre/posle.
  if (!helperReplyId) {
    const created = await request(app)
      .post(`/api/forum/threads/${THREAD}/comments`)
      .set(auth(HELPER))
      .send({ content: 'Predlažem model X.' });
    helperReplyId = created.body.id;
  }
});

describe.skipIf(db.kind !== 'memory')('Prihvaćen odgovor', () => {
  it('autor teme označava rešenje i autor odgovora dobija XP', async () => {
    const before = (await db.users.findById(HELPER))!.xp;

    const response = await request(app)
      .patch(`/api/forum/threads/${THREAD}/accept/${helperReplyId}`)
      .set(auth(ASKER));

    expect(response.status).toBe(200);
    expect(response.body.acceptedReplyId).toBe(helperReplyId);
    // 6.x — XP za prihvaćen odgovor sada dolazi iz `XP.ACCEPTED_ANSWER` (10),
    // a reputacija ide u odvojen brojač (`solvedAnswers`), ne u karmu.
    expect(response.body.awardedXp).toBe(10);

    // XP se dodeljuje asinhrono (`void awardXp`, dva poziva: XP + reputacija) —
    // čekamo dok se OBA ne upišu (fiksno `setTimeout` je u celom suite-u flaky).
    let afterUser = (await db.users.findById(HELPER))!;
    for (let attempt = 0; attempt < 40 && (afterUser.xp <= before || (afterUser.solvedAnswers ?? 0) === 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      afterUser = (await db.users.findById(HELPER))!;
    }
    expect(afterUser.xp).toBeGreaterThan(before);

    // 6.x — reputacija: brojač prihvaćenih odgovora raste odvojeno od XP-a.
    expect(afterUser.solvedAnswers ?? 0).toBe(1);

    const thread = await db.forum.findThread(THREAD);
    expect(thread?.acceptedReplyId).toBe(helperReplyId);

    // 6.x — javni profil nosi reputaciju, a lista tema znažu `solved`.
    const profile = await request(app).get(`/api/users/${HELPER}`).expect(200);
    expect(profile.body.solvedAnswers).toBe(1);
    const list = await request(app).get('/api/forum/all/threads').expect(200);
    const row = (list.body.threads as any[]).find((item) => item.id === THREAD);
    expect(row?.solved).toBe(true);
  });

  it('ponovni izbor NE daje ponovni XP (zastita od farmovanja)', async () => {
    const response = await request(app)
      .patch(`/api/forum/threads/${THREAD}/accept/${helperReplyId}`)
      .set(auth(ASKER));

    expect(response.status).toBe(200);
    expect(response.body.awardedXp).toBe(0);
  });

  it('`none` odznačava rešenje', async () => {
    const response = await request(app)
      .patch(`/api/forum/threads/${THREAD}/accept/none`)
      .set(auth(ASKER));

    expect(response.status).toBe(200);
    expect(response.body.acceptedReplyId).toBeNull();
    expect((await db.forum.findThread(THREAD))?.acceptedReplyId).toBeNull();
    // Reputacija se NE smanjuje — istorija pomoći ostaje.
    expect((await db.users.findById(HELPER))!.solvedAnswers ?? 0).toBe(1);
  });

  it('drugi član ne može da označi rešenje u tuđoj temi (403)', async () => {
    const response = await request(app)
      .patch(`/api/forum/threads/${THREAD}/accept/${helperReplyId}`)
      .set(auth(OTHER));

    expect(response.status).toBe(403);
  });

  it('staff (moderator) može da označi rešenje', async () => {
    // `authenticate` čita rolu iz BAZE, ne iz tokena — zato se korisnik
    // privremeno unapredi i posle testa vrati (oba `describe` bloka dele store).
    await db.users.update(OTHER, { role: 'moderator' } as any);
    try {
      const response = await request(app)
        .patch(`/api/forum/threads/${THREAD}/accept/${helperReplyId}`)
        .set(auth(OTHER, 'moderator'));

      expect(response.status).toBe(200);
    } finally {
      await db.users.update(OTHER, { role: 'member' } as any);
    }
  });

  it('odgovor koji ne pripada temi je 404', async () => {
    const response = await request(app)
      .patch(`/api/forum/threads/${THREAD}/accept/00000000-0000-0000-0000-000000000000`)
      .set(auth(ASKER));

    expect(response.status).toBe(404);
  });

  it('nepostojeća tema je 404', async () => {
    const response = await request(app)
      .patch(`/api/forum/threads/00000000-0000-0000-0000-000000000000/accept/${helperReplyId}`)
      .set(auth(ASKER));

    expect(response.status).toBe(404);
  });

  it('filter `solved=no` prikazuje samo teme bez rešenja', async () => {
    const unsolved = await request(app).get('/api/forum/all/threads?solved=no').expect(200);
    expect((unsolved.body.threads as any[]).some((item) => item.id === THREAD)).toBe(false);

    // Vrati rešenje da sledeći testovi imaju poznato stanje.
    await request(app).patch(`/api/forum/threads/${THREAD}/accept/${helperReplyId}`).set(auth(ASKER)).expect(200);
    const solved = await request(app).get('/api/forum/all/threads?solved=no').expect(200);
    expect((solved.body.threads as any[]).some((item) => item.id === THREAD)).toBe(false);
  });

  it('autor odgovora dobija notifikaciju da je rešenje prihvaćeno', async () => {
    const notifications = await db.notifications.list({ userId: HELPER });
    expect(notifications.some((n) => n.title.includes('prihvaćen'))).toBe(true);
  });
});
