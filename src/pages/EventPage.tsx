import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Radio } from 'lucide-react';
import { api } from '../lib/api';
import { usePageMeta } from '../lib/pageMeta';
import type { Article } from '../../contracts/index';
import { Badge, EmptyState, ErrorState, SkeletonCard } from '../components/ui';

/**
 * 2.13.0 — STRANICA DOGAĐAJA („Priča se razvija“)
 * -----------------------------------------------
 * Sve vesti sa istim `eventId` (GTA 6, Xbox otpuštanja…) na jednom mestu, kao
 * vremenska linija. Bez ovoga ista tema izgleda kao 5 nepovezanih vesti koje se
 * smenjuju na naslovnoj.
 */
export default function EventPage() {
  const { eventId = '' } = useParams();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(eventId);
  /** 2.13.2 — sažetak događaja (2–3 rečenice, najnovije prvo). */
  const [summary, setSummary] = useState('');

  usePageMeta({
    title: title ? `Priča se razvija: ${title}` : 'Događaj',
    // Sažetak je bolji opis za pretraživače od generičke rečenice.
    description: summary || `Sve vesti o događaju ${title} — hronološki.`,
    path: `/event/${eventId}`,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.articles
      .byEvent(eventId)
      .then((data) => {
        if (cancelled) return;
        setArticles(data.articles ?? []);
        const fromArticle = data.eventTitle ?? data.articles?.find((item) => item.eventTitle)?.eventTitle;
        setTitle(fromArticle || eventId.replace(/-/g, ' '));
        setSummary(data.summary ?? '');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message || 'Događaj nije pronađen.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <div className="section">
      <div className="container max-w-3xl">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white">
          <ArrowLeft size={16} aria-hidden="true" /> Sve vesti
        </Link>

        <header className="mb-8 border-b border-white/[0.07] pb-6">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-amber-200">
            <Radio size={12} aria-hidden="true" /> Priča se razvija
          </div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.02em] text-white sm:text-[2.25rem]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-white/55">
            {articles.length} {articles.length === 1 ? 'vest' : 'vesti'} o ovom događaju, najnovija prva.
          </p>

          {/* 2.13.2 — sažetak: šta se desilo i u kom pravcu ide (bez AI-ja) */}
          {summary ? (
            <p className="mt-4 rounded-xl border border-white/[0.07] bg-surface-1/70 p-3 text-sm leading-relaxed text-white/70">
              {summary}
            </p>
          ) : null}
        </header>

        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error ? (
          <ErrorState title="Događaj nije dostupan" message={error} />
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<Radio size={22} />}
            title="Nema vesti"
            message="Za ovaj događaj još nema objavljenih vesti."
            action={
              <Link to="/" className="ui-btn br-primary ui-btn-sm">
                Sve vesti
              </Link>
            }
          />
        ) : (
          <ol className="relative space-y-5 border-l border-white/10 pl-5">
            {articles.map((article, index) => (
              <li key={article.id} className="relative">
                <span
                  className={`absolute -left-[26px] top-2 h-2.5 w-2.5 rounded-full ring-4 ring-surface-0 ${index === 0 ? 'bg-amber-300' : 'bg-white/30'
                    }`}
                  aria-hidden="true"
                />
                <Link
                  to={`/article/${article.slug || article.id}`}
                  className="group block rounded-xl border border-white/[0.07] bg-surface-1 p-4 transition hover:border-violet-400/40 hover:bg-surface-2"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge tone="primary" className="font-mono uppercase tracking-[0.06em]">
                      {article.category}
                    </Badge>
                    {article.newsSource ? (
                      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-white/40">
                        {article.newsSource}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1 font-mono text-[11px] text-white/35">
                      <Clock size={11} aria-hidden="true" />
                      {new Date(article.publishedAt ?? article.createdAt).toLocaleString('sr-Latn-RS', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <h2 className="font-display text-base font-semibold leading-snug text-white group-hover:text-violet-200 sm:text-lg">
                    {article.title}
                  </h2>
                  {article.excerpt ? (
                    <p className="mt-1.5 line-clamp-2 text-sm text-white/60">{article.excerpt}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
