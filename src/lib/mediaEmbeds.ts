/**
 * WHITELIST MEDIA EMBED PARSER
 * ----------------------------
 * Jedina tačka istine za prepoznavanje embed-abilnih URL-ova (F-7).
 *
 * Princip bezbednosti: URL se prvo strogo parsira (`new URL`), pa se testira
 * **ceo hostname** protiv whitelist-e — substring match (npr. "youtube" u
 * `evil-youtube.com`) je nemoguć. ID sadržaja se ekstrahuje regex-om i sklapa
 * u iframe `src` programski iz šablona — sirov korisnički HTML nikad ne stiže
 * do DOM-a.
 */

export type MediaProvider = 'youtube' | 'spotify' | 'twitch';

export interface ParsedMedia {
  provider: MediaProvider;
  /** Tip sadržaja (video/shorts, track/album/playlist/episode, channel/clip). */
  kind: string;
  /** Bezbedno ekstraktovan ID (whitelist regex karakteri). */
  id: string;
  /** Originalni URL (za fallback `<a>` link). */
  url: string;
}

/** Provajderski hostname-i — tačan match, bez wildcarda. */
const HOSTS: Record<MediaProvider, string[]> = {
  youtube: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  spotify: ['open.spotify.com'],
  twitch: ['www.twitch.tv', 'twitch.tv', 'clips.twitch.tv'],
};

/** ID-jevi smeju da budu samo [A-Za-z0-9_-] (Twitch kanali i [a-zA-Z0-9_]) —
 *  sve ostalo odbacujemo pre bilo kakvog korišćenja u URL-u. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_CHANNEL = /^[a-zA-Z0-9_]{2,25}$/;

/**
 * Parsira URL i vraća `{ provider, kind, id }` samo ako je na whitelist-i.
 * `null` za sve ostalo — uključujući lažne domene (`youtube.com.evil.io`,
 * `evil-youtube.com`), nevalidne URL-ove i nesigurne šeme.
 */
export function parseMediaUrl(rawUrl: string): ParsedMedia | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  // Samo https — embed-ovi preko http su i sami rizik (mixed content).
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const provider = (Object.keys(HOSTS) as MediaProvider[]).find((p) => HOSTS[p].includes(host));
  if (!provider) return null;

  const path = url.pathname;

  if (provider === 'youtube') {
    // youtu.be/ID — short form (ID je ceo path segment)
    if (host === 'youtu.be') {
      const id = path.slice(1);
      return SAFE_ID.test(id) ? { provider, kind: 'video', id, url: rawUrl } : null;
    }
    // /shorts/ID
    const shorts = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,20})\/?$/);
    if (shorts) return { provider, kind: 'shorts', id: shorts[1], url: rawUrl };
    // /watch?v=ID — v parametar mora biti čist ID, bez dodatnih znakova
    const v = url.searchParams.get('v') ?? '';
    if (/^\/watch$/.test(path) && /^[A-Za-z0-9_-]{6,20}$/.test(v)) {
      return { provider, kind: 'video', id: v, url: rawUrl };
    }
    return null;
  }

  if (provider === 'spotify') {
    // /track/ID, /album/ID, /playlist/ID, /episode/ID (opciono /intl-xx prefiks)
    const m = path.match(/^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode)\/([A-Za-z0-9]{16,30})\/?$/);
    if (m) return { provider, kind: m[1], id: m[2], url: rawUrl };
    return null;
  }

  // twitch
  if (host === 'clips.twitch.tv') {
    const id = path.slice(1);
    return SAFE_ID.test(id) ? { provider, kind: 'clip', id, url: rawUrl } : null;
  }
  const clip = path.match(/^\/([A-Za-z0-9_]+)\/clip\/([A-Za-z0-9_-]+)\/?$/);
  if (clip && SAFE_CHANNEL.test(clip[1]) && SAFE_ID.test(clip[2])) {
    return { provider, kind: 'clip', id: clip[2], url: rawUrl };
  }
  // /CHANNEL — kanal (stream)
  const channel = path.match(/^\/([a-zA-Z0-9_]{2,25})\/?$/);
  if (channel) return { provider, kind: 'channel', id: channel[1], url: rawUrl };
  return null;
}

/** Da li je standalone URL (ceo red/paragraf) — embed se stavlja samo tada. */
export function isStandaloneUrl(text: string): boolean {
  return /^(https?:\/\/\S+)\.?$/i.test(text.trim());
}

/** Generički autolink: URL unutar teksta -> <a>. Koristi se za ne-embed linkove. */
export function autolinkHtml(escapedText: string): string {
  // Tekst je već HTML-eskejvovan; linkove pravimo samo za http(s) URL-ove.
  return escapedText.replace(
    /\bhttps?:\/\/[^\s<>"']+/g,
    (match) => {
      const trailing = match.endsWith('.') ? '.' : '';
      const href = trailing ? match.slice(0, -1) : match;
      // href mora da bude validan URL — inače ostaje običan tekst.
      try {
        new URL(href);
      } catch {
        return match;
      }
      return `<a href="${href}" rel="noopener noreferrer" target="_blank">${href}</a>${trailing}`;
    },
  );
}
