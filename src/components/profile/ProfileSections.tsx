import { forwardRef, useState } from 'react';
import { Activity, Bookmark, Check, Download, Link2, ListChecks, Lock, MessageSquare, Trash2, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { SettingsSection } from './SettingsSection';
// N10 — tipovi dolaze iz ugovora sa serverom, ne iz lokalnog `any`.
import type { Article, Quest, Thread, UserActivity } from '../../../contracts/index';
import { Badge, BadgeChip, EmptyState, ImageUpload, RARITY_STYLES, cn } from '../ui';
import { BADGES, PRESET_AVATARS } from './constants';

/**
 * Bedževi i dostignuća — osvojeni su istaknuti, ostali iz kataloga
 * prikazani kao zaključani (sa uslovom i retkošću).
 */
export function ProfileBadges({ badges, stats }: { badges: string[]; stats?: { threads: number; replies: number } | null }) {
  const owned = new Set(badges);
  const percent = BADGES.length > 0 ? Math.round((owned.size / BADGES.length) * 100) : 0;

  // #2 — mapa napretka: contributor = teme, helpful = odgovori.
  const progressFor = (badgeId: string) => {
    if (!stats) return null;
    if (badgeId === 'contributor') return { value: stats.threads, target: 10, label: 'tema' };
    if (badgeId === 'helpful') return { value: stats.replies, target: 25, label: 'odgovora' };
    return null;
  };

  return (
    <div className="ui-card-static space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold text-white">Bedževi i dostignuća</h2>
        <span
          className="rounded-[4px] border border-white/[0.07] bg-surface-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]"
          title={`Otključano ${owned.size} od ${BADGES.length} bedževa (${percent}%)`}
        >
          {owned.size}<span className="text-[var(--color-text-disabled)]"> / {BADGES.length}</span>
        </span>
      </div>

      {/* Napredak kroz katalog — brojač i traka sada pričaju istu priču */}
      <div
        className="profile-xp-track !h-1.5"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Bedževi: otključano ${owned.size} od ${BADGES.length}`}
      >
        <div className="profile-xp-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="grid grid-cols-1 gap-2">
        {BADGES.map((badge) => {
          const unlocked = owned.has(badge.id);
          const style = RARITY_STYLES[badge.rarity];
          const progress = progressFor(badge.id);
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
              <span
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[5px] border',
                  unlocked ? style.ring : 'border-white/[0.08] bg-surface-2/50',
                  unlocked ? style.text : 'text-[var(--color-text-disabled)] opacity-70',
                )}
              >
                {unlocked ? (
                  <BadgeChip id={badge.id} size="xs" className="!border-0 !bg-transparent !p-0 !text-[inherit]" hideLabel />
                ) : (
                  <Lock size={12} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px] font-semibold leading-tight', unlocked ? 'text-white' : 'text-[var(--color-text-tertiary)]')}>
                  {badge.name}
                </span>
                <span className={cn('block truncate text-[11px]', unlocked ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-muted)] italic')}>
                  {unlocked ? badge.desc : badge.how}
                </span>
                {/* #2 — mini-progress za zaključane bedževe sa brojivim uslovom */}
                {!unlocked && progress && (
                  <span className="mt-1 flex items-center gap-2">
                    <span className="profile-xp-track !h-1 !max-w-[7rem] flex-1">
                      <span
                        className="profile-xp-fill block"
                        style={{ width: `${Math.min(100, Math.round((progress.value / progress.target) * 100))}%` }}
                      />
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                      {progress.value}/{progress.target}
                    </span>
                  </span>
                )}
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
function ThreadLink({ thread }: { thread: Thread }) {
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
    <SettingsSection
      icon={<Download />}
      title="Privatnost i podaci"
      description="Preuzmi kopiju svojih podataka ili trajno obriši nalog."
    >
      <p className="!mt-0 text-xs text-[var(--color-text-tertiary)]">
        Detalji su u{' '}
        <Link to="/privacy" className="text-[var(--color-primary-fg)] underline underline-offset-3">
          politici privatnosti
        </Link>
        .
      </p>

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
    </SettingsSection>
  );
}

const COVER_PRESETS = [
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'emerald', label: 'Emerald', color: '#34d399' },
  { id: 'amber', label: 'Amber', color: '#f5c451' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'cyan', label: 'Cyan', color: '#38bdf8' },
];

const BIO_MAX = 280;
const presetAvatarUrl = (seed: string) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;

/**
 * Sadržaj taba „Profil“ u modalu za uređivanje.
 * Raspored: leva kolona (avatar + URL/upload), desna kolona (boja naslovnice + biografija).
 * Stilovi panela/avatara su u `ui-kit.css` (`.settings-panel`, `.avatar-choice`…).
 */
export const ProfileSettingsForm = forwardRef<HTMLFormElement, { avatar: string; bio: string; coverPreset?: string | null; onAvatarChange: (value: string) => void; onBioChange: (value: string) => void; onCoverChange: (value: string) => void; onSubmit: (event: React.FormEvent) => void }>(function ProfileSettingsForm({ avatar, bio, coverPreset, onAvatarChange, onBioChange, onCoverChange, onSubmit }, ref) {
  // Radna kopija URL-a: preset/upload je prepisuju kroz `changeAvatar`, polje ne drži stari URL.
  const [draftUrl, setDraftUrl] = useState(avatar.startsWith('data:') ? '' : avatar);
  const [urlError, setUrlError] = useState<string | null>(null);

  const activeCover = coverPreset || 'violet';
  const isPreset = PRESET_AVATARS.some((seed) => presetAvatarUrl(seed) === avatar);
  const previewSrc = avatar || presetAvatarUrl('nexus_user');

  const applyUrl = () => {
    const value = draftUrl.trim();
    if (!value) {
      setUrlError('Unesi URL slike.');
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      setUrlError('URL mora da počinje sa http:// ili https://');
      return;
    }
    setUrlError(null);
    onAvatarChange(value);
  };

  const changeAvatar = (url: string) => {
    setDraftUrl(url.startsWith('data:') ? '' : url);
    setUrlError(null);
    onAvatarChange(url);
  };

  return (
    <form ref={ref} onSubmit={onSubmit} className="settings-form">
      <div className="settings-form-grid">
        {/* ---------- Leva kolona: avatar ---------- */}
        <section className="settings-panel">
          <header className="settings-panel-head">
            <div>
              <h3 className="settings-panel-title">Avatar</h3>
              <p className="settings-panel-hint">Izaberi gotov lik, učitaj svoj ili nalepi URL.</p>
            </div>
            <img
              src={previewSrc}
              alt=""
              width={48}
              height={48}
              aria-hidden="true"
              className="settings-avatar-preview"
            />
          </header>

          <div className="avatar-grid" role="group" aria-label="Gotovi avatari">
            {PRESET_AVATARS.map((seed) => {
              const avatarUrl = presetAvatarUrl(seed);
              const selected = avatar === avatarUrl;
              return (
                <button
                  key={seed}
                  type="button"
                  onClick={() => changeAvatar(avatarUrl)}
                  aria-label={`Izaberi avatar ${seed}`}
                  aria-pressed={selected}
                  title={seed}
                  className={`avatar-choice ${selected ? 'is-selected' : ''}`}
                >
                  <img src={avatarUrl} alt="" width={96} height={96} loading="lazy" className="avatar-choice-img" />
                  {selected && (
                    <span className="avatar-choice-check" aria-hidden="true">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="settings-subgroup">
            <label htmlFor="profile-avatar-url" className="settings-label">
              URL slike
            </label>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <input
                  id="profile-avatar-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={draftUrl}
                  onChange={(event) => {
                    setDraftUrl(event.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyUrl();
                    }
                  }}
                  onBlur={() => draftUrl.trim() && draftUrl.trim() !== avatar && applyUrl()}
                  placeholder="https://example.com/avatar.png"
                  aria-invalid={urlError ? true : undefined}
                  aria-describedby={urlError ? 'profile-avatar-url-error' : undefined}
                  className="ui-field ui-field-sm"
                />
                {urlError && (
                  <p id="profile-avatar-url-error" role="alert" className="mt-1 text-[11px] text-[var(--color-tertiary-fg)]">
                    {urlError}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={applyUrl}
                disabled={draftUrl.trim() === avatar || (!draftUrl.trim() && isPreset)}
                className="ui-btn br-secondary ui-btn-sm shrink-0 gap-1.5"
              >
                <Link2 size={14} aria-hidden="true" /> Primeni
              </button>
            </div>
            {/* 2.6.2 — Upload u Supabase Storage; server sam smanjuje sliku na 256px WebP. */}
            <ImageUpload
              kind="avatar"
              onUploaded={changeAvatar}
              icon={Upload}
              actionLabel="Otpremi sliku sa uređaja"
              hint="JPG, PNG, WebP ili GIF · do 5 MB"
            />
          </div>
        </section>

        {/* ---------- Desna kolona: naslovnica + biografija ---------- */}
        <section className="settings-panel">
          <header className="settings-panel-head">
            <div>
              <h3 className="settings-panel-title">Biografija</h3>
              <p className="settings-panel-hint">Kratko predstavljanje — igre, setup, timovi.</p>
            </div>
          </header>

          <div className="space-y-1.5">
            <label htmlFor="profile-bio" className="sr-only">
              Biografija
            </label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(event) => onBioChange(event.target.value)}
              rows={8}
              maxLength={BIO_MAX}
              placeholder="Napiši nešto o sebi, omiljenim igrama i setup-u…"
              className="ui-field min-h-[11rem] resize-none leading-relaxed"
            />
            <div className="bio-meter">
              <span className="bio-meter-track" aria-hidden="true">
                <span
                  className="bio-meter-fill"
                  style={{ width: `${Math.min(100, (bio.length / BIO_MAX) * 100)}%` }}
                  data-near-limit={bio.length > BIO_MAX * 0.9 ? 'true' : undefined}
                />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                <span className="text-[var(--color-text-secondary)]">{bio.length}</span> / {BIO_MAX}
              </span>
            </div>
          </div>

          {/* #4 — Cover picker: 5 boja zona, struktura cover-a ostaje ista */}
          <div className="settings-subgroup">
            <span className="settings-label">Boja naslovnice</span>
            <div className="cover-swatches" role="group" aria-label="Boja naslovnice">
              {COVER_PRESETS.map((preset) => {
                const selected = activeCover === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onCoverChange(preset.id)}
                    aria-label={`Boja naslovnice: ${preset.label}`}
                    aria-pressed={selected}
                    title={preset.label}
                    className={`cover-swatch ${selected ? 'is-selected' : ''}`}
                    style={{ '--swatch': preset.color } as React.CSSProperties}
                  >
                    {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <p className="settings-panel-hint">
              {COVER_PRESETS.find((preset) => preset.id === activeCover)?.label} — vidi se na vrhu profila.
            </p>
          </div>
        </section>
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
  threads: Thread[];
  activities: UserActivity[];
  savedArticles: Article[];
  savedThreads?: Thread[];
  quests?: Quest[];
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
                  unlocked ? style.ring : 'border-white/[0.08] bg-surface-2/50',
                  unlocked ? style.text : 'text-[var(--color-text-disabled)] opacity-70',
                )}
              >
                {unlocked ? (
                  <BadgeChip id={badge.id} size="sm" hideLabel className="!border-0 !bg-transparent !p-0 !text-[inherit]" />
                ) : (
                  <Lock size={14} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0">
                <div className={cn('truncate text-[13px] font-semibold', unlocked ? 'text-white' : 'text-[var(--color-text-tertiary)]')}>{badge.name}</div>
                <div className={cn('truncate text-[11px]', unlocked ? 'text-white/40' : 'text-[var(--color-text-muted)] italic')}>{unlocked ? badge.desc : badge.how}</div>
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
        {quests.map((quest) => {
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
      {savedThreads.map((thread) => (
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
      {savedArticles.map((article) => (
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
