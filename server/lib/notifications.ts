import { db, newId, type NotificationRecord } from './store.js';
import { logger } from './logger.js';
import { publishNotification } from './presence.js';
import { emailConfigured, sendNotificationEmail } from './email.js';
import { getSharedValue, setSharedValue } from './sharedStore.js';
import { getNotificationPreferences, shouldPush } from './notificationPreferences.js';

/**
 * Tiši sati: `true` kada push SME da se pošalje. Greška u čitanju podešavanja
 * ne sme da ućutka push — tada se ponašamo kao da nema ograničenja.
 */
async function shouldPushToUser(userId: string, type: NotificationRecord['type']): Promise<boolean> {
  try {
    const prefs = await getNotificationPreferences(userId);
    return shouldPush(prefs, type).push;
  } catch (err) {
    logger.debug({ err, userId, type }, 'quiet_hours_read_failed');
    return true;
  }
}

/** 2.11.0 — mejl kanal za pojedinačne notifikacije. */

/**
 * Tipovi koji idu mejlom — PRAZNO.
 *
 * Mejl se šalje SAMO za verifikaciju adrese i reset lozinke (transakcioni mejlovi
 * u `lib/email.ts`). Sve notifikacije — odgovori, pominjanja, DM, upozorenja,
 * bedž, uloga, pad cene — ostaju isključivo u aplikaciji: zvonce + Realtime +
 * web push. Set ostaje (prazan) da bi postojeći pozivaoci i testovi ostali
 * kompatibilni, ali nijedan tip se ovim putem više ne šalje mejlom.
 */
export const EMAIL_NOTIFICATION_TYPES = new Set<NotificationRecord['type']>();

/**
 * Da li JE-BAS mejl kanal. Nema ga — notifikacije žive samo u aplikaciji.
 */
export const sendsNotificationEmail = (record: NotificationRecord) =>
  EMAIL_NOTIFICATION_TYPES.has(record.type);

/** 1 mejl / 5 min po korisniku (bilo koji tip) — protiv bujice pri živoj diskusiji. */
export const NOTIFICATION_EMAIL_THROTTLE_MS = 5 * 60 * 1000;

export const notificationEmailThrottleKey = (userId: string) => `notify_email.sent:${userId}`;
export const notificationEmailPrefsKey = (userId: string) => `notify_email.prefs:${userId}`;

interface EmailPrefs {
  enabled: boolean;
  /** Tipovi koje korisnik NE želi mejlom (podrazumevano prazno). */
  muted: NotificationRecord['type'][];
}

const DEFAULT_PREFS: EmailPrefs = { enabled: true, muted: [] };

/** Preferencije korisnika iz `site_meta` (prežive restart, dele se između instanci). */
export async function getNotificationEmailPrefs(userId: string): Promise<EmailPrefs> {
  const stored = await getSharedValue<Partial<EmailPrefs>>(notificationEmailPrefsKey(userId)).catch(() => null);
  if (!stored) return DEFAULT_PREFS;
  return {
    enabled: stored.enabled !== false,
    muted: Array.isArray(stored.muted) ? stored.muted : [],
  };
}

export async function setNotificationEmailPrefs(
  userId: string,
  prefs: Partial<EmailPrefs>,
): Promise<EmailPrefs> {
  const current = await getNotificationEmailPrefs(userId);
  const next: EmailPrefs = {
    enabled: prefs.enabled === undefined ? current.enabled : prefs.enabled === true,
    muted: Array.isArray(prefs.muted) ? prefs.muted : current.muted,
  };
  await setSharedValue(notificationEmailPrefsKey(userId), next);
  return next;
}

/**
 * Pošalji mejl za JEDNU notifikaciju. Nikad ne baca.
 *
 * Pravila: bez provajdera nema slanja; samo tipovi iz `EMAIL_NOTIFICATION_TYPES`
 * (trenutno prazan set — mejl ide samo za verifikaciju i reset lozinke), pa ova
 * funkcija u praksi uvek vraća `false`; korisnik mora imati `enabled` i tip ne sme biti u `muted`;
 * throttle 1/5 min po korisniku. Throttle marker se piše samo kada je mejl
 * zaista poslat — inače bi jedan neuspeh blokirao sledeći pokušaj.
 */
export async function sendNotificationEmailFor(userId: string, record: NotificationRecord): Promise<boolean> {
  try {
    if (!emailConfigured()) return false;
    if (!sendsNotificationEmail(record)) return false;

    const prefs = await getNotificationEmailPrefs(userId);
    if (!prefs.enabled || prefs.muted.includes(record.type)) return false;

    const key = notificationEmailThrottleKey(userId);
    const lastSent = await getSharedValue<string>(key);
    if (lastSent && Date.now() - new Date(lastSent).getTime() < NOTIFICATION_EMAIL_THROTTLE_MS) {
      return false;
    }

    const user = await db.users.findById(userId).catch(() => null);
    if (!user?.email || user.isBanned) return false;

    const sent = await sendNotificationEmail(user.email, {
      title: record.title,
      message: record.message,
      path: record.link ?? '/notifications',
    });

    if (sent) await setSharedValue(key, new Date().toISOString()).catch(() => null);
    return sent;
  } catch (err) {
    logger.warn({ err, userId, type: record.type }, 'notification_email_failed');
    return false;
  }
}

