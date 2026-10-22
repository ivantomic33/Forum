import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gamepad2, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, EmptyState, ErrorState, SkeletonCard } from '../components/ui';

/** `/games` — igre koje imaju aktivne popuste (ulaz u Game Pages). */
export default function GamesPage() {
  usePageMeta({
    title: 'Igre i popusti',
    description: 'Sve igre sa aktivnim popustima koje je objavila NEXUS zajednica.',
    path: '/games',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['games', 'with-deals'],
    queryFn: () => api.games.list(48),
  });

  const games = data?.games ?? [];

  return (
    <div className="section">
      <div className="container">
        <header className="mb-8 border-b border-white/[0.07] pb-7">
          <span className="eyebrow mb-3">Game Pages</span>
          <h1 className="page-title">Igre sa aktivnim popustima</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/55">
            Svaka igra ima svoju stranicu sa najnovijim deal-ovima. Otvorite igru da vidite gde je trenutno najjeftinija.
          </p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <SkeletonCard key={item} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Igre nije moguće učitati" message="Pokušaj ponovo za koji trenutak." onRetry={() => refetch()} />
        ) : games.length === 0 ? (
          <EmptyState
            icon={<Gamepad2 size={22} />}
            title="Još nema igara sa popustima"
            message="Kada neko objavi deal, igra će se pojaviti ovde sa svojom stranicom."
            action={
              <Link to="/deals" className="ui-btn br-primary ui-btn-sm">
                Idi na popuste
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {games.map((game) => (
              <Link
                key={game.id}
                to={`/games/${game.slug}`}
                className="group overflow-hidden rounded-lg border border-white/[0.08] bg-surface-1 transition hover:border-cyan-400/30 hover:shadow-[var(--shadow-hover)]"
              >
                {game.coverUrl ? (
                  <img
                    src={game.coverUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex aspect-[3/4] items-center justify-center bg-surface-2 text-white/20">
                    <Gamepad2 size={30} aria-hidden="true" />
                  </div>
                )}
                <div className="p-3">
                  <div className="line-clamp-2 min-h-[2.4em] text-[13px] font-medium leading-snug text-white group-hover:text-cyan-200">
                    {game.title}
                  </div>                  <Badge tone="success" className="mt-2 !text-[10px]">
                    <Tag size={10} aria-hidden="true" />
                    {game.activeDeals} {game.activeDeals === 1 ? 'deal' : 'deal-ova'}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
