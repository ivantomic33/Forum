import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Eye, TrendingUp, TrendingDown, BarChart3, PieChart, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import type { AdminStats } from '../../../contracts/index';

/**
 * F-7b — ADMIN ANALITIKA (grafikoni pregleda)
 * -------------------------------------------
 * Chart.js sa selektivnom registracijom komponenti (manji bundle).
 * Boje prate postojeću dark paletu (CSS varijable projekta).
 * `maintainAspectRatio: false` unutar fiksne visine (h-72) — bez pucanja
 * layouta na mobilnim ekranima.
 */

// Selektivna registracija — samo korišćene komponente.
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const RANGES = [
  { key: '7d', label: '7 dana' },
  { key: '30d', label: '30 dana' },
  { key: '90d', label: '90 dana' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const PALETTE = {
  line: '#22d3ee', // cyan-400 (accent)
  lineFillFrom: 'rgba(34, 211, 238, 0.35)',
  lineFillTo: 'rgba(34, 211, 238, 0)',
  grid: 'rgba(255, 255, 255, 0.06)',
  ticks: '#8b93a7',
  bar: '#a78bfa', // violet-400
  doughnut: ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171'],
};

/** Formatiranje datuma za tooltip: "18. okt" umesto ISO. */
const MONTHS_SR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
function formatDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)}. ${MONTHS_SR[Number(month) - 1] ?? month}`;
}
const fmt = (n: number) => n.toLocaleString('sr-RS');

function ChartCard({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof Eye; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 ${className}`}>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/90">
        <Icon className="h-4 w-4 text-[var(--color-accent)]" />
        {title}
      </div>
      {children}
    </div>
  );
}

/** Skeleton kartica — dok traje fetch. */
function SkeletonCard() {
  return (
    <div className="h-72 animate-pulse rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5">
      <div className="mb-4 h-4 w-40 rounded bg-white/10" />
      <div className="h-[calc(100%-2rem)] rounded bg-white/5" />
    </div>
  );
}

