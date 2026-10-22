import { db, uid, type NotificationRecord } from './store.js';
import { logger } from './logger.js';
import { publishNotification } from './presence.js';

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
}): Promise<NotificationRecord | null> {
  try {
    const created = await db.notifications.create({
      id: uid('ntf'),
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
      isRead: false,
      actorId: input.actorId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
    // 2.6.1 — zvonu javljamo odmah (Realtime), umesto da čeka polling interval.
    if (created) void publishNotification(input.userId, created);
    return created;
  } catch (err) {
    logger.warn({ err, userId: input.userId, type: input.type }, 'notification_create_failed');
    return null;
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
        message: `Pomenuti ste u temi: ${input.contextTitle}`,
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
