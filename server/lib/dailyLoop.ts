/**
 * F-2 — DNEVNI LOOP (retencija)
 * ----------------------------
 * Tri stvari koje korisniku daju razlog da se vrati SUTRA:
 *
 *  1. **Streak** — broj uzastopnih dana sa aktivnošću (post/odgovor/deal/glas).
 *     Prikaz: 7 kvadrata na profilu; prekid streak-a se vidi odmah.
 *  2. **Bonus za prvi post dana** — `+10 XP` jednom dnevno, nezavisno od
 *     kvestova (do tada je XP bio samo po akciji).
 *  3. **Dnevni kvest** — „odgovori na 1 temu danas“ koji se resetuje svakog
 *     dana i nosi XP + notifikaciju.
 *
 * Zašto tabela, a ne keš u memoriji: streak mora da preživi restart i da ga
 * podele sve instance API-ja, pa je izvor istine `user_daily_activity`
 * (jedan red po korisniku i danu). Bez migracije sve i dalje radi u memoriji,
 * samo bez perzistencije — isti obrazac kao `sharedStore.ts`.
 */

import { db } from './store.js';
import { logger } from './logger.js';
import { notify } from './notifications.js';
import { awardXp } from './gamification.js';

export const FIRST_POST_BONUS_XP = 10;
export const DAILY_QUEST = {
  code: 'daily_reply',
  title: 'Odgovori na 1 temu danas',
  target: 1,
  xp: 15,
};

/** `YYYY-MM-DD` u **lokalnom** vremenu servera (streak je kalendarski, ne UTC). */
export function dayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface DailyRow {
  userId: string;
  day: string;
  /** Broj objava (teme + odgovori) tog dana. */
  posts: number;
  xp: number;
  bonusClaimed: boolean;
  questCompleted: boolean;
  /** 5.3 — da li je dnevni login bonus već dodeljen (streak se time produžava). */
  loginCredited?: boolean;
}

export interface DailyActivityRepo {
  get(userId: string, day: string): Promise<DailyRow | null>;
  /** Poslednjih `days` dana (danas uključen), najnoviji prvi. */
  recent(userId: string, days: number): Promise<DailyRow[]>;
  upsert(row: DailyRow): Promise<DailyRow>;
}

/* ----------------------------- memorija ----------------------------- */

const memoryRows = new Map<string, DailyRow>();
const key = (userId: string, day: string) => `${userId}:${day}`;

class MemoryDailyActivityRepo implements DailyActivityRepo {
  async get(userId: string, day: string) {
    return memoryRows.get(key(userId, day)) ?? null;
  }
  async recent(userId: string, days: number) {
    const rows: DailyRow[] = [];
    for (let index = 0; index < days; index += 1) {
      const date = new Date();
      date.setDate(date.getDate() - index);
      const row = memoryRows.get(key(userId, dayKey(date)));
      if (row) rows.push(row);
    }
    return rows;
  }
  async upsert(row: DailyRow) {
    memoryRows.set(key(row.userId, row.day), { ...row });
    return row;
  }
}

/* ----------------------------- Supabase ----------------------------- */

class SupabaseDailyActivityRepo implements DailyActivityRepo {
  constructor(private client: any) { }

  async get(userId: string, day: string) {
    const { data, error } = await this.client
      .from('user_daily_activity')
      .select('*')
      .eq('user_id', userId)
      .eq('day', day)
      .maybeSingle();
    if (error) return null;
    return data ? mapRow(data) : null;
  }

  async recent(userId: string, days: number) {
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const { data, error } = await this.client
      .from('user_daily_activity')
      .select('*')
      .eq('user_id', userId)
      .gte('day', dayKey(since))
      .order('day', { ascending: false });
    if (error) return [];
    return (data ?? []).map(mapRow);
  }

