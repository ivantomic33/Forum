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
 */
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

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
}

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Konfiguracija je kompletna tek kada su oba javna ključa postavljena. */
export function realtimeConfigured(): boolean {
  return Boolean(url && key);
}

/**
 * Prijava na zajednički kanal. Vraća `null` kada Realtime nije konfigurisan ili
 * `subscribe` javi grešku — pozivalac tada koristi REST fallback.
 */
export function subscribeRealtime(handlers: RealtimeHandlers): RealtimeChannel | null {
  if (!realtimeConfigured()) return null;

  let channel: RealtimeChannel;
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    channel = client.channel(PRESENCE_CHANNEL, {
      config: { broadcast: { self: false, ack: false } },
    });
  } catch {
    return null;
  }

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
      // `CHANNEL_ERROR`/`TIMED_OUT` — lib ima svoj reconnect; REST fallback
      // već teče, pa ovde ne treba ništa dodatno.
      if (status === 'CLOSED') {
        // Namerno tiho: kanal se zatvara pri odjavi.
      }
    });

  return channel;
}
