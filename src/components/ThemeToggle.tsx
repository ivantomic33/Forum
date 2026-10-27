import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from './ui';
import {
  getResolvedTheme,
  getThemePreference,
  nextThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '../lib/theme';

/**
 * U-08 — prekidač tema: dark → light → system.
 *
 * Jedno dugme u navbaru (i mobilnom meniju): ikonica pokazuje TRENUTNU temu,
 * a `aria-label` sledeću akciju — tastaturni i screen-reader korisnici ne
 * moraju da pogađaju.
 */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(() => getThemePreference());
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => getResolvedTheme());

  useEffect(() => {
    const sync = () => {
      setPreference(getThemePreference());
      setResolved(getResolvedTheme());
    };
    // Sinhronizacija između tabova (storage event) i sa sistemskom promenom.
    const unsubscribe = subscribeTheme(sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'nexus-theme') sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const Icon = resolved === 'light' ? Sun : preference === 'system' ? Monitor : Moon;
  const next = nextThemePreference(preference);
  const nextLabel = next === 'light' ? 'svetlu temu' : next === 'dark' ? 'tamnu temu' : 'sistemsku temu';
  const currentLabel = preference === 'system' ? 'sistemska tema' : resolved === 'light' ? 'svetla tema' : 'tamna tema';

  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
        setPreference(next);
        setResolved(getResolvedTheme());
      }}
      className={cn('ui-icon-btn', className)}
      aria-label={`Trenutno: ${currentLabel}. Prebaci na ${nextLabel}.`}
      title={`Prebaci na ${nextLabel}`}
    >
      <Icon size={16} aria-hidden="true" />
      {!compact && <span className="sr-only">Tema</span>}
    </button>
  );
}
