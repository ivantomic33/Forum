import { useState } from 'react';
import { BarChart3, Check, Loader2 } from 'lucide-react';
import { api, type PollResult } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { cn } from '../ui';
import { toast } from 'sonner';
/**
 * PollWidget — interaktivna anketa sa glasanjem i rezultatima.
 * Rezultati su vidljivi posle glasanja (ili ako korisnik nije prijavljen),
 * glas po korisniku se čuva na serveru.
 */
export default function PollWidget({ threadId, poll: initial }: { threadId: string; poll: PollResult }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [poll, setPoll] = useState<PollResult>(initial);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasVoted = poll.myVote !== null;
  const showResults = hasVoted || !isAuthenticated;

  const vote = async (optionIndex: number) => {
    if (!isAuthenticated) {
      toast.error('Prijavi se da bi glasao u anketi.');
      return;
    }
    if (hasVoted) return;
    setPending(optionIndex);
    setError(null);
    try {
      const result = await api.forum.votePoll(threadId, optionIndex);
      setPoll(result);
    } catch (err: any) {
      setError(err?.message || 'Glas nije zabeležen.');
    } finally {
      setPending(null);
    }
  };

  return (
    <section
      className="mt-7 rounded-lg border border-white/[0.09] bg-surface-2 p-4 sm:p-5"
      aria-labelledby={`poll-${threadId}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BarChart3 size={15} className="text-[var(--color-primary-fg)]" aria-hidden="true" />
        <h2 id={`poll-${threadId}`} className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/50">
          Anketa
        </h2>
        <span className="font-mono text-[11px] text-white/35">
          · {poll.totalVotes} {poll.totalVotes === 1 ? 'glas' : 'glasova'}
        </span>
      </div>

      <p className="mb-4 font-display text-[15px] font-semibold leading-snug text-white">{poll.question}</p>

      <div className="poll-widget">
        {poll.options.map((option) => {
          const mine = poll.myVote === option.index;
          return (
            <button
              key={option.index}
              type="button"
              className={cn('poll-option', mine && 'is-mine')}
              onClick={() => vote(option.index)}
              disabled={hasVoted || pending !== null || !isAuthenticated}
              aria-pressed={mine}
            >
              {showResults && <span className="poll-option-fill" style={{ width: `${option.percent}%` }} aria-hidden="true" />}
              <span className="poll-option-content">
                {mine && <Check size={14} className="flex-shrink-0 text-[var(--color-primary-hover)]" aria-hidden="true" />}
                <span className={mine ? 'font-medium text-white' : undefined}>{option.label}</span>
                {pending === option.index && <Loader2 size={14} className="animate-spin text-[var(--color-primary-hover)]" aria-hidden="true" />}
              </span>
              {showResults && (
                <span className="poll-option-percent">
                  {option.percent}% <span className="text-white/40">({option.votes})</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!isAuthenticated && (
        <p className="mt-3 text-xs text-white/45">Prijavi se da bi učestvovao u anketi.</p>
      )}
      {hasVoted && <p className="mt-3 text-xs text-emerald-400">Hvala — tvoj glas je zabeležen.</p>}
      {error && (
        <p className="mt-3 text-xs text-rose-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
