import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import type { Game, PriceWatch } from '../../../contracts/index';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../ui';
import { formatPrice } from './dealUtils';

/**
 * F-4 — „Prati cenu“ na Game Page-u.
 *
 * Korisnik prati IGRU (ne pojedinačni deal) i zadaje prag. Kada se pojavi
 * deal ispod praga, server šalje IN-APP notifikaciju (throttle 24 h po
 * korisniku i igri) — mejl notifikacije su ugašene.
 * Ako već prati istu igru, dugme menja prag (nema duplih praćenja).
 */
export function PriceWatchButton({
  game,
  bestPrice,
  currency,
}: {
  game: Pick<Game, 'id' | 'slug' | 'title'>;
  bestPrice: number | null;
  currency: string;
}) {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Podrazumevano: 20% ispod trenutno najniže cene (ili slobodan unos).
  const suggested = bestPrice !== null ? Math.max(1, Math.round(bestPrice * 0.8 * 100) / 100) : 20;
  const [target, setTarget] = useState(suggested.toFixed(2));

  const { data } = useQuery({
    queryKey: ['price-watches'],
    queryFn: () => api.deals.watches(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const existing: PriceWatch | undefined = data?.watches.find(
    (watch) => watch.gameId === game.id || (game.slug && watch.gameSlug === game.slug),
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      api.deals.watch({
        gameId: game.id,
        gameSlug: game.slug,
        gameTitle: game.title,
        targetPrice: Number(target.replace(',', '.')),
        currency,
      }),
    onSuccess: (result) => {
      toast.success(
        result.updated
          ? `Prag je ažuriran na ${formatPrice(result.watch.targetPrice, result.watch.currency)}.`
          : 'Pratimo cenu — javljamo u notifikacijama kada padne ispod praga.',
      );
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['price-watches'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Praćenje nije sačuvano.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.deals.unwatch(existing!.id),
    onSuccess: () => {
      toast.success('Praćenje cene je prekinuto.');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['price-watches'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Praćenje nije uklonjeno.'),
  });

  const onClick = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/games/${game.slug}` } });
      return;
    }
    setTarget((existing?.targetPrice ?? suggested).toFixed(2));
    setOpen((value) => !value);
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant={existing ? 'primary' : 'secondary'}
        onClick={onClick}
        aria-expanded={open}
        leftIcon={existing ? <Bell size={14} /> : <BellOff size={14} />}
      >
        {existing ? `Pratim ispod ${formatPrice(existing.targetPrice, existing.currency)}` : 'Prati cenu'}
      </Button>

      {open && (
        <form
          className="absolute left-0 top-full z-20 mt-2 w-72 rounded-xl border-white/[0.10] bg-surface-1 p-4 shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(target.replace(',', '.'));
            if (!Number.isFinite(value) || value <= 0) {
              toast.error('Unesite cenu veću od nule.');
              return;
            }
            saveMutation.mutate();
          }}
        >
          <label htmlFor="price-watch-target" className="text-label block text-white/60">
            Obavesti me kada cena padne ispod
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="price-watch-target"
              type="text"
              inputMode="decimal"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="ui-field flex-1 font-mono tabular-nums"
              aria-describedby="price-watch-hint"
            />
            <span className="font-mono text-sm text-white/50">{currency}</span>
          </div>
          <p id="price-watch-hint" className="text-micro mt-2 text-white/40">
            {bestPrice !== null
              ? `Trenutno najniže: ${formatPrice(bestPrice, currency)}.`
              : 'Još nema aktivnih deal-ova za ovu igru.'}{' '}
            Najviše jedno obaveštenje dnevno (u aplikaciji).
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" size="sm" loading={saveMutation.isPending}>
              {existing ? 'Sačuvaj prag' : 'Prati cenu'}
            </Button>
            {existing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                loading={removeMutation.isPending}
                onClick={() => removeMutation.mutate()}
              >
                Prekini
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
