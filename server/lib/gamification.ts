import { db, xpForLevel, type UserRecord } from './store.js';
import { logger } from './logger.js';
import { notify } from './notifications.js';

/**
 * GEJMIFIKACIJA — JEDNO MESTO
 * ---------------------------
 * `awardXp()` je jedini način da se XP, nivo i bedževi menjaju. On:
 *   1. primenjuje **dnevni limit** XP-a (sprečava farmovanje spamovanjem),
 *   2. **izračuna nivo iz XP-a** (`levelFromXp`) — nivo se više nikad ne
 *      postavlja ručno i ne može da „preskoči“,
 *   3. dodeli bedž po determinističkim pravilima **na pravom događaju**
 *      (npr. `first_post` tek posle prve objave, ne na registraciji).
 *
 * Sve mutirajuće rute (forum, komentari, profil) zovu ovu funkciju.
 */

export const XP = {
  THREAD: 20,
  REPLY: 5,
  ACCOUNT_CONNECTED: 25,
  FOUR_ACCOUNTS: 150,
  UPVOTE_RECEIVED: 1,
} as const;

/** Dnevni limit XP-a po korisniku. */
export const DAILY_XP_CAP = 300;

/** Najviši XP koji pripada svakom nivou — inverz od `xpForLevel`. */
export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < 200 && xpForLevel(level + 1) <= xp) level += 1;
  return level;
}

export type XpReason =
  | 'thread'
  | 'reply'
  | 'account_connected'
  | 'account_bonus'
  | 'upvote_received'
  | 'profile_bio'
  | 'article_comment'
  | 'admin_award';

export interface AwardContext {
  reason: XpReason;
  /** Broj tema/odgovora za badge pravila (ako je poznat). */
  threadCount?: number;
  replyCount?: number;
  connectedCount?: number;
}

export interface AwardResult {
  user: UserRecord;
  xpAwarded: number;
  capped: boolean;
  levelUp: boolean;
  newBadges: string[];
  /** Kvestovi koji su ovim događajem prešli cilj (code ↓). */
  completedQuests?: string[];
}

/* ------------------------ dnevni budžet XP-a ------------------------ */

// In-memory budžet (reset u ponoć). U Supabase-u bi ovo bio UPDATE ... WHERE
// xp_log_date = CURRENT_DATE; do zvanične tabele, ovo štiti od zloupotrebe.
const budgets = new Map<string, { day: string; used: number }>();

/** Keš upozorenja — sprečava spam u logu. */
const warned = new Set<string>();
export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

const today = () => new Date().toISOString().slice(0, 10);

function consumeDailyXp(userId: string, amount: number): { granted: number; capped: boolean } {
  const day = today();
  const current = budgets.get(userId);
  const used = current?.day === day ? current.used : 0;
  const remaining = Math.max(0, DAILY_XP_CAP - used);
  const granted = Math.min(amount, remaining);
  budgets.set(userId, { day, used: used + granted });
  return { granted, capped: granted < amount };
}

/** Za testiranje / admin reset. */
export function resetDailyXpBudget(userId?: string) {
  if (userId) budgets.delete(userId);
  else budgets.clear();
}

/* ----------------------------- bedževi ----------------------------- */

/**
 * Katalog (imena/opisi) — mora da odgovara `server/schema-ALL.sql`` i
 * `src/lib/badges.ts`. `founder` i `legend` su LEGACY kodovi iz starih baza:
 * ostaju prepoznati, ali se **više ne dodeljuju automatski**. Ranije se SQL
 * opis (`veteran` = 30 dana aktivnosti, `influencer` = 1000 karme) nije
 * poklapao sa kodom (5.000 XP / 4 povezana naloga).
 */
export const BADGE_CATALOG = {
  first_post: { name: 'Prva objava', desc: 'Objavite prvu temu ili odgovor' },
  helpful: { name: 'Pomoćnik', desc: 'Napišite 25 odgovora' },
  contributor: { name: 'Kontributor', desc: 'Otvorite 10 tema' },
  expert: { name: 'Ekspert', desc: 'Dostignite 500 karme' },
  influencer: { name: 'Influenser', desc: 'Povežite 4 gaming naloga' },
  veteran: { name: 'Veteran', desc: 'Dostignite 5.000 XP' },
  founder: { name: 'Osnivač', desc: 'Među prvim članovima zajednice' },
  legend: { name: 'Legenda', desc: 'Posebno dodeljeno dostignuće' },
} as const;

/** Bedževi se dodeljuju na osnovu stvarnih događaja, nikad na registraciji. */
export function evaluateBadges(
  user: Pick<UserRecord, 'badges'>,
  ctx: AwardContext & { xp: number; karma: number },
): string[] {
  const owned = new Set(user.badges ?? []);
  const earned: string[] = [];
  const grant = (badge: string, condition: boolean) => {
    if (condition && !owned.has(badge)) {
      owned.add(badge);
      earned.push(badge);
    }
  };

  grant('first_post', ctx.reason === 'thread' || ctx.reason === 'reply');
  // `threadCount` i `replyCount` se ne šalju iz svih ruta — tada se ne dodeljuje
  // bedž na osnovu nepoznatog broja (ranije je `(undefined ?? 0) >= 10` bilo false).
  grant('contributor', (ctx.threadCount ?? 0) >= 10);
  grant('expert', ctx.karma >= 500);
  grant('helpful', (ctx.replyCount ?? 0) >= 25);
  grant('influencer', (ctx.connectedCount ?? 0) >= 4);
  grant('veteran', ctx.xp >= 5000);

  return earned;
}

