import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db, uid, type ThreadRecord } from '../lib/store.js';

/**
 * 6.x — „ZAŠTO MI JE NESTAO POST?“ + aktivnost sa odgovorima.
 *
 * Kada moderator ukloni tuđu temu (ili odgovor), autor dobija in-app
 * `warning` sa RAZLOGOM — bez mejla. Isto važi za `deletePost` kroz `PUT`
 * (razlog stiže u istom telu). Uz to: `/:username/activity` sada uključuje
 * odgovore i prihvaćene odgovore (timeline na profilu).
 */

process.env.JWT_SECRET ||= 'test-secret-for-moderation-notice-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const MOD = 'mod_notice_mod';
const AUTHOR = 'mod_notice_author';
const THREAD = 'thr_mod_notice_1';

const tokenFor = (id: string, role = 'member') =>
  jwt.sign({ id, username: id, role, tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
const auth = (id: string, role = 'member') => ({ Authorization: `Bearer ${tokenFor(id, role)}` });

async function makeUser(id: string, role: 'admin' | 'moderator' | 'member') {
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

let replyId = '';

beforeAll(async () => {
  await makeUser(MOD, 'moderator');
  await makeUser(AUTHOR, 'member');

  if (!(await db.forum.findThread(THREAD))) {
    const thread: ThreadRecord = {
      id: THREAD,
      subforum: 'PC Gaming',
      title: 'Tema koja će biti uklonjena',
      content: 'Sadržaj teme.',
      author: AUTHOR,
      authorId: AUTHOR,
      tags: [],
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 0,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
    } as ThreadRecord;
    await db.forum.createThread(thread);
  }

  if (!replyId) {
    // Direktno kroz data layer: test ne zavisi od rate-limit-a ni od obaveznog
    // `requireVerified` na ruti za odgovore.
    const reply = await db.forum.createReply({
      id: uid('rep'),
      threadId: THREAD,
      parentId: null,
      author: AUTHOR,
      authorId: AUTHOR,
      content: '<p>Odgovor autora na sopstvenu temu.</p>',
      karma: 0,
      isSpoiler: false,
      createdAt: new Date().toISOString(),
    } as any);
    replyId = reply.id;
  }
});

describe.skipIf(db.kind !== 'memory')('uklanjanje sadržaja — autor saznaje razlog', () => {
  it('moderator briše temu sa razlogom → autor dobija warning u inboxu', async () => {
    await request(app)
      .patch(`/api/forum/threads/${THREAD}/moderate`)
      .set(auth(MOD, 'moderator'))
      .send({ deleteThread: true, reason: 'Dupla tema — već postoji ista diskusija.' })
      .expect(200);

    const list = await db.notifications.list({ userId: AUTHOR, limit: 20 });
    const notice = list.find((item) => item.title.includes('uklonjena'));
    expect(notice).toBeTruthy();
    expect(notice?.type).toBe('warning');
    expect(notice?.message).toContain('Dupla tema');
    expect((notice?.metadata as { reason?: string })?.reason).toContain('Dupla tema');
  });

  it('moderator koji obriše SVOJU temu ne dobija notifikaciju o sopstvenom potezu', async () => {
    const ownThread: ThreadRecord = {
      id: 'thr_mod_own',
      subforum: 'PC Gaming',
      title: 'Moja tema',
      content: 'x',
      author: MOD,
      authorId: MOD,
      tags: [],
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 0,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
    } as ThreadRecord;
    await db.forum.createThread(ownThread);

    await request(app)
      .patch('/api/forum/threads/thr_mod_own/moderate')
      .set(auth(MOD, 'moderator'))
      .send({ deleteThread: true, reason: 'Sopstveni potez.' })
      .expect(200);

    const list = await db.notifications.list({ userId: MOD, limit: 20 });
    expect(list.some((item) => item.title.includes('uklonjena') && item.metadata?.threadId === 'thr_mod_own')).toBe(false);
  });

  it('moderator uklanja tuđi odgovor kroz PUT → autor dobija razlog', async () => {
    // Tema mora postojati (prethodni test ju je obrisao) — vrati je.
    await db.forum.updateThread(THREAD, { isDeleted: false });

    await request(app)
      .put(`/api/forum/replies/${replyId}`)
      .set(auth(MOD, 'moderator'))
      .send({ deletePost: true, reason: 'Vređanje u odgovoru.' })
      .expect(200);

    const list = await db.notifications.list({ userId: AUTHOR, limit: 20 });
    const notice = list.find((item) => item.title.includes('Vaš odgovor je uklonjen'));
    expect(notice).toBeTruthy();
    expect(notice?.message).toContain('Vređanje');
  });
});

describe.skipIf(db.kind !== 'memory')('aktivnost profila', () => {
  it('uključuje odgovore i prihvaćene odgovore, ne samo teme', async () => {
    // Prethodni test je obrisao temu (i njen odgovor nestaje iz aktivnosti), pa
    // se pravi sveža tema SA odgovorom — aktivnost gleda samo žive teme.
    const liveThread = `thr_live_${Date.now()}`;
    await db.forum.createThread({
      id: liveThread,
      subforum: 'PC Gaming',
      title: 'Živa tema za aktivnost',
      content: 'x',
      author: AUTHOR,
      authorId: AUTHOR,
      tags: [],
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 1,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
    } as any);
    await db.forum.createReply({
      id: uid('rep'),
      threadId: liveThread,
      parentId: null,
      author: AUTHOR,
      authorId: AUTHOR,
      content: '<p>Živ odgovor.</p>',
      karma: 0,
      isSpoiler: false,
      createdAt: new Date().toISOString(),
    } as any);

    const res = await request(app).get(`/api/users/${AUTHOR}/activity`).expect(200);
    const types = new Set((res.body.activities as Array<{ type: string }>).map((item) => item.type));
    expect(types.has('thread')).toBe(true);
    expect(types.has('reply') || types.has('solved')).toBe(true);
    // Ne vraća se neograničena lista (timeline + tab, ne ceo istorijat).
    expect((res.body.activities as unknown[]).length).toBeLessThanOrEqual(80);
  });
});
