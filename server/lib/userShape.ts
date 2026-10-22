import type { UserRecord } from './store.js';

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
  xpNeeded: number;
  karma: number;
  badges: string[];
  connectedAccounts: Record<string, string>;
  isVerified: boolean;
  status: UserRecord['status'];
  createdAt: string;
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio ?? '',
    role: user.role,
    level: user.level,
    xp: user.xp,
    xpNeeded: user.xpNeeded,
    karma: user.karma,
    badges: user.badges ?? [],
    connectedAccounts: user.connectedAccounts ?? {},
    isVerified: user.isVerified,
    status: user.status,
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
