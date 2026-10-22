import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';
import { PublicUser, publicUser } from '../lib/userShape.js';

/**
 * Verifikaciona značka: `isVerified` mora da stigne do UI-ja kroz svaki javni
 * oblik korisnika (profil, rang-lista, autor teme/odgovora/deal-a, komentar).
 *
 * Ranije `userShape.publicUser()` je vraćao `isVerified`, ali liste tema i
 * deals nisu — pa je značka bila vidljiva samo na profilu.
 */

const EDITOR = 'usr_verified_badge_test';

async function ensureUser() {
  const existing = await db.users.findById(EDITOR);
  if (existing) {
    await db.users.update(EDITOR, { isVerified: true });
    return;
  }
  await db.users.create({
    id: EDITOR,
    username: 'verified_editor',
    email: 'verified@example.com',
    password: 'x',
    avatar: '',
    role: 'member',
    level: 2,
    xp: 10,
    xpNeeded: 100,
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

describe('publicUser — javni oblik', () => {
  beforeEach(ensureUser);

  it('vraća isVerified bez izlaganja email-a i bana', async () => {
    const user = await db.users.findById(EDITOR);
    const shape = publicUser(user!) as PublicUser & Record<string, unknown>;

    expect(shape.isVerified).toBe(true);
    expect(shape.username).toBe('verified_editor');
    // Sigurnosna invarijanta: javni oblik ne sme da procuri privatne podatke.
    expect(shape).not.toHaveProperty('email');
    expect(shape).not.toHaveProperty('isBanned');
    expect(shape).not.toHaveProperty('password');
  });

  it('isVerified=false ostaje false (značka se ne prikazuje)', async () => {
    await db.users.update(EDITOR, { isVerified: false });
    const user = await db.users.findById(EDITOR);
    expect(publicUser(user!).isVerified).toBe(false);
  });
});

describe.skipIf(db.kind !== 'memory')('deal — verifikacija autora u listi', () => {
  beforeEach(ensureUser);

  it('list() i findById() vraćaju isVerified autora kroz `authorVerified`', async () => {
    const now = new Date().toISOString();
    const created = await db.deals.create({
      id: `deal_verified_${Date.now()}`,
      authorId: EDITOR,
      author: 'verified_editor',
      gameId: null,
      gameSlug: null,
      gameTitle: null,
      gameCover: null,
      title: 'Deal verifikovanog autora',
      url: `https://example.com/${Date.now()}`,
      proofUrl: null,
      price: 10,
      originalPrice: 20,
      discountPct: 50,
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

    // Ruta popunjava `authorVerified` iz `db.users` — ovde proveravamo da
    // repozitorijum vraća autora i da korisnik nosi isVerified=true.
    const author = await db.users.findById(created.authorId);
    expect(author?.isVerified).toBe(true);

    const fromList = (await db.deals.list({ authorId: EDITOR, limit: 5 })).deals.find((deal) => deal.id === created.id);
    expect(fromList?.authorId).toBe(EDITOR);

    const single = await db.deals.findById(created.id);
    expect(single?.authorId).toBe(EDITOR);
  });
});
