import { describe, expect, it } from 'vitest';
import { db } from '../lib/store.js';

/**
 * Regresije 2.5.5 (F-27, F-31):
 * - enumeracija emaila je dokumentovana odluka (check-email ne otkriva ništa osim postojanja);
 * - aktivnost profila ne izmišlja datume (bez `'2026-01-01'`).
 */

describe.skipIf(db.kind !== 'memory')('F-31 — datumi u aktivnosti', () => {
  const USER = 'usr_255_activity';

  it('memory store vraća praznu listu datuma bedževa umesto lažnog datuma', async () => {
    if (!(await db.users.findById(USER))) {
      await db.users.create({
        id: USER,
        username: 'ActivityTester',
        email: 'activity@example.com',
        password: 'hash',
        avatar: '',
        role: 'member',
        level: 2,
        xp: 20,
        xpNeeded: 100,
        karma: 1,
        badges: ['first_post'],
        connectedAccounts: { steam: 'ActivityTester' },
        isVerified: true,
        isBanned: false,
        status: 'offline',
        tokenVersion: 0,
        createdAt: '2025-06-01T10:00:00.000Z',
        lastSeenAt: '2025-06-01T10:00:00.000Z',
      });
    }

    const badges = await db.users.listBadgeAwards(USER);
    expect(badges).toEqual([]);
    expect(badges.some((entry) => entry.awardedAt === '2026-01-01')).toBe(false);

    const accounts = await db.users.listConnectedAccountDates(USER);
    expect(accounts).toEqual([{ platform: 'steam', connectedAt: null }]);
  });
});

describe('F-27 — politika enumeracije', () => {
  it('poruka ne otkriva ništa osim postojanja adrese', async () => {
    const { emailAvailabilityMessage } = await import('../../src/lib/emailPolicy');
    expect(emailAvailabilityMessage('taken')).toBe('Email adresa je već registrovana.');
    expect(emailAvailabilityMessage('disposable')).toBe('Privremene (temp) email adrese nisu dozvoljene.');
    expect(emailAvailabilityMessage(null)).toBeNull();
  });
});
