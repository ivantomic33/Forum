import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

/**
 * F-10 — baner aktivnih upozorenja moderatora.
 *
 * Ban je poslednja mera; pre njega korisnik dobija upozorenje sa razlogom.
 * Baner stoji iznad profila dok ga korisnik ne potvrdi („razumem“), pa se
 * moderacija ne oslanja na to da je notifikacija pročitana.
 */
export function WarningBanner() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['warnings', user?.id],
    queryFn: () => api.users.warnings(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });

  const ackMutation = useMutation({
    mutationFn: (warningId: string) => api.users.acknowledgeWarning(user!.id, warningId),
    onSuccess: () => {
      toast.success('Upozorenje je potvrđeno.');
      queryClient.invalidateQueries({ queryKey: ['warnings', user?.id] });
    },
    onError: (error: any) => toast.error(error?.message || 'Potvrda nije sačuvana.'),
  });

  const active = (data?.warnings ?? []).filter((warning) => !warning.revokedAt && !warning.acknowledgedAt);
  if (!active.length) return null;

  return (
    <div className="space-y-2" role="alert" aria-label="Upozorenja moderatora">
      {active.slice(0, 3).map((warning) => (
        <div
          key={warning.id}
          className="flex items-start gap-3 rounded-lg border-[var(--color-warning-fg)]/40 bg-[var(--color-warning-glow)] p-3"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--color-warning-fg)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-meta font-semibold text-[var(--color-warning-fg)]">Upozorenje moderatora</p>
            <p className="text-body mt-0.5">{warning.reason}</p>
            <p className="text-micro mt-1">
              {warning.expiresAt
                ? `Važi do ${new Date(warning.expiresAt).toLocaleDateString('sr-Latn-RS')}.`
                : 'Bez roka — moderator ga može opozvati.'}{' '}
              Iznad tri aktivna upozorenja sledi privremeni ban.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ackMutation.mutate(warning.id)}
            disabled={ackMutation.isPending}
            className="ui-icon-btn shrink-0"
            aria-label="Potvrdi da si video upozorenje"
            title="Razumem"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
