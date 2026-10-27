import { Link } from 'react-router-dom';
import { Clock, ExternalLink, Gamepad2, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import type { Deal } from '../../lib/api';
import { Badge, PriceTag, cn } from '../ui';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { VoteButtons } from './VoteButtons';
import { expiresTodayLabel, hostLabel, hoursLeft } from './dealUtils';

interface DealCardProps {
  deal: Deal;
  /** `compact` = bez slike/dokaza (Game Page, sidebar); `default` = kartica u gridu. */
  variant?: 'default' | 'compact';
  invalidateKeys?: string[][];
}

/**
 * Kartica deal-a — CENA JE NAJVEĆI ELEMENT.
 *
 * AMBER ZONA: −% pilula je puna amber sa TAMNIM tekstom (`--color-on-deal`),
 * cena `--color-deal-fg`, „ističe“ rose. Meta (prodavnica, autor) ostaje
 * neutralna; zelena je samo verifikacija (emerald zona).
 */
export function DealCard({ deal, variant = 'default', invalidateKeys }: DealCardProps) {
  const hours = hoursLeft(deal.expiresAt);
  const urgent = hours !== null;
  const left = expiresTodayLabel(hours);
  const expired = deal.status !== 'active' || (deal.expiresAt ? new Date(deal.expiresAt).getTime() <= Date.now() : false);

  return (
    <article className={cn('ui-card group relative flex-col gap-3 !p-3.5 transition-colors', expired && 'opacity-70')}>
      {variant === 'default' && (
        <Link
          to={`/deals/${deal.id}`}
          className="relative block aspect-[16/9] w-full shrink-0 overflow-hidden rounded-md bg-[var(--color-surface-2)]"
          aria-label={`Otvori deal: ${deal.title}`}
        >
          {deal.gameCover ? (
            <img src={deal.gameCover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[var(--color-text-tertiary)]">
              <Gamepad2 size={28} aria-hidden="true" />
            </span>
          )}
          <span className="deal-discount-pill absolute right-2 top-2">
            −{deal.discountPct}%
          </span>
          {urgent && !expired && (
            <span className="deal-expiry-pill is-urgent absolute inset-x-2 bottom-2">
              <Clock size={12} aria-hidden="true" />
              {hours === 1 ? '1 h' : `${hours} h`}
            </span>
          )}
        </Link>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1.5 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-micro text-[var(--color-text-tertiary)]">
            <Store size={12} aria-hidden="true" />
            {deal.store}
          </span>
          {deal.isVerified && (
            <span className="inline-flex items-center gap-1 text-micro text-[var(--color-community-fg)]" title="Moderator je proverio dokaz">
              <ShieldCheck size={12} aria-hidden="true" />
              Provereno
            </span>
          )}
          {expired && <Badge tone="neutral">Istekao</Badge>}
        </div>

        <Link to={`/deals/${deal.id}`} className="block">
          <h3 className="deal-card-title">{deal.title}</h3>
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
          <PriceTag
            price={deal.price}
            originalPrice={deal.originalPrice}
            currency={deal.currency}
            discountPct={deal.discountPct}
          />
          <VoteButtons deal={deal} size={variant === 'default' ? 'md' : 'sm'} invalidateKeys={invalidateKeys} />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] pt-2 text-micro text-[var(--color-text-tertiary)]">
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <Gamepad2 size={12} aria-hidden="true" />
            <span className="truncate">{deal.gameTitle || deal.author}</span>
            <VerifiedBadge isVerified={deal.authorVerified} size="xs" />
          </span>
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-[2rem] shrink-0 items-center gap-1 font-medium text-[var(--color-text-secondary)] transition hover:text-[var(--color-primary-fg)]"
            title={`Otvori na ${hostLabel(deal.url)}`}
            aria-label={`Otvori ponudu na ${hostLabel(deal.url)}`}
          >
            <ExternalLink size={12} aria-hidden="true" />
            <span className="hidden sm:inline">Prodavnica</span>
          </a>
        </div>
      </div>
      {left ? <span className="sr-only">{left}</span> : null}
    </article>
  );
}

/** Upozorenje za lažan/spam deal — vodi na detalj gde je puna „Prijavi“ forma. */
export function DealWarning({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-micro leading-relaxed">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      {children ?? 'Cene proveravajte u prodavnici — zajednica i moderatori uklanjaju netačne deal-ove.'}
    </p>
  );
}
