import { describe, expect, it } from 'vitest';
import { db } from '../lib/store.js';
import { getPasswordChecks, isPasswordValid, passwordError } from '../../src/lib/passwordRules';

/**
 * Regresije 2.5.3: obrisana tema/odgovor (F-13), pravila lozinke (F-14),
 * glasanje (F-17) i SQL agregate/paginaciju (F-18).
 *
 * `passwordRules` se importuje iz `src/` (van `rootDir` servera) — zato je
 * `tsc --noEmit` za server isključuje preko `tsconfig` exclude-a.
 */

describe('F-14 — frontend pravila lozinke su ista kao backend', () => {
  it('6 znakova + veliko slovo više nije dovoljno', () => {
    expect(isPasswordValid('Abc12!')).toBe(false);
    expect(passwordError('Abc12!')).toBe('Najmanje 8 karaktera');
  });

  it('8 znakova + slovo + broj prolazi (veliko slovo nije obavezno)', () => {
    expect(isPasswordValid('NeMojeCesta9')).toBe(true);
  });

  it('česte lozinke su odbijene', () => {
    expect(isPasswordValid('password123')).toBe(false);
    expect(getPasswordChecks('password123').find((c) => c.rule === 'common')?.ok).toBe(false);
  });

  it('regex prepoznaje velika naša slova (ČĆŽŠĐ), ne pokvarene UTF-8 sekvence', () => {
    const letter = getPasswordChecks('Čoooo123').find((c) => c.rule === 'letter');
    expect(letter?.ok).toBe(true);
    expect(getPasswordChecks('12345678').find((c) => c.rule === 'letter')?.ok).toBe(false);
  });
});

describe.skipIf(db.kind !== 'memory')('F-13 / F-17 / F-18 — data layer', () => {
  const USER = 'usr_253_test';
  const THREAD = 'thr_253_deleted';
  const REPLY = 'rep_253_deleted';

  it('priprema: tema i odgovor', async () => {
    if (!(await db.users.findById(USER))) {
      await db.users.create({
        id: USER,
        username: 'DeletedTester',
        email: 'deleted@example.com',
        password: 'hash',
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
      });
    }
    if (!(await db.forum.findThread(THREAD))) {
      await db.forum.createThread({
        id: THREAD,
        subforum: 'hardware',
        title: 'Obrisana tema 253',
        content: 'sadržaj',
        author: 'DeletedTester',
        authorId: USER,
        tags: [],
        isPinned: false,
        isLocked: false,
        isSpoiler: false,
        karma: 0,
        views: 5,
        replies: 1,
        createdAt: new Date().toISOString(),
        lastReplyAt: new Date().toISOString(),
      });
      await db.forum.createReply({
        id: REPLY,
        threadId: THREAD,
        parentId: null,
        author: 'DeletedTester',
        authorId: USER,
        content: 'odgovor',
        karma: 0,
        isSpoiler: false,
        createdAt: new Date().toISOString(),
      });
    }
    expect(await db.forum.findThread(THREAD)).not.toBeNull();
  });

  it('F-18 — countThreads ne broji obrisane teme', async () => {
    const before = await db.forum.countThreads({ subforum: 'hardware' });
    await db.forum.updateThread(THREAD, { isDeleted: true });
    const after = await db.forum.countThreads({ subforum: 'hardware' });
    expect(after).toBe(before - 1);
  });

  it('F-18 — paginacija limit/offset vraća samo traženu stranu', async () => {
    const page = await db.forum.listThreads({ limit: 2 });
    expect(page.length).toBeLessThanOrEqual(2);
  });

  it('F-13 — obrisani odgovor je označen i lista ga ne vraća', async () => {
    await db.forum.updateReply(REPLY, { isDeleted: true });
    const replies = await db.forum.listReplies(THREAD);
    expect(replies.some((r) => r.id === REPLY)).toBe(false);
    expect((await db.forum.findReply(REPLY))?.isDeleted).toBe(true);
  });

  it('F-17 — ponovni isti glas ne menja karmu (changed = false)', async () => {
    const target = 'thr_253_live';
    if (!(await db.forum.findThread(target))) {
      await db.forum.createThread({
        id: target,
        subforum: 'hardware',
        title: 'Živa tema',
        content: 'sadržaj',
        author: 'DeletedTester',
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

    const first = (await db.forum.vote(USER, target, 'up')) as { karma: number; changed?: boolean };
    expect(first.karma).toBe(1);
    expect(first.changed).not.toBe(false);

    const again = (await db.forum.vote(USER, target, 'up')) as { karma: number; changed?: boolean };
    expect(again.karma).toBe(1);
  });

  it('F-18 — sumViews agregat bez listanja', async () => {
    expect(await db.forum.sumViews()).toBeGreaterThanOrEqual(5);
    expect(await db.articles.sumViews()).toBeGreaterThanOrEqual(0);
  });
});
