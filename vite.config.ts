import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// F-20 — CSP/HSTS/frame-ancestors i za frontend (Helmet pokriva samo API).
import { securityHeadersPlugin } from './scripts/security-headers.mjs';
// Analiza §7.7 — upload source mapa u Sentry (samo uz SENTRY_AUTH_TOKEN).
import { sentrySourceMaps } from './scripts/sentry-sourcemaps.mjs';
// N-13 — prerender javnih ruta (/ , /article/*, /thread/*, /games/*) + og:image.
import { prerender } from './scripts/prerender.mjs';

/**
 * N-06 — `modulepreload` za vendor chunkove.
 *
 * Vite u `index.html` preload-uje samo chunkove koje entry **statički** uvozi
 * (`react-vendor`). Ostali vendor chunkovi (`query-vendor`, `motion-vendor`,
 * `supabase-vendor`, `icons-vendor`) su statičke zavisnosti prvog lenog
 * chunka, pa se otkrivaju tek kada se on preuzme — dva kruga mreže.
 * `modulepreload` ih pokreće paralelno sa glavnim chunkom; leni chunk ih
 * isporučuje iz module mape umesto da ih ponovo traži.
 */
function modulePreloadVendors(vendors: string[]): Plugin {
  return {
    name: 'nexus-modulepreload-vendors',
    apply: 'build',
    // Vite upisuje `modulepreload` za entry u `generateBundle` (posle
    // heširanja). Registrovan kao Rollup `output` plugin, ovaj hook se
    // izvršava posle njega, pa su imena sa hešom već u HTML-u.
    generateBundle(_options, bundle) {
      const files = new Map<string, string>();
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && vendors.includes(chunk.name)) files.set(chunk.name, fileName);
      }
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue;
        if (asset.fileName.includes('/')) continue; // samo `index.html`
        let html = String(asset.source);
        for (const fileName of files.values()) {
          // Chunk koji je Vite već preload-ovao (ili ga statički uvozio) preskačemo.
          if (html.includes(fileName)) continue;
          // `fileName` u Vite-u 8 već sadrži `assets/` prefiks.
          const url = fileName.startsWith('assets/') ? `/${fileName}` : `/assets/${fileName}`;
          html = html.replace('</head>', `  <link rel="modulepreload" crossorigin href="${url}">\n  </head>`);
        }
        asset.source = html;
      }
    },
  };
}

/**
 * N-13 — prerender ruta posle build-a.
 *
 * Ranije je ovaj plugin bio registrovan DVAPUT (top-level i u
 * `rollupOptions.plugins`), pa je `closeBundle` generisao `dist/leaderboard.html`
 * dva puta. Sada je jedan plugin koji zove `scripts/prerender.mjs`: naslovna,
 * `/article/*`, `/thread/*`, `/games/*` i `/leaderboard` — sa pravim
 * title/description/OG (1200×630) i JSON-LD-om iz `GET /api/prerender/meta`.
 * Ako API nije dostupan, build ipak prolazi (prerendueva se samo naslovna).
 */
function prerenderRoutes(): Plugin {
  return {
    name: 'nexus-prerender-routes',
    apply: 'build',
    // `closeBundle` — Vite je već upisao `dist/index.html` (sa preload tagovima).
    async closeBundle() {
      await prerender();
    },
  };
}

export default defineConfig({
  // N-07 — prerender je dodatak samo za produkcijski build; `vite` (dev)
  // ostaje čist SPA i `index.html` ostaje netaknut.
  plugins: [
    react(),
    securityHeadersPlugin(),
    sentrySourceMaps(),
    prerenderRoutes(),
  ],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        // N-05 — E2E runner podiže API na drugom portu (`VITE_DEV_PROXY_TARGET`).
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Cilj N-06: glavni chunk ≤ 400 kB / 130 kB gzip — chunkovi namerno ostaju
    // ispod 500 kB, pa je sumarno upozorenje Rollup-a šum.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      plugins: [
        modulePreloadVendors(['icons-vendor', 'query-vendor', 'supabase-vendor', 'motion-vendor']),
      ],
      output: {
        /**
         * N-06 — vendor chunkovi se keširaju dugo i dele između ruta:
         *  - `react-vendor` / `query-vendor` / `icons-vendor` u svakoj ruti,
         *  - `motion-vendor` (framer-motion) — samo LeaderboardPage i `components/motion`,
         *  - `supabase-vendor` — samo Realtime (`lib/realtime.ts`),
         *  - `rich-text-vendor` — samo Tiptap, koji je leni i u forumu i u adminu.
         *
         * `react-vendor` mora prvi: `@tiptap/react`, `framer-motion` i Sonner
         * takođe uvoze `react`, a Rollup upozorava kada modul završi u chunku
         * koji ga uvozi.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Windows: `vendor-entry` (virtualni modul) nosi ime paketa u putanji
          // i ne sme da završi u vendor chunku.
          if (id.startsWith('\u0000')) return;
          const path = id.replace(/\\/g, '/');
          // `react-dom` klijent upućuje na `scheduler` (u Node-u internim
          // `require('scheduler')`), a Rollup onda upozorava da je modul iz
          // `react-vendor` uvučen u drugi chunk. `scheduler` zato ide sa React-om.
          if (path.includes('/scheduler/')) return 'react-vendor';
          // Vite rešava `react-dom` u dev ili prod fajl zavisno od `NODE_ENV`;
          // oba moraju u `react-vendor`, inače glavni chunk nosi ceo runtime.
          if (path.includes('/react-dom/')) return undefined;
          const inPkg = (pkg: string) => path.includes(`/node_modules/${pkg}/`);

          if (inPkg('react') || inPkg('react-dom')) return 'react-vendor';
          if (inPkg('@tanstack')) return 'query-vendor';
          // `@tiptap/react` uvozi React Query; odvojen `rich-text-vendor` je
          // pravio ciklus sa `query-vendor`-om, pa Tiptap ostaje uz svoje
          // pozivaoce (leni `RichTextEditor`, uvek iza `import()`).
          if (inPkg('prosemirror')) return 'rich-text-vendor';
          if (inPkg('framer-motion') || inPkg('motion-dom') || inPkg('motion-utils')) return 'motion-vendor';
          if (inPkg('@supabase') || inPkg('@realtime-js') || inPkg('postgrest') || inPkg('gotrue')) {
            return 'supabase-vendor';
          }
          if (inPkg('@sentry')) return undefined;
          // Sonner ostaje uz React: `Toaster` je leni, ali nema svoj chunk —
          // odvojen `toaster-chunk` je pravio ciklus sa `query-vendor`-om.
          if (inPkg('lucide')) return 'icons-vendor';
          // Ostatak `node_modules` (`sonner`, `zustand`, `dompurify`, `react-countup`,
          // `@fontsource`…) ostaje uz pozivaoce — u praksi u glavnom chunku, pa
          // ovde nema praznog `vendor-chunk`-a.
        },
      },
    },
  },
});
