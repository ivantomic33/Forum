/**
 * N-07 — tipovi za prerender šablona (`.mjs` je van `tsc`-ovog `allowJs`-a,
 * a `vite.config.ts` ga uvozi pod `strict`).
 */
export function renderRoute(
  html: string,
  route: {
    path: string;
    title: string;
    description: string;
    skeleton?: string;
    breadcrumb: Array<{ name: string; path: string }>;
  },
): string;
