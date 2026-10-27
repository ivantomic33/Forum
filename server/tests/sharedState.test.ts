import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_XP_CAP, awardXp, resetDailyXpBudget } from '../lib/gamification.js';
import { clearEnrollment, consumeEnrollment, pendingSecret, startEnrollment } from '../lib/totp.js';
import { sharedClient, withLock, utcDay } from '../lib/sharedStore.js';
import { isUserOnline, presenceMap, setPresence, userStatus, presenceMode } from '../lib/presence.js';
import { db } from '../lib/store.js';

/**
 * N-09 / B-15 — deljeno stanje mora da bude u bazi, ne u memoriji procesa.
 *
 * Testovi rade u `memory` režimu (CI i lokalno): proveravaju ugovor koji kod
 * koristi kada baze NEMA (fallback) i atomičnost fallback putanje pod
 * paralelnim zahtevima. SQL putanja (`spend_daily_xp`, `consume_totp_enrollment`,
 * `presence_for_users`) je delimično pokrivena `schema-2.6.4-sharing.sql` i proverom da kod
 * šalje iste parametre — bez baze je ne možemo izvršiti.
 */
describe('N-09 — deljeno stanje', () => {
  beforeEach(() => {
    resetDailyXpBudget();
  });

  afterEach(async () => {
    resetDailyXpBudget();
    await clearEnrollment('usr_n09');
  });

  it('bez baze koristi memoriju (NODE_ENV=test nikad ne piše u pravi Supabase)', () => {
    expect(sharedClient()).toBeNull();
    expect(utcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('dnevni budžet: mutex serijalizuje kritičnu sekciju po korisniku', async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((id) =>
        withLock('usr_n09_lock', async () => {
          order.push(id);
          // Namerno `await` unutar sekcije — bez mutex-a bi se ovde preklopili.
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push(-id);
        }),
      ),
    );

    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it('dnevni budžet: paralelni `awardXp` za istog korisnika ne prelazi DAILY_XP_CAP', async () => {
    const created = await db.users.create({
      id: 'usr_n09_cap_created',
      username: 'n09_cap_user',
      email: 'n09-cap@example.com',
      password: 'x',
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
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    resetDailyXpBudget(created.id);

    // 8 paralelnih dodela po 100 XP = 800; limit je 300, pa tačno 300 sme da prođe.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => awardXp(created.id, 100, { reason: 'reply' })),
    );

    const total = results.reduce((sum, result) => sum + (result?.xpAwarded ?? 0), 0);
    expect(total).toBe(DAILY_XP_CAP);
    expect(results.filter((result) => result?.capped)).not.toHaveLength(0);
  });

  it('dnevni budžet: reset vraća limit za tekući dan', async () => {
    const created = await db.users.findById('usr_n09_cap_created');
    expect(created).not.toBeNull();

    const before = await awardXp(created!.id, 10, { reason: 'reply' });
    expect(before?.xpAwarded).toBe(10);

    await resetDailyXpBudget(created!.id);
    const after = await awardXp(created!.id, DAILY_XP_CAP, { reason: 'reply' });
    expect(after?.xpAwarded).toBe(DAILY_XP_CAP);
    expect(after?.capped).toBe(false);
  });

  it('pending 2FA setup: tajna se troši tačno jednom', async () => {
    await clearEnrollment('usr_n09');
    const secret = await startEnrollment('usr_n09');
    expect(await pendingSecret('usr_n09')).toBe(secret);

    expect(await consumeEnrollment('usr_n09', secret)).toBe(true);
    expect(await consumeEnrollment('usr_n09', secret)).toBe(false);
    expect(await pendingSecret('usr_n09')).toBeNull();
  });

  it('pending 2FA setup: nova tajna zamenjuje staru (setup ponovo pokrenut)', async () => {
    await clearEnrollment('usr_n09');
    const first = await startEnrollment('usr_n09');
    const second = await startEnrollment('usr_n09');

    expect(second).not.toBe(first);
    expect(await pendingSecret('usr_n09')).toBe(second);
    // Stara tajna više ne prolazi — inače bi dva taba mogla da aktiviraju različite tajne.
    expect(await consumeEnrollment('usr_n09', first)).toBe(false);
    expect(await pendingSecret('usr_n09')).toBeNull();
  });
});

describe('B-15 — prisustvo bez memorijskog keša', () => {
  it('prisustvo čita `user_presence`, ne `users.status` iz seed-a', async () => {
    // Seed: admin ima `status: 'online'`, ali nema red u `user_presence`.
    expect(await userStatus('user_admin')).toBe('offline');
    expect(await isUserOnline('user_admin')).toBe(false);

    // Otkucaj upiše red — tek tada je „online“.
    await setPresence('user_admin', true, { broadcast: false });
    expect(await userStatus('user_admin')).toBe('online');
    expect(await isUserOnline('user_admin')).toBe(true);

    // Odjava briše red: odmah „offline“ na svakoj instanci koja čita istu tabelu.
    await setPresence('user_admin', false, { broadcast: false });
    expect(await userStatus('user_admin')).toBe('offline');
  });

  it('`presenceMap` vraća „offline“ i za korisnike bez reda (nema „nema podatka“)', async () => {
    const map = await presenceMap(['user_admin', 'user_neuro']);
    expect(map.get('user_admin')).toBe('offline');
    expect(map.get('user_neuro')).toBe('offline');
  });
});

/**
 * F-11 (lista 7.1) — `/api/health` izveštava stvarni sloj, ne željeni.
 * Bez baze u testu oba režima su `memory`, pa `db` mora da se poklapa sa
 * `db.kind` — inače health prikazuje „supabase“ dok sve ide u memoriju.
 */
describe('F-11 — health režimi', () => {
  it('presence režim prati `db.kind` u testu', () => {
    expect(presenceMode.storage()).toBe('memory');
    // Bez `SUPABASE_*` env-a nema Realtime broadcast-a — health ne sme da tvrdi suprotno.
    expect(presenceMode.broadcast()).toBe('memory');
  });

  it('`db.kind` je jedan od dva poznata režima', () => {
    expect(['supabase', 'memory']).toContain(db.kind);
  });
});
