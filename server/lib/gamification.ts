import { db, levelFromXp as levelFromXpShared, levelProgress, xpForLevel, type UserRecord } from './store.js';
import { logger } from './logger.js';
import { notify } from './notifications.js';
import {
  isSharedFallbackError,
  sharedClient,
  sharedKey,
  warnSharedOnce,
  withLock,
  utcDay,
} from './sharedStore.js';

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
  /**
   * 6.x — „koristan odgovor“: autor teme prihvatio tvoj odgovor kao rešenje.
   * Odvojeno od glasova (karma) da se reputacija ne može napumpati lajkovima;
   * broj prihvatanja živi u `users.solved_answers`.
   */
  ACCEPTED_ANSWER: 10,
} as const;

/** Dnevni limit XP-a po korisniku. */
export const DAILY_XP_CAP = 300;

/**
 * Nivo za dati XP — inverz od `xpForLevel`.
 * Implementacija je u `store.ts` (uz `levelRange`/`levelProgress`), da bi svaka
 * ruta i svaki prikaz koristili ISTU krivu. Re-export ostaje za postojeće uvoznike.
 */
export const levelFromXp = levelFromXpShared;

/** Napredak unutar nivoa (`into`/`needed`/`remaining`) — za API i profil. */
export { levelProgress };

export type XpReason =
  | 'thread'
  | 'reply'
  | 'account_connected'
  | 'account_bonus'
  | 'upvote_received'
  | 'profile_bio'
  | 'article_comment'
  | 'admin_award'
  /** F-2 — dnevni loop: bonus za prvi post dana i dnevni kvest. */
  | 'daily_bonus'
  | 'daily_quest'
  /** 2.11.0 — autor teme označio tvoj odgovor kao rešenje (`accepted answer`). */
  | 'accepted_answer'
  /** 6.x — reputacija: brojač prihvaćenih odgovora (+1 po odgovoru). */
  | 'solved_answers';

export interface AwardContext {
  reason: XpReason;
  /** Broj tema/odgovora za badge pravila (ako je poznat). */
  threadCount?: number;
  replyCount?: number;
  connectedCount?: number;
  /** Broj komentara na člancima (`article_commenter` bedž). */
  commentCount?: number;
  /** Nivo posle promene (`level_10` bedž). */
  level?: number;
}

export interface AwardResult {
  user: UserRecord;
  xpAwarded: number;
  capped: boolean;
  levelUp: boolean;
  newBadges: string[];
  /** Kvestovi koji su ovim događajem prešli cilj (code ↓). */
  completedQuests?: string[];
  /** 6.x — novo stanje brojača prihvaćenih odgovora (samo za `solved_answers`). */
  solvedAnswers?: number;
}

/* ------------------------ dnevni budžet XP-a ------------------------ */

/**
 * N-09 — dnevni budžet je deljeno stanje: `xp_budget (user_id, day, xp)`.
 *
 * Ranije je `Map` živeo u procesu, pa je limit od 300 XP važio po instanci —
 * sa 2 instance isti korisnik je mogao da sakupi 600. Sada:
 *   - sa bazom → RPC `spend_daily_xp` (jedan `INSERT … ON CONFLICT DO UPDATE`,
 *     atomičan i između instanci),
 *   - bez baze (memory/test) → isti `Map`, ali ispod `withLock` mutex-a unutar procesa,
 *     da ni tu paralelni `await`-ovi ne pročitaju isto stanje dvaput.
 */
const budgets = new Map<string, { day: string; used: number }>();

/** Keš upozorenja — sprečava spam u logu. */
const warned = new Set<string>();
export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

const today = () => utcDay();

/** Memorijski budžet — samo fallback; poziva se isključivo unutar `withLock`-a. */
function consumeDailyXpLocal(userId: string, amount: number): { granted: number; capped: boolean } {
  const day = today();
  const current = budgets.get(userId);
  const used = current?.day === day ? current.used : 0;
  const remaining = Math.max(0, DAILY_XP_CAP - used);
  const granted = Math.min(amount, remaining);
  budgets.set(userId, { day, used: used + granted });
  return { granted, capped: granted < amount };
}

/**
 * Potroši `amount` iz dnevnog budžeta. Vraća STVARNO dodeljeno i `used` (za log).
 *
 * Baza je autoritet kada je podešena. Ako RPC/tabela ne postoji ili baza nije
 * dostupna — upozori jednom i nastavi memorijski (akcija korisnika ne puca).
 */
async function consumeDailyXp(
  userId: string,
  amount: number,
): Promise<{ granted: number; capped: boolean; used: number; persisted: boolean }> {
  const safeAmount = Math.max(0, Math.floor(amount));
  const client = sharedClient();

  return withLock(sharedKey('xp_budget', userId), async () => {
    if (client) {
      const { data, error } = await client.rpc('spend_daily_xp', {
        p_user_id: userId,
        p_amount: safeAmount,
        p_cap: DAILY_XP_CAP,
      });

      const row = !error && Array.isArray(data) ? data[0] : null;
      if (row) {
        const granted = Number(row.granted ?? 0);
        return { granted, capped: Boolean(row.capped) || granted < safeAmount, used: Number(row.used ?? 0), persisted: true };
      }

      if (error && !isSharedFallbackError(error)) {
        // Prava greška (npr. kršenje ograničenja) — mora da se vidi, ali ne sme
        // da obori temu/odgovor koji je već sačuvan.
        logger.error({ err: error, userId }, 'xp_budget_rpc_failed');
      } else {
        warnSharedOnce('xp_budget', error);
      }
    }

    const local = consumeDailyXpLocal(userId, safeAmount);
    const used = budgets.get(userId)?.used ?? local.granted;
    return { ...local, used, persisted: false };
  });
}

