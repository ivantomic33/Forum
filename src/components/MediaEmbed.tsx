import { memo, useState } from 'react';
import { Play } from 'lucide-react';
import type { ParsedMedia } from '../lib/mediaEmbeds';

/**
 * MEDIA EMBED — bezbedan, responsive iframe kontejner (F-7)
 * ---------------------------------------------------------
 * Sve `src` vrednosti se sklapaju PROGRAMSKI iz proverenog ID-ja
 * (`parseMediaUrl` whitelist) — sirov korisnički HTML/URL nikad ne stiže u iframe.
 *
 * Sigurnosni atributi na SVAKOM iframe-u:
 *  - `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"`
 *    (nema allow-forms ni allow-top-navigation — provajder ne može da navigira
 *    našu stranicu ni da šalje forme u našem imenu)
 *  - `referrerpolicy="strict-origin-when-cross-origin"`
 *  - `loading="lazy"` — iframe se ne učitava dok ne dođe u viewport
 *
 * Twitch zahteva `parent=<hostname>` — иначе embed odbija da radi.
 */

const TWITCH_PARENT = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

function embedSrc(media: ParsedMedia): string {
  if (media.provider === 'youtube') {
    return `https://www.youtube.com/embed/${media.id}?autoplay=1&rel=0`;
  }
  if (media.provider === 'spotify') {
    // Spotify embed: track/episode 152px, playlist/album 352px visine
    return `https://open.spotify.com/embed/${media.kind}/${media.id}?utm_source=generator&theme=0`;
  }
  if (media.kind === 'clip') {
    return `https://clips.twitch.tv/embed?clip=${media.id}&parent=${TWITCH_PARENT}&autoplay=false`;
  }
  return `https://player.twitch.tv/?channel=${media.id}&parent=${TWITCH_PARENT}&autoplay=false`;
}

/** Responsive kontejner — 16:9 za video (CLS-safe). */
function containerClass(): string {
  return 'aspect-video w-full';
}

/** YouTube facade: thumbnail umesto iframe-a do prvog klika (drastično brže
 *  učitavanje tema sa više videa — bez iframe-a i JS-a dok korisnik ne klikne). */
function YouTubeFacade({ id, title }: { id: string; title: string }) {
  const [active, setActive] = useState(false);
  if (active) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`}
        title={title}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setActive(true)}
      className="group absolute inset-0 h-full w-full cursor-pointer bg-black"
      aria-label={`Pusti video: ${title}`}
    >
      <img
        src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
        alt={title}
        loading="lazy"
        className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/90 shadow-lg transition group-hover:scale-110 group-hover:bg-red-600">
          <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
        </span>
      </span>
    </button>
  );
}

export const MediaEmbed = memo(function MediaEmbed({ media }: { media: ParsedMedia }) {
  const src = embedSrc(media);
  const title =
    media.provider === 'youtube' ? 'YouTube video' :
      media.provider === 'spotify' ? 'Spotify plejer' :
        media.kind === 'clip' ? 'Twitch klip' : 'Twitch plejer';

  const container = containerClass();

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black/40">
      {media.provider === 'youtube' ? (
        <div className={`relative ${container}`}>
          <YouTubeFacade id={media.id} title={title} />
        </div>
      ) : media.provider === 'spotify' ? (
        <iframe
          src={src}
          title={title}
          className={`w-full ${media.kind === 'playlist' || media.kind === 'album' ? 'h-[352px]' : 'h-[152px]'}`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className={`relative ${container}`}>
          <iframe
            src={src}
            title={title}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; fullscreen"
            allowFullScreen
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
    </div>
  );
});
