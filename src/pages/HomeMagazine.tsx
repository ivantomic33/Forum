import { Link } from 'react-router-dom';
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bookmark, Check, ChevronRight, Clock, Eye, Mail,
  MessageSquare, Send, Sparkles, Tag, Trophy, Zap } from 'lucide-react';
import { api } from '../lib/api';
import type { Article, Deal, Thread } from '../../contracts/index';
import {
  Button, EmptyState, ErrorState, PriceTag, SectionHeader, Skeleton, StoryCard,
  SkeletonThreadRows, ThreadRow, cn,
} from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { useHeroParallax } from '../hooks/useHeroParallax';
/**
 * DEVELOPMENT fallback - prikazuje se SAMO u dev build-u da bi layout
 * bio vidljiv bez baze. U produkciji se prikazuje posten EmptyState.
 */
const devFallbackArticles: Article[] = [
  {
    id: 'dev-1',
    slug: 'dev-sample-article',
    content: '',
    authorId: 'dev',
    tags: [],
    status: 'draft',
    isFeatured: false,
    reactions: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: '[DEV] PlayStation 6 specifikacije: RDNA 5 arhitektura',
    excerpt: 'Primer clanka koji se prikazuje samo u development rezimu.',
    category: 'Playstation',
    coverImage: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=900&q=80',
    author: 'NEXUS Redakcija',
    views: 0,
    publishedAt: new Date().toISOString(),
  },
];

const PAGE_SIZE = 6;

const CATEGORY_TABS = [
  { id: 'all', label: 'Sve vesti' },
  { id: 'Vesti', label: 'Vesti' },
  { id: 'Hardware', label: 'Hardver' },
  { id: 'Najave', label: 'Najave' },
  { id: 'Recenzija', label: 'Recenzije' },
  { id: 'Lista', label: 'Liste' },
];

const readTime = (article: { content?: string } | null | undefined) => `${Math.max(2, Math.ceil((article?.content?.length || 600) / 900))} min`;

  /** Cena kao na deal kartici — mono, tabularni brojevi (talasasta skala U-01). */