/**
 * Kreira notifikaciju. Nikada ne baca grešku ka pozivaocu — notifikacija
 * ne sme da obori glavnu akciju (odgovor, glas, pominjanje).
 */
export async function notify(input: {
  userId: string;
  type: NotificationRecord['type'];
  title: string;
  message: string;
  link?: string;
  actorId?: string | null;
  metadata?: Record<string, any>;
  /**
   * Zadržan radi kompatibilnosti pozivalaca, ali se IGNORIŠE — mejl se za
   * notifikacije ne šalje ni za jedan tip (samo verifikacija i reset lozinke).
   */
  notifyByEmail?: boolean;
}): Promise<NotificationRecord | null> {
  try {
    const base = {
      // UUID: kolona `notifications.id` je `uuid` — `ntf_…` je obarao insert.
      id: newId(),
      userId: input.userId,
      title: input.title,
      message: input.message,
      link: input.link,
      isRead: false,
      actorId: input.actorId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };

    let created: NotificationRecord | null;
    try {
      created = await db.notifications.create({ ...base, type: input.type });
    } catch (error: any) {
      // Baza odbija novi tip (`23514`, CHECK iz starije šeme) → notifikacija
      // bi tiho nestala. Umesto toga je upisujemo kao `system`, a pravi tip
      // ostaje u `metadata.originalType` (UI: značka iste ikone).
      if (error?.code !== '23514') throw error;
      logger.warn({ type: input.type }, 'notification_type_rejected_falling_back');
      created = await db.notifications.create({
        ...base,
        type: 'system',
        metadata: { ...base.metadata, originalType: input.type },
      });
    }
    // 2.6.1 — zvonu javljamo odmah (Realtime), umesto da čeka polling interval.
    if (created) void publishNotification(input.userId, created);
    // Mejl kanal notifikacija je UGAŠEN: mejl ide samo za verifikaciju adrese i
    // reset lozinke. Notifikacije ostaju u aplikaciji (inbox + zvonce + Realtime)
    // i na web push-u. `notifyByEmail` se namerno ignoriše — ostaje u ulazu da
    // pozivaoci ne bi morali da se menjaju.
    void input.notifyByEmail;

    // F-7 — web push (ako je korisnik pretplaćen i `web-push` je instaliran).
    // Dinamički uvoz da `routes/push.ts` → `notifications.ts` ne napravi ciklus.
    // Tiši sati (6.x): u izabranom opsegu ili za mutirane tipove push se preskače,
    // ali notifikacija ostaje u inbox-u — ništa se ne gubi, samo se ne zvoni.
    if (created && !(await shouldPushToUser(input.userId, input.type))) {
      return created;
    }
    if (created) {
      void import('../routes/push.js')
        .then(({ sendPushToUser }) =>
          sendPushToUser(input.userId, {
            title: input.title,
            body: input.message,
            url: input.link ?? '/notifications',
            tag: `${input.type}:${created.id}`,
          }),
        )
        .catch(() => undefined);
    }
    return created;
  } catch (err) {
    logger.warn({ err, userId: input.userId, type: input.type }, 'notification_create_failed');
    return null;
  }
}

/** @-handle verifikacionog bota (link se dodaje ručno, pa ga parser ne hvata). */
export const BOT_SENDER = 'NEXUS Bot';

/**
 * 3.0.0 — VERIFIKACIONI BOT (poruke u inbox)
 * ------------------------------------------
 * Novi članovi su do sada dobijali samo mejl; ko mejl propusti nije ni znao
 * zašto ne može da piše. Bot sada vodi korisnika kroz tok kroz inbox:
 *
 *  1. `verificationWelcome` — odmah posle registracije: nalog postoji, ali
 *     objavljivanje (teme, odgovori, DM, glasanje) traži potvrđen mejl.
 *  2. `verificationThanks` — kada mejl bude potvrđen: zahvalnica + šta dalje.
 *  3. `verificationReminder` — ponovni link kada se traži ponovno slanje.
 *
 * `metadata.bot = true` je oznaka za UI (avatarska značka „BOT“); `link` vodi
 * direktno na `/verify` kada je token dostupan (dev/lokalno), inače na profil.
 */
const BOT_METADATA = { bot: true } as const;

