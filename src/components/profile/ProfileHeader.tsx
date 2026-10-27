import { Link } from 'react-router-dom';
import { Camera, Calendar, CheckCircle2, Flame, MessageSquare, Settings, Share2, Sparkles, Trophy, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn, MedalRow, OnlineAvatar, PlayerCard, StatTile, useUserOnline } from '../ui';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { RoleEmblem, roleAvatarFrame, roleGlow } from './RoleEmblem';

/**
 * Progres ka sledećem nivou.
 *
 * Server šalje `xpIntoLevel`/`xpForNext` (novi ugovor). Stariji odgovori nose samo
 * `xp` i `xpNeeded` — tada se progres izvodi iz apsolutnih pragova
 * (`xpForLevel = round(500 * level^1.35)`), a ne iz `xp / xpNeeded`, jer bi tada
 * traka pokazivala ukupan XP, a ne napredak unutar nivoa.
 */
export function levelProgress(user: Pick<ProfileHeaderUser, 'xp' | 'level' | 'xpNeeded' | 'xpIntoLevel' | 'xpForNext'>) {
  const xp = Math.max(0, Math.round(Number(user.xp) || 0));
  const level = Math.max(1, Math.round(Number(user.level) || 1));

  let into = Number(user.xpIntoLevel);
  let needed = Number(user.xpForNext);

  if (!Number.isFinite(into) || !Number.isFinite(needed) || needed <= 0) {
    const levelStart = level === 1 ? 0 : Math.round(500 * Math.pow(level, 1.35));
    const levelEnd = Number(user.xpNeeded) > levelStart ? Number(user.xpNeeded) : Math.round(500 * Math.pow(level + 1, 1.35));
    into = xp - levelStart;
    needed = Math.max(1, levelEnd - levelStart);
  }

  into = Math.max(0, Math.min(needed, Math.round(into)));
  return {
    percent: Math.max(0, Math.min(100, Math.round((into / needed) * 100))),
    into,
    needed,
    remaining: Math.max(0, needed - into),
  };
}

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
  /** Absolutni XP prag sledećeg nivoa (staro polje, `GET /api/users/:username`). */
  xpNeeded?: number;
  /** XP u okviru tekućeg nivoa (`xpInLevel` sa servera; fallback: izračun iz `xp`). */
  xpIntoLevel?: number;
  /** Koliko XP-a tekući nivo traži (`xpForNext` sa servera). */
  xpForNext?: number;
  /** Bedževi korisnika (`users.badges`) — red medalja u kartici. */
  badges?: string[];
  postCount?: number;
  createdAt?: string;
  joinedAt?: string;
}

/**
 * ProfileHeader — hero deo profila: cover, avatar, identitet, XP i statistika.
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
  const progress = levelProgress(user);
  const xpPercent = progress.percent;
  // Do sledećeg nivoa ostaje onoliko XP-a koliko tekući nivo još traži.
  const xpLeft = progress.remaining;
  const avatar = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.username)}`;
  const joined = user.createdAt || user.joinedAt;
  const online = useUserOnline(user.id, user.isOnline);
  const postCount = user.postCount ?? threadCount + replyCount;

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
      <div
        className="profile-cover relative"
        data-cover={(user as { coverPreset?: string | null }).coverPreset || 'violet'}
      />

      {/* 5.0 TERMINAL — whoami linija: $ whoami → user · role · joined */}
      <div className="profile-whoami" aria-hidden="true">
        <span className="profile-whoami-cmd">$ whoami</span>
        <span className="profile-whoami-out">
          {user.username} · role:{user.role?.toLowerCase() ?? 'member'} · joined:{joined
            ? new Date(joined).toLocaleDateString('sr-Latn-RS', { year: 'numeric', month: '2-digit' })
            : '---'}
        </span>
      </div>

      <div className="relative z-10 px-5 pb-5 sm:px-6 md:px-8 md:pb-6">
        <PlayerCard
          className="-mt-12 sm:-mt-14"
          avatar={
            <div
              className={cn('profile-avatar-frame group', roleAvatarFrame(user.role))}
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
                  className="absolute inset-0 flex-col items-center justify-center gap-1 rounded-[22px] bg-black/75 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Camera size={20} />
                  Izmeni
                </button>
              )}
            </div>
          }
          name={<h1 id="profile-name">{user.username}</h1>}
          handle={user.username}
          meta={
            <>
              <VerifiedBadge isVerified={user.isVerified} size="md" />
              <RoleEmblem role={user.role} />
              {online && <span className="online-pill">Online sada</span>}
              <span className="rank-badge">
                <Sparkles size={11} aria-hidden="true" />
                {String(user.rank || 'Rookie Vanguard').toUpperCase()}
              </span>
            </>
          }
          medals={<MedalRow badges={user.badges ?? []} className="mt-1" />}
          actions={
            <>
              <span className="meta-row profile-hero-meta">
                <Flame size={13} aria-hidden="true" />
                {Number(user.karma || 0).toLocaleString('sr-Latn-RS')} karme
              </span>
              {joined && (
                <span className="meta-row profile-hero-meta">
                  <Calendar size={13} aria-hidden="true" /> Clan od{' '}
                  {new Date(joined).toLocaleDateString('sr-Latn-RS', { year: 'numeric', month: 'short' })}
                </span>
              )}
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
            </>
          }
          stats={
            <>
              <StatTile label="Nivo" value={user.level || 1} icon={<Trophy size={12} aria-hidden="true" />} />
              <StatTile label="XP" value={Number(user.xp || 0).toLocaleString('sr-Latn-RS')} />
              <StatTile label="Karma" value={Number(user.karma || 0).toLocaleString('sr-Latn-RS')} />
              <StatTile label="Postovi" value={postCount.toLocaleString('sr-Latn-RS')} />
            </>
          }
          progress={{ percent: xpPercent, label: `Još ${xpLeft.toLocaleString('sr-Latn-RS')} XP do nivoa ${(user.level || 1) + 1}` }}
        />
      </div>
    </section>
  );
}


