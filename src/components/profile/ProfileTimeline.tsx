import { Link } from 'react-router-dom';
import { Activity, ArrowRight, CheckCircle2, MessageSquare, Sparkles, Trophy } from 'lucide-react';
import type { UserActivity } from '../../../contracts/index';

/**
 * 6.x — „POSLEDNJIH 5 POTEZA“ na profilu.
 *
 * Podaci već postoje (`GET /users/:username/activity` — teme, odgovori, bedževi,
 * povezani nalozi), ali su bili sakriveni iza taba. Kratka traka u desnoj
 * koloni daje profilu život i pokazuje aktivnost bez klika. Puni spisak ostaje
 * u tabu „Aktivnost“, ovde je samo vrh.
 */

const ICONS: Record<string, typeof Activity> = {
  thread: MessageSquare,
  reply: MessageSquare,
  badge: Trophy,
  account: Sparkles,
  solved: CheckCircle2,
};

const shortDate = (iso: string | null | undefined) => {
  if (!iso) return 'nedavno';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'nedavno';
  return date.toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short' });
};

export function ProfileTimeline({
  activities,
  username,
  onOpenAll,
}: {
  activities: UserActivity[];
  username: string;
  onOpenAll: () => void;
}) {
  if (!activities?.length) return null;
  const latest = activities.slice(0, 5);

  return (
    <div className="ui-card-static">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
          <Activity size={12} className="text-[var(--color-primary-fg)]" aria-hidden="true" />
          Poslednji potezi
        </span>
        <Link
          to={`/profile/${encodeURIComponent(username)}?tab=activity`}
          onClick={(event) => {
            // Tab se menja bez reload-a — `onOpenAll` hvata klik i pre navigacije.
            event.preventDefault();
            onOpenAll();
          }}
          className="text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-primary-fg)]"
        >
          Sve <ArrowRight size={11} className="inline" aria-hidden="true" />
        </Link>
      </div>

      <ol className="space-y-2.5">
        {latest.map((item) => {
          const Icon = ICONS[item.type] ?? Activity;
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 text-[var(--color-text-tertiary)]" aria-hidden="true">
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[12.5px] leading-snug text-[var(--color-text-secondary)]">
                  {item.text}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-text-disabled)]">
                {shortDate(item.date)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
