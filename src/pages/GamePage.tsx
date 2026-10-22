import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Gamepad2, ImagePlus, Plus, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { DealCard, DealWarning } from '../components/deals/DealCard';
import { DealForm } from '../components/deals/DealForm';
import { formatPrice } from '../components/deals/dealUtils';

/**
 * `/games/:slug` — Game Page.
 *
 * Namerno minimalno: identitet igre (cover, naslov, datum) + **aktivni deals**.
 * Diskusije i LFG se kasnije kače kao nove sekcije bez menjanja ove rute.
 */
export default function GamePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['game', slug],
    queryFn: () => api.games.get(slug),
    enabled: Boolean(slug),
  });

  const game = data?.game;
  const deals = data?.deals ?? [];

  usePageMeta({
    title: game ? `${game.title} — najbolji popusti` : 'Igra',
    description: game
      ? `Aktivni popusti za ${game.title}: gde je najjeftinije, cene po prodavnicama i glasovi zajednice.`
      : 'Igra sa aktivnim popustima.',
    path: `/games/${slug}`,
    image: game?.coverUrl ?? undefined,
  });

  const bestPrice = deals.length ? Math.min(...deals.map((deal) => deal.price)) : null;

  const openForm = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/games/${slug}` } });
      return;
    }
    setFormOpen(true);
  };

  /**
   * 2.6.2 — staff može da zameni cover (upload u Storage). Bez IGDB ključa
   * katalog ostaje bez slika, pa je ovo jedini put do vizuala na Game Page-u.
   */
  const uploadCover = async (file: File | undefined) => {
    if (!file || coverBusy) return;
    setCoverBusy(true);
    try {
      const uploaded = await api.uploads.image('cover', file);
      await api.games.setCover(slug, uploaded.url);
      await queryClient.invalidateQueries({ queryKey: ['game', slug] });
      await queryClient.invalidateQueries({ queryKey: ['games'] });
      toast.success('Cover je ažuriran.');
    } catch (err: any) {
      toast.error(err?.message || 'Cover nije sačuvan.');
    } finally {
      setCoverBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-5xl">
          <div className="flex flex-col gap-6 sm:flex-row" aria-busy="true">
            <Skeleton className="aspect-[3/4] w-full max-w-[200px] rounded-xl" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !game) {
    return (
      <div className="section">
        <div className="container max-w-2xl">
          <ErrorState title="Igra nije pronađena" message="Ova igra još nema stranicu na NEXUS-u." onRetry={() => refetch()}>
            <Link to="/deals" className="text-sm text-cyan-300 hover:text-cyan-200">
              ← Svi popusti
            </Link>
          </ErrorState>
        </div>
      </div>
    );
  }

  const currency = deals[0]?.currency ?? 'EUR';

  return (
    <div className="section">
      <div className="container max-w-5xl">
        <nav className="crumbs mb-5" aria-label="Putanja">
          <Link to="/deals">Popusti</Link>
          <span className="sep" aria-hidden="true">/</span>
          <Link to="/games">Igre</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="text-white/80">{game.title}</span>
        </nav>

        <header className="mb-8 flex flex-col gap-6 border-b border-white/[0.07] pb-8 sm:flex-row">
          <div className="w-full max-w-[190px] shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-surface-2">
            {game.coverUrl ? (
              <img src={game.coverUrl} alt={`${game.title} cover`} className="aspect-[3/4] w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/4] items-center justify-center text-white/20">
                <Gamepad2 size={40} aria-hidden="true" />
              </div>
            )}
            {isStaff && (
              <label className="flex cursor-pointer items-center justify-center gap-1.5 border-t border-white/[0.08] px-2 py-1.5 text-[11px] text-white/60 transition hover:bg-white/[0.04] hover:text-white">
                <ImagePlus size={12} aria-hidden="true" />
                {coverBusy ? 'Otpremam…' : game.coverUrl ? 'Zameni cover' : 'Dodaj cover'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={coverBusy}
                  onChange={(event) => void uploadCover(event.target.files?.[0])}
                />
              </label>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <span className="eyebrow mb-2">Game Page</span>
            <h1 className="page-title">{game.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/55">
              {game.releaseDate && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} aria-hidden="true" />
                  {new Date(game.releaseDate).toLocaleDateString('sr-Latn-RS', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              )}
              <Badge tone="success">
                <Tag size={11} aria-hidden="true" />
                {deals.length} {deals.length === 1 ? 'aktivan deal' : 'aktivnih deal-ova'}
              </Badge>
              {bestPrice !== null && (
                <Badge tone="primary">
                  Najniže: {formatPrice(bestPrice, currency)}
                </Badge>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={openForm} leftIcon={<Plus size={14} />}>
                Objavi deal za ovu igru
              </Button>
              <Link to={`/deals?search=${encodeURIComponent(game.title)}`} className="ui-btn br-secondary ui-btn-sm">
                Svi dealovi u zajednici
              </Link>
            </div>

            <div className="mt-5">
              <DealWarning />
            </div>
          </div>
        </header>

        <section aria-labelledby="game-deals-heading">
          <div className="section-head mb-4">
            <div className="section-head-main">
              <span className="eyebrow">Popusti</span>
              <h2 id="game-deals-heading" className="section-title">Aktivni deals za ovu igru</h2>
            </div>
          </div>

          {deals.length === 0 ? (
            <EmptyState
              icon={<Tag size={22} />}
              title="Trenutno nema aktivnih popusta"
              message="Pronašli ste akciju? Podelite je i pomozite drugima da kupe jeftinije."
              action={
                <Button size="sm" onClick={openForm} leftIcon={<Plus size={14} />}>
                  Objavi deal
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4">
              {deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} invalidateKeys={[['deals'], ['game', slug]]} />
              ))}
            </div>
          )}
        </section>
      </div>

      <DealForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        presetGame={{ id: game.id, slug: game.slug, title: game.title, coverUrl: game.coverUrl, releaseDate: game.releaseDate, igdbId: game.igdbId }}
        invalidateKeys={[['deals'], ['game', slug], ['games']]}
      />
    </div>
  );
}
