/**
 * N-13 — PRERENDER JAVNIH RUTA
 * ----------------------------
 * SPA build servira isti `dist/index.html` za svaku putanju, pa crawler koji ne
 * izvršava JS vidi prazan `<div id="root">` i globalni `<title>`. Ovaj korak
 * posle `vite build` generiše pravi HTML za:
 *
 *   /                 (naslovna, strana 1 portala)
 *   /article/:slug    (svaki objavljeni članak)
 *   /thread/:id       (svaka aktivna tema)
 *   /games/:slug      (svaka igra iz kataloga)
 *
 * Podaci dolaze sa `GET /api/prerender/meta` (ime, opis, `og:image` 1200×630,
 * JSON-LD). Bez tog endpointa (statika bez API-ja, offline CI) generiše se samo
 * naslovna sa statičkim meta podacima — build nikad ne pada zbog prerendera.
 *
 * Rezultat:
 *   dist/index.html          → naslovna (prerenderovana)
 *   dist/article/<slug>.html → članak  (i `index.html` u istom folderu za statistički hosting)
 *   dist/thread/<id>.html    → tema
 *   dist/games/<slug>.html   → igra
 *   dist/leaderboard.html    → rang-lista (statički skelet, N-07)
 *
 * Hosting mora da posluži odgovarajući fajl pre SPA fallback-a
 * (`/article/x` → `dist/article/x.html`). SPA rute bez prerendera ostaju na
 * `index.html`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as template from './prerender-template.mjs';

const { renderRoute } = template;

const DIST = 'dist';
const API_TIMEOUT_MS = 2500;
const DEFAULT_BASE = (process.env.PRERENDER_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const PUBLIC_BASE = (
  process.env.VITE_PUBLIC_URL ||
  process.env.PUBLIC_APP_URL ||
  process.env.CLIENT_URL ||
  'https://nexus.rs'
)
  .split(',')[0]
  .trim()
  .replace(/\/$/, '');

/** Statički skelet naslovne — isti markup kao `HomeMagazine` pre prvog podatka. */
const HOME_SKELETON =
  '<div class="section"><div class="container"><header class="mb-8 border-b border-white/[0.07] pb-6"><span class="eyebrow mb-3">NEXUS Portal</span><h1 class="page-title">Gejming vesti, recenzije i popusti</h1><p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/50">Najnovije vesti iz sveta gejminga, recenzije, popusti iz svih prodavnica i forum zajednice.</p></header><div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true"></div></div></div>';

const STATIC_ROUTES = [
  {
    path: '/',
    title: 'NEXUS — gejming portal i forum',
    description: 'Gejming vesti, recenzije, popusti i forum sa reputacijom — sve na jednom mestu.',
    skeleton: HOME_SKELETON,
    type: 'website',
    image: `${PUBLIC_BASE}/api/og/site/home?title=NEXUS&subtitle=${encodeURIComponent('Gejming portal i forum')}`,
  },
  {
    path: '/leaderboard',
    title: 'Rang-lista zajednice — NEXUS',
    description:
      'Najaktivniji članovi NEXUS zajednice rangirani po karmi, bedževima i nivou reputacije. Hall of Fame sa top 3 igrača i kompletnom listom.',
    breadcrumb: [
      { name: 'Početna', path: '/' },
      { name: 'Rang-lista', path: '/leaderboard' },
    ],
    image: `${PUBLIC_BASE}/api/og/site/leaderboard?title=${encodeURIComponent('Rang-lista zajednice')}`,
  },
];

async function apiJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  // Node 18+ ima globalni `fetch`; bez njega (stariji runtime) prerender se preskače.
  if (typeof fetch !== 'function') {
    clearTimeout(timer);
    return null;
  }
  try {
    const res = await fetch(`${DEFAULT_BASE}${pathname}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    if (process.env.PRERENDER_DEBUG) console.warn(`[prerender] ${pathname}:`, error?.message ?? error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `dist/<ruta>.html` + `dist/<ruta>/index.html` (istekan fajl za SPA hosting). */
function writeRoute(route) {
  const html = renderRoute(shell, route);
  const relative = route.path.replace(/^\/+/, '');
  // Naslovna (`/`) je već `dist/index.html` — ne pišemo prazno ime fajla.
  const targets = relative
    ? [path.join(DIST, `${relative}.html`), path.join(DIST, relative, 'index.html')]
    : [path.join(DIST, 'index.html')];
  for (const file of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html, 'utf8');
  }
  return route.path;
}

let shell = '';

export async function prerender() {
  const indexFile = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexFile)) {
    console.warn('[prerender] dist/index.html ne postoji — preskačem.');
    return [];
  }
  shell = fs.readFileSync(indexFile, 'utf8');
  const written = [];

  for (const route of STATIC_ROUTES) written.push(writeRoute(route));

  const source = await apiJson('/api/prerender/meta?type=sitemap-source');
  if (!source) {
    console.warn(
      `[prerender] API nedostupan (${DEFAULT_BASE}) — generisana je samo naslovna; ` +
        'pokreni server ili postavi PRERENDER_BASE_URL.',
    );
    return written;
  }

  const jobs = [
    ...(source.articles ?? []).map((slug) => ({ type: 'article', key: slug })),
    ...(source.threads ?? []).map((id) => ({ type: 'thread', key: id })),
    ...(source.games ?? []).map((slug) => ({ type: 'game', key: slug })),
  ];

  // Serijski (4 paralelno) da build ne zatrpa API; svaki meta je jedan lagan upit.
  const concurrency = 4;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const metas = await Promise.all(
      batch.map((job) => apiJson(`/api/prerender/meta?type=${job.type}&key=${encodeURIComponent(job.key)}`)),
    );
    for (const meta of metas) {
      if (!meta?.path) continue;
      written.push(writeRoute({ ...meta, breadcrumb: undefined }));
    }
  }

  console.log(`[prerender] ${written.length} ruta u ${DIST}/ (${PUBLIC_BASE})`);
  return written;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  prerender().catch((error) => {
    console.error('[prerender] greška:', error?.message ?? error);
    process.exitCode = 1;
  });
}
