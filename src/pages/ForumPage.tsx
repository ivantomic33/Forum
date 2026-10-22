import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, BarChart2, ChevronRight, Eye, Lock, MessageSquare, Pin, Plus, ShieldAlert, TrendingUp, Users, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import {
  Badge, Button, Card, EmptyState, ErrorState, Modal, OnlineAvatar, SkeletonThreadRows, Tabs, cn,
} from '../components/ui';
import { RoleEmblem } from '../components/profile/RoleEmblem';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';

// Teška zavisnost (Tiptap) se učitava samo kada korisnik uključi formatiranje
const RichTextEditor = lazy(() => import('../components/RichTextEditor'));

const SUBFORUMS_DEF = [
  { id: 'pc-gaming', name: 'PC Gaming', description: 'Diskusije o PC naslovima, optimizaciji i konfiguracijama.', icon: '🖥️' },
  { id: 'consoles', name: 'Consoles', description: 'PlayStation, Xbox i Nintendo — vesti, ekskluzive i debate.', icon: '🎮' },
  { id: 'esports', name: 'Esports', description: 'Turniri, mečevi, timovi i meta analize.', icon: '🏆' },
  { id: 'hardware', name: 'Hardware', description: 'Grafičke kartice, procesori, hlađenje i custom build-ovi.', icon: '⚙️' },
  { id: 'lfg', name: 'LFG', description: 'Pronađi saigrače za co-op, multiplayer i rangirane mečeve.', icon: '👥' },
  { id: 'off-topic', name: 'Off-Topic', description: 'Slobodne teme, humor i opšte ćaskanje zajednice.', icon: '💬' },
];

type SortKey = 'hot' | 'new' | 'top';

const formatDate = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // `toLocaleDateString` na srpskom daje „окт.“/„20.10.“ — kratke, ali neravne
  // širine. Fiksni mesec zapis je predvidiv u uskoj koloni.
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
  return `${date.getDate()}. ${months[date.getMonth()]}`;
};

/** Slug (`pc-gaming`) → čitljiv naziv sekcije (`PC Gaming`). */
const subforumLabel = (slug?: string) => {
  if (!slug) return '';
  const known = SUBFORUMS_DEF.find((item) => item.id === slug);
  if (known) return known.name;
  return slug
    .split('-')
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
};

