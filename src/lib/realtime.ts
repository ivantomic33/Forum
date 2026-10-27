/**
 * SUPABASE REALTIME (browser)
 * ---------------------------
 * Javni (publishable) ključ je bezbedan u browseru — pristup tabelama i dalje
 * ograničava RLS, a prisustvo se NIKAD ne upisuje odavde: server je jedini
 * koji objavljuje `presence` događaje preko Broadcast kanala `presence:global`.
 *
 * Ako promenljive nisu postavljene ili WebSocket padne (korporativni proxy),
 * `subscribeRealtime()` vraća `null`, a `presenceStore` se puni preko
 * `GET /api/presence` — zeleni prsten i dalje radi, samo na 60s granularnosti.
 *
 * N-06 — `@supabase/supabase-js` (~227 kB) se **ne** uvozi statički: modul
 * uvlači samo Realtime klijent i to tek posle prvog rendera (`subscribeRealtime`
 * se poziva iz `Layout`-a). Do tada REST fallback radi isto tako ispravno.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

export const PRESENCE_CHANNEL = 'presence:global';
export const PRESENCE_EVENT = 'presence';
export const NOTIFICATION_EVENT = 'notification';

/** 2.6.2 — `online` = aktivan tab, `away` = tab u pozadini, `offline` = nema otkucaja. */
export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceEvent {
  userId: string;
  online: boolean;
  /** 2.6.2 — eksplicitan status; stariji server ga ne šalje (`undefined`). */
  status?: PresenceStatus;
  /** ISO vreme promene — kasniji događaj pobeđuje, pa redosled isporuke nije bitan. */
  at: string;
}

export interface NotificationPush {
  userId: string;
  notification: Record<string, any>;
}

export interface RealtimeHandlers {
  onPresence?: (event: PresenceEvent) => void;
  onNotification?: (push: NotificationPush) => void;
  /**
   * N-02 — stanje kanala (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`,
   * `JOIN` nulom…). Pozivalac ovim gasi/pali REST fallback umesto stalnog polling-a.
   */
  onStatus?: (status: string) => void;
}

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Konfiguracija je kompletna tek kada su oba javna ključa postavljena. */
export function realtimeConfigured(): boolean {
  return Boolean(url && key);
}

/**
 * Prijava na zajednički kanal. Vraća `null` kada Realtime nije konfigurisan, a
 * inače kanal odloženo — `unsubscribe()` radi i pre nego što SDK stigne (tada se
 * kanal otkaže odmah po učitavanju, bez otvaranja WebSocket-a).
 */
export function subscribeRealtime(handlers: RealtimeHandlers): RealtimeChannel | null {
  if (!realtimeConfigured()) return null;

  let closed = false;
  // Dok SDK ne stigne, pozivalac ima ručicu koja samo pamti `unsubscribe`.
  const handle = {
    unsubscribe() {
      closed = true;
    },
  } as RealtimeChannel;

  void import('@supabase/supabase-js')
    .then(({ createClient }) => {
      if (closed) return;
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const channel = client.channel(PRESENCE_CHANNEL, {
        config: { broadcast: { self: false, ack: false } },
      });

      channel
        .on('broadcast', { event: PRESENCE_EVENT }, (message) => {
          const payload = message.payload as PresenceEvent | undefined;
          if (payload && typeof payload.userId === 'string' && typeof payload.online === 'boolean') {
            handlers.onPresence?.(payload);
          }
        })
        .on('broadcast', { event: NOTIFICATION_EVENT }, (message) => {
          const payload = message.payload as NotificationPush | undefined;
          if (payload && payload.userId && payload.notification) {
            handlers.onNotification?.(payload);
          }
        })
        .subscribe((status) => {
          // N-02 — pozivalac (`presenceStore`) na osnovu statusa bira Realtime ili
          // REST fallback: `SUBSCRIBED` gasi 60s polling, greške ga vraćaju.
          // Lib ima svoj reconnect, pa ništa dodatno nije potrebno.
          handlers.onStatus?.(status);
        });

      // Stanje se promenilo dok je SDK stizao — odmah zatvori kanal.
      if (closed) void channel.unsubscribe();
      else (handle as { unsubscribe: () => void }).unsubscribe = () => void channel.unsubscribe();
    })
    .catch(() => {
      // SDK nije stigao (offline) — `presenceStore` ostaje na REST fallback-u.
      handlers.onStatus?.('CHANNEL_ERROR');
    });

  return handle;
}
