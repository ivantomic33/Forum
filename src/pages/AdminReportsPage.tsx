import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Flag, XCircle } from 'lucide-react';
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

      <Card>
        <CardHeader title="Prijave" subtitle="Najnovije prve" icon={<Flag size={16} />} />
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : isError ? (
          <ErrorState message="Prijave nije moguće učitati." onRetry={() => refetch()} />
        ) : !data?.reports?.length ? (
          <EmptyState title="Nema prijava" message="Kada članovi prijave sadržaj, pojaviće se ovde." />
        ) : (
          <ul className="divide-y divide-white/5">
            {data.reports.map((report: any) => (
              <li key={report.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                    <Badge tone="neutral">{report.targetType}</Badge>
                    <Badge tone={report.status === 'pending' ? 'warning' : 'success'}>
                      {STATUS_LABELS[report.status] ?? report.status}
                    </Badge>
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
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
