import { forwardRef, useState } from 'react';
import { Activity, Bookmark, Camera, Check, Download, ListChecks, Lock, MessageSquare, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, BadgeChip, EmptyState, ImageUpload, RARITY_STYLES, cn } from '../ui';
import { BADGES, PRESET_AVATARS } from './constants';

/**
 * Bedževi i dostignuća — osvojeni su istaknuti, ostali iz kataloga
 * prikazani kao zaključani (sa uslovom i retkošću).
 */
export function ProfileBadges({ badges }: { badges: string[] }) {
  const owned = new Set(badges);

  return (
    <div className="ui-card-static space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold text-white">Bedževi i dostignuća</h2>
        <span
          className="rounded-[4px] border border-white/[0.07] bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]"
          title={`Otključano ${owned.size} od ${BADGES.length} bedževa`}
        >
          {owned.size}<span className="text-[var(--color-text-disabled)]"> / {BADGES.length}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {BADGES.map((badge) => {
          const unlocked = owned.has(badge.id);
          const style = RARITY_STYLES[badge.rarity];
          return (
            <div
              key={badge.id}
              title={badge.how}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
                unlocked ? style.ring : 'profile-badge-row-locked',
                unlocked && (badge.rarity === 'rare' || badge.rarity === 'epic' || badge.rarity === 'legendary')
                  ? 'badge-chip-animated'
                  : '',
              )}
              style={
                unlocked && badge.rarity !== 'common'
                  ? ({ '--badge-glow': style.glow } as React.CSSProperties)
                  : undefined
              }
            >
              {/* Ikonica je jedini deo koji nosi boju retkosti — ime ostaje puno čitljivo */}
              <span className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] border', unlocked ? style.ring : 'border-white/[0.08] bg-surface-2', unlocked ? style.text : 'text-[var(--color-text-muted)]')}>
                <BadgeChip id={badge.id} size="xs" className="!border-0 !bg-transparent !p-0 !text-[inherit]" hideLabel />
              </span>
              <div className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px] font-semibold leading-tight', unlocked ? 'text-white' : 'text-[var(--color-text-secondary)]')}>
                  {badge.name}
                </span>
                <span className={cn('block truncate text-[11px]', unlocked ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-muted)]')}>
                  {unlocked ? badge.desc : badge.how}
                </span>
              </div>
              {unlocked ? (
                <span className={cn('ml-auto flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.06em]', style.text)}>
                  {style.label}
                </span>
              ) : (
                <span
                  className="ml-auto flex flex-shrink-0 items-center gap-1 rounded-[3px] border border-white/[0.07] bg-surface-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]"
                  aria-label="Bedž je zaključan"
                >
                  <Lock size={9} aria-hidden="true" />
                  Zaključan
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tema u profilu — pravi link na `/thread/:id` (ranije je bio mrtav `<article>`). */
function ThreadLink({ thread }: { thread: any }) {
  return (
    <article className="rounded-md border border-white/[0.07] bg-white/[0.015] p-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.03]">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">{thread.subforum}</span>
      <Link to={`/thread/${thread.id}`} className="block truncate font-display text-sm font-semibold text-white transition-colors hover:text-[var(--color-primary-hover)]">
        {thread.title}
      </Link>
      <span className="mt-1 block font-mono text-[11px] text-white/40">
        {thread.createdAt ? new Date(thread.createdAt).toLocaleDateString('sr-Latn-RS') : 'Nedavno'} · {thread.views || 0} pregleda ·{' '}
        {thread.replies || 0} odgovora
      </span>
    </article>
  );
}

/** Sadržaj modala za uređivanje profila (avatar + bio). */
/**
 * F-09 — GDPR/ZZPL akcije u podešavanjima: izvoz podataka i brisanje naloga.
 * Obe koriste stvarne endpoint-e: GET /api/users/me/export i DELETE /api/users/me.
 */
export function AccountPrivacySection({ onLogout }: { onLogout: () => void }) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const exportData = async () => {
    setError(null);
    setBusy('export');
    try {
      const data = await api.auth.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nexus-podaci-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? 'Izvoz nije uspeo.');
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setError(null);
    setBusy('delete');
    try {
      await api.auth.deleteAccount();
      onLogout();
    } catch (err: any) {
      setError(err?.message ?? 'Brisanje naloga nije uspelo.');
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 space-y-4 rounded-md border border-white/10 bg-surface-0 p-4">
      <div>
        <h4 className="text-sm font-bold text-white/85">Privatnost i podaci</h4>
        <p className="mt-1 text-xs leading-relaxed text-white/55">
          Možete preuzeti kopiju svih svojih podataka ili trajno obrisati nalog. Detalji su u{' '}
          <Link to="/privacy" className="text-[var(--color-primary-fg)] underline underline-offset-3">
            politici privatnosti
          </Link>
          .
        </p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn br-secondary ui-btn-sm" onClick={exportData} disabled={busy !== null}>
          <Download size={14} /> {busy === 'export' ? 'Priprema…' : 'Preuzmi svoje podatke'}
        </button>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-4">
        <p className="text-xs text-white/60">
          Brisanje je trajno: lični podaci se uklanjaju, objavljene teme se anonimizuju, a sve sesije prestaju da važe.
          Upišite <span className="font-mono text-white/85">OBRISI</span> da potvrdite.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            aria-label="Potvrda brisanja naloga"
            className="ui-field w-auto flex-1 min-w-40"
          />
          <button
            type="button"
            className="ui-btn br-danger ui-btn-sm"
            onClick={deleteAccount}
            disabled={confirmText !== 'OBRISI' || busy !== null}
          >
            <Trash2 size={14} /> {busy === 'delete' ? 'Brisanje…' : 'Obriši nalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ProfileSettingsForm = forwardRef<HTMLFormElement, { avatar: string; bio: string; onAvatarChange: (value: string) => void; onBioChange: (value: string) => void; onSubmit: (event: React.FormEvent) => void }>(function ProfileSettingsForm({ avatar, bio, onAvatarChange, onBioChange, onSubmit }, ref) {
  const [customUrl, setCustomUrl] = useState(avatar.startsWith('data:') ? '' : avatar);

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <span className="block text-sm font-bold text-white/85">Izaberi avatar</span>
        <div className="grid grid-cols-4 gap-2.5">
          {PRESET_AVATARS.map((seed) => {
            const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
            const selected = avatar === avatarUrl;
            return (
              <button
                key={seed}
                type="button"
                onClick={() => onAvatarChange(avatarUrl)}
                aria-label={`Izaberi avatar ${seed}`}
                aria-pressed={selected}
                className={`relative aspect-square rounded-md border bg-surface-0 p-1.5 transition ${
                  selected ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <img src={avatarUrl} alt="" width={80} height={80} loading="lazy" className="h-full w-full rounded-lg object-cover" />
                {selected && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[var(--color-text-on-primary)]">
                    <Check size={11} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label htmlFor="profile-avatar-url" className="block pt-2 text-xs text-white/60">
          Ili unesi direktan URL slike
        </label>        <div className="flex gap-2">
          <input
            id="profile-avatar-url"
            type="url"
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="https://example.com/avatar.png"
            className="ui-field"
          />
          <button
            type="button"
            onClick={() => customUrl.trim() && onAvatarChange(customUrl.trim())}
            className="ui-btn br-secondary ui-btn-sm"
            aria-label="Primeni URL avatara"
          >
            <Camera size={14} />
          </button>
        </div>
        {/* 2.6.2 — Upload u Supabase Storage; server sam smanjuje sliku na 256px WebP. */}
        <div className="pt-2">
          <ImageUpload kind="avatar" onUploaded={onAvatarChange} label="Ili otpremi sliku sa uređaja" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="profile-bio" className="block text-sm font-bold text-white/85">
          Biografija
        </label>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(event) => onBioChange(event.target.value)}
          rows={4}
          maxLength={280}
          placeholder="Napiši nešto o sebi, omiljenim igrama i setup-u…"
          className="ui-field resize-none"
        />
        <div className="text-right font-mono text-[11px] text-white/40">{bio.length}/280</div>
      </div>
      <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
    </form>
  );
});

/** Profilne tabove sa sadržajem (teme / aktivnost / bedževi / sačuvano / kvestovi). */
export function ProfileTabsContent({
  activeTab,
  loading,
  threads,
  activities,
  savedArticles,
  savedThreads = [],
  quests = [],
  badges = [],
  isOwner,
  availableTabs,
}: {
  activeTab: 'threads' | 'activity' | 'badges' | 'saved' | 'quests';
  loading: boolean;
  threads: any[];
  activities: any[];
  savedArticles: any[];
  savedThreads?: any[];
  quests?: any[];
  badges?: string[];
  isOwner: boolean;
  availableTabs: Array<'threads' | 'activity' | 'badges' | 'saved' | 'quests'>;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-md border border-white/[0.06] bg-surface-1 p-4">
            <div className="ui-skeleton mb-2.5 h-2.5 w-20" />
            <div className="ui-skeleton mb-2 h-4 w-3/4" />
            <div className="ui-skeleton h-3 w-2/5" />
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === 'threads') {
    if (threads.length === 0) {
      return (
        <EmptyState
          icon={<MessageSquare size={22} />}
          title="Nema objavljenih tema"
          message={
            isOwner
              ? 'Započni prvu diskusiju o igrama, hardveru ili eSportu.'
              : 'Korisnik još nije otvorio temu.'
          }
          action={
            isOwner ? (
              <Link to="/forum" className="ui-btn br-secondary ui-btn-sm">
                Otvori forum
              </Link>
            ) : undefined
          }
        />
      );
    }
    return (
      <div className="space-y-3">
        {threads.map((thread) => (
          <ThreadLink key={thread.id} thread={thread} />
        ))}
      </div>
    );
  }

  if (activeTab === 'activity') {
    if (activities.length === 0) {
      return (
        <EmptyState
          icon={<Activity size={22} />}
          title="Nema nedavne aktivnosti"
          message="Aktivnost će se pojaviti kada korisnik učestvuje u zajednici."
        />
      );
    }
    return (
      <div className="space-y-2.5">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start gap-3 rounded-md border border-white/[0.07] bg-surface-1 p-3.5 transition-colors hover:border-white/[0.14] hover:bg-surface-2">
            <span className="relative mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-white/75">{activity.text}</p>
              <span className="mt-1 block font-mono text-[11px] text-white/35">
                {activity.date ? new Date(activity.date).toLocaleDateString('sr-Latn-RS') : 'Nedavno'}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === 'badges') {
    return (
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {BADGES.map((badge) => {
          const unlocked = badges.includes(badge.id);
          const style = RARITY_STYLES[badge.rarity];
          return (
            <div
              key={badge.id}
              className={cn(
                'flex items-center gap-3 rounded-md border p-3 transition-colors',
                unlocked ? style.ring : 'profile-badge-row-locked',
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[6px] border',
                  unlocked ? style.ring : 'border-white/[0.08] bg-surface-2',
                  unlocked ? style.text : 'text-white/30',
                )}
              >
                <BadgeChip id={badge.id} size="sm" hideLabel className="!border-0 !bg-transparent !p-0 !text-[inherit]" />
              </span>
              <div className="min-w-0">
                <div className={cn('truncate text-[13px] font-semibold', unlocked ? 'text-white' : 'text-white/55')}>{badge.name}</div>
                <div className="truncate text-[11px] text-white/40">{unlocked ? badge.desc : badge.how}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (activeTab === 'quests') {
    if (quests.length === 0) {
      return (
        <EmptyState
          icon={<ListChecks size={22} />}
          title="Nema aktivnih kvestova"
          message="Novi kvestovi se pojavljuju dok zajednica raste."
        />
      );
    }
    return (
      <div className="space-y-2.5">
        {quests.map((quest: any) => {
          const percent = quest.targetCount > 0 ? Math.min(100, Math.round((quest.progress / quest.targetCount) * 100)) : 0;
          return (
            <div key={quest.code} className={`profile-quest-card ${quest.completed ? 'is-done' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-white">{quest.title}</h3>
                <Badge tone={quest.completed ? 'success' : 'neutral'} className={quest.completed ? '' : 'font-mono'}>{
                  quest.completed ? 'Završeno' : `+${quest.xpReward} XP`
                }</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-white/45">{quest.description}</p>
              <div className="profile-xp-track mt-2.5 !h-1.5" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="profile-xp-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="mt-1 block font-mono text-[11px] text-white/35">
                {quest.progress}/{quest.targetCount}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (!availableTabs.includes('saved')) return null;
  if (savedArticles.length === 0 && savedThreads.length === 0) {
    return (
      <EmptyState
        icon={<Bookmark size={22} />}
        title="Još nema sačuvanih objava"
        message="Objave koje sačuvaš pojaviće se ovde."
      />
    );
  }
  return (
    <div className="space-y-3">
      {savedThreads.map((thread: any) => (
        <div key={`thread-${thread.id}`} className="rounded-md border border-white/[0.07] bg-white/[0.015] p-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.03]">
          <Badge tone="secondary">Tema · {thread.subforum}</Badge>
          <Link to={`/thread/${thread.id}`} className="mt-1.5 block text-[13px] font-semibold text-white transition-colors hover:text-[var(--color-primary-hover)]">
            {thread.title}
          </Link>
          <p className="mt-1 text-[11px] text-white/40">
            {thread.author} · {thread.replies || 0} odgovora
          </p>
        </div>
      ))}
      {savedArticles.map((article: any) => (
        <Link
          key={article.id || article.slug}
          to={`/article/${article.slug || article.id}`}
          className="block rounded-md border border-white/[0.07] bg-white/[0.015] p-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.03]"
        >
          <Badge tone="primary">{article.category || 'Članak'}</Badge>
          <h3 className="mt-1.5 text-[13px] font-semibold text-white">{article.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-white/45">{article.excerpt}</p>
        </Link>
      ))}
    </div>
  );
}
