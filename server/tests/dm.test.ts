import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

/**
 * 2.11.0 — PRIVATNE PORUKE (DM).
 *
 * Proverava ugovor ruta: razgovor je jedinstven PAR, nepročitano se broji po
 * primaocu, blokada radi u oba smera, a razgovor tuđeg korisnika je 404 (ne 403
 * — ne odajemo da postoji).
 */

process.env.JWT_SECRET ||= 'test-secret-for-dm-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();

const ALICE = 'dmv_alice';
const BOB = 'dmv_bob';
const CAROL = 'dmv_carol';

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
  for (const id of [ALICE, BOB, CAROL]) await makeUser(id);
});

describe.skipIf(db.kind !== 'memory')('DM — razgovor i poruke', () => {
  let conversationId = '';

  it('POST /dm/send pravi razgovor i vraća poruku', async () => {
    const response = await request(app)
      .post('/api/dm/send')
      .set(auth(ALICE))
      .send({ toUsername: BOB, content: 'Zdravo Bobu!' });

    expect(response.status).toBe(201);
    expect(response.body.conversationId).toBeTruthy();
    expect(response.body.message.content).toBe('Zdravo Bobu!');
    conversationId = response.body.conversationId;
  });

  it('razgovor je JEDINSTVEN po paru bez obzira na smer (A→B = B→A)', async () => {
    const reverse = await request(app)
      .post('/api/dm/send')
      .set(auth(BOB))
      .send({ toUsername: ALICE, content: 'Zdravo Alice!' });

    expect(reverse.status).toBe(201);
    expect(reverse.body.conversationId).toBe(conversationId);
  });

  it('POST /dm pronalazi postojeći razgovor', async () => {
    const response = await request(app).post('/api/dm').set(auth(ALICE)).send({ username: BOB });
    expect(response.status).toBe(201);
    expect(response.body.conversation.id).toBe(conversationId);
  });

  it('GET /dm lista razgovore sa partnerom i brojem nepročitanih', async () => {
    const alice = await request(app).get('/api/dm').set(auth(ALICE));
    expect(alice.status).toBe(200);

    const conversation = alice.body.conversations.find((c: any) => c.id === conversationId);
    expect(conversation).toBeTruthy();
    expect(conversation.partnerUsername).toBe(BOB);
    // Alice je pročitala sve (njen GET /dm ne markira, ali Bobova poruka je nepročitana).
    expect(conversation.unreadCount).toBe(1);
  });

  it('GET /dm/:id vraća poruke hronološki i označava pročitano', async () => {
    const response = await request(app).get(`/api/dm/${conversationId}`).set(auth(ALICE));
    expect(response.status).toBe(200);

    const contents = response.body.messages.map((m: any) => m.content);
    expect(contents).toEqual(['Zdravo Bobu!', 'Zdravo Alice!']);

    // Pročitano → brojač nepročitanih za Alice je 0.
    const unread = await request(app).get('/api/dm/unread-count').set(auth(ALICE));
    expect(unread.body.unreadCount).toBe(0);
  });

  it('treći korisnik ne vidi tuđi razgovor (404, ne 403)', async () => {
    const response = await request(app).get(`/api/dm/${conversationId}`).set(auth(CAROL));
    expect(response.status).toBe(404);
  });

  it('nepoznat razgovor je 404 (validan UUID koji ne postoji)', async () => {
    const response = await request(app)
      .get('/api/dm/00000000-0000-0000-0000-000000000000')
      .set(auth(ALICE));
    expect(response.status).toBe(404);
  });

  it('prazna poruka je 400', async () => {
    const response = await request(app)
      .post(`/api/dm/${conversationId}/messages`)
      .set(auth(ALICE))
      .send({ content: '   ' });
    expect(response.status).toBe(400);
  });
});

describe.skipIf(db.kind !== 'memory')('DM — blokade i autorizacija', () => {
  it('blokiran korisnik ne može da pošalje poruku (oba smera)', async () => {
    // Carol blokira Boba.
    await db.blocks.block(CAROL, BOB);
    const carolToBob = await request(app)
      .post('/api/dm/send')
      .set(auth(CAROL))
      .send({ toUsername: BOB, content: 'Hej' });
    expect(carolToBob.status).toBe(403);

    // Bob ne može ni da odgovori Carol (blokada važi u oba smera).
    const bobToCarol = await request(app)
      .post('/api/dm/send')
      .set(auth(BOB))
      .send({ toUsername: CAROL, content: 'Hej' });
    expect(bobToCarol.status).toBe(403);
  });

  it('razgovor sa sobom je 400', async () => {
    const response = await request(app)
      .post('/api/dm/send')
      .set(auth(ALICE))
      .send({ toUsername: ALICE, content: 'Ja' });
    expect(response.status).toBe(400);
  });

  it('gost dobija 401', async () => {
    const response = await request(app).get('/api/dm');
    expect(response.status).toBe(401);
  });
});

describe.skipIf(db.kind !== 'memory')('DM — poruka je notifikacija', () => {
  it('primalac dobija in-app notifikaciju tipa `dm`', async () => {
    const notifications = await db.notifications.list({ userId: BOB });
    const dmNotification = notifications.find((n) => n.type === 'dm');
    expect(dmNotification).toBeTruthy();
    expect(dmNotification?.link).toContain('/messages/');
  });
});

describe.skipIf(db.kind !== 'memory')('DM — GDPR brisanje naloga', () => {
  it('deleteAllForUser uklanja razgovore i poruke korisnika', async () => {
    // Sopstveni par (ne deli se sa prethodnim blokom testova).
    const conversation = await db.dm.findOrCreateConversation(ALICE, CAROL);
    await db.dm.createMessage({
      conversationId: conversation.id,
      senderId: ALICE,
      content: 'Poruka koja mora da nestane',
    });

    const before = await db.dm.listMessages(conversation.id);
    expect(before.length).toBeGreaterThan(0);

    await db.dm.deleteAllForUser(ALICE);

    expect(await db.dm.findConversation(conversation.id)).toBeNull();
    expect(await db.dm.listMessages(conversation.id)).toHaveLength(0);
  });
});
