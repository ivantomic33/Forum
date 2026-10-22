import { Link } from 'react-router-dom';
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bookmark, Check, ChevronRight, Clock, Eye, Flame, Gamepad2, Mail,
  MessageSquare, Send, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonCard,
  categoryTone, cn,
} from '../components/ui';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';

/**
 * DEVELOPMENT fallback � prikazuje se SAMO u dev build-u da bi layout
 * bio vidljiv bez baze. U produkciji se prikazuje po�ten EmptyState.
 */
const devFallbackArticles = [
  {
    id: 'dev-1',
    slug: 'dev-sample-article',
    title: '[DEV] PlayStation 6 specifikacije: RDNA 5 arhitektura',
    excerpt: 'Primer clanka koji se prikazuje samo u development re�imu.',
    category: 'Playstation',
    coverImage: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=900&q=80',
    author: 'NEXUS Redakcija',
    views: 0,
    publishedAt: new Date().toISOString(),
    readTime: '2 min',
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

const readTime = (article: any) => `${Math.max(2, Math.ceil((article?.content?.length || 600) / 900))} min`;

const formatDate = (value?: string | null) => {
  if (!value) return 'Danas';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Danas';
  return date.toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function HomeMagazine() {
  const isDev = import.meta.env?.DEV ?? false;
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

  const allArticles: any[] = useMemo(() => {
    const list = articlesQuery.data?.articles ?? [];
    if (list.length) return list;
    return isDev ? devFallbackArticles : [];
  }, [articlesQuery.data, isDev]);

  const visibleArticles = allArticles.slice(0, visibleCount);
  const hasMore = visibleCount < allArticles.length;

  const hero = allArticles.find((article) => article.isFeatured) || allArticles[0];
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
  const threads = (threadsQuery.data?.threads ?? []).slice(0, 4);

  return (
    <div className="pb-16">
      <div className="container">
        {/* Breaking news ticker — realni naslovi sa API-ja */}
        {tickerItems.length > 0 && (
          <div className="mt-4 mb-8 flex items-center gap-3 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0D101D]/80 py-1.5 pl-1.5 pr-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md">
            <span className="nx-hot-pulse relative flex flex-shrink-0 items-center gap-1.5 rounded-full border border-rose-500/40 bg-gradient-to-r from-rose-500/20 to-violet-500/20 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-rose-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" aria-hidden="true" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" aria-hidden="true" />
              </span>
              Vrele teme
            </span>
            <div className="ticker-wrap flex-1 overflow-hidden">
              <div className="ticker-track flex items-center gap-8 whitespace-nowrap text-[13px] text-slate-400" role="marquee" aria-label="Najnovije vesti">
                {[...tickerItems, ...tickerItems].map((item, index) => (
                  <Link
                    key={`${item.id}-${index}`}
                    to={item.href}
                    tabIndex={index < tickerItems.length ? 0 : -1}
                    aria-hidden={index >= tickerItems.length}
                    className="flex items-center gap-2 transition hover:text-white"
                  >
                    <span className="text-cyan-400/80" aria-hidden="true">—</span>
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
          <div className="mt-6 space-y-8" aria-busy="true">
            <div className="grid gap-7 lg:grid-cols-12">
              <Skeleton className="aspect-[16/10] rounded-xl lg:col-span-6" />
              <div className="space-y-4 lg:col-span-6">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-4/5" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <SkeletonCard key={item} />
              ))}
            </div>
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
            {/* Featured story — lead članak dominira stranicom */}
            {hero && (
              <section
                className="group relative mb-12 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0D101D]/80 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md transition-all duration-300 lg:mb-16 hover:shadow-[0_18px_50px_-12px_rgba(124,58,237,0.45)]"
                aria-labelledby="featured-title"
              >
                <div className="grid grid-cols-1 items-stretch lg:grid-cols-12">
                  <div className="relative aspect-[16/10] overflow-hidden border-b border-white/[0.07] bg-surface-0 lg:col-span-7 lg:aspect-auto lg:min-h-[400px] lg:border-b-0 lg:border-r">
                    <img
                      src={hero.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&q=80'}
                      alt={hero.title}
                      width={800}
                      height={500}
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#06070E] via-[#06070E]/60 to-transparent" aria-hidden="true" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#06070E]/90 via-transparent to-transparent lg:hidden" aria-hidden="true" />
                    <div className="absolute left-4 top-4 flex items-center gap-2">
                      <Badge tone="featured" className="nx-featured-pulse">
                        <Sparkles size={11} /> Featured
                      </Badge>
                      <Badge tone={categoryTone(hero.category)}>{hero.category}</Badge>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBookmark(hero.id)}
                      aria-label={bookmarked.has(hero.id) ? 'Ukloni članak iz sačuvanih' : 'Sačuvaj članak'}
                      aria-pressed={bookmarked.has(hero.id)}
                      className="ui-icon-btn absolute right-4 top-4 !bg-[#06070E]/80 backdrop-blur-md"
                    >
                      <Bookmark size={15} fill={bookmarked.has(hero.id) ? 'currentColor' : 'none'} />
                    </button>
                  </div>

                  <div className="flex flex-col justify-center p-5 sm:p-7 lg:col-span-5 lg:p-9">
                    <span className="eyebrow mb-4">U fokusu</span>
                    <Link to={`/article/${hero.slug || hero.id}`} className="group">
                      <h1
                        id="featured-title"
                        className="mb-4 font-display text-2xl font-semibold leading-[1.12] tracking-[-0.03em] text-white transition-colors group-hover:text-violet-300 sm:text-[1.75rem] lg:text-[2.125rem]"
                      >
                        {hero.title}
                      </h1>
                    </Link>
                    <p className="mb-6 line-clamp-3 text-[15px] leading-relaxed text-white/60">{hero.excerpt}</p>

                    <div className="meta-row mb-6">
                      <span>{formatDate(hero.publishedAt || hero.createdAt)}</span>
                      <span className="flex items-center gap-1.5">
                        <Clock size={13} aria-hidden="true" /> {readTime(hero)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Eye size={13} aria-hidden="true" /> {(hero.views || 0).toLocaleString('sr-Latn-RS')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-4 border-t border-white/[0.07] pt-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <img
                          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(hero.author || 'nexus')}`}
                          alt=""
                          width={38}
                          height={38}
                          className="h-[38px] w-[38px] rounded-full border border-violet-500/40 bg-surface-0 shadow-[0_0_15px_-4px_rgba(124,58,237,0.8)]"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{hero.author || 'NEXUS Redakcija'}</div>
                          <div className="text-xs text-white/45">Gaming redakcija</div>
                        </div>
                      </div>
                      <Link to={`/article/${hero.slug || hero.id}`} className="ui-btn br-primary ui-btn-sm">
                        Pročitaj
                        <ChevronRight size={15} />
                      </Link>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Heading + category tabs */}
            <div className="section-head mb-6 md:mt-2">
              <div className="section-head-main">
                <span className="eyebrow">Magazin</span>
                <h2 className="section-title">Najnovije objave</h2>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Vesti sortirane hronološki po datumu objave</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Kategorije vesti">
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

            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12">
              <div className="lg:col-span-8">
                {heroOthers.length === 0 ? (
                  <EmptyState
                    icon={<Sparkles size={20} />}
                    title="Nema više vesti u ovoj kategoriji"
                    message="Izaberi drugu kategoriju ili pogledaj sve vesti."
                  />
                ) : (
                  <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {heroOthers.map((article) => (
                      <Card key={article.id} flush interactive className="group flex flex-col overflow-hidden">
                        <div className="relative aspect-[16/10] overflow-hidden bg-surface-0">
                          <img
                            src={article.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900&q=80'}
                            alt={article.title}
                            width={600}
                            height={375}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#0D101D] via-transparent to-transparent" aria-hidden="true" />
                          <div className="absolute left-3 top-3">
                            <Badge tone={categoryTone(article.category)}>{article.category}</Badge>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleBookmark(article.id)}
                            aria-label={bookmarked.has(article.id) ? 'Ukloni članak iz sačuvanih' : 'Sačuvaj članak'}
                            aria-pressed={bookmarked.has(article.id)}
                            className="ui-icon-btn absolute right-3 top-3 !h-8 !w-8 !bg-[#06070E]/80 backdrop-blur-md"
                          >
                            <Bookmark size={13} fill={bookmarked.has(article.id) ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        <div className="flex flex-1 flex-col justify-between p-4">
                          <div>
                            <div className="meta-row mb-2.5">
                              <span>{formatDate(article.publishedAt || article.createdAt)}</span>
                              <span>{readTime(article)}</span>
                              <span className="flex items-center gap-1">
                                <Eye size={12} aria-hidden="true" /> {(article.views || 0).toLocaleString('sr-Latn-RS')}
                              </span>
                            </div>
                            <Link to={`/article/${article.slug || article.id}`}>
                              <h3 className="card-title-link mb-2 line-clamp-2 font-display text-[15px] font-semibold leading-snug">
                                {article.title}
                              </h3>
                            </Link>
                            <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-white/55">{article.excerpt}</p>
                          </div>
                          <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs">
                            <span className="text-white/50">{article.author || 'NEXUS Redakcija'}</span>
                            <Link
                              to={`/article/${article.slug || article.id}`}
                              className="flex items-center gap-1 font-medium text-cyan-400 transition hover:gap-1.5 hover:text-cyan-300 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.7)]"
                            >
                              Pročitaj <ChevronRight size={13} />
                            </Link>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Prava paginacija — učitava sledeću stranu, ne duplira iste članke */}
                {hasMore && (
                  <div className="pt-2 text-center">
                    <Button
                      variant="secondary"
                      onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                      rightIcon={<ChevronRight size={15} />}
                    >
                      Prikaži još vesti ({allArticles.length - visibleCount})
                    </Button>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <aside className="space-y-6 lg:col-span-4 lg:sticky lg:top-24">
                <Card variant="static">
                  <CardHeader
                    title="Najčitanije"
                    icon={<Flame size={15} className="text-cyan-400" aria-hidden="true" />}
                    action={<Badge tone="neutral">Top 5</Badge>}
                  />
                  {topRead.length === 0 ? (
                    <p className="text-sm text-white/55">Nema dovoljno podataka za listu.</p>
                  ) : (
                    <ol className="divide-y divide-white/[0.05]">
                      {topRead.map((article, index) => (
                        <li key={article.id}>
                          <Link
                            to={`/article/${article.slug || article.id}`}
                            className="group flex items-start gap-3.5 py-3 first:pt-0 last:pb-0"
                          >
                            <span className="w-7 flex-shrink-0 bg-gradient-to-b from-cyan-400 to-violet-600 bg-clip-text pt-0.5 font-mono text-lg font-bold leading-none text-transparent drop-shadow-[0_0_8px_rgba(6,182,212,0.25)] transition group-hover:drop-shadow-[0_0_12px_rgba(6,182,212,0.7)]">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
                                {article.category}
                              </span>
                              <h4 className="card-title-link line-clamp-2 text-[13px] font-medium leading-snug">
                                {article.title}
                              </h4>
                              <span className="mt-1 block font-mono text-[11px] text-white/35">
                                {(article.views || 0).toLocaleString('sr-Latn-RS')} pregleda
                              </span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                <Card variant="static" className="relative overflow-hidden !border-white/[0.1]">
                  <div
                    className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent"
                    aria-hidden="true"
                  />
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 shadow-[0_0_16px_-6px_rgba(124,58,237,0.9)]">
                      <Mail size={14} className="text-cyan-400" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-[15px] font-semibold text-white">NEXUS Newsletter</h3>
                  </div>
                  <p className="mb-4 text-[13px] leading-relaxed text-white/55">
                    Svake nedelje gejming najave, recenzije i popusti na Steamu direktno u inbox.
                  </p>
                  {newsletterStatus === 'success' ? (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300" role="status">
                      <Check size={14} />
                      <span>{newsletterMsg}</span>
                    </div>
                  ) : (
                    <form onSubmit={submitNewsletter} className="space-y-2.5">
                      <label htmlFor="newsletter-email" className="sr-only">
                        Email adresa
                      </label>
                      <input
                        id="newsletter-email"
                        type="email"
                        value={newsletterEmail}
                        onChange={(event) => setNewsletterEmail(event.target.value)}
                        placeholder="unesite vaš email…"
                        required
                        className="ui-field"
                      />
                      {newsletterStatus === 'error' && (
                        <div className="text-xs text-rose-400" role="alert">
                          {newsletterMsg}
                        </div>
                      )}
                      <Button type="submit" block size="sm" loading={newsletterStatus === 'loading'} leftIcon={<Send size={13} />}>
                        Pretplati se
                      </Button>
                      <div className="text-center font-mono text-[11px] text-white/35">Bez spama • Odjava u svakom trenutku</div>
                    </form>
                  )}
                </Card>

                <Card variant="static" className="forge-topline">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10">
                      <Gamepad2 size={15} className="text-cyan-300" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-[15px] font-semibold text-white">Baza igara</h3>
                    <span className="ml-auto rounded-full border border-cyan-500/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300">Beta</span>
                  </div>
                  <p className="mb-4 text-[13px] leading-relaxed text-white/55">Pridruži se zajednici: diskusije, modovi, ocene i preporuke.</p>
                  <Link to="/forum" className="ui-btn br-secondary ui-btn-sm w-full">
                    Pridruži se
                  </Link>
                </Card>
              </aside>
            </div>

            {/* Aktivne forum diskusije */}
            <section className="mt-16 border-t border-white/[0.07] pt-12" aria-labelledby="discussions-title">
              <div className="section-head">
                <div className="section-head-main">
                  <span className="eyebrow">Zajednica &amp; Gaming forum</span>
                  <h2 id="discussions-title" className="section-title">
                    Aktivna diskusija forumaša
                  </h2>
                </div>
                <Link to="/forum" className="ui-btn br-ghost ui-btn-sm">
                  Poseti forum <ChevronRight size={14} />
                </Link>
              </div>

              {threadsQuery.isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[0, 1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-40 rounded-lg" />
                  ))}
                </div>
              ) : threads.length === 0 ? (
                <EmptyState
                  icon={<MessageSquare size={20} />}
                  title="Forum još nema tema"
                  message="Budi prvi koji će otvoriti diskusiju o igrama, hardveru ili eSportu."
                  action={
                    <Link to="/forum" className="ui-btn br-primary ui-btn-sm">
                      Otvori temu
                    </Link>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {threads.map((thread: any) => (
                    <Link
                      key={thread.id}
                      to={`/thread/${thread.id}`}
                      className="ui-card ui-card-interactive group flex flex-col justify-between"
                    >
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
                            {thread.subforum}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-cyan-400">+{thread.karma || 0}</span>
                        </div>
                        <h3 className="card-title-link mb-2 line-clamp-2 font-display text-sm font-semibold leading-snug">
                          {thread.title}
                        </h3>
                        <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-white/50">{thread.content}</p>
                      </div>
                      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs text-white/45">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <img
                            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(thread.author || 'user')}`}
                            alt=""
                            width={20}
                            height={20}
                            loading="lazy"
                            className="h-5 w-5 rounded-full border border-white/10"
                          />
                          <span className="truncate">{thread.author}</span>
                          <VerifiedBadge isVerified={thread.authorVerified} size="xs" />
                        </div>
                        <span className="flex items-center gap-1 font-mono">
                          <MessageSquare size={12} aria-hidden="true" /> {thread.replies || 0}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
