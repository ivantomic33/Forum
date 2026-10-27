/**
 * PRERENDER RUTA (N-07)
 * ---------------------
 * Generiše `dist/<ruta>.html` za javne, SEO-vredne rute: pravi `<title>`,
 * `description`, `robots`, `canonical`, Open Graph, `<noscript>` sadržaj i
 * breadcrumb JSON-LD, plus skelet stranice u `#root` (React ga zameni pri
 * montiranju — isti markup, pa nema treperenja).
 *
 * Skelet je namerno **statistički HTML**, bez ijednog podatka o korisniku:
 * rang-lista i dalje stiže preko API-ja posle montiranja, a crawler dobija
 * naslov, opis i strukturu (naslov, kolone tabele) umesto praznog `<div>`.
 *
 * Ne dodiruje `index.html` — taj ostaje SPA ljuska za sve ostale rute.
 */

/** Isti razredi kao `src/pages/LeaderboardSkeleton.tsx` — prelaz ne „skače“. */
const LEADERBOARD_SKELETON = `<div class="section"><div class="container max-w-5xl"><header class="mb-10 border-b border-white/[0.07] pb-8 text-center"><span class="eyebrow mb-4 justify-center">NEXUS Hall of Fame</span><h1 class="page-title mx-auto">Rang-lista zajednice</h1><p class="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-white/50">Najaktivniji članovi, veterani i kreatori sadržaja rangirani po zarađenoj karmi, osvojenim bedževima i nivoima reputacije.</p></header><div class="overflow-hidden rounded-lg border border-white/[0.09] bg-surface-1" aria-busy="true"><div class="flex items-center justify-between border-b border-white/[0.07] bg-surface-2/60 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] sm:px-6"><div class="flex items-center gap-5 sm:gap-6"><span class="w-8 text-center">Rang</span><span>Korisnik</span></div><div class="flex items-center gap-6 sm:gap-8"><span class="hidden sm:inline">Nivo</span><span class="w-20 text-right sm:w-24">Karma</span></div></div></div></div></div>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `<meta name="...">` / `<meta property="...">` — sa sadržajem u jednom ili više redova. */
function setMeta(html, attr, key, content) {
  const pattern = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>`, 'g');
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  if (pattern.test(html)) {
    pattern.lastIndex = 0;
    return html.replace(pattern, tag);
  }
  return html.replace('</head>', `  ${tag}\n  </head>`);
}

/**
 * Bazni URL za canonical/OG. `VITE_PUBLIC_URL` → `PUBLIC_APP_URL` → `CLIENT_URL`.
 * Bez njih ostaje `https://nexus.rs` (isto ponašanje kao pre).
 */
function siteBase() {
  const raw =
    process.env.VITE_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'https://nexus.rs';
  return raw.split(',')[0].trim().replace(/\/$/, '') || 'https://nexus.rs';
}

/**
 * @param {string} html      osnovni `index.html` (već sa Vite preload/script tagovima)
 * @param {{
 *   path: string,
 *   title: string,
 *   description: string,
 *   skeleton?: string,
 *   breadcrumb?: Array<{name: string, path: string}>,
 *   type?: 'website' | 'article',
 *   image?: string | null,
 *   publishedTime?: string | null,
 *   modifiedTime?: string | null,
 *   jsonLd?: Record<string, unknown> | null,
 *   noIndex?: boolean,
 *   noscript?: string,
 * }} route  — podaci koje vraća `GET /api/prerender/meta`
 */
export function renderRoute(html, route) {
  const title = escapeHtml(route.title);
  const base = siteBase();
  const canonical = `${base}${route.path}`;
  const breadcrumb = route.breadcrumb ?? [
    { name: 'Početna', path: '/' },
    ...(route.path === '/' ? [] : [{ name: route.title, path: route.path }]),
  ];
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumb.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${base}${item.path}`,
    })),
  };

  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<div id="root">)(<\/div>)/, `$1${route.skeleton ?? LEADERBOARD_SKELETON}$2`);

  out = setMeta(out, 'name', 'description', route.description);
  out = setMeta(out, 'name', 'robots', route.noIndex ? 'noindex, nofollow' : 'index, follow');
  out = setMeta(out, 'property', 'og:title', route.title);
  out = setMeta(out, 'property', 'og:description', route.description);
  out = setMeta(out, 'property', 'og:url', canonical);
  out = setMeta(out, 'property', 'og:type', route.type ?? 'website');
  if (route.image) {
    // N-13 — 1200×630 (og:image:width/height) da mreže ne režu sliku na 1.91:1.
    out = setMeta(out, 'property', 'og:image', route.image);
    out = setMeta(out, 'property', 'og:image:width', '1200');
    out = setMeta(out, 'property', 'og:image:height', '630');
    out = setMeta(out, 'property', 'og:image:alt', route.title);
    out = setMeta(out, 'name', 'twitter:image', route.image);
    out = setMeta(out, 'name', 'twitter:card', 'summary_large_image');
  }
  if (route.type === 'article') {
    if (route.publishedTime) out = setMeta(out, 'property', 'article:published_time', route.publishedTime);
    if (route.modifiedTime) out = setMeta(out, 'property', 'article:modified_time', route.modifiedTime);
  }
  out = setMeta(out, 'name', 'twitter:title', route.title);
  out = setMeta(out, 'name', 'twitter:description', route.description);
  out = out.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${canonical}" />`);

  // Breadcrumb + JSON-LD stranice (NewsArticle / DiscussionForumPosting) + `<noscript>`:
  // crawler koji ne izvršava JS ipak vidi naslov i opis.
  out = out.replace(
    '</body>',
    [
      `  <script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>`,
      route.jsonLd ? `  <script type="application/ld+json">${JSON.stringify(route.jsonLd)}</script>` : '',
      `  <noscript><h1>${title}</h1><p>${escapeHtml(route.description)}</p>${
        route.noscript ? `\n  <p>${escapeHtml(route.noscript)}</p>` : ''
      }</noscript>`,
      '</body>',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return out;
}
