import { useEffect, useState } from 'react';
import { Flame, Loader2, Sparkles, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import type { DailyLoopResponse } from '../../../contracts/index';

/**
 * 5.3 — Dnevni login streak.
 *
 * Streak se računa na serveru iz `user_daily_activity`; prijava je od sada
 * aktivnost (ranije samo post/odgovor), pa član koji svakodnevno čita ne gubi
 * niz. Ovde je samo prikaz — bez lokalnog izračunavanja da UI i server ne
 * mogu da se raziđu.
 */
export function LoginStreakCard() {
  const [data, setData] = useState<DailyLoopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.users
      .daily()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Podaci o streak-u nisu dostupni.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mt-6 rounded-md border-white/10 bg-surface-0 p-4 text-xs text-white/45">{error}</div>
    );
  }

  if (!data) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-md border-white/10 bg-surface-0 p-4 text-xs text-white/50">
        <Loader2 size={13} className="animate-spin" /> Učitavanje streak-a…
      </div>
    );
  }

  const claimed = data.firstLoginToday === true;

  return (
    <div className="mt-6 space-y-3 rounded-md border-white/10 bg-surface-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-bold text-white/85">
            <Flame size={15} /> Dnevni streak
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            Svaka prijava u toku dana produžava niz i donosi bonus XP. Propustiš dan — niz počinje iz početka.
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-orange-500/15 px-2.5 py-1 text-[11px] font-semibold text-orange-300">
          {data.streak} {data.streak === 1 ? 'dan' : 'dana'}
        </span>
      </div>

      <div className="flex items-center gap-1.5" role="img" aria-label={`Aktivnost u poslednjih 7 dana, streak ${data.streak} dana`}>
        {data.days.map((day, index) => {
          const isToday = index === data.days.length - 1;
          return (
            <span
              key={day.date}
              title={day.date}
              className={`h-7 flex-1 rounded-sm border ${
                day.active
                  ? 'border-orange-400/40 bg-orange-500/25'
                  : 'border-white/10 bg-white/[0.03]'
              } ${isToday ? 'ring-1 ring-white/30' : ''}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <Sparkles size={12} />
          {claimed ? 'Današnji login bonus je uzet ✓' : 'Prijavite se da preuzmete današnji bonus'}
        </span>
        <span className="flex items-center gap-1.5">
          <Trophy size={12} /> Najduži niz: {data.bestStreak} dana
        </span>
        <span>XP danas: {data.xpToday}</span>
      </div>
    </div>
  );
}
