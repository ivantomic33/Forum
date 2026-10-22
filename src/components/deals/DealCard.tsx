import { Link } from 'react-router-dom';
import { Clock, ExternalLink, Gamepad2, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import type { Deal } from '../../lib/api';
import { Badge, cn } from '../ui';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { VoteButtons } from './VoteButtons';
import { discountTone, formatPrice, hostLabel, isExpiringSoon, timeAgo, timeLeft } from './dealUtils';

interface DealCardProps {
  deal: Deal;
  /** `compact` = bez slike/dokaza (Game Page, sidebar); `default` = kartica u gridu. */
  variant?: 'default' | 'compact';
  invalidateKeys?: string[][];
}

/**
 * Kartica deal-a: popust, cena, prodavnica, igra, glasanje.
 * Ceo gornji deo je link ka `/deals/:id`; spoljni link ka prodavnici je
 * namerno odvojeno dugme da se ne bi slučajno napustila stranica pri kliku.
 */
export function DealCard({ deal, variant = 'default', invalidateKeys }: DealCardProps) {
  const expiring = isExpiringSoon(deal);
  const left = timeLeft(deal.expiresAt);
  const expired = deal.status !== 'active' || left === 'istekao';

  return (
    <article
      className={cn(
        'ui-card group relative flex gap-3 !p-4 transition-colors',
        variant === 'default' && 'flex-col gap-4 sm:flex-row',
        expired && 'opacity-70',
      )}
    >
      {variant === 'default' && (
        <Link
          to={`/deals/${deal.id}`}
          className="relative block h-28 w-full shrink-0 overflow-hidden rounded-[10px] border border-white/[0.07] bg-surface-2 sm:h-32 sm:w-28"
          aria-label={`Otvori deal: ${deal.title}`}
        >
          {deal.gameCover ? (
            <img src={deal.gameCover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/25">
              <Gamepad2 size={28} aria-hidden="true" />
            </span>
          )}
          <span
            className={cn(
              'absolute left-1.5 top-1.5 rounded-[5px] border px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums backdrop-blur-sm',
              discountTone(deal.discountPct),
            )}
          >
            -{deal.discountPct}%
          </span>
        </Link>
      )}

        <div className="flex min-w-0 flex-1 gap-3">
          <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {variant === 'compact' && (
              <span className={cn('rounded-[4px] border px-1.5 py-px font-mono text-[10px] font-bold tabular-nums', discountTone(deal.discountPct))}>
                -{deal.discountPct}%
              </span>
            )}
            <Badge tone="neutral" className="!text-[10px]">
              <Store size={10} aria-hidden="true" />
              {deal.store}
            </Badge>
            {deal.isVerified && (
              <Badge tone="success" className="!text-[10px]" title="Moderator je proverio dokaz">
                <ShieldCheck size={10} aria-hidden="true" />
                Provereno
              </Badge>
            )}
            {expiring && (
              <Badge tone="warning" className="!text-[10px]">
                <Clock size={10} aria-hidden="true" />
                Ističe uskoro
              </Badge>
            )}
            {expired && <Badge tone="error" className="!text-[10px]">Istekao</Badge>}
          </div>

          <Link to={`/deals/${deal.id}`} className="block">
            <h3 className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-white transition group-hover:text-cyan-200">
              {deal.title}
            </h3>
          </Link>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/50">
            {deal.gameSlug && deal.gameTitle ? (
              <Link to={`/games/${deal.gameSlug}`} className="inline-flex items-center gap-1 text-cyan-300/90 hover:text-cyan-200">
                <Gamepad2 size={12} aria-hidden="true" />
                {deal.gameTitle}
              </Link>
            ) : (
              deal.gameTitle && <span className="inline-flex items-center gap-1">{deal.gameTitle}</span>
            )}
            {left && !expired && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                <Clock size={11} aria-hidden="true" />
                {left}
              </span>
            )}
            <span className="font-mono text-[11px] text-white/35">
              pre {timeAgo(deal.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-white/35">
              {deal.author}
              <VerifiedBadge isVerified={deal.authorVerified} size="xs" />
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
            <span className="font-display text-lg font-bold tabular-nums text-white">{formatPrice(deal.price, deal.currency)}</span>
            <span className="font-mono text-xs tabular-nums text-white/40 line-through">
              {formatPrice(deal.originalPrice, deal.currency)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end justify-between gap-2">
          <VoteButtons deal={deal} size={variant === 'default' ? 'md' : 'sm'} invalidateKeys={invalidateKeys} />
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-white/45 transition hover:text-cyan-300"
            title={`Otvori na ${hostLabel(deal.url)}`}
          >
            <ExternalLink size={11} aria-hidden="true" />
            <span className="hidden sm:inline">Prodavnica</span>
          </a>
        </div>
      </div>
    </article>
  );
}

/** Upozorenje za lažan/spam deal — vodi na detalj gde je puna „Prijavi“ forma. */
export function DealWarning({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-white/40">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      {children ?? 'Cene proveravajte u prodavnici — zajednica i moderatori uklanjaju netačne deal-ove.'}
    </p>
  );
}
