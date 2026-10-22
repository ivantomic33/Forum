import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';

/**
 * Ovi testovi rade protiv in-memory adaptera (bez SUPABASE env).
 * U CI-ju nema baze, pa je data layer u `memory` režimu.
 */

const USER_A = 'usr_block_test_a';
const USER_B = 'usr_block_test_b';
const THREAD = 'thr_follow_test';

async function ensureUsers() {
  for (const id of [USER_A, USER_B]) {
    await db.users.create({
      id,
      username: id.slice(-1),
      email: `${id}@example.com`,
      password: 'x',
      avatar: '',
      role: 'member',
      level: 1,
      xp: 0,
      xpNeeded: 0,
      karma: 0,
      badges: [],
      connectedAccounts: {},
      isVerified: true,
      isBanned: false,
      status: 'offline',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  }
}

describe.skipIf(db.kind !== 'memory')('user blocks (in-memory)', () => {
  beforeEach(ensureUsers);

  it('blokira i odblokira korisnika', async () => {
    await db.blocks.block(USER_A, USER_B);
    expect(await db.blocks.list(USER_A)).toContain(USER_B);
    expect(await db.blocks.blockedIds(USER_A)).toContain(USER_B);

    await db.blocks.unblock(USER_A, USER_B);
    expect(await db.blocks.list(USER_A)).not.toContain(USER_B);
  });

  it('blok je idempotentan (duplo blokiranje ne stvara duplikat)', async () => {
    await db.blocks.block(USER_A, USER_B);
    await db.blocks.block(USER_A, USER_B);
    const list = await db.blocks.list(USER_A);
    expect(list.filter((id) => id === USER_B)).toHaveLength(1);
  });

  it('blok je jednosmeran: B može da vidi A', async () => {
    await db.blocks.block(USER_A, USER_B);
    expect(await db.blocks.list(USER_B)).not.toContain(USER_A);
  });
});

describe.skipIf(db.kind !== 'memory')('thread subscriptions (in-memory)', () => {
  beforeEach(ensureUsers);

  it('prati i otpraća temu', async () => {
    await db.subscriptions.follow(USER_A, THREAD);
    expect(await db.subscriptions.isFollowing(USER_A, THREAD)).toBe(true);
    expect(await db.subscriptions.followers(THREAD)).toContain(USER_A);

    await db.subscriptions.unfollow(USER_A, THREAD);
    expect(await db.subscriptions.isFollowing(USER_A, THREAD)).toBe(false);
  });

  it('vraća više pratilaca iste teme', async () => {
    await db.subscriptions.follow(USER_A, THREAD);
    await db.subscriptions.follow(USER_B, THREAD);
    const followers = await db.subscriptions.followers(THREAD);
    expect(followers).toEqual(expect.arrayContaining([USER_A, USER_B]));
  });
});

describe.skipIf(db.kind !== 'memory')('quests (in-memory)', () => {
  beforeEach(ensureUsers);

  it('napreduje kvest i označava završetak', async () => {
    const first = await db.quests.advance(USER_A, 'voice_of_reason', 1);
    expect(first).toMatchObject({ progress: 1, completed: false, alreadyCompleted: false });

    const second = await db.quests.advance(USER_A, 'voice_of_reason', 20);
    expect(second?.completed).toBe(true);
    expect(second?.progress).toBe(10); // ne prelazi target_count
  });

  it('vraća null za nepoznat kvest', async () => {
    expect(await db.quests.advance(USER_A, 'nema_ovaj_kvest')).toBeNull();
  });

  it('listForUser vraća progres za sve kvestove', async () => {
    await db.quests.advance(USER_A, 'first_discussion', 1);
    const quests = await db.quests.listForUser(USER_A);
    const first = quests.find((q) => q.code === 'first_discussion');
    expect(first?.completed).toBe(true);
    expect(quests.length).toBeGreaterThan(0);
  });
});

describe.skipIf(db.kind !== 'memory')('bans (in-memory)', () => {
  beforeEach(ensureUsers);

  it('čuva aktivan ban sa razlogom', async () => {
    await db.bans.ban({
      userId: USER_A,
      reason: 'Spam',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      bannedBy: USER_B,
      createdAt: new Date().toISOString(),
    });

    const active = await db.bans.findActive(USER_A);
    expect(active?.reason).toBe('Spam');
    expect(active?.bannedBy).toBe(USER_B);
  });

  it('istekli ban se više ne vraća kao aktivan', async () => {
    await db.bans.ban({
      userId: USER_A,
      reason: 'Privremeni',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    expect(await db.bans.findActive(USER_A)).toBeNull();
  });

  it('lift uklanja ban', async () => {
    await db.bans.ban({
      userId: USER_A,
      reason: 'Test',
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    await db.bans.lift(USER_A);
    expect(await db.bans.findActive(USER_A)).toBeNull();
  });

  it('expireOverdue vraća samo istekle banove', async () => {
    await db.bans.ban({
      userId: USER_A,
      reason: 'Istekao',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    await db.bans.ban({
      userId: USER_B,
      reason: 'Aktivan',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const expired = await db.bans.expireOverdue();
    expect(expired).toContain(USER_A);
    expect(expired).not.toContain(USER_B);
    expect(await db.bans.findActive(USER_B)).not.toBeNull();
  });
});
