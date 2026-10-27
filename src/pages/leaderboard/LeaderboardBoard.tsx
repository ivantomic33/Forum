/**
 * RANG-LISTA — PODIJUM I LISTA (N-07)
 * -----------------------------------
 * Teški deo rang-liste: framer-motion (animacija podijuma) i
 * `@tanstack/react-virtual` (lista). Učitava se **posle** skeleta stranice,
 * pa prvo iscrtavanje rang-liste ne čeka na ~115 kB animacijskog runtime-a.
 *
 * `motion` se koristi sa `LazyMotion` + `domAnimation` (bez drag/gest bundle-a)
 * i `strict`, pa slučajan prelazak na `motion.div` odmah puca u razvoju.
 */

import { useRef } from 'react';import { Link } from 'react-router-dom';
import { domAnimation, LazyMotion, m } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Crown, Star, Trophy } from 'lucide-react';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { OnlineAvatar } from '../../components/ui/OnlineAvatar';

export interface LeaderboardUser {
  id: string;
  username: string;
  avatar: string;
  role: string;
  level: number;
  xp: number;
  karma: number;
  badges: string[];
  isVerified?: boolean;
  /** 2.6.1 — prisustvo iz `GET /users/leaderboard/top`. */
  isOnline?: boolean;
  /** 2.6.2 — `online | away | offline` (žuti prsten za away). */
  status?: 'online' | 'away' | 'offline';
}

/**
 * PRESTIGE ZONA (Neon Editorial) — medalje top 3:
 *   #1 zlato (`--color-gold-rank`) + violet sjaj = dvostruki prsten
 *   #2 srebro (`--color-silver-rank`)
 *   #3 bronza (`--color-bronze-rank`)
 * Boje su strogo vezane za rang tokene; nema cyan/indigo "drugog akcenta".
 */
const RANK_STYLES: Record<number, { ring: string; text: string; label: string; badge: string; avatar: string }> = {
  1: {
    ring: 'podium-rank-1',
    text: 'text-[var(--color-gold-rank)]',
    label: 'Šampion',
    badge: 'rank-badge rank-badge-1',
    avatar: 'rank-avatar rank-avatar-1',
  },
  2: {
    ring: 'podium-rank-2',
    text: 'text-[var(--color-silver-rank)]',
    label: 'Vanguard',
    badge: 'rank-badge rank-badge-2',
    avatar: 'rank-avatar rank-avatar-2',
  },
  3: {
    ring: 'podium-rank-3',
    text: 'text-[var(--color-bronze-rank)]',
    label: 'Sentinel',
    badge: 'rank-badge rank-badge-3',
    avatar: 'rank-avatar rank-avatar-3',
  },
};

export type LeaderboardFilter = 'karma' | 'level';

/**
 * Leni deo rang-liste (N-07): podijum top 3, virtuelizovana tabela i
 * „Prikaži još“. Učitava se nakon skeleta stranice — zaglavlje (`<h1>`) i
 * skelet tabele su već na ekranu, pa nema praznog spinnera ni skoka layout-a.
 */
