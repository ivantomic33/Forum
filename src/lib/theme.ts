/**
 * U-08 — TEMA (dark / light / system) i `data-theme` na <html>.
 *
 * - Vrednosti: `dark` (default identitet), `light` (dugo čitanje, sunce, laptop),
 *   `system` (prati `prefers-color-scheme`).
 * - CSS: `src/styles/components/theme.css` — `[data-theme='light']` mapira iste
 *   tokene na svetle vrednosti. Print se NE izabira kao tema; print pravila su
 *   uvek aktivna (`@media print`).
 * - Bez treperenja: `index.html` je već postavio `data-theme` iz `localStorage`
 *   pre prvog paint-a (inline skript); ovaj modul čita istu vrednost.
 *
 * Preferencija se čuva u `localStorage['nexus-theme']` i sinhronizuje sa
 * `meta[name=theme-color]` (Android/iOS chrome) i `color-scheme`.
 */

export type ThemePreference = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'nexus-theme';

const THEME_COLOR: Record<'dark' | 'light', string> = {
  dark: '#07080a',
  light: '#f6f7fb',
};

const listeners = new Set<(preference: ThemePreference) => void>();
let mediaQuery: MediaQueryList | null = null;

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** Sistemska tema → `data-theme` (jedina vrednost koju CSS poznaje). */
function resolve(preference: ThemePreference): 'dark' | 'light' {
  if (preference === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return preference;
}

/** Trenutna preferencija; `system` kada ništa nije sačuvano. */
export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  } catch {
    /* privatni režim / blokiran storage — radi kao sistem */
  }
  return 'system';
}

/** „Efektivna“ tema (ono što korisnik vidi) — koristi je ThemeToggle za ikonicu. */
export function getResolvedTheme(): 'dark' | 'light' {
  return resolve(getThemePreference());
}

function apply(preference: ThemePreference) {
  const root = document.documentElement;
  const resolved = resolve(preference);
  root.dataset.theme = resolved;
  // Isti atribut i na <body>: `base.css` stilizuje body, pa tema mora da ga
  // pokrije i selektorima vezanim za body (U-08, svetli kanvas).
  if (document.body) document.body.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
  for (const listener of listeners) listener(preference);
}

/** Postavi temu i zapamti izbor. */
export function setThemePreference(preference: ThemePreference) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ne blokiraj UI ako storage nije dostupan */
  }
  apply(preference);
}

/** Sledeća tema u ciklusu dark → light → system → dark. */
export function nextThemePreference(current = getThemePreference()): ThemePreference {
  if (current === 'dark') return 'light';
  if (current === 'light') return 'system';
  return 'dark';
}

export function subscribeTheme(listener: (preference: ThemePreference) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Primeni sačuvanu temu i prati sistemske promene dok je izabrano `system`.
 * Idempotentno — bezbedno za StrictMode (drugi poziv samo ponovo primeni CSS).
 */
export function initTheme() {
  if (typeof window === 'undefined') return;
  apply(getThemePreference());

  if (!mediaQuery && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mediaQuery.addEventListener('change', () => {
      if (getThemePreference() === 'system') apply('system');
    });
  }
}
