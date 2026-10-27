import { FormEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, Compass, MessageSquare, Search, Tag, Zap } from 'lucide-react';
import { api } from '../lib/api';
import type { Thread } from '../../contracts/index';
import { EmptyState, Skeleton } from '../components/ui';

/**
 * 404 — U-13
 *
 * Ranije: centriran „404 / Stranica ne postoji“ sa tri dugmeta, bez ikakvog
 * sadržaja. Sada greška ima izlaz u sadržaj:
 *
 *  - pretraga (ista ruta kao globalna pretraga),
 *  - „Vrele teme“ (realne teme sa foruma) i „Popusti danas“ kao prečice,
 *  - poslednja stranica koju je korisnik posećivao u ovoj sesiji (sessionStorage,
 *    postavlja je Layout na svakoj navigaciji) — jedan klik nazad tamo gde je bio.
 *
 * Nikad ne prikazuje nepostojeći sadržaj kao da postoji: sve liste dolaze sa
 * API-ja i imaju pošten empty state.
 */

const LAST_PATH_KEY = 'nexus-last-path';

function lastVisitedPath(current: string): string | null {
  try {
    const saved = sessionStorage.getItem(LAST_PATH_KEY);
    if (!saved || saved === current || !saved.startsWith('/') || saved.startsWith('//')) return null;
    return saved;
  } catch {
    return null;
  }
}

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [terms, setTerms] = useState('');
  const back = useMemo(() => lastVisitedPath(location.pathname), [location.pathname]);

  const threadsQuery = useQuery({
    queryKey: ['404-hot-threads'],
    queryFn: () => api.forum.listThreads('all', 'hot'),
    staleTime: 5 * 60_000,
  });
  const dealsQuery = useQuery({
    queryKey: ['404-deals'],
    queryFn: () => api.deals.list({ sort: 'discount', limit: 2, offset: 0 }),
    staleTime: 5 * 60_000,
  });

  const threads: Thread[] = (threadsQuery.data?.threads ?? []).slice(0, 3);
  const deals = (dealsQuery.data?.deals ?? []).slice(0, 2);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const term = terms.trim();
    if (term.length < 2) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="section">
      <div className="container">
        <header className="mb-10 border-b border-[var(--color-border-subtle)] pb-8">
          {/* 5.0 TERMINAL — kernel panic banner (7) */}
          <div className="nf-panic" role="presentation">
            <div className="nf-panic-bar">
              <span className="nf-panic-dots">● ● ●</span>
              <span className="nf-panic-title">kernel@nexus:~/404</span>
            </div>
            <pre className="nf-panic-out" aria-hidden="true">
{`$ cd ${location.pathname}\n`}
<span className="nf-panic-err">SEGMENTATION FAULT (core dumped)</span> — stranica ne postoji
{'\n'}trace: adresa je promenjena, obrisana ili nikad nije postojala
exit code: 404 · vreme: {new Date().toLocaleTimeString('sr-Latn-RS')}
</pre>
          </div>

          <h1 className="page-title mt-6">Ova stranica je otišla u drugi lobby</h1>
          <p className="text-lead mt-3 max-w-2xl">
            Adresa je promenjena, obrisana ili nikad nije postojala. Umesto mrtvog kraja, evo najbržih puteva nazad
            u sadržaj.
          </p>

          <form onSubmit={submit} role="search" className="mt-5 flex max-w-xl gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                aria-hidden="true"
              />
              <input
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                placeholder="Pretraži vesti, forum i popuste…"
                aria-label="Pretraga portala"
                className="ui-field !pl-9"
              />
            </div>
            <button type="submit" className="ui-btn br-primary ui-btn-md">
              Traži
            </button>
          </form>

          <div className="mt-4 flex-wrap items-center gap-2">
            {back && (
              <button type="button" onClick={() => navigate(back)} className="ui-btn br-secondary ui-btn-sm">
                <ArrowUpRight size={14} /> Nazad na prethodnu stranicu
              </button>
            )}
            <Link to="/" className="ui-btn br-ghost ui-btn-sm">
              <Compass size={14} /> Početna
            </Link>
            <Link to="/forum" className="ui-btn br-ghost ui-btn-sm">
              <MessageSquare size={14} /> Forum
            </Link>
            <Link to="/deals" className="ui-btn br-ghost ui-btn-sm">
              <Tag size={14} /> Popusti
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <section className="lg:col-span-7" aria-labelledby="nf-threads">
            <div className="section-head">
              <div className="section-head-main">
                <span className="eyebrow">Forum</span>
                <h2 id="nf-threads" className="section-title">
                  Vrele teme sada
                </h2>
              </div>
              <Link to="/forum" className="ui-btn br-ghost ui-btn-sm">
                Sve teme
              </Link>
            </div>

            {threadsQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((item) => (
                  <Skeleton key={item} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : threads.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={20} />}
                title="Trenutno nema aktivnih tema"
                message="Otvori prvu diskusiju — zajednica se budi postom."
                action={
                  <Link to="/forum?compose=1" className="ui-btn br-primary ui-btn-sm">
                    Nova tema
                  </Link>
                }
              />
            ) : (
              <div>
                {threads.map((thread) => (
                  <Link key={thread.id} to={`/thread/${thread.id}`} className="community-item">
                    <div className="min-w-0">
                      <span className="text-label">{thread.subforum}</span>
                      <h3 className="story-card-title mt-1 line-clamp-2 !text-[1.0625rem]">{thread.title}</h3>
                      <p className="meta-row mt-1.5">
                        {thread.author} · aktivno{' '}
                        {new Date(thread.lastReplyAt || thread.createdAt).toLocaleDateString('sr-Latn-RS', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 self-center pr-3 font-mono text-meta text-[var(--color-primary-fg)]">
                      <Zap size={14} aria-hidden="true" /> {thread.karma || 0}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-8 lg:col-span-5">
            <div className="primary-action-panel">
              <p className="text-label">Pretraga bez rezultata?</p>
              <p className="text-h3 mt-2 text-[var(--color-text-primary)]">Pitaj zajednicu</p>
              <p className="text-body mt-1.5">
                Ako tema ne postoji, otvori je — odgovor obično stigne u prvih sat vremena.
              </p>
              <Link to="/forum?compose=1" className="ui-btn br-primary ui-btn-md mt-4">
                Nova tema
              </Link>
            </div>

            <div className="rail-panel">
              <div className="flex items-center justify-between">
                <h2 className="rail-title">Popusti danas</h2>
                <Link to="/deals" className="text-micro underline-offset-2 hover:underline">
                  svi
                </Link>
              </div>
              {dealsQuery.isLoading ? (
                <Skeleton className="mt-3 h-16 rounded-lg" />
              ) : deals.length === 0 ? (
                <p className="text-meta mt-3">Trenutno nema aktivnih popusta.</p>
              ) : (
                deals.map((deal) => (
                  <Link
                    key={deal.id}
                    to={`/deals/${deal.id}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] py-3 last:border-b-0"
                  >
                    <span className="line-clamp-2 text-meta font-medium text-[var(--color-text-primary)]">
                      {deal.title}
                    </span>
                    <span className="font-mono text-meta font-bold text-[var(--color-primary-fg)]">
                      -{deal.discountPct}%
                    </span>
                  </Link>
                ))
              )}
            </div>

            <div className="rail-panel">
              <h2 className="rail-title mb-2">Dokumenti</h2>
              <div className="space-y-1">
                {[
                  { to: '/rules', label: 'Pravila foruma' },
                  { to: '/terms', label: 'Uslovi korišćenja' },
                  { to: '/privacy', label: 'Politika privatnosti' },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-2 py-1.5 text-meta text-[var(--color-text-secondary)] hover:text-[var(--color-primary-fg)]"
                  >
                    <BookOpen size={13} aria-hidden="true" /> {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
