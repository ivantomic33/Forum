import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, ExternalLink, Gamepad2, ShieldCheck, Store, Trash2, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { usePageMeta } from '../lib/pageMeta';
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton } from '../components/ui';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { ReportButton } from '../components/ReportButton';
import { VoteButtons } from '../components/deals/VoteButtons';
import { DealWarning } from '../components/deals/DealCard';
import {
  discountTone,
  formatPrice,
  hostLabel,
  isDealExpired,
  isExpiringSoon,
  platformLabel,
  timeAgo,
  timeLeft,
} from '../components/deals/dealUtils';

/** `/deals/:id` — detalj deal-a: dokaz, opis, glasanje, prijava i moderacija. */
export default function DealPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['deal', id, user?.id ?? 'guest'],
    queryFn: () => api.deals.get(id),
    enabled: Boolean(id),
  });

  const deal = data?.deal;
  const isStaff = user?.role === 'admin' || user?.role === 'moderator';
  const canManage = Boolean(deal && user && (deal.authorId === user.id || isStaff));

  usePageMeta({
    title: deal ? `${deal.title} — ${deal.discountPct}% popust` : 'Deal',
    description: deal
      ? `${deal.title}: ${formatPrice(deal.price, deal.currency)} umesto ${formatPrice(deal.originalPrice, deal.currency)} (-${deal.discountPct}%) u prodavnici ${deal.store}.`
      : 'Detalji popusta na NEXUS-u.',
    path: `/deals/${id}`,
    image: deal?.gameCover ?? undefined,
    noIndex: deal?.status === 'removed',
  });

  const removeMutation = useMutation({
    mutationFn: () => api.deals.remove(id),
    onSuccess: () => {
      toast.success('Deal je uklonjen.');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['games'] });
      navigate('/deals');
    },
    onError: (error: any) => toast.error(error?.message || 'Brisanje nije uspelo.'),
  });

  const verifyMutation = useMutation({
    mutationFn: (isVerified: boolean) => api.deals.update(id, { isVerified }),
    onSuccess: () => {
      toast.success('Status provere je sačuvan.');
      queryClient.invalidateQueries({ queryKey: ['deal', id] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Izmene nisu sačuvane.'),
  });

  if (isLoading) {
    return (
      <div className="section">
        <div className="container max-w-4xl space-y-4" aria-busy="true">
          <Skeleton className="h-6 w-32" />
          <div className="ui-card-static space-y-4 !p-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div className="section">
        <div className="container max-w-2xl">
          <ErrorState
            title="Deal nije pronađen"
            message="Možda je uklonjen od strane autora ili moderatora."
            onRetry={() => refetch()}
          >
            <Link to="/deals" className="text-sm text-cyan-300 hover:text-cyan-200">
              ← Nazad na sve popuste
            </Link>
          </ErrorState>
        </div>
      </div>
    );
  }

  const expired = isDealExpired(deal);
  const left = timeLeft(deal.expiresAt);

  return (
    <div className="section">
      <div className="container max-w-4xl">
        <nav className="crumbs mb-5" aria-label="Putanja">
          <Link to="/deals">Popusti</Link>
          <span className="sep" aria-hidden="true">/</span>
          {deal.gameSlug ? <Link to={`/games/${deal.gameSlug}`}>{deal.gameTitle}</Link> : <span>Deal</span>}
        </nav>

        <Card variant="elevated" className="!p-5 sm:!p-7">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-[6px] border px-2 py-1 font-mono text-sm font-bold tabular-nums ${discountTone(deal.discountPct)}`}>
                  -{deal.discountPct}%
                </span>
                <Badge tone="neutral">
                  <Store size={11} aria-hidden="true" />
                  {deal.store}
                </Badge>
                <Badge tone="secondary">{platformLabel(deal.platform)}</Badge>
                {deal.isVerified && (
                  <Badge tone="success">
                    <ShieldCheck size={11} aria-hidden="true" />
                    Provereno
                  </Badge>
                )}
                {isExpiringSoon(deal) && (
                  <Badge tone="warning">
                    <Clock size={11} aria-hidden="true" />
                    Ističe uskoro
                  </Badge>
                )}
                {expired && <Badge tone="error">Istekao</Badge>}
              </div>

              <h1 className="page-title !text-2xl sm:!text-3xl">{deal.title}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
                {deal.gameSlug && deal.gameTitle && (
                  <Link to={`/games/${deal.gameSlug}`} className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200">
                    <Gamepad2 size={14} aria-hidden="true" />
                    {deal.gameTitle}
                  </Link>
                )}
                <span>
                  objavio{' '}
                  <Link to={`/profile/${encodeURIComponent(deal.author)}`} className="text-white/75 hover:text-white">
                    {deal.author}
                  </Link>
                  <VerifiedBadge isVerified={deal.authorVerified} size="xs" />
                </span>
                <span className="font-mono text-xs">pre {timeAgo(deal.createdAt)}</span>
                {left && !expired && <span className="font-mono text-xs text-amber-200/80">ističe {left}</span>}
              </div>

              <div className="mt-5 flex flex-wrap items-end gap-3 border-y border-white/[0.07] py-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Cena</div>
                  <div className="font-display text-3xl font-bold tabular-nums text-white">{formatPrice(deal.price, deal.currency)}</div>
                </div>
                <div className="pb-1">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Originalno</div>
                  <div className="font-mono text-base tabular-nums text-white/40 line-through">
                    {formatPrice(deal.originalPrice, deal.currency)}
                  </div>
                </div>
                <div className="pb-1 text-emerald-300">
                  <div className="text-[11px] uppercase tracking-wider text-white/40">Ušteda</div>
                  <div className="inline-flex items-center gap-1 font-mono text-base font-semibold tabular-nums">
                    <TrendingDown size={14} aria-hidden="true" />
                    {formatPrice(deal.originalPrice - deal.price, deal.currency)}
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  <a
                    href={deal.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="ui-btn br-primary ui-btn-md"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span className="ui-btn-label">Idi u {hostLabel(deal.url)}</span>
                  </a>
                </div>
              </div>

              {deal.description && (
                <p className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-white/70">{deal.description}</p>
              )}

              {deal.proofUrl && (
                <div className="mt-5">
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-white/40">Dokaz / screenshot</div>
                  <a href={deal.proofUrl} target="_blank" rel="noopener noreferrer nofollow" className="block">
                    <img
                      src={deal.proofUrl}
                      alt="Dokaz popusta"
                      loading="lazy"
                      className="max-h-80 w-full rounded-lg border border-white/[0.08] bg-surface-2 object-contain"
                    />
                  </a>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <VoteButtons deal={deal} size="md" invalidateKeys={[['deal', id], ['deals'], ['games']]} />
                <span className="text-xs text-white/40">Glasaj ako je deal tačan i koristan.</span>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  {canManage && (
                    <>
                      {isStaff && !expired && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate(!deal.isVerified)}
                        >
                          {deal.isVerified ? 'Ukini proveru' : 'Označi kao provereno'}
                        </Button>
                      )}
                      {confirmDelete ? (
                        <span className="flex items-center gap-2 text-xs text-rose-300">
                          Sigurno?
                          <button type="button" className="underline" onClick={() => removeMutation.mutate()}>
                            Da, ukloni
                          </button>
                          <button type="button" className="underline" onClick={() => setConfirmDelete(false)}>
                            Ne
                          </button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          leftIcon={<Trash2 size={13} />}
                          onClick={() => setConfirmDelete(true)}
                        >
                          Ukloni
                        </Button>
                      )}
                    </>
                  )}
                  {isAuthenticated && deal.authorId !== user?.id && (
                    <ReportButton targetType="deal" targetId={deal.id} label="Prijavi deal" />
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar: igra + pravila */}
            <aside className="md:w-56 shrink-0 space-y-3">
              {deal.gameSlug && deal.gameTitle && (
                <Link to={`/games/${deal.gameSlug}`} className="group block overflow-hidden rounded-lg border border-white/[0.08] bg-surface-2">
                  {deal.gameCover ? (
                    <img src={deal.gameCover} alt="" className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center text-white/20">
                      <Gamepad2 size={32} />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="text-[11px] uppercase tracking-wider text-white/40">Igra</div>
                    <div className="mt-0.5 truncate text-sm font-medium text-white group-hover:text-cyan-200">{deal.gameTitle}</div>
                  </div>
                </Link>
              )}
              <Card variant="static" className="!p-3.5">
                <CardHeader title="Sigurnost" subtitle="Kupujte iz proverene prodavnice." icon={<ShieldCheck size={14} />} />
                <DealWarning>
                  Deal objavljuje zajednica. Ako cena ili link nisu tačni, prijavite deal — moderatori ga uklanjaju.
                </DealWarning>
              </Card>
            </aside>
          </div>
        </Card>

        <div className="mt-6">
          <Link to="/deals" className="inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white">
            <ArrowLeft size={14} aria-hidden="true" />
            Svi popusti
          </Link>
        </div>
      </div>
    </div>
  );
}