const price = (value: number, currency: string) => {
    if (!Number.isFinite(value)) return '—';
  if (value === 0) return 'Besplatno';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Danas';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Danas';
  return date.toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * POČETNA — „Danas u gamingu“ (U-02, U-03, U-04)
 *
 * Portal je podeljen na tri pojasa, svaki sa svojim vizuelnim jezikom:
 *
 *   1. HERO  — 16:9 slika preko celog pojasa, fade u `surface-0`, eyebrow
 *              (kategorija), H1 max 2 reda, jedan primarni CTA „Pročitaj“.
 *   2. TOP PRIČE — tri horizontalne StoryCard (slika levo 40%, tekst desno)
 *              + desno „Najbolji popusti danas“ sa 2 DealCard (cena u mono 28 px).
 *   3. FORUM U FOKUSU — pet ThreadRow (ikona, naslov, meta, avatar + vreme)
 *              + CTA „Pridruži se diskusiji“.
 *
 * Ispod: „Najnovije objave“ kao čitljiva lista sa filter tabovima kategorija.
 */
export default function HomeMagazine() {
  const isDev = import.meta.env?.DEV ?? false;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  // Sina (4.0 "Neon Glass") — parallax samo preko CSS promenljivih na `.hero-band`.
  useHeroParallax();
  const [category, setCategory] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [bookmarked, setBookmarked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('nexus_bookmarks') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterStatus, setNewsletterStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [newsletterMsg, setNewsletterMsg] = useState('');

  // Ticker dolazi sa API-ja (nema hardkodovanih vesti)
  const tickerQuery = useQuery({ queryKey: ['ticker'], queryFn: () => api.articles.ticker() });

  const articlesQuery = useQuery({
    queryKey: ['articles', { category }],
    queryFn: () =>
      api.articles.list({
        limit: 100,
        category: category === 'all' ? undefined : category,
      }),
  });

  const threadsQuery = useQuery({
    queryKey: ['home-threads'],
    queryFn: () => api.forum.listThreads('all', 'hot'),
  });

  // F-1 — „Danas u gamingu“: tri bloka u JEDNOM zahtevu (vesti, popusti, teme).
  // Stari `home-deals` upit ostaje jer sekcija „Najbolji popusti danas“ ima širi
  // kriterijum (4 kartice), a dnevni blok je tajna verzija istog sadržaja.
  const dailyQuery = useQuery({
    queryKey: ['home-daily'],
    queryFn: () => api.deals.daily(),
    staleTime: 3 * 60_000,
  });

  // U-02/U-04 - portal nije samo lista vesti: "Najbolji popusti danas" je
  // sekcija sa drugim vokabularom (cena, %), a ne jos jedna kartica clanka.
  const dealsQuery = useQuery({
    queryKey: ['home-deals'],
    queryFn: () => api.deals.list({ sort: 'discount', limit: 4, offset: 0 }),
    staleTime: 5 * 60_000,
  });

  // N10 - `Article` je tip iz ugovora; dev fallback je namerno parcijalan
  // (`content`/`tags` nisu potrebni na kartici), pa se tip ne forsira u `any`.
  const allArticles = useMemo(() => {
    const list = articlesQuery.data?.articles ?? [];
    if (list.length) return list;
    return isDev ? devFallbackArticles : [];
  }, [articlesQuery.data, isDev]);

  const visibleArticles = allArticles.slice(0, visibleCount);
  const hasMore = visibleCount < allArticles.length;

  const hero = allArticles.find((article) => article.isFeatured) || allArticles[0];
  // Pojas 2 (Top priče): 3 najnovije vesti osim hero-a, slika levo / tekst desno.
  const topStories = allArticles.filter((article) => article !== hero).slice(0, 3);
  const heroOthers = visibleArticles.filter((article) => article !== hero);
  const topRead = useMemo(
    () => [...allArticles].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5),
    [allArticles],
  );

  const toggleBookmark = useCallback((id: string) => {
    setBookmarked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('nexus_bookmarks', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const submitNewsletter = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newsletterEmail) return;
    setNewsletterStatus('loading');
    try {
      const response = await api.newsletter.subscribe(newsletterEmail);
      setNewsletterStatus('success');
      setNewsletterMsg(response.message);
      setNewsletterEmail('');
    } catch (error: any) {
      setNewsletterStatus('error');
      setNewsletterMsg(error.message || 'Pretplata trenutno nije uspela.');
    }
  };

  const tickerItems = tickerQuery.data?.items ?? [];
  const daily = dailyQuery.data;
  // Hero je već gore – iste vesti se ne ponavljaju u blokovima ispod.
  const dailyArticles = (daily?.articles ?? []).filter((article) => article.id !== hero?.id).slice(0, 2);
  const dailyDeals: Deal[] = (daily?.deals ?? []).filter((deal) => deal.status === 'active').slice(0, 2);
  const dailyThreads = (daily?.threads ?? []).slice(0, 2);
  const threads = (threadsQuery.data?.threads ?? []).slice(0, 5);
  const topDeals: Deal[] = (dealsQuery.data?.deals ?? [])
    .filter((deal) => deal.status === 'active')
    .slice(0, 2);
  // Pojasi 2 i 3: top-priče su one koje nisu hero niti red u "Najnovije" listi.
  const latestStories = hero
    ? visibleArticles.filter((article) => article !== hero && !topStories.includes(article))
    : visibleArticles;
  // Relativno vreme poslednje aktivnosti (red teme).
  const relativeTime = (value?: string | null) => {
    if (!value) return undefined;
    const diffMs = Date.now() - new Date(value).getTime();
    if (Number.isNaN(diffMs)) return undefined;
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    if (minutes < 60) return `pre ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `pre ${hours} h`;
    return `pre ${Math.round(hours / 24)} d`;
  };

  return (
    <div className="pb-16">
      <div className="container pb-4">
        {/* U-03 - ticker (jedini status u gornjoj traci): mirna podloga, jedna
            tacka boje, tekst na 13 px. */}
        {tickerItems.length > 0 && (
          <div className="mb-6 mt-4 flex items-center gap-3 overflow-hidden rounded-lg border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-1.5 pl-2 pr-3">
            <span className="flex flex-shrink-0 items-center gap-1.5 text-eyebrow text-[var(--color-primary-fg)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary-fg)]" aria-hidden="true" />
              Vrele teme
            </span>
            <div className="ticker-wrap min-w-0 flex-1 overflow-hidden">
              <div className="ticker-track flex items-center gap-8 whitespace-nowrap text-meta" role="marquee" aria-label="Najnovije vesti">
                {tickerItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.href}
                    className="flex items-center gap-2 transition hover:text-[var(--color-text-primary)]"
                  >
                    <span className="text-[var(--color-text-muted)]" aria-hidden="true">—</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {articlesQuery.isError && !articlesQuery.data ? (
          <ErrorState
            title="Vesti trenutno nisu dostupne"
            message="Proveri internet konekciju ili pokušaj ponovo za koji trenutak."
            onRetry={() => articlesQuery.refetch()}
            className="mt-6"
          />
        ) : articlesQuery.isLoading ? (
          /* Skelet prati finalni layout: hero 16:9 + 3 kartice + 4 reda (CLS < 0,05) */
          <div className="mt-6 space-y-10" aria-busy="true">
            <Skeleton className="aspect-[16/9] max-h-[70vh] w-full rounded-xl" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <div className="grid gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <Skeleton key={item} className="h-[7.25rem] rounded-lg" />
                ))}
              </div>
            </div>
            <SkeletonThreadRows rows={4} />
          </div>
        ) : allArticles.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<Sparkles size={22} />}
            title="Još nema objavljenih vesti"
            message="Redakcija još nije objavila nijedan članak. Pogledaj aktivne diskusije na forumu dok ne stigne prva vest."
            action={
              <Link to="/forum" className="ui-btn br-primary ui-btn-md">
                Otvori forum
              </Link>
            }
          />
        ) : (
          <>
            {/* ─────────── POJAS 1 — HERO (slika preko celog pojasa, H1 max 2 reda) ─────────── */}
            {hero && (
              <StoryCard
                variant="hero"
                to={`/article/${hero.slug || hero.id}`}
                title={hero.title}
                image={hero.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&q=80'}
                imageAlt={hero.title}
                eyebrow={hero.category || 'Glavna priča'}
                excerpt={hero.excerpt}
                overlay={
                  <button
                    type="button"
                    onClick={() => toggleBookmark(hero.id)}
                    aria-label={bookmarked.has(hero.id) ? 'Ukloni clanak iz sacuvanih' : 'Sacuvaj clanak'}
                    aria-pressed={bookmarked.has(hero.id)}
                    className="ui-icon-btn"
                  >
                    <Bookmark size={15} fill={bookmarked.has(hero.id) ? 'currentColor' : 'none'} />
                  </button>
                }
                meta={
                  <div className="hero-band-actions">
                    <span className="meta-row">
                      <span className="flex items-center gap-1.5">
                        <Clock size={14} aria-hidden="true" /> {readTime(hero)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Eye size={14} aria-hidden="true" /> {(hero.views || 0).toLocaleString('sr-Latn-RS')}
                      </span>
                      <span className="dot" aria-hidden="true">—</span>
                      <span>{formatDate(hero.publishedAt || hero.createdAt)}</span>
                      <span className="dot" aria-hidden="true">—</span>
                      <span>{hero.author || 'NEXUS Redakcija'}</span>
                    </span>
                    <Link to={`/article/${hero.slug || hero.id}`} className="ui-btn br-primary ui-btn-md">
                      Pročitaj
                      <ChevronRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                }
              />
            )}

            {/* ─────────── POJAS 2 — TOP PRIČE (3 kolone) + NAJBOLJI POPUSTI DANAS ─────────── */}
            <div className="home-grid">
              <div className="min-w-0">
                <section aria-labelledby="top-stories-title">
                  <SectionHeader eyebrow="Magazin" title="Top price" id="top-stories-title" accent="var(--color-primary)" />
                  {topStories.length === 0 ? (
                    <EmptyState
                      className="mt-5"
                      icon={<Sparkles size={20} />}
                      title="Nema više vesti u ovoj kategoriji"
                      message="Izaberi drugu kategoriju ili pogledaj sve vesti."
                    />
                  ) : (
                    /* StoryCard `card` = horizontalna: slika levo 40%, tekst desno */
                    <div className="mt-5 grid gap-3 xl:grid-cols-3">
                      {topStories.map((article) => (
                        <StoryCard
                          key={article.id}
                          variant="card"
                          to={`/article/${article.slug || article.id}`}
                          title={article.title}
                          image={article.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900&q=80'}
                          eyebrow={article.category}
                          meta={
                            <span className="meta-row">
                              <span>{formatDate(article.publishedAt || article.createdAt)}</span>
                              <span className="dot" aria-hidden="true">—</span>
                              <span>{readTime(article)}</span>
                            </span>
                          }
                        />
                      ))}
                    </div>
                  )}
                </section>

            {/* ─────────── POJAS 3 — FORUM U FOKUSU (5 ThreadRow + CTA) ─────────── */}
                <section className="mt-12 border-t border-[var(--color-border-subtle)] pt-10 zone-community" aria-labelledby="discussions-title">
                  <SectionHeader
                    eyebrow="Zajednica"
                    title="Forum u fokusu"
                    id="discussions-title"
                    accent="var(--color-community)"
                    moreHref="/forum"
                    moreLabel="Ceo forum"
                  />

                  {threadsQuery.isLoading ? (
                    <div className="mt-3">
                      <SkeletonThreadRows rows={5} />
                    </div>
                  ) : threads.length === 0 ? (
                    <EmptyState
                      className="mt-5"
                      icon={<MessageSquare size={20} />}
                      title="Forum još nema tema"
                      message="Budi prvi koji će otvoriti diskusiju o igrama, hardveru ili eSportu."
                      action={
                        <Link to="/forum?compose=1" className="ui-btn br-primary ui-btn-sm">
                          Otvori temu
                        </Link>
                      }
                    />
                  ) : (
                    <>
                      <div className="mt-3">
                        {threads.map((thread) => (
                          <ThreadRow
                            key={thread.id}
                            to={`/thread/${thread.id}`}
                            title={thread.title}
                            categoryLabel={thread.subforum}
                            categoryIcon={<MessageSquare size={16} aria-hidden="true" />}
                            replies={thread.replies || 0}
                            votes={thread.karma || 0}
                            author={thread.author}
                            time={relativeTime(thread.createdAt)}
                            lastAvatar={
                              <img
                                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(thread.author || 'user')}`}
                                alt=""
                                width={28}
                                height={28}
                                loading="lazy"
                                className="h-7 w-7 rounded-full border-[var(--color-border-subtle)]"
                              />
                            }
                            lastTime={relativeTime(thread.createdAt)}
                          />
                        ))}
                      </div>
                      <div className="mt-6 flex-wrap items-center gap-4">
                        <Link to="/forum" className="ui-btn br-primary ui-btn-md">
                          Pridruži se diskusiji
                        </Link>
                        <span className="meta-row">
                          <Trophy size={14} aria-hidden="true" />
                          XP se skuplja za teme, odgovore i glasove zajednice.
                        </span>
                      </div>
                    </>
                  )}
                </section>
              </div>

              {/* Desna kolona – 2 DealCard (cena je hero) + podsetnik za svakodnevni pregled */}
              <aside className="home-rail" aria-labelledby="deals-title">
                <section>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <h2 id="deals-title" className="section-title section-title-tight deals-heading">
                      Najbolji popusti danas
                    </h2>
                    <Link to="/deals" className="section-link">
                      Svi
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                  {topDeals.length === 0 ? (
                    <p className="text-meta">Trenutno nema aktivnih popusta.</p>
                  ) : (
                    <div className="grid gap-3">
                      {topDeals.map((deal) => {
                        const hoursLeft = deal.expiresAt
                          ? Math.round((new Date(deal.expiresAt).getTime() - Date.now()) / 3_600_000)
                          : null;
                        const urgent = hoursLeft !== null && hoursLeft >= 0 && hoursLeft <= 24;
                        return (
                          <Link
                            key={deal.id}
                            to={`/deals/${deal.id}`}
                            className={cn('deal-card group', urgent && 'is-urgent')}
                          >
                            <div className="flex items-start gap-3">
                              <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-md bg-[var(--color-surface-2)]">
                                {deal.gameCover ? (
                                  <img src={deal.gameCover} alt="" loading="lazy" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-[var(--color-text-tertiary)]">
                                    <Tag size={18} aria-hidden="true" />
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-micro text-[var(--color-text-tertiary)]">{deal.store}</span>
                                <span className="deal-card-title mt-0.5">{deal.title}</span>
                              </div>
                            </div>
                            <PriceTag
                              price={deal.price}
                              originalPrice={deal.originalPrice}
                              currency={deal.currency}
                              discountPct={deal.discountPct}
                              expiresAt={deal.expiresAt}
                            />
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </section>

                <div className="primary-action-panel no-print">
                  <p className="eyebrow">NEXUS zajednica</p>
                  <p className="mt-2 text-h3 text-[var(--color-text-primary)]">
                    {isAuthenticated ? 'Nastavi tamo gde si stao' : 'Pridruži se diskusiji'}
                  </p>
                  <p className="text-body mt-1.5">
                    {isAuthenticated
                      ? 'Otvori temu, podeli popust ili odgovori na pitanje zajednice.'
                      : 'Registracija traje 30 sekundi — XP, bedževi i rang od prve objave.'}
                  </p>
                  <div className="mt-4 flex-wrap gap-2">
                    <Link to={isAuthenticated ? '/notifications' : '/register'} className="ui-btn br-primary ui-btn-md">
                      {isAuthenticated ? 'Tvoj feed' : 'Registruj se'}
                    </Link>
                    <Link to="/forum" className="ui-btn br-ghost ui-btn-md">
                      Forum
                    </Link>
                  </div>
                </div>
              </aside>
            </div>

            {/* ─────────── NAJNOVIJE OBJAVE (lista u magazinskom ritmu) ─────────── */}
            <section className="mt-12 border-t border-[var(--color-border-subtle)] pt-10" aria-labelledby="latest-title">
              <div className="section-head mb-6" style={{ ['--section-accent' as string]: 'var(--color-primary)' }}>
                <div className="section-head-main">
                  <span className="eyebrow">Magazin</span>
                  <h2 id="latest-title" className="section-title">Najnovije objave</h2>
                </div>
                <div className="ui-tabs" role="tablist" aria-label="Kategorije vesti">
                  {CATEGORY_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={category === tab.id}
                      onClick={() => {
                        setCategory(tab.id);
                        setVisibleCount(PAGE_SIZE);
                      }}
                      className={cn('ui-tab', category === tab.id && 'is-active')}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {latestStories.length === 0 ? (
                <EmptyState
                  icon={<Sparkles size={20} />}
                  title="Nema više vesti u ovoj kategoriji"
                  message="Izaberi drugu kategoriju ili pogledaj sve vesti."
                />
              ) : (
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {latestStories.map((article) => (
                    <article key={article.id} className="group flex-col">
                      <StoryCard
                        variant="card"
                        to={`/article/${article.slug || article.id}`}
                        title={article.title}
                        image={article.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900&q=80'}
                        eyebrow={article.category}
                        meta={
                          <span className="meta-row">
                            <span>{formatDate(article.publishedAt || article.createdAt)}</span>
                            <span className="dot" aria-hidden="true">—</span>
                            <span>{readTime(article)}</span>
                          </span>
                        }
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => toggleBookmark(article.id)}
                          aria-label={bookmarked.has(article.id) ? 'Ukloni clanak iz sacuvanih' : 'Sacuvaj clanak'}
                          aria-pressed={bookmarked.has(article.id)}
                          className="ui-icon-btn !h-9 !w-9"
                        >
                          <Bookmark size={13} fill={bookmarked.has(article.id) ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {hasMore && (
                <div className="pt-8 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                    rightIcon={<ChevronRight size={15} />}
                  >
                    Prikaži još vesti ({allArticles.length - visibleCount})
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
