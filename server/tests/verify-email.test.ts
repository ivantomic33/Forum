import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../lib/store.js';

/**
 * Regresija: `SupabaseUserRepo.update()` nije mapirao `isVerified` u kolonu
 * `is_verified`, pa je email verifikacija trošila token a ostavljala nalog
 * neverifikovan. In-memory adapter je radio ispravno, zbog čega testovi to
 * nisu hvatali — ovaj test pokriva ugovor repozitorijuma za oba adaptera.
 */

const USER_ID = 'usr_verify_test';

async function ensureUser() {
  const existing = await db.users.findById(USER_ID);
  if (existing) {
    await db.users.update(USER_ID, { isVerified: false });
    return;
  }
  await db.users.create({
    id: USER_ID,
    username: 'verify_user',
    email: 'verify@example.com',
    password: 'x',
    avatar: '',
    role: 'member',
    level: 1,
    xp: 0,
    xpNeeded: 0,
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: false,
    isBanned: false,
    status: 'offline',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
}

describe('users.update — email verifikacija', () => {
  beforeEach(ensureUser);

  it('isVerified=true se stvarno upisuje', async () => {
    const updated = await db.users.update(USER_ID, { isVerified: true });
    expect(updated?.isVerified).toBe(true);

    // Provera kroz novi čit — ne kroz objekat koji je update vratio.
    const reread = await db.users.findById(USER_ID);
    expect(reread?.isVerified).toBe(true);
  });

  it('isVerified=false se stvarno upisuje', async () => {
    await db.users.update(USER_ID, { isVerified: true });
    await db.users.update(USER_ID, { isVerified: false });
    expect((await db.users.findById(USER_ID))?.isVerified).toBe(false);
  });

  it('isVerified se ne menja ako polje nije poslato', async () => {
    await db.users.update(USER_ID, { isVerified: true });
    await db.users.update(USER_ID, { bio: 'opis' });
    expect((await db.users.findById(USER_ID))?.isVerified).toBe(true);
  });
});