/** Za testiranje / admin reset. Sa bazom briše red za danas (ili sve). */
export async function resetDailyXpBudget(userId?: string) {
  if (userId) budgets.delete(userId);
  else budgets.clear();

  const client = sharedClient();
  if (!client) return;
  try {
    await client.rpc('reset_daily_xp', { p_user_id: userId ?? null, p_day: today() });
  } catch (err) {
    warnSharedOnce('xp_budget_reset', err);
  }
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
  article_commenter: { name: 'Čitač sa mišljenjem', desc: 'Komentarišite 5 članaka' },
  streak_keeper: { name: 'Čuvar niza', desc: '7 dana prijave zaredom' },
  level_10: { name: 'Veteran nivoa', desc: 'Dostignite nivo 10' },
  // 3.0.0 — SISTEMSKI bedževi: dodeljuje ih isključivo administracija.
  // Pre su postojali SAMO kao `<option>` u admin modalu i nigde u katalogu —
  // profil ih nije prikazao (`getBadge()` ne nađe definiciju), a notifikacija je
  // nosila sirovi kod („beta-tester“) umesto imena.
  'beta-tester': { name: 'Beta tester', desc: 'Rano testiranje platforme' },
  'tournament-winner': { name: 'Šampion turnira', desc: 'Pobeda na NEXUS turniru' },
  'vip-supporter': { name: 'VIP pretplatnik', desc: 'Podrška zajednici' },
  'content-creator': { name: 'Kreator sadržaja', desc: 'Gaming sadržaj u ime portala' },
  'community-mvp': { name: 'MVP zajednice', desc: 'Poseban doprinos zajednici' },
  'hardware-guru': { name: 'Hardver guru', desc: 'Stručnost u hardveru i build-ovima' },
} as const;

/** Bedževi se dodeljuju na osnovu stvarnih događaja, nikad na registraciji. */
export function evaluateBadges(
  user: Pick<UserRecord, 'badges'>,
  ctx: AwardContext & { xp: number; karma: number; level?: number },
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
  // Novi bedževi (3.1): nivo i kontekst događaja.
  grant('level_10', (ctx.level ?? 0) >= 10);
  grant('article_commenter', (ctx.commentCount ?? 0) >= 5);

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
    const { granted, capped } = await consumeDailyXp(userId, amount);
    const nextXp = user.xp + granted;
    const nextLevel = levelFromXp(nextXp);
    // Poredi se sa nivoom izvedenim iz XP-a, ne sa (moguće zastarelom) kolonom.
    const levelUp = nextLevel > levelFromXp(user.xp);

    const newBadges = evaluateBadges(
      { badges: user.badges ?? [] },
      {
        ...ctx,
        xp: nextXp,
        level: nextLevel,
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

    // FIX (race condition): između početnog `findById` i ovog upisa neki drugi
    // poziv (npr. admin `addBadge`, paralelna dodela) može dodati bedž.
    // Upis iz zastarelog snapshot-a bi ga pregazio i izgubio — zato se pre
    // spajanja bedževa pročita svež stanje korisnika.
    const fresh = (await db.users.findById(userId)) ?? user;
    // 6.x — reputacija: brojač prihvaćenih odgovora raste samo na `solved_answers`
    // (prihvaćanje od strane autora teme). Čita se SVEŽE stanje iz baze, pa
    // dva istovremena prihvatanja u različitim temama ne gube jedno drugo.
    const solvedAnswers =
      ctx.reason === 'solved_answers'
        ? ((fresh as { solvedAnswers?: number }).solvedAnswers ?? 0) + 1
        : undefined;
    // VAŽNO: `awardXp(id, 0, { reason: 'solved_answers' })` NE SME da prepiše XP
    // zastarelim snapshot-om (`user` je pročitan pre drugog, paralelnog poziva) —
    // tada bi +10 XP od prihvaćenog odgovora bilo izgubljeno. Zato se XP šalje
    // samo kada je zaista dodeljen; reputacija menja samo svoj brojač.
    const updated = await db.users.update(userId, {
      ...(granted > 0 ? { xp: nextXp, level: nextLevel } : {}),
      ...(newBadges.length ? { badges: [...(fresh.badges ?? []), ...newBadges] } : {}),
      ...(solvedAnswers !== undefined ? { solvedAnswers } : {}),
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
        // Ruta bez `:username` uspe (ProfilePage preusmeri na sebe), ali je
        // doslednije slati pun put — isti obrazac kao ostali linkovi.
        link: '/profile?tab=badges',
      }).catch(() => null);
    }

    // F-2 — „Stigao si do novog nivoa“: bez ovoga se level-up vidi samo kao
    // promena broja na profilu. Jedna notifikacija po prelasku (ako XP preskoči
    // dva nivoa, poruka nosi krajnji nivo, ne dve notifikacije).
    if (levelUp && granted > 0) {
      const progress = levelProgress(nextXp);
      await notify({
        userId,
        type: 'level_up',
        title: `Novi nivo: ${nextLevel} 🎉`,
        message: `Stigao si do nivoa ${nextLevel}. Nastavi da pišeš — do nivoa ${nextLevel + 1} treba još ${progress.remaining.toLocaleString('sr-Latn-RS')} XP (${xpForLevel(nextLevel + 1).toLocaleString('sr-Latn-RS')} XP ukupno).`,
        link: '/profile',
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
      solvedAnswers,
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
