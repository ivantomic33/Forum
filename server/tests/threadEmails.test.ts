import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type ThreadRecord } from '../lib/store.js';
import { REPLY_EMAIL_THROTTLE_MS, sendReplyEmails } from '../lib/threadEmails.js';
import { clearSharedValues, getSharedValue } from '../lib/sharedStore.js';

/**
 * F-7.1 #8 — „prati temu“.
 *
 * Mejl o novom odgovoru je UGAŠEN: mejl se šalje samo za verifikaciju adrese i
 * reset lozinke, a notifikacije o odgovorima žive u aplikaciji (`notify`).
 * `sendReplyEmails` ostaje no-op radi kompatibilnosti pozivalaca; testovi
 * proveravaju upravo to — da nijedan mejl ne izlazi, čak i uz provajdera.
 */

process.env.JWT_SECRET ||= 'test-secret-for-thread-email-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const OWNER = 'mail_owner';
const FOLLOWER = 'mail_follower';
const REPLIER = 'mail_replier';
const THREAD = 'thr_mail_test';

async function makeUser(id: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  } as any);
}

async function makeThread(id = THREAD): Promise<ThreadRecord> {
  const thread: ThreadRecord = {
    id,
    subforum: 'PC Gaming',
    title: 'Najbolji RPG 2026 — šta igrate?',
    content: 'Tema za mejl test',
    author: OWNER,
    authorId: OWNER,
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
  const existing = await db.forum.findThread(id);
  return existing ?? db.forum.createThread(thread);
}

describe.skipIf(db.kind !== 'memory')('prati temu — mejl je ugašen', () => {
  const originalKey = process.env.RESEND_API_KEY;
  let sent: Array<{ to: string[]; subject: string }> = [];
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    clearSharedValues();
    sent = [];
    process.env.RESEND_API_KEY = 'test-key';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('api.resend.com')) {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };

    await makeUser(OWNER);
    await makeUser(FOLLOWER);
    await makeUser(REPLIER);
    await makeThread();
    await db.subscriptions.follow(FOLLOWER, THREAD, true);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('ni pratiocima sa uključenim mejlom ne šalje ništa', async () => {
    const result = await sendReplyEmails({
      threadId: THREAD,
      threadTitle: 'Najbolji RPG 2026',
      threadPath: `/thread/${THREAD}#post-1`,
      actorId: REPLIER,
      actorUsername: REPLIER,
      replyContent: '<p>Probajte Baldur\'s Gate 3</p>',
    });

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toHaveLength(0);
    // Throttle marker se više ne piše — nema mejla koji bi se ograničavao.
    expect(await getSharedValue(`reply_email.sent:${FOLLOWER}:${THREAD}`)).toBeNull();
  });

  it('throttle konstanta ostaje radi kompatibilnosti', () => {
    expect(REPLY_EMAIL_THROTTLE_MS).toBe(15 * 60 * 1000);
  });
});
