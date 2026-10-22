import { cn } from './cn';
import { usePresenceStore } from '../../store/presenceStore';
import type { PresenceStatus } from '../../lib/realtime';

/**
 * ONLINE AVATAR — zeleni prsten (2.6.1) / jantarni „away“ prsten (2.6.2)
 * ----------------------------------------------------------------------
 * Isti `<img>` kao i ranije, samo sa `.is-online` / `.is-away` klasom.
 *
 * Pravila:
 *  - Boja NIJE jedini signal: prsten ima `title` i `aria-label` („Online sada“ /
 *    „Prisutan, neaktivan“).
 *  - Prsten se ne crta bez `userId` (legacy odgovori API-ja bez ID-ja autora).
 *  - `isOnline`/`status` prop premošćuje store (kad odgovor servera već nosi status).
 *  - `prefers-reduced-motion` zaustavlja puls (globalno pravilo u `index.css`).
 */
export type OnlineAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<OnlineAvatarSize, string> = {
  xs: 'h-6 w-6',
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

export const ONLINE_LABEL = 'Online sada';
export const AWAY_LABEL = 'Prisutan, neaktivan';
export const OFFLINE_LABEL = 'Nije na mreži';

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: ONLINE_LABEL,
  away: AWAY_LABEL,
  offline: OFFLINE_LABEL,
};

/**
 * Prisustvo korisnika. `fallback` je eksplicitni status iz odgovora servera
 * (npr. sopstveni `isOnline` iz `/auth/me`) i ima prednost nad Realtime-om.
 */
export function useUserOnline(userId?: string | null, fallback?: boolean | null): boolean {
  const live = usePresenceStore((state) => (userId ? Boolean(state.lastSeen[userId]) : false));
  if (fallback === true) return true;
  if (fallback === false) return false;
  return live;
}

/** 2.6.2 — pun status (`online | away | offline`) za prsten i label. */
export function useUserStatus(
  userId?: string | null,
  fallback?: PresenceStatus | null,
  onlineFallback?: boolean | null,
): PresenceStatus {
  const live = usePresenceStore((state) => (userId ? state.status(userId) : 'offline'));
  if (fallback) return fallback;
  if (onlineFallback === true) return 'online';
  if (onlineFallback === false) return 'offline';
  return live;
}

export interface OnlineAvatarProps {
  src?: string | null;
  /** `users.id` — ključ prisustva; bez njega prsten se ne prikazuje. */
  userId?: string | null;
  alt?: string;
  size?: OnlineAvatarSize;
  /** Eksplicitni status iz odgovora servera (npr. `isOnline`). */
  isOnline?: boolean | null;
  /** 2.6.2 — eksplicitan `online | away | offline` (prednost nad `isOnline`). */
  status?: PresenceStatus | null;
  /** `round` za krug; `squircle` za profilni okvir (`rounded-[22px]`). */
  shape?: 'round' | 'squircle';
  /** Tačkica u donjem desnom uglu (kada prsten nije dovoljan signal). */
  showDot?: boolean;
  className?: string;
}

export function OnlineAvatar({
  src,
  userId,
  alt = '',
  size = 'sm',
  isOnline,
  status: statusProp,
  shape = 'round',
  showDot = false,
  className,
}: OnlineAvatarProps) {
  const status = useUserStatus(userId, statusProp, isOnline);
  const label = STATUS_LABEL[status];

  const image = (
    <img
      src={src || undefined}
      alt={alt}
      title={label}
      aria-label={label}
      className={cn(
        'online-avatar bg-surface-0 object-cover',
        SIZE_CLASS[size],
        shape === 'round' ? 'rounded-full' : 'rounded-[18px]',
        status === 'online' && 'is-online',
        status === 'away' && 'is-away',
        className,
      )}
    />
  );

  if (status === 'offline') return image;

  return (
    <span className="online-avatar-frame" title={label}>
      {image}
      {showDot && <span className={cn('online-dot', status === 'away' && 'is-away')} aria-hidden="true" />}
    </span>
  );
}
