import { Link } from 'react-router-dom';
import { Clock, ExternalLink, Gamepad2, Store } from 'lucide-react';
import type { Thread } from '../../../contracts/index';
import { Badge } from '../ui';
import { discountTone, formatPrice, hostLabel, isExpiringSoon, timeLeft } from '../deals/dealUtils';

/**
 * F-3 — kartica popusta na vrhu teme otvorene iz deal-a („Diskutuj o popustu“).
 *
 * Namerno je čitač, a ne `DealCard`: komponenta je vezana za `Deal` ugovor
 * i glasanje, a ovde stiže skraćeni `linkedDeal` bez autora/opisa. Zato drži
 * samo ono što temu čini korisnom: cena, popust, prodavnica i odlazak u prodavnicu.
 *
 * Ako je deal istekao, i dalje se prikazuje (diskusija o isteklom popustu je
 * legitimna), ali bez CTA-a i sa oznakom „Istekao“ — server uklonjeni deal
 * vraća kao `null`, pa se kartica tada ne prikazuje uopšte.
 */
export function LinkedDealCard({ deal }: { deal: NonNullable<Thread['linkedDeal']> }) {
  const expired = Boolean(deal.expiresAt && new Date(deal.expiresAt).getTime() <= Date.now());
  const soon = !expired && isExpiringSoon({ expiresAt: deal.expiresAt ?? null, status: 'active' });
  const left = timeLeft(deal.expiresAt);

  return (
    <aside
      aria-label="Popust iz ove teme"
      className="mb-4 flex items-center gap-3 rounded-xl border-white/[0.08] bg-[var(--color-surface-0)]/60 p-3"
    >
      {deal.gameCover ? (
        <Link to={`/deals/${deal.id}`} className="shrink-0 overflow-hidden rounded-lg">
          <img src={deal.gameCover} alt="" loading="lazy" className="h-16 w-12 rounded-lg object-cover" />
        </Link>
      ) : (
        <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/25">
          <Gamepad2 size={20} aria-hidden="true" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums ${discountTone(deal.discountPct)}`}>
            -{deal.discountPct}%
          </span>
          <Link to={`/deals/${deal.id}`} className="truncate text-sm font-semibold text-white hover:text-cyan-200">
            {deal.title}
          </Link>
          {expired && <Badge tone="error">Istekao</Badge>}
          {soon && left && (
            <Badge tone="warning">
              <Clock size={11} aria-hidden="true" />
              {left}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
          <span className="inline-flex items-center gap-1">
            <Store size={11} aria-hidden="true" />
            {deal.store}
          </span>
          <span className="font-mono tabular-nums text-white/75">{formatPrice(deal.price, deal.currency)}</span>
          <span className="font-mono tabular-nums line-through">{formatPrice(deal.originalPrice, deal.currency)}</span>
        </div>
      </div>

      {!expired && (
        <a
          href={deal.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/75 transition hover:border-cyan-400/40 hover:text-white"
        >
          <ExternalLink size={12} aria-hidden="true" />
          {hostLabel(deal.url)}
        </a>
      )}
    </aside>
  );
}
