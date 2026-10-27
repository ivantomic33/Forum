import type { Deal, DealSort } from '../../lib/api';

/**
 * 2.6.0 — Deals UI helperi.
 * Pravila (label prodavnice, format cene, boja popusta) na jednom mestu da
 * stranice `/deals`, `/deals/:id` i sekcija na `/games/:slug` izgledaju isto.
 */

export const STORE_OPTIONS = [
  'Steam',
  'Epic Games Store',
  'GOG',
  'Humble Bundle',
  'Fanatical',
  'Green Man Gaming',
  'Battle.net',
  'Ubisoft Store',
  'EA App',
  'Xbox Store',
  'PlayStation Store',
  'Nintendo eShop',
  'Amazon',
  'Keyshop / reseller',
  'Drugo',
];

export const PLATFORM_OPTIONS = [
  { value: 'pc', label: 'PC' },
  { value: 'steam', label: 'Steam' },
  { value: 'epic', label: 'Epic' },
  { value: 'gog', label: 'GOG' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'switch', label: 'Nintendo Switch' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'other', label: 'Drugo' },
];

export const CURRENCY_OPTIONS = ['EUR', 'USD', 'RSD', 'GBP'];

export const SORT_OPTIONS: Array<{ id: DealSort; label: string }> = [
  { id: 'top', label: 'Najbolje ocenjeni' },
  { id: 'newest', label: 'Najnoviji' },
  { id: 'discount', label: 'Najveći popust' },
  { id: 'expiring', label: 'Ističe uskoro' },
];

/** Kratki naziv platforme za filtere (W3C-ski „Xbox“, „PS“ umesto „PlayStation“). */
export const platformLabel = (value: string) =>
  PLATFORM_OPTIONS.find((item) => item.value === value?.toLowerCase())?.label ?? value;

const CURRENCY_LOCALE: Record<string, string> = { EUR: 'de-DE', USD: 'en-US', RSD: 'sr-Latn-RS', GBP: 'en-GB' };

/** Cena sa valutom (npr. `29,99 €`); `0` se prikazuje kao „Besplatno“. */
export function formatPrice(value: number, currency = 'EUR'): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return 'Besplatno';
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'sr-Latn-RS', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Boja značke popusta — veći popust = „toplija“ boja (prestige za 80%+). */
export function discountTone(pct: number): string {
  if (pct >= 80) return 'border-rose-400/50 bg-rose-500/15 text-rose-200 shadow-[0_0_16px_-4px_rgba(244,63,94,0.8)]';
  if (pct >= 60) return 'border-amber-400/45 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_-4px_rgba(245,158,11,0.6)]';
  if (pct >= 40) return 'border-cyan-400/45 bg-cyan-500/12 text-cyan-200';
  return 'border-violet-400/40 bg-violet-500/12 text-violet-200';
}

export const isDealExpired = (deal: Pick<Deal, 'expiresAt' | 'status'>, now = Date.now()) =>
  deal.status === 'expired' || Boolean(deal.expiresAt && new Date(deal.expiresAt).getTime() <= now);

export const isExpiringSoon = (deal: Pick<Deal, 'expiresAt' | 'status'>, now = Date.now()) => {
  if (!deal.expiresAt || isDealExpired(deal, now)) return false;
  return new Date(deal.expiresAt).getTime() - now <= 72 * 60 * 60 * 1000;
};

/**
 * U-09 — „ističe danas“ je prioritet, ne jedan od filtera.
 * Vraća broj sati do isteka (0–24) ili `null` kad deal nije urgentan.
 * Granica je 24 h, pa i deal koji ističe u 23:59 sutra ulazi u „dan danas“ —
 * to je namerno: korisnik donosi odluku u roku od jednog dana.
 */
export function hoursLeft(expiresAt: string | null | undefined, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const hours = Math.ceil(left / 3_600_000);
  return hours <= 24 ? hours : null;
}

/** Label za urgency badge („ističe danas“ / „još 6 h“). */
export function expiresTodayLabel(hours: number | null): string | null {
  if (hours === null) return null;
  return hours <= 1 ? 'ističe za sat' : hours < 6 ? `još ${hours} h` : 'ističe danas';
}

/**
 * U-09 — klijentsko sortiranje za glavni scenario „nađi dobar deal sada“:
 * prvo deal-ovi koji ističu u naredna 24 h (među njima veći popust), zatim
 * ostali po popustu. Server i dalje sortira (URL je izvor istine), ovo je
 * samo stabilizacija prve strane pre renderovanja.
 */
export function sortForDiscovery(deals: Deal[], now = Date.now()): Deal[] {
  return [...deals].sort((a, b) => {
    const aUrgent = hoursLeft(a.expiresAt, now) !== null ? 1 : 0;
    const bUrgent = hoursLeft(b.expiresAt, now) !== null ? 1 : 0;
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;
    if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
    return b.score - a.score;
  });
}

/** „Ističe za 5h“ / „za 3 dana“ / „istekao“. */
export function timeLeft(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(left)) return null;
  if (left <= 0) return 'istekao';
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `za ${hours} h`;
  return `za ${Math.round(hours / 24)} dana`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'sada';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  return new Date(iso).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Normalizuje URL domena za prikaz (bez `www.`). */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
