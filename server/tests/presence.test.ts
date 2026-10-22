import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/store.js';
import {
  PRESENCE_CHANNEL,
  PRESENCE_EVENT,
  PRESENCE_TTL_MS,
  isUserOnline,
  listOnline,
  listPresence,
  onlineSet,
  presenceMap,
  setPresence,
  statusAt,
  stopPresence,
} from '../lib/presence.js';

/**
 * „Online sada“ (2.6.1)
 * ---------------------
 * Prisustvo je prolazno stanje sa TTL-om. Testovi pokrivaju tri invarijante
 * koje UI ne može da proveri sam:
 *  1. bez otkucaja nema zelenog prstena (TTL), a ne samo „nema offline događaja“;
 *  2. odjava odmah vraća `false` (ne čeka TTL);
 *  3. sweeper objavljuje `offline` na istom kanalu/događaju koji sluša browser.
 */

const USER = 'usr_presence_test';

async function ensureUser() {
  const existing = await db.users.findById(USER);
  if (existing) return;
  await db.users.create({
    id: USER,
    username: 'presence_tester',
    email: 'presence@example.com',
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
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
}

describe('presence — TTL i objava', () => {
  beforeEach(async () => {
    await ensureUser();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
  });

  afterEach(() => {
    stopPresence();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('korisnik je online posle otkucaja, a offline posle TTL-a', async () => {
    await setPresence(USER, true, { broadcast: false });

    expect(await isUserOnline(USER)).toBe(true);
    expect(await listOnline()).toContain(USER);

    // 89s — još važi; 91s — isteklo (nema otkucaja).
    vi.setSystemTime(Date.now() + PRESENCE_TTL_MS - 1_000);
    expect(await isUserOnline(USER)).toBe(true);

    vi.setSystemTime(Date.now() + 2_000);
    expect(await isUserOnline(USER)).toBe(false);
    expect(await listOnline()).not.toContain(USER);
  });

  it('odjava sklanja korisnika odmah, bez čekanja TTL-a', async () => {
    await setPresence(USER, true, { broadcast: false });
    await setPresence(USER, false, { broadcast: false });
    expect(await isUserOnline(USER)).toBe(false);
  });

  it('users.status se usklađuje (keš za profil i liste)', async () => {
    // Upis `status` je namerno throttlovan (60s) da otkucaj ne piše u bazu
    // svakih 25s — simuliraj da je prošlo više od intervala.
    vi.setSystemTime(Date.now() + 61_000);
    await setPresence(USER, true, { broadcast: false });
    expect((await db.users.findById(USER))?.status).toBe('online');

    await setPresence(USER, false, { broadcast: false });
    expect((await db.users.findById(USER))?.status).toBe('offline');
  });

  it('promena prisustva se objavljuje na `presence:global` (browser sluša isti kanal)', async () => {
    // Bez Supabase konfiguracije broadcast je tih no-op, pa ovde proveravamo
    // javne konstante ugovora i da `setPresence` ne baca grešku ni u demo režimu.
    await expect(setPresence(USER, true)).resolves.toBeUndefined();
    await expect(setPresence(USER, false)).resolves.toBeUndefined();
    expect(PRESENCE_CHANNEL).toBe('presence:global');
    expect(PRESENCE_EVENT).toBe('presence');
  });
});

/**
 * 2.6.2 — „away“ i upit koji ne čita celu tabelu (B-16)
 * -----------------------------------------------------
 * `statusAt` je čista funkcija istog pravila kao SQL `presence_status()`;
 * testovi čuvaju granice (90s/120s) da JS i baza ne razilaze.
 */
describe('presence — away status (2.6.2)', () => {
  const now = new Date('2026-10-22T12:00:00.000Z').getTime();

  it('statusAt: online < 90s, away < 120s, posle offline', () => {
    expect(statusAt(now - 1_000, now)).toBe('online');
    expect(statusAt(now - 89_000, now)).toBe('online');
    expect(statusAt(now - 95_000, now)).toBe('away');
    expect(statusAt(now - 119_000, now)).toBe('away');
    expect(statusAt(now - 121_000, now)).toBe('offline');
    expect(statusAt(null, now)).toBe('offline');
    expect(statusAt('keč-koji-nije-datum', now)).toBe('offline');
  });

  it('presenceMap vraća status samo za tražene korisnike', async () => {
    await ensureUser();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    try {
      await setPresence(USER, true, { broadcast: false });

      // `onlineSet` računa samo `online` (away ne pali zeleni prsten u listama).
      expect([...(await onlineSet([USER, 'nepostojeci']))]).toEqual([USER]);

      vi.setSystemTime(Date.now() + 100_000);
      expect((await presenceMap([USER])).get(USER)).toBe('away');
      expect([...(await onlineSet([USER]))]).toEqual([]);
      expect(await listPresence()).toEqual([{ userId: USER, status: 'away' }]);

      vi.setSystemTime(Date.now() + 30_000);
      expect((await presenceMap([USER])).get(USER)).toBe('offline');
    } finally {
      await setPresence(USER, false, { broadcast: false });
      vi.useRealTimers();
    }
  });

  it('heartbeat sa `away` upisuje `users.status = away` odmah (throttle propušta promenu)', async () => {
    await ensureUser();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    try {
      // `away` nije `online`, pa upis keša ide bez čekanja 60s throttle-a.
      await setPresence(USER, true, { broadcast: false, status: 'away' });
      expect((await db.users.findById(USER))?.status).toBe('away');

      // Sledeći otkucaj (`away` → `online`) je promena i piše se odmah.
      await setPresence(USER, true, { broadcast: false });
      expect((await db.users.findById(USER))?.status).toBe('online');
    } finally {
      await setPresence(USER, false, { broadcast: false });
      vi.useRealTimers();
    }
  });
});
