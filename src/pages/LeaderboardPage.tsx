import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, Star, Flame, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { MedalRow, OnlineAvatar, PlayerCard, StatTile } from '../components/ui';

interface LeaderboardUser {
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
 * Boje rangova — "Obsidian Cyber-Pulse" paleta.
 * #1 Šampion = violet/prestige, #2 Vanguard = srebrno-cijan, #3 Sentinel = bronzano-indigo.
 */
const RANK_STYLES: Record<number, { ring: string; text: string; label: string; badge: string; avatar: string }> = {
  1: {
    ring: 'border-primary/40 bg-primary/[0.06]',
    text: 'text-primary-fg',
    label: 'Šampion',
    badge: 'border-primary/50 bg-primary/15 text-primary-fg',
    avatar: 'border-primary-fg/70 ring-primary/40',
  },
  2: {
    ring: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]',
    text: 'text-[var(--color-text-primary)]',
    label: 'Vanguard',
    badge: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)]',
    avatar: 'border-[var(--color-border-strong)] ring-[var(--color-surface-3)]',
  },
  3: {
    ring: 'border-[var(--color-border-default)] bg-[var(--color-surface-1)]',
    text: 'text-[var(--color-text-secondary)]',
    label: 'Sentinel',
    badge: 'border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
    avatar: 'border-[var(--color-border-default)] ring-[var(--color-surface-3)]',
  },
};

/**
 * Granice nivoa — ista kriva kao server (`xpForLevel = round(500 * level^1.35)`).
 * Vraća `{ start, end }` u apsolutnim XP poenima; traka meri `xp - start`.
 */
const levelRange = (level: number) => {
  const safe = Math.max(1, level);
  const start = safe === 1 ? 0 : Math.round(500 * Math.pow(safe, 1.35));
  return { start, end: Math.round(500 * Math.pow(safe + 1, 1.35)) };
};

const formatXp = (value: number) => value.toLocaleString('sr-Latn-RS');

