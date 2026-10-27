/**
 * N-13 — OG SLIKA 1200×630
 * ------------------------
 * Svaka javna ruta dobija svoju `og:image` jer mreže (Discord, X, Slack) NE
 * izvršavaju JS: ako slika nije stvarni fajl sa `Content-Type: image/png`,
 * preview je prazan. Slika se generiše na serveru (`sharp`) iz SVG šablona —
 * bez browsera, bez fontova sa CDN-a, keširana u memoriji.
 *
 * `src` (cover članka) je eksterni URL: dozvoljen je samo `https:` i samo hostovi
 * iz `OG_IMAGE_HOSTS` (podrazumevano IGDB + Supabase Storage), pa endpoint ne
 * može da posluži kao otvoreni proxy.
 */

import sharp from 'sharp';
import { logger } from './logger.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Da li se slika renderuje u SVG-ju sa pravim naslovom ili je ostala čist šablon. */
export type OgRenderMode = 'text' | 'template';

const TITLE_MAX = 90;
const SUBTITLE_MAX = 70;

const escapeXml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Reč po reč lomljenje — SVG `text` nema `wrap`, pa je broj redova fiksan (3). */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').split(' ').length;
  if (consumed < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).replace(/[\s,.;:]$/, '')}…`;
  }
  return lines;
}

function buildSvg(
  { title, subtitle, badge }: { title: string; subtitle: string; badge: string },
  mode: OgRenderMode = 'text',
): string {
  const titleLines = wrap(title, 24, 3);
  const subtitleLines = wrap(subtitle, 52, 2);
  const titleStart = 250 - (titleLines.length - 1) * 34;
  const subtitleStart = titleStart + titleLines.length * 68 + 46;
  // `template` — naslov služi samo kao ključ; na slici nema teksta (bez fontova).
  const textLayer = mode === 'template';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#08080f"/>
      <stop offset="55%" stop-color="#0d0b1a"/>
      <stop offset="100%" stop-color="#120a24"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.18" r="0.6">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)"/>
  <g opacity="0.16" stroke="#a78bfa" stroke-width="1">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100 - 120}" y2="${OG_HEIGHT}"/>`).join('')}
  </g>
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)"/>
  <text x="80" y="112" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="6" fill="#a78bfa">NEXUS</text>
  <text x="${OG_WIDTH - 80}" y="112" text-anchor="end" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="22" fill="#8b93a7">${escapeXml(badge.toUpperCase())}</text>
  ${textLayer ? '' : titleLines
    .map(
      (line, index) =>
        `<text x="80" y="${titleStart + index * 68}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="56" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  <rect x="80" y="${subtitleStart - 30}" width="92" height="5" rx="2.5" fill="url(#accent)"/>
  ${textLayer ? '' : subtitleLines
    .map(
      (line, index) =>
        `<text x="80" y="${subtitleStart + 34 + index * 42}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="30" fill="#b9c0d4">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  <text x="80" y="${OG_HEIGHT - 56}" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="22" fill="#6b7280">gejming portal · forum · popusti</text>
</svg>`;
}

/* ----------------------------- keš slika ----------------------------- */

const CACHE_LIMIT = 200;
const cache = new Map<string, Buffer>();

function remember(key: string, png: Buffer): Buffer {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, png);
  return png;
}

export interface OgInput {
  title: string;
  subtitle?: string;
  badge?: string;
  /** Eksterni cover (članak). Bez njega se koristi generisani šablon. */
  coverUrl?: string | null;
  /** `template` = slika bez teksta (kada render nije dostupan). */
  mode?: OgRenderMode;
}

/** Hostovi sa kojih sme da se povuče `og:image` (bez proizvoljnih URL-ova). */
function coverHostAllowed(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const configured = (process.env.OG_IMAGE_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const allowed = configured.length
    ? configured
    : ['images.igdb.com', 'image.api.playstation.com'];
  const host = url.hostname.toLowerCase();
  return (
    allowed.includes(host) ||
    host.endsWith('.supabase.co') ||
    allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  );
}

async function fetchCover(coverUrl: string): Promise<Buffer | null> {
  try {
    const url = new URL(coverUrl);
    if (!coverHostAllowed(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\//.test(type)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.byteLength > 8 * 1024 * 1024 ? null : buffer;
  } catch (error) {
    logger.debug({ err: (error as Error).message }, 'og_cover_fetch_failed');
    return null;
  }
}

/**
 * PNG 1200×630 za dati sadržaj. Nikad ne baca: ako `sharp` ne može da učita
 * librsvg (Linux bez fontconfig-a), vraća **čist šablon bez teksta** — dimenzije
 * i dalje odgovaraju OG specifikaciji, pa mreže prikazuju sliku normalno.
 */
export async function renderOgImage(input: OgInput): Promise<Buffer> {
  const title = (input.title || 'NEXUS').slice(0, TITLE_MAX);
  const subtitle = (input.subtitle ?? '').slice(0, SUBTITLE_MAX);
  const badge = input.badge ?? 'NEXUS';
  const mode: OgRenderMode = input.mode ?? 'text';
  const cacheKey = `${mode}|${badge}|${title}|${subtitle}|${input.coverUrl ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const svg = buildSvg({ title, subtitle, badge }, mode);
  let base: Buffer;
  try {
    base = await sharp(Buffer.from(svg)).png().toBuffer();
  } catch (error) {
    if (mode === 'template') throw error;
    logger.warn({ err: (error as Error).message }, 'og_svg_render_failed_using_template');
    return renderOgImage({ ...input, mode: 'template' });
  }

  if (input.coverUrl) {
    const cover = await fetchCover(input.coverUrl);
    if (cover) {
      try {
        const overlay = await sharp(cover)
          .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'attention' })
          .modulate({ brightness: 0.55 })
          .composite([{ input: Buffer.from(svg.replace('<rect width', '<rect fill="none" width')) }])
          .png()
          .toBuffer();
        return remember(cacheKey, overlay);
      } catch (error) {
        logger.debug({ err: (error as Error).message }, 'og_cover_composite_failed');
      }
    }
  }

  return remember(cacheKey, base);
}

const NEXUS_TITLE = 'NEXUS';
const NEXUS_SUBTITLE = 'Gejming portal, forum i popusti';

/**
 * Istu grafiku koristi `scripts/generate-og.mjs` za statičku `public/og/default.png`,
 * pa nema dva SVG šablona koja se vremenom razilaze.
 */
export function ogTemplateSvg(
  { title = NEXUS_TITLE, subtitle = NEXUS_SUBTITLE, badge = 'NEXUS' }: { title?: string; subtitle?: string; badge?: string } = {},
  mode: OgRenderMode = 'text',
): string {
  return buildSvg({ title, subtitle, badge }, mode);
}
