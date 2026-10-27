/**
 * F-7.1 #8 — „PRATI TEMU“ (mejl kanal UGAŠEN)
 * -------------------------------------------
 * In-app notifikacije pratiocima teme već postoje (`thread_subscriptions` u
 * `routes/forum.ts` → `notify`: inbox + zvonce + Realtime + web push).
 *
 * Mejl se od sada šalje SAMO za verifikaciju adrese i reset lozinke — novi
 * odgovor u praćenoj temi više NE ide mejlom. `sendReplyEmails` ostaje kao
 * kompatibilan no-op (ruta ga i dalje poziva `void`-om, ne blokira odgovor).
 */

export const REPLY_EMAIL_THROTTLE_MS = 15 * 60 * 1000;

export interface ReplyEmailInput {
  threadId: string;
  threadTitle: string;
  /** URL deo bez domena, npr. `/thread/abc#post-rep1`. */
  threadPath: string;
  /** Autor novog odgovora. */
  actorId: string;
  actorUsername: string;
  replyContent: string;
}

/**
 * Nekada je slao mejl pratiocima koji su to tražili. Sada ništa ne šalje —
 * obaveštenje o odgovoru živi samo u aplikaciji. Nikad ne baca.
 */
export async function sendReplyEmails(_input: ReplyEmailInput): Promise<{ sent: number; skipped: number }> {
  return { sent: 0, skipped: 0 };
}
