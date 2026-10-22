/**
 * „ONLINE SADA“ — PRISUSTVO KORISNIKA (Supabase Realtime)
 * ------------------------------------------------------
 * Server je jedini izvor istine o tome ko je prijavljen: browser ne dobija
 * service_role ključ (i ne sme da ga dobije), pa klijent ne može da upisuje
 * proizvoljan status u `users`.
 *
 * Kako radi:
 *  - Klijent prijave „otkucaj“ na `POST /api/auth/heartbeat` (aktivnost dok je
 *    tab vidljiv + provera sesije na 60s). Zbog toga server ZNA da je korisnik
 *    prisutan — sam WebSocket kanal to ne bi govorio u Galeriji/mobilnom tabu.
 *  - Prisustvo se objavljuje preko Supabase Realtime Broadcast kanala
 *    `presence:global` sa događajem `presence` i telom `{ userId, online, at }`.
 *    Kanali za događaje su sticky (nema race-a na prijavi) i ne zavise od
 *    Realtime Authorization politika — a sama poruka i dalje nosi samo javni
 *    `userId` (nikad sadržaj privatizovanog kanala).
 *  - Taj ista objava ide u `users.status` kao keš, pa profil i liste rade i
 *    kada WebSocket nije dostupan.
 *  - TTL: ako otkucaja nema duže od `PRESENCE_TTL_SECONDS` (90s), korisnik je
 *    offline. Pasivne korisnike skida `startPresenceSweeper()`.
 *
 * Bez Supabase podešavanja (in-memory demo) koristi se isti interfejs nad
 * `MemoryPresenceStore` — aplikacija nikad ne pada zbog realtime sloja.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { db } from './store.js';
import { logger } from './logger.js';

/** Realtime kanal koji slušaju svi klijenti (`src/lib/realtime.ts`). */
export const PRESENCE_CHANNEL = 'presence:global';
/** Broadcast događaj — jedan po promeni prisustva. */
export const PRESENCE_EVENT = 'presence';

/** Koliko otkucaj važi. Klijent šalje na 25s, pasivni korisnik odpada za 90s. */
export const PRESENCE_TTL_MS = 90_000;
/**
 * Posle ovog vremena bez otkucaja korisnik prelazi u „away“ (prijavljen, ali
 * neaktivan), a posle `PRESENCE_TTL_MS` u „offline“. Klijent ne šalje otkucaj
 * dok tab nije vidljiv, pa je „away“ zapravo „tab u pozadini / laptop zatvoren".
 */
export const PRESENCE_AWAY_MS = 120_000;
/** Minimalni razmak između dva upisa u bazu za istog korisnika (heartbeat je čest). */
const STATUS_WRITE_THROTTLE_MS = 60_000;

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceEvent {
  userId: string;
  /** `online` je `false` i za „away“ — stariji klijenti tada crtaju sivo stanje. */
  online: boolean;
  /** 2.6.2 — eksplicitan status; `undefined` za događaje bez away podrške. */
  status?: PresenceStatus;
  /** ISO vreme promene — klijent ignoriše stariji događaj od onog koji zna. */
  at: string;
}

/** `online` / `away` / `offline` iz vremena poslednjeg otkucaja. */
export function statusAt(lastSeen: number | string | null | undefined, now = Date.now()): PresenceStatus {
  const at = typeof lastSeen === 'string' ? new Date(lastSeen).getTime() : lastSeen;
  if (!at || !Number.isFinite(at)) return 'offline';
  const idle = now - at;
  if (idle < PRESENCE_TTL_MS) return 'online';
  if (idle < PRESENCE_AWAY_MS) return 'away';
  return 'offline';
}

interface PresenceStore {
  /** `user_id → status` za sve prisutne (online + away). */
  online(): Promise<Array<{ userId: string; status: PresenceStatus }>>;
  /** Status za zadati skup ID-jeva — bez čitanja cele tabele (B-16). */
  presenceFor(userIds: string[]): Promise<Map<string, PresenceStatus>>;
  isOnline(userId: string): Promise<boolean>;
  set(userId: string, lastSeen: number): Promise<void>;
  delete(userId: string): Promise<void>;
}

