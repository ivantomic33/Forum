import { Link } from 'react-router-dom';
import { Camera, Calendar, Flame, Gamepad2, MessageSquare, Settings, Share2, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn, OnlineAvatar, useUserOnline } from '../ui';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { StatChip } from './constants';
import { RoleEmblem, roleAvatarFrame, roleGlow } from './RoleEmblem';

export interface ProfileHeaderUser {
  username: string;
  avatar?: string;
  role?: string;
  /** Potvrđen email — značka pored imena (`publicUser` u `lib/userShape.ts`). */
  isVerified?: boolean;
  /** `users.id` — ključ prisustva (`OnlineAvatar`). */
  id?: string;
  /** Server je već proverio prisustvo (`GET /api/users/:username`). */
  isOnline?: boolean;
  bio?: string;
  status?: 'online' | 'away' | 'offline';
  rank?: string;
  level?: number;
  karma?: number;
  xp?: number;
  xpNeeded?: number;
  createdAt?: string;
  joinedAt?: string;
}

/**
 * ProfileHeader � hero deo profila: cover, avatar, identitet, XP i statistika.
 * Izdvojeno iz ProfilePage radi citljivosti i testabilnosti.
 */
export function ProfileHeader({
  user,
  isOwner,
  connectedCount,
  threadCount,
  replyCount,
  onEdit,
}: {
  user: ProfileHeaderUser;
  isOwner: boolean;
  connectedCount: number;
  threadCount: number;
  replyCount: number;
  onEdit: () => void;
}) {
  const xpPercent = Math.min(100, Math.round(((user.xp || 0) / (user.xpNeeded || 1000)) * 100));
  const avatar = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.username)}`;
  const joined = user.createdAt || user.joinedAt;
  const online = useUserOnline(user.id, user.isOnline);

  const copyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link do profila je kopiran!');
    } catch {
      toast.error('Nije moguce kopirati link u clipboard.');
    }
  };

  return (
    <section className="profile-hero" aria-labelledby="profile-name">
      <div className="profile-cover relative">
        <div className="absolute right-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-2 sm:right-4 sm:top-4">
          <button
            type="button"
            onClick={copyProfileLink}
            className="ui-btn br-secondary ui-btn-sm"
            aria-label="Kopiraj link profila"
          >
            <Share2 size={13} />
            <span className="hidden sm:inline">Podeli</span>
          </button>
          {isOwner && (
            <button type="button" onClick={onEdit} className="ui-btn br-primary ui-btn-sm">
              <Settings size={13} />
              Uredi profil
            </button>
          )}
        </div>
      </div>

      <div className="relative z-10 px-5 pb-5 sm:px-6 md:px-8 md:pb-6">
        <div className="-mt-12 flex flex-col justify-between gap-5 sm:-mt-14 md:flex-row md:items-end">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
            <div
              className={cn(
                'profile-avatar-frame group flex-shrink-0',
                roleAvatarFrame(user.role),
              )}
              style={roleGlow(user.role) ? ({ '--role-glow': roleGlow(user.role) } as React.CSSProperties) : undefined}
            >
              <div className="profile-avatar-inner">
                {/* 2.6.1 — zeleni prsten kada je korisnik „online sada“ */}
                <OnlineAvatar
                  src={avatar}
                  userId={user.id}
                  isOnline={user.isOnline}
                  status={user.status}
                  size="lg"
                  shape="squircle"
                  alt={`Avatar korisnika ${user.username}`}
                  className="h-full w-full !rounded-[19px]"
                />
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label="Izmeni avatar"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[22px] bg-black/75 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Camera size={20} />
                  Izmeni
                </button>
              )}
            </div>

            <div className="min-w-0 space-y-2 pb-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 id="profile-name" className="font-display text-[1.875rem] font-semibold tracking-[-0.03em] text-white md:text-4xl">
                  {user.username}
                </h1>
                <VerifiedBadge isVerified={user.isVerified} size="md" />
                <RoleEmblem role={user.role} />
                {online && <span className="online-pill">Online sada</span>}
                <span className="rank-badge">
                  <Sparkles size={11} aria-hidden="true" />
                  {String(user.rank || 'Rookie Vanguard').toUpperCase()}
                </span>
              </div>
              {user.bio && <p className="max-w-xl text-sm leading-relaxed text-slate-400">{user.bio}</p>}
              {joined && (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar size={12} aria-hidden="true" /> Clan od{' '}
                  {new Date(joined).toLocaleDateString('sr-Latn-RS', { year: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          </div>

          {user.status && user.status !== 'offline' && (
            <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-surface-2/80 px-3 py-2 backdrop-blur-md lg:flex">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  user.status === 'online'
                    ? 'nx-online-pulse bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
                    : 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.7)]',
                )}
                aria-hidden="true"
              />
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-400">
                {user.status === 'online' ? 'Na mreži' : 'Odsutan'}
              </span>
            </div>
          )}
        </div>

        <div className="profile-stat-strip mt-6">
          <StatChip icon={<Flame size={15} />} label="Karma" value={Number(user.karma || 0).toLocaleString('sr-Latn-RS')} />
          <StatChip icon={<MessageSquare size={15} />} label="Teme" value={threadCount} />
          <StatChip icon={<TrendingUp size={15} />} label="Odgovori" value={replyCount.toLocaleString('sr-Latn-RS')} />
          <StatChip icon={<Gamepad2 size={15} />} label="Nalozi" value={connectedCount} />
        </div>
      </div>
    </section>
  );
}

/** XP / nivo kartica. */
export function LevelCard({ user }: { user: ProfileHeaderUser }) {
  const xpPercent = Math.min(100, Math.round(((user.xp || 0) / (user.xpNeeded || 1000)) * 100));
  return (
    <div>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
              <Zap size={12} className="text-cyan-400 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" aria-hidden="true" /> Nivo naloga
            </span>
            <div className="flex items-baseline gap-2 font-display text-[2.5rem] font-semibold leading-none tracking-[-0.04em] text-white">
              <span className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-slate-500">LVL</span>
              <span className="bg-gradient-to-b from-cyan-300 to-violet-500 bg-clip-text font-mono tabular-nums text-transparent">{user.level || 1}</span>
            </div>
          </div>
          <div className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-cyan-300 shadow-[0_0_16px_-6px_rgba(124,58,237,0.9)]">
            {xpPercent}%
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="shrink-0 text-[var(--color-text-tertiary)]">XP progres</span>
            <span className="truncate font-mono tabular-nums text-[var(--color-text-secondary)]">
              {Number(user.xp || 0).toLocaleString('sr-Latn-RS')} / {Number(user.xpNeeded || 1000).toLocaleString('sr-Latn-RS')}
            </span>
          </div>
          <div
            className="profile-xp-track"
            role="progressbar"
            aria-valuenow={xpPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="XP progres do sledeceg nivoa"
          >
            <div className="profile-xp-fill" style={{ width: `${xpPercent}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
          <Link to="/forum" className="ui-btn br-secondary ui-btn-sm w-full">
            Zaradi XP na forumu
          </Link>
          <Link to={`/profile/${encodeURIComponent(user.username)}?tab=quests`} className="ui-btn br-ghost ui-btn-sm w-full">
            <span className="truncate">Kvestovi i bedževi</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

