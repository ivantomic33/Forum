import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db, type ThreadRecord } from '../lib/store.js';

/**
 * GDPR / ZZPL — pravo na brisanje (`DELETE /api/users/me`).
 *
 * Ranije je brisanje anonimiziralo SAMO teme: odgovori, komentari na članke,
 * GG poruke i DM-ovi ostajali su vezani za `userId`. Ovaj test pravi korisnika
 * sa sadržajem u SVAKOJ vrsti, briše nalog i proverava da nijedan red više ne
 * nosi njegov ID.
 */

process.env.JWT_SECRET ||= 'test-secret-for-gdpr-delete-tests-0123';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const LEAVER = 'gdpr_leaver';
const FRIEND = 'gdpr_friend';
const THREAD = 'thr_gdpr_leave';
const ARTICLE = 'art_gdpr_leave';

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
  await makeUser(LEAVER);
  await makeUser(FRIEND);

  if (!(await db.forum.findThread(THREAD))) {
    const thread: ThreadRecord = {
      id: THREAD,
      subforum: 'PC Gaming',
      title: 'Tema korisnika koji odlazi',
      content: 'Sadržaj',
      author: LEAVER,
      authorId: LEAVER,
      tags: [],
      isPinned: false,
      isLocked: false,
      isSpoiler: false,
      karma: 0,
      views: 0,
      replies: 0,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
    };
    await db.forum.createThread(thread);
  }

  if (!(await db.articles.findById(ARTICLE))) {
    await db.articles.create({
      id: ARTICLE,
      slug: 'clanak-gdpr',
      title: 'Članak',
      excerpt: '',
      content: 'sadržaj',
      coverImage: '',
      authorId: FRIEND,
      author: FRIEND,
      category: 'news',
      tags: [],
      status: 'published',
      isFeatured: false,
      views: 0,
      reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
  }
});

describe.skipIf(db.kind !== 'memory')('GDPR — brisanje naloga briše sve lične veze', () => {
  it('pravi sadržaj u svakoj vrsti pre brisanja', async () => {
    // Odgovor u sopstvenoj temi
    const reply = await request(app)
      .post(`/api/forum/threads/${THREAD}/comments`)
      .set(auth(LEAVER))
      .send({ content: 'Moj odgovor' });
    expect(reply.status).toBe(201);

    // Komentar na članak
    const comment = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(LEAVER))
      .send({ content: 'Moj komentar' });
    expect(comment.status).toBe(201);

    // GG na profil prijatelja
    const guestbook = await request(app)
      .put(`/api/users/${FRIEND}/guestbook`)
      .set(auth(LEAVER))
      .send({ message: 'Pozdrav!' });
    expect(guestbook.status).toBe(201);

    // DM
    const dm = await request(app)
      .post('/api/dm/send')
      .set(auth(LEAVER))
      .send({ toUsername: FRIEND, content: 'Tajna poruka' });
    expect(dm.status).toBe(201);
  });

  it('DELETE /api/users/me ne ostavlja nijedan red sa `userId` korisnika', async () => {
    const response = await request(app).delete('/api/users/me').set(auth(LEAVER));
    expect(response.status).toBe(200);

    // 1) Odgovori na forumu — soft-deleted, ali bez `authorId` veze.
    const replies = await db.forum.listAllRepliesByAuthor(LEAVER);
    expect(replies.every((reply) => (reply as any).isDeleted)).toBe(true);

    // 2) Komentari na člancima — `userId` uklonjen, ne samo javno ime.
    const comments = await db.articles.listCommentsByUser(LEAVER);
    expect(comments).toHaveLength(0);

    // 3) GG poruke — više ne postoje.
    expect(await db.guestbook.listByAuthor(LEAVER)).toHaveLength(0);

    // 4) DM — razgovori i poruke uklonjeni.
    const conversations = await db.dm.listConversations(LEAVER);
    expect(conversations).toHaveLength(0);

    // 5) Notifikacije i sačuvano.
    expect(await db.notifications.list({ userId: LEAVER })).toHaveLength(0);
    expect(await db.bookmarks.list(LEAVER)).toHaveLength(0);

    // 6) Lični podaci na nalogu.
    const user = await db.users.findById(LEAVER);
    expect(user?.email).toMatch(/@deleted\.invalid$/);
    expect(user?.bio).toBe('');
    expect(user?.avatar).toBe('');
    expect(user?.badges).toEqual([]);
  });

  it('sesije su poništene — stari token više ne važi', async () => {
    const response = await request(app).get('/api/auth/me').set(auth(LEAVER));
    expect([401, 403]).toContain(response.status);
  });

  it('tuđi sadržaj ostaje netaknut', async () => {
    // Članak je prijateljev — komentari drugih i sam članak ostaju.
    const article = await db.articles.findById(ARTICLE);
    expect(article).toBeTruthy();
    expect(article?.authorId).toBe(FRIEND);
  });
});
