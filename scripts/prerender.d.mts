/**
 * N-13 — TIPOVI za `scripts/prerender.mjs` (koga uvozi `vite.config.ts`).
 *
 * Skripta namerno ostaje `.mjs` (pokreće se i samostalno posle build-a), pa se
 * tipovi deklarišu ovde umesto da `vite.config.ts` dobije implicitni `any`.
 */

export interface PrerenderRouteMeta {
  /** Ruta bez domena (`/article/slug`). */
  path: string;
  title: string;
  description: string;
  type?: 'website' | 'article';
  /** 1200×630 PNG (`/api/og/…`). */
  image?: string | null;
  publishedTime?: string | null;
  modifiedTime?: string | null;
  jsonLd?: Record<string, unknown> | null;
  noIndex?: boolean;
  skeleton?: string;
  breadcrumb?: Array<{ name: string; path: string }>;
  noscript?: string;
}

/** Generiše `dist/<ruta>.html` za javne rute; vraća spisak napisanih putanja. */
export function prerender(): Promise<string[]>;
