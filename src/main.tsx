import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// F-23 — fontovi se serviraju sa našeg domena (bez Google Fonts requesta trećoj strani).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/inter-tight/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';
// 4.0 "Neon Glass" — vizuelni sloj (dev tokeni, glass, animacije). Posle `index.css`
// da bi nadjačao postojeće stilove: src/styles -> docs/dizajn-4.0/nexus-neon-glass.css.
import '../docs/dizajn-4.0/nexus-neon-glass.css';
// 5.0 "Terminal Mono" skin je privremeno isključen: preko `index.css` je ostavljao
// sadržaj u `<article>` neiscrtanim (tekst postoji u DOM-u, Chromium ga ne
// rasterizuje). Vraća se tek kada se utvrdi uzrok.
// import '../docs/dizajn-5.0/nexus-terminal-mono.css';
import App from './App';
import { AppErrorBoundary, initErrorTracking } from './lib/sentry';
import { initTheme } from './lib/theme';
import { registerServiceWorker } from './lib/push';
import { initLocale } from './lib/i18n';

// U-08 — tema iz `localStorage` (inline skript u index.html je već postavila
// `data-theme` pre paint-a; ovde se samo sinhronizuje sa sistemskim promenama).
initTheme();

// i18n — jezik iz `localStorage`/`navigator.language`; `sr` je default.
initLocale();

// Sentry pre prvog rendera — greške u bootstrap-u takođe stižu na server.
initErrorTracking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);

// F-7 — PWA: service worker (offline skela + push). Registracija ide posle
// prvog rendera da ne odlaže LCP; dev je preskače (vidi `lib/push.ts`).
void registerServiceWorker();
