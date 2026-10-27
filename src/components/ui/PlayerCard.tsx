import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * PlayerCard — zaglavlje „gaming kartice“ za profil i rang-listu.
 *
 * Avatar 96 px sa nivo-prstenom, ime + `@handle`, četiri `StatTile` (Nivo, XP,
 * Karma, Postovi) i ispod progress traka „Još N XP do nivoa M“. Kartica koristi
 * isti jezik kao ostale: 1px ivica + `--shadow-sm`, bez glow-a.
 */
export interface PlayerCardProps {
  avatar: ReactNode;
  name: ReactNode;
  /** `@korisnicko_ime` ispod imena. */
  handle?: string;
  /** Značke / role pored imena (Badge, VerifiedBadge, emblem). */
  meta?: ReactNode;
  /** Red medalja (badževa) sa tooltipom — `MedalRow`. */
  medals?: ReactNode;
  stats: ReactNode;
  /** 0–100; `null` sakriva traku. */
  progress?: { percent: number; label: string } | null;
  actions?: ReactNode;
  className?: string;
}

export function PlayerCard({
  avatar,
  name,
  handle,
  meta,
  medals,
  stats,
  progress,
  actions,
  className,
}: PlayerCardProps) {
  return (
    <section className={cn('player-card', className)}>
      <div className="player-card-top">
        <div className="player-card-avatar">{avatar}</div>
        <div className="player-card-identity">
          <div className="player-card-name-row">
            {name}
            {meta}
          </div>
          {handle && <span className="player-card-handle">@{handle}</span>}
          {medals}
        </div>
        {actions && <div className="player-card-actions">{actions}</div>}
      </div>

      <div className="player-stat-grid">{stats}</div>

      {progress && (
        <div className="player-level">
          <div
            className="player-level-track"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={progress.label}
          >
            <span className="player-level-fill" style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
          </div>
          <span className="player-level-label">{progress.label}</span>
        </div>
      )}
    </section>
  );
}
