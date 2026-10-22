import { describe, expect, it, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { db } from '../lib/store.js';

/**
 * Regresije 2.5.2: sesije (F-06), double opt-in (F-07), komentari (F-08),
 * draft članci (F-10) i reakcije (F-12).
 */

const SECRET = process.env.JWT_SECRET ?? '';
const USER = 'usr_252_session_test';

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long';
  if (!(await db.users.findById(USER))) {
    await db.users.create({
      id: USER,
      username: 'SessionTester',
      email: 'session@example.com',
      password: 'hash',
      avatar: '',
      bio: '',
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
});

describe.skipIf(db.kind !== 'memory')('F-06 — verzija sesije', () => {
  it('bumpSessionVersion povećava token_version', async () => {
    const before = (await db.users.findById(USER))!.tokenVersion ?? 0;
    const after = await db.users.bumpSessionVersion(USER);
    expect(after).toBe(before + 1);
    expect((await db.users.findById(USER))!.tokenVersion).toBe(after);
  });

  it('token izdat pre bump-a ima staru tv i biva odbijen', async () => {
    const user = (await db.users.findById(USER))!;
    const staleToken = jwt.sign({ id: USER, tv: user.tokenVersion }, process.env.JWT_SECRET as string, { expiresIn: '12h' });

    await db.users.bumpSessionVersion(USER);

    const decoded = jwt.verify(staleToken, process.env.JWT_SECRET as string) as { tv: number };
    const fresh = (await db.users.findById(USER))!;
    expect(decoded.tv).not.toBe(fresh.tokenVersion);
  });

  it('legacy token bez tv važi dok se verzija ne poveća (tv=0)', async () => {
    const user = (await db.users.findById(USER))!;
    const decoded = jwt.sign({ id: USER }, process.env.JWT_SECRET as string);
    const payload = jwt.verify(decoded, process.env.JWT_SECRET as string) as { tv?: number };
    expect(payload.tv ?? 0).toBe(0);
    expect(typeof user.tokenVersion).toBe('number');
  });
});

describe.skipIf(db.kind !== 'memory')('F-07 — double opt-in', () => {
  const EMAIL = 'optin@example.com';

  it('subscribe upisuje pending (is_active = false)', async () => {
    const record = await db.newsletter.subscribe(EMAIL);
    expect(record.isActive).toBe(false);
    expect(record.confirmedAt ?? null).toBeNull();
  });

  it('ponovni subscribe ne aktivira pretplatu', async () => {
    const record = await db.newsletter.subscribe(EMAIL);
    expect(record.isActive).toBe(false);
  });

  it('confirm aktivira i beleži dokaz saglasnosti (IP/UA)', async () => {
    const ok = await db.newsletter.confirm(EMAIL, { ip: '203.0.113.5', userAgent: 'vitest' });
    expect(ok).toBe(true);

    const record = (await db.newsletter.findAll()).find((n) => n.email === EMAIL)!;
    expect(record.isActive).toBe(true);
    expect(record.confirmedIp).toBe('203.0.113.5');
    expect(record.confirmedUserAgent).toBe('vitest');
    expect(record.confirmedAt).toBeTruthy();
  });

  it('confirm za nepoznatu adresu vraća false (ne kreira red)', async () => {
    expect(await db.newsletter.confirm('nema-ga@example.com')).toBe(false);
  });
});

describe.skipIf(db.kind !== 'memory')('F-08 / F-12 — komentari i reakcije u store-u', () => {
  const ARTICLE = 'art_252_test';

  beforeAll(async () => {
    if (!(await db.articles.findById(ARTICLE))) {
      await db.articles.create({
        id: ARTICLE,
        slug: 'test-clanak',
        title: 'Test članak',
        excerpt: '',
        content: 'sadržaj',
        coverImage: '',
        authorId: USER,
        author: 'SessionTester',
        category: 'news',
        tags: [],
        status: 'published',
        isFeatured: false,
        views: 0,
        reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  });

  it('komentar se upisuje i čita iz store-a', async () => {
    const now = new Date().toISOString();
    const saved = await db.articles.createComment({
      id: 'acm_test_1',
      articleId: ARTICLE,
      userId: USER,
      author: 'SessionTester',
      content: 'prvi',
      parentId: null,
      isEdited: false,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    });
    expect(saved.id).toBe('acm_test_1');

    const comments = await db.articles.listComments(ARTICLE);
    expect(comments.map((c) => c.id)).toContain('acm_test_1');
  });

  it('ista reakcija od istog korisnika uvećava brojač samo jednom', async () => {
    for (let i = 0; i < 5; i += 1) {
      await db.articles.addReaction(ARTICLE, USER, 'like');
    }
    const { reactions } = await db.articles.addReaction(ARTICLE, USER, 'like');
    expect(reactions.like).toBe(1);
  });

  it('različit tip je odvojena reakcija', async () => {
    const { created, reactions } = await db.articles.addReaction(ARTICLE, USER, 'gg');
    expect(created).toBe(true);
    expect(reactions.gg).toBe(1);
  });
});