/**
 * In-memory rezerva. Namerno nije u `store.ts`: prisustvo je prolazno stanje i
 * ne ulazi u DataLayer interfejs (nema smisla u `schema-ALL.sql`).
 */
class MemoryPresenceStore implements PresenceStore {
  private readonly seen = new Map<string, number>();

  async online(): Promise<Array<{ userId: string; status: PresenceStatus }>> {
    const now = Date.now();
    return [...this.seen.entries()]
      .map(([userId, at]) => ({ userId, status: statusAt(at, now) }))
      .filter((entry) => entry.status !== 'offline');
  }

  async isOnline(userId: string): Promise<boolean> {
    return statusAt(this.seen.get(userId)) === 'online';
  }

  async presenceFor(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const now = Date.now();
    const map = new Map<string, PresenceStatus>();
    for (const id of userIds) map.set(id, statusAt(this.seen.get(id), now));
    return map;
  }

  async set(userId: string, lastSeen: number): Promise<void> {
    this.seen.set(userId, lastSeen);
  }

  async delete(userId: string): Promise<void> {
    this.seen.delete(userId);
  }
}

/**
 * Supabase tabela `user_presence` (vidi `server/schema-ALL.sql`).
 * Sve greške se gutaju — prisustvo je ukras, ne sme da obori prijavu.
 *
 * Status se namerno računa iz `last_seen_at` (`statusAt`), a ne iz kolone
 * `status`: u prozoru away (90–120s) kolona je i dalje `online`, pa bi baza
 * prijavila zeleni prsten za nekoga kome je istekao otkucaj. Kolona služi
 * samoj bazi (RPC) i dijagnostici; pragovi u JS-u i SQL-u su isti.
 */
class SupabasePresenceStore implements PresenceStore {
  constructor(private readonly client: SupabaseClient) {}

