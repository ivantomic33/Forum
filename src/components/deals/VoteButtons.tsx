import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Deal } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../ui';

interface VoteButtonsProps {
  deal: Pick<Deal, 'id' | 'score' | 'authorId' | 'myVote'>;
  /** `sm` za kartice u gridu, `md` za detalj deal-a. */
  size?: 'sm' | 'md';
  /** Za Game Page / profil — drugačiji invalidate posle glasa. */
  invalidateKeys?: string[][];
  className?: string;
}

/**
 * Upvote/downvote za deal — optimistic update.
 *
 * Pravilo (isto kao server): autor ne glasa za sebe; glas mora biti „up“/„down“,
 * a ponovni klik na isti smer povlači glas (`null`). Na 401/403 vraćamo
 * prethodno stanje i prikažemo poruku — UI nikad ne tvrdi da je glas sačuvan
 * ako server nije potvrdio.
 */
export function VoteButtons({ deal, size = 'sm', invalidateKeys = [['deals']], className }: VoteButtonsProps) {
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();

  // Optimistic lokalno stanje; resetuje se kada stigne svež deal iz keša.
  const [optimistic, setOptimistic] = useState<{ score: number; myVote: 'up' | 'down' | null } | null>(null);
  const score = optimistic?.score ?? deal.score;
  const myVote = optimistic?.myVote ?? deal.myVote ?? null;

  const isOwn = user?.id === deal.authorId;

  const mutation = useMutation({
    mutationFn: (direction: 'up' | 'down' | null) => api.deals.vote(deal.id, direction),
    onSuccess: (result) => {
      setOptimistic({ score: result.score, myVote: result.myVote });
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    },
    onError: (error: any) => {
      setOptimistic(null);
      if (error?.status === 401) toast.error('Prijavite se da biste glasali.');
      else toast.error(error?.message || 'Glas nije sačuvan. Pokušajte ponovo.');
    },
  });

  const handleVote = (direction: 'up' | 'down') => {
    if (!isAuthenticated) {
      toast.error('Prijavite se da biste glasali.');
      return;
    }
    if (isOwn) {
      toast.error('Ne možete glasati za sopstveni deal.');
      return;
    }
    const next = myVote === direction ? null : direction;
    // Optimistic: menjamo odmah, a server potvrđuje stvarni score.
    const previous = { score, myVote };
    const prevDelta = previous.myVote === 'up' ? 1 : previous.myVote === 'down' ? -1 : 0;
    const nextDelta = next === 'up' ? 1 : next === 'down' ? -1 : 0;
    setOptimistic({ score: previous.score - prevDelta + nextDelta, myVote: next });
    mutation.mutate(next, {
      onError: () => setOptimistic(previous),
    });
  };

  const iconSize = size === 'md' ? 18 : 13;
  const buttonSize = size === 'md' ? 'h-8 w-8' : 'h-6 w-6';

  return (
    <div
      className={cn('vote-box shrink-0', size === 'md' && 'gap-0.5 p-1', className)}
      aria-label={`Ocena deal-a: ${score}`}
    >
      <button
        type="button"
        onClick={() => handleVote('up')}
        disabled={mutation.isPending || isOwn}
        aria-label={myVote === 'up' ? 'Povuci pozitivan glas' : 'Pozitivan glas'}
        aria-pressed={myVote === 'up'}
        title={isOwn ? 'Ne možete glasati za sopstveni deal' : 'Koristan deal'}
        className={cn('vote-btn is-up', buttonSize, myVote === 'up' && 'is-up')}
      >
        <ChevronUp size={iconSize} strokeWidth={2.5} />
      </button>
      <span className={cn('vote-count', size === 'md' && 'text-sm')} title="Ukupan broj glasova">
        {score > 0 ? `+${score}` : score}
      </span>
      <button
        type="button"
        onClick={() => handleVote('down')}
        disabled={mutation.isPending || isOwn}
        aria-label={myVote === 'down' ? 'Povuci negativan glas' : 'Negativan glas'}
        aria-pressed={myVote === 'down'}
        title={isOwn ? 'Ne možete glasati za sopstveni deal' : 'Loš / lažan deal'}
        className={cn('vote-btn is-down', buttonSize, myVote === 'down' && 'is-down')}
      >
        <ChevronDown size={iconSize} strokeWidth={2.5} />
      </button>
    </div>
  );
}
