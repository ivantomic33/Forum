/**
 * „ONLINE SADA“ — klijentsko stanje prisustva (2.6.1)
 * ---------------------------------------------------
 * Jedan Realtime kanal za ceo sajt (`subscribeRealtime`) puni mapu `online`.
 * Server je izvor istine:
 *  - `POST /api/auth/heartbeat` svakih 25s dok je tab vidljiv + pri povratku u tab,
 *  - Realtime `presence` događaji kao trenutni signal,
 *  - `GET /api/presence` svakih 60s kao rezerva (WS blokiran na proxy-ju) i kao
 *    početno stanje pre prvog događaja.
 *
 * `lastSeen` se pamti po korisniku da stariji događaj (retry/out-of-order) ne
 * vrati već istekao status.
 *
 * 2.6.2 — `away`: korisnik je prijavljen, ali bez aktivnosti (tab u pozadini).
 * Server objavljuje `away` eksplicitno (heartbeat `status: 'away'` ili sweep
 * posle 90s), a klijent prikazuje žuti prsten umesto zelenog.
 */
import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { subscribeRealtime, type NotificationPush, type PresenceEvent, type PresenceStatus } from '../lib/realtime';
import { useAuthStore } from './authStore';

/** Koliko događaj koji nismo videli smatramo svežim pre nego što ga odbacimo. */
const STALE_EVENT_MS = 60_000;
/** Koliko `away` važi pre nego što se smatra offline (server: away prozor 120s). */
const AWAY_TTL_MS = 120_000;
const HEARTBEAT_MS = 25_000;
const SNAPSHOT_MS = 60_000;

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

let channel: RealtimeChannel | null = null;
let started = false;
/** React Query klijent (bootstrap iz `main.tsx`) — zvonce se osveži bez polling-a. */
let queryClient: QueryClient | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;

/** Otkucaj — in-flight propust da 4 taba ne pošalju 4 zahteva u istoj sekundi. */
let heartbeatInFlight = false;

async function sendHeartbeat(status: 'online' | 'away' = 'online') {
  if (heartbeatInFlight) return;
  // `away` se šalje i kada tab NIJE vidljiv (to mu je i smisao), ali samo
  // prijavljenom korisniku.
  if (status === 'online' && typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const { isAuthenticated, user } = useAuthStore.getState();
  if (!isAuthenticated || !user) return;

  heartbeatInFlight = true;
  try {
    await api.auth.heartbeat(status);
    usePresenceStore.getState().apply(user.id, true, undefined, status);
  } catch {
    // Offline ili istekla sesija — `api` klijent već pokriva refresh/odjavu.
  } finally {
    heartbeatInFlight = false;
  }
}

async function refreshSnapshot() {
  try {
    const { online, statuses } = await api.presence.online();
    usePresenceStore.getState().applyMany(online, statuses);
  } catch {
    // Realtime i dalje radi; sledeći pokušaj za 60s.
  }
}

/**
 * Pokreće praćenje prisustva. Idempotentno — Layout je zove jednom.
 * `client` omogućava trenutno osvežavanje zvona na Realtime notifikaciju.
 */
export function startPresence(client?: QueryClient) {
  if (client) queryClient = client;
  if (started) return stopPresence;
  started = true;

  channel = subscribeRealtime({
    onPresence: (event: PresenceEvent) => {
      usePresenceStore.getState().apply(event.userId, event.online, event.at, event.status);
    },
    onNotification: (push: NotificationPush) => {
      // Isti kanal nosi i „nova notifikacija“ — zvonce se osveži odmah, bez
      // čekanja 30s polling intervala. Lista se i dalje vuče preko REST rute.
      if (push.userId !== useAuthStore.getState().user?.id) return;
      void queryClient?.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  void refreshSnapshot();
  void sendHeartbeat();

  heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
  snapshotTimer = setInterval(() => void refreshSnapshot(), SNAPSHOT_MS);

  // Povratak u tab = trenutni otkucaj (bez čekanja punih 25s).
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onNetworkOnline);

  return stopPresence;
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    void sendHeartbeat();
    void refreshSnapshot();
  } else {
    // 2.6.2 — tab u pozadini = „away“ odmah (bez čekanja 90s TTL-a).
    void sendHeartbeat('away');
  }
}

function onNetworkOnline() {
  void sendHeartbeat();
  void refreshSnapshot();
}

export function stopPresence() {
  started = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  heartbeatTimer = null;
  snapshotTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('online', onNetworkOnline);
  channel?.unsubscribe();
  channel = null;
  usePresenceStore.getState().reset();
}
