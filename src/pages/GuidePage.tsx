import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta, guideJsonLd } from '../lib/pageMeta';
import { useSanitizedHtml } from '../lib/sanitizeHtml';
import { useT, localeTag, getLocale } from '../lib/i18n';
import { RichContentWithLightbox } from '../components/ui/ImageLightbox';
import { VoteControls } from '../components/guides/GuideWidgets';

const CATEGORY_KEY = {
  walkthrough: 'guides.categoryWalkthrough',
  builds: 'guides.categoryBuilds',
  achievements: 'guides.categoryAchievements',
  tips: 'guides.categoryTips',
  general: 'guides.categoryGeneral',
} as const;

import { Badge, ErrorState, OnlineAvatar, SkeletonRows } from '../components/ui';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { RoleEmblem } from '../components/profile/RoleEmblem';

/**
 * `/games/:gameSlug/guides/:guideSlug` — pojedinačni vodič (2.8.0).
 *
 * SEO: dinamički title/description/canonical + JSON-LD `TechArticle`
 * (`about: VideoGame`) — long-tail organski saobraćaj.
 */
export default function GuidePage() {
  const t = useT();
  const locale = getLocale();
  const { gameSlug = '', guideSlug = '' } = useParams();
  const { user } = useAuthStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guide', gameSlug, guideSlug],
    queryFn: () => api.guides.get(gameSlug, guideSlug),
    enabled: Boolean(gameSlug && guideSlug),
  });

  const guide = data?.guide;
  const safeContent = useSanitizedHtml(guide?.content ?? '');
  const canonicalPath = `/games/${gameSlug}/guides/${guideSlug}`;

  usePageMeta({
    title: guide ? `${guide.title} - ${guide.gameTitle ?? 'Igra'} Vodič | NEXUS` : 'Vodič',
    description: guide
      ? guide.summary ?? guide.title
      : 'Vodič zajednice.',
    path: canonicalPath,
    type: 'article',
    publishedTime: guide?.createdAt,
    jsonLd:
      guide && guide.gameTitle
        ? guideJsonLd({
          headline: guide.title,
          description: guide.summary ?? guide.title,
          url: `${window.location.origin}${canonicalPath}`,
          datePublished: guide.createdAt,
          dateModified: guide.updatedAt,
          author: guide.author,
          gameTitle: guide.gameTitle,
        })
        : undefined,
  });

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-4xl" aria-busy="true">
          <span className="sr-only">{t('guides.loading')}</span>
          <div className="ui-skeleton mb-6 h-4 w-56" />
          <div className="ui-skeleton mb-8 h-40 w-full rounded-lg" />
          <SkeletonRows rows={4} />
        </div>
      </div>
    );
  }

  if (isError || !guide) {
    return (
      <div className="section">
        <div className="container max-w-4xl">
          <ErrorState
            title={t('guides.notFound')}
            message={t('guides.notFoundHint')}
            onRetry={() => void refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="container max-w-4xl">
        {/* Breadcrumb: Početna > Igre > [Igra] > Vodiči > [Naslov] */}
        <nav className="crumbs mb-6" aria-label="Putanja">
          <Link to="/">Početna</Link>
          <span className="sep" aria-hidden="true">/</span>
          <Link to="/games">Igre</Link>
          <span className="sep" aria-hidden="true">/</span>
          <Link to={`/games/${gameSlug}`}>{guide.gameTitle ?? gameSlug}</Link>
          <span className="sep" aria-hidden="true">/</span>
          <Link to={`/games/${gameSlug}#game-guides-heading`}>Vodiči</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="truncate text-white/70">{guide.title}</span>
        </nav>

        <article className="mb-8 rounded-2xl border border-white/[0.08] bg-[var(--color-surface-1)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:p-7">
          <div className="flex gap-3 sm:gap-5">
            <VoteControls guideId={guide.id} score={guide.score} myVote={guide.myVote} />

            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone="primary">{t(CATEGORY_KEY[guide.category])}</Badge>
                {guide.status !== 'published' && <Badge tone="warning">{guide.status}</Badge>}
              </div>

              <h1 className="font-display text-[1.625rem] font-semibold leading-[1.15] tracking-[-0.025em] text-white sm:text-3xl">
                {guide.title}
              </h1>

              {guide.summary && <p className="mt-3 text-sm leading-relaxed text-white/60">{guide.summary}</p>}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/45">
                <span className="inline-flex items-center gap-2">
                  <OnlineAvatar src={guide.authorAvatar ?? undefined} userId={guide.authorId} size="xs" alt="" />
                  <Link to={`/profile/${guide.author}`} className="font-semibold text-white/80 transition hover:text-[var(--color-primary-hover)]">
                    {guide.author}
                  </Link>
                  <RoleEmblem role={guide.authorRole} />
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={12} aria-hidden="true" />
                  {new Date(guide.createdAt).toLocaleDateString(localeTag(locale), { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Eye size={12} aria-hidden="true" />
                  {t('guides.views', { count: guide.viewsCount })}
                </span>
              </div>

              {/* Sadržaj (sanitizovani HTML + Lightbox za slike) */}
              <RichContentWithLightbox
                html={safeContent}
                className="article-rich-content mt-6 break-words text-[15px] leading-[1.7] text-white/80"
              />

              {/* Glasanje i na dnu — čitač koji je prošao ceo vodič glasa tu. */}
              <div className="mt-8 flex items-center gap-4 border-t border-white/[0.07] pt-4">
                <span className="text-xs text-white/45">{t('guides.helpful')}</span>
                <VoteControls guideId={guide.id} score={guide.score} myVote={guide.myVote} size="sm" />
                {user && guide.authorId === user.id && (
                  <Badge tone="neutral" className="!normal-case">
                    {t('guides.yourGuide')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