  async online(): Promise<Array<{ userId: string; status: PresenceStatus }>> {
    // 2.6.2 (B-16): RPC filtrira TTL u SQL-u (`WHERE last_seen_at > now() - …`)
    // i vraća i status. Bez `schema-ALL.sql` funkcija ne postoji
    // (PGRST202 / 42883) — tada se koristi direktan upit ispod.
    const rpc = await this.client.rpc('online_users');
    if (!rpc.error) {
      return (rpc.data ?? [])
        .map(
          (row: { user_id: string; last_seen_at?: string | null }): { userId: string; status: PresenceStatus } => ({
            userId: row.user_id,
            status: statusAt(row.last_seen_at),
          }),
        )
        .filter(
          (entry: { userId: string; status: PresenceStatus }): boolean => entry.status !== 'offline',
        );
    }
    if (!isMissingSchemaError(rpc.error)) throw rpc.error;

    // Fallback za bazu bez 2.6.2 migracije: i dalje čitamo samo sveže redove
    // (filter u REST parametru), pa TTL/away računamo u JS-u — nikad celu tabelu.
    const cutoff = new Date(Date.now() - PRESENCE_AWAY_MS).toISOString();
    const { data, error } = await this.client
      .from('user_presence')
      .select('user_id, last_seen_at')
      .gte('last_seen_at', cutoff)
      .order('last_seen_at', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? [])
      .map(
        (row: { user_id: string; last_seen_at?: string | null }): { userId: string; status: PresenceStatus } => ({
          userId: row.user_id,
          status: statusAt(row.last_seen_at),
        }),
      )
      .filter(
        (entry: { userId: string; status: PresenceStatus }): boolean => entry.status !== 'offline',
      );
  }
  async presenceFor(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const map = new Map<string, PresenceStatus>();
    if (!userIds.length) return map;

    const rpc = await this.client.rpc('presence_for_users', { user_ids: userIds });
    if (!rpc.error) {
      for (const row of (rpc.data ?? []) as Array<{ user_id: string; last_seen_at?: string | null }>) {
        map.set(row.user_id, statusAt(row.last_seen_at));
      }
      return map;
    }
    if (!isMissingSchemaError(rpc.error)) throw rpc.error;

    // Bez 2.6.2 migracije — samo redovi traženih korisnika, ne cela tabela.
    const { data, error } = await this.client
      .from('user_presence')
      .select('user_id, last_seen_at')
      .in('user_id', userIds);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ user_id: string; last_seen_at?: string | null }>) {
      map.set(row.user_id, statusAt(row.last_seen_at));
    }
    return map;
  }

  async isOnline(userId: string): Promise<boolean> {
    if (!userId) return false;
    const { data, error } = await this.client
      .from('user_presence')
      .select('last_seen_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return statusAt(data?.last_seen_at) === 'online';
  }

  async set(userId: string, lastSeen: number): Promise<void> {
    const { error } = await this.client.from('user_presence').upsert(
      { user_id: userId, last_seen_at: new Date(lastSeen).toISOString(), status: 'online' },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  async delete(userId: string): Promise<void> {
    const { error } = await this.client.from('user_presence').delete().eq('user_id', userId);
    if (error) throw error;
  }
}

/**
 * Greške koje znače „migracija za ovaj upit nije primenjena“ — na njih se
 * prelazi na fallback umesto da se korisniku prikaže prazna lista.
 *   42P01 = tabela ne postoji, 42883 = funkcija ne postoji,
 *   PGRST202 = PostgREST ne nalazi RPC, PGRST205 = tabela/funkcija nije u schema cache-u.
 */
export function isMissingSchemaError(err: any): boolean {
  const code = err?.code;
  return code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205';
}

// =====================
// Objava promene
// =====================

let broadcastClient: SupabaseClient | null = null;
let broadcastUnavailable = false;
const channels = new Map<string, RealtimeChannel>();
const lastStatusWrite = new Map<string, number>();
/** Poslednje upisano stanje (za razlikovanje „isti online otkucaj“ od promene). */
const lastWrittenStatus = new Map<string, PresenceStatus>();
/** Migracija `user_presence` nije primenjena — upozori jednom, ne na svakih 25s. */
let presenceFallbackLogged = false;

/**
 * Postavi (ili obriši) prisustvo. `broadcast: false` preskače Realtime objavu —
 * koristi se u periodičnom čišćenju gde se poruke grupišu.
 *
 * `status: 'away'` (2.6.2) upisuje svež `last_seen_at` sa oznakom `away` —
 * koristi ga klijent kada tab pređe u pozadinu, ako želi trenutan „away“
 * umesto čekanja TTL-a. Sweep ionako sam prelazi u „away“ posle 90s.
 */
export async function setPresence(
  userId: string,
  online: boolean,
  options: { broadcast?: boolean; status?: Exclude<PresenceStatus, 'offline'> } = {},
) {
  if (!userId) return;
  const now = Date.now();
  const status: PresenceStatus = online ? (options.status ?? 'online') : 'offline';

  try {
    if (online) await presenceStore.set(userId, now);
    else await presenceStore.delete(userId);
  } catch (err: any) {
    // Tabela `user_presence` ne postoji dok se migracija ne pokrene — tada
    // prelazimo na memoriju (broadcast i `users.status` i dalje rade).
    // Grešku logujemo JEDNOM; otkucaj svakih 25s ne sme da zatrpa log.
    // 42P01 = PostgREST/SQL „nema tabele“; PGRST205 = tabela nije u schema cache-u.
    if (isMissingSchemaError(err)) {
      if (!presenceFallbackLogged) {
        presenceFallbackLogged = true;
        logger.warn(
          { code: err.code },
          'Tabela user_presence ne postoji — pokreni`server/schema-ALL.sql`. Prisustvo se čuva u memoriji procesa.',
        );
      }
      presenceStore = memoryPresence;
    } else {
      logger.warn({ err, userId }, 'presence_store_failed');
    }
  }

  // `users.status` — keš za profil/liste; ne pišemo na svaki otkucaj.
  // 2.6.2 — throttle važi za isto stanje `online`; svaka promena (online↔away)
  // se upisuje odmah, inače bi profil prikazivao „na mreži“ dok je korisnik odsutan.
  const lastWrite = lastStatusWrite.get(userId);
  const previousStatus = lastWrittenStatus.get(userId);
  if (status !== 'online' || previousStatus !== 'online' || now - (lastWrite ?? 0) > STATUS_WRITE_THROTTLE_MS) {
    lastStatusWrite.set(userId, now);
    lastWrittenStatus.set(userId, status);
    db.users
      .update(userId, { status, lastSeenAt: new Date(now).toISOString() })
      .catch((err: unknown) => logger.warn({ err, userId }, 'presence_status_write_failed'));
  }

  if (options.broadcast === false) return;
  await publish(userId, online, status);
}

async function realtimeClient(): Promise<SupabaseClient | null> {
  if (broadcastUnavailable) return null;
  if (broadcastClient) return broadcastClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    broadcastUnavailable = true;
    return null;
  }
  broadcastClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return broadcastClient;
}

/**
 * Slanje broadcast poruke sa servera.
 *
 * Server se ne pretplaćuje (`subscribe`), pa je kanal u stanju `closed` i
 * `channel.send()` bi za svaku poruku otvarao novi REST zahtev uz upozorenje
 * („falling back to REST API… deprecated“). `channel.httpSend(...)` je
 * eksplicitni broadcast endpoint i jedini ispravan put ovde.
 */
async function sendBroadcast(channel: RealtimeChannel, event: string, payload: unknown): Promise<void> {
  const sender = channel as unknown as {
    httpSend?: (event: string, payload: unknown, opts?: { type?: string }) => Promise<unknown>;
    state?: string;
  };

  // `httpSend` odgovor kaže `{ success: true }`; greške idu kroz throw, pa se
  // poruka smatra preuzetom na principu „nije puklo = poslato“.
  if (sender.state !== 'joined' && typeof sender.httpSend === 'function') {
    await sender.httpSend(event, payload, { type: 'broadcast' });
    return;
  }

  await channel.send({ type: 'broadcast', event, payload });
}

/**
 * Jedan kanal po temi, isključivo za slanje (nikad `subscribe`).
 * Kanal ne drži WebSocket — svaka poruka ide preko HTTP broadcast endpointa.
 */
async function publish(userId: string, online: boolean, status: PresenceStatus = online ? 'online' : 'offline') {
  try {
    const client = await realtimeClient();
    if (!client) return;

    let channel = channels.get(PRESENCE_CHANNEL);
    if (!channel) {
      channel = client.channel(PRESENCE_CHANNEL, { config: { broadcast: { self: false } } });
      channels.set(PRESENCE_CHANNEL, channel);
    }

    const payload: PresenceEvent = { userId, online, status, at: new Date().toISOString() };
    await sendBroadcast(channel, PRESENCE_EVENT, payload);
  } catch (err) {
    // Realtime nije dostupan (mreža, kvota) — keš i TTL i dalje rade.
    logger.debug({ err, userId }, 'presence_broadcast_failed');
  }
}

// =====================
// Izbor skladišta + start
// =====================

const memoryPresence = new MemoryPresenceStore();
let presenceStore: PresenceStore = memoryPresence;
let sweeper: NodeJS.Timeout | null = null;

/**
 * Pokreće periodično izbacivanje pasivnih korisnika.
 *
 * Heartbeat ide samo dok je tab vidljiv, pa korisnik koji zatvori laptop
 * ostane „online“ dok ne istekne TTL. Sweep (60s) poredi prethodno stanje sa
 * trenutnim i emituje **promenu** — `away` posle 90s, `offline` posle 120s —
 * da klijenti ne crtaju zeleni prsten za nekoga ko je otišao.
 */
export function startPresence(options: { store?: PresenceStore } = {}) {
  if (sweeper) return;
  presenceStore = options.store ?? presenceStore;
  let known = new Map<string, PresenceStatus>();

  const tick = async () => {
    try {
      const entries = await presenceStore.online();
      const current = new Map(entries.map((entry) => [entry.userId, entry.status]));
      const changes: Array<{ id: string; next: PresenceStatus }> = [];

      for (const [id, previous] of known) {
        const next = current.get(id) ?? 'offline';
        if (next !== previous) changes.push({ id, next });
      }
      // Korisnici koji su postali prisutni između dva sweep-a (npr. bez Realtime-a).
      for (const [id, next] of current) {
        if (!known.has(id)) changes.push({ id, next });
      }

      known = current;
      // Grupna objava: jedan red po korisniku, bez upisa u bazu.
      await Promise.all(changes.map(({ id, next }) => publish(id, next === 'online', next)));
      const expired = changes.filter((c) => c.next === 'offline').length;
      if (expired) logger.debug({ count: expired }, 'presence_expired');
    } catch (err: any) {
      // Tabela još nije napravljena — jednom upozori (vidi `setPresence`).
      if (isMissingSchemaError(err)) {
        if (!presenceFallbackLogged) {
          presenceFallbackLogged = true;
          logger.warn(
            { code: err.code },
            'Tabela user_presence ne postoji — pokreni`server/schema-ALL.sql`. Prisustvo se čuva u memoriji procesa.',
          );
        }
        return;
      }
      logger.warn({ err }, 'presence_sweep_failed');
    }
  };

  const timer = setInterval(tick, 60_000);
  // `unref` — sweeper ne sme da drži proces živ (testovi, graceful shutdown).
  timer.unref?.();
  sweeper = timer;
}

export function stopPresence() {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

/** Aktivira Supabase tabelu kao skladište — zove se iz bootstrap-a kada je baza podešena. */
export function useSupabasePresence(client: SupabaseClient) {
  presenceStore = new SupabasePresenceStore(client);
}

/**
 * OBLAST: NOTIFIKACIJE (2.6.1)
 * ----------------------------
 * Isti kanal prenosi i „imaš novu notifikaciju“ — samo javni oblik notifikacije
 * (primalac je već filter na klijentu). Time zvonce reaguje bez polling-a, a
 * klijent i dalje vuče listu preko REST rute (`/api/notifications`) jer ona
 * nosi `unreadCount` i paginaciju.
 */
export const NOTIFICATION_EVENT = 'notification';

export interface NotificationPush {
  userId: string;
  notification: Record<string, any>;
}

export async function publishNotification(userId: string, notification: Record<string, any>) {
  try {
    const client = await realtimeClient();
    if (!client) return;
    let channel = channels.get(PRESENCE_CHANNEL);
    if (!channel) {
      channel = client.channel(PRESENCE_CHANNEL, { config: { broadcast: { self: false } } });
      channels.set(PRESENCE_CHANNEL, channel);
    }
    await sendBroadcast(channel, NOTIFICATION_EVENT, { userId, notification });
  } catch (err) {
    logger.debug({ err, userId }, 'notification_broadcast_failed');
  }
}

/** Trenutno prisutni korisnici (za `GET /api/presence` fallback u klijentu). */
export async function listPresence(): Promise<Array<{ userId: string; status: PresenceStatus }>> {
  try {
    return await presenceStore.online();
  } catch {
    return [];
  }
}

/** Samo `online` (bez „away“) — za odgovore koji isključivo pitaju „je li tu sada“. */
export async function listOnline(): Promise<string[]> {
  return (await listPresence()).filter((entry) => entry.status === 'online').map((entry) => entry.userId);
}

/**
 * Masovna provera za listu (profil, rang-lista, forum) — jedan upit, ne N upita.
 *
 * 2.6.2 (B-16): ranije je svaka lista (profil, rang-lista, tema) čitala CELU
 * tabelu `user_presence`. Sada se traže samo ID-jevi koji se stvarno prikazuju:
 *  - uz RPC `presence_for_users(uuid[])` — filter u SQL-u na `user_id = ANY(…)`;
 *  - bez migracije — `in('user_id', ids)`, i dalje samo traženi redovi.
 */
export async function presenceMap(userIds: Array<string | null | undefined>): Promise<Map<string, PresenceStatus>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  return presenceStore.presenceFor(ids);
}

/** ID-jevi koji su trenutno `online` („away“ se ne računa kao prisustvo za listu). */
export async function onlineSet(userIds: Array<string | null | undefined>): Promise<Set<string>> {
  const map = await presenceMap(userIds);
  return new Set([...map.entries()].filter(([, status]) => status === 'online').map(([id]) => id));
}

export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    return await presenceStore.isOnline(userId);
  } catch {
    return false;
  }
}

/** `online | away | offline` za jednog korisnika (profil vraća status, ne samo boolean). */
export async function userStatus(userId: string): Promise<PresenceStatus> {
  if (!userId) return 'offline';
  try {
    const map = await presenceMap([userId]);
    return map.get(userId) ?? 'offline';
  } catch {
    return 'offline';
  }
}
