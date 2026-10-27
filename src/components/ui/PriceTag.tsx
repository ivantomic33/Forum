import { Timer } from 'lucide-react';
import { cn } from './cn';

/**
 * PriceTag — cena je najveći element deal kartice.
 *
 * Cena: JetBrains Mono 600, 28 px, tabularni brojevi, AMBER (`deal-fg`) —
 * zona popusta. Originalna: precrtana, 14 px, `text-muted`. Popust (−64%):
 * `deal`. „Ističe za N h“ je neutralan iznad 24 h, rose ispod 24 h.
 */
export interface PriceTagProps {
  price: number;
  originalPrice?: number;
  currency?: string;
  discountPct?: number;
  /** ISO datum isteka — komponenta računa „ističe za“. */
  expiresAt?: string | null;
  /** Prenaponski format (npr. „Ističe danas“) — zadaje se samo ako nije `expiresAt`. */
  expiryLabel?: string;
  className?: string;
}

export const formatPrice = (value: number, currency = 'EUR') => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return 'Besplatno';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

const hoursUntil = (value?: string | null) => {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / 3_600_000);
};

export function PriceTag({
  price,
  originalPrice,
  currency = 'EUR',
  discountPct,
  expiresAt,
  expiryLabel,
  className,
}: PriceTagProps) {
  const hours = hoursUntil(expiresAt);
  const urgent = hours !== null && hours >= 0 && hours <= 24;
  const computedPct =
    discountPct ??
    (originalPrice && originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : undefined);

  return (
    <div className={cn('price-tag is-deal', className)}>
      <span className="price-tag-row">
        <span className="price-tag-value">{formatPrice(price, currency)}</span>
        {computedPct ? <span className="price-tag-discount">−{computedPct}%</span> : null}
      </span>
      {originalPrice !== undefined && originalPrice > price && (
        <span className="price-tag-original">{formatPrice(originalPrice, currency)}</span>
      )}
      {(expiryLabel || hours !== null) && (
        <span className={cn('price-tag-expiry', urgent && 'is-urgent')}>
          <Timer size={12} aria-hidden="true" />
          {expiryLabel ?? (urgent ? `Ističe za ${hours}h` : 'Ograničeno vreme')}
        </span>
      )}
    </div>
  );
}
