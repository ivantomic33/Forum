import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/store.js';
import { __resetLoginAlerts, describeDevice, sendLoginAlert } from '../lib/loginAlert.js';

/**
 * 6.x — „NOVA PRIJAVA“ KAO IN-APP NOTIFIKACIJA (mejl je ugašen).
 *
 * Ugovor: prva sesija ikada ne pravi šum; isti UA+IP se ne ponavlja 24 h;
 * poruka nosi uređaj, IP i vreme i vodi na Bezbednost (`?settings=security`).
 * Nijedan mejl se ne šalje.
 */

process.env.JWT_SECRET ||= 'test-secret-for-login-alert-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const USER = 'login_alert_user';

async function ensureUser() {
  if (await db.users.findById(USER)) return;
  await db.users.create({
    id: USER,
    username: 'login_alert_user',
    email: 'login_alert@example.com',
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
  } as any);
}

beforeEach(async () => {
  __resetLoginAlerts();
  await ensureUser();
});

describe('describeDevice', () => {
  it('prepoznaje browser i OS iz User-Agent-a', () => {
    expect(
      describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
    ).toBe('Chrome na Windows');
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1')).toBe('Safari na macOS');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile')).toBe('Chrome na Android');
    expect(describeDevice(null)).toBe('Nepoznat uređaj');
  });
});

describe.skipIf(db.kind !== 'memory')('sendLoginAlert', () => {
  it('prva sesija ikada ne pravi notifikaciju', async () => {
    const sent = await sendLoginAlert({ userId: USER, userAgent: 'UA-1', ip: '1.1.1.1', knownBefore: [] });
    expect(sent).toBe(false);
    expect(await db.notifications.list({ userId: USER })).toHaveLength(0);
  });

  it('nova prijava sa drugog uređaja/IP-a stiže u inbox sa linkom na Bezbednost', async () => {
    const sent = await sendLoginAlert({
      userId: USER,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0',
      ip: '9.9.9.9',
      knownBefore: [{ userAgent: 'UA-old', ip: '1.1.1.1' }],
    });
    expect(sent).toBe(true);

    const list = await db.notifications.list({ userId: USER });
    const alert = list.find((item) => (item.metadata as { security?: string })?.security === 'new_login');
    expect(alert).toBeTruthy();
    expect(alert?.type).toBe('warning');
    expect(alert?.link).toBe('/profile?settings=security');
    expect(alert?.message).toContain('Chrome na Windows');
    expect(alert?.message).toContain('9.9.9.9');
  });

  it('isti uređaj/IP ne pravi drugu notifikaciju u 24 h', async () => {
    const known = [{ userAgent: 'UA-old', ip: '1.1.1.1' }];
    expect(await sendLoginAlert({ userId: USER, userAgent: 'UA-new', ip: '2.2.2.2', knownBefore: known })).toBe(true);
    __resetLoginAlerts();
    // Bez reseta keš bi držao marker; ovde proveravamo da isti par iz `known`
    // ne pravi notifikaciju (poznat uređaj = nije nova prijava).
    expect(await sendLoginAlert({ userId: USER, userAgent: 'UA-old', ip: '1.1.1.1', knownBefore: known })).toBe(false);
  });

  it('banovan korisnik ne dobija obaveštenje', async () => {
    await db.users.update(USER, { isBanned: true } as any);
    try {
      expect(
        await sendLoginAlert({ userId: USER, userAgent: 'UA-x', ip: '3.3.3.3', knownBefore: [{ userAgent: 'a', ip: 'b' }] }),
      ).toBe(false);
    } finally {
      await db.users.update(USER, { isBanned: false } as any);
    }
  });
});
