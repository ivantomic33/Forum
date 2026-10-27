import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, Eye, Pencil, Plus, User } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useT, localeTag, getLocale } from '../../lib/i18n';
import type { Guide } from '../../../contracts/index';
import { Button, EmptyState, Modal } from '../ui';

/**
 * 2.8.0 — VODIČI (UI delovi)
 * --------------------------
 *  - `VoteControls` — strelice up/down + skor; optimistički update sa rollback-om
 *    (isti obrazac kao `handleThreadVote` u ThreadPage).
 *  - `GuideCard` — kartica vodiča za listu na Game Page-u.
 *  - `CreateGuideModal` — forma za novi vodič (naslov, summary, kategorija,
 *    sadržaj). Sadržaj je običan textarea; server sanitizuje (isti mehanizam
 *    kao teme/članci).
 *  - `GuidesSection` — sekcija na Game Page-u (filteri + lista + CTA).
 */

const CATEGORY_KEY: Record<Guide['category'], Parameters<ReturnType<typeof useT>>[0]> = {
  walkthrough: 'guides.categoryWalkthrough',
  builds: 'guides.categoryBuilds',
  achievements: 'guides.categoryAchievements',
  tips: 'guides.categoryTips',
  general: 'guides.categoryGeneral',
};

export function GuideCard({ guide }: { guide: Guide }) {
  const t = useT();
  const locale = getLocale();
  return (
    <Link
      to={`/games/${guide.gameSlug}/guides/${guide.slug}`}
      className="block rounded-2xl border border-white/[0.08] bg-[var(--color-surface-1)] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] sm:p-5"
    >
      <div className="flex items-start gap-4">
        <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-surface-2/60 py-2">
          <ArrowUp size={14} className={guide.myVote === 'up' ? 'text-cyan-400' : 'text-white/35'} aria-hidden="true" />
          <span className="font-mono text-sm font-semibold text-white">{guide.score}</span>
          <ArrowDown size={14} className={guide.myVote === 'down' ? 'text-rose-400' : 'text-white/35'} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-cyan-200">
              {t(CATEGORY_KEY[guide.category])}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
              <Eye size={11} aria-hidden="true" /> {t('guides.views', { count: guide.viewsCount })}
            </span>
          </div>
          <h3 className="truncate font-display text-base font-semibold text-white transition group-hover:text-[var(--color-primary-hover)]">
            {guide.title}
          </h3>
          {guide.summary && <p className="mt-1 line-clamp-2 text-sm text-white/55">{guide.summary}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="inline-flex items-center gap-1.5">
              {guide.authorAvatar ? (
                <img src={guide.authorAvatar} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <User size={12} aria-hidden="true" />
              )}
              {guide.author}
            </span>
            <span>·</span>
            <span>{new Date(guide.createdAt).toLocaleDateString(localeTag(locale))}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function VoteControls({
  guideId,
  score,
  myVote,
  onVoted,
  size = 'md',
}: {
  guideId: string;
  score: number;
  myVote: 'up' | 'down' | null;
  onVoted?: (result: { score: number; myVote: 'up' | 'down' | null }) => void;
  size?: 'sm' | 'md';
}) {
  const t = useT();
  const { isAuthenticated } = useAuthStore();
  const [optimistic, setOptimistic] = useState<{ score: number; myVote: 'up' | 'down' | null } | null>(null);
  const [pending, setPending] = useState(false);

  const current = optimistic ?? { score, myVote };

  const vote = async (direction: 'up' | 'down') => {
    if (!isAuthenticated) {
      toast.error(t('auth.loginRequiredVote'));
      return;
    }
    if (pending) return;
    const next = current.myVote === direction ? null : direction;
    // Optimistički update; rollback na grešci.
    const previous = current;
    setOptimistic({ score: previous.score + (next === 'up' ? 1 : next === 'down' ? -1 : 0), myVote: next });
    setPending(true);
    try {
      const result = await api.guides.vote(guideId, next);
      setOptimistic({ score: result.score, myVote: result.myVote });
      onVoted?.({ score: result.score, myVote: result.myVote });
    } catch (error: any) {
      setOptimistic(previous);
      toast.error(error?.message || t('common.error'));
    } finally {
      setPending(false);
    }
  };

  const btn = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const icon = size === 'sm' ? 14 : 16;

  return (
    <div className="vote-box h-fit flex-shrink-0">
      <button
        type="button"
        onClick={() => void vote('up')}
        className={`vote-btn ${btn} ${current.myVote === 'up' ? 'is-up' : ''}`}
        aria-pressed={current.myVote === 'up'}
        aria-label={t('guides.voteUp')}
        disabled={pending}
      >
        <ArrowUp size={icon} />
      </button>
      <span className={`vote-count ${current.myVote === 'up' ? '!text-cyan-400' : current.myVote === 'down' ? '!text-rose-400' : ''}`}>
        {current.score}
      </span>
      <button
        type="button"
        onClick={() => void vote('down')}
        className={`vote-btn ${btn} ${current.myVote === 'down' ? 'is-down' : ''}`}
        aria-pressed={current.myVote === 'down'}
        aria-label={t('guides.voteDown')}
        disabled={pending}
      >
        <ArrowDown size={icon} />
      </button>
    </div>
  );
}

export function CreateGuideModal({
  open,
  gameSlug,
  gameTitle,
  onClose,
  onCreated,
}: {
  open: boolean;
  gameSlug: string;
  gameTitle: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Guide['category']>('general');
  const [saving, setSaving] = useState(false);

  const valid = title.trim().length >= 10 && content.trim().length >= 200;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const result = await api.guides.create(gameSlug, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        content: content.trim(),
        category,
      });
      toast.success(t('guides.published'));
      setTitle('');
      setSummary('');
      setContent('');
      onClose();
      onCreated();
      if (result.guide) {
        window.location.hash = '';
      }
    } catch (error: any) {
      toast.error(error?.message || t('guides.publishFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('guides.newTitle', { game: gameTitle })} description={t('guides.share')} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="guide-title" className="mb-1 block text-sm font-semibold text-white/85">
            {t('guides.titleLabel')}
          </label>
          <input
            id="guide-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            required
            placeholder={t('guides.titlePlaceholder')}
            className="ui-field"
          />
        </div>
        <div>
          <label htmlFor="guide-category" className="mb-1 block text-sm font-semibold text-white/85">
            {t('guides.categoryLabel')}
          </label>
          <select id="guide-category" value={category} onChange={(e) => setCategory(e.target.value as Guide['category'])} className="ui-field">
            {(Object.keys(CATEGORY_KEY) as Array<Guide['category']>).map((value) => (
              <option key={value} value={value}>
                {t(CATEGORY_KEY[value])}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="guide-summary" className="mb-1 block text-sm font-semibold text-white/85">
            {t('guides.summaryLabel')}
          </label>
          <input
            id="guide-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={300}
            className="ui-field"
          />
        </div>
        <div>
          <label htmlFor="guide-content" className="mb-1 block text-sm font-semibold text-white/85">
            {t('guides.contentLabel')}
          </label>
          <textarea
            id="guide-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            required
            placeholder={t('guides.contentPlaceholder')}
            className="ui-field resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" type="submit" loading={saving} disabled={!valid}>
            <Plus size={14} /> {t('guides.publishCta')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Sekcija „Vodiči“ na Game Page-u: filteri + lista + dugme „Napiši vodič“. */
export function GuidesSection({ gameSlug, gameTitle }: { gameSlug: string; gameTitle: string }) {
  const t = useT();
  const { isAuthenticated } = useAuthStore();
  const [category, setCategory] = useState<string>('');
  const [sort, setSort] = useState<'top' | 'newest'>('top');
  const [createOpen, setCreateOpen] = useState(false);

  const guidesQuery = useGuideList(gameSlug, category, sort);

  return (
    <section aria-labelledby="game-guides-heading">
      <div className="section-head mb-4">
        <div className="section-head-main">
          <span className="eyebrow">{t('nav.community')}</span>
          <h2 id="game-guides-heading" className="section-title">
            {t('guides.sectionTitle')}{' '}
            <span className="font-mono text-sm font-normal tabular-nums text-[var(--color-text-tertiary)]">
              {guidesQuery.data?.total ?? 0}
            </span>
          </h2>
        </div>
        {isAuthenticated && (
          <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Pencil size={14} />}>
            {t('guides.writeCta')}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="ui-input max-w-[190px]"
          aria-label={t('guides.categoryLabel')}
        >
          <option value="">{t('guides.allCategories')}</option>
          {(Object.keys(CATEGORY_KEY) as Array<Guide['category']>).map((value) => (
            <option key={value} value={value}>
              {t(CATEGORY_KEY[value])}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSort('top')}
          className={`ui-btn ui-btn-sm ${sort === 'top' ? 'br-primary' : 'br-ghost'}`}
          aria-pressed={sort === 'top'}
        >
          {t('guides.sortTop')}
        </button>
        <button
          type="button"
          onClick={() => setSort('newest')}
          className={`ui-btn ui-btn-sm ${sort === 'newest' ? 'br-primary' : 'br-ghost'}`}
          aria-pressed={sort === 'newest'}
        >
          {t('guides.sortNewest')}
        </button>
      </div>

      {guidesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="ui-skeleton h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : guidesQuery.isError ? (
        <p className="text-sm text-rose-300">{t('common.error')}</p>
      ) : (guidesQuery.data?.guides.length ?? 0) === 0 ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title={t('guides.empty')}
          message={t('guides.emptyHint')}
          action={
            isAuthenticated ? (
              <Button size="sm" onClick={() => setCreateOpen(true)} leftIcon={<Pencil size={14} />}>
                {t('guides.writeCta')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3">
          {guidesQuery.data!.guides.map((guide) => (
            <GuideCard key={guide.id} guide={guide} />
          ))}
        </div>
      )}

      <CreateGuideModal
        open={createOpen}
        gameSlug={gameSlug}
        gameTitle={gameTitle}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void guidesQuery.refetch()}
      />
    </section>
  );
}

// Helper za listu (useQuery u istom fajlu — bez cirkularnih importova).
function useGuideList(gameSlug: string, category: string, sort: 'top' | 'newest') {
  return useQuery({
    queryKey: ['game-guides', gameSlug, category, sort],
    queryFn: () =>
      api.guides.listForGame(gameSlug, {
        category: category || undefined,
        sort,
        limit: 24,
      }),
    enabled: Boolean(gameSlug),
  });
}
