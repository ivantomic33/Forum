import { beforeEach, describe, expect, it } from 'vitest';
import {
  getNotificationPreferences,
  isWithinQuietHours,
  normalizeQuietHours,
  PUSH_MUTABLE_TYPES,
  setNotificationPreferences,
  shouldPush,
} from '../lib/notificationPreferences.js';
import { clearSharedValues } from '../lib/sharedStore.js';

/**
 * 6.x — TIŠI SATI (quiet hours).
 *
 * Ugovor: u tihim satima push se NE šalje, ali podešavanje nikad ne gasi
 * inbox/zvonce (to je `notify()`-ova stvar). Takođe: neispravan opseg (npr.
 * `25:00` ili `from === to`) ne pravi beskonačan „tihi režim“ — vraća `null`.
 */

const USER = 'quiet_user';
/** UTC vreme za lokalni sat `hour` pri datom offsetu. */
const atLocal = (hour: number, minute = 0, offsetMinutes = 120) =>
  new Date(Date.UTC(2026, 9, 27, hour, minute) - offsetMinutes * 60_000);

beforeEach(() => clearSharedValues());

describe('isWithinQuietHours', () => {
  const quiet = normalizeQuietHours({ from: '22:00', to: '07:00', tzOffsetMinutes: 120 })!;

  it('opseg preko ponoći pokriva oba kraja', () => {
    expect(isWithinQuietHours(quiet, atLocal(23, 30))).toBe(true);
    expect(isWithinQuietHours(quiet, atLocal(2, 0))).toBe(true);
    expect(isWithinQuietHours(quiet, atLocal(6, 59))).toBe(true);
    expect(isWithinQuietHours(quiet, atLocal(7, 0))).toBe(false);
    expect(isWithinQuietHours(quiet, atLocal(15, 0))).toBe(false);
  });

  it('opseg unutar istog dana (13:00–15:00)', () => {
    const midday = normalizeQuietHours({ from: '13:00', to: '15:00', tzOffsetMinutes: 120 })!;
    expect(isWithinQuietHours(midday, atLocal(14, 0))).toBe(true);
    expect(isWithinQuietHours(midday, atLocal(12, 59))).toBe(false);
    expect(isWithinQuietHours(midday, atLocal(15, 0))).toBe(false);
  });

  it('koristi offset korisnika, ne UTC (offset -300 = UTC-5)', () => {
    const quietNewYork = normalizeQuietHours({ from: '22:00', to: '07:00', tzOffsetMinutes: -300 })!;
    // 03:00 UTC = 22:00 u New Yorku → tiho.
    expect(isWithinQuietHours(quietNewYork, new Date(Date.UTC(2026, 9, 28, 3, 0)))).toBe(true);
    // 15:00 UTC = 10:00 u New Yorku → nije tiho.
    expect(isWithinQuietHours(quietNewYork, new Date(Date.UTC(2026, 9, 28, 15, 0)))).toBe(false);
  });

  it('isključen opseg ne blokira ništa', () => {
    expect(isWithinQuietHours(null, atLocal(3))).toBe(false);
  });
});

describe('normalizeQuietHours', () => {
  it('odbija neispravne vrednosti (ne pravi večiti tihi režim)', () => {
    expect(normalizeQuietHours({ from: '25:00', to: '07:00' })).toBeNull();
    expect(normalizeQuietHours({ from: '22:00', to: '22:00' })).toBeNull();
    expect(normalizeQuietHours({ from: 'abc', to: '07:00' })).toBeNull();
    expect(normalizeQuietHours(null)).toBeNull();
  });

  it('prihvata kratak zapis sata i normalizuje ga', () => {
    expect(normalizeQuietHours({ from: '8:5', to: '9:00', tzOffsetMinutes: 0 })).toBeNull();
    expect(normalizeQuietHours({ from: '8:05', to: '9:00', tzOffsetMinutes: 0 })).toMatchObject({
      from: '08:05',
      to: '09:00',
    });
  });
});

describe('shouldPush', () => {
  it('mutiran tip ne zvoni, ostali zvone', () => {
    const prefs = { quietHours: null, pushMuted: ['reply'] as any };
    expect(shouldPush(prefs, 'reply')).toEqual({ push: false, reason: 'muted_type' });
    expect(shouldPush(prefs, 'mention').push).toBe(true);
  });

  it('u tihim satima se push preskače sa razlogom `quiet_hours`', () => {
    const quietHours = normalizeQuietHours({ from: '22:00', to: '07:00', tzOffsetMinutes: 120 });
    expect(shouldPush({ quietHours, pushMuted: [] }, 'dm', atLocal(23))).toEqual({
      push: false,
      reason: 'quiet_hours',
    });
  });
});

describe('preferencije (perzistencija)', () => {
  it('podrazumevano: tiši sati isključeni, ništa mutirano', async () => {
    expect(await getNotificationPreferences(USER)).toEqual({ quietHours: null, pushMuted: [] });
  });

  it('čuva opseg i mutirane tipove; nepoznati tipovi se odbijaju', async () => {
    const saved = await setNotificationPreferences(USER, {
      quietHours: { from: '23:00', to: '07:30', tzOffsetMinutes: 120 },
      pushMuted: ['reply', 'nepostojeci'] as any,
    });
    expect(saved.quietHours).toMatchObject({ from: '23:00', to: '07:30' });
    expect(saved.pushMuted).toEqual(['reply']);
    // Preživi „restart“ — čita se iz istog ključa u `site_meta`.
    expect(await getNotificationPreferences(USER)).toEqual(saved);
  });

  it('isključivanje tihih sati briše opseg', async () => {
    await setNotificationPreferences(USER, { quietHours: { from: '22:00', to: '07:00' } });
    const cleared = await setNotificationPreferences(USER, { quietHours: null });
    expect(cleared.quietHours).toBeNull();
  });

  it('lista tipova koje korisnik može da utiša je poznata', () => {
    expect(PUSH_MUTABLE_TYPES).toContain('reply');
    expect(PUSH_MUTABLE_TYPES).toContain('dm');
  });
});
