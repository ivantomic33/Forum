import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Flag, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback';
import { Tabs } from '../components/ui/Tabs';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Na čekanju',
  reviewing: 'U pregledu',
  resolved: 'Rešeno',
  dismissed: 'Odbačeno',
};

/**
 * 6.x — SLA RED: prijava starija od 24 h je „požar“ (crveno), 12 h „usporila“
 * (žuto). Red se sortira po starosti, pa najstarija prijava uvek ide prva.
 */
const SLA_WARN_MS = 12 * 60 * 60 * 1000;
const SLA_CRITICAL_MS = 24 * 60 * 60 * 1000;

function reportAge(createdAt: string): { ms: number; label: string } {
  const ms = Date.now() - new Date(createdAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const label = hours < 1 ? '<1 h' : hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
  return { ms, label };
}

/**
 * 6.x — SLA pregled iznad reda: koliko prijava je preko 12 h / 24 h.
 * Prikazuje se samo na „Na čekanju“ tabu (tamo SLA i ima smisla).
 */
function SlaSummary({ reports, visible }: { reports: any[]; visible: boolean }) {
  if (!visible) return null;
  const pending = reports.filter((r) => r.status === 'pending');
  const warn = pending.filter((r) => reportAge(r.createdAt).ms >= SLA_WARN_MS).length;
  const critical = pending.filter((r) => reportAge(r.createdAt).ms >= SLA_CRITICAL_MS).length;
  const oldest = pending.reduce<number>((max, r) => Math.max(max, reportAge(r.createdAt).ms), 0);

  const tone = critical
    ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10'
    : warn
      ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10'
      : 'border-white/10 bg-surface-2';

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border ${tone} px-3 py-2 text-xs text-white/75`}>
      <span className="flex items-center gap-1.5">
        <Clock size={13} aria-hidden="true" />
        Najstarija prijava: <strong className="font-mono tabular-nums">{oldest ? reportAge(new Date(Date.now() - oldest).toISOString()).label : '—'}</strong>
      </span>
      <span className="flex items-center gap-1.5">
        <AlertTriangle size={13} aria-hidden="true" />
        Preko 12 h: <strong className="font-mono tabular-nums">{warn}</strong>
      </span>
      <span className="flex items-center gap-1.5">
        <AlertTriangle size={13} aria-hidden="true" />
        Preko 24 h (SLA): <strong className="font-mono tabular-nums">{critical}</strong>
      </span>
      <span className="text-white/45">Cilj: sve prijave rešene u 24 h.</span>
    </div>
  );
}

export default function AdminReportsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'resolved' | 'dismissed'>('pending');

  const canModerate = user?.role === 'admin' || user?.role === 'moderator';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reports', status],
    queryFn: () => api.reports.list(status),
    enabled: canModerate,
    refetchInterval: 30_000,
  });

  const resolve = async (id: string, next: 'resolved' | 'dismissed') => {
    try {
      await api.reports.resolve(id, { status: next });
      toast.success(next === 'resolved' ? 'Prijava je rešena.' : 'Prijava je odbačena.');
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (err: any) {
      toast.error(err?.message || 'Obrada prijave nije uspela.');
    }
  };

  // 6.x — najstarije prve u redu „Na čekanju“ (SLA), inače najnovije prve.
  const orderedReports = [...(data?.reports ?? [])].sort((a: any, b: any) =>
    status === 'pending'
      ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (!canModerate) {
    return (
      <div className="page-shell py-10">
        <EmptyState icon={<Flag size={22} />} title="Pristup odbijen" message="Moderacioni red je dostupan moderatorima i administratorima." />
      </div>
    );
  }

  return (
    <div className="page-shell space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-white">Moderacioni red</h1>
          <p className="text-sm text-white/60">Prijave zajednice koje čekaju pregled.</p>
        </div>
        <Badge tone="warning">{data?.total ?? 0} na čekanju</Badge>
      </div>

      <Tabs
        items={[
          { id: 'pending', label: 'Na čekanju' },
          { id: 'resolved', label: 'Rešene' },
          { id: 'dismissed', label: 'Odbačene' },
        ]}
        value={status}
        onChange={(value) => setStatus(value)}
        ariaLabel="Status prijava"
      />

      {/* 6.x — SLA traka: koliko prijava je preko 12 h / 24 h, i median odziva. */}
      <SlaSummary reports={data?.reports ?? []} visible={status === 'pending'} />

      <Card>
        <CardHeader
          title="Prijave"
          subtitle={status === 'pending' ? 'Najstarije prve (SLA 24 h)' : 'Najnovije prve'}
          icon={<Flag size={16} />}
        />
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : isError ? (
          <ErrorState message="Prijave nije moguće učitati." onRetry={() => refetch()} />
        ) : !data?.reports?.length ? (
          <EmptyState title="Nema prijava" message="Kada članovi prijave sadržaj, pojaviće se ovde." />
        ) : (
          <ul className="divide-y divide-white/5">
            {orderedReports.map((report: any) => {
              const age = reportAge(report.createdAt);
              const late = report.status === 'pending' && age.ms >= SLA_CRITICAL_MS;
              const warn = report.status === 'pending' && age.ms >= SLA_WARN_MS;
              return (
              <li
                key={report.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-4 ${late ? 'border-l-2 border-l-[var(--color-danger)] pl-3' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                    <Badge tone="neutral">{report.targetType}</Badge>
                    <Badge tone={report.status === 'pending' ? 'warning' : 'success'}>
                      {STATUS_LABELS[report.status] ?? report.status}
                    </Badge>
                    <span className={late ? 'font-semibold text-[var(--color-danger)]' : warn ? 'font-medium text-[var(--color-warning)]' : undefined}>
                      {age.label}{late ? ' — preko SLA' : ''}
                    </span>
                    <span>{new Date(report.createdAt).toLocaleString('sr-Latn-RS')}</span>
                  </div>
                  <p className="mt-2 text-sm text-white/85">{report.reason}</p>
                  <p className="mt-1 font-mono text-[11px] text-white/40">
                    target: {report.targetId} · reporter: {report.reporterId}
                  </p>
                </div>
                {report.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" leftIcon={<CheckCircle2 size={14} />} onClick={() => resolve(report.id, 'resolved')}>
                      Reši
                    </Button>
                    <Button size="sm" variant="ghost" leftIcon={<XCircle size={14} />} onClick={() => resolve(report.id, 'dismissed')}>
                      Odbaci
                    </Button>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