/* --------------------------- awardXp() ---------------------------- */

/**
 * Dodeli XP i preračunaj nivo/bedževe.
 * Greške ne prekidaju glavnu akciju (npr. tema je već sačuvana) — samo se loguju.
 */
export async function awardXp(userId: string, amount: number, ctx: AwardContext): Promise<AwardResult | null> {
  try {
    const user = await db.users.findById(userId);
    if (!user) return null;

    // Data layer sam rešava gde idu badges (u kolonu ako postoji, inače u
    // lokalno fallback skladište) — ovde se ne radi probni upis koji bi
    // pregazio postojeće bedževe praznim nizom.
    const { granted, capped } = consumeDailyXp(userId, amount);
    const nextXp = user.xp + granted;
    const nextLevel = levelFromXp(nextXp);
    const levelUp = nextLevel > user.level;

    const newBadges = evaluateBadges(
      { badges: user.badges ?? [] },
      {
        ...ctx,
        xp: nextXp,
        karma: user.karma + (ctx.reason === 'upvote_received' ? granted : 0),
      },
    );
    // `evaluateBadges` već dodeljuje influencer; ovde je samo zaštita od
    // duplikata (ranije je `user.badges.includes` pucao ako je niz nedostajao).
    if (
      ctx.reason === 'account_connected' &&
      (ctx.connectedCount ?? 0) >= 4 &&
      !(user.badges ?? []).includes('influencer') &&
      !newBadges.includes('influencer')
    ) {
      newBadges.push('influencer');
    }

    const updated = await db.users.update(userId, {
      xp: nextXp,
      level: nextLevel,
      badges: [...(user.badges ?? []), ...newBadges],
    });

    // Normalizovana tabela je izvor istine — keš kolona je samo brz prikaz.
    await Promise.all(
      newBadges.map((code) =>
        db.users.addBadge(userId, code).catch((error) => {
          logger.warn({ err: error, code, userId }, 'user_badge_persist_failed');
        }),
      ),
    );

    // Notifikacije za nove bedževe (zvonce, `/notifications`).
    for (const code of newBadges) {
      const badge = BADGE_CATALOG[code as keyof typeof BADGE_CATALOG];
      await notify({
        userId,
        type: 'badge_earned',
        title: 'Novi bedž! 🏅',
        message: badge ? `Osvojili ste bedž „${badge.name}“ — ${badge.desc}.` : `Osvojili ste bedž „${code}“.`,
        link: '/profile?tab=badges',
      }).catch(() => null);
    }

    // Kvestovi: provera uslova ide na serveru, u istom pozivu kao XP.
    const completedQuests = await advanceQuests(userId, ctx);

    return {
      user: updated ?? user,
      xpAwarded: granted,
      capped,
      levelUp,
      newBadges,
      completedQuests,
    };
  } catch (error) {
    logger.error({ err: error, userId }, 'awardXp_failed');
    return null;
  }
}

/* ----------------------------- kvestovi ---------------------------- */

/** Događaj → kvest kodovi koje treba unaprediti. */
const QUEST_EVENTS: Partial<Record<XpReason, string>> = {
  thread: 'first_discussion',
  reply: 'voice_of_reason',
  account_connected: 'social_butterfly',
};

/**
 * Napreduje kvest u bazi (`advance_quest` RPC) i obaveštava korisnika
 * kada je kvest kompletiran. Greška ne prekida glavnu akciju.
 */
async function advanceQuests(userId: string, ctx: AwardContext): Promise<string[]> {
  const code = QUEST_EVENTS[ctx.reason];
  if (!code) return [];

  try {
    const result = await db.quests.advance(userId, code, 1);
    if (!result) return [];

    if (result.completed && !result.alreadyCompleted) {
      await notify({
        userId,
        type: 'quest_completed',
        title: 'Kvest završen! 🎉',
        message: `Završili ste kvest „${code}“. Nagrada je dodata na nalog.`,
        // Profil vlasnika; tab se bira preko `?tab=quests`.
        link: `/profile/${(await db.users.findById(userId))?.username ?? ''}?tab=quests`,
      }).catch(() => null);
      return [code];
    }
    return [];
  } catch (error) {
    logger.warn({ err: error, code, userId }, 'quest_advance_failed');
    return [];
  }
}

/**
 * Karma autora kada neko glasa za njegovu temu/odgovor.
 * Vlasnik ne dobija karmu za sopstveni glas, a delta prati promenu glasa.
 * U Supabase režimu koristi atomični RPC (`apply_user_karma`).
 */
export async function applyAuthorKarma(authorId: string | undefined, delta: number): Promise<void> {
  if (!authorId || delta === 0) return;
  try {
    const applied = await db.users.applyKarma(authorId, delta);
    if (applied) return;
    const author = await db.users.findById(authorId);
    if (!author) return;
    await db.users.update(authorId, { karma: author.karma + delta });
  } catch (error) {
    logger.error({ err: error }, 'apply_author_karma_failed');
  }
}
