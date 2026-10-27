import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, Flame, Plus, Radio, SlidersHorizontal, Sparkles, Tag, X } from 'lucide-react';
import { api, type DealQuery, type DealSort } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, Button, Card, EmptyState, ErrorState, Tabs } from '../components/ui';
import { DealCard, DealWarning } from '../components/deals/DealCard';
import { DealForm } from '../components/deals/DealForm';
import { PLATFORM_OPTIONS, SORT_OPTIONS, STORE_OPTIONS } from '../components/deals/dealUtils';

const PAGE_SIZE = 24;

/**
 * `/deals` — „Gde je najjeftiniji…?“
 *
 * Sortiranje i filteri su u URL-u (`?sort=top&store=Steam&minDiscount=50`), pa
 * se link može podeliti i rezultat ostaje isti posle osvežavanja.
 */
export default function DealsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const [formOpen, setFormOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const sort = (params.get('sort') as DealSort) || 'top';
  const store = params.get('store') ?? '';
  const platform = params.get('platform') ?? '';
  const minDiscount = params.get('minDiscount') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';
  const search = params.get('search') ?? '';
  const expiringSoon = params.get('expiringSoon') === 'true';
  const [searchDraft, setSearchDraft] = useState(search);

  usePageMeta({
    title: 'Popusti — gde je najjeftiniji',
    description: 'Najbolji gejming popusti koje je objavila NEXUS zajednica: Steam, Epic, GOG, PlayStation, Xbox i drugi. Glasaj za najbolje deal-ove.',
    path: '/deals',
  });

  const query: DealQuery = {
    sort,
    store: store || undefined,
    platform: platform || undefined,
    minDiscount: minDiscount ? Number(minDiscount) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    search: search || undefined,
    expiringSoon: expiringSoon || undefined,
    limit,
    offset: 0,
  };

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['deals', query, user?.id ?? 'guest'],
    queryFn: () => api.deals.list(query),
    placeholderData: (previous) => previous,
  });

  const activeFilterCount = [store, platform, minDiscount, maxPrice, search, expiringSoon ? '1' : ''].filter(Boolean).length;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE_SIZE);
  };

  const clearFilters = () => {
    setParams(sort !== 'top' ? { sort } : {}, { replace: true });
    setSearchDraft('');
    setLimit(PAGE_SIZE);
  };

  const openForm = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/deals' } });
      return;
    }
    setFormOpen(true);
  };

  const deals = data?.deals ?? [];
  const total = data?.total ?? 0;

  const sortTabs = useMemo(
    () => (
      <Tabs
        items={SORT_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
          icon:
            option.id === 'top' ? <Flame size={13} aria-hidden="true" />
              : option.id === 'discount' ? <BadgePercent size={13} aria-hidden="true" />
                : option.id === 'expiring' ? <Radio size={13} aria-hidden="true" />
                  : <Sparkles size={13} aria-hidden="true" />,
        }))}
        value={sort}
        onChange={(value) => setParam('sort', value === 'top' ? '' : value)}
        tone="deal"
        ariaLabel="Sortiranje deal-ova"
      />
    ),
    // `params` je izvor istine za sort — tabovi se re-renderuju kada se URL promeni.
    [sort, params],
  );

  return (
    <div className="section">
      <div className="container">
        {/* Header — AMBER ZONA: suptilni `--gradient-deal` veo iza naslova */}
        <header className="deals-section-header mb-8 pb-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <span className="eyebrow mb-3">Deals / Popusti</span>
              <h1 className="page-title">Gde je najjeftiniji…</h1>
              <p className="text-lead mt-3 max-w-2xl">
                Popusti koje objavljuje zajednica. Proverite cenu, glasajte za najbolje ponude i pronađite igru po
                najnižoj ceni — Steam, Epic, GOG, PlayStation, Xbox i ostali.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button onClick={openForm} leftIcon={<Plus size={16} />}>
                Objavi deal
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card variant="static" compact>
              <Tag size={15} className="mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <div className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">{total.toLocaleString('sr-Latn-RS')}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">aktivnih deal-ova</div>
            </Card>
            <Card variant="static" compact>
              <BadgePercent size={15} className="mb-2 text-[var(--color-deal)]" aria-hidden="true" />
              <div className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">
                {deals.length ? `${Math.max(...deals.map((deal) => deal.discountPct))}%` : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">najveći popust na strani</div>
            </Card>
            <Card variant="static" compact>
              <Radio size={15} className="mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <div className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">
                {deals.filter((deal) => deal.expiresAt).length}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">ima ograničen rok</div>
            </Card>
            <Card variant="static" compact>
              <Sparkles size={15} className="mb-2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <div className="font-mono text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">
                {deals.filter((deal) => deal.isVerified).length}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">proverenih dokaza</div>
            </Card>
          </div>
        </header>

        {/* Toolbar: sort + filteri + pretraga */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {sortTabs}
          <div className="flex flex-1 items-center justify-end gap-2">
            <form
              className="relative min-w-0 flex-1 sm:max-w-xs"
              onSubmit={(event) => {
                event.preventDefault();
                setParam('search', searchDraft.trim());
              }}
              role="search"
            >
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Pretraži dealove…"
                aria-label="Pretraga deal-ova"
                className="ui-field !py-2 !pr-8 text-sm"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    setParam('search', '');
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  aria-label="Obriši pretragu"
                >
                  <X size={14} />
                </button>
              )}
            </form>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFiltersOpen((open) => !open)}
              leftIcon={<SlidersHorizontal size={14} />}
              aria-expanded={filtersOpen}
            >
              Filteri
              {activeFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-[var(--color-deal)] px-1.5 font-mono text-[10px] font-semibold text-[var(--color-on-deal)]">{activeFilterCount}</span>
              )}
            </Button>
          </div>
        </div>

        {filtersOpen && (
          <Card variant="static" className="mb-5 !p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Prodavnica</span>
                <select value={store} onChange={(event) => setParam('store', event.target.value)} className="ui-field !py-2 text-sm">
                  <option value="">Sve prodavnice</option>
                  {STORE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Platforma</span>
                <select value={platform} onChange={(event) => setParam('platform', event.target.value)} className="ui-field !py-2 text-sm">
                  <option value="">Sve platforme</option>
                  {PLATFORM_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">Popust / Maks. cena</span>
                <div className="flex gap-2">
                  <select value={minDiscount} onChange={(event) => setParam('minDiscount', event.target.value)} className="ui-field !py-2 text-sm">
                    <option value="">Bilo koji %</option>
                    <option value="25">25%+</option>
                    <option value="50">50%+</option>
                    <option value="70">70%+</option>
                    <option value="80">80%+</option>
                  </select>
                  <input
                    value={maxPrice}
                    onChange={(event) => setParam('maxPrice', event.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal"
                    placeholder="do €"
                    aria-label="Maksimalna cena"
                    className="ui-field !w-24 !py-2 text-sm"
                  />
                </div>
              </label>
              <div className="flex items-end justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={expiringSoon}
                    onChange={(event) => setParam('expiringSoon', event.target.checked ? 'true' : '')}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  Samo ističe uskoro
                </label>
                <button type="button" onClick={clearFilters} className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
                  Očisti
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* Lista */}
        {isLoading ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Učitavanje deal-ova">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="ui-card-static flex gap-4 !p-4">
                <div className="ui-skeleton h-32 w-28 rounded-[10px]" />
                <div className="flex-1 space-y-3">
                  <div className="ui-skeleton h-4 w-1/3" />
                  <div className="ui-skeleton h-5 w-2/3" />
                  <div className="ui-skeleton h-4 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Deal-ove nije moguće učitati" message="Server trenutno ne vraća popuste. Pokušaj ponovo." onRetry={() => refetch()} />
        ) : deals.length === 0 ? (
          <EmptyState
            icon={<BadgePercent size={22} />}
            title={activeFilterCount ? 'Nema deal-ova za izabrane filtere' : 'Još nema deal-ova'}
            message={
              activeFilterCount
                ? 'Probajte blaže filtere ili očistite pretragu.'
                : 'Budite prvi koji je pronašao dobar popust i podelite ga sa zajednicom.'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {activeFilterCount > 0 && (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Očisti filtere
                  </Button>
                )}
                <Button size="sm" onClick={openForm} leftIcon={<Plus size={14} />}>
                  Objavi deal
                </Button>
              </div>
            }
          />
        ) : (
          <>
            {/* 1 / 2 / 3 kolone — cena je najveći element kartice */}
            <div className="deal-grid deal-grid--wide">
              {deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                Prikazano {deals.length} od {total.toLocaleString('sr-Latn-RS')} deal-ova
              </span>
              {deals.length < total && (
                <Button variant="secondary" size="sm" loading={isFetching} onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                  Prikaži još
                </Button>
              )}
            </div>
          </>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-4">
          <DealWarning />
          <Link to="/games" className="text-meta text-[var(--color-text-secondary)] hover:text-[var(--color-primary-fg)]">
            Pregledaj igre sa aktivnim popustima →
          </Link>
        </div>
      </div>

      <DealForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
