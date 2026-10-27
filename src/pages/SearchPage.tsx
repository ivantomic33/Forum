import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Gamepad2, MessageSquare, MessagesSquare, Search as SearchIcon, Tag } from 'lucide-react';
import { api, type SearchHit } from '../lib/api';
import type { SearchScope } from '../../contracts/index';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, EmptyState, ErrorState, SkeletonRows, Tabs } from '../components/ui';

/**
 * `/search?q=…` — objedinjena pretraga (2.6.2)
 * --------------------------------------------
 * Jedna lista za članke, teme foruma i deal-ove, rangirana na serveru
 * (pg_trgm). Tabovi samo menjaju `type` — server vraća isti ugovor, pa je
 * prebacivanje trenutno (TanStack Query kešira po `[query, type]`).
 *
 * Namerno nema klijentskog filtriranja: server već zna šta je vidljivo
 * (samo objavljeni članci, samo aktivni deal-ovi, bez soft-deleted tema).
 *
 * 2.6.6 (F-13) — tab „Odgovori“ traži u tekstu odgovora (`type=replies`) i
 * vodi na duboki link `#post-<id>`; u „Sve“ nisu da ne bi istisnuli teme.
 */

const TYPE_LABEL: Record<string, string> = {
  all: 'Sve',
  articles: 'Članci',
  threads: 'Forum',
  replies: 'Odgovori',
  deals: 'Popusti',
};

const HIT_META: Record<SearchHit['type'], { label: string; icon: typeof FileText }> = {
  article: { label: 'Članak', icon: FileText },
  thread: { label: 'Tema', icon: MessageSquare },
  reply: { label: 'Odgovor', icon: MessagesSquare },
  deal: { label: 'Deal', icon: Tag },
} as const;

/** Kratak datum za rezultat — sortiranje već radi server, datum je samo signal. */
function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const type = params.get('type') ?? 'all';
  const [draft, setDraft] = useState(query);

  useEffect(() => setDraft(query), [query]);

  usePageMeta({
    title: query ? `Pretraga: ${query}` : 'Pretraga',
    description: query
      ? `Rezultati pretrage za „${query}“ — članci, forum teme i popusti.`
      : 'Pretraži članke, forum teme i popuste na NEXUS-u.',
    path: '/search',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['search', query, type],
    queryFn: () => api.search.all(query, type as SearchScope),
    enabled: query.length >= 2,
    // Kucanje u navu menja query — kratko keširanje da Back ne pravi novi poziv.
    staleTime: 30_000,
  });

  const tabs = useMemo(
    () =>
      (['all', 'articles', 'threads', 'replies', 'deals'] as const).map((key) => ({
        id: key,
        label: TYPE_LABEL[key],
        // U „all“ režimu server ne vraća broj po tipu — broj samo na aktivnom tabu.
        count: key === 'all' || type !== key ? undefined : data?.total,
      })),
    [data?.total, type],
  );

  const hits = data?.hits ?? [];

  return (
    <div className="section">
      <div className="container max-w-3xl">
        <header className="mb-6">
          <span className="eyebrow mb-2">Pretraga</span>
          <h1 className="page-title">
            {query ? `Rezultati za „${query}“` : 'Pretraži NEXUS'}
          </h1>
          <form
            className="relative mt-4"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const term = draft.trim();
              if (term.length < 2) return;
              setParams({ q: term, ...(type !== 'all' ? { type } : {}) });
            }}
          >
            <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/45" size={16} aria-hidden="true" />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Igra, tema, igra na popustu…"
              aria-label="Pretraga"
              className="ui-field !pl-10"
              autoFocus={!query}
            />
          </form>
        </header>

        <Tabs
          items={tabs}
          value={type as SearchScope}
          ariaLabel="Vrsta sadržaja"
          onChange={(key) => {
            const term = query || draft.trim();
            if (term.length < 2) return;
            setParams({ q: term, ...(key !== 'all' ? { type: key } : {}) });
          }}
        />

        <div className="mt-4">
          {query.length < 2 ? (
            <EmptyState
              title="Unesi najmanje 2 znaka"
              message="Pretraga pokriva naslove i sadržaj članaka, forum teme i aktivne popuste."
            />
          ) : isLoading ? (
            <SkeletonRows rows={4} />
          ) : isError ? (
            <ErrorState title="Pretraga nije uspela" message="Pokušaj ponovo za nekoliko trenutaka." onRetry={() => refetch()} />
          ) : hits.length === 0 ? (
            <EmptyState
              title="Nema rezultata"
              message={
                data?.suggestion
                  ? `Ništa nije pronađeno za „${query}“. Da li ste mislili:`
                  : `Ništa nije pronađeno za „${query}“. Proveri pravopis ili probaj kraću reč.`
              }              action={
                /* 2.6.2 — „da li ste mislili“ iz trigram rečnika (`search_suggest`). */
                data?.suggestion ? (
                  <button
                    type="button"
                    onClick={() => {
                      setParams({ q: data.suggestion!, ...(type !== 'all' ? { type } : {}) });
                      setDraft(data.suggestion!);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-sm font-medium text-cyan-200 transition hover:border-cyan-400/60"
                  >
                    <SearchIcon size={13} aria-hidden="true" />
                    {data.suggestion}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-2">
              {hits.map((hit) => {
                const meta = HIT_META[hit.type];
                const Icon = meta.icon;
                return (
                  <li key={`${hit.type}-${hit.id}`}>
                    <Link
                      to={hit.href}
                      className="group flex gap-3 rounded-xl border border-white/[0.07] bg-surface-1/60 p-3 transition hover:border-cyan-400/30 hover:bg-surface-1"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-cyan-300">
                        <Icon size={15} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white group-hover:text-cyan-200">{hit.title}</span>
                          <Badge tone="neutral">{meta.label}</Badge>
                          {hit.type === 'deal' && hit.extra && <Badge tone="success">{hit.extra}</Badge>}
                        </span>
                        {hit.snippet && <span className="mt-1 line-clamp-2 block text-xs text-white/55">{hit.snippet}</span>}
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/35">
                          {hit.meta && <span>{hit.meta}</span>}
                          {hit.type === 'thread' && hit.extra && <span>{hit.extra}</span>}
                          {hit.type === 'reply' && hit.extra && <span>{hit.extra}</span>}
                          <span>{shortDate(hit.createdAt)}</span>
                        </span>
                      </span>
                      {hit.image && (
                        <img src={hit.image} alt="" loading="lazy" className="hidden h-14 w-20 shrink-0 rounded-lg object-cover sm:block" />
                      )}
                      {hit.type === 'deal' && <Gamepad2 size={14} className="mt-1 hidden text-white/20 sm:block" aria-hidden="true" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hits.length > 0 && (
          <p className="mt-4 text-center text-[11px] text-white/35">
            {data?.total} {data?.total === 1 ? 'rezultat' : 'rezultata'} · rangirano po podudaranju naziva (pg_trgm)
          </p>
        )}
      </div>
    </div>
  );
}