export function AdminAnalytics() {
  const [range, setRange] = useState<RangeKey>('7d');

  // queryKey uključuje range → promena filtera automatski šalje novi zahtev.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'stats', range],
    queryFn: () => api.admin.stats(range),
    staleTime: 60_000,
  });

  const analytics = data?.analytics ?? null;
  const hasData = Boolean(analytics && analytics.viewsOverTime.some((d) => d.views > 0));

  const lineData = useMemo(() => {
    if (!analytics) return null;
    return {
      labels: analytics.viewsOverTime.map((d) => formatDay(d.date)),
      datasets: [
        {
          label: 'Pregledi',
          data: analytics.viewsOverTime.map((d) => d.views),
          borderColor: PALETTE.line,
          backgroundColor: (context: any) => {
            // Gradient popuna ispod linije (kanvas context).
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return PALETTE.lineFillFrom;
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, PALETTE.lineFillFrom);
            gradient.addColorStop(1, PALETTE.lineFillTo);
            return gradient;
          },
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    };
  }, [analytics]);

  const lineOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 22, 0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#cbd5e1',
          callbacks: {
            title: (items) => `Pregledi — ${items[0]?.label ?? ''}`,
            label: (item) => ` ${fmt(Number(item.raw))} pregleda`,
          },
        },
      },
      scales: {
        x: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.ticks, maxTicksLimit: 10, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: PALETTE.grid }, ticks: { color: PALETTE.ticks, font: { size: 11 }, callback: (value) => fmt(Number(value)) } },
      },
    }),
    [],
  );

  const topItems = analytics?.topArticles ?? [];
  const barData = useMemo(() => {
    if (!topItems.length) return null;
    const top5 = topItems.slice(0, 5);
    const max = top5[0]?.views ?? 1;
    return {
      labels: top5.map((item) => (item.title.length > 28 ? `${item.title.slice(0, 28)}…` : item.title)),
      datasets: [
        {
          label: 'Pregledi',
          data: top5.map((item) => item.views),
          backgroundColor: PALETTE.bar,
          borderRadius: 6,
          barThickness: 18,
        },
      ],
    };
    // max se koristi samo za procenu — ne u dataset-u
    void max;
  }, [topItems]);

  const barOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y' as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 22, 0.95)',
          titleColor: '#e2e8f0',
          bodyColor: '#cbd5e1',
          callbacks: { label: (item) => ` ${fmt(Number(item.raw))} pregleda` },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: PALETTE.grid }, ticks: { color: PALETTE.ticks, font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: PALETTE.ticks, font: { size: 11 } } },
      },
    }),
    [],
  );

  const doughnutData = useMemo(() => {
    const items = analytics?.retentionOrEngagement ?? [];
    if (!items.length) return null;
    return {
      labels: items.map((item) => item.category),
      datasets: [
        {
          data: items.map((item) => item.views),
          backgroundColor: PALETTE.doughnut,
          borderColor: 'rgba(0,0,0,0.25)',
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };
  }, [analytics]);

  const doughnutOptions = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: PALETTE.ticks, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          backgroundColor: 'rgba(10, 14, 22, 0.95)',
          callbacks: {
            label: (item) => {
              const raw = analytics?.retentionOrEngagement[item.dataIndex];
              return ` ${fmt(Number(item.raw))} (${raw?.percentage ?? 0}%)`;
            },
          },
        },
      },
    }),
    [analytics],
  );

  if (isError) {
    return (
      <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 text-sm text-white/60">
        Analitika trenutno nije dostupna — pokušajte ponovo kasnije.
      </div>
    );
  }

  return (
    <section className="mt-8">
      {/* Header + segmented control */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white/95">
          <BarChart3 className="h-5 w-5 text-[var(--color-accent)]" />
          Analitika pregleda
        </h2>
        <div className="flex rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-1">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${range === option.key
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent-fg,white)]'
                  : 'text-white/60 hover:text-white/90'
                }`}
              aria-pressed={range === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !hasData ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-10 text-center text-sm text-white/50">
          <Eye className="mx-auto mb-3 h-8 w-8 text-white/20" />
          Nema dovoljno podataka za izabrani period.
          <span className="mt-1 block text-xs text-white/35">
            Dnevno praćenje pregleda kreće od deploy-a migracije 25-2.9.0 — podaci se gomilaju od tada.
          </span>
        </div>
      ) : (
        <>
          {/* Overview traka */}
          {analytics?.overview && (
            <div className="mb-4 flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-2">
                <Eye className="h-4 w-4 text-purple-400" />
                Pregledi u periodu: <strong className="text-white">{fmt(analytics.overview.periodViews)}</strong>
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-2">
                {analytics.overview.viewsGrowth >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-400" />
                )}
                Rast: <strong className={analytics.overview.viewsGrowth >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {analytics.overview.viewsGrowth > 0 ? '+' : ''}{analytics.overview.viewsGrowth}%
                </strong>
              </span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Line/Area — pregledi po danu */}
            <ChartCard title="Pregledi po danu" icon={TrendingUp} className="lg:col-span-2">
              <div className="h-72">
                {lineData && <Line data={lineData} options={lineOptions} />}
              </div>
            </ChartCard>

            {/* Doughnut — distribucija */}
            <ChartCard title="Angažovanje po tipu sadržaja" icon={PieChart}>
              <div className="h-72">
                {doughnutData ? <Doughnut data={doughnutData} options={doughnutOptions} /> : (
                  <p className="pt-20 text-center text-xs text-white/40">Nema dovoljno podataka za ovaj period.</p>
                )}
              </div>
            </ChartCard>

            {/* Horizontal Bar — top članci/teme */}
            <ChartCard title="Najčitanije u periodu" icon={Trophy}>
              <div className="h-72">
                {barData ? <Bar data={barData} options={barOptions} /> : (
                  <p className="pt-20 text-center text-xs text-white/40">Nema dovoljno podataka za ovaj period.</p>
                )}
              </div>
            </ChartCard>
          </div>

          {/* Top tabela sa linkovima */}
          {topItems.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-xs uppercase tracking-wide text-white/40">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Naslov</th>
                    <th className="px-4 py-3">Tip</th>
                    <th className="px-4 py-3 text-right">Pregledi</th>
                    <th className="hidden px-4 py-3 text-right sm:table-cell">Udeo</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, index) => {
                    const total = analytics?.overview.periodViews || 1;
                    const share = Math.round((item.views / total) * 1000) / 10;
                    const href = item.kind === 'article' ? `/articles/${item.slug ?? item.id}` : `/forum/thread/${item.slug ?? item.id}`;
                    return (
                      <tr key={item.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-white/[0.03]">
                        <td className="px-4 py-2.5 text-white/40">{index + 1}</td>
                        <td className="max-w-xs truncate px-4 py-2.5">
                          <Link to={href} className="text-white/85 hover:text-[var(--color-accent)] hover:underline">
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-white/50">{item.kind === 'article' ? 'Članak' : 'Tema'}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-white/85">{fmt(item.views)}</td>
                        <td className="hidden px-4 py-2.5 text-right text-white/50 sm:table-cell">{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
