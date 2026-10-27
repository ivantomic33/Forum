/**
 * PRISUSTVO — STANJE (2.6.1 / 2.6.2 / N-06)
 * -----------------------------------------
 * Samo Zustand store i njegovi selektori — **bez** mreže, Realtime-a i
 * `@tanstack/react-query`-ja. Ovo uvoze `OnlineAvatar` i drugi UI komponenti
 * koje se nalaze u glavnom chunku, pa je modul namerno mali.
 *
 * `lastSeen` se pamti po korisniku da stariji događaj (retry/out-of-order) ne
 * vrati već istekao status.
 *
 * 2.6.2 — `away`: korisnik je prijavljen, ali bez aktivnosti (tab u pozadini).
 * Server objavljuje `away` eksplicitno (heartbeat `status: 'away'` ili sweep
 * posle 90s), a klijent prikazuje žuti prsten umesto zelenog.
 */
import { create } from 'zustand';
import type { PresenceStatus } from '../lib/realtime';

/** Koliko događaj koji nismo videli smatramo svežim pre nego što ga odbacimo. */
export const STALE_EVENT_MS = 60_000;
/** Koliko `away` važi pre nego što se smatra offline (server: away prozor 120s). */
export const AWAY_TTL_MS = 120_000;

interface PresenceState {
  /** userId → ISO vreme poslednjeg poznatog otkucaja. */
  lastSeen: Record<string, string>;
  /** userId → `away` (2.6.2). Bez vrednosti = `online` dok je `lastSeen` svež. */
  away: Record<string, true>;
  online: (userId?: string | null) => boolean;
  /** `online | away | offline` — koristi ga `OnlineAvatar` (žuti prsten za away). */
  status: (userId?: string | null) => PresenceStatus;
  /** Realtime događaj (broadcast) ili snimak sa servera. */
  apply: (userId: string, isOnline: boolean, at?: string | null, status?: PresenceStatus) => void;
  applyMany: (userIds: string[], statuses?: Record<string, PresenceStatus>) => void;
  reset: () => void;
}

function isFresh(at: string | null | undefined, previous: string | undefined) {
  if (!at) return true;
  if (previous && new Date(at).getTime() < new Date(previous).getTime()) return false;
  return Date.now() - new Date(at).getTime() < STALE_EVENT_MS;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  lastSeen: {},
  away: {},

  online: (userId) => {
    if (!userId) return false;
    return get().status(userId) === 'online';
  },

  status: (userId) => {
    if (!userId) return 'offline';
    const at = get().lastSeen[userId];
    if (!at) return 'offline';
    const idle = Date.now() - new Date(at).getTime();
    if (idle >= AWAY_TTL_MS) return 'offline';
    return get().away[userId] ? 'away' : 'online';
  },

  apply: (userId, isOnline, at, status) => {
    if (!userId) return;
    const previous = get().lastSeen[userId];
    const stamp = at ?? new Date().toISOString();
    if (!isFresh(stamp, previous)) return;

    // Stariji serveri šalju samo `online` boolean — tada je false = offline.
    const next: PresenceStatus = !isOnline ? 'offline' : status === 'away' ? 'away' : 'online';

    set((state) => {
      const lastSeen = { ...state.lastSeen };
      const away = { ...state.away };
      if (next === 'offline') {
        delete lastSeen[userId];
        delete away[userId];
      } else {
        lastSeen[userId] = stamp;
        if (next === 'away') away[userId] = true;
        else delete away[userId];
      }
      return { lastSeen, away };
    });
  },

  /** Snimak sa servera: svi iz liste su prisutni „sada“; `statuses` nosi away. */
  applyMany: (userIds, statuses) => {
    if (!userIds.length && !statuses) return;
    const at = new Date().toISOString();
    set((state) => {
      const lastSeen = { ...state.lastSeen };
      const away = { ...state.away };
      for (const id of userIds) {
        lastSeen[id] = at;
        delete away[id];
      }
      for (const [id, status] of Object.entries(statuses ?? {})) {
        if (status === 'offline') {
          delete lastSeen[id];
          delete away[id];
        } else if (status === 'away') {
          lastSeen[id] = at;
          away[id] = true;
        } else {
          lastSeen[id] = at;
          delete away[id];
        }
      }
      return { lastSeen, away };
    });
  },

  reset: () => set({ lastSeen: {}, away: {} }),
}));
