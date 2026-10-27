/**
 * TIŠI SATI (quiet hours) — 6.x
 * ---------------------------
 * Korisnik bira vremenski opseg (po svom lokalnom vremenu, uz offset koji mu
 * browser pošalje) i tipove za koje ne želi ni zvuk na uređaju. U tom opsegu push
 * NE ide, ali notifikacija **uvek upada u inbox** — ništa se ne gubi, samo se ne
 * zvoni. Podešavanje živi u `site_meta` (`notify.quiet:<userId>`), pa preživi
 * restart i deli se između instanci.
 */

import type { NotificationRecord } from './store.js';
import { getSharedValue, setSharedValue } from './sharedStore.js';

/** Zvonce u aplikaciji ove tipove i dalje prikazuje — menja se samo push. */
export const PUSH_MUTABLE_TYPES: NotificationRecord['type'][] = [
  'reply',
  'mention',
  'upvote',
  'dm',
  'guestbook',
  'user_follow',
  'badge_earned',
  'quest_completed',
  'level_up',
  'streak',
  'price_alert',
  'verification',
  'staff',
  'system',
  'warning',
];

export interface QuietHours {
  /** „23:30“ — početak tihog perioda (lokalno vreme korisnika). */
  from: string;
  /** „07:00“ — kraj tihog perioda. */
  to: string;
  /** Minuti istočno od UTC (`-new Date().getTimezoneOffset()`). */
  tzOffsetMinutes: number;
}

export interface NotificationPreferences {
  quietHours: QuietHours | null;
  /** Push se ne šalje za ove tipove (zvonce i inbox ostaju netaknuti). */
  pushMuted: NotificationRecord['type'][];
}

const KEY = (userId: string) => `notify.quiet:${userId}`;
const EMPTY: NotificationPreferences = { quietHours: null, pushMuted: [] };

/** „HH:MM“ → minuti od ponoći; `null` za neispravan unos. */
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalizuje unos iz API-ja; neispravan opseg → `null` (tiši sati isključeni). */
export function normalizeQuietHours(input: unknown): QuietHours | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const from = parseClock(raw.from);
  const to = parseClock(raw.to);
  if (from === null || to === null || from === to) return null;
  const offset = Number(raw.tzOffsetMinutes);
  return {
    from: formatClock(from),
    to: formatClock(to),
    tzOffsetMinutes: Number.isFinite(offset) ? Math.max(-840, Math.min(840, Math.round(offset))) : 0,
  };
}

/**
 * Da li je `at` unutar tihog opsega? Opseg može da pređe ponoć (`22:00 → 07:00`).
 * Vreme korisnika = UTC + `tzOffsetMinutes` (offset može da bude negativan).
 */
export function isWithinQuietHours(quiet: QuietHours | null, at: Date = new Date()): boolean {
  if (!quiet) return false;
  const from = parseClock(quiet.from);
  const to = parseClock(quiet.to);
  if (from === null || to === null) return false;

  const localMinutes =
    (at.getUTCHours() * 60 + at.getUTCMinutes() + quiet.tzOffsetMinutes + 1440) % 1440;
  return from <= to ? localMinutes >= from && localMinutes < to : localMinutes >= from || localMinutes < to;
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const stored = await getSharedValue<Partial<NotificationPreferences>>(KEY(userId)).catch(() => null);
  if (!stored) return EMPTY;
  const muted: NotificationRecord['type'][] = Array.isArray(stored.pushMuted)
    ? stored.pushMuted.filter((type): type is NotificationRecord['type'] =>
        PUSH_MUTABLE_TYPES.includes(type as NotificationRecord['type']),
      )
    : [];
  return { quietHours: normalizeQuietHours(stored.quietHours), pushMuted: muted };
}

export async function setNotificationPreferences(
  userId: string,
  patch: { quietHours?: unknown; pushMuted?: unknown },
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userId);
  const next: NotificationPreferences = {
    quietHours: patch.quietHours === undefined ? current.quietHours : normalizeQuietHours(patch.quietHours),
    pushMuted: Array.isArray(patch.pushMuted)
      ? patch.pushMuted.filter(
        (type: unknown): type is NotificationRecord['type'] =>
          typeof type === 'string' && PUSH_MUTABLE_TYPES.includes(type as NotificationRecord['type']),
      )
      : current.pushMuted,
  };
  await setSharedValue(KEY(userId), next);
  return next;
}

/**
 * Da li push sme da se pošalje sada? Ne šalje se u tihim satima i za tipove koje
 * je korisnik isključio. Inbox/Zvonce se ovim ne dira.
 */
export function shouldPush(
  prefs: NotificationPreferences,
  type: NotificationRecord['type'],
  at: Date = new Date(),
): { push: boolean; reason?: 'quiet_hours' | 'muted_type' } {
  if (prefs.pushMuted.includes(type)) return { push: false, reason: 'muted_type' };
  if (isWithinQuietHours(prefs.quietHours, at)) return { push: false, reason: 'quiet_hours' };
  return { push: true };
}
