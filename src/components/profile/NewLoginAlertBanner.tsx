import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Button } from '../ui';

/**
 * 6.x — „NISAM JA“ BANER u Bezbednosti.
 *
 * Kada server pošalje `warning` notifikaciju o novoj prijavi (`metadata.security
 * = 'new_login'`), korisnik sa linka dospeva ovde. Baner izdvaja tu poruku iz
 * opšteg inboxa i daje AKCIJU: „Odjavi sve uređaje“ — bez kopanja po meniju.
 *
 * Prikazuje se samo ako u poslednja 24 h ima takve notifikacije i ako je još
 * nije obradila (nepročitana). Ne blokira ništa i ne skriva ostale sekcije.
 */

const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function NewLoginAlertBanner() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['notifications', 'security-alert'],
    queryFn: () => api.notifications.list({ limit: 20 }),
    staleTime: 30_000,
  });

  const alert = useMemo(() => {
    const items = data?.notifications ?? [];
    return items.find((item) => {
      const meta = item.metadata as { security?: string } | undefined;
      if (meta?.security !== 'new_login') return false;
      return Date.now() - new Date(item.createdAt).getTime() < REPEAT_WINDOW_MS;
    });
  }, [data]);

  if (!alert) return null;

  const device = (alert.metadata as { device?: string } | undefined)?.device ?? 'nepoznat uređaj';

  const revokeAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.auth.revokeAllSessions();
      toast.success('Odjavljeni ste sa svih uređaja. Prijavite se ponovo.');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // Server je poništio i ovu sesiju — najsigurnije je otići na prijavu.
      window.location.assign('/login');
    } catch (error: any) {
      toast.error(error?.message || 'Odjava nije uspela. Promeni lozinku kao dodatnu meru.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-meta font-medium text-[var(--color-text-primary)]">Nova prijava na tvoj nalog</p>
            <p className="text-micro mt-0.5 break-words">{alert.message}</p>
            <p className="text-micro mt-1 text-[var(--color-text-tertiary)]">Uređaj: {device}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void revokeAll()}>
            Nisam ja — odjavi sve
          </Button>
        </div>
      </div>
    </div>
  );
}
