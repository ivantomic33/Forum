import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, getLocale, messages, setLocale, t, translate } from '../../src/lib/i18n';

/**
 * i18n — `sr` je izvor istine, `en` mora imati SVE ključeve.
 *
 * Ovaj test je jedina garancija da prevod ne „propadne“ tiho: novi ključ u `sr`
 * bez `en` prevoda obara test, umesto da engleski korisnik vidi srpski tekst.
 */
describe('i18n — prevodi', () => {
  const srKeys = Object.keys(messages.sr).sort();
  const enKeys = Object.keys(messages.en).sort();

  it('en ima isti skup ključeva kao sr (bez viška i bez manjka)', () => {
    expect(enKeys).toEqual(srKeys);
  });

  it('nijedan prevod nije prazan i ključevi su u `oblast.kljuc` formatu', () => {
    for (const locale of LOCALES) {
      const dict = messages[locale] as Record<string, string>;
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        expect(key).toMatch(/^[a-z][a-zA-Z]*\.[a-zA-Z]+$/);
      }
    }
  });

  it('parametri `{ime}` postoje u oba jezika (prevod ne izgubi placeholder)', () => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of srKeys as Array<keyof typeof messages.sr>) {
      const sr = messages.sr[key] as string;
      const en = messages.en[key as keyof typeof messages.en] as string;
      expect(placeholders(en), key).toEqual(placeholders(sr));
    }
  });

  it('sr i en se stvarno razlikuju (nije kopiran srpski u en)', () => {
    const identical = srKeys.filter(
      (key) =>
        (messages.sr as Record<string, string>)[key] === (messages.en as Record<string, string>)[key],
    );
    // Dozvoljeni su identični termini (npr. „Email“), ali ne većina rečenica.
    expect(identical.length).toBeLessThan(Math.ceil(srKeys.length / 2));
  });

  it('translate: interpolacija, fallback na sr i nepoznat ključ', () => {
    expect(translate('en', 'security.trustedDevicesCount', { count: 3 })).toBe('Remembered devices (3)');
    expect(translate('sr', 'security.trustedDevicesCount', { count: 3 })).toBe('Zapamćeni uređaji (3)');
    // Nepoznat ključ se vraća kao ključ — nikad `undefined`.
    expect(translate('en', 'nema.ovaj' as any)).toBe('nema.ovaj');
    // Placeholder bez vrednosti ostaje vidljiv (lakše se primeti od praznog mesta).
    expect(translate('en', 'crop.hint')).toContain('{max}');
  });

  it('setLocale menja aktivni jezik za `t` (u Node-u nema `document`/`localStorage`)', () => {
    expect(DEFAULT_LOCALE).toBe('sr');
    const before = getLocale();
    try {
      setLocale('en');
      expect(getLocale()).toBe('en');
      expect(t('common.cancel')).toBe('Cancel');
      setLocale('sr');
      expect(t('common.cancel')).toBe('Otkaži');
    } finally {
      setLocale(before);
    }
  });
});