/**
 * LevelCard — desktop rail: XP progres + brzi pregled (nivo, karma, bedževi).
 * Popunjava prazninu u levoj koloni — bez ovoga kolona deluje prazno na ≥ lg.
 */
export function ProfileQuickStats({
  karma,
  solved,
  badges,
  threads,
}: {
  karma: number;
  /** 6.x — reputacija: prihvaćeni odgovori (odvojeno od karme/glasova). */
  solved: number;
  badges: number;
  threads: number;
}) {
  const items = [
    { label: 'Karma', value: karma, icon: <Flame size={13} aria-hidden="true" /> },
    { label: 'Prihvaćeni odgovori', value: solved, icon: <CheckCircle2 size={13} aria-hidden="true" /> },
    { label: 'Bedževi', value: badges, icon: <Trophy size={13} aria-hidden="true" /> },
    { label: 'Teme', value: threads, icon: <MessageSquare size={13} aria-hidden="true" /> },
  ];
  return (
    <div className="ui-card-static">
      <span className="mb-3 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
        <CheckCircle2 size={12} className="text-[var(--color-community-fg)]" aria-hidden="true" /> Brzi pregled
      </span>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2.5 last:border-b-0 last:pb-0"
          >
            <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-tertiary)]">
              {item.icon}
              {item.label}
            </span>
            <span className="font-mono tabular-nums text-[13px] font-semibold text-[var(--color-text-primary)]">
              {Number(item.value || 0).toLocaleString('sr-Latn-RS')}
            </span>
          </div>
        ))}
      </div>
      <Link
        to="?tab=badges"
        className="mt-3 block border-t border-white/[0.06] pt-3 text-[12px] font-medium text-[var(--color-primary-fg)] transition-colors hover:text-[var(--color-primary-fg-light)]"
      >
        Svi bedževi i kvestovi →
      </Link>
    </div>
  );
}

/** XP / nivo kartica. */
export function LevelCard({ user }: { user: ProfileHeaderUser }) {
  const progress = levelProgress(user);
  const xpPercent = progress.percent;
  return (
    <div>
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
              <Zap size={12} className="text-cyan-400 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" aria-hidden="true" /> Nivo naloga
            </span>
            <div className="flex items-baseline gap-2 font-display text-[2.5rem] font-semibold leading-none tracking-[-0.04em] text-white">
              <span className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-slate-500">LVL</span>
              <span className="bg-gradient-to-b from-cyan-300 to-violet-500 bg-clip-text font-mono tabular-nums text-transparent">{user.level || 1}</span>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="shrink-0 text-[var(--color-text-tertiary)]">XP progres</span>
            <span className="flex items-center gap-2">
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-cyan-300 shadow-[0_0_16px_-6px_rgba(124,58,237,0.9)]">
                {xpPercent}%
              </span>
              <span className="truncate font-mono tabular-nums text-[var(--color-text-secondary)]">
                {progress.into.toLocaleString('sr-Latn-RS')} / {progress.needed.toLocaleString('sr-Latn-RS')}
              </span>
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