export async function verificationWelcome(input: {
  userId: string;
  username: string;
  verifyLink?: string | null;
  /** Da li je verifikacioni mejl zaista otišao (`false` = nema provajdera). */
  emailSent?: boolean;
}): Promise<NotificationRecord | null> {
  // Tri realna stanja: (1) mejl je poslat → uputi na inbox; (2) dev režim nosi
  // token → link je ovde; (3) mejl NIJE poslat → ne tvrdimo da jeste.
  const message = input.verifyLink
    ? 'Nalog je kreiran, ali još nije potvrđen. Da bi mogao da pišeš teme, odgovore i privatne poruke, potvrdi email adresu — link važi 24h.'
    : input.emailSent
      ? 'Nalog je kreiran, ali još nije potvrđen. Poslali smo link na tvoj mejl (proveri i „Spam“). Dok ne potvrdiš adresu možeš samo da čitaš forum.'
      : 'Nalog je kreiran, ali verifikacioni mejl trenutno nije poslat (mejl servis nije konfigurisan). Pokušaj „Pošalji link“ u baneru iznad — do tada možeš samo da čitaš.';

  return notify({
    userId: input.userId,
    type: 'verification',
    title: `${BOT_SENDER}: dobrodošao, ${input.username}! 👋`,
    message,
    // Postoji token → link ide pravo na stranicu zaverifikaciju, bez kopiranja.
    link: input.verifyLink ?? '/verify',
    actorId: null,
    metadata: { ...BOT_METADATA, verifyLink: input.verifyLink ?? null },
  });
}

export async function verificationThanks(input: {
  userId: string;
  username: string;
}): Promise<NotificationRecord | null> {
  return notify({
    userId: input.userId,
    type: 'verification',
    title: `${BOT_SENDER}: hvala što si potvrdio nalog! ✅`,
    message: 'Email adresa je verifikovana — sada možeš da objavljuješ teme, odgovaraš, glasaš, šalješ privatne poruke i zarađuješ XP. Za početak pogledaj pravila foruma.',
    link: '/forum',
    actorId: null,
    metadata: { ...BOT_METADATA, stage: 'verified' },
  });
}

export async function verificationReminder(input: {
  userId: string;
  username: string;
  verifyLink?: string | null;
}): Promise<NotificationRecord | null> {
  return notify({
    userId: input.userId,
    type: 'verification',
    title: `${BOT_SENDER}: novi link za potvrdu 📨`,
    message: input.verifyLink
      ? 'Poslali smo novi link za potvrdu email adrese (važi 24h). Objavljivanje je otključano čim potvrdiš.'
      : 'Poslali smo novi link za potvrdu email adrese na tvoj mejl (važi 24h). Proveri i „Spam“ folder.',
    link: input.verifyLink ?? '/verify',
    actorId: null,
    metadata: { ...BOT_METADATA, stage: 'reminder', verifyLink: input.verifyLink ?? null },
  });
}

/** 3.0.0 — staff dobija sistemsku notifikaciju za operativne događaje. */
export async function notifyStaff(input: {
  type?: NotificationRecord['type'];
  title: string;
  message: string;
  link?: string;
  actorId?: string | null;
  metadata?: Record<string, any>;
  excludeUserIds?: string[];
  /**
   * Zadržan radi kompatibilnosti pozivalaca, ali se IGNORIŠE — staff
   * obaveštenja žive samo u inbox-u (mejl samo za verifikaciju i reset lozinke).
   */
  email?: boolean;
}): Promise<number> {
  try {
    const all = await db.users.findAll();
    const excluded = new Set(input.excludeUserIds ?? []);
    let sent = 0;
    for (const user of all) {
      if (user.role !== 'admin' && user.role !== 'moderator') continue;
      if (user.isBanned || excluded.has(user.id)) continue;
      const created = await notify({
        userId: user.id,
        type: input.type ?? 'staff',
        title: input.title,
        message: input.message,
        link: input.link,
        actorId: input.actorId ?? null,
        metadata: input.metadata,
        notifyByEmail: input.email === true,
      });
      if (created) sent += 1;
    }
    return sent;
  } catch (err) {
    logger.warn({ err }, 'staff_notify_failed');
    return 0;
  }
}

const MENTION_RE = /@([a-zA-Z0-9_]{3,25})/g;

/** Izvuče jedinstvene @username pominjane iz (sanitizovanog) HTML sadržaja. */
export function extractMentions(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

/**
 * Parsira @mentions i obaveštava pomenute korisnike.
 * Preskače autora, već obaveštene korisnike i nepostojeće naloge.
 */
export async function notifyMentions(input: {
  content: string;
  actorId: string;
  actorUsername: string;
  link: string;
  contextTitle: string;
  /** Korisnici koji su već dobili notifikaciju za isti događaj (bez duplikata). */
  excludeUserIds?: Set<string> | string[];
  /** Kontekst mesta pominjanja (npr. „u temi“ / „u članku“); podrazumevano „u temi“. */
  contextLabel?: string;
}): Promise<number> {
  const usernames = extractMentions(input.content);
  const excluded = new Set<string>([input.actorId, ...(input.excludeUserIds ?? [])]);
  let sent = 0;

  for (const username of usernames) {
    try {
      const user = await db.users.findByUsername(username);
      if (!user || excluded.has(user.id)) continue;
      excluded.add(user.id);

      await notify({
        userId: user.id,
        type: 'mention',
        title: `${input.actorUsername} vas je pomenuo`,
        message: `Pomenuti ste ${input.contextLabel ?? 'u temi'}: ${input.contextTitle}`,
        link: input.link,
        actorId: input.actorId,
      });
      sent += 1;
    } catch (err) {
      logger.warn({ err, username }, 'mention_notify_failed');
    }
  }

  return sent;
}
