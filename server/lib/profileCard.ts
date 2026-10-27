/**
 * F-12 — „GAMING KARTICA“ PROFILA (1200×630)
 * ----------------------------------------
 * Deljiva slika sa nivoom, bedževima i top igrama. Namerno nije OG slika
 * članka: ovde je sadržaj korisnikov identitet (avatar, nivo, XP traka, rang,
 * bedževi, omiljene igre), pa je kartica ono što se lepi na Discord/Twitter.
 *
 * Render ide kroz `sharp` (SVG → PNG), isti alat kao `ogImage.ts`, pa nema nove
 * zavisnosti. Ako `sharp` nema librsvg (Linux bez fontconfig-a), vraća se čist
 * šablon iste veličine — `og:image` mora uvek biti validan PNG.
 */

import sharp from 'sharp';
import { OG_HEIGHT, OG_WIDTH } from './ogImage.js';
import { levelProgress } from './store.js';

export interface ProfileCardInput {
  username: string;
  level: number;
  xp: number;
  /** Apsolutni prag sledećeg nivoa (informativno; traka koristi `levelProgress`). */
  xpNeeded: number;
  karma: number;
  posts: number;
  badges: string[];
  topGames: string[];
  title?: string;
}

const escapeXml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Inicijali za krug koji zamenjuje avatar (bez spoljnih slika u renderu). */
const initials = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'N';

function ellipse(text: string, max: number): string {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/[\s,.;:]$/, '')}…` : clean;
}

export function buildProfileCardSvg(input: ProfileCardInput): string {
  const name = escapeXml(ellipse(input.username, 24));
  const title = escapeXml(ellipse(input.title ?? 'Vanguard član zajednice', 46));
  // Nivo i XP traka se izvode iz XP-a (isto kao profil i gamifikacija).
  const stats = levelProgress(input.xp);
  const level = stats.level || Math.max(1, Math.round(input.level || 1));
  const xp = Math.max(0, Math.round(input.xp || 0));
  const xpNeeded = stats.needed;
  // Minimum 4% čisto vizuelno — da traka bude vidljiva i na nuli.
  const progress = Math.max(0.04, Math.min(1, stats.ratio));
  const badges = input.badges.slice(0, 5).map((badge) => ellipse(badge, 18));
  const games = input.topGames.slice(0, 4).map((game) => ellipse(game, 26));

  const progressWidth = 520;
  const statStart = 640;

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
    <radialGradient id="glow" cx="0.15" cy="0.1" r="0.7">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="url(#accent)"/>

  <text x="80" y="104" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="6" fill="#a78bfa">NEXUS</text>
  <text x="${OG_WIDTH - 80}" y="104" text-anchor="end" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="20" fill="#8b93a7">GAMING KARTICA</text>

  <!-- Avatar + nivo -->
  <circle cx="164" cy="266" r="84" fill="#151327" stroke="url(#accent)" stroke-width="4"/>
  <text x="164" y="266" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="58" font-weight="800" fill="#e8ebf2">${escapeXml(initials(input.username))}</text>
  <rect x="104" y="346" width="120" height="34" rx="17" fill="#1c1633" stroke="#8b5cf6"/>
  <text x="164" y="369" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#c4b5fd">NIVO ${level}</text>

  <!-- Ime, titula, XP traka -->
  <text x="300" y="214" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${name}</text>
  <text x="300" y="258" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" fill="#9aa3b8">${title}</text>
  <rect x="300" y="292" width="${progressWidth}" height="14" rx="7" fill="#1b1f2e"/>
  <rect x="300" y="292" width="${Math.round(progressWidth * progress)}" height="14" rx="7" fill="url(#accent)"/>
  <text x="300" y="334" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" fill="#8b93a7">${escapeXml(`${stats.into.toLocaleString('sr-Latn-RS')} / ${xpNeeded.toLocaleString('sr-Latn-RS')} XP · još ${stats.remaining.toLocaleString('sr-Latn-RS')} do nivoa ${level + 1}`)}</text>

  <!-- Metrike -->
  <g font-family="Segoe UI, Inter, Arial, sans-serif">
    <text x="${statStart}" y="380" font-size="40" font-weight="800" fill="#ffffff">${input.posts.toLocaleString('sr-Latn-RS')}</text>
    <text x="${statStart}" y="410" font-size="18" fill="#8b93a7">objava</text>
    <text x="${statStart + 170}" y="380" font-size="40" font-weight="800" fill="#ffffff">${input.karma.toLocaleString('sr-Latn-RS')}</text>
    <text x="${statStart + 170}" y="410" font-size="18" fill="#8b93a7">karme</text>
  </g>

  <!-- Bedževi -->
  <text x="80" y="452" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" letter-spacing="3" fill="#8b93a7">BEDŽEVI</text>
  ${badges.length
      ? badges
        .map((badge, index) => {
          const x = 80 + index * 172;
          return `<g><rect x="${x}" y="472" width="158" height="38" rx="19" fill="#171326" stroke="#2c2447"/>
        <text x="${x + 79}" y="497" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="17" fill="#c9c4e8">${escapeXml(badge)}</text></g>`;
        })
        .join('\n  ')
      : `<text x="80" y="497" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" fill="#5f6779">Još bez bedževa — prvi stiže sa prvim postom.</text>`}

  <!-- Top igre -->
  <text x="80" y="562" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" letter-spacing="3" fill="#8b93a7">TOP IGRE</text>
  <text x="80" y="602" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="24" fill="#e8ebf2">${escapeXml(games.length ? games.join('  ·  ') : 'Bez omiljenih igara')}</text>
  <text x="${OG_WIDTH - 80}" y="602" text-anchor="end" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="18" fill="#6b7280">nexusgaming.com</text>
</svg>`;
}

const cache = new Map<string, Buffer>();
const CACHE_LIMIT = 100;

/** PNG 1200×630. Deli keš sa OG slikama po principu „isti ulaz = ista slika“. */
export async function renderProfileCard(input: ProfileCardInput): Promise<Buffer> {
  const key = JSON.stringify(input);
  const cached = cache.get(key);
  if (cached) return cached;

  const svg = buildProfileCardSvg(input);
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(svg)).png().toBuffer();
  } catch {
    // Bez librsvg-a: šablon sa gradijentom (bez teksta) — dimenzije su iste.
    const fallback = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#08080f"/><stop offset="100%" stop-color="#120a24"/>
      </linearGradient></defs>
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#g)"/></svg>`;
    png = await sharp(Buffer.from(fallback)).png().toBuffer();
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, png);
  return png;
}