  async upsert(row: DailyRow) {
    const { data, error } = await this.client
      .from('user_daily_activity')
      .upsert(
        {
          user_id: row.userId,
          day: row.day,
          posts: row.posts,
          xp: row.xp,
          bonus_claimed: row.bonusClaimed,
          quest_completed: row.questCompleted,
          login_credited: row.loginCredited === true,
        },
        { onConflict: 'user_id,day' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }
}

function mapRow(row: any): DailyRow {
  return {
    userId: row.user_id,
    day: String(row.day).slice(0, 10),
    posts: Number(row.posts ?? 0),
    xp: Number(row.xp ?? 0),
    bonusClaimed: row.bonus_claimed === true,
    questCompleted: row.quest_completed === true,
    loginCredited: row.login_credited === true,
  };
}

let repo: DailyActivityRepo | null = null;

/** Repo se bira lenjo (posle izbora data layera u `store.ts`). */
function getRepo(): DailyActivityRepo {
  if (repo) return repo;
  const client = db.kind === 'supabase' ? db.client : null;
  repo = client ? new SupabaseDailyActivityRepo(client) : new MemoryDailyActivityRepo();
  return repo;
}

/* ----------------------------- logika ----------------------------- */

/** Streak: uzastopni dani unazad, računajući danas ili juče (juče = još nije izgubljen). */
export function computeStreak(days: DailyRow[]): { streak: number; best: number } {
  const active = new Set(days.filter((row) => row.posts > 0 || row.xp > 0).map((row) => row.day));
  let streak = 0;
  const cursor = new Date();
  // Ako danas još nema aktivnosti, streak i dalje važi od juče (dan još traje).
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (active.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Najbolji streak: najduži niz uzastopnih dana u poslednjih 60 dana.
  let best = streak;
  let run = 0;
  let previous: Date | null = null;
  for (const row of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!(row.posts > 0 || row.xp > 0)) {
      run = 0;
      previous = null;
      continue;
    }
    const date = new Date(`${row.day}T00:00:00`);
    const consecutive = previous !== null && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1;
    run = consecutive ? run + 1 : 1;
    previous = date;
    best = Math.max(best, run);
  }
  return { streak, best };
}

/**
 * Beleži dnevnu aktivnost i dodeljuje bonus za prvi post dana.
 * Idempotentno: drugi poziv istog dana ne dodeljuje bonus ponovo (što je i
 * razlog zašto se `bonusClaimed` piše u istoj transakciji-kroz-`upsert`).
 */
export async function recordDailyPost(userId: string): Promise<{ bonusXp: number; streakDays: number }> {
  const day = dayKey();
  try {
    const store = getRepo();
    const current = (await store.get(userId, day)) ?? {
      userId,
      day,
      posts: 0,
      xp: 0,
      bonusClaimed: false,
      questCompleted: false,
    };
    const firstPost = !current.bonusClaimed;
    const next: DailyRow = {
      ...current,
      posts: current.posts + 1,
      bonusClaimed: true,
      xp: current.xp + (firstPost ? FIRST_POST_BONUS_XP : 0),
    };
    await store.upsert(next);

    if (firstPost) {
      await awardXp(userId, FIRST_POST_BONUS_XP, { reason: 'daily_bonus' }).catch(() => null);
    }

    const recent = await store.recent(userId, 60);
    const { streak } = computeStreak(recent);
    if (firstPost && streak > 1) {
      await notify({
        userId,
        type: 'streak',
        title: `${streak}. dan zaredom 🔥`,
        message: `Stigao si do ${streak} dana uzastopne aktivnosti. Bonus za današnji prvi post: +${FIRST_POST_BONUS_XP} XP.`,
        link: '/notifications',
      }).catch(() => null);
    }
    return { bonusXp: firstPost ? FIRST_POST_BONUS_XP : 0, streakDays: streak };
  } catch (error) {
    logger.warn({ err: error, userId }, 'daily_post_failed');
    return { bonusXp: 0, streakDays: 0 };
  }
}

/** Dnevni kvest: prvi odgovor dana završava ga (jednom dnevno). */
export async function recordDailyReply(userId: string): Promise<void> {
  const day = dayKey();
  try {
    const store = getRepo();
    const current = (await store.get(userId, day)) ?? {
      userId,
      day,
      posts: 0,
      xp: 0,
      bonusClaimed: false,
      questCompleted: false,
    };
    if (current.questCompleted) return;
    await store.upsert({ ...current, questCompleted: true, xp: current.xp + DAILY_QUEST.xp });
    await awardXp(userId, DAILY_QUEST.xp, { reason: 'daily_quest' }).catch(() => null);
    await notify({
      userId,
      type: 'quest_completed',
      title: 'Dnevni kvest završen 🎯',
      message: `„${DAILY_QUEST.title}“ — +${DAILY_QUEST.xp} XP. Novi kvest stiže sutra.`,
      link: '/notifications',
    }).catch(() => null);
  } catch (error) {
    logger.warn({ err: error, userId }, 'daily_quest_failed');
  }
}

/**
 * 5.3 — PRIJAVA SE RAČUNA KAO DNEVNA AKTIVNOST.
 *
 * Do sada je streak rastao samo na post/odgovor, pa je član koji samo čita
 * gubio niz iako se svakog dana prijavljivao. Sada se prijava upisuje u isti
 * red (`user_daily_activity`) i to: (a) produžava streak, (b) jednom dnevno
 * daje mali XP bonus — motivacija bez kvarenja XP ekonomije za sadržaj.
 *
 * Idempotentno: `loginCredited` se postavlja samo prvom prijavom tog dana,
 * pa refresh sesije / drugi tab ne daju bonus dvaput.
 */
export const DAILY_LOGIN_XP = 5;

/** Koliko dana zaredom; bonus raste do 7 (posle 7 dana fiksno). */
export function loginBonusFor(streak: number): number {
  return DAILY_LOGIN_XP + Math.min(Math.max(streak - 1, 0), 6);
}

export async function recordDailyLogin(
  userId: string,
): Promise<{ bonusXp: number; streakDays: number; firstLoginToday: boolean }> {
  const day = dayKey();
  try {
    const store = getRepo();
    const current = (await store.get(userId, day)) ?? {
      userId,
      day,
      posts: 0,
      xp: 0,
      bonusClaimed: false,
      questCompleted: false,
      loginCredited: false,
    };

    // Već evidentirano danas: streak se i dalje računa (za prikaz), bez XP-a.
    if (current.loginCredited) {
      const { streak } = computeStreak(await store.recent(userId, 60));
      return { bonusXp: 0, streakDays: streak, firstLoginToday: false };
    }

    // Streak PRE upisa: da li je juče bio aktivan (odlučuje da li je bonus zarađen).
    const before = await store.recent(userId, 60);
    const { streak: previousStreak } = computeStreak(before);
    const nextStreak = previousStreak + 1;
    const bonusXp = loginBonusFor(nextStreak);

    await store.upsert({
      ...current,
      loginCredited: true,
      xp: current.xp + bonusXp,
    });
    await awardXp(userId, bonusXp, { reason: 'daily_bonus' }).catch(() => null);

    if (nextStreak === 3 || nextStreak === 7 || nextStreak % 30 === 0) {
      await notify({
        userId,
        type: 'streak',
        title: `${nextStreak} dana prijave zaredom 🔥`,
        message: `Streak ${nextStreak} dana! Dnevni login bonus: +${bonusXp} XP.`,
        link: '/notifications',
      }).catch(() => null);
    }

    // `streak_keeper` — bedž za sedmodnevni niz (dodeljuje se jednom, idempotentno
    // preko `addBadge` koji ignoriše duplikat).
    if (nextStreak >= 7) {
      await db.users.addBadge(userId, 'streak_keeper').catch(() => undefined);
    }

    return { bonusXp, streakDays: nextStreak, firstLoginToday: true };
  } catch (error) {
    logger.warn({ err: error, userId }, 'daily_login_failed');
    return { bonusXp: 0, streakDays: 0, firstLoginToday: false };
  }
}

/** Podaci za UI (`GET /api/users/me/daily`). */
export async function getDailyLoop(userId: string) {
  const store = getRepo();
  const rows = await store.recent(userId, 60);
  const today = rows.find((row) => row.day === dayKey()) ?? null;
  const { streak, best } = computeStreak(rows);
  const last7 = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key7 = dayKey(date);
    const row = rows.find((item) => item.day === key7);
    return { date: key7, active: Boolean(row && (row.posts > 0 || row.xp > 0)) };
  });

  return {
    days: last7,
    streak,
    bestStreak: best,
    firstPostToday: today?.bonusClaimed ?? false,
    // 5.3 — prijava danas produžava streak (bonus je već obračunat na login ruti).
    firstLoginToday: today?.loginCredited ?? false,
    xpToday: today?.xp ?? 0,
    quest: {
      code: DAILY_QUEST.code,
      title: DAILY_QUEST.title,
      progress: today?.questCompleted ? DAILY_QUEST.target : 0,
      target: DAILY_QUEST.target,
      completed: today?.questCompleted ?? false,
    },
  };
}
