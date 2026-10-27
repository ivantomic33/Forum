import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';
import { searchAll, searchRepliesFallback } from '../lib/search.js';
import { computeDiscountPct } from '../lib/deals.js';

/**
 * 2.6.6 — F-13 (pretraga odgovora) i F-3 (deal → tema).
 *
 * Testovi rade u `memory` režimu i pokrivaju ponašanje koje se lako pokvari
 * tiho:
 *  - odgovor se nalazi kao `type=reply` sa dubokim linkom `#post-<id>`;
 *  - obrisani odgovor ne izlazi u pretrazi;
 *  - u `type=all` odgovori NE istiskuju teme/članke (samo eksplicitan tab);
 *  - `dealId` se čuva na temi i preživljava ponovno čitanje.
 */

const SUFFIX = `f13_${Date.now().toString(36)}`;
const AUTHOR = { id: `usr_${SUFFIX}`, username: `autor_${SUFFIX}` };

async function ensureAuthor() {
  if (await db.users.findById(AUTHOR.id)) return;
  const now = new Date().toISOString();
  await db.users.create({
    id: AUTHOR.id,
    username: AUTHOR.username,
    email: `${AUTHOR.username}@example.com`,
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
    createdAt: now,
    lastSeenAt: now,
  });
}

async function makeThread(patch: { dealId?: string | null; title?: string } = {}) {
  const now = new Date().toISOString();
  return db.forum.createThread({
    id: `thr_${SUFFIX}_${Math.random().toString(36).slice(2, 7)}`,
    subforum: 'lfg',
    title: patch.title ?? 'Hogwarts Legacy — diskusija',
    content: '<p>Prvi post o Hogwarts Legacy.</p>',
    author: AUTHOR.username,
    authorId: AUTHOR.id,
    tags: [],
    karma: 0,
    views: 0,
    replies: 0,
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    dealId: patch.dealId ?? null,
    createdAt: now,
    lastReplyAt: now,
  });
}

async function addReply(threadId: string, content: string) {
  return db.forum.createReply({
    id: `rep_${SUFFIX}_${Math.random().toString(36).slice(2, 7)}`,
    threadId,
    parentId: null,
    author: AUTHOR.username,
    authorId: AUTHOR.id,
    content,
    karma: 0,
    isSpoiler: false,
    createdAt: new Date().toISOString(),
  });
}

describe.skipIf(db.kind !== 'memory')('F-13 — pretraga odgovora', () => {
  beforeEach(ensureAuthor);

  it('nalazi odgovor i vraća duboki link na temu (#post-<id>)', async () => {
    const thread = await makeThread();
    const reply = await addReply(thread.id, 'Zmajevi u Hogwarts dvorcu su prelepi.');

    const { hits } = await searchAll({ q: 'dvorcu', type: 'replies' });
    const hit = hits.find((entry) => entry.id === reply.id);

    expect(hit).toBeTruthy();
    expect(hit).toMatchObject({
      type: 'reply',
      href: `/thread/${thread.id}#post-${reply.id}`,
      threadTitle: thread.title,
    });
    expect(hit!.snippet).toContain('dvorcu');
  });

  it('obrisan odgovor se ne vraća', async () => {
    const thread = await makeThread();
    const reply = await addReply(thread.id, 'Tajna reč je flamingo.');
    await db.forum.updateReply(reply.id, { isDeleted: true });

    const hits = await searchRepliesFallback('flamingo', 20);
    expect(hits.some((entry) => entry.id === reply.id)).toBe(false);
  });

  it('`type=all` ne uključuje odgovore — samo eksplicitan tab', async () => {
    const thread = await makeThread({ title: 'Kontrolna tema' });
    await addReply(thread.id, 'Jabuka je pomenuta samo u odgovoru.');

    const all = await searchAll({ q: 'jabuka', type: 'all' });
    expect(all.hits.every((entry) => entry.type !== 'reply')).toBe(true);

    const only = await searchAll({ q: 'jabuka', type: 'replies' });
    expect(only.hits.every((entry) => entry.type === 'reply')).toBe(true);
    expect(only.hits.length).toBeGreaterThan(0);
  });
});

describe.skipIf(db.kind !== 'memory')('F-3 — tema iz deal-a', () => {
  beforeEach(ensureAuthor);

  it('`dealId` se čuva i vidljiv je pri čitanju teme', async () => {
    const now = new Date().toISOString();
    const deal = await db.deals.create({
      id: `deal_${SUFFIX}`,
      authorId: AUTHOR.id,
      author: AUTHOR.username,
      gameId: null,
      gameSlug: null,
      gameTitle: null,
      gameCover: null,
      title: 'Elden Ring — akcija',
      url: 'https://example.com/elden-ring',
      proofUrl: null,
      price: 20,
      originalPrice: 40,
      discountPct: computeDiscountPct(20, 40),
      currency: 'EUR',
      store: 'Steam',
      platform: 'pc',
      description: null,
      expiresAt: null,
      status: 'active',
      isVerified: false,
      score: 0,
      createdAt: now,
      updatedAt: now,
    });

    const thread = await makeThread({ dealId: deal.id, title: `Popust: ${deal.title}` });
    const reloaded = await db.forum.findThread(thread.id);

    expect(reloaded?.dealId).toBe(deal.id);
  });

  it('obična tema ima `dealId: null`', async () => {
    const thread = await makeThread();
    const reloaded = await db.forum.findThread(thread.id);
    expect(reloaded?.dealId ?? null).toBeNull();
  });
});
