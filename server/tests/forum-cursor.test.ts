import { describe, expect, it, beforeAll } from 'vitest';
import { db } from '../lib/store.js';

/**
 * B-10 / B-11 — keyset kursor i batch autori (memorijski adapter).
 *
 * B-10 je bio „semi-paginacija“: ruta je uvek učitala prvih 200 redova i tražila
 * kursor u njima, pa je kursor van prvih 200 vraćao praznu listu. Sada offset
 * računa data layer (`threadCursorOffset`), za ISTI sort koji koristi strana.
 */

const USER = 'usr_cursor_author';
const PREFIX = 'thr_cursor_';
const SUBFORUM = 'cursor-test';

function seed(count: number) {
  for (let index = 0; index < count; index += 1) {
    void db.forum.createThread({
      id: `${PREFIX}${index.toString().padStart(3, '0')}`,
      subforum: SUBFORUM,
      title: `Tema ${index}`,
      content: 'Sadržaj',
      author: 'Autor',
      authorId: USER,
      karma: index,
      views: 0,
      replies: 0,
      isPinned: false,
      isLocked: false,
      isDeleted: false,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      lastActivityAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    } as any);
  }
}

describe.skipIf(db.kind !== 'memory')('B-10 — kursor paginacija', () => {
  beforeAll(async () => {
    seed(240); // više od starog „prvih 200“ prozora
  });

  it('kursor van prvih 200 redova i dalje vraća ispravan offset (top = karma desc)', async () => {
    const filter = { subforum: SUBFORUM, sort: 'top' as const };
    // karma 50 je na poziciji 189 (239 - 50); sledeća tema je karma 49.
    const offset = await db.forum.threadCursorOffset(filter, `${PREFIX}050`);
    expect(offset).toBe(240 - 50);

    const page = await db.forum.listThreads({ ...filter, limit: 5, offset: offset! });
    const ids = page.slice(0, 5).map((thread) => thread.id);
    const all = await db.forum.listThreads(filter);
    const expectedNext = all[offset!]?.id;
    expect(expectedNext).toBe(`${PREFIX}049`);
    expect(ids[0]).toBe(expectedNext);
    expect(ids).not.toContain(`${PREFIX}050`);
  });

  it('`top` sort: offset za kursor = broj tema sa većom karmom + 1', async () => {
    const offset = await db.forum.threadCursorOffset({ subforum: SUBFORUM, sort: 'top' }, `${PREFIX}230`);
    expect(offset).toBe(239 - 230 + 1);
  });

  it('`new` sort koristi created_at (najnovije prvo)', async () => {
    const offset = await db.forum.threadCursorOffset({ subforum: SUBFORUM, sort: 'new' }, `${PREFIX}230`);
    // created_at raste sa indeksom → tema 230 je na poziciji 9, posle nje ide 229
    expect(offset).toBe(10);
    const page = await db.forum.listThreads({ subforum: SUBFORUM, sort: 'new', limit: 1, offset: offset! });
    expect(page.slice(0, 1)[0]?.id).toBe(`${PREFIX}229`);
  });

  it('nepoznat kursor → null (ruta tada vraća praznu listu)', async () => {
    expect(await db.forum.threadCursorOffset({ subforum: SUBFORUM, sort: 'hot' }, 'thr_nema')).toBeNull();
  });

  it('hot sort poštuje pinovane prvo', async () => {
    await db.forum.updateThread(`${PREFIX}000`, { isPinned: true });
    const filter = { subforum: SUBFORUM, sort: 'hot' as const };
    const offset = await db.forum.threadCursorOffset(filter, `${PREFIX}010`);
    // Isti redosled kao strana: [pinovane…] pa ostale po karmi.
    const all = await db.forum.listThreads(filter);
    const expected = all.findIndex((thread) => thread.id === `${PREFIX}010`) + 1;
    expect(all[0]?.id).toBe(`${PREFIX}000`); // pinovana tema je prva
    expect(offset).toBe(expected);
    const nextPage = await db.forum.listThreads({ ...filter, limit: 1, offset: offset! });
    expect(nextPage[0]?.id).toBe(`${PREFIX}009`);
    await db.forum.updateThread(`${PREFIX}000`, { isPinned: false });
  });

  it('soft-deleted kursor se ne broji kao postojeći', async () => {
    await db.forum.updateThread(`${PREFIX}020`, { isDeleted: true });
    expect(await db.forum.threadCursorOffset({ subforum: SUBFORUM, sort: 'top' }, `${PREFIX}020`)).toBeNull();
    await db.forum.updateThread(`${PREFIX}020`, { isDeleted: false });
  });
});

describe.skipIf(db.kind !== 'memory')('B-11 — batch autori', () => {
  it('findByIds vraća više korisnika jednim pozivom i preskače nepostojeće', async () => {
    await db.users.create({
      id: USER,
      username: 'cursor_author',
      email: 'cursor@example.com',
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

    const found = await db.users.findByIds([USER, 'usr_ne_postoji', USER]);
    expect(found.map((user) => user.id)).toEqual([USER]);
    expect(await db.users.findByIds([])).toEqual([]);
  });
});
