import { useState } from 'react';
import { Gamepad2, Loader2, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Card, CardHeader } from '../ui';

/**
 * #5 — GG Guestbook: drugi članovi ostavljaju jednu "GG" poruku na profilu.
 * Jedna poruka po autoru (upsert), autor može da je obriše. Vlasnik ne može
 * da piše sebi — server to i odbija, ali dugme se ne prikazuje.
 */
export function ProfileGuestbook({ username }: { username: string }) {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const query = useQuery({
    queryKey: ['guestbook', username],
    queryFn: () => api.users.guestbook(username),
  });

  const isOwner = Boolean(currentUser && currentUser.username.toLowerCase() === username.toLowerCase());
  const mine = query.data?.entries.find((e) => e.authorUserId === currentUser?.id);

  const signMutation = useMutation({
    mutationFn: async (text: string) => api.users.signGuestbook(username, text),
    onSuccess: () => {
      setMessage('');
      toast.success('GG je ostavljen! 🎮');
      queryClient.invalidateQueries({ queryKey: ['guestbook', username] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Nije moguće ostaviti GG.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.users.unsignedGuestbook(username),
    onSuccess: () => {
      toast.info('Tvoj GG je uklonjen.');
      queryClient.invalidateQueries({ queryKey: ['guestbook', username] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Brisanje nije uspelo.'),
  });

  const entries = query.data?.entries ?? [];

  return (
    <Card variant="static">
      <CardHeader
        title="GG zid"
        subtitle={`Drug_i članovi ostavljaju jednu GG poruku na profilu. ${entries.length ? `${entries.length} poruka.` : ''}`}
        icon={<Gamepad2 size={15} className="text-white/35" aria-hidden="true" />}
      />

      {!isOwner && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = message.trim();
            if (text) signMutation.mutate(text);
          }}
        >
          <input
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={200}
            placeholder={mine ? 'Izmeni svoju GG poruku…' : 'Ostavi GG ovom igraču…'}
            className="ui-field flex-1"
            aria-label="GG poruka"
          />
          <button
            type="submit"
            className="ui-btn br-secondary ui-btn-sm shrink-0"
            disabled={signMutation.isPending || !message.trim()}
          >
            {signMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'GG!'}
          </button>
        </form>
      )}

      {query.isLoading && <p className="text-xs text-[var(--color-text-muted)]">Učitavanje…</p>}

      {!query.isLoading && entries.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {isOwner ? 'Još niko nije ostavio GG na tvom profilu.' : 'Budi prvi — ostavi GG!'}
        </p>
      )}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3 rounded-md border border-white/[0.07] bg-surface-1 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {entry.authorAvatar && (
                  <img src={entry.authorAvatar} alt="" className="h-5 w-5 rounded-full object-cover" loading="lazy" />
                )}
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">{entry.author}</span>
                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('sr-Latn-RS') : ''}
                </span>
              </div>
              <p className="mt-1 break-words text-[13px] leading-relaxed text-[var(--color-text-secondary)]">{entry.message}</p>
            </div>
            {currentUser?.id === entry.authorUserId && (
              <button
                type="button"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition hover:text-[var(--color-tertiary)]"
                aria-label="Ukloni svoju GG poruku"
              >
                {removeMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
