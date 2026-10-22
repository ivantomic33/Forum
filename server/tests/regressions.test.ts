import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';
import { publicUser, ownerUser } from '../lib/userShape.js';

/**
 * Testovi za regresije iz 2.5.x (in-memory adapter).
 * Svaki test pokriva jedan konkretan bag koji je ranije prolazio tiho.
 */

const USER = 'usr_shape_test';

async function ensureUser(overrides: Record<string, unknown> = {}) {
  const existing = await db.users.findById(USER);
  if (existing) return existing;
  return db.users.create({
    id: USER,
    username: 'ShapeTester',
    email: 'shape@example.com',
    password: 'hash',
    avatar: '',
    bio: 'bio',
    role: 'member',
    level: 3,
    xp: 120,
    xpNeeded: 300,
    karma: 10,
    badges: [],
    connectedAccounts: {},
    isVerified: true,
    isBanned: false,
    status: 'offline',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...(overrides as object),
  });
}

describe('javni profil ne otkriva privatne podatke', () => {
  it('publicUser nema email, isBanned ni password', async () => {
    const user = await ensureUser({ isBanned: true });
    const safe = publicUser(user) as unknown as Record<string, unknown>;
    expect(safe.email).toBeUndefined();
    expect(safe.isBanned).toBeUndefined();
    expect(safe.password).toBeUndefined();
    expect(safe.username).toBe('ShapeTester');
  });

  it('ownerUser zadržava email svom vlasniku, ali nikad hash lozinke', async () => {
    const user = await ensureUser();
    const own = ownerUser(user) as unknown as Record<string, unknown>;
    expect(own.email).toBe('shape@example.com');
    expect(own.password).toBeUndefined();
  });
});

describe.skipIf(db.kind !== 'memory')('istorija povezanih naloga (XP se ne farmuje)', () => {
  beforeEach(async () => {
    await ensureUser();
  });

  it('otkačeni nalog ostaje u istoriji', async () => {
    const user = await ensureUser();
    await db.users.setConnectedAccount(user.id, 'steam', 'ShapeTester');
    await db.users.revokeConnectedAccount(user.id, 'steam');

    expect(await db.users.hasConnectedAccountHistory(user.id, 'steam', 'ShapeTester')).toBe(true);
    expect(await db.users.hasConnectedAccountHistory(user.id, 'steam', 'NekoDrugi')).toBe(false);
  });

  it('ponovno povezivanje posle odvajanja nije „novo“ povezivanje', async () => {
    const user = await ensureUser();
    await db.users.setConnectedAccount(user.id, 'discord', 'Shape#0001');
    await db.users.revokeConnectedAccount(user.id, 'discord');

    const active = await db.users.findById(user.id);
    const previouslyConnected = await db.users.hasConnectedAccountHistory(user.id, 'discord', 'Shape#0001');
    expect(active?.connectedAccounts.discord).toBeUndefined();
    expect(previouslyConnected).toBe(true);
  });
});

describe.skipIf(db.kind !== 'memory')('soft-deleted teme', () => {
  const THREAD = 'thr_deleted_test';

  beforeEach(async () => {
    await ensureUser();
    if (!(await db.forum.findThread(THREAD))) {
      await db.forum.createThread({
        id: THREAD,
        subforum: 'hardware',
        title: 'Obrisana tema',
        content: 'sadržaj',
        author: 'ShapeTester',
        authorId: USER,
        tags: [],
        isPinned: false,
        isLocked: false,
        isSpoiler: false,
        karma: 0,
        views: 0,
        replies: 0,
        createdAt: new Date().toISOString(),
        lastReplyAt: new Date().toISOString(),
      });
    }
    await db.forum.updateThread(THREAD, { isDeleted: false });
  });

  it('obrisana tema nestaje iz liste, ali ostaje čitljiva po ID-ju', async () => {
    await db.forum.updateThread(THREAD, { isDeleted: true });

    const list = await db.forum.listThreads({ subforum: 'hardware' });
    expect(list.some((thread) => thread.id === THREAD)).toBe(false);

    // Red ostaje u bazi (soft delete) — ruta odlučuje ko ga sme videti.
    expect(await db.forum.findThread(THREAD)).not.toBeNull();
  });

  it('obrisana tema nestaje i iz profila autora', async () => {
    await db.forum.updateThread(THREAD, { isDeleted: true });
    const threads = await db.forum.listThreadsByAuthor(USER, 'ShapeTester');
    expect(threads.some((thread) => thread.id === THREAD)).toBe(false);
  });
});