export default function LeaderboardPage() {
  const [filter, setFilter] = useState<'karma' | 'level'>('karma');

  // Server sortira CEO skup po traženom ključu pa tek onda seče na `limit`.
  // Ranije se „po nivou“ sortiralo samo 50 najboljih po karmi.
  const [limit, setLimit] = useState(50);
  const { data, isLoading: loading, isError, refetch } = useQuery({
    queryKey: ['leaderboard', filter, limit],
    queryFn: () => api.users.leaderboard(limit, filter),
  });

  const users: LeaderboardUser[] = data?.users ?? [];
  const total = data?.total ?? users.length;

  const sorted = [...users].sort((a, b) => {
    if (filter === 'level') return b.level - a.level || b.xp - a.xp;
    return b.karma - a.karma || b.level - a.level;
  });

  const getRankLabel = (rank: number) => {
    if (rank === 1) return '1. mesto';
    if (rank === 2) return '2. mesto';
    if (rank === 3) return '3. mesto';
    return `#${rank}`;
  };

  // Stanja nikad ne smeju da visine „Učitavanje...“ — skeleton zadržava layout.
  const listSkeleton = (
    <div className="divide-y divide-white/[0.05]" aria-busy="true" aria-label="Učitavanje rang-liste">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div key={row} className="flex items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-5 sm:gap-6">
            <div className="ui-skeleton h-7 w-8 rounded-[4px]" />
            <div className="ui-skeleton h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <div className="ui-skeleton h-3 w-32" />
              <div className="ui-skeleton h-2.5 w-16" />
            </div>
          </div>
          <div className="flex items-center gap-6 sm:gap-8">
            <div className="ui-skeleton hidden h-5 w-12 rounded-[4px] sm:block" />
            <div className="ui-skeleton h-4 w-14 sm:w-20" />
          </div>
        </div>
      ))}
    </div>
  );

  // Skeletonska podijumska traka — isti raspored kao pravi top 3.
  const podiumSkeleton = (
    <div className="mb-10 grid grid-cols-1 items-end gap-4 md:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="ui-card-static flex flex-col items-center gap-4 !p-6"
          style={{ minHeight: item === 1 ? 260 : 230 }}
        >
          <div className="ui-skeleton h-3 w-24" />
          <div className="ui-skeleton rounded-full" style={{ width: item === 1 ? 88 : 72, height: item === 1 ? 88 : 72 }} />
          <div className="ui-skeleton h-5 w-32" />
          <div className="ui-skeleton h-3 w-20" />
          <div className="ui-skeleton mt-2 h-4 w-24" />
        </div>
      ))}
    </div>
  );

  // „Gaming kartica“: trenutni #1 nosač naslova ekrana (H1) + 4 stat pločice.
  const champion = sorted[0];
  const championAvatar =
    champion?.avatar ||
    (champion ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(champion.username)}` : '');
  // Progres unutar nivoa (ne ukupni XP) — ranije je traka na višim nivoima
  // stajala puna, jer je delila ukupan XP sa pragom nivoa.
  const championXp = champion?.xp ?? 0;
  const { start: levelStart, end: levelEnd } = levelRange(champion?.level ?? 1);
  const xpLeft = Math.max(0, levelEnd - championXp);
  const xpPercent = levelEnd > levelStart ? Math.min(100, Math.round(((championXp - levelStart) / (levelEnd - levelStart)) * 100)) : 0;

  return (
    <div className="section">
      <div className="container max-w-5xl">
        {/* Header */}
        <header className="mb-10 border-b border-[var(--color-border-subtle)] pb-8 text-center">
          <span className="eyebrow mb-4 justify-center">NEXUS Hall of Fame</span>
          <h1 className="page-title mx-auto">Rang-lista zajednice</h1>
          <p className="mx-auto mt-3 max-w-2xl text-lead">
            Najaktivniji članovi, veterani i kreatori sadržaja rangirani po zarađenoj karmi, osvojenim bedževima i nivoima reputacije.
          </p>

          {/* Filter switcher */}
          <div className="ui-tabs ui-tabs-pills mx-auto mt-7" role="tablist" aria-label="Kriterijum rangiranja">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'karma'}
              onClick={() => setFilter('karma')}
              className={`ui-tab ${filter === 'karma' ? 'is-active' : ''}`}
            >
              <Star size={14} aria-hidden="true" />
              Po karmi
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'level'}
              onClick={() => setFilter('level')}
              className={`ui-tab ${filter === 'level' ? 'is-active' : ''}`}
            >
              <Flame size={14} aria-hidden="true" />
              Po nivou (XP)
            </button>
          </div>
        </header>

        {/* Gaming kartica #1 — avatar 96 px sa nivo-prstenom, 4 StatTile, progress */}
        {!loading && !isError && champion && (
          <PlayerCard
            className="mb-10"
            avatar={
              <OnlineAvatar
                src={championAvatar}
                userId={champion.id}
                isOnline={champion.isOnline}
                status={champion.status}
                size="lg"
                alt={`Avatar korisnika ${champion.username}`}
                className="h-full w-full"
              />
            }
            name={<Link to={`/profile/${champion.username}`}>{champion.username}</Link>}
            handle={champion.username}
            meta={
              <>
                <VerifiedBadge isVerified={champion.isVerified} size="sm" />
                <span className="rank-badge">
                  <Trophy size={11} aria-hidden="true" />
                  #1 · {RANK_STYLES[1].label}
                </span>
              </>
            }
            medals={<MedalRow badges={champion.badges ?? []} className="mt-1" />}
            stats={
              <>
                <StatTile label="Nivo" value={champion.level} />
                <StatTile label="XP" value={formatXp(champion.xp)} />
                <StatTile label="Karma" value={formatXp(champion.karma)} />
                <StatTile label="Bedževi" value={(champion.badges ?? []).length} />
              </>
            }
            progress={{
              percent: xpPercent,
              label: `Još ${formatXp(xpLeft)} XP do nivoa ${(champion?.level ?? 1) + 1}`,
            }}
          />
        )}

        {/* Podium Top 3 */}
        {loading && podiumSkeleton}

        {!loading && sorted.length >= 3 && (
          <motion.div
            className="mb-10 grid grid-cols-1 items-end gap-4 md:grid-cols-3"
            aria-label="Top 3 na rang-listi"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          >
            {[sorted[1], sorted[0], sorted[2]].map((user, index) => (
              <motion.div
                key={user.id}
                variants={{
                  hidden: { opacity: 0, y: -16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
                }}
                className={`flex flex-col justify-end ${index === 1 ? 'md:order-2' : index === 0 ? 'md:order-1' : 'md:order-3'}`}
              >
                <PodiumCard user={user} rank={index === 1 ? 1 : index === 0 ? 2 : 3} isWinner={index === 1} />
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Full Table */}
        <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-[var(--shadow-level-1)]">
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

          {loading ? (
            listSkeleton
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="ui-state-icon ui-state-icon-error" aria-hidden="true">
                <AlertTriangle size={22} />
              </span>
              <p className="ui-state-title">Rang-lista trenutno nije dostupna</p>
              <p className="ui-state-text">Server ne može da vrati rangiranje. Pokušaj ponovo za koji trenutak.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="ui-btn br-secondary ui-btn-sm"
              >
                Pokušaj ponovo
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="ui-state-icon" aria-hidden="true">
                <Trophy size={22} />
              </span>
              <p className="ui-state-title">Nema registrovanih korisnika</p>
              <p className="ui-state-text">Prvi članovi koji se registruju pojaviće se ovde sa svojim nivoom i karmom.</p>
              <Link to="/forum" className="ui-btn br-secondary ui-btn-sm mt-1">
                Otvori forum
              </Link>
            </div>
          ) : (
            <VirtualizedUserList users={sorted} getRankLabel={getRankLabel} filter={filter} />
          )}

          {!loading && !isError && users.length > 0 && users.length < total && (
            <div className="flex flex-col items-center gap-2 border-t border-white/[0.07] px-6 py-4">
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                Prikazano {users.length} od {total.toLocaleString('sr-Latn-RS')} članova
              </span>
              <button
                type="button"
                onClick={() => setLimit((value) => Math.min(value + 50, 1000))}
                className="ui-btn br-secondary ui-btn-sm"
              >
                Prikaži još
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ROW_HEIGHT = 73; // px-4 py-4 + 40px avatar = fiksna visina reda

/**
 * Virtuelizovana lista korisnika (@tanstack/react-virtual).
 * Renderuje samo vidljive redove (~10 umesto svih 50+),
 * pa lista ostaje brza i na nekoliko hiljada korisnika.
 */
function VirtualizedUserList({
  users,
  getRankLabel,
  filter,
}: {
  users: LeaderboardUser[];
  getRankLabel: (rank: number) => string;
  filter: 'karma' | 'level';
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
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="leader-row group flex items-center justify-between border-b border-white/[0.05] px-4 py-4 sm:px-6"
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
                    className={`flex-shrink-0 border bg-[#e2e8f0] transition-colors ${
                      rankStyle ? rankStyle.avatar : 'border-white/12 group-hover:border-primary-fg/40'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="leader-name truncate text-[0.9375rem] font-medium text-[var(--color-text-primary)] transition-colors group-hover:text-[var(--color-text-primary)]">
                        {u.username}
                      </span>
                      <VerifiedBadge isVerified={u.isVerified} size="xs" />
                      {u.role === 'admin' && (
                        <span className="rounded-[3px] border border-violet-500/40 bg-violet-500/10 px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-violet-200">
                          Admin
                        </span>
                      )}
                      {u.role === 'moderator' && (
                        <span className="rounded-[3px] border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                          Mod
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">{u.badges?.length || 0} bedževa</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-6 sm:gap-8">
                <span className="hidden min-w-[3.5rem] rounded-[4px] border border-white/[0.07] bg-surface-2 px-2 py-0.5 text-center font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)] sm:inline-block">
                  LVL {u.level}
                </span>
                <span className="w-20 text-right font-mono text-sm font-semibold tabular-nums text-[var(--color-text-primary)] sm:w-24">
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
          className={`mx-auto border-2 ring-4 ring-[var(--color-surface-2)] ${style.avatar} ${
            isWinner ? '!h-[88px] !w-[88px]' : '!h-[72px] !w-[72px]'
          }`}
        />
        <span className="absolute -right-3 -top-2 rounded-[4px] border border-violet-500/30 bg-surface-4 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--color-text-secondary)] shadow-[var(--shadow-level-1)]">
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
      <div className="inline-flex items-center gap-2 border-t border-white/[0.07] pt-4">
        <Star size={13} className={style.text} aria-hidden="true" />
        <span className="font-mono text-sm font-medium tabular-nums text-[var(--color-text-primary)]">+{user.karma.toLocaleString('sr-Latn-RS')}</span>
        <span className="text-[11px] text-[var(--color-text-muted)]">karme</span>
      </div>
    </Link>
  );
}
