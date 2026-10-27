import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_SETTINGS,
  SITE_SETTINGS_KEY,
  getPublicSiteSettings,
  loadSiteSettings,
  normalizeSiteSettings,
  resetSiteSettingsCache,
  updateSiteSettings,
} from '../lib/siteSettings.js';
import { clearSharedValues, getSharedValue } from '../lib/sharedStore.js';

/**
 * Podešavanja sajta (`site_meta`) — ranije `let currentSettings` u modulu
 * `routes/admin.ts`, pa je restart vraćao podrazumevana podešavanja i druga
 * instance nije videla promenu.
 */

process.env.JWT_SECRET ||= 'test-secret-for-site-settings-tests';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

beforeEach(() => {
  clearSharedValues();
  resetSiteSettingsCache();
});

describe('siteSettings — normalizacija', () => {
  it('nepoznat ulaz vraća podrazumevana, bezbedna podešavanja', () => {
    expect(normalizeSiteSettings(undefined)).toEqual(DEFAULT_SITE_SETTINGS);
    expect(normalizeSiteSettings(null)).toEqual(DEFAULT_SITE_SETTINGS);
    expect(normalizeSiteSettings('nonsense')).toEqual(DEFAULT_SITE_SETTINGS);
  });

  it('seče predugačak tekst i odbacuje nepoznat ton', () => {
    const settings = normalizeSiteSettings({
      announcement: { active: true, message: 'x'.repeat(500), tone: 'hacked', link: 'y'.repeat(500) },
    });
    expect(settings.announcement.message).toHaveLength(300);
    expect(settings.announcement.link).toHaveLength(200);
    expect(settings.announcement.tone).toBe('info');
    expect(settings.announcement.active).toBe(true);
  });

  it('registrationOpen je otvoren samo ako nije eksplicitno false', () => {
    expect(normalizeSiteSettings({}).registrationOpen).toBe(true);
    expect(normalizeSiteSettings({ registrationOpen: false }).registrationOpen).toBe(false);
  });
});

describe.skipIf(process.env.SUPABASE_URL !== 'memory')('siteSettings — perzistencija', () => {
  it('updateSiteSettings upisuje u site_meta i u keš', async () => {
    const updated = await updateSiteSettings({
      announcement: { active: true, message: 'Planirano održavanje', tone: 'warning' },
      registrationOpen: false,
    });

    expect(updated.announcement.active).toBe(true);
    expect(updated.registrationOpen).toBe(false);
    expect(getPublicSiteSettings()).toEqual(updated);

    const stored = await getSharedValue(SITE_SETTINGS_KEY);
    expect(stored).toMatchObject({ registrationOpen: false });
  });

  it('parcijalna izmena čuva ostala polja', async () => {
    await updateSiteSettings({ registrationOpen: false, maintenanceMode: true });
    const updated = await updateSiteSettings({ announcement: { active: true, message: 'Hi' } });

    expect(updated.registrationOpen).toBe(false);
    expect(updated.maintenanceMode).toBe(true);
    expect(updated.announcement.message).toBe('Hi');
  });

  it('posle „restarta“ (prazan keš) loadSiteSettings vraća upisane vrednosti', async () => {
    await updateSiteSettings({ maintenanceMode: true, registrationOpen: false });

    resetSiteSettingsCache();
    expect(getPublicSiteSettings().maintenanceMode).toBe(false);

    const loaded = await loadSiteSettings();
    expect(loaded.maintenanceMode).toBe(true);
    expect(loaded.registrationOpen).toBe(false);
  });

  it('loadSiteSettings bez zapisa ne kvari keš', async () => {
    const loaded = await loadSiteSettings();
    expect(loaded).toEqual(DEFAULT_SITE_SETTINGS);
  });
});
