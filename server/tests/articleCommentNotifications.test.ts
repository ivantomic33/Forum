import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

/**
 * Komentari članaka → notifikacije.
 *
 * Forum je notifikovao autora teme, roditeljskog komentara i @mentions, ali
 * ruta za komentare na članak nije notifikovala NIKOGA — neko je mogao da
 * odgovori na tvoj komentar i da to nikad ne vidiš. Ovde se proverava da
 * `POST /api/articles/:id/comments` obaveštava ta tri izvora, bez duplikata.
 */

process.env.JWT_SECRET ||= 'test-secret-for-article-comment-notification';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const AUTHOR = 'acn_author';
const COMMENTER = 'acn_commenter';
const REPLIER = 'acn_replier';
const MENTIONED = 'acn_mentioned';
const OUTSIDER = 'acn_outsider';
const ARTICLE = 'art_acn_test';

const app = createApp();

const tokenFor = (id: string) =>
  jwt.sign({ id, username: id, role: 'member', tv: 0 }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
const auth = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

async function makeUser(id: string) {
  const existing = await db.users.findById(id);
  if (existing) return existing;
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
    isVerified: true,
    isBanned: false,
    status: 'offline',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  } as any);
}

const notificationsFor = async (userId: string) => db.notifications.list({ userId });

beforeAll(async () => {
  for (const id of [AUTHOR, COMMENTER, REPLIER, MENTIONED, OUTSIDER]) await makeUser(id);

  if (!(await db.articles.findById(ARTICLE))) {
    await db.articles.create({
      id: ARTICLE,
      slug: 'clanak-notifikacije',
      title: 'Članak za notifikacije',
      excerpt: '',
      content: 'sadržaj',
      coverImage: '',
      authorId: AUTHOR,
      author: AUTHOR,
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

describe.skipIf(db.kind !== 'memory')('Komentari članaka — notifikacije', () => {
  it('novi komentar obaveštava autora članka (link vodi na /article/:slug)', async () => {
    const response = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(COMMENTER))
      .send({ content: 'Odličan tekst!' });

    expect(response.status).toBe(201);

    const notifications = await notificationsFor(AUTHOR);
    const entry = notifications.find((n) => n.title.includes('Novi komentar'));
    expect(entry).toBeTruthy();
    expect(entry?.type).toBe('reply');
    expect(entry?.link).toContain('/article/');
  });

  it('odgovor na komentar obaveštava autora roditeljskog komentara', async () => {
    const parent = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(COMMENTER))
      .send({ content: 'Komentar na koji se odgovara' });
    expect(parent.status).toBe(201);

    const reply = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(REPLIER))
      .send({ content: 'Slažem se', parentId: parent.body.id });

    expect(reply.status).toBe(201);

    const notifications = await notificationsFor(COMMENTER);
    expect(notifications.some((n) => n.title.includes('Odgovor na vaš komentar'))).toBe(true);
  });

  it('@pominjanje šalje notifikaciju, a autorost komentara ostaje bez samonotifikacije', async () => {
    const response = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(REPLIER))
      .send({ content: `Hvala @${MENTIONED} za info.` });

    expect(response.status).toBe(201);

    const mentioned = await notificationsFor(MENTIONED);
    expect(mentioned.some((n) => n.type === 'mention')).toBe(true);

    const own = await notificationsFor(REPLIER);
    expect(own).toHaveLength(0);

    const outsider = await notificationsFor(OUTSIDER);
    expect(outsider).toHaveLength(0);
  });

  it('autor članka koji odgovori na sopstveni članak ne dobija notifikaciju za samog sebe', async () => {
    const before = (await notificationsFor(AUTHOR)).length;

    const response = await request(app)
      .post(`/api/articles/${ARTICLE}/comments`)
      .set(auth(AUTHOR))
      .send({ content: 'Autor odgovara' });

    expect(response.status).toBe(201);
    expect((await notificationsFor(AUTHOR)).length).toBe(before);
  });
});
