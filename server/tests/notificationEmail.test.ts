import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_NOTIFICATION_TYPES,
  NOTIFICATION_EMAIL_THROTTLE_MS,
  getNotificationEmailPrefs,
  notificationEmailPrefsKey,
  notificationEmailThrottleKey,
  notify,
  sendNotificationEmailFor,
  setNotificationEmailPrefs,
  sendsNotificationEmail,
} from '../lib/notifications.js';
import { clearSharedValues, getSharedValue } from '../lib/sharedStore.js';
import { db, type NotificationRecord } from '../lib/store.js';

/**
 * 2.11.0 — MEJL KANAL ZA POJEDINAČNE NOTIFIKACIJE.
 *
 * Testovi ne zovu provajdera: bez `RESEND_API_KEY`/`BREVO_API_KEY`
 * (`sendNotificationEmailFor` proverava `emailConfigured()`) funkcija vraća
 * `false` i NE piše throttle marker — proverava se upravo taj ugovor, jer se
 * na njemu zasniva „kada podesiš provajder, mejl proradi bez čekanja“.
 */

process.env.JWT_SECRET ||= 'test-secret-for-notification-email-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const USER = 'notif_email_user';

const record = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: 'ntf_email_test',
  userId: USER,
  type: 'reply',
  title: 'Novi odgovor',
  message: 'Neko je odgovorio u temi.',
  link: '/forum/thread/abc',
  isRead: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(async () => {
  clearSharedValues();
  delete process.env.RESEND_API_KEY;
  delete process.env.BREVO_API_KEY;

  if (!(await db.users.findById(USER))) {
    await db.users.create({
      id: USER,
      username: 'notif_email_user',
      email: 'notif@example.com',
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
});

describe('Mejl kanal — preferencije', () => {
  it('podrazumevano su uključene, bez mutiranih tipova', async () => {
    const prefs = await getNotificationEmailPrefs(USER);
    expect(prefs).toEqual({ enabled: true, muted: [] });
  });

  it('korisnik može da isključi mejl u potpunosti', async () => {
    const prefs = await setNotificationEmailPrefs(USER, { enabled: false });
    expect(prefs.enabled).toBe(false);
    expect((await getNotificationEmailPrefs(USER)).enabled).toBe(false);
  });

  it('mutiranje tipa ne briše enabled niti ostale tipove', async () => {
    await setNotificationEmailPrefs(USER, { muted: ['reply'] });
    const prefs = await setNotificationEmailPrefs(USER, { muted: ['reply', 'mention'] });

    expect(prefs.muted).toEqual(['reply', 'mention']);
    expect(prefs.enabled).toBe(true);
  });

  it('preferencije prežive „restart“ (čuvaju se u site_meta)', async () => {
    await setNotificationEmailPrefs(USER, { enabled: false, muted: ['dm'] });
    // Isti ključ koji bi pročitala nova instanca.
    expect(await getNotificationEmailPrefs(USER)).toEqual({ enabled: false, muted: ['dm'] });
  });
});

describe('Mejl kanal — slanje', () => {
  it('bez provajdera ne šalje i ne piše throttle marker', async () => {
    const sent = await sendNotificationEmailFor(USER, record());
    expect(sent).toBe(false);

    const marker = await getSharedValue(notificationEmailThrottleKey(USER));
    expect(marker).toBeNull();
  });

  it('nijedna notifikacija ne ide mejlom — mejl samo za verifikaciju i reset', async () => {
    // Mejl kanal notifikacija je ugašen: set je prazan i ni jedan tip se ne šalje.
    expect([...EMAIL_NOTIFICATION_TYPES]).toEqual([]);

    for (const type of ['reply', 'mention', 'dm', 'upvote', 'warning', 'price_alert', 'guestbook', 'verification', 'streak', 'level_up', 'quest_completed', 'badge_earned', 'staff'] as const) {
      expect(sendsNotificationEmail(record({ type }))).toBe(false);
      expect(await sendNotificationEmailFor(USER, record({ type }))).toBe(false);
    }
  });

  it('`notify({ notifyByEmail: true })` i dalje ne šalje mejl', async () => {
    await notify({ userId: USER, type: 'staff', title: 'Promena uloge', message: 'Test', notifyByEmail: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await getSharedValue(notificationEmailThrottleKey(USER))).toBeNull();
  });

  it('`notify()` ne pokreće mejl za obične događaje', async () => {
    // Presreta `sendNotificationEmailFor` se ne može lako postaviti preko ESM-a —
    // umesto toga proveravamo throttle marker, koji se piše SAMO na uspešno slanje.
    await notify({ userId: USER, type: 'reply', title: 'Novi odgovor', message: 'Test' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await getSharedValue(notificationEmailThrottleKey(USER))).toBeNull();
  });

  it('isključene preferencije sprečavaju slanje', async () => {
    await setNotificationEmailPrefs(USER, { enabled: false });
    expect(await sendNotificationEmailFor(USER, record())).toBe(false);
  });

  it('ni dodela bedža ni uloge ne šalju mejl, čak i bez mutiranja', async () => {
    await setNotificationEmailPrefs(USER, { muted: [] });
    expect(await sendNotificationEmailFor(USER, record({ type: 'badge_earned' }))).toBe(false);
    expect(await sendNotificationEmailFor(USER, record({ type: 'staff' }))).toBe(false);
  });

  it('korisnik bez email adrese se preskače', async () => {
    await db.users.update(USER, { email: '' } as any);
    try {
      expect(await sendNotificationEmailFor(USER, record())).toBe(false);
    } finally {
      await db.users.update(USER, { email: 'notif@example.com' } as any);
    }
  });

  it('definicija throttle-a je 5 minuta i ključ je po korisniku', () => {
    expect(NOTIFICATION_EMAIL_THROTTLE_MS).toBe(5 * 60 * 1000);
    expect(notificationEmailThrottleKey('a')).toBe('notify_email.sent:a');
    expect(notificationEmailPrefsKey('a')).toBe('notify_email.prefs:a');
  });
});
