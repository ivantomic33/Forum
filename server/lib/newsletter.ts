/**
 * NEWSLETTER — čisti helperi (2.6.2)
 * ----------------------------------
 * Izdvojeno iz rute da ih mogu koristiti i `routes/admin.ts` (kampanja) i
 * testovi, bez učitavanja Express rute (koja pri importu traži `JWT_SECRET`).
 */

export type SubscriberSegment = 'active' | 'pending' | 'unsubscribed' | 'all';

/** „Ko je u kom segmentu“ — odjavljeni imaju prednost nad `isActive`. */
export function subscriberSegment(sub: { isActive: boolean; unsubscribedAt?: string | null }): Exclude<SubscriberSegment, 'all'> {
  if (sub.unsubscribedAt) return 'unsubscribed';
  return sub.isActive ? 'active' : 'pending';
}

/** Nepoznat parametar nikad ne pada na „svi“ — podrazumevano su potvrđeni. */
export function parseSegment(raw: unknown): SubscriberSegment {
  return raw === 'pending' || raw === 'unsubscribed' || raw === 'all' ? raw : 'active';
}

/** Subjekat kampanje je jedan red mejla — prelom reda bi ga razbio (header injection). */
export const sanitizeSubject = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
