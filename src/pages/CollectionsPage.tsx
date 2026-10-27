import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ListOrdered, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../components/ui';

/**
 * F-5 — `/collections` — javne liste igara zajednice.
 *
 * Liste su sadržaj koji se lako deli („Top 10 RPG 2026“) i svaka ima svoju
 * stranicu (`/collections/:slug`), pa je ovo i SEO površina: naslov, opis i
 * strukturirani podaci (Ranking JSON-LD na detalju).
 */
export default function CollectionsPage() {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collections', { search }],
    queryFn: () => api.collections.list({ search: search || undefined, limit: 30 }),
    staleTime: 60_000,
  });

  usePageMeta({
    title: 'Kolekcije igara — liste zajednice',
    description: 'Top liste igara koje pravi zajednica: najbolji RPG, horor, co-op naslovi i još mnogo toga. Glasajte i napravite svoju listu.',
    path: '/collections',
  });

  const createMutation = useMutation({
    mutationFn: () => api.collections.create({ title }),
    onSuccess: ({ collection }) => {
      toast.success('Lista je napravljena — dodajte igre.');
      setTitle('');
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      navigate(`/collections/${collection.slug}`);
    },
    onError: (error: any) => toast.error(error?.message || 'Lista nije napravljena.'),
  });

  const collections = data?.collections ?? [];

  return (
    <div className="section">
      <div className="container max-w-5xl">
        <header className="mb-8 flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="eyebrow mb-2">Zajednica</span>
            <h1 className="page-title">Kolekcije igara</h1>
            <p className="text-body mt-2 max-w-prose">
              Liste koje prave forumaši — „Top 10 RPG 2026“, igre za dvoje, skriveni dragulji. Glasajte za
              listu koja vam pomaže da izaberete šta igrate sledeće.
            </p>
          </div>
          <Button
            onClick={() => {
              if (!isAuthenticated) {
                navigate('/login', { state: { from: '/collections' } });
                return;
              }
              setCreating((value) => !value);
            }}
            leftIcon={<Plus size={15} />}
          >
            Napravi listu
          </Button>
        </header>

        {creating && (
          <form
            className="mb-6 flex-wrap items-center gap-2 rounded-xl border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim().length < 3) {
                toast.error('Naslov liste je prekratak.');
                return;
              }
              createMutation.mutate();
            }}
          >
            <label htmlFor="collection-title" className="sr-only">
              Naslov liste
            </label>
            <input
              id="collection-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="npr. Top 10 RPG 2026"
              maxLength={120}
              className="ui-field flex-1"
              autoFocus
            />
            <Button type="submit" loading={createMutation.isPending}>
              Napravi
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Otkaži
            </Button>
          </form>
        )}

        <div className="mb-6 max-w-sm">
          <label htmlFor="collections-search" className="sr-only">
            Pretraga listi
          </label>
          <input
            id="collections-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pretraži liste…"
            className="ui-field"
          />
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Liste trenutno nisu dostupne" message="Pokušaj ponovo za koji trenutak." onRetry={() => refetch()} />
        ) : collections.length === 0 ? (
          <EmptyState
            icon={<ListOrdered size={22} />}
            title="Još nema javnih listi"
            message="Napravite prvu listu — na primer „Top 10 RPG 2026“ — i pozovite zajednicu da glasa."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {collections.map((collection) => (
              <Card key={collection.id} className="p-5">
                <Link to={`/collections/${collection.slug}`} className="group block">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-h3 line-clamp-2 text-[var(--color-text-primary)] transition group-hover:text-[var(--color-primary-fg)]">
                      {collection.title}
                    </h2>
                    <Badge tone="neutral" className="shrink-0">
                      <ArrowUp size={11} aria-hidden="true" /> {collection.score}
                    </Badge>
                  </div>
                  {collection.description && (
                    <p className="text-meta mt-2 line-clamp-2">{collection.description}</p>
                  )}
                </Link>

                <div className="mt-3 flex items-center gap-2">
                  {(collection.items ?? []).slice(0, 5).map((item) =>
                    item.gameCover ? (
                      <img
                        key={item.id}
                        src={item.gameCover}
                        alt=""
                        loading="lazy"
                        className="h-14 w-10 rounded border-[var(--color-border-subtle)] object-cover"
                      />
                    ) : (
                      <span
                        key={item.id}
                        className="flex h-14 w-10 items-center justify-center rounded border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-micro text-[var(--color-text-muted)]"
                      >
                        {item.gameTitle.slice(0, 2)}
                      </span>
                    ),
                  )}
                  {(collection.items?.length ?? 0) > 5 && (
                    <span className="text-micro text-[var(--color-text-muted)]">+{(collection.items?.length ?? 0) - 5}</span>
                  )}
                </div>

                <div className={cn('text-micro mt-3 flex items-center justify-between', 'text-[var(--color-text-muted)]')}>
                  <span>
                    {collection.author} · {collection.items?.length ?? 0} igara
                  </span>
                  <Link to={`/collections/${collection.slug}`} className="text-[var(--color-primary-fg)] hover:underline">
                    Otvori listu
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
