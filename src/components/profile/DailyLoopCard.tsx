import { useQuery } from '@tanstack/react-query';
import { Flame, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { Card, CardHeader, Skeleton, cn } from '../ui';

/**
 * F-2 — dnevni loop na profilu.
 *
 * Sedam kvadrata = poslednjih 7 dana; streak raste svakog dana sa bar jednom
 * objavom. Dnevni kvest („odgovori na 1 temu danas“) je vidljiv odmah na vrhu,
 * pa korisnik ne mora da traži tab „Kvestovi“ da bi znao šta mu je sledeće.
 *
 * Komponenta se vraća `null` za goste i kad API nije dostupan — dnevni loop je
 * dodatak, ne sme da razbije profil.
 */
export function DailyLoopCard({ isOwner, username }: { isOwner: boolean; username: string }) {
  const { isAuthenticated } = useAuthStore();
  const enabled = isOwner && isAuthenticated;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['daily-loop'],
    queryFn: () => api.users.daily(),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled || isError) return null;
  if (isLoading || !data) {
    return (
      <Card variant="static">
        <CardHeader title="Dnevni ritam" />
        <div className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Card>
    );
  }

  const activeDays = data.days.filter((day) => day.active).length;

  return (
    <Card variant="static">
      <CardHeader
        title="Dnevni ritam"
        icon={<Flame size={15} className="text-[var(--color-warning-fg)]" aria-hidden="true" />}
        action={
          <span className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
            {data.streak} <span className="text-micro font-normal text-[var(--color-text-muted)]">dana</span>
          </span>
        }
      />
      <div className="space-y-4 p-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-[var(--color-text-tertiary)]">Poslednjih 7 dana</span>
            <span className="text-micro">{activeDays}/7 aktivnih</span>
          </div>
          <ol className="mt-2 flex items-end gap-1.5" aria-label="Aktivnost u poslednjih sedam dana">
            {data.days.map((day, index) => {
              const isToday = index === data.days.length - 1;
              return (
                <li key={day.date} className="flex-1">
                  <div
                    className={cn(
                      'h-9 rounded-md border transition-colors',
                      day.active
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-glow)]'
                        : 'border-[var(--color-border-default)] bg-[var(--color-surface-2)]',
                      isToday && 'ring-1 ring-[var(--color-primary-fg)]/40',
                    )}
                    title={`${new Date(`${day.date}T00:00:00`).toLocaleDateString('sr-Latn-RS', { weekday: 'short', day: 'numeric', month: 'numeric' })}${day.active ? ' — aktivno' : ''}`}
                  >
                    <span className="sr-only">
                      {new Date(`${day.date}T00:00:00`).toLocaleDateString('sr-Latn-RS')}: {day.active ? 'aktivno' : 'bez aktivnosti'}
                    </span>
                  </div>
                  <span className="text-micro mt-1 block text-center text-[var(--color-text-muted)]">
                    {new Date(`${day.date}T00:00:00`).toLocaleDateString('sr-Latn-RS', { weekday: 'narrow' })}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {data.quest && (
          <div className="rounded-lg border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-2">
              <Target size={14} className={data.quest.completed ? 'text-[var(--color-success-fg)]' : 'text-[var(--color-primary-fg)]'} aria-hidden="true" />
              <span className="text-meta font-medium text-[var(--color-text-primary)]">{data.quest.title}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
                  style={{ width: `${Math.min(100, (data.quest.progress / data.quest.target) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-micro tabular-nums text-[var(--color-text-muted)]">
                {data.quest.progress}/{data.quest.target}
              </span>
            </div>
            {!data.quest.completed && (
              <Link to="/forum" className="text-micro mt-2 inline-block text-[var(--color-primary-fg)] hover:underline">
                Idi na forum i odgovori danas →
              </Link>
            )}
            {data.quest.completed && (
              <p className="text-micro mt-2 text-[var(--color-success-fg)]">Završeno — novi kvest stiže sutra.</p>
            )}
          </div>
        )}

        <div className="text-micro flex items-center justify-between">
          <span>Danas: +{data.xpToday} XP</span>
          <span>Najbolji: {data.bestStreak} dana</span>
        </div>
        {!data.firstPostToday && (
          <p className="text-micro text-[var(--color-text-muted)]">
            Prva objava danas donosi bonus XP — <Link to="/forum" className="text-[var(--color-primary-fg)] hover:underline">otvori temu</Link>.
          </p>
        )}
        <span className="sr-only">Profil {username}</span>
      </div>
    </Card>
  );
}
