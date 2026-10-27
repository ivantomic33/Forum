/**
 * 6.x — ANTI-SPAM ZA NOVE ČLANOVE
 * ------------------------------
 * Prvih `NEW_MEMBER_POSTS` objava (teme + odgovori) novog naloga ide kroz blagi
 * filter. Ne blokiramo objavu — **označimo je za pregled**: upiše se u `reports`
 * (`targetType: 'thread' | 'reply'`, razlog), pa se pojavi u moderacionom redu
 * koji već postoji (`/admin/reports`). Bez novih tabela i bez novog UI-ja.
 *
 * Zašto ne „blokiraj dok moderator ne odobri“: to ubija dobar prvi utisak
 * (čovek napiše prvi post i ništa se ne dogodi). Ovako sadržaj živi odmah, a
 * tim dobija signal „pogledaj ovo“ samo kada heuristika posumnja.
 *
 * Heuristika (JEDAN signal je dovoljan da objava uđe u red za pregled):
 *   - 2+ linka u telu (novi član obično nema šta da linkuje u prvom postu),
 *   - više od 40% VELIKIH slova u tekstu dužem od 40 znakova,
 *   - prekratko telo (< 15 znakova) + link,
 *   - ista poruka kao nedavna objava istog korisnika (copy-paste spam).
 */

import { db, newId } from './store.js';
import { logger } from './logger.js';

/** Koliko prvih objava podleže proveri. */
export const NEW_MEMBER_POSTS = 5;

/** Sumnja — vrati listu razloga (prazna lista = sadržaj je čist). */
export function suspiciousSignals(input: {
  content: string;
  recentContents?: string[];
}): string[] {
  const text = String(input.content ?? '');
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const signals: string[] = [];

  const links = (text.match(/https?:\/\//gi) ?? []).length;
  if (links >= 2) signals.push(`${links} linka u objavi`);
  // Dužina se meri BEZ samog URL-a — "kupi https://…" je i dalje kratka poruka.
  const textWithoutLinks = plain.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (links >= 1 && textWithoutLinks.length < 15) signals.push('kratka poruka sa linkom');

  const letters = plain.replace(/[^A-Za-zČĆŠĐŽčćšđž]/g, '');
  if (letters.length >= 40) {
    const upper = letters.replace(/[^A-ZČĆŠĐŽ]/g, '').length;
    if (upper / letters.length > 0.4) signals.push('većina teksta velikim slovima');
  }

  const stripTags = (value: string) =>
    String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalized = stripTags(text);
  if (normalized.length > 20 && (input.recentContents ?? []).some((item) => stripTags(item) === normalized)) {
    signals.push('ista poruka već postoji');
  }

  return signals;
}

/**
 * Da li je korisnik još „nov“ (manje od `NEW_MEMBER_POSTS` objava)? Broj se
 * računa iz stvarnih tema i odgovora — bez dodatne kolone u bazi.
 */
export async function isNewMember(userId: string, username?: string): Promise<boolean> {
  try {
    const [threads, replies] = await Promise.all([
      db.forum.listThreadsByAuthor(userId, username ?? '', NEW_MEMBER_POSTS + 1).catch(() => []),
      db.forum.listRepliesByAuthor(userId, username ?? '', NEW_MEMBER_POSTS + 1).catch(() => []),
    ]);
    return threads.length + replies.length <= NEW_MEMBER_POSTS;
  } catch (error) {
    // Greška u proveri ne sme da obori objavu niti da optuži korisnika.
    logger.debug({ err: error, userId }, 'new_member_check_failed');
    return false;
  }
}

/**
 * Označi objavu za pregled (jedan `pending` report po sadržaju). Nikad ne baca.
 * `reporterId` je sam autor — report je sistemski, ne korisnička prijava.
 */
export async function flagForReview(input: {
  authorId: string;
  targetType: 'thread' | 'reply';
  targetId: string;
  signals: string[];
}): Promise<boolean> {
  if (!input.signals.length) return false;
  try {
    const existing = await db.reports.findByReporter(input.authorId, input.targetType, input.targetId);
    if (existing?.some((row) => row.status === 'pending')) return false;
    await db.reports.create({
      id: newId(),
      targetType: input.targetType,
      targetId: input.targetId,
      reporterId: input.authorId,
      reason: `[auto] Nova objava člana sa malo postova: ${input.signals.join('; ')}`.slice(0, 480),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    logger.info({ targetType: input.targetType, targetId: input.targetId, signals: input.signals }, 'new_member_flagged');
    return true;
  } catch (error) {
    logger.warn({ err: error, targetId: input.targetId }, 'new_member_flag_failed');
    return false;
  }
}
