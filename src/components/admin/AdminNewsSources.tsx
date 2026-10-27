import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ImageOff, Newspaper, Rss, Clock } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * 2.13.2 — IZVORI VESTI (admin)
 * ----------------------------
 * Pokazuje odakle dolaze vesti: po izvoru (Polygon, Kotaku…), po kategoriji i
 * poslednjih 10 uvoza sa signalima kvaliteta (bez slike, kratak tekst).
 *
 * Zašto ovde, a ne u logu servera: problem „vest nema sliku“ čitalac vidi na
 * naslovnoj pre nego iko pogleda log. Ovde se vidi pre toga.
 */
export function AdminNewsSources() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'news', 'sources'],
    queryFn: () => api.admin.newsSources(),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <section className="ui-card mb-6 p-5" aria-busy="true">
        <div className="ui-skeleton mb-3 h-5 w-48" />
        <div className="ui-skeleton h-24 w-full" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="ui-card mb-6 p-5">
        <h2 className="text-h3 mb-1 flex items-center gap-2 text-white">
          <Rss size={18} aria-hidden="true" /> Izvori vesti
        </h2>
        <p className="text-micro text-white/50">Statistika izvora trenutno nije dostupna.</p>
      </section>
    );
  }

  const imported = Object.entries(data.bySource).filter(([name]) => name !== '(ručno)');
  const manual = data.bySource['(ručno)']?.total ?? 0;
  const importedTotal = imported.reduce((sum, [, entry]) => sum + entry.total, 0);
  const max = Math.max(1, ...imported.map(([, entry]) => entry.total));

  const categories = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
  const problems = data.recent.filter((item) => !item.hasImage || item.length < 400);

  return (
    <section className="ui-card mb-6 p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 flex items-center gap-2 text-white">
            <Rss size={18} aria-hidden="true" /> Izvori vesti
          </h2>
          <p className="text-micro text-white/50">
            {importedTotal} uvezenih · {manual} ručno · {data.total} ukupno objavljenih
          </p>
        </div>
        <span className="text-micro rounded-full border border-white/10 px-2 py-1 font-mono text-white/60">
          {data.recent.length > 0 ? `poslednji uvoz: ${formatDate(data.recent[0].publishedAt)}` : 'nema uvoza'}
        </span>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Po izvoru — horizontalne trake (bez biblioteke grafikona). */}
        <div>
          <h3 className="text-label mb-2 font-mono uppercase tracking-wider text-white/45">Po izvoru (RSS)</h3>
          {imported.length === 0 ? (
            <p className="text-micro text-white/50">Još nema uvezenih vesti. Pokreni `npm run ingest:news`.</p>
          ) : (
            <ul className="space-y-2">
              {imported
                .sort((a, b) => b[1].total - a[1].total)
                .map(([name, entry]) => (
                  <li key={name}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-micro">
                      <span className="truncate text-white/80">{name}</span>
                      <span className="shrink-0 font-mono text-white/45">
                        {entry.total}
                        {entry.last7d ? <span className="text-success"> +{entry.last7d}/7d</span> : null}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                        style={{ width: `${Math.max(4, (entry.total / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}

          <h3 className="text-label mb-2 mt-5 font-mono uppercase tracking-wider text-white/45">Po kategoriji</h3>
          <div className="flex flex-wrap gap-1.5">
            {categories.map(([name, count]) => (
              <span
                key={name}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-micro text-white/70"
              >
                {name} <span className="font-mono text-white/40">{count}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Poslednji uvoz — kvalitet */}
        <div>
          <h3 className="text-label mb-2 flex items-center gap-1.5 font-mono uppercase tracking-wider text-white/45">
            <Clock size={12} aria-hidden="true" /> Poslednjih 10 uvoza
          </h3>
          {data.recent.length === 0 ? (
            <p className="text-micro text-white/50">Nema uvezenih vesti.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent.map((item) => {
                const noImage = !item.hasImage;
                const short = item.length < 400;
                return (
                  <li key={item.title} className="flex items-start gap-2 text-micro">
                    <span className="mt-0.5 shrink-0">
                      {noImage ? (
                        <ImageOff size={13} className="text-warning" aria-label="Bez slike" />
                      ) : short ? (
                        <AlertTriangle size={13} className="text-warning" aria-label="Kratak tekst" />
                      ) : (
                        <Newspaper size={13} className="text-white/30" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-white/80">{item.title}</span>
                      <span className="font-mono text-white/35">
                        {item.newsSource ?? 'izvor'} · {formatDate(item.publishedAt)} · {item.length} znakova
                        {noImage ? ' · BEZ SLIKE' : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {problems.length > 0 ? (
            <p className="text-micro mt-3 flex items-center gap-1.5 rounded-lg border border-warning/25 bg-warning/5 px-2 py-1.5 text-warning/90">
              <AlertTriangle size={13} aria-hidden="true" />
              {problems.length} od poslednjih 10 ima problem (slika ili dužina teksta)
            </p>
          ) : (
            <p className="text-micro mt-3 text-success/80">Poslednjih 10 uvoza je bez primedbi.</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/admin/reports" className="ui-btn ui-btn-sm br-ghost">
              Moderation
            </Link>
            <Link to="/" className="ui-btn ui-btn-sm br-ghost">
              Otvori portal
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('sr-Latn-RS', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