export default function LeaderboardBoard({
  users,
  total,
  filter,
  onLoadMore,
}: {
  users: LeaderboardUser[];
  total: number;
  filter: LeaderboardFilter;
  onLoadMore: () => void;
}) {
  const getRankLabel = (rank: number) => {
    if (rank === 1) return '1. mesto';
    if (rank === 2) return '2. mesto';
    if (rank === 3) return '3. mesto';
    return `#${rank}`;
  };

  return (
    <>
      {users.length >= 3 && <LeaderboardPodium users={users} />}

      <div className="overflow-hidden rounded-lg border border-white/[0.09] bg-surface-1 shadow-[var(--shadow-level-1)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] bg-surface-2/60 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] sm:px-6">
          <div className="flex items-center gap-5 sm:gap-6">
            <span className="w-8 text-center">Rang</span>
            <span>Korisnik</span>
          </div>
          <div className="flex items-center gap-6 sm:gap-8">
            <span className="hidden sm:inline">Nivo</span>
            <span className="w-20 text-right sm:w-24">{filter === 'karma' ? 'Karma' : 'XP'}</span>
          </div>
        </div>

        <VirtualizedUserList users={users} getRankLabel={getRankLabel} filter={filter} />

        {users.length > 0 && users.length < total && (
          <div className="flex flex-col items-center gap-2 border-t border-white/[0.07] px-6 py-4">
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
              Prikazano {users.length} od {total.toLocaleString('sr-Latn-RS')} članova
            </span>
            <button type="button" onClick={onLoadMore} className="ui-btn br-secondary ui-btn-sm">
              Prikaži još
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Podijum sa top 3 — animira se samo jednom, pri montiranju. */
export function LeaderboardPodium({ users }: { users: LeaderboardUser[] }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className="mb-10 grid grid-cols-1 items-end gap-4 md:grid-cols-3"
        aria-label="Top 3 na rang-listi"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        {[users[1], users[0], users[2]].map((user, index) => (
          <m.div
            key={user.id}
            variants={{
              hidden: { opacity: 0, y: -16 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
            }}
            className={`flex flex-col justify-end ${index === 1 ? 'md:order-2' : index === 0 ? 'md:order-1' : 'md:order-3'}`}
          >
            <PodiumCard user={user} rank={index === 1 ? 1 : index === 0 ? 2 : 3} isWinner={index === 1} />
          </m.div>
        ))}
      </m.div>
    </LazyMotion>
  );
}

const ROW_HEIGHT = 73; // px-4 py-4 + 40px avatar = fiksna visina reda

/**
 * Virtuelizovana lista korisnika (@tanstack/react-virtual).
 * Renderuje samo vidljive redove (~10 umesto svih 50+),
 * pa lista ostaje brza i na nekoliko hiljada korisnika.
 */
export function VirtualizedUserList({
  users,
  getRankLabel,
  filter,
}: {
  users: LeaderboardUser[];
  getRankLabel: (rank: number) => string;
  filter: LeaderboardFilter;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[600px] overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const u = users[virtualRow.index];
          const rank = virtualRow.index + 1;
          const rankStyle = RANK_STYLES[rank];
          return (
            <Link
              key={u.id}
              to={`/profile/${u.username}`}
              aria-label={`${getRankLabel(rank)}: ${u.username}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="leader-row group flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3 sm:px-6"
            >
              <div className="flex min-w-0 items-center gap-5 sm:gap-6">
                <span
                  className={`rank-pos flex h-7 w-8 flex-shrink-0 items-center justify-center rounded-[4px] border font-mono text-[11px] font-medium tabular-nums ${
                    rankStyle ? rankStyle.badge : 'border-transparent text-[var(--color-text-muted)]'
                  }`}
                >
                  {String(rank).padStart(2, '0')}
                </span>
                <div className="flex min-w-0 items-center gap-3">
                  {/* 2.6.1 — zeleni prsten za „online sada“ u listi */}
                  <OnlineAvatar
                    src={u.avatar}
                    userId={u.id}
                    isOnline={u.isOnline}
                    status={u.status}
                    size="md"
                    alt=""
                    className={`flex-shrink-0 border transition-colors ${
                      rankStyle ? rankStyle.avatar : 'border-[var(--color-border-default)] group-hover:border-[var(--color-secondary)]'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="leader-name truncate text-[13px] font-medium text-[var(--color-text-primary)] transition-colors">
                        {u.username}
                      </span>
                      <VerifiedBadge isVerified={u.isVerified} size="xs" />
                      {u.role === 'admin' && (
                        <span className="rounded-[3px] border border-[var(--color-primary-glow)] bg-[var(--color-primary-muted)] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--color-primary-fg-light)]">
                          Admin
                        </span>
                      )}
                      {u.role === 'moderator' && (
                        <span className="rounded-[3px] border border-[var(--color-secondary-glow)] bg-[var(--color-secondary-muted)] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--color-info-fg)]">
                          Mod
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">{u.badges?.length || 0} bedževa</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-6 sm:gap-8">
                <span className="hidden min-w-[3.5rem] rounded-[4px] border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-2 py-0.5 text-center font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)] sm:inline-block">
                  LVL {u.level}
                </span>
                <span className={`w-20 text-right font-mono text-sm font-bold tabular-nums sm:w-24 ${filter === 'karma' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)]'}`}>
                  {filter === 'karma' ? `+${u.karma.toLocaleString('sr-Latn-RS')}` : u.xp.toLocaleString('sr-Latn-RS')}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PodiumCard({ user, rank, isWinner = false }: { user: LeaderboardUser; rank: number; isWinner?: boolean }) {
  if (!user) return null;
  const style = RANK_STYLES[rank];

  return (
    <Link
      to={`/profile/${user.username}`}
      aria-label={`${user.username}, ${rank}. mesto`}
      className={`podium-card group relative block rounded-lg p-6 text-center ${style.ring} ${
        isWinner ? 'podium-card--winner md:-translate-y-3' : ''
      }`}
    >
      <div className="mb-5 flex items-center justify-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${style.badge}`}
        >
          {isWinner && <Trophy size={11} aria-hidden="true" />}#{rank} · {style.label}
        </span>
      </div>
      <div className="relative mb-5 inline-block">
        {/* 2.6.1 — zeleni prsten za „online sada“ (ne dira violet rang okvir) */}
        <OnlineAvatar
          src={user.avatar}
          userId={user.id}
          isOnline={user.isOnline}
          status={user.status}
          size="lg"
          alt=""
          className={`mx-auto ${style.avatar} ${isWinner ? '!h-[88px] !w-[88px]' : '!h-[72px] !w-[72px]'}`}
        />
        {isWinner && (
          <Crown size={16} className="absolute -top-3 left-1/2 -translate-x-1/2 text-[var(--color-gold-rank)]" aria-hidden="true" />
        )}
        <span className="absolute -right-3 -top-2 rounded-[4px] border border-[var(--color-border-subtle)] bg-surface-4 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--color-text-secondary)] shadow-[var(--shadow-level-1)]">
          LVL {user.level}
        </span>
      </div>
      <h3 className={`mb-1 flex items-center justify-center gap-1.5 truncate font-display font-semibold tracking-tight text-[var(--color-text-primary)] ${isWinner ? 'text-xl' : 'text-lg'}`}>
        {user.username}
        <VerifiedBadge isVerified={user.isVerified} size="sm" />
      </h3>
      <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
        {user.role.toUpperCase()}
      </div>
      <div className="inline-flex items-center gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        <Star size={13} className={style.text} aria-hidden="true" />
        <span className={`font-mono text-sm font-medium tabular-nums ${style.text}`}>+{user.karma.toLocaleString('sr-Latn-RS')}</span>
        <span className="text-[11px] text-[var(--color-text-muted)]">karme</span>
      </div>
    </Link>
  );
}
