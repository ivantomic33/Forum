import { useEffect, useState } from 'react';
import { ExternalLink, Radio } from 'lucide-react';

/**
 * F-6 — LIVE STREAM TRAKA
 * ----------------------
 * Ako je Twitch kanal povezan na profil (`connected_accounts.twitch`), profil
 * prikazuje da li je kanal uživo: tačka „UŽIVO“, broj gledalaca i naslov
 * stream-a. Klik vodi na kanal (novi tab).
 *
 * Zašto ne Twitch embed iframe: embed povlači skripte i kolačiće treće strane
 * i traži `frame-src` u CSP-u. Ovde je cilj TRAKA (kao na sportskim portalima),
 * pa se koristi samo javni `streams` endpoint (client_id + secret, PKCE flow iz
 * `server/lib/twitch.ts`) i običan link. Bez ključeva se traka ne prikazuje.
 *
 * Kanali se **verifikuju** server-side: klijent nikada ne dobija `access_token`
 * — samo `live`, `viewers`, `title` i `thumbnail`.
 */

interface LiveStatus {
  live: boolean;
  title?: string;
  viewers?: number;
  gameName?: string;
  startedAt?: string;
  /** Twitch šablon `https://…-{width}x{height}.jpg` (zamenjuje se u `<img>`). */
  thumbnail?: string | null;
  url?: string;
  configured: boolean;
}

export function TwitchLive({ channel }: { channel?: string }) {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const name = channel?.trim();
    if (!name) {
      setStatus(null);
      return;
    }
    const controller = new AbortController();
    setFailed(false);
    // Isti proxy kao `api.ts`; `no-store` jer je stanje „uživo“ kratkog roka.
    fetch(`/api/live/twitch?channel=${encodeURIComponent(name)}`, {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: LiveStatus) => setStatus(data))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [channel]);

  if (!channel || failed || !status?.configured) return null;

  if (!status.live) {
    return (
      <div className="flex items-center gap-2 rounded-lg border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2">
        <Radio size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
        <span className="text-meta">
          <a
            href={`https://www.twitch.tv/${encodeURIComponent(channel)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:underline"
          >
            twitch.tv/{channel}
          </a>{' '}
          — trenutno nije uživo.
        </span>
      </div>
    );
  }

  return (
    <a
      href={status.url ?? `https://www.twitch.tv/${encodeURIComponent(channel)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl border-[var(--color-error)]/40 bg-[var(--color-surface-1)] p-3 transition-colors hover:border-[var(--color-error)]"
    >
      <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-error)] px-2 py-1 text-micro font-bold uppercase tracking-wider text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />
        Uživo
      </span>
      {status.thumbnail && (
        <img
          src={status.thumbnail.replace('{width}', '160').replace('{height}', '90')}
          alt=""
          loading="lazy"
          className="h-12 w-20 shrink-0 rounded object-cover"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-1 text-meta font-medium text-[var(--color-text-primary)] group-hover:underline">
          {status.title ?? `twitch.tv/${channel}`}
        </span>
        <span className="text-micro block">
          {status.gameName ? `${status.gameName} · ` : ''}
          {(status.viewers ?? 0).toLocaleString('sr-Latn-RS')} gledalaca
        </span>
      </span>
      <ExternalLink size={14} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
    </a>
  );
}
