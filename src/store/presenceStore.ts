/**
 * „ONLINE SADA“ — prisustvo: mreža, Realtime i otkucaji (2.6.1 / 2.6.2 / N-06)
 * --------------------------------------------------------------------------
 * Samo Zustand store živi u `./presence` (mali modul koji uvozi glavni chunk
 * preko `OnlineAvatar`-a). Ovaj modul dodaje mrežni deo: jedan Realtime kanal
 * za ceo sajt (`subscribeRealtime`) i heartbeat.
 *
 * Server je izvor istine:
 *  - `POST /api/auth/heartbeat` svakih 25s dok je tab vidljiv + pri povratku u tab
 *    (SAMO prijavljenom korisniku — gost ne pravi nijedan zahtev za prisustvo),
 *  - Realtime `presence` događaji kao trenutni signal,
 *  - `GET /api/presence` kao rezerva — N-02: samo dok kanal nije `SUBSCRIBED`
 *    (WS blokiran na proxy-ju) i kao početno stanje pre prvog događaja.
 *
 * 2.6.2 — `away`: korisnik je prijavljen, ali bez aktivnosti (tab u pozadini).
 * Server objavljuje `away` eksplicitno (heartbeat `status: 'away'` ili sweep
 * posle 90s), a klijent prikazuje žuti prsten umesto zelenog.
 */
import type { QueryClient } from '@tanstack/react-query';
import { api, hasSessionHint } from '../lib/api';
import {
  subscribeRealtime,
  type NotificationPush,
  type PresenceEvent,
  type PresenceStatus,
} from '../lib/realtime';
import { useAuthStore } from './authStore';
import { usePresenceStore } from './presence';
import { notifyUser } from '../lib/notificationToasts';
import type { RealtimeChannel } from '@supabase/supabase-js';

let channel: RealtimeChannel | null = null;

/** Re-export — postojeći pozivaoci (`OnlineAvatar`) tražili su store iz ovog modula. */
export { usePresenceStore } from './presence';

const HEARTBEAT_MS = 25_000;
const SNAPSHOT_MS = 60_000;

/** N-02 — `true` samo kada je Realtime kanal stvarno `SUBSCRIBED`. */
let realtimeLive = false;
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
    // N-01 — sesija je u ovom trenutku pala: ne šalji otkucaje do prijave.
    if (!hasSessionHint()) {
      syncHeartbeatTimer();
      return;
    }
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
 * N-02 — polling je samo fallback. Kada Realtime kanal radi, `GET /presence`
 * je dupliran saobraćaj (svakih 60s) za podatke koji već stižu kroz kanal.
 */
function syncSnapshotTimer() {
  const needsFallback = !realtimeLive;
  if (needsFallback && !snapshotTimer) {
    void refreshSnapshot();
    snapshotTimer = setInterval(() => void refreshSnapshot(), SNAPSHOT_MS);
  } else if (!needsFallback && snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

/** N-01 — heartbeat samo prijavljenom korisniku (gost bi dobio 401 svakih 25s). */
function syncHeartbeatTimer() {
  const authenticated = useAuthStore.getState().isAuthenticated;
  if (authenticated && !heartbeatTimer) {
    void sendHeartbeat();
    heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
  } else if (!authenticated && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
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

  // Bez Realtime konfiguracije `subscribeRealtime` vraća `null` — fallback ostaje aktivan.
  realtimeLive = false;
  channel = subscribeRealtime({
    onStatus: (status) => {
      // `SUBSCRIBED` = kanal radi → ugasi 60s polling; `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`
      // → vrati REST fallback dok se lib ne rekonektuje.
      realtimeLive = status === 'SUBSCRIBED';
      if (started) syncSnapshotTimer();
    },
    onPresence: (event: PresenceEvent) => {
      usePresenceStore.getState().apply(event.userId, event.online, event.at, event.status);
    },
    onNotification: (push: NotificationPush) => {
      // Isti kanal nosi i „nova notifikacija“ — zvonce se osveži odmah, bez
      // čekanja 30s polling intervala. Lista se i dalje vuče preko REST rute.
      if (push.userId !== useAuthStore.getState().user?.id) return;
      void queryClient?.invalidateQueries({ queryKey: ['notifications'] });
      // 6.x — „probudno“ obaveštenje u momentu (ranije se samo osvežavalo zvonce).
      notifyUser(push.notification);
    },
  });

  // Početno stanje: bez Realtime-a odmah; sa Realtime-om samo dok ne stigne
  // `SUBSCRIBED` (kratak prozor), pa polovanje gasi `onStatus`.
  syncSnapshotTimer();
  syncHeartbeatTimer();

  // Povratak u tab = trenutni otkucaj (bez čekanja punih 25s).
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onNetworkOnline);

  return stopPresence;
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    void sendHeartbeat();
    if (!realtimeLive) void refreshSnapshot();
  } else {
    // 2.6.2 — tab u pozadini = „away“ odmah (bez čekanja 90s TTL-a).
    void sendHeartbeat('away');
  }
}

function onNetworkOnline() {
  void sendHeartbeat();
  if (!realtimeLive) void refreshSnapshot();
}

export function stopPresence() {
  started = false;
  realtimeLive = false;
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

/**
 * N-01 — Layout zove ovo kada se promeni stanje prijave: gost ne šalje
 * heartbeat, a prijavljeni korisnik ga odmah dobija (bez čekanja 25s).
 */
export function syncPresenceWithAuth() {
  if (!started) return;
  syncHeartbeatTimer();
  if (!useAuthStore.getState().isAuthenticated) usePresenceStore.getState().reset();
}
