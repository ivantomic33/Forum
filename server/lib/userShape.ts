import { levelProgress, type UserRecord } from './store.js';

/**
 * JAVNI OBLIK KORISNIKA
 * ---------------------
 * Profil (`GET /api/users/:username`) i rang-lista su javni. Ranije su vraćali
 * `email`, `isBanned` i `lastSeenAt` svakog člana — enumeracija imejlova i
 * otkrivanje istorije banova. Ovde se eksplicitno nabraja šta sme napolje.
 */
export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  bio: string;
  role: UserRecord['role'];
  level: number;
  xp: number;
  /** Apsolutni prag sledećeg nivoa (stari ugovor, ostaje za kompatibilnost). */
  xpNeeded: number;
  /** XP sakupljen unutar tekućeg nivoa — brojilac XP trake. */
  xpIntoLevel: number;
  /** Koliko XP-a tekući nivo traži ukupno — imenilac XP trake. */
  xpForNext: number;
  /** Koliko još XP-a do sledećeg nivoa (0 na maksimalnom nivou). */
  xpRemaining: number;
  /** Progres unutar nivoa, 0–100. */
  levelProgress: number;
  karma: number;
  /** 6.x — reputacija: prihvaćeni odgovori (odvojeno od karme/glasova). */
  solvedAnswers: number;
  badges: string[];
  connectedAccounts: Record<string, string>;
  isVerified: boolean;
  status: UserRecord['status'];
  /** #4 — preset cover-a profila (null = podrazumevani violet). */
  coverPreset?: string | null;
  createdAt: string;
}

export function publicUser(user: UserRecord): PublicUser {
  // Nivo i pragovi se NIKAD ne čitaju iz keš kolona — izvode se iz `xp`, pa su
  // profil, rang-lista i gamifikacija uvek na istoj krivoj.
  const progress = levelProgress(user.xp);
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio ?? '',
    role: user.role,
    level: progress.level,
    xp: user.xp,
    xpNeeded: progress.end,
    xpIntoLevel: progress.into,
    xpForNext: progress.needed,
    xpRemaining: progress.remaining,
    levelProgress: Math.round(progress.ratio * 100),
    karma: user.karma,
    solvedAnswers: user.solvedAnswers ?? 0,
    badges: user.badges ?? [],
    connectedAccounts: user.connectedAccounts ?? {},
    isVerified: user.isVerified,
    status: user.status,
    coverPreset: user.coverPreset ?? null,
    createdAt: user.createdAt,
  };
}

/**
 * Vlasnik profila (npr. `/auth/me`) dobija i sopstveni email i status bana
 * (UI prikazuje poruku), ali nikad hash lozinke.
 */
export function ownerUser(user: UserRecord) {
  return {
    ...publicUser(user),
    email: user.email,
    isBanned: user.isBanned,
    mutedUntil: user.mutedUntil ?? null,
    // F-21 — vlasnik vidi sa kojom je verzijom uslova saglasan.
    termsVersion: user.termsVersion ?? null,
    termsAcceptedAt: user.termsAcceptedAt ?? null,
  };
}
