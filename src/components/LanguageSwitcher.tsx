import { Languages } from 'lucide-react';
import { LOCALES, getLocale, setLocale, useT, type Locale } from '../lib/i18n';

/**
 * LANGUAGE SWITCHER — izbor jezika (sr / en)
 * ------------------------------------------
 * Postavlja `nexus.locale` u `localStorage` kroz `setLocale()` (i18n.ts), što
 * trenutno pre-renderuje ceo sajt (`useSyncExternalStore`) i ažurira
 * `<html lang>` (`sr-Latn-RS` / `en`).
 *
 * Kompaktan je (dugme sa ikonom + aktivni jezik) i namenjen navbar-u; u
 * mobilnom meniju se renderuje kao red sa dva tastera.
 */

const LABELS: Record<Locale, string> = { sr: 'SRB', en: 'ENG' };

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const current = getLocale();

  if (compact) {
    return (
      <div className="flex items-center gap-1" role="group" aria-label={t('nav.language')}>
        <Languages size={14} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => setLocale(locale)}
            aria-pressed={current === locale}
            className={`rounded px-2 py-1 font-mono text-[11px] font-semibold transition ${current === locale
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-white/45 hover:text-white/80'
              }`}
          >
            {LABELS[locale]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLocale(current === 'sr' ? 'en' : 'sr')}
      className="ui-icon-btn"
      aria-label={t('nav.language')}
      title={t('nav.language')}
    >
      <Languages size={16} />
      <span className="ml-1 hidden font-mono text-[11px] font-semibold sm:inline">{LABELS[current]}</span>
    </button>
  );
}
