import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Cpu, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, cn } from '../components/ui';

/**
 * F-11 — `/build-planner` — kalkulator PC build-a.
 *
 * Cilj: izabereš komponente i vidiš ukupnu cenu kod domaćih prodavnica, uz
 * jasno označene obavezne delove koji nedostaju. Cene dolaze iz kataloga koji
 * pune moderatori (`/api/builds/catalog`), pa nema scrapinga prodavnica.
 *
 * „Sačuvaj i podeli“ daje kratak link (`/build/:shareId`) koji radi bez prijave.
 */

type Category = 'cpu' | 'gpu' | 'motherboard' | 'ram' | 'storage' | 'psu' | 'case' | 'cooler' | 'monitor' | 'peripheral';

interface Component {
  id: string;
  category: Category;
  name: string;
  brand: string | null;
  spec: string | null;
  price: number;
  currency: string;
  store: string;
  url: string | null;
}

interface CategoryMeta {
  id: Category;
  label: string;
  required: boolean;
}

const money = (value: number, currency = 'RSD') =>
  new Intl.NumberFormat('sr-Latn-RS', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/** Deljeni prikaz build-a (`/build/:shareId`) — koristi isti izvor cena. */
export function SharedBuildPage() {
  const { shareId = '' } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['build', shareId],
    queryFn: () => api.builds.get(shareId),
    enabled: Boolean(shareId),
  });

  usePageMeta({
    title: data?.build ? `${data.build.title} — PC build` : 'PC build',
    description: data?.build ? `Konfiguracija: ${data.build.title}, ${money(data.build.total)}.` : undefined,
    path: `/build/${shareId}`,
    noIndex: !data?.build?.isPublic,
  });

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-3xl space-y-3" aria-busy="true">
          <Skeleton className="h-9 w-2/3" />
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data?.build) {
    return (
      <div className="section">
        <div className="container max-w-3xl">
          <ErrorState title="Build nije pronađen" message="Link je pogrešan ili je build učinjen privatnim." />
        </div>
      </div>
    );
  }

  const build = data.build;
  return (
    <div className="section">
      <div className="container max-w-3xl">
        <span className="eyebrow mb-2">Kalkulator build-a</span>
        <h1 className="page-title">{build.title}</h1>
        <p className="text-body mt-2">
          Ukupno <strong className="font-mono tabular-nums">{money(build.total)}</strong> kod domaćih prodavnica
          {build.complete ? ' · kompletna konfiguracija' : ' · nedostaju obavezni delovi'}.
        </p>

        <ol className="mt-6 space-y-2">
          {build.parts.map((part) => (
            <li key={part.component.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <span className="text-label block text-[var(--color-text-muted)]">{part.component.category}</span>
                  <p className="line-clamp-1 font-medium">{part.component.name}</p>
                  <p className="text-micro">
                    {part.component.store}
                    {part.qty > 1 ? ` · ${part.qty}×` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-base font-semibold tabular-nums">
                    {money(part.subtotal, part.component.currency)}
                  </p>
                  {part.component.url && (
                    <a
                      href={part.component.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-micro inline-flex items-center gap-1 text-[var(--color-primary-fg)] hover:underline"
                    >
                      Prodavnica <ExternalLink size={10} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex-wrap gap-2">
          <Link to="/build-planner" className="ui-btn br-primary ui-btn-md">
            Napravi svoj build
          </Link>
          <button
            type="button"
            className="ui-btn br-ghost ui-btn-md"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => toast.success('Link je kopiran.'))
                .catch(() => toast.error('Kopiranje nije uspelo.'));
            }}
          >
            <Copy size={14} aria-hidden="true" /> Kopiraj link
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BuildPlannerPage() {
  const { isAuthenticated } = useAuthStore();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('Moj PC build');
  const [savedShareId, setSavedShareId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['build-catalog'],
    // F-11 — javni endpoint (bez `isAuthenticated` u ključu), pa keš traje duže.
    queryFn: () => api.builds.catalog(),
    staleTime: 5 * 60_000,
  });

  usePageMeta({
    title: 'Kalkulator PC build-a — cene kod domaćih prodavnica',
    description:
      'Izaberite procesor, grafičku, matičnu, RAM i ostalo — kalkulator sabira cene kod domaćih prodavnica i pokazuje šta još nedostaje.',
    path: '/build-planner',
  });

  const components: Component[] = data?.components ?? [];
  const categories: CategoryMeta[] = (data?.categories ?? []) as CategoryMeta[];

  const byCategory = useMemo(() => {
    const map = new Map<Category, Component[]>();
    for (const component of components) {
      const list = map.get(component.category) ?? [];
      list.push(component);
      map.set(component.category, list);
    }
    return map;
  }, [components]);

  const chosen = categories
    .map((category) => ({ category, component: components.find((item) => item.id === selected[category.id]) }))
    .filter((entry): entry is { category: CategoryMeta; component: Component } => Boolean(entry.component));

  const total = chosen.reduce((sum, entry) => sum + entry.component.price, 0);
  const missing = categories.filter((category) => category.required && !selected[category.id]).map((category) => category.label);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.builds.create({
        title,
        items: chosen.map((entry) => ({ componentId: entry.component.id, qty: 1 })),
      }),
    onSuccess: ({ build }) => {
      setSavedShareId(build.shareId);
      toast.success('Build je sačuvan — link je spreman za deljenje.');
    },
    onError: (error: any) => toast.error(error?.message || 'Build nije sačuvan.'),
  });

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-4xl space-y-4" aria-busy="true">
          <Skeleton className="h-10 w-1/2" />
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="section">
        <div className="container max-w-4xl">
          <ErrorState title="Katalog nije dostupan" message="Pokušaj ponovo za koji trenutak." onRetry={() => refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="container max-w-4xl">
        <header className="mb-6 border-b border-[var(--color-border-subtle)] pb-5">
          <span className="eyebrow mb-2">Hardver</span>
          <h1 className="page-title">Kalkulator PC build-a</h1>
          <p className="text-body mt-2 max-w-prose">
            Izaberite komponente i odmah vidite ukupnu cenu kod domaćih prodavnica. Cene u katalog unosi moderacija;
            prodavnica je uvek navedena uz deo.
          </p>
        </header>

        {components.length === 0 ? (
          <EmptyState
            icon={<Cpu size={22} />}
            title="Katalog je još prazan"
            message="Moderator još nije uneo komponente. Katalog se puni iz admin panela (POST /api/builds/catalog)."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-4">
              {categories.map((category) => {
                const list = byCategory.get(category.id) ?? [];
                const current = list.find((component) => component.id === selected[category.id]);
                return (
                  <Card key={category.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`build-${category.id}`} className="text-label text-[var(--color-text-tertiary)]">
                        {category.label}
                        {category.required && <span className="ml-1 text-[var(--color-error)]">*</span>}
                      </label>
                      {current && (
                        <button
                          type="button"
                          className="text-micro text-[var(--color-text-muted)] hover:underline"
                          onClick={() =>
                            setSelected((previous) => {
                              const next = { ...previous };
                              delete next[category.id];
                              return next;
                            })
                          }
                        >
                          <Trash2 size={11} className="inline" aria-hidden="true" /> ukloni
                        </button>
                      )}
                    </div>
                    <select
                      id={`build-${category.id}`}
                      className="ui-field mt-2"
                      value={selected[category.id] ?? ''}
                      onChange={(event) =>
                        setSelected((previous) => ({ ...previous, [category.id]: event.target.value }))
                      }
                    >
                      <option value="">
                        {list.length ? '— izaberi —' : 'nema komponenti u katalogu'}
                      </option>
                      {list.map((component) => (
                        <option key={component.id} value={component.id}>
                          {component.name}
                          {component.spec ? ` — ${component.spec}` : ''} · {money(component.price, component.currency)} ({component.store})
                        </option>
                      ))}
                    </select>
                  </Card>
                );
              })}
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <Card variant="static" className="p-4">
                <h2 className="text-h3">Tvoj build</h2>
                <label htmlFor="build-title" className="sr-only">
                  Naslov build-a
                </label>
                <input
                  id="build-title"
                  className="ui-field mt-3"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                />
                <ul className="mt-3 space-y-2">
                  {chosen.map((entry) => (
                    <li key={entry.category.id} className="flex items-start justify-between gap-2 text-meta">
                      <span className="min-w-0">
                        <span className="block line-clamp-1">{entry.component.name}</span>
                        <span className="text-micro">{entry.component.store}</span>
                      </span>
                      <span className="font-mono tabular-nums">{money(entry.component.price, entry.component.currency)}</span>
                    </li>
                  ))}
                  {chosen.length === 0 && <li className="text-meta text-[var(--color-text-muted)]">Još ništa nije izabrano.</li>}
                </ul>

                <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-border-subtle)] pt-3">
                  <span className="text-label">Ukupno</span>
                  <span className="font-mono text-h3 tabular-nums">{money(total)}</span>
                </div>

                {missing.length > 0 && chosen.length > 0 && (
                  <p className="text-micro mt-2 flex items-start gap-1.5 text-[var(--color-warning-fg)]">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Nedostaje: {missing.join(', ')}.
                  </p>
                )}
                {missing.length === 0 && chosen.length > 0 && (
                  <p className="text-micro mt-2 flex items-center gap-1.5 text-[var(--color-success-fg)]">
                    <Check size={12} aria-hidden="true" /> Konfiguracija je kompletna.
                  </p>
                )}

                <Button
                  className="mt-4 w-full"
                  loading={saveMutation.isPending}
                  disabled={!isAuthenticated || chosen.length === 0}
                  onClick={() => {
                    if (!isAuthenticated) {
                      toast.info('Prijavi se da bi sačuvao build.');
                      return;
                    }
                    saveMutation.mutate();
                  }}
                  leftIcon={<Plus size={15} />}
                >
                  Sačuvaj i podeli
                </Button>
                {!isAuthenticated && <p className="text-micro mt-2">Sačuvan build ima javan link koji radi bez prijave.</p>}

                {savedShareId && (
                  <div className="mt-3 rounded-md border-[var(--color-success-glow)] bg-[var(--color-success-glow)] p-2">
                    <Badge tone="success">Sačuvano</Badge>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Link
                        to={`/build/${savedShareId}`}
                        className="text-micro min-w-0 flex-1 truncate text-[var(--color-success-fg)] hover:underline"
                      >
                        /build/{savedShareId}
                      </Link>
                      <button
                        type="button"
                        className="ui-icon-btn"
                        aria-label="Kopiraj link build-a"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(`${window.location.origin}/build/${savedShareId}`)
                            .then(() => toast.success('Link je kopiran.'))
                            .catch(() => toast.error('Kopiranje nije uspelo.'));
                        }}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </Card>
              <p className={cn('text-micro mt-3 text-[var(--color-text-muted)]')}>
                Cene su informativne i menjaju se — proveri kod prodavca pre kupovine.
              </p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
