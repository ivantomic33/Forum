import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Gamepad2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { CollectionItem } from '../../contracts/index';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../components/ui';

/** Kratki datum za meta red. */
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * F-5 — `/collections/:slug` — javna lista igara.
 *
 * Vlasnik je ujedno i urednik (dodaje/briše stavke); ostali glasaju.
 */
export default function CollectionPage() {
  const { slug = '' } = useParams();
  const { user, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();
  const [newGame, setNewGame] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', slug, user?.id ?? 'guest'],
    queryFn: () => api.collections.get(slug),
    enabled: Boolean(slug),
  });

  const collection = data?.collection;
  const isOwner = Boolean(collection && user && collection.authorId === user.id);

  usePageMeta({
    title: collection ? `${collection.title} — NEXUS kolekcija` : 'Kolekcija igara',
    description: collection
      ? `${collection.title}: ${collection.items.length} igara po izboru korisnika ${collection.author}. Glasajte i dodajte svoju listu.`
      : 'Korisnička lista igara na NEXUS-u.',
    path: `/collections/${slug}`,
    noIndex: collection ? !collection.isPublic : false,
  });

  const voteMutation = useMutation({
    mutationFn: (direction: 'up' | 'down' | null) => api.collections.vote(collection!.id, direction),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collection', slug] });
      void result;
    },
    onError: (err: any) => toast.error(err?.message || 'Glas nije sačuvan.'),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.collections.addItem(collection!.id, {
        gameTitle: newGame.trim(),
        note: newNote.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Igra je dodata na listu.');
      setNewGame('');
      setNewNote('');
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ['collection', slug] });
    },
    onError: (err: any) => toast.error(err?.message || 'Igra nije dodata.'),
  });

  const removeMutation = useMutation({
    mutationFn: (item: CollectionItem) => api.collections.removeItem(collection!.id, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection', slug] });
    },
    onError: (err: any) => toast.error(err?.message || 'Stavka nije uklonjena.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.collections.remove(collection!.id),
    onSuccess: () => {
      toast.success('Lista je obrisana.');
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      window.location.assign('/collections');
    },
    onError: (err: any) => toast.error(err?.message || 'Lista nije obrisana.'),
  });

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-3xl space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !collection) {
    return (
      <div className="section">
        <div className="container max-w-3xl">
          {!collection && !isError ? null : (
            <ErrorState title="Lista nije učitana" message="Možda je obrisana ili je autor učinio privatnom." onRetry={() => refetch()} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="container max-w-3xl">
        <nav className="crumbs mb-5" aria-label="Putanja">
          <Link to="/collections">Kolekcije</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="text-white/80">{collection.title}</span>
        </nav>

        <header className="border-b border-[var(--color-border-subtle)] pb-6">
          <span className="eyebrow mb-2">Lista · {collection.items.length} igara</span>
          <h1 className="page-title">{collection.title}</h1>
          {collection.description && <p className="text-lead mt-3 whitespace-pre-line">{collection.description}</p>}
          <div className="meta-row mt-4 flex-wrap items-center gap-3">
            <span>
              Napravio{' '}
              <Link to={`/profile/${encodeURIComponent(collection.author)}`} className="hover:underline">
                {collection.author}
              </Link>
            </span>
            <span>{formatDate(collection.createdAt)}</span>
            {!collection.isPublic && <span className="text-[var(--color-warning-fg)]">Privatna lista</span>}
          </div>

          <div className="mt-5 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isAuthenticated || isOwner || voteMutation.isPending}
              aria-pressed={collection.myVote === 'up'}
              onClick={() => voteMutation.mutate(collection.myVote === 'up' ? null : 'up')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                collection.myVote === 'up'
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-glow)] text-[var(--color-primary-fg)]'
                  : 'border-[var(--color-border-default)] hover:border-[var(--color-primary-glow)]',
              )}
              title={isOwner ? 'Ne možete glasati za sopstvenu listu' : 'Glasaj za listu'}
            >
              <ArrowUp size={14} aria-hidden="true" />
              <span className="font-mono tabular-nums">{collection.score}</span>
              <span className="text-meta">glasova</span>
            </button>

            {isOwner && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setAdding((value) => !value)} leftIcon={<Plus size={14} />}>
                  Dodaj igru
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Trash2 size={14} />}
                  loading={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Obrisati listu? Ovo se ne može poništiti.')) deleteMutation.mutate();
                  }}
                >
                  Obriši listu
                </Button>
              </>
            )}
          </div>

          {adding && isOwner && (
            <form
              className="mt-4 space-y-2 rounded-xl border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newGame.trim()) {
                  toast.error('Unesite naziv igre.');
                  return;
                }
                addMutation.mutate();
              }}
            >
              <label htmlFor="collection-game" className="sr-only">
                Naziv igre
              </label>
              <input
                id="collection-game"
                value={newGame}
                onChange={(event) => setNewGame(event.target.value)}
                placeholder="Naziv igre (npr. Baldur's Gate 3)"
                className="ui-field"
                maxLength={200}
                autoFocus
              />
              <label htmlFor="collection-note" className="sr-only">
                Zašto je na listi (opciono)
              </label>
              <input
                id="collection-note"
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                placeholder="Kratko obrazloženje (opciono)"
                className="ui-field"
                maxLength={280}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={addMutation.isPending}>
                  Dodaj
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  Otkaži
                </Button>
              </div>
            </form>
          )}
        </header>

        <ol className="mt-6 space-y-2">
          {collection.items.map((item, index) => (
            <li key={item.id}>
              <Card className="flex items-center gap-4 p-3">
                <span className="w-7 shrink-0 font-mono text-base font-bold tabular-nums text-[var(--color-text-muted)]">
                  {index + 1}
                </span>
                {item.gameCover ? (
                  <img src={item.gameCover} alt="" loading="lazy" className="h-16 w-12 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                    <Gamepad2 size={18} aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {item.gameSlug ? (
                    <Link
                      to={`/games/${item.gameSlug}`}
                      className="line-clamp-1 font-medium text-[var(--color-text-primary)] hover:underline"
                    >
                      {item.gameTitle}
                    </Link>
                  ) : (
                    <p className="line-clamp-1 font-medium text-[var(--color-text-primary)]">{item.gameTitle}</p>
                  )}
                  {item.note && <p className="text-meta mt-0.5 line-clamp-2">{item.note}</p>}
                </div>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(item)}
                    aria-label={`Ukloni ${item.gameTitle} sa liste`}
                    className="ui-icon-btn"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </Card>
            </li>
          ))}
        </ol>

        {collection.items.length === 0 && (
          <EmptyState
            icon={<Gamepad2 size={22} />}
            title="Lista je još prazna"
            message={
              isOwner
                ? 'Dodajte prvu igru — lista je javna čim je sačuvate.'
                : 'Autor još nije dodao igre. Vratite se kasnije.'
            }
            className="mt-6"
          />
        )}
      </div>
    </div>
  );
}