export default function ForumPage() {
  const { subforum } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const search = searchParams.get('search') ?? '';
  const [sortBy, setSortBy] = useState<SortKey>('hot');
  const [votedThreads, setVotedThreads] = useState<Record<string, 'up' | 'down'>>({});

  // Nova tema
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newSubforum, setNewSubforum] = useState(subforum || 'pc-gaming');
  const [newTags, setNewTags] = useState('');
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [useRichEditor, setUseRichEditor] = useState(false);
  const [hasPoll, setHasPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);

  const categoriesQuery = useQuery({ queryKey: ['forum-categories'], queryFn: () => api.forum.categories() });

  const PAGE_SIZE = 25;

  // Cursor paginacija: „Učitaj još“ koristi `nextCursor` sa servera. Ranije je
  // uvek stizalo samo prvih 100 tema, a ostatak foruma nije bio dostupan.
  const threadsQuery = useInfiniteQuery({
    queryKey: ['forum-threads', subforum ?? 'all', sortBy, search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      search
        ? api.forum.searchThreads(search, sortBy, { limit: PAGE_SIZE, cursor: pageParam })
        : api.forum.listThreads(subforum || 'all', sortBy, undefined, { limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    setNewSubforum(subforum || 'pc-gaming');
  }, [subforum]);

  const categories = categoriesQuery.data?.categories?.length ? categoriesQuery.data.categories : SUBFORUMS_DEF;
  const currentSubforum = categories.find((item: any) => item.id === subforum);
  const threads: any[] = useMemo(
    () => threadsQuery.data?.pages.flatMap((page) => page.threads) ?? [],
    [threadsQuery.data],
  );
  const totalThreads = threadsQuery.data?.pages[0]?.total ?? threads.length;

  const quickStats = useMemo(
    () => [
      { label: 'Tema u sekciji', value: threads.length, icon: MessageSquare },
      { label: 'Odgovora ukupno', value: threads.reduce((sum, item) => sum + (item.replies || 0), 0), icon: TrendingUp },
      { label: 'Fiksiranih', value: threads.filter((item) => item.isPinned).length, icon: Pin },
      { label: 'Aktuelni tip', value: sortBy === 'hot' ? 'Hot' : sortBy === 'new' ? 'Novo' : 'Top', icon: Users },
    ],
    [threads, sortBy],
  );

  const handleVote = async (threadId: string, direction: 'up' | 'down') => {
    if (!isAuthenticated) {
      toast.error('Prijavi se da bi glasao.');
      return;
    }
    const isCancel = votedThreads[threadId] === direction;
    setVotedThreads((previous) => {
      const next = { ...previous };
      if (isCancel) delete next[threadId];
      else next[threadId] = direction;
      return next;
    });
    try {
      await api.forum.voteThread(threadId, isCancel ? null : direction);
    } catch (error: any) {
      toast.error(error?.message || 'Glas nije zabeležen.');
    }
  };

  const openComposer = () => {
    if (!isAuthenticated) {
      toast.info('Prijavi se da bi otvorio temu.');
      navigate('/login');
      return;
    }
    setNewSubforum(subforum || 'pc-gaming');
    setComposerOpen(true);
  };

  const handleCreateThread = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const options = pollOptions.map((option) => option.trim()).filter(Boolean);
    const poll =
      hasPoll && pollQuestion.trim() && options.length >= 2
        ? { question: pollQuestion.trim(), options }
        : null;

    setSubmitting(true);
    try {
      await api.forum.createThread(newSubforum, {
        title: newTitle.trim(),
        content: newContent.trim(),
        tags: newTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        isSpoiler,
        poll,
      });
      setComposerOpen(false);
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      setIsSpoiler(false);
      setHasPoll(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setUseRichEditor(false);
      toast.success('Tema je objavljena (+20 XP)');
      // Prva strana se ponovo učitava (nove teme su na vrhu liste).
      threadsQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || 'Greška pri kreiranju teme.');
    } finally {
      setSubmitting(false);
    }
  };

  const sortTabs = (
    <Tabs
      ariaLabel="Sortiranje tema"
      value={sortBy}
      onChange={(value) => setSortBy(value)}
      items={[
        { id: 'hot', label: 'Hot' },
        { id: 'new', label: 'Novo' },
        { id: 'top', label: 'Top' },
      ]}
    />
  );

  const threadList = threadsQuery.isLoading ? (
    <SkeletonThreadRows rows={5} />
  ) : threadsQuery.isError ? (
    <ErrorState
      title="Teme nisu dostupne"
      message="Server ne može da vrati listu tema. Pokušaj ponovo."
      onRetry={() => threadsQuery.refetch()}
    />
  ) : threads.length === 0 ? (
    <EmptyState
      icon={<MessageSquare size={22} />}
      title={search ? `Nema rezultata za "${search}"` : 'Još uvek nema tema'}
      message={search ? 'Probaj drugačiji pojam ili otvori novu temu.' : 'Budi prvi koji će započeti diskusiju!'}
      action={
        <Button size="sm" onClick={openComposer} leftIcon={<Plus size={16} />}>
          Otvori temu
        </Button>
      }
    />
  ) : (
    <div>
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D101D]/75 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md">
        {threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} vote={votedThreads[thread.id]} onVote={handleVote} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-2 pt-4">
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
          Prikazano {threads.length} od {totalThreads.toLocaleString('sr-Latn-RS')} tema
        </span>
        {threadsQuery.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => threadsQuery.fetchNextPage()}
            loading={threadsQuery.isFetchingNextPage}
          >
            Učitaj još tema
          </Button>
        )}
        {threadsQuery.isFetchNextPageError && (
          <span className="text-xs text-rose-400">Sledeća strana nije učitana. Pokušaj ponovo.</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="section">
      <div className="container">
        {!subforum ? (
          <>
            <header className="mb-10 border-b border-white/[0.07] pb-7">
              <span className="eyebrow mb-3">Zajednica</span>
              <h1 className="page-title">Forum</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/55">
                Pridruži se zajednici, podeli mišljenje, pronađi saigrače i diskutuj o svemu što te zanima.
              </p>
              {search && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] px-3 py-2 text-sm text-slate-300 backdrop-blur-sm">
                  Rezultati pretrage: <strong className="text-white">{search}</strong>
                  <button type="button" onClick={() => navigate('/forum')} className="ml-1 text-white/45 transition hover:text-white" aria-label="Obriši pretragu">
                    <X size={14} />
                  </button>
                </div>
              )}
            </header>

            {!search && (
              <div className="section-head">
                <div className="section-head-main">
                  <span className="eyebrow">Kategorije</span>
                  <h2 className="section-title">Sekcije foruma</h2>
                </div>
              </div>
            )}

            {!search && (
              <div className="mb-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {categories.map((item: any) => (
                  <Link
                    key={item.id}
                    to={`/forum/${item.id}`}
                    className="forum-cat-card group"
                  >
                    <div>
                      <div className="mb-4 flex items-start justify-between">
                        <div className="forum-cat-icon" aria-hidden="true">
                          {item.name.slice(0, 2).toUpperCase()}
                        </div>
                        <ChevronRight size={16} className="forum-cat-arrow" aria-hidden="true" />
                      </div>
                      <h2 className="forum-cat-title">{item.name}</h2>
                      <p className="forum-cat-desc mt-1.5">{item.description}</p>
                    </div>
                    <div className="forum-cat-stats">
                      <span>
                        <MessageSquare size={12} aria-hidden="true" />
                        {(item.threads || 0).toLocaleString('sr-Latn-RS')} tema
                      </span>
                      <span>
                        <Users size={12} aria-hidden="true" />
                        {(item.posts || 0).toLocaleString('sr-Latn-RS')} objava
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {sortTabs}
              <Button size="sm" onClick={openComposer} leftIcon={<Plus size={16} />}>
                Nova tema
              </Button>
            </div>

            {threadList}

            <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              {quickStats.map((stat) => (
                <Card key={stat.label} variant="static" className="!p-4">
                  <stat.icon className="mb-2.5 text-cyan-400/80" size={16} aria-hidden="true" />
                  <div className="font-mono text-xl font-semibold tabular-nums text-white">{stat.value}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{stat.label}</div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <>
            <nav className="crumbs mb-5" aria-label="Putanja">
              <Link to="/forum">Forum</Link>
              <span className="sep" aria-hidden="true">/</span>
              <span className="text-white/80">{currentSubforum?.name ?? subforum}</span>
            </nav>
            <header className="mb-7 border-b border-white/[0.07] pb-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 font-mono text-base font-bold text-cyan-300 shadow-[0_0_18px_-4px_rgba(124,58,237,0.6)]" aria-hidden="true">
                  {(currentSubforum?.name ?? subforum ?? 'F').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
                    {currentSubforum?.name ?? subforum}
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/55">{currentSubforum?.description ?? ''}</p>
                  <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">
                    {(currentSubforum?.threads ?? 0).toLocaleString('sr-Latn-RS')} tema ·{' '}
                    {(currentSubforum?.posts ?? 0).toLocaleString('sr-Latn-RS')} objava
                  </p>
                </div>
              </div>
            </header>

            <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              {sortTabs}
              <Button size="sm" onClick={openComposer} leftIcon={<Plus size={16} />}>
                Nova tema
              </Button>
            </div>

            {threadList}
          </>
        )}
      </div>

      {/* Composer */}
      <Modal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Nova forum tema"
        description="Kratko i jasno — naslov, sadržaj i po želji anketa."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setComposerOpen(false)}>
              Otkaži
            </Button>
            <Button size="sm" type="submit" form="new-thread-form" loading={submitting}>
              Objavi temu (+20 XP)
            </Button>
          </>
        }
      >
        <form id="new-thread-form" onSubmit={handleCreateThread} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="thread-subforum" className="mb-1 block text-sm font-semibold text-white/85">
                Subforum
              </label>
              <select
                id="thread-subforum"
                value={newSubforum}
                onChange={(event) => setNewSubforum(event.target.value)}
                className="ui-field"
              >
                {categories.filter((item: any) => item.id).map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="thread-tags" className="mb-1 block text-sm font-semibold text-white/85">
                Tagovi (zarezom)
              </label>
              <input
                id="thread-tags"
                type="text"
                value={newTags}
                onChange={(event) => setNewTags(event.target.value)}
                placeholder="Nvidia, Kupovina, 4K"
                className="ui-field"
              />
            </div>
          </div>

          <div>
            <label htmlFor="thread-title" className="mb-1 block text-sm font-semibold text-white/85">
              Naslov teme
            </label>
            <input
              id="thread-title"
              type="text"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              required
              placeholder="Kratak i jasan naslov teme…"
              className="ui-field"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="thread-content" className="block text-sm font-semibold text-white/85">
                Sadržaj
              </label>
              <button
                type="button"
                onClick={() => setUseRichEditor((value) => !value)}
                className="text-xs font-semibold text-cyan-400 transition hover:text-cyan-300 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
              >
                {useRichEditor ? 'Običan tekst' : 'Formatiran tekst'}
              </button>
            </div>
            {useRichEditor ? (
              <Suspense fallback={<div className="ui-skeleton h-40 w-full" aria-hidden="true" />}>
                <RichTextEditor content={newContent} onChange={setNewContent} placeholder="Detaljno opiši svoju temu…" />
              </Suspense>
            ) : (
              <textarea
                id="thread-content"
                rows={5}
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                required
                placeholder="Detaljno opiši svoje pitanje, savet ili temu za diskusiju…"
                className="ui-field resize-none"
              />
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/85">
            <input
              type="checkbox"
              checked={isSpoiler}
              onChange={(event) => setIsSpoiler(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            Označi kao spoiler (sakriva detalje priče)
          </label>

          <div className="rounded-xl border border-white/[0.08] bg-surface-2/60 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <BarChart2 size={16} className="text-cyan-400" aria-hidden="true" /> Anketa
              </span>
              <button
                type="button"
                onClick={() => setHasPoll((value) => !value)}
                className="text-xs font-semibold text-cyan-400 transition hover:text-cyan-300 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
              >
                {hasPoll ? 'Ukloni anketu' : '+ Dodaj anketu'}
              </button>
            </div>

            {hasPoll && (
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  value={pollQuestion}
                  onChange={(event) => setPollQuestion(event.target.value)}
                  placeholder="Pitanje ankete (npr. Koji GPU kupujete sledeći?)"
                  aria-label="Pitanje ankete"
                  className="ui-field"
                />
                {pollOptions.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => {
                        const updated = [...pollOptions];
                        updated[index] = event.target.value;
                        setPollOptions(updated);
                      }}
                      placeholder={`Opcija ${index + 1}`}
                      aria-label={`Opcija ankete ${index + 1}`}
                      className="ui-field flex-1"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions(pollOptions.filter((_, position) => position !== index))}
                        className="px-2 text-slate-500 transition hover:text-rose-400"
                        aria-label={`Ukloni opciju ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 6 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions([...pollOptions, ''])}
                    className="text-xs font-semibold text-cyan-400 transition hover:text-cyan-300 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]"
                  >
                    + Dodaj opciju
                  </button>
                )}
              </div>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** Compact red teme: glasovi, naslov sa indikatorima, meta i poslednja aktivnost. */
function ThreadRow({
  thread,
  vote,
  onVote,
}: {
  thread: any;
  vote?: 'up' | 'down';
  onVote: (id: string, direction: 'up' | 'down') => void;
}) {
  // `authorRole` / `authorLevel` dolaze sa servera (tema + odgovori).
  const roleLabel =
    thread.authorRole === 'admin'
      ? 'ADMIN'
      : thread.authorRole === 'dev'
        ? 'DEV'
        : thread.authorRole === 'moderator'
          ? 'MOD'
          : null;
  const level = Number(thread.authorLevel) || null;

  return (
    <article className={cn('forum-row', thread.isPinned && 'is-pinned')}>
      <div className="forum-row-votes">
        <button
          type="button"
          onClick={() => onVote(thread.id, 'up')}
          className={cn('forum-vote-btn', vote === 'up' && 'is-up')}
          aria-label="Glasaj za temu"
          aria-pressed={vote === 'up'}
        >
          <ArrowUp size={15} />
        </button>
        <span className="vote-count">{thread.karma || 0}</span>
        <button
          type="button"
          onClick={() => onVote(thread.id, 'down')}
          className={cn('forum-vote-btn', vote === 'down' && 'is-down')}
          aria-label="Glasaj protiv teme"
          aria-pressed={vote === 'down'}
        >
          <ArrowDown size={15} />
        </button>
      </div>

      <div className="min-w-0 self-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {thread.isPinned && (
            <span className="forum-flag forum-flag-pin">
              <Pin size={11} aria-hidden="true" /> Fiksirano
            </span>
          )}
          {thread.isLocked && (
            <span className="forum-flag forum-flag-lock">
              <Lock size={11} aria-hidden="true" /> Zaključano
            </span>
          )}
          {thread.isSpoiler && (
            <Badge tone="error">
              <ShieldAlert size={11} /> Spoiler
            </Badge>
          )}
          <Link
            to={`/thread/${thread.id}`}
            className="forum-row-title min-w-0 flex-1 truncate"
          >
            {thread.title}
          </Link>
        </div>

        {/* Mobilno: samo autor + pregledi; odgovori i datum ostaju u desnoj koloni na >= sm */}
        <div className="forum-row-meta meta-row mt-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* 2.6.1 — zeleni prsten za autore koji su „online sada“ (18px red) */}
            <OnlineAvatar
              src={thread.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(thread.author || 'user')}`}
              userId={thread.authorId}
              isOnline={thread.authorOnline}
              status={thread.authorStatus}
              size="xs"
              alt=""
              className="!h-[18px] !w-[18px]"
            />
            <span className="truncate font-medium text-[var(--color-text-secondary)]">{thread.author}</span>
            <VerifiedBadge isVerified={thread.authorVerified} size="xs" />
          </span>
          {roleLabel && <RoleEmblem role={thread.authorRole} />}
          {level !== null && (
            <Badge tone="neutral" className="!hidden !normal-case font-mono !text-[11px] !font-medium sm:!inline-flex">
              LVL {level}
            </Badge>
          )}
          <span className="forum-meta-replies flex items-center gap-1">
            <MessageSquare size={12} aria-hidden="true" /> {thread.replies || 0}
          </span>
          <span className="flex items-center gap-1">
            <Eye size={12} aria-hidden="true" /> {(thread.views || 0).toLocaleString('sr-Latn-RS')}
          </span>
        </div>
      </div>

      <div className="forum-row-stats hidden self-center sm:flex">
        <span className="cat">{subforumLabel(thread.subforum)}</span>
        <span className="flex items-center gap-1.5 font-mono tabular-nums">
          <MessageSquare size={12} aria-hidden="true" />
          <span>{thread.replies || 0} odg.</span>
          <span className="text-[var(--color-text-disabled)]" aria-hidden="true">·</span>
          <span className="text-[var(--color-text-muted)]">aktivno {formatDate(thread.lastReplyAt || thread.createdAt)}</span>
        </span>
      </div>
    </article>
  );
}
