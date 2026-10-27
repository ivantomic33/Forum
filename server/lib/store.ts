/**
 * NEXUS DATA LAYER
 * -----------------
 * Apstrakcija nad perzistencijom podataka.
 *
 * Ako su `SUPABASE_URL` i `SUPABASE_SERVICE_KEY` podešeni u `.env`,
 * koristi se Supabase (PostgreSQL). U suprotnom, koristi se in-memory
 * store (demo režim) da bi ceo sistem radio bez podešavanja baze.
 *
 * Interfejs je namerno minimalan i sinhrono-kompatibilan sa mock podacima
 * koji su već postojali, tako da rute ne moraju da znaju odakle podaci dolaze.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { getExtras, patchExtras } from './userExtras.js';
import { logger } from './logger.js';
import type { RefreshSessionRecord, RefreshSessionRepo } from './sessions.js';
import type { OAuthIdentityRecord, OAuthRepo } from './oauth.js';
import { isUnsetValue } from './env.js';
import {
  compareDeals,
  computeDiscountPct,
  filterDeals,
  isExpired,
  normalizeSlug,
  type DealFilter,
  type DealRecord,
  type DealSort,
  type DealStatusResult,
  type DealVote,
  type GameRecord,
  type GuideCategory,
  type GuideRecord,
  type GuideStatus,
} from './deals.js';

/**
 * B-01 — u memorijskom režimu sesije po defaultu žive samo u RAM-u, pa restart
 * briše trag za detekciju ponovne upotrebe refresh tokena („porodicu“).
 * U razvoju ih zato upisujemo u `server/.data/sessions.json` (git-ignored).
 * Testovi (`NODE_ENV=test`) i produkcija nikad ne diraju disk.
 * Eksplicitno: `SESSION_PERSISTENCE=1` uključuje, `SESSION_PERSISTENCE=0` isključuje.
 */
export function memoryPersistenceEnabled(): boolean {
  const flag = (process.env.SESSION_PERSISTENCE ?? '').trim();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false' || (!flag && process.env.NODE_ENV === 'production')) return false;
  return process.env.NODE_ENV !== 'test';
}

// =====================
// Tipovi entiteta
// ====================
export interface UserRecord {
  id: string;
  username: string;
  email: string;
  password: string; // hash
  avatar: string;
  bio?: string;
  /** `dev` je kozmetička uloga (značka/okvir) — nema moderatorske dozvole. */
  role: 'admin' | 'dev' | 'moderator' | 'member';
  level: number;
  xp: number;
  xpNeeded: number;
  karma: number;
  badges: string[];
  connectedAccounts: Record<string, string>;
  /** B-03 — platforme čiji je identitet stvarno potvrđen (Steam API / OAuth link). */
  verifiedPlatforms?: string[];
  isVerified: boolean;
  isBanned: boolean;
  /**
   * 6.x — REPUTACIJA ZA ODGOVORE: koliko puta je autor teme prihvatio tvoj
   * odgovor kao rešenje. Odvojeno od `karma` (glasovi) da se ne meša "lajkovi"
   * sa "korisno rešeno". Kolona u bazi: `users.solved_answers` (NULL = 0).
   */
  solvedAnswers?: number;
  mutedUntil?: string | null;
  status: 'online' | 'away' | 'offline';
  /** #4 — preset cover-a profila (`violet` je podrazumevani). */
  coverPreset?: string | null;
  /**
   * F-06 — verzija sesije. Svako povećanje poništava sve ranije izdate JWT-ove
   * (odjava, „odjavi sve uređaje“, promena/reset lozinke, brisanje naloga).
   */
  tokenVersion?: number;
  /** F-21 — dokaz prihvatanja uslova: verzija teksta, vreme i IP adresa. */
  termsVersion?: string;
  termsAcceptedAt?: string;
  termsAcceptedIp?: string | null;
  /** F-33 — TOTP (enkriptovana tajna, bcrypt hash-evi recovery kodova). */
  totpSecret?: string | null;
  totpEnabledAt?: string | null;
  totpRecoveryCodes?: string[];
  totpFailedAttempts?: number;
  totpLockedUntil?: string | null;
  totpLastUsedStep?: number | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface ArticleRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImage: string;
  authorId: string;
  author: string;
  category: string;
  tags: string[];
  /** 2.10.0 — 'scheduled': objava čeka `publishedAt` (zakazani trenutak). */
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  isFeatured: boolean;
  views: number;
  reviewScorecard?: {
    score?: number; // npr. 9.5 ili 88
    verdict?: string;
    pros?: string[];
    cons?: string[];
  } | null;
  reactions: Record<string, number>; // { like, gg, hype, fire, mind_blown }
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 2.13.0 — izvor vesti (uvežene iz RSS-a). `sourceUrl` je UNIQUE u bazi, pa
   * je dedupe po njemu trajan; `newsSource` je ime izvora (Polygon, Kotaku…).
   */
  sourceUrl?: string | null;
  newsSource?: string | null;
  /** 2.13.0 — ista vrednost za više vesti o istom događaju (vremenska linija). */
  eventId?: string | null;
  /** 2.13.0 — naslov grupe događaja („Xbox otpuštanja“); prazno = nema grupe. */
  eventTitle?: string | null;
  /** 2.13.0 — „zašto je bitno“ (kratka rečenica uz naslov, iz ključnih reči). */
  whyItMatters?: string | null;
}

export interface ThreadRecord {
  id: string;
  subforum: string;
  title: string;
  content: string;
  author: string;
  authorId: string;
  tags: string[];
  isPinned: boolean;
  isLocked: boolean;
  isSpoiler: boolean;
  isEdited?: boolean;
  isDeleted?: boolean;
  karma: number;
  views: number;
  replies: number;
  /** F-3 — deal iz kojeg je tema otvorena („Diskutuj o ovom popustu“). */
  dealId?: string | null;
  /**
   * 2.11.0 — „prihvaćen odgovor“ (accepted answer). Postavlja ga SAMO autor teme.
   * `null`/`undefined` = tema još nema rešenje.
   */
  acceptedReplyId?: string | null;
  createdAt: string;
  lastReplyAt: string;
}

export interface ReplyRecord {
  id: string;
  threadId: string;
  parentId: string | null;
  author: string;
  authorId: string;
  content: string;
  karma: number;
  isSpoiler: boolean;
  isEdited?: boolean;
  isDeleted?: boolean;
  createdAt: string;
}

export interface NewsletterRecord {
  id: string;
  email: string;
  /** `false` = pending (double opt-in): pretplata čeka potvrdu preko mejla. */
  isActive: boolean;
  subscribedAt: string;
  /** F-07 — dokaz saglasnosti: kada, odakle (IP) i sa kojeg UA je potvrđena. */
  confirmedAt?: string | null;
  confirmedIp?: string | null;
  confirmedUserAgent?: string | null;
  unsubscribedAt?: string | null;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  // F-10/F-2/F-4 — `warning`, `streak`, `price_alert` (isti union kao ugovor).
  type:
    | 'reply'
    | 'mention'
    | 'upvote'
    | 'badge_earned'
    | 'quest_completed'
    | 'system'
    | 'warning'
    | 'streak'
    | 'level_up'
    | 'price_alert'
    | 'guestbook'
    /** 2.11.0 — nova privatna poruka. */
    | 'dm'
    /** 2.12.0 — novi pratilac (follow). */
    | 'user_follow'
    /** 3.0.0 — verifikacioni bot (dobrodošlica, potvrda, podsetnik). */
    | 'verification'
    /** 3.0.0 — promena staff statusa (admin/moderator). */
    | 'staff';
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  actorId?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  targetType: 'thread' | 'reply' | 'article' | 'comment' | 'user' | 'deal';
  targetId: string;
  reporterId: string;
  reason: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}

export interface QuestRecord {
  id: string;
  code: string;
  title: string;
  description: string;
  xpReward: number;
  targetCount: number;
  progress: number;
  completed: boolean;
  completedAt?: string | null;
}
export interface BookmarkRecord {
  kind: 'article' | 'thread';
  targetId: string;
  createdAt: string;
}
export interface QuestAdvanceResult {
  code: string;
  progress: number;
  completed: boolean;
  /** Da li je kvest već bio završen pre ovog događaja. */
  alreadyCompleted: boolean;
}

// ==========
// Helper: generisanje ID-a i XP krive
// ===========
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * UUID v4 — za tabele čiji je `id` tipa `uuid` (npr. `notifications`).
 * Postgres odbija `ntf_…` sa `22P02` (invalid input syntax for type uuid), a
 * taj id je do 3.0.0 tiho gubio SVE notifikacije na Supabase adapteru.
 */
export const newId = () => crypto.randomUUID();

/** F-15 — rok „zapamti ovaj uređaj“ (30 dana, klizni: svaka prijava ga produži). */
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Koliko UKUPNO XP-a traži dati nivo (`xpForLevel(1) = 500` = prag za nivo 2).
 * Rastuća kriva — jedini izvor istine za pragove (`levelFromXp` je njen inverz).
 */
export const xpForLevel = (level: number): number => Math.round(500 * Math.pow(Math.max(1, level), 1.35));

/**
 * Granice jednog nivoa, u apsolutnim XP poenima.
 * `start` = XP na kome nivo počinje (nivo 1 počinje na 0), `end` = prag sledećeg.
 */
export function levelRange(level: number): { start: number; end: number; size: number } {
  const safe = Math.max(1, Math.floor(level));
  const start = safe === 1 ? 0 : xpForLevel(safe);
  const end = Math.max(start + 1, xpForLevel(safe + 1));
  return { start, end, size: end - start };
}

/**
 * Napredak unutar nivoa — ono što profil prikazuje u XP traci.
 * Traka mora da meri `into / needed`, a ne `xp / xpNeeded` (to je traka celog
 * naloga i na višim nivoima stoji zakucana na 100%).
 */
export function levelProgress(xp: number): {
  level: number;
  start: number;
  end: number;
  /** XP sakupljen unutar tekućeg nivoa. */
  into: number;
  /** Koliko XP-a tekući nivo traži ukupno. */
  needed: number;
  /** Koliko još treba do sledećeg nivoa. */
  remaining: number;
  /** 0–1. */
  ratio: number;
} {
  const safeXp = Math.max(0, Math.round(Number(xp) || 0));
  const level = levelFromXp(safeXp);
  const { start, end, size } = levelRange(level);
  const into = Math.max(0, Math.min(size, safeXp - start));
  return { level, start, end, into, needed: size, remaining: size - into, ratio: into / size };
}

/** Inverz od `xpForLevel` — najviši nivo čiji je prag dostignut. */
export const levelFromXp = (xp: number): number => {
  const safeXp = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= safeXp) level += 1;
  return level;
};

/** Gornja granica nivoa (kriva raste brže od bilo kog realnog XP-a). */
export const MAX_LEVEL = 200;

/**
 * Default kategorije — koriste se SAMO dok `forum_categories` nije popunjena
 * (u Supabase-u tabela je izvor istine; vidi SchemaForumRepo.listCategories).
 */
export const MEMORY_CATEGORIES: SubforumRecord[] = [
  { id: 'pc-gaming', slug: 'pc-gaming', name: 'PC Gaming', description: 'Diskusije o PC naslovima, optimizaciji i konfiguracijama.', icon: '🖥️' },
  { id: 'consoles', slug: 'consoles', name: 'Consoles', description: 'PlayStation, Xbox i Nintendo — vesti, ekskluzive i debate.', icon: '🎮' },
  { id: 'esports', slug: 'esports', name: 'Esports', description: 'Turniri, mečevi, timovi i meta analize.', icon: '🏆' },
  { id: 'hardware', slug: 'hardware', name: 'Hardware', description: 'Grafičke kartice, procesori, hlađenje i custom build-ovi.', icon: '⚙️' },
  { id: 'lfg', slug: 'lfg', name: 'LFG', description: 'Pronađi saigrače za co-op, multiplayer i rangirane mečeve.', icon: '👥' },
  { id: 'off-topic', slug: 'off-topic', name: 'Off-Topic', description: 'Slobodne teme, humor i opšte ćaskanje zajednice.', icon: '💬' },
];

// ==============================
// In-memory store (demo fallback)
// ==============================
class MemoryStore {
  users: UserRecord[] = [];
  guestbook: GuestbookEntryRecord[] = [];
  articles: ArticleRecord[] = [];
  threads: ThreadRecord[] = [];
  replies: ReplyRecord[] = [];
  newsletter: NewsletterRecord[] = [];
  votes: { userId: string; target: string; type: 'up' | 'down' }[] = [];
  bookmarks: { userId: string; target: string; kind: 'article' | 'thread' }[] = [];
  articleComments: ArticleCommentRecord[] = [];
  /** 2.11.0 — DM: razgovori i poruke. */
  dmConversations: DmConversationRecord[] = [];
  directMessages: DirectMessageRecord[] = [];
  /** F-12 — set `${userId}:${articleId}:${type}` kao UNIQUE constraint. */
  articleReactionKeys: Set<string> = new Set();
  notifications: NotificationRecord[] = [];
  reports: ReportRecord[] = [];
  questProgress: Map<string, { progress: number; completed: boolean; completedAt?: string }> = new Map();
  blocks: Map<string, Set<string>> = new Map();
  subscriptions: Map<string, Set<string>> = new Map();
  /** F-7.1 #8 — `${userId}:${threadId}` za praćenja koja traže i mejl na odgovor. */
  subscriptionEmail: Set<string> = new Set();
  /** F-15 — 2FA trusted uređaji (hash tokena; plain nikad). */
  trustedDevices: Array<{
    id: string;
    userId: string;
    deviceId: string;
    tokenHash: string;
    userAgent: string | null;
    createdAt: string;
    expiresAt: string;
    lastUsedAt: string | null;
  }> = [];
  bans: Map<string, BanRecord> = new Map();
  /** `userId:platform` → poslednji povezani handle (istorija posle odvajanja). */
  connectionHistory: Map<string, string> = new Map();
  /** F-32 — refresh sesije (u memoriji: hash tokena → red). */
  sessions: Array<RefreshSessionRecord & { tokenHash: string }> = [];
  /** F-34 — OAuth identiteti (provider + provider_user_id → nalog). */
  oauth: OAuthIdentityRecord[] = [];
  /** 2.6.0 — deals / popusti (Game katalog + deals + glasovi). */
  games: GameRecord[] = [];
  deals: DealRecord[] = [];
  dealVotes: { dealId: string; userId: string; type: 'up' | 'down' }[] = [];
  /** F-9 — „Kupio sam“ (UNIQUE deal+user). */
  dealClaims: { dealId: string; userId: string; createdAt: string }[] = [];
  /** F-4 — praćenje igre radi obaveštenja o ceni. */
  dealWatches: WatchRecord[] = [];
  /** 2.8.0 — community vodiči + glasovi. */
  guides: GuideRecord[] = [];
  guideVotes: { guideId: string; userId: string; type: 'up' | 'down' }[] = [];
  /** 2.12.0 — praćenje korisnika: `${followerId}:${followingId}` → created_at. */
  follows: Map<string, string> = new Map();
}

// =====================
// Supabase adapter
// ===================
export interface DataLayer {
  kind: 'supabase' | 'memory';
  /** F-2 — klijent za `user_daily_activity` (streak i dnevni kvest). */
  client?: any;
  users: UserRepo;
  articles: ArticleRepo;
  forum: ForumRepo;
  newsletter: NewsletterRepo;
  notifications: NotificationRepo;
  reports: ReportRepo;
  quests: QuestRepo;
  bookmarks: BookmarkRepo;
  blocks: BlockRepo;
  subscriptions: SubscriptionRepo;
  bans: BanRepo;
  /** F-10 — upozorenja pre bana (`user_warnings`). */
  warnings: WarningRepo;
  /** F-32 — HttpOnly refresh sesije (rotacija). */
  sessions: RefreshSessionRepo;
  /** F-34 — OAuth identiteti (Discord/Google/Steam). */
  oauth: OAuthRepo;
  /** 2.6.0 — igre i popusti („Gde je najjeftiniji…"). */
  games: GameRepo;
  deals: DealRepo;
  /** F-4 — praćenje cene igre (`deal_watches`). */
  watches: WatchRepo;
  /** F-15 — trusted uređaji za 2FA (`trusted_devices`). */
  trustedDevices: TrustedDeviceRepo;
  /** 2.8.0 — community vodiči (Game Page sekcija „Vodiči“). */
  guides: GuideRepo;
  /** F-7b — dnevna statistika pregleda (admin analitika). */
  dailyViews: DailyViewsRepo;
  /** #5 — GG guestbook (komentari na profilu). */
  guestbook: GuestbookRepo;
  /** 2.11.0 — privatne poruke (razgovor je par korisnika). */
  dm: DmRepo;
  /** 2.12.0 — praćenje korisnika (`user_follows`). */
  follows: FollowRepo;
}

/** #5 — GG poruka na profilu (jedna po paru profil+autor). */
export interface GuestbookEntryRecord {
  id: string;
  profileUserId: string;
  authorUserId: string;
  author: string;
  authorAvatar?: string;
  message: string;
  createdAt: string;
}

export interface GuestbookRepo {
  list(profileUserId: string, limit?: number): Promise<GuestbookEntryRecord[]>;
  /** GDPR — sve GG poruke koje je korisnik ostavio na tuđim profilima. */
  listByAuthor(authorUserId: string): Promise<GuestbookEntryRecord[]>;
  /** GDPR — briše sve poruke koje je korisnik ostavio (vlasnik profila ostaje). */
  removeAllByAuthor(authorUserId: string): Promise<number>;
  upsert(entry: GuestbookEntryRecord): Promise<GuestbookEntryRecord>;
  remove(profileUserId: string, authorUserId: string): Promise<boolean>;
}

/** F-7b — dnevni zbirovi pregleda (tabela `daily_views`, migracija 25). */
export interface DailyViewsRepo {
  /** Zbir pregleda po danu za period [from, to]; datum je 'YYYY-MM-DD'. */
  sumByDay(from: string, to: string): Promise<Record<string, number>>;
  /** Top entiteti po pregledima u periodu, sa tipom i ID-jem. */
  topEntities(
    from: string,
    to: string,
    limit: number,
  ): Promise<{ entityType: 'article' | 'thread'; entityId: string; views: number }[]>;
}
export interface DailyViewEntityRef {
  entityType: 'article' | 'thread';
  entityId: string;
  views: number;
}

export interface TrustedDeviceRecord {
  id: string;
  deviceId: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** F-15 — jedan red = jedan uređaj; `tokenHash` se nikad ne vraća klijentu. */
export interface TrustedDeviceRepo {
  /** Proveri hash + da nije istekao; uspeh osveži `last_used_at` i `expires_at`. */
  isTrusted(userId: string, deviceId: string, tokenHash: string, userAgent?: string | null): Promise<boolean>;
  /** Upsert po (user, device): nov hash i novi rok (30 dana). */
  save(input: {
    userId: string;
    deviceId: string;
    tokenHash: string;
    userAgent?: string | null;
    expiresAt: string;
  }): Promise<void>;
  list(userId: string): Promise<TrustedDeviceRecord[]>;
  deleteByUser(userId: string): Promise<number>;
  deleteOne(userId: string, deviceId: string): Promise<boolean>;
}

export interface GameRepo {
  findById(id: string): Promise<GameRecord | null>;
  findBySlug(slug: string): Promise<GameRecord | null>;
  /** Pretraga po naslovu (najviše `limit` rezultata). */
  search(query: string, limit?: number): Promise<GameRecord[]>;
  /** Upsert po `slug` (ili `igdb_id`) — vraća postojeću igru ako postoji. */
  upsert(game: Omit<GameRecord, 'id' | 'createdAt'> & { id?: string }): Promise<GameRecord>;
  /** Broj aktivnih deal-ova po igri (za liste igara). */
  listWithDeals(limit?: number): Promise<Array<GameRecord & { activeDeals: number }>>;
  /** 2.6.2 — ručna postavka cover-a (upload u Supabase Storage), staff only. */
  setCover(id: string, coverUrl: string): Promise<GameRecord | null>;
}

export interface DealRepo {
  /** Lista sa filterima i sortiranjem; `total` je broj pre paginacije. */
  list(filter: DealFilter, viewerId?: string): Promise<{ deals: DealRecord[]; total: number }>;
  findById(id: string, viewerId?: string): Promise<DealRecord | null>;
  create(deal: DealRecord): Promise<DealRecord>;
  update(id: string, patch: Partial<DealRecord>): Promise<DealRecord | null>;
  /** Soft-delete: `status = 'removed'` (zadržava glasove i istoriju). */
  remove(id: string): Promise<boolean>;
  /** Atomilan glas (UNIQUE deal+user): upsert zamena ili uklanjanje po `null`. */
  vote(userId: string, dealId: string, type: DealVote): Promise<DealStatusResult>;
  /** Označi istekle deal-ove koji još stoje kao `active`. */
  expireOverdue(now?: string): Promise<number>;
  /** Broj aktivnih deal-ova (metrike). */
  countActive(): Promise<number>;
  /** F-9 — „Kupio sam“: idempotentno označavanje (drugi klik ne broji duplo). */
  claim(userId: string, dealId: string): Promise<{ claimed: boolean; count: number }>;
  unclaim(userId: string, dealId: string): Promise<{ claimed: boolean; count: number }>;
  /** F-9 — broj „Kupio sam“ po deal-u (jedan upit za listu). */
  claimCounts(dealIds: string[]): Promise<Map<string, number>>;
}

export interface GuideRepo {
  /** Lista objavljenih vodiča po igri (top = score, newest = datum). */
  listByGame(
    gameId: string,
    options: { category?: string; sort?: 'top' | 'newest'; limit?: number; offset?: number },
  ): Promise<{ guides: GuideRecord[]; total: number }>;
  findBySlug(slug: string): Promise<GuideRecord | null>;
  findById(id: string): Promise<GuideRecord | null>;
  /** Globalno unikatan slug — dodaje sufiks ako već postoji. */
  slugExists(slug: string): Promise<boolean>;
  create(guide: GuideRecord): Promise<GuideRecord>;
  incrementViews(id: string): Promise<void>;
  /** Atomičan glas (RPC u Supabase-u; čisto računanje u memoriji). */
  vote(
    userId: string,
    guideId: string,
    type: 'up' | 'down' | null,
  ): Promise<{ changed: boolean; delta: number; score: number; myVote: 'up' | 'down' | null }>;
  /** Glas trenutnog korisnika (za detalj vodiča). */
  myVote(userId: string | undefined, guideId: string): Promise<'up' | 'down' | null>;
}

export interface UserRepo {
  findAll(): Promise<UserRecord[]>;
  /** F-18 — COUNT bez učitavanja svih korisnika. */
  count(filter?: { excludeBanned?: boolean }): Promise<number>;
  /**
   * F-31 — kada je bedž dodeljen (izvor istine: `user_badges.awarded_at`).
   * Profilna aktivnost prikazuje stvarni datum umesto fiksnog `'2026-01-01'`.
   */
  listBadgeAwards(userId: string): Promise<Array<{ code: string; awardedAt: string | null }>>;
  /** F-31 — kada je gaming nalog povezan (`connected_accounts.created_at`). */
  listConnectedAccountDates(userId: string): Promise<Array<{ platform: string; connectedAt: string | null }>>;
  /** Broj korisnika sa rolom (moderatori + admin) — COUNT u SQL-u. */
  countStaff(): Promise<number>;
  /** F-18 — rang-lista sortirana i ograničena u SQL-u (materijalizovani keš po potrebi). */
  leaderboard(options: { sort: 'karma' | 'level'; limit: number }): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  /** B-11 — batch `users.id IN (…)` za liste autora (bez N+1 upita). */
  findByIds(ids: string[]): Promise<UserRecord[]>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<UserRecord>;
  update(id: string, patch: Partial<UserRecord>): Promise<UserRecord | null>;
  /**
   * Admin korekcija XP-a mimo dnevnog limita (i negativna). Nivo se izvodi iz
   * novog XP-a. Sa bazom ide kroz RPC `bump_user_xp` (atomično).
   */
  bumpXp(id: string, amount: number): Promise<UserRecord | null>;
  remove(id: string): Promise<boolean>;
  /** Podržava li šema opcione kolone (badges, connected_accounts) — schema 2.4.1. */
  supportsOptionalColumns(): Promise<boolean>;
  /** Izvor istine: `user_badges` tabela (kodovi bedževa). */
  addBadge(userId: string, code: string): Promise<void>;
  /** Izvor istine: `connected_accounts` tabela. */
  setConnectedAccount(userId: string, platform: string, platformUsername: string): Promise<void>;
  /**
   * Otkači nalog BEZ gubitka istorije (soft revoke: `revoked_at`).
   * Istorija je osnov za pravilo „XP samo jednom po nalogu“.
   */
  revokeConnectedAccount(userId: string, platform: string): Promise<void>;
  /** Da li je nalog ikada bio povezan (uključujući otkačene). */
  hasConnectedAccountHistory(userId: string, platform: string, platformUsername: string): Promise<boolean>;
  /** Atomični inkrement karme (`apply_user_karma` RPC). true = primenjeno. */
  applyKarma(userId: string, delta: number): Promise<boolean>;
  /** F-06 — poništi sve sesije: `token_version = token_version + 1` (atomično). */
  bumpSessionVersion(userId: string): Promise<number>;
}

export interface ArticleRepo {  findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string; publishedBefore?: string }): Promise<ArticleRecord[]>;
  findById(id: string): Promise<ArticleRecord | null>;
  findBySlug(slug: string): Promise<ArticleRecord | null>;
  create(article: ArticleRecord): Promise<ArticleRecord>;
  update(id: string, patch: Partial<ArticleRecord>): Promise<ArticleRecord | null>;
  remove(id: string): Promise<boolean>;
  /** 2.13.0 — vesti istog događaja (grupa `eventId`), najnovija prva. */
  findByEvent?(eventId: string, limit?: number): Promise<ArticleRecord[]>;
  /** Pregledi — atomični inkrement (SQL UPDATE ... + 1). */
  incrementViews(id: string): Promise<void>;
  /** Direktan upit po autoru — bez skeniranja svih članaka. */
  findByAuthor(authorId: string, limit?: number): Promise<ArticleRecord[]>;
  /** F-7b — batch dohvat za admin analitiku (IN upit). */
  findByIds(ids: string[]): Promise<ArticleRecord[]>;
  /**
   * 2.10.0 — atomsko objavljivanje dospeitih zakazanih članaka.
   * Vraća listu članaka koji su U TOM POZIVU prešli `scheduled` → `published`
   * (id + naslov za log, datum objave = zakazani trenutak).
   */
  publishDue(now?: Date): Promise<ArticleRecord[]>;
  /** F-18 — COUNT bez učitavanja redova (admin metrike). */
  count(filter?: { status?: string }): Promise<number>;
  /** F-18 — SUM pregleda u SQL-u (RPC `sum_article_views`). */
  sumViews(): Promise<number>;
  /**
   * F-12 — jedna reakcija po korisniku i tipu (UNIQUE article_id+user_id+type).
   * Vraća `created=false` ako ista reakcija već postoji (nema naduvavanja brojača).
   */
  addReaction(articleId: string, userId: string, type: string): Promise<{ created: boolean; reactions: Record<string, number> }>;
  /** F-08 — komentari članka iz baze (ne iz memorije procesa). */
  listComments(articleId: string): Promise<ArticleCommentRecord[]>;
  createComment(comment: ArticleCommentRecord): Promise<ArticleCommentRecord>;
  listAllComments(limit?: number): Promise<ArticleCommentRecord[]>;
  deleteComment(id: string): Promise<boolean>;
  /**
   * GDPR — svi komentari jednog korisnika (uključujući obrisane), da brisanje
   * naloga ne ostavi `user_id` iza sebe.
   */
  listCommentsByUser(userId: string): Promise<ArticleCommentRecord[]>;
  /** GDPR — anonimizacija komentara autora (`user_id` NULL, autor bez ličnih podataka). */
  anonymizeCommentsByUser(userId: string): Promise<number>;
}

export interface ArticleCommentRecord {
  id: string;
  articleId: string;
  userId: string;
  author: string;
  authorAvatar?: string;
  /** Autor je potvrdio email (verifikaciona značaka kod imena). */
  authorVerified?: boolean;
  content: string;
  parentId: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ForumRepo {
  /**
   * F-18 — paginacija i sortiranje u SQL-u (`limit`, keyset cursor, count).
   * Bez `paged` načina lista se i dalje vraća u celini (unutar-dokumentovano
   * za admin/seed pozive), ali ruta `GET /:subforum/threads` koristi `paged`.
   */
  listThreads(filter?: {
    subforum?: string;
    sort?: 'hot' | 'new' | 'top';
    search?: string;
    limit?: number;
    /** Offset keyset-a: broj redova pre prve strane (`cursor` je poslednji ID). */
    offset?: number;
    cursorId?: string;
    countOnly?: boolean;
  }): Promise<ThreadRecord[]>;
  /** Broj tema za filter — COUNT u SQL-u, bez učitavanja redova. */
  countThreads(filter?: { subforum?: string; search?: string; authorId?: string }): Promise<number>;
  /** B-10 — offset jednog reda za keyset kursor (`LIMIT 1 … ORDER BY <isti sort>`). */
  threadCursorOffset(filter: { subforum?: string; sort?: 'hot' | 'new' | 'top'; search?: string }, cursorId: string): Promise<number | null>;
  /** F-18 — SUM pregleda u SQL-u (RPC `sum_thread_views`). */
  sumViews(): Promise<number>;
  findThread(id: string): Promise<ThreadRecord | null>;
  /** F-7b — batch dohvat tema za admin analitiku (IN upit). */
  findThreadsByIds(ids: string[]): Promise<ThreadRecord[]>;
  createThread(thread: ThreadRecord): Promise<ThreadRecord>;
  updateThread(id: string, patch: Partial<ThreadRecord>): Promise<ThreadRecord | null>;
  removeThread(id: string): Promise<boolean>;
  listReplies(threadId: string): Promise<ReplyRecord[]>;
  createReply(reply: ReplyRecord): Promise<ReplyRecord>;
  removeReply(id: string): Promise<boolean>;
  /** Izmena/soft-delete odgovora (sopstvena akcija ili moderacija). */
  updateReply(id: string, patch: Partial<ReplyRecord>): Promise<ReplyRecord | null>;
  vote(userId: string, target: string, type: 'up' | 'down' | null): Promise<{ karma: number }>;
  /** Kategorije/subforumi iz baze — jedini izvor istine. */
  listCategories(): Promise<SubforumRecord[]>;
  /** Postoji li (i aktivan) subforum sa ovim slug-om. */
  categoryExists(slug: string): Promise<boolean>;
  /** Admin — kreiraj/izmeni subforum (upsert po slug-u). */
  upsertCategory(category: SubforumRecord): Promise<SubforumRecord>;
  /** Admin — soft-delete subforuma (is_active=false). */
  deleteCategory(slug: string): Promise<boolean>;
  /** Teme jednog autora (bez skeniranja svih tema). */
  listThreadsByAuthor(authorId: string, username: string, limit?: number): Promise<ThreadRecord[]>;
  /** Odgovori jednog autora (bez skeniranja svih tema). */
  listRepliesByAuthor(authorId: string, username: string, limit?: number): Promise<ReplyRecord[]>;
  /** GDPR — svi odgovori jednog korisnika (uključujući obrisane), bez limita. */
  listAllRepliesByAuthor(authorId: string): Promise<ReplyRecord[]>;
  /** Pregledi — atomični inkrement (SQL), ne read-modify-write. */
  incrementViews(id: string): Promise<void>;
  /** Zanemari/potvrdi glas za autora (kašnjenje karme) */
  findReply(id: string): Promise<ReplyRecord | null>;
}

export interface SubforumRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color?: string;
  threads?: number;
  posts?: number;
}

export interface NewsletterRepo {
  /**
   * F-07 — upisuje/obnavlja PRETPLATU U STANJU ČEKANJA (`is_active=false`).
   * Nikad ne aktivira pretplatu: aktivacija ide isključivo kroz `confirm`.
   */
  subscribe(email: string): Promise<NewsletterRecord>;
  /** Aktivira pretplatu i beleži dokaz saglasnosti (vreme, IP, UA). */
  confirm(email: string, proof?: { ip?: string | null; userAgent?: string | null }): Promise<boolean>;
  unsubscribe(email: string): Promise<boolean>;
  findAll(): Promise<NewsletterRecord[]>;
  /** F-18 — COUNT aktivnih pretplatnika bez učitavanja redova. */
  countActive(): Promise<number>;
}

export interface NotificationRepo {
  list(filter: { userId: string; unreadOnly?: boolean; limit?: number; offset?: number }): Promise<NotificationRecord[]>;
  countUnread(userId: string): Promise<number>;
  create(notification: NotificationRecord): Promise<NotificationRecord>;
  findById(id: string): Promise<NotificationRecord | null>;
  markAsRead(userId: string, ids: string[]): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  delete(id: string): Promise<boolean>;
  /** GDPR — brisanje naloga uklanja sve notifikacije (nose `userId` i sadržaj). */
  deleteAllForUser(userId: string): Promise<number>;
}

export interface ReportRepo {
  create(report: ReportRecord): Promise<ReportRecord>;
  list(filter: { status?: string; limit?: number; offset?: number }): Promise<ReportRecord[]>;
  count(status?: string): Promise<number>;
  findById(id: string): Promise<ReportRecord | null>;
  findByReporter(reporterId: string, targetType: string, targetId: string): Promise<ReportRecord[]>;
  update(id: string, patch: Partial<ReportRecord>): Promise<ReportRecord | null>;
}

export interface QuestRepo {
  /** Kvestovi korisnika s progresom (spaja `quests` i `user_quests`). */
  listForUser(userId: string): Promise<QuestRecord[]>;
  /** Jedan atomični korak napretka; `null` ako kvest ne postoji. */
  advance(userId: string, code: string, amount?: number): Promise<QuestAdvanceResult | null>;
}

export interface BookmarkRepo {
  add(userId: string, kind: 'article' | 'thread', targetId: string): Promise<void>;
  remove(userId: string, kind: 'article' | 'thread', targetId: string): Promise<void>;
  list(userId: string, kind?: 'article' | 'thread'): Promise<BookmarkRecord[]>;
  isBookmarked(userId: string, kind: 'article' | 'thread', targetId: string): Promise<boolean>;
  /** GDPR — brisanje naloga uklanja listu sačuvanog. */
  removeAllForUser(userId: string): Promise<number>;
}

// =====================
// PRIVATNE PORUKE (DM) — 2.11.0
// =====================

/** Razgovor je PAR korisnika (`userLow < userHigh` po UUID), pa nema duplikata. */
export interface DmConversationRecord {
  id: string;
  userLow: string;
  userHigh: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface DirectMessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  /** `null` dok je primalac ne pročita. */
  readAt: string | null;
  createdAt: string;
}

/** Prikaz razgovora u listi (sa sagovornikom i brojem nepročitanih). */
export interface DmConversationView {
  id: string;
  partnerId: string;
  partnerUsername: string;
  partnerAvatar: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
}

export interface DmRepo {
  /**
   * Pronađi razgovor dva korisnika ili ga napravi. Redosled argumenata nije
   * bitan — repo sređuje par i time garantuje jedinstven razgovor po paru.
   */
  findOrCreateConversation(userA: string, userB: string): Promise<DmConversationRecord>;
  findConversation(id: string): Promise<DmConversationRecord | null>;
  /** Razgovori korisnika, najskoriji prvi, sa partnerom i brojem nepročitanih. */
  listConversations(userId: string): Promise<DmConversationView[]>;
  /** Poruke razgovora, najstarija prva; `before` za paginaciju unazad. */
  listMessages(conversationId: string, opts?: { limit?: number; before?: string }): Promise<DirectMessageRecord[]>;
  createMessage(input: { conversationId: string; senderId: string; content: string }): Promise<DirectMessageRecord>;
  /** Označi poruke koje je POSLAO sagovornik kao pročitane; vraća broj. */
  markRead(conversationId: string, readerId: string): Promise<number>;
  /** Ukupan broj nepročitanih (zvonce / bedž). */
  countUnread(userId: string): Promise<number>;
  /** Da li je korisnik član razgovora (za autorizaciju u rutama). */
  isParticipant(conversationId: string, userId: string): Promise<boolean>;
  /** GDPR — brisanje naloga uklanja sve poruke i razgovore. */
  deleteAllForUser(userId: string): Promise<number>;
}

/**
 * 2.12.0 — praćenje korisnika (`user_follows`).
 * Jedan vez follower→following; par je unikatan (idempotentno „zaprati“).
 */
export interface FollowRepo {
  /** Idempotentno zaprati; vraća `true` samo kad je vez NOV (za notifikaciju). */
  follow(followerId: string, followingId: string): Promise<boolean>;
  unfollow(followerId: string, followingId: string): Promise<void>;
  isFollowing(followerId: string, followingId: string): Promise<boolean>;
  /** ID-jevi korisnika koje `followerId` prati. */
  followingIds(followerId: string): Promise<string[]>;
  /** ID-jevi pratilaca korisnika `userId` („ko te prati“). */
  followerIds(userId: string): Promise<string[]>;
  /** Brojači za profil: { followers, following }. */
  counts(userId: string): Promise<{ followers: number; following: number }>;
  /** GDPR — brišu se vezovi u OBA smera (korisnik kao pratilac i kao praćen). */
  deleteAllForUser(userId: string): Promise<number>;
}

export interface BlockRepo {
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  list(blockerId: string): Promise<string[]>;
  /** ID-jevi koje je korisnik blokirao — za filtriranje sadržaja. */
  blockedIds(blockerId: string): Promise<Set<string>>;
}

export interface SubscriptionRepo {
  /** `emailOnReply` uključuje i mejl na novi odgovor (F-7.1 #8), ne samo in-app notifikaciju. */
  follow(userId: string, threadId: string, emailOnReply?: boolean): Promise<void>;
  unfollow(userId: string, threadId: string): Promise<void>;
  listThreadIds(userId: string): Promise<string[]>;
  isFollowing(userId: string, threadId: string): Promise<boolean>;
  /** Da li je pratioc uključio mejl; `false` i kada ne prati temu. */
  isEmailOnReply(userId: string, threadId: string): Promise<boolean>;
  /** Uključi/isključi mejl za postojeće praćenje (bez novog `follow`). */
  setEmailOnReply(userId: string, threadId: string, enabled: boolean): Promise<boolean>;
  /** ID-jevi korisnika koji prate temu — za notifikacije o novim odgovorima. */
  followers(threadId: string): Promise<string[]>;
  /** ID-jevi pratilaca koji su tražili i mejl (thread_subscriptions.email_on_reply). */
  emailFollowers(threadId: string): Promise<string[]>;
}

export interface BanRecord {
  userId: string;
  reason: string;
  expiresAt: string | null;
  bannedBy?: string | null;
  createdAt: string;
}

export interface BanRepo {
  ban(record: BanRecord): Promise<void>;
  lift(userId: string): Promise<void>;
  findActive(userId: string): Promise<BanRecord | null>;
  /** Uklanja istekle banove i vraća ID-jeve korisnika koje treba odbanovati. */
  expireOverdue(): Promise<string[]>;
}

// =====================
// Memory implementacije
// =====================
class MemoryUserRepo implements UserRepo {
  constructor(private store: MemoryStore) {}
  async findAll() { return [...this.store.users]; }
  async findById(id: string) { return this.store.users.find((u) => u.id === id) ?? null; }
  async findByIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.store.users.filter((u) => wanted.has(u.id));
  }
  async findByUsername(username: string) {
    return this.store.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }
  async findByEmail(email: string) {
    return this.store.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /** F-18 — COUNT bez učitavanja svih korisnika. */
  async count(filter?: { excludeBanned?: boolean }) {
    return this.store.users.filter((u) => !filter?.excludeBanned || !u.isBanned).length;
  }

  async countStaff() {
    return this.store.users.filter((u) => u.role === 'moderator' || u.role === 'admin').length;
  }

  /** F-31 — memory store ne čuva vreme dodele bedža; vraća prazno umesto izmišljenog datuma. */
  async listBadgeAwards() {
    return [];
  }

  async listConnectedAccountDates(userId: string) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return [];
    return Object.keys(user.connectedAccounts ?? {}).map((platform) => ({ platform, connectedAt: null }));
  }

  async leaderboard(options: { sort: 'karma' | 'level'; limit: number }) {
    const compare =
      options.sort === 'level'
        ? (a: UserRecord, b: UserRecord) => b.level - a.level || b.xp - a.xp || b.karma - a.karma
        : (a: UserRecord, b: UserRecord) => b.karma - a.karma || b.level - a.level || b.xp - a.xp;
    return this.store.users
      .filter((u) => !u.isBanned)
      .sort(compare)
      .slice(0, options.limit);
  }
  async create(user: UserRecord) { this.store.users.push(user); return user; }
  async update(id: string, patch: Partial<UserRecord>) {
    const idx = this.store.users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    // Isto pravilo kao u SQL adapteru: nivo prati XP, ne obrnuto.
    const next = { ...this.store.users[idx], ...patch, id };
    const derived = levelProgress(next.xp);
    this.store.users[idx] = { ...next, level: derived.level, xpNeeded: derived.end };
    return this.store.users[idx];
  }

  async bumpXp(id: string, amount: number) {
    const user = this.store.users.find((u) => u.id === id);
    if (!user) return null;
    return this.update(id, { xp: Math.max(0, user.xp + Math.round(amount)) });
  }
  async remove(id: string) {
    const before = this.store.users.length;
    this.store.users = this.store.users.filter((u) => u.id !== id);
    return this.store.users.length < before;
  }
  async supportsOptionalColumns() {
    return true;
  }
  async addBadge(userId: string, code: string) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return;
    // FIX: `badges` može nedostajati (npr. stari seed/ručni upis) — bez ovoga `includes` puca.
    user.badges = Array.isArray(user.badges) ? user.badges : [];
    if (!user.badges.includes(code)) user.badges = [...user.badges, code];
  }
  async setConnectedAccount(userId: string, platform: string, platformUsername: string) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return;
    user.connectedAccounts = { ...user.connectedAccounts, [platform]: platformUsername };
  }
  async revokeConnectedAccount(userId: string, platform: string) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return;
    // Istorija ostaje ("userId:platform" -> handle) — vidi `hasConnectedAccountHistory`.
    const handle = user.connectedAccounts?.[platform];
    if (handle) this.store.connectionHistory.set(`${userId}:${platform}`, handle);
    const next = { ...user.connectedAccounts };
    delete next[platform];
    user.connectedAccounts = next;
  }
  async hasConnectedAccountHistory(userId: string, platform: string, platformUsername: string) {
    const past = this.store.connectionHistory.get(`${userId}:${platform}`);
    return past !== undefined && past === platformUsername;
  }
  async applyKarma(userId: string, delta: number) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return false;
    user.karma = (user.karma ?? 0) + delta;
    return true;
  }
  async bumpSessionVersion(userId: string) {
    const user = this.store.users.find((u) => u.id === userId);
    if (!user) return 0;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    return user.tokenVersion;
  }
}

class MemoryArticleRepo implements ArticleRepo {
  constructor(private store: MemoryStore) {}
  async findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string; publishedBefore?: string }) {
    let list = [...this.store.articles];
    if (filter?.category) list = list.filter((a) => a.category === filter.category);
    if (filter?.status) list = list.filter((a) => a.status === filter.status);
    if (filter?.featured !== undefined) list = list.filter((a) => a.isFeatured === filter.featured);
    // 2.10.0 — double-check: izbaci članke sa datumom objave u budućnosti.
    if (filter?.publishedBefore) list = list.filter((a) => !a.publishedAt || a.publishedAt <= filter.publishedBefore!);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (a) => a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list.sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  }
  async findById(id: string) { return this.store.articles.find((a) => a.id === id) ?? null; }
  async findBySlug(slug: string) { return this.store.articles.find((a) => a.slug === slug) ?? null; }

  /**
   * 2.10.0 — atomsko aktiviranje dospeitih zakazanih članaka.
   * Filtrira se i mutira U ISTOM prolazu (nema prozora između čitanja i upisa),
   * a `publishedAt` ostaje zakazani trenutak — datum objave je tačan.
   */
  async publishDue(now: Date = new Date()) {
    const due = this.store.articles.filter(
      (a) => a.status === 'scheduled' && !!a.publishedAt && a.publishedAt <= now.toISOString(),
    );
    for (const article of due) article.status = 'published';
    return due;
  }
  async create(article: ArticleRecord) { this.store.articles.push(article); return article; }
  async update(id: string, patch: Partial<ArticleRecord>) {
    const idx = this.store.articles.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    this.store.articles[idx] = { ...this.store.articles[idx], ...patch, id, updatedAt: new Date().toISOString() };
    return this.store.articles[idx];
  }
  async remove(id: string) {
    const before = this.store.articles.length;
    this.store.articles = this.store.articles.filter((a) => a.id !== id);
    this.store.articleComments = this.store.articleComments.filter((c) => c.articleId !== id);
    return this.store.articles.length < before;
  }
  async incrementViews(id: string) {
    const article = this.store.articles.find((item) => item.id === id);
    if (article) article.views += 1;
  }
  async findByAuthor(authorId: string, limit = 50) {
    return this.store.articles
      .filter((article) => article.authorId === authorId)
      .slice(0, limit);
  }

  async addReaction(articleId: string, userId: string, type: string) {
    const article = this.store.articles.find((a) => a.id === articleId);
    const reactions = { ...(article?.reactions ?? {}) };
    if (!article) return { created: false, reactions };

    const key = `${userId}:${articleId}:${type}`;
    const created = !this.store.articleReactionKeys.has(key);
    if (created) {
      this.store.articleReactionKeys.add(key);
      reactions[type] = (reactions[type] || 0) + 1;
      article.reactions = reactions;
    }
    return { created, reactions };
  }

  async listComments(articleId: string) {
    return this.store.articleComments
      .filter((c) => c.articleId === articleId && !c.isDeleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createComment(comment: ArticleCommentRecord) {
    this.store.articleComments.push(comment);
    return comment;
  }

  async listAllComments(limit = 100) {
    return this.store.articleComments
      .filter((c) => !c.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async deleteComment(id: string) {
    const comment = this.store.articleComments.find((c) => c.id === id);
    if (!comment) return false;
    comment.isDeleted = true;
    return true;
  }

  /** GDPR — uključuje i soft-obrisane (they takođe nose `userId`). */
  async listCommentsByUser(userId: string) {
    return this.store.articleComments.filter((c) => c.userId === userId);
  }

  async anonymizeCommentsByUser(userId: string) {
    const mine = this.store.articleComments.filter((c) => c.userId === userId);
    for (const comment of mine) {
      comment.userId = '';
      comment.author = 'obrisani-nalog';
      comment.authorAvatar = undefined;
      comment.authorVerified = false;
      comment.isDeleted = true;
    }
    return mine.length;
  }

  async count(filter?: { status?: string }) {
    return this.store.articles.filter((a) => !filter?.status || a.status === filter.status).length;
  }

  /** F-18 — SUM pregleda (memory: u memoriji, jer nema SQL agregacije). */
  async sumViews() {
    return this.store.articles.reduce((sum, a) => sum + (a.views || 0), 0);
  }

  async findByIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.store.articles.filter((a) => wanted.has(a.id));
  }
}

class MemoryForumRepo implements ForumRepo {
  constructor(private store: MemoryStore) {}
  async countThreads(filter?: { subforum?: string; search?: string; authorId?: string }) {
    return this.store.threads.filter((t) => {
      if (t.isDeleted) return false;
      if (filter?.subforum && t.subforum !== filter.subforum) return false;
      if (filter?.authorId && t.authorId !== filter.authorId) return false;
      if (filter?.search) {
        const q = filter.search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.content.toLowerCase().includes(q)) return false;
      }
      return true;
    }).length;
  }

  async sumViews() {
    return this.store.threads.reduce((sum, t) => sum + (t.views || 0), 0);
  }
  /** B-10 — indeks kursora u ISTOM sortu koji koristi strana (bez učitavanja 200 redova). */
  async threadCursorOffset(filter: { subforum?: string; sort?: 'hot' | 'new' | 'top'; search?: string; unsolved?: boolean }, cursorId: string) {
    const list = this.sortedThreads(filter);
    const index = list.findIndex((t) => t.id === cursorId);
    return index < 0 ? null : index + 1;
  }
  async listThreads(filter?: {
    subforum?: string;
    sort?: 'hot' | 'new' | 'top';
    search?: string;
    unsolved?: boolean;
    limit?: number;
    offset?: number;
    cursorId?: string;
    countOnly?: boolean;
  }) {
    const list = this.sortedThreads(filter);
    // B-10 — poštuj limit/offset kao Supabase adapter (ranije je memorija vraćala sve).
    if (filter?.offset || filter?.limit) {
      const start = filter?.offset ?? 0;
      return list.slice(start, start + (filter?.limit ?? 100));
    }
    return list;
  }
  /** Zajednički sort za listu i za kursor (isti redosled = ispravan offset). */
  private sortedThreads(filter?: { subforum?: string; sort?: 'hot' | 'new' | 'top'; search?: string; unsolved?: boolean }) {
    // Soft-deleted teme se ne prikazuju u listama (isto kao Supabase adapter).
    let list = this.store.threads.filter((t) => !t.isDeleted);
    if (filter?.subforum) list = list.filter((t) => t.subforum === filter.subforum);
    // 6.x — „Nerešeno“: teme bez prihvaćenog odgovora.
    if (filter?.unsolved) list = list.filter((t) => !t.acceptedReplyId);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q));
    }
    const sort = filter?.sort ?? 'hot';
    if (sort === 'new') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    else if (sort === 'top') list.sort((a, b) => b.karma - a.karma || b.id.localeCompare(a.id));
    else list.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.karma - a.karma || b.id.localeCompare(a.id));
    return list;
  }
  async findThread(id: string) { return this.store.threads.find((t) => t.id === id) ?? null; }
  async findThreadsByIds(ids: string[]) {
    const wanted = new Set(ids);
    return this.store.threads.filter((t) => wanted.has(t.id));
  }
  async createThread(thread: ThreadRecord) { this.store.threads.push(thread); return thread; }
  async updateThread(id: string, patch: Partial<ThreadRecord>) {
    const idx = this.store.threads.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.store.threads[idx] = { ...this.store.threads[idx], ...patch, id };
    return this.store.threads[idx];
  }
  async removeThread(id: string) {
    const before = this.store.threads.length;
    this.store.threads = this.store.threads.filter((t) => t.id !== id);
    this.store.replies = this.store.replies.filter((r) => r.threadId !== id);
    return this.store.threads.length < before;
  }
  async listReplies(threadId: string) {
    // F-13 — soft-deleted odgovori se ne vraćaju korisnicima (isto kao Supabase adapter).
    return this.store.replies
      .filter((r) => r.threadId === threadId && !r.isDeleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** Test pomoćnik: dohvati temu kao `findThread` (isti ugovor kao Supabase adapter). */
  async getThread(id: string) {
    return this.findThread(id);
  }
  async createReply(reply: ReplyRecord) {
    this.store.replies.push(reply);
    const thread = this.store.threads.find((t) => t.id === reply.threadId);
    if (thread) {
      thread.replies += 1;
      thread.lastReplyAt = reply.createdAt;
    }
    return reply;
  }
  async removeReply(id: string) {
    const before = this.store.replies.length;
    this.store.replies = this.store.replies.filter((r) => r.id !== id);
    return this.store.replies.length < before;
  }
  async updateReply(id: string, patch: Partial<ReplyRecord>) {
    const idx = this.store.replies.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.store.replies[idx] = { ...this.store.replies[idx], ...patch, id };
    return this.store.replies[idx];
  }
  async vote(userId: string, target: string, type: 'up' | 'down' | null) {
    const existing = this.store.votes.find((v) => v.userId === userId && v.target === target);
    const thread = this.store.threads.find((t) => t.id === target);
    const reply = this.store.replies.find((r) => r.id === target);

    // Ukloni stari glas
    if (existing) {
      const delta = existing.type === 'up' ? -1 : 1;
      if (thread) thread.karma += delta;
      if (reply) reply.karma += delta;
      this.store.votes = this.store.votes.filter((v) => !(v.userId === userId && v.target === target));
    }

    if (type) {
      this.store.votes.push({ userId, target, type });
      const delta = type === 'up' ? 1 : -1;
      if (thread) thread.karma += delta;
      if (reply) reply.karma += delta;
    }

    return { karma: thread ? thread.karma : reply ? reply.karma : 0 };
  }

  async listCategories() {
    const base = this.store.threads;
    return MEMORY_CATEGORIES.map((category) => {
      const items = base.filter((thread) => thread.subforum === category.slug);
      const replies = items.reduce((sum, thread) => sum + (thread.replies || 0), 0);
      return { ...category, threads: items.length, posts: items.length + replies };
    });
  }
  async categoryExists(slug: string) {
    return MEMORY_CATEGORIES.some((category) => category.slug === slug);
  }
  async upsertCategory(category: SubforumRecord) {
    const existing = MEMORY_CATEGORIES.find((c) => c.slug === category.slug);
    if (existing) {
      Object.assign(existing, { ...category, id: category.slug });
      return existing;
    }
    const created = { ...category, id: category.slug };
    MEMORY_CATEGORIES.push(created);
    return created;
  }
  async deleteCategory(slug: string) {
    const index = MEMORY_CATEGORIES.findIndex((c) => c.slug === slug);
    if (index === -1) return false;
    MEMORY_CATEGORIES.splice(index, 1);
    return true;
  }
  async listThreadsByAuthor(authorId: string, username: string, limit = 100) {
    return this.store.threads
      .filter((thread) => !thread.isDeleted)
      .filter((thread) => thread.authorId === authorId || thread.author.toLowerCase() === username.toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async listRepliesByAuthor(authorId: string, username: string, limit = 100) {
    return this.store.replies
      .filter((reply) => reply.authorId === authorId || reply.author.toLowerCase() === username.toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  /** GDPR — bez limita i BEZ filtera `isDeleted`: soft-obrisan red još nosi autorа. */
  async listAllRepliesByAuthor(authorId: string) {
    return this.store.replies.filter((reply) => reply.authorId === authorId);
  }
  async incrementViews(id: string) {
    const thread = this.store.threads.find((item) => item.id === id);
    if (thread) thread.views += 1;
  }
  async findReply(id: string) {
    return this.store.replies.find((reply) => reply.id === id) ?? null;
  }
}

class MemoryNewsletterRepo implements NewsletterRepo {
  constructor(private store: MemoryStore) {}
  async subscribe(email: string) {
    const existing = this.store.newsletter.find((n) => n.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      // F-07 — ponovni zahtev NE aktivira pretplatu i NE poništava postojeću saglasnost.
      if (existing.confirmedAt) return existing;
      existing.subscribedAt = new Date().toISOString();
      existing.isActive = false;
      return existing;
    }
    const record: NewsletterRecord = { id: uid('nl'), email, isActive: false, subscribedAt: new Date().toISOString() };
    this.store.newsletter.push(record);
    return record;
  }
  async confirm(email: string, proof?: { ip?: string | null; userAgent?: string | null }) {
    const record = this.store.newsletter.find((n) => n.email.toLowerCase() === email.toLowerCase());
    if (!record) return false;
    record.isActive = true;
    record.confirmedAt = new Date().toISOString();
    record.confirmedIp = proof?.ip ?? null;
    record.confirmedUserAgent = proof?.userAgent ?? null;
    record.unsubscribedAt = null;
    return true;
  }
  async unsubscribe(email: string) {
    const record = this.store.newsletter.find((n) => n.email.toLowerCase() === email.toLowerCase());
    if (!record) return false;
    record.isActive = false;
    record.unsubscribedAt = new Date().toISOString();
    return true;
  }
  async findAll() { return [...this.store.newsletter]; }
  async countActive() { return this.store.newsletter.filter((n) => n.isActive).length; }
}

// =====================
// 2.6.0 — DEALS (in-memory implementacije)
// =====================

class MemoryGameRepo implements GameRepo {
  constructor(private store: MemoryStore) {}
  async findById(id: string) {
    return this.store.games.find((game) => game.id === id) ?? null;
  }
  async findBySlug(slug: string) {
    return this.store.games.find((game) => game.slug === slug) ?? null;
  }
  async search(query: string, limit = 10) {
    const q = String(query ?? '').trim().toLowerCase();
    return this.store.games
      .filter((game) => !q || game.title.toLowerCase().includes(q) || game.slug.includes(normalizeSlug(q)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, limit);
  }
  async upsert(game: Omit<GameRecord, 'id' | 'createdAt'> & { id?: string }) {
    const existing = this.store.games.find(
      (item) => item.slug === game.slug || (game.igdbId != null && item.igdbId === game.igdbId),
    );
    if (existing) {
      // Popuni samo prazna polja — ručni unos korisnika ne sme da bude prepisan.
      existing.coverUrl = existing.coverUrl ?? game.coverUrl;
      existing.releaseDate = existing.releaseDate ?? game.releaseDate;
      existing.igdbId = existing.igdbId ?? game.igdbId;
      return existing;
    }
    const record: GameRecord = {
      id: game.id ?? uid('game'),
      slug: game.slug,
      title: game.title,
      coverUrl: game.coverUrl ?? null,
      releaseDate: game.releaseDate ?? null,
      igdbId: game.igdbId ?? null,
      createdAt: new Date().toISOString(),
    };
    this.store.games.push(record);
    return record;
  }
  async setCover(id: string, coverUrl: string) {
    const game = this.store.games.find((item) => item.id === id);
    if (!game) return null;
    game.coverUrl = coverUrl;
    return game;
  }
  async listWithDeals(limit = 50) {
    const now = Date.now();
    return this.store.games
      .map((game) => ({
        ...game,
        activeDeals: this.store.deals.filter(
          (deal) => deal.gameId === game.id && deal.status === 'active' && !isExpired(deal, now),
        ).length,
      }))
      .filter((game) => game.activeDeals > 0)
      .sort((a, b) => b.activeDeals - a.activeDeals || a.title.localeCompare(b.title))
      .slice(0, limit);
  }
}

/** 2.8.0 — community vodiči (in-memory; isti ugovor kao Supabase implementacija). */
class MemoryGuideRepo implements GuideRepo {
  constructor(private store: MemoryStore) {}

  async listByGame(
    gameId: string,
    options: { category?: string; sort?: 'top' | 'newest'; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(options.limit ?? 24, 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const filtered = this.store.guides.filter(
      (guide) =>
        guide.gameId === gameId &&
        guide.status === 'published' &&
        (!options.category || guide.category === options.category),
    );
    const sorted = [...filtered].sort((a, b) =>
      options.sort === 'newest'
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        : b.score - a.score || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return { guides: sorted.slice(offset, offset + limit), total: filtered.length };
  }
  async findBySlug(slug: string) {
    return this.store.guides.find((guide) => guide.slug === slug) ?? null;
  }
  async findById(id: string) {
    return this.store.guides.find((guide) => guide.id === id) ?? null;
  }
  async slugExists(slug: string) {
    return this.store.guides.some((guide) => guide.slug === slug);
  }
  async create(guide: GuideRecord) {
    this.store.guides.push(guide);
    return guide;
  }
  async incrementViews(id: string) {
    const guide = this.store.guides.find((item) => item.id === id);
    if (guide) guide.viewsCount += 1;
  }
  async vote(
    userId: string,
    guideId: string,
    type: 'up' | 'down' | null,
  ) {
    const guide = this.store.guides.find((item) => item.id === guideId);
    if (!guide) return { changed: false, delta: 0, score: 0, myVote: null };
    const existingIndex = this.store.guideVotes.findIndex(
      (item) => item.userId === userId && item.guideId === guideId,
    );
    let delta = 0;
    if (existingIndex >= 0) {
      const existing = this.store.guideVotes[existingIndex];
      delta -= existing.type === 'up' ? 1 : -1;
      this.store.guideVotes.splice(existingIndex, 1);
    }
    if (type) {
      this.store.guideVotes.push({ guideId, userId, type });
      delta += type === 'up' ? 1 : -1;
    }
    if (delta !== 0) guide.score += delta;
    return { changed: delta !== 0, delta, score: guide.score, myVote: type };
  }
  async myVote(userId: string | undefined, guideId: string) {
    if (!userId) return null;
    return (
      this.store.guideVotes.find((item) => item.userId === userId && item.guideId === guideId)?.type ?? null
    );
  }
}

/** F-7b — in-memory demo nema istoriju pregleda: analitika degradira gracefulno
 *  (prazna serija → frontend prikazuje „Nema dovoljno podataka“). */
class MemoryDailyViewsRepo implements DailyViewsRepo {
  async sumByDay(): Promise<Record<string, number>> {
    return {};
  }
  async topEntities(): Promise<DailyViewEntityRef[]> {
    return [];
  }
}

/** #5 — GG guestbook (memorija; u Supabase-u tabele `profile_guestbook`). */
class MemoryGuestbookRepo implements GuestbookRepo {
  constructor(private store: MemoryStore) {}

  async list(profileUserId: string, limit = 50): Promise<GuestbookEntryRecord[]> {
    return this.store.guestbook
      .filter((entry) => entry.profileUserId === profileUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async upsert(entry: GuestbookEntryRecord): Promise<GuestbookEntryRecord> {
    const index = this.store.guestbook.findIndex(
      (item) => item.profileUserId === entry.profileUserId && item.authorUserId === entry.authorUserId,
    );
    if (index !== -1) {
      this.store.guestbook[index] = { ...entry, id: this.store.guestbook[index].id, createdAt: this.store.guestbook[index].createdAt };
      return this.store.guestbook[index];
    }
    this.store.guestbook.push(entry);
    return entry;
  }

  async remove(profileUserId: string, authorUserId: string): Promise<boolean> {
    const index = this.store.guestbook.findIndex(
      (item) => item.profileUserId === profileUserId && item.authorUserId === authorUserId,
    );
    if (index === -1) return false;
    this.store.guestbook.splice(index, 1);
    return true;
  }

  /** GDPR — poruke koje je korisnik ostavio na tuđim profilima. */
  async listByAuthor(authorUserId: string): Promise<GuestbookEntryRecord[]> {
    return this.store.guestbook.filter((item) => item.authorUserId === authorUserId);
  }

  async removeAllByAuthor(authorUserId: string): Promise<number> {
    const before = this.store.guestbook.length;
    this.store.guestbook = this.store.guestbook.filter((item) => item.authorUserId !== authorUserId);
    return before - this.store.guestbook.length;
  }
}

// =====================
// DM — memory implementacija (2.11.0)
// =====================
class MemoryDmRepo implements DmRepo {
  constructor(private store: MemoryStore) {}

  /** Kanonski par: `userLow` je uvek leksikografski manji ID (radi i za UUID i za `usr_…`). */
  private pair(a: string, b: string): [string, string] {
    return a <= b ? [a, b] : [b, a];
  }

  async findOrCreateConversation(userA: string, userB: string) {
    const [userLow, userHigh] = this.pair(userA, userB);
    const existing = this.store.dmConversations.find(
      (c) => c.userLow === userLow && c.userHigh === userHigh,
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const created: DmConversationRecord = {
      id: `dmc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userLow,
      userHigh,
      lastMessageAt: null,
      createdAt: now,
    };
    this.store.dmConversations.push(created);
    return created;
  }

  async findConversation(id: string) {
    return this.store.dmConversations.find((c) => c.id === id) ?? null;
  }

  async listConversations(userId: string): Promise<DmConversationView[]> {
    const mine = this.store.dmConversations.filter(
      (c) => c.userLow === userId || c.userHigh === userId,
    );

    return mine
      .map((conversation) => {
        const partnerId = conversation.userLow === userId ? conversation.userHigh : conversation.userLow;
        const partner = this.store.users.find((u) => u.id === partnerId);
        const messages = this.store.directMessages
          .filter((m) => m.conversationId === conversation.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = messages[messages.length - 1] ?? null;
        return {
          id: conversation.id,
          partnerId,
          partnerUsername: partner?.username ?? '',
          partnerAvatar: partner?.avatar ?? '',
          lastMessage: last?.content ?? null,
          lastMessageAt: last?.createdAt ?? conversation.lastMessageAt,
          lastMessageFromMe: last ? last.senderId === userId : false,
          unreadCount: messages.filter((m) => m.senderId !== userId && m.readAt === null).length,
        };
      })
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  async listMessages(conversationId: string, opts: { limit?: number; before?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    // Najnovije prvo (za `before` paginaciju), pa se vraća hronološki.
    const sorted = this.store.directMessages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((m) => !opts.before || m.createdAt < opts.before)
      .slice(0, limit)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return sorted;
  }

  async createMessage(input: { conversationId: string; senderId: string; content: string }) {
    const created: DirectMessageRecord = {
      id: `dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId: input.conversationId,
      senderId: input.senderId,
      content: input.content,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    this.store.directMessages.push(created);
    const conversation = this.store.dmConversations.find((c) => c.id === input.conversationId);
    if (conversation) conversation.lastMessageAt = created.createdAt;
    return created;
  }

  async markRead(conversationId: string, readerId: string) {
    const now = new Date().toISOString();
    let changed = 0;
    for (const message of this.store.directMessages) {
      if (message.conversationId === conversationId && message.senderId !== readerId && message.readAt === null) {
        message.readAt = now;
        changed += 1;
      }
    }
    return changed;
  }

  async countUnread(userId: string) {
    const ids = new Set(
      this.store.dmConversations
        .filter((c) => c.userLow === userId || c.userHigh === userId)
        .map((c) => c.id),
    );
    return this.store.directMessages.filter(
      (m) => ids.has(m.conversationId) && m.senderId !== userId && m.readAt === null,
    ).length;
  }

  async isParticipant(conversationId: string, userId: string) {
    const conversation = await this.findConversation(conversationId);
    return Boolean(conversation && (conversation.userLow === userId || conversation.userHigh === userId));
  }

  async deleteAllForUser(userId: string) {
    const ids = this.store.dmConversations
      .filter((c) => c.userLow === userId || c.userHigh === userId)
      .map((c) => c.id);
    const before = this.store.directMessages.length;
    this.store.directMessages = this.store.directMessages.filter((m) => !ids.includes(m.conversationId));
    this.store.dmConversations = this.store.dmConversations.filter(
      (c) => c.userLow !== userId && c.userHigh !== userId,
    );
    return before - this.store.directMessages.length;
  }
}

class MemoryFollowRepo implements FollowRepo {
  constructor(private store: MemoryStore) {}

  async follow(followerId: string, followingId: string): Promise<boolean> {
    if (followerId === followingId) return false;
    const key = `${followerId}:${followingId}`;
    if (this.store.follows.has(key)) return false;
    this.store.follows.set(key, new Date().toISOString());
    return true;
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    this.store.follows.delete(`${followerId}:${followingId}`);
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return this.store.follows.has(`${followerId}:${followingId}`);
  }

  async followingIds(followerId: string): Promise<string[]> {
    return [...this.store.follows.keys()]
      .filter((key) => key.startsWith(`${followerId}:`))
      .map((key) => key.slice(followerId.length + 1));
  }

  async followerIds(userId: string): Promise<string[]> {
    return [...this.store.follows.keys()]
      .filter((key) => key.endsWith(`:${userId}`))
      .map((key) => key.slice(0, key.length - userId.length - 1));
  }

  async counts(userId: string): Promise<{ followers: number; following: number }> {
    let followers = 0;
    let following = 0;
    for (const key of this.store.follows.keys()) {
      if (key.startsWith(`${userId}:`)) following += 1;
      if (key.endsWith(`:${userId}`)) followers += 1;
    }
    return { followers, following };
  }

  async deleteAllForUser(userId: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.store.follows.keys()]) {
      if (key.startsWith(`${userId}:`) || key.endsWith(`:${userId}`)) {
        this.store.follows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryDealRepo implements DealRepo {
  constructor(private store: MemoryStore) {}

  private withViewer(deal: DealRecord, viewerId?: string): DealRecord {
    const vote = viewerId
      ? this.store.dealVotes.find((item) => item.userId === viewerId && item.dealId === deal.id)?.type ?? null
      : undefined;
    // Relacije kao u Supabase adapteru: igra se čita po `gameId`, pa deal nikad
    // ne ostane bez linka ka Game Page (ranije `create` nije popunio slug/naslov).
    const game = deal.gameId ? this.store.games.find((item) => item.id === deal.gameId) : null;
    return {
      ...deal,
      gameSlug: game?.slug ?? deal.gameSlug ?? null,
      gameTitle: game?.title ?? deal.gameTitle ?? null,
      gameCover: game?.coverUrl ?? deal.gameCover ?? null,
      myVote: vote,
      claimCount: this.store.dealClaims.filter((claim) => claim.dealId === deal.id).length,
      myClaim: viewerId
        ? this.store.dealClaims.some((claim) => claim.dealId === deal.id && claim.userId === viewerId)
        : undefined,
    };
  }

  async list(filter: DealFilter, viewerId?: string) {
    const all = filterDeals(this.store.deals, filter);
    const sorted = [...all].sort((a, b) => compareDeals(a, b, filter.sort ?? 'newest'));
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return {
      deals: sorted.slice(offset, offset + limit).map((deal) => this.withViewer(deal, viewerId)),
      total: all.length,
    };
  }

  async findById(id: string, viewerId?: string) {
    const deal = this.store.deals.find((item) => item.id === id);
    return deal ? this.withViewer(deal, viewerId) : null;
  }

  async create(deal: DealRecord) {
    this.store.deals.push({ ...deal });
    return this.withViewer({ ...deal }, deal.authorId);
  }

  async update(id: string, patch: Partial<DealRecord>) {
    const index = this.store.deals.findIndex((deal) => deal.id === id);
    if (index === -1) return null;
    const merged: DealRecord = { ...this.store.deals[index], ...patch, id, updatedAt: new Date().toISOString() };
    // Ista pravila kao generated kolona u bazi: popust se ne prima od klijenta.
    merged.discountPct = computeDiscountPct(merged.price, merged.originalPrice);
    this.store.deals[index] = merged;
    return this.withViewer(merged);
  }

  async remove(id: string) {
    const deal = this.store.deals.find((item) => item.id === id);
    if (!deal) return false;
    deal.status = 'removed';
    deal.updatedAt = new Date().toISOString();
    return true;
  }

  async vote(userId: string, dealId: string, type: DealVote): Promise<DealStatusResult> {
    const deal = this.store.deals.find((item) => item.id === dealId);
    if (!deal) return { changed: false, delta: 0, score: 0 };

    const existing = this.store.dealVotes.find((item) => item.userId === userId && item.dealId === dealId);
    let delta = 0;
    if (existing) {
      delta -= existing.type === 'up' ? 1 : -1;
      this.store.dealVotes = this.store.dealVotes.filter(
        (item) => !(item.userId === userId && item.dealId === dealId),
      );
    }
    if (type) {
      this.store.dealVotes.push({ dealId, userId, type });
      delta += type === 'up' ? 1 : -1;
    }
    if (delta !== 0) deal.score = (deal.score ?? 0) + delta;
    return { changed: delta !== 0, delta, score: deal.score ?? 0 };
  }

  async expireOverdue(now = new Date().toISOString()) {
    let count = 0;
    for (const deal of this.store.deals) {
      if (deal.status === 'active' && deal.expiresAt && new Date(deal.expiresAt).getTime() <= new Date(now).getTime()) {
        deal.status = 'expired';
        count += 1;
      }
    }
    return count;
  }

  async countActive() {
    const now = Date.now();
    return this.store.deals.filter((deal) => deal.status === 'active' && !isExpired(deal, now)).length;
  }

  async claim(userId: string, dealId: string) {
    const exists = this.store.dealClaims.some((claim) => claim.dealId === dealId && claim.userId === userId);
    if (!exists) this.store.dealClaims.push({ dealId, userId, createdAt: new Date().toISOString() });
    return { claimed: true, count: this.store.dealClaims.filter((claim) => claim.dealId === dealId).length };
  }

  async unclaim(userId: string, dealId: string) {
    this.store.dealClaims = this.store.dealClaims.filter(
      (claim) => !(claim.dealId === dealId && claim.userId === userId),
    );
    return { claimed: false, count: this.store.dealClaims.filter((claim) => claim.dealId === dealId).length };
  }

  async claimCounts(dealIds: string[]) {
    const wanted = new Set(dealIds);
    const counts = new Map<string, number>();
    for (const claim of this.store.dealClaims) {
      if (wanted.has(claim.dealId)) counts.set(claim.dealId, (counts.get(claim.dealId) ?? 0) + 1);
    }
    return counts;
  }
}

/** F-4 — „prati igru / obavesti kada cena padne ispod praga“. */
export interface WatchRecord {
  id: string;
  userId: string;
  gameId: string | null;
  gameTitle: string;
  gameSlug: string | null;
  /** Obaveštenje ide kada cena padne ispod ovog iznosa (`currency`). */
  targetPrice: number;
  currency: string;
  createdAt: string;
  /** Kada je mejl poslednji put poslat (throttling). */
  notifiedAt: string | null;
}

export interface WatchRepo {
  list(userId: string): Promise<WatchRecord[]>;
  findByGame(userId: string, gameId: string): Promise<WatchRecord | null>;
  findById(id: string): Promise<WatchRecord | null>;
  create(watch: WatchRecord): Promise<WatchRecord>;
  update(id: string, patch: Partial<WatchRecord>): Promise<WatchRecord | null>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Svi koji prate ovu igru (za obaveštenje o novom deal-u). */
  listByGame(gameId: string): Promise<WatchRecord[]>;
}

class MemoryWatchRepo implements WatchRepo {
  constructor(private store: MemoryStore) {}
  async list(userId: string) {
    return this.store.dealWatches.filter((watch) => watch.userId === userId);
  }
  async findByGame(userId: string, gameId: string) {
    return this.store.dealWatches.find((watch) => watch.userId === userId && watch.gameId === gameId) ?? null;
  }
  async findById(id: string) {
    return this.store.dealWatches.find((watch) => watch.id === id) ?? null;
  }
  async create(watch: WatchRecord) {
    this.store.dealWatches.push(watch);
    return watch;
  }
  async update(id: string, patch: Partial<WatchRecord>) {
    const index = this.store.dealWatches.findIndex((watch) => watch.id === id);
    if (index === -1) return null;
    this.store.dealWatches[index] = { ...this.store.dealWatches[index], ...patch, id };
    return this.store.dealWatches[index];
  }
  async remove(userId: string, id: string) {
    const before = this.store.dealWatches.length;
    this.store.dealWatches = this.store.dealWatches.filter((watch) => !(watch.id === id && watch.userId === userId));
    return this.store.dealWatches.length < before;
  }
  async listByGame(gameId: string) {
    return this.store.dealWatches.filter((watch) => watch.gameId === gameId);
  }
}

/** F-15 — trusted uređaji u memoriji (`NODE_ENV=test` / demo). */
class MemoryTrustedDeviceRepo implements TrustedDeviceRepo {
  constructor(private store: MemoryStore) {}
  async isTrusted(userId: string, deviceId: string, tokenHash: string, userAgent?: string | null) {
    const now = Date.now();
    const row = this.store.trustedDevices.find((device) => device.userId === userId && device.deviceId === deviceId);
    if (!row || row.tokenHash !== tokenHash || new Date(row.expiresAt).getTime() <= now) return false;
    row.lastUsedAt = new Date().toISOString();
    row.expiresAt = new Date(now + TRUSTED_DEVICE_TTL_MS).toISOString();
    if (userAgent) row.userAgent = userAgent.slice(0, 300);
    return true;
  }
  async save(input: { userId: string; deviceId: string; tokenHash: string; userAgent?: string | null; expiresAt: string }) {
    const existing = this.store.trustedDevices.find(
      (device) => device.userId === input.userId && device.deviceId === input.deviceId,
    );
    if (existing) {
      existing.tokenHash = input.tokenHash;
      existing.userAgent = input.userAgent?.slice(0, 300) ?? null;
      existing.expiresAt = input.expiresAt;
      return;
    }
    this.store.trustedDevices.push({
      id: uid('trd'),
      userId: input.userId,
      deviceId: input.deviceId,
      tokenHash: input.tokenHash,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      lastUsedAt: null,
    });
  }
  async list(userId: string) {
    const now = Date.now();
    return this.store.trustedDevices
      .filter((device) => device.userId === userId && new Date(device.expiresAt).getTime() > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((device) => ({
        id: device.id,
        deviceId: device.deviceId,
        userAgent: device.userAgent,
        createdAt: device.createdAt,
        expiresAt: device.expiresAt,
        lastUsedAt: device.lastUsedAt,
      }));
  }
  async deleteByUser(userId: string) {
    const before = this.store.trustedDevices.length;
    this.store.trustedDevices = this.store.trustedDevices.filter((device) => device.userId !== userId);
    return before - this.store.trustedDevices.length;
  }
  async deleteOne(userId: string, deviceId: string) {
    const before = this.store.trustedDevices.length;
    this.store.trustedDevices = this.store.trustedDevices.filter(
      (device) => !(device.userId === userId && device.deviceId === deviceId),
    );
    return before - this.store.trustedDevices.length > 0;
  }
}

// =====================
// Supabase implementacije
// =====================
class SupabaseUserRepo implements UserRepo {
  constructor(private db: SupabaseClient) {}

  /**
   * `select('*')` sa nepostojećom kolonom pada; zato se uvek proverava šema.
   * Keširano — jedan upit po procesu.
   */
  private userColumns: string | null = null;
  private async selectColumns(): Promise<string> {
    if (this.userColumns) return this.userColumns;
    if (await this.supportsOptionalColumns()) {
      this.userColumns = '*, badges, connected_accounts';
    } else {
      this.userColumns = '*';
    }
    return this.userColumns;
  }

  async supportsOptionalColumns(): Promise<boolean> {
    const { error } = await this.db.from('users').select('badges, connected_accounts').limit(1);
    return !error;
  }

  /** PostgREST javi `column ... does not exist` → resetuj keš i pokušaj bez njih. */
  private async runSelect(query: (columns: string) => PromiseLike<{ data: any; error: any }>) {
    const first = await query(await this.selectColumns());
    if (first.error && /column .* does not exist/i.test(first.error.message)) {
      this.userColumns = '*';
      return query('*');
    }
    return first;
  }

  private map(row: any): UserRecord {
    // Fallback za kolone koje schema.sql nema (dok se ne pusti `server/schema-ALL.sql`).
    // Čita se sveže stanje, jer se u istom procesu upisuje posle prvog mape.
    const extras = getExtras(row.id, true);
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password: row.password_hash,
      avatar: row.avatar_url ?? '',
      bio: row.bio ?? '',
      role: row.role ?? 'member',
      // Nivo je izvedena vrednost (`levelFromXp`) — kolona ostaje samo kao
      // brz prikaz; stale `level` posle ručnog XP-a se time sam ispravi.
      level: levelFromXp(row.xp ?? 0),
      xp: row.xp ?? 0,
      xpNeeded: levelRange(levelFromXp(row.xp ?? 0)).end,
      karma: row.karma ?? 0,
      badges: Array.isArray(row.badges) ? row.badges : extras.badges ?? [],
      connectedAccounts: row.connected_accounts ?? extras.connectedAccounts ?? {},
      isVerified: row.is_verified ?? false,
      isBanned: row.is_banned ?? false,
      // 6.x — reputacija za prihvaćene odgovore (undefined pre migracije = 0).
      solvedAnswers: typeof row.solved_answers === 'number' ? row.solved_answers : 0,
      status: row.status ?? 'offline',
      tokenVersion: typeof row.token_version === 'number' ? row.token_version : 0,
      termsVersion: row.terms_version ?? undefined,
      termsAcceptedAt: row.terms_accepted_at ?? undefined,
      termsAcceptedIp: row.terms_accepted_ip ?? null,
      // F-33 — TOTP kolone postoje od `server/schema-ALL.sql` (undefined pre migracije).
      totpSecret: row.totp_secret ?? null,
      totpEnabledAt: row.totp_enabled_at ?? null,
      totpRecoveryCodes: Array.isArray(row.totp_recovery_codes) ? row.totp_recovery_codes : [],
      totpFailedAttempts: typeof row.totp_failed_attempts === 'number' ? row.totp_failed_attempts : 0,
      totpLockedUntil: row.totp_locked_until ?? null,
      totpLastUsedStep: typeof row.totp_last_used_step === 'number' ? row.totp_last_used_step : null,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at ?? row.created_at,
    };
  }
  /** Mapira red i spoji stanje iz normalizovanih tabela (`user_badges`, `connected_accounts`). */
  private async hydrate(row: any): Promise<UserRecord> {
    const user = this.map(row);
    try {
      const [badges, accounts] = await Promise.all([
        this.loadBadges(user.id),
        this.loadConnectedAccounts(user.id),
      ]);
      // Tabela je izvor istine kada vrati redove; keš kolona je fallback.
      if (badges && badges.length) user.badges = [...new Set([...(user.badges ?? []), ...badges])];
      if (accounts && Object.keys(accounts).length) {
        user.connectedAccounts = { ...(user.connectedAccounts ?? {}), ...accounts };
      }
    } catch (error) {
      // Tabele još ne postoje (pre 2.4.4) — keš u `users` je dovoljan.
      logger.debug({ err: error }, 'user_hydrate_fallback');
    }
    return user;
  }
  async findAll() {
    const { data, error } = await this.runSelect((columns) => this.db.from('users').select(columns));
    if (error) throw error;
    return Promise.all((data ?? []).map((r: any) => this.hydrate(r)));
  }

  /** F-18 — COUNT u SQL-u (head: true ne prenosi redove). */
  async count(filter?: { excludeBanned?: boolean }): Promise<number> {
    let q = this.db.from('users').select('id', { count: 'exact', head: true });
    if (filter?.excludeBanned) q = q.eq('is_banned', false);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  /** F-18 — moderatori + admini u jednom COUNT upitu. */
  async countStaff(): Promise<number> {
    const { count, error } = await this.db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .in('role', ['moderator', 'admin']);
    if (error) throw error;
    return count ?? 0;
  }

  /** F-18 — sortiranje i limit u SQL-u (ranije: ceo skup u memoriji pa slice). */
  async leaderboard(options: { sort: 'karma' | 'level'; limit: number }) {
    const base = () => this.db.from('users').select('*').eq('is_banned', false);
    const q =
      options.sort === 'level'
        ? base().order('level', { ascending: false }).order('xp', { ascending: false }).order('karma', { ascending: false })
        : base().order('karma', { ascending: false }).order('level', { ascending: false }).order('xp', { ascending: false });
    const { data, error } = await q.limit(options.limit);
    if (error) throw error;
    return Promise.all((data ?? []).map((row: any) => this.hydrate(row)));
  }

  async findById(id: string) {
    const { data } = await this.runSelect((columns) =>
      this.db.from('users').select(columns).eq('id', id).maybeSingle(),
    );
    return data ? this.hydrate(data) : null;
  }
  /** B-11 — jedan upit za više autora; UUID-ovi koji nisu UUID se preskaču. */
  async findByIds(ids: string[]) {
    const uuids = [...new Set(ids)].filter((id) => asUuid(id));
    if (!uuids.length) return [];
    const { data, error } = await this.runSelect((columns) =>
      this.db.from('users').select(columns).in('id', uuids),
    );
    if (error) throw error;
    return (data ?? []).map((row: any) => this.hydrate(row));
  }
  async findByUsername(username: string) {
    const value = username.trim();
    // Primarno tačno poređenje; `username_lower` (ako postoji) je brži i otporan
    // na wildcarde iz `_` i `%` (#21). Fallback radi pre migracije.
    const exact = await this.runSelect((columns) =>
      this.db.from('users').select(columns).eq('username', value).maybeSingle(),
    );
    if (!exact.error && exact.data) return this.hydrate(exact.data);

    const lower = await this.runSelect((columns) =>
      this.db.from('users').select(columns).eq('username_lower', value.toLowerCase()).maybeSingle(),
    );
    if (!lower.error && lower.data) return this.hydrate(lower.data);

    // Legacy redovi sa različitim velikim/malim slovima — bez wildcardsa
    const { data } = await this.runSelect((columns) =>
      this.db.from('users').select(columns).ilike('username', escapeLike(value)).limit(1).maybeSingle(),
    );
    return data ? this.hydrate(data) : null;
  }
  async findByEmail(email: string) {
    const value = email.trim();
    const exact = await this.runSelect((columns) =>
      this.db.from('users').select(columns).eq('email', value).maybeSingle(),
    );
    if (!exact.error && exact.data) return this.hydrate(exact.data);

    const lower = await this.runSelect((columns) =>
      this.db.from('users').select(columns).eq('email_lower', value.toLowerCase()).maybeSingle(),
    );
    if (!lower.error && lower.data) return this.hydrate(lower.data);

    // ILIKE sa escapovanim wildcardima: `a_c` više ne pogađa `abc`
    const { data } = await this.runSelect((columns) =>
      this.db.from('users').select(columns).ilike('email', escapeLike(value)).limit(1).maybeSingle(),
    );
    return data ? this.hydrate(data) : null;
  }
  async create(user: UserRecord) {
    const { data, error } = await this.db
      .from('users')
      .insert({
        username: user.username,
        email: user.email,
        password_hash: user.password,
        avatar_url: user.avatar,
        role: user.role,
        // Nivo se NE upisuje ručno — izvodi se iz `xp` (vidi `levelProgress`).
        xp: user.xp,
        karma: user.karma,
        status: user.status,
        is_verified: user.isVerified,
      })
      .select('*')
      .single();
    if (error) throw error;
    return this.map(data);
  }

  /**
   * Ručna korekcija XP-a (admin) — ATOMIČNA i IZVAN dnevnog limita.
   *
   * `awardXp()` ide kroz `spend_daily_xp`, pa je admin bonus tiho bivao odsečen
   * dnevnom kvotom (`granted` 0 kad je korisnik već potrošio budžet) — XP se
   * nije menjao iako je admin video „Uspešno“. Ovde se pomera samo `xp`;
   * nivo/bedževi se izvode iz njega (`map()`/`publicUser()`).
   */
  async bumpXp(id: string, amount: number): Promise<UserRecord | null> {
    const uuid = await this.resolveUuid(id);
    const { data, error } = await this.db.rpc('bump_user_xp', { p_user_id: uuid, p_amount: Math.round(amount) });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === 'object') return this.hydrate(row);
      return this.findById(uuid);
    }
    // Migracija `29-…-xp-progression.sql` još nije puštena → read-modify-write.
    logger.warn({ err: error, userId: uuid }, 'bump_user_xp_rpc_failed');
    const current = await this.findById(uuid);
    if (!current) return null;
    return this.update(uuid, { xp: Math.max(0, current.xp + Math.round(amount)) });
  }

  /** ID iz `users.username` / `username_lower` (admin rute primaju i username). */
  private async resolveUuid(value: string): Promise<string> {
    if (asUuid(value)) return value;
    const { data } = await this.runSelect((columns) =>
      this.db.from('users').select(columns).ilike('username', escapeLike(value)).limit(1).maybeSingle(),
    );
    return data?.id ?? value;
  }

  /**
   * Izvor istine za bedževe je `user_badges` (kod → `badges.code`).
   * Kolona `users.badges` ostaje materializovani keš za brza čitanja lista.
   */
  private async loadBadges(userId: string): Promise<string[] | null> {
    if (!asUuid(userId)) return null;
    const { data, error } = await this.db
      .from('user_badges')
      .select('badges(code)')
      .eq('user_id', userId);
    if (error || !data) return null;
    return data
      .map((row: any) => row.badges?.code)
      .filter((code: any): code is string => typeof code === 'string');
  }

  /**
   * Izvor istine za povezane naloge je `connected_accounts` tabela.
   * `users.connected_accounts` (JSONB) je fallback/keš.
   */
  private async loadConnectedAccounts(userId: string): Promise<Record<string, string> | null> {
    if (!asUuid(userId)) return null;
    const { data, error } = await this.db
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId);
    if (error || !data) return null;
    if (!data.length) return {};
    // Otkačeni nalozi (`revoked_at`) ostaju u tabeli kao istorija, ali se ne
    // prikazuju na profilu.
    return Object.fromEntries(
      data
        .filter((row: any) => !row.revoked_at)
        .map((row: any) => [row.platform, row.platform_username]),
    );
  }

  async addBadge(userId: string, code: string): Promise<void> {
    const uuid = asUuid(userId);
    if (!uuid) return;
    const { data: badge } = await this.db.from('badges').select('id').eq('code', code).maybeSingle();
    if (!badge?.id) {
      warnOnceBadge(code);
      return;
    }
    const { error } = await this.db
      .from('user_badges')
      .upsert({ user_id: uuid, badge_id: badge.id }, { onConflict: 'user_id,badge_id' });
    if (error) throw error;
  }

  /** F-31 — stvarni datum dodele bedža (`user_badges.awarded_at`). */
  async listBadgeAwards(userId: string): Promise<Array<{ code: string; awardedAt: string | null }>> {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const { data, error } = await this.db
      .from('user_badges')
      .select('awarded_at, badges(code)')
      .eq('user_id', uuid);
    if (error || !data) return [];
    return data.map((row: any) => ({
      code: row.badges?.code ?? '',
      awardedAt: row.awarded_at ?? null,
    }));
  }

  /** F-31 — stvarni datum povezivanja naloga (`connected_accounts.created_at`). */
  async listConnectedAccountDates(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const { data, error } = await this.db
      .from('connected_accounts')
      .select('platform, created_at, revoked_at')
      .eq('user_id', uuid);
    if (error || !data) return [];
    return data
      .filter((row: any) => !row.revoked_at)
      .map((row: any) => ({ platform: row.platform, connectedAt: row.created_at ?? null }));
  }

  async setConnectedAccount(userId: string, platform: string, platformUsername: string): Promise<void> {
    const uuid = asUuid(userId);
    if (!uuid) return;
    let { error } = await this.db
      .from('connected_accounts')
      .upsert(
        { user_id: uuid, platform, platform_username: platformUsername, revoked_at: null },
        { onConflict: 'user_id,platform' },
      );
    // Pre `server/schema-ALL.sql` kolona `revoked_at` ne postoji — upiši bez nje.
    if (error && /revoked_at/.test(error.message)) {
      ({ error } = await this.db
        .from('connected_accounts')
        .upsert({ user_id: uuid, platform, platform_username: platformUsername }, { onConflict: 'user_id,platform' }));
    }
    if (error) throw error;
  }

  /**
   * Soft revoke: red ostaje kao istorija (`revoked_at` = sada), pa ponovno
   * povezivanje istog naloga ne može ponovo da zaradi XP.
   */
  async revokeConnectedAccount(userId: string, platform: string): Promise<void> {
    const uuid = asUuid(userId);
    if (!uuid) return;
    const revokedAt = new Date().toISOString();
    const { error } = await this.db
      .from('connected_accounts')
      .update({ revoked_at: revokedAt })
      .eq('user_id', uuid)
      .eq('platform', platform);
    if (error) {
      if (!/revoked_at/.test(error.message)) throw error;
      // Stara šema: nema istorije, ali odvajanje mora da radi.
      const fallback = await this.db
        .from('connected_accounts')
        .delete()
        .eq('user_id', uuid)
        .eq('platform', platform);
      if (fallback.error) throw fallback.error;
    }
  }

  async hasConnectedAccountHistory(userId: string, platform: string, platformUsername: string): Promise<boolean> {
    const uuid = asUuid(userId);
    if (!uuid) return false;
    const { data, error } = await this.db
      .from('connected_accounts')
      .select('platform_username')
      .eq('user_id', uuid)
      .eq('platform', platform)
      .maybeSingle();
    if (error || !data) return false;
    return data.platform_username === platformUsername;
  }

  /** Atomični inkrement karme — RPC nema read-modify-write race. */
  async applyKarma(userId: string, delta: number): Promise<boolean> {
    const uuid = asUuid(userId);
    if (!uuid || delta === 0) return false;
    const { error } = await this.db.rpc('apply_user_karma', { p_user_id: uuid, p_delta: delta });
    if (error) {
      // RPC iz schema-2.4.4 ne postoji još → fallback na UPDATE u aplikaciji.
      logger.debug({ err: error }, 'apply_user_karma_rpc_missing');
      return false;
    }
    return true;
  }
  /** F-06 — `token_version + 1` (uslovni update, bez tihog gubitka upisa). */
  async bumpSessionVersion(userId: string): Promise<number> {
    const uuid = asUuid(userId);
    if (!uuid) return 0;

    const { data: fresh, error: readError } = await this.db
      .from('users')
      .select('token_version')
      .eq('id', uuid)
      .maybeSingle();
    if (readError) {
      // Kolona ne postoji dok se ne pusti `server/schema-ALL.sql` — sesije ostaju legacy (tv=0).
      logger.warn({ err: readError }, 'token_version_missing');
      return 0;
    }
    const current = typeof fresh?.token_version === 'number' ? fresh.token_version : 0;
    const next = current + 1;

    const { data, error } = await this.db
      .from('users')
      .update({ token_version: next })
      .eq('id', uuid)
      .eq('token_version', current)
      .select('token_version')
      .maybeSingle();
    if (error) throw error;
    // Ako `data` nema (neko je u međuvremenu povećao verziju), sesije su već poništene.
    return data ? (data.token_version as number) : next;
  }

  async update(id: string, patch: Partial<UserRecord>) {
    const row: any = {};
    if (patch.username !== undefined) row.username = patch.username;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.password !== undefined) row.password_hash = patch.password;
    if (patch.avatar !== undefined) row.avatar_url = patch.avatar;
    if (patch.bio !== undefined) row.bio = patch.bio;
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.xp !== undefined) {
      row.xp = patch.xp;
      // Nivo je izvedena vrednost — kolona se prikazuje u admin tabeli i
      // rang-listi, pa se drži usklađenom sa XP-om. `xpNeeded` NIJE kolona:
      // računa se iz krive (`xpForLevel`).
      row.level = levelFromXp(patch.xp);
    } else if (patch.level !== undefined) {
      row.level = patch.level;
    }
    if (patch.karma !== undefined) row.karma = patch.karma;
    // 6.x — reputacija za prihvaćene odgovore (`users.solved_answers`).
    if (patch.solvedAnswers !== undefined) row.solved_answers = patch.solvedAnswers;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.tokenVersion !== undefined) row.token_version = patch.tokenVersion;
    if (patch.termsVersion !== undefined) row.terms_version = patch.termsVersion;
    if (patch.termsAcceptedAt !== undefined) row.terms_accepted_at = patch.termsAcceptedAt;
    if (patch.termsAcceptedIp !== undefined) row.terms_accepted_ip = patch.termsAcceptedIp;
    // F-33 — TOTP (kolone iz `server/schema-ALL.sql`).
    if (patch.totpSecret !== undefined) row.totp_secret = patch.totpSecret;
    if (patch.totpEnabledAt !== undefined) row.totp_enabled_at = patch.totpEnabledAt;
    if (patch.totpRecoveryCodes !== undefined) row.totp_recovery_codes = patch.totpRecoveryCodes;
    if (patch.totpFailedAttempts !== undefined) row.totp_failed_attempts = patch.totpFailedAttempts;
    if (patch.totpLockedUntil !== undefined) row.totp_locked_until = patch.totpLockedUntil;
    if (patch.totpLastUsedStep !== undefined) row.totp_last_used_step = patch.totpLastUsedStep;
    // Kolone badges / connected_accounts mogu nedostajati pre Schema 2.4.1
    if (patch.badges !== undefined) row.badges = patch.badges;
    if (patch.connectedAccounts !== undefined) row.connected_accounts = patch.connectedAccounts;
    if (patch.isBanned !== undefined) row.is_banned = patch.isBanned;
    /**
     * `is_verified` je falio u mapiranju — `db.users.update(id, { isVerified: true })`
     * je slao prazan UPDATE, pa email verifikacija nikad nije upisivala stanje
     * (token se trošio, nalog ostajao neverifikovan).
     */
    if (patch.isVerified !== undefined) row.is_verified = patch.isVerified;

    // Fallback za kolone koje šema nema (badges/connected_accounts)
    const optional = { badges: patch.badges, connectedAccounts: patch.connectedAccounts };
    if (optional.badges !== undefined || optional.connectedAccounts !== undefined) {
      patchExtras(id, optional);
    }

    let { data, error } = await this.db.from('users').update(row).eq('id', id).select('*').single();

    // Graceful fallback: skini opcione kolone i pokušaj ponovo. Badževi i
    // povezani nalozi idu u lokalno skladište dok kolone ne postoje.
    if (error && (error.message.includes('badges') || error.message.includes('connected_accounts'))) {
      this.userColumns = '*';
      const { badges: _b, connected_accounts: _c, ...safeRow } = row;
      ({ data, error } = await this.db.from('users').update(safeRow).eq('id', id).select('*').single());
      if (data) return this.map(data);
    }

    /**
     * F-33 — kolone TOTP-a stižu sa `server/schema-ALL.sql`. Dok migracija nije
     * primenjena, ostale izmene (status, lastSeenAt, recovery kodovi...) ne
     * smeju da padnu zbog nepostojeće kolone.
     */
    // 6.x — kolona reputacije stiže sa `server/schema-ALL.sql`; dok migracija
    // nije puštena, ostale izmene (XP, uloga…) ne smeju da padnu zbog nje.
    if (error && /solved_answers/.test(error.message) && row.solved_answers !== undefined) {
      logger.warn({ userId: id }, 'solved_answers_column_missing_run_schema');
      const { solved_answers: _solved, ...safeRow } = row;
      ({ data, error } = await this.db.from('users').update(safeRow).eq('id', id).select('*').single());
      if (data) return this.map(data);
    }

    if (error && /totp_/.test(error.message)) {
      logger.warn({ userId: id }, 'totp_columns_missing_run_schema_2_5_4');      const totpKeys = Object.keys(row).filter((key) => key.startsWith('totp_'));
      if (totpKeys.length) {
        const safeRow = { ...row };
        for (const key of totpKeys) delete safeRow[key];
        ({ data, error } = await this.db.from('users').update(safeRow).eq('id', id).select('*').single());
        if (data) return this.map(data);
      }
    }

    if (error) throw error;
    return this.map(data);
  }
  async remove(id: string) {
    const { error } = await this.db.from('users').delete().eq('id', id);
    return !error;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bedž iz koda ne postoji u `badges` tabeli (seed) — loguj jednom. */
const warnedBadges = new Set<string>();
const warnOnceBadge = (code: string) => {
  if (warnedBadges.has(code)) return;
  warnedBadges.add(code);
  logger.warn({ code }, 'badge_code_missing_in_badges_table');
};/** Supabase kolone author_id su UUID — legacy ID-jevi ('user_admin') se preskaču. */
const asUuid = (value?: string | null): string | null => (value && UUID_RE.test(value) ? value : null);

/** Escapeuje ILIKE wildcarde (`%`, `_`) — korisnički unos nije pattern. */
const escapeLike = (value: string): string => value.replace(/([\\%_])/g, '\\$1');

/**
 * PostgREST filter vrednost: sve što nije `[A-Za-z0-9 _\-.]` mora u dvostruke
 * navodnike, a `"` i `\` se escape-uju backslash-om. Sprečava injekciju
 * dodatnih filtera kroz `?search=` u `.or(...)`.
 */
const escapePostgrestValue = (value: string): string =>
  `"${value.replace(/["\\]/g, '\\$&')}"`;

/** Default subforum slug -> forum_categories.name (schema.sql referencira category_id). */
const SUBFORUM_NAMES: Record<string, string> = {
  'pc-gaming': 'PC Gaming',
  consoles: 'Consoles',
  esports: 'Esports',
  hardware: 'Hardware',
  lfg: 'LFG (Looking For Group)',
  'off-topic': 'Off-Topic',
};

class SupabaseArticleRepo implements ArticleRepo {
  private authorNames = new Map<string, string>();

  constructor(private db: SupabaseClient) {}

  /** Ime autora živi u `users` tabeli — keširaj username po author UUID-u. */
  private async resolveAuthorName(authorId: string): Promise<string> {
    if (!authorId) return '';
    const cached = this.authorNames.get(authorId);
    if (cached) return cached;
    const { data } = await this.db.from('users').select('username').eq('id', authorId).maybeSingle();
    const name = data?.username ?? '';
    this.authorNames.set(authorId, name);
    return name;
  }

  private async withAuthor(article: ArticleRecord): Promise<ArticleRecord> {
    if (article.author) return article;
    return { ...article, author: await this.resolveAuthorName(article.authorId) };
  }

  private map(row: any): ArticleRecord {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? '',
      content: row.content,
      coverImage: row.cover_image ?? '',
      authorId: row.author_id ?? '',
      author: row.author_name ?? '',
      category: row.category,
      tags: row.tags ?? [],
      status: row.status,
      isFeatured: row.is_featured ?? false,
      views: row.views ?? 0,
      reactions: row.reactions ?? { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      // 2.13.0 — kolone postoje posle `schema-2.13.0-news-sources.sql`; do tada su `undefined`.
      sourceUrl: row.source_url ?? null,
      newsSource: row.news_source ?? null,
      eventId: row.event_id ?? null,
      eventTitle: row.event_title ?? null,
      whyItMatters: row.why_it_matters ?? null,
    };
  }
  async findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string; publishedBefore?: string }) {
    let q = this.db.from('articles').select('*');
    if (filter?.category) q = q.eq('category', filter.category);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.featured !== undefined) q = q.eq('is_featured', filter.featured);
    // 2.10.0 — double-check: izbaci članke sa datumom objave u budućnosti.
    if (filter?.publishedBefore) q = q.or(`published_at.is.null,published_at.lte.${filter.publishedBefore}`);
    if (filter?.search) {
      const term = escapePostgrestValue(filter.search.replace(/[%_\\]/g, '\\$&'));
      q = q.or(`title.ilike.*${term}*,excerpt.ilike.*${term}*`);
    }
    const { data, error } = await q.order('published_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return Promise.all((data ?? []).map((r) => this.withAuthor(this.map(r))));
  }

  /** F-18 — COUNT članaka bez učitavanja redova. */
  async count(filter?: { status?: string }): Promise<number> {
    let q = this.db.from('articles').select('id', { count: 'exact', head: true });
    if (filter?.status) q = q.eq('status', filter.status);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  /** F-18 — SUM pregleda (RPC `sum_article_views` u `server/schema-ALL.sql`). */
  async sumViews(): Promise<number> {
    const { data, error } = await this.db.rpc('sum_article_views');
    if (!error && typeof data === 'number') return data;
    const { data: rows } = await this.db.from('articles').select('views');
    return (rows ?? []).reduce((sum: number, row: any) => sum + Number(row.views ?? 0), 0);
  }

  /** F-7b — batch dohvat članaka za admin analitiku (IN upit). */
  async findByIds(ids: string[]): Promise<ArticleRecord[]> {
    const uuids = [...new Set(ids)].filter((id) => asUuid(id));
    if (!uuids.length) return [];
    const { data, error } = await this.db.from('articles').select('*').in('id', uuids);
    if (error) throw error;
    return Promise.all((data ?? []).map((row: any) => this.withAuthor(this.map(row))));
  }

  /**
   * 2.10.0 — atomsko aktiviranje dospeitih zakazanih članaka.
   * UPDATE ... SELECT u jednom PostgREST zahtevu: uslov `status='scheduled' AND
   * published_at <= now()` se proverava na SERVERU, pa nema race-a između
   * dve instance joba ni između čitanja i upisa. `published_at` NE diramo —
   * datum objave ostaje zakazani trenutak.
   */
  async publishDue(now: Date = new Date()) {
    const { data, error } = await this.db
      .from('articles')
      .update({ status: 'published', updated_at: now.toISOString() })
      .eq('status', 'scheduled')
      .lte('published_at', now.toISOString())
      .select('*');
    if (error) throw error;
    return Promise.all((data ?? []).map((row: any) => this.withAuthor(this.map(row))));
  }
  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data } = await this.db.from('articles').select('*').eq('id', id).maybeSingle();
    return data ? this.withAuthor(this.map(data)) : null;
  }
  async findBySlug(slug: string) {
    const { data } = await this.db.from('articles').select('*').eq('slug', slug).maybeSingle();
    return data ? this.withAuthor(this.map(data)) : null;
  }

  /**
   * F-12 — reakcija je vezana za korisnika (`UNIQUE(article_id, user_id, type)`).
   * Dupli insert se ignoriše (23505) → brojači se ne mogu naduvati ponovnim klikom.
   */
  async addReaction(articleId: string, userId: string, type: string) {
    const articleUuid = asUuid(articleId);
    const userUuid = asUuid(userId);
    if (!articleUuid || !userUuid) throw new Error('Reakcija zahteva validan ID članka i korisnika.');

    // F-12 — kolone u šemi su `reaction` i `user_id`, ne `type`.
    const { error } = await this.db
      .from('article_reactions')
      .insert({ article_id: articleUuid, user_id: userUuid, reaction: type });
    const created = !error;
    if (error && error.code !== '23505') throw error;

    // Brojači: `reactions` kolona je keš; tačan izvor je `article_reactions`.
    if (created) {
      const { error: rpcError } = await this.db.rpc('apply_article_reaction', {
        p_article_id: articleUuid,
        p_type: type,
      });
      if (rpcError) {
        // RPC iz `server/schema-ALL.sql` još nije pušten — ažuriraj JSONB atomično u aplikaciji.
        logger.debug({ err: rpcError }, 'apply_article_reaction_rpc_missing');
        const { data: current } = await this.db.from('articles').select('reactions').eq('id', articleUuid).maybeSingle();
        const reactions = { ...(current?.reactions ?? {}) };
        reactions[type] = (reactions[type] || 0) + 1;
        await this.db.from('articles').update({ reactions }).eq('id', articleUuid);
      }
    }

    const { data } = await this.db.from('articles').select('reactions').eq('id', articleUuid).maybeSingle();
    return { created, reactions: data?.reactions ?? {} };
  }

  async listComments(articleId: string) {
    const articleUuid = asUuid(articleId);
    if (!articleUuid) return [];
    const { data, error } = await this.db
      .from('article_comments')
      .select('*')
      .eq('article_id', articleUuid)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any) => this.mapComment(row));
  }

  private mapComment(row: any): ArticleCommentRecord {
    return {
      id: row.id,
      articleId: row.article_id,
      userId: row.user_id ?? '',
      author: row.author_name ?? '',
      authorAvatar: row.author_avatar ?? undefined,
      content: row.content,
      parentId: row.parent_comment_id ?? null,
      isEdited: Boolean(row.is_edited),
      isDeleted: Boolean(row.is_deleted),
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  async createComment(comment: ArticleCommentRecord) {
    const articleUuid = asUuid(comment.articleId);
    if (!articleUuid) throw new Error('Komentar zahteva validan ID članka.');
    // F-08 — šema: `user_id`, `parent_comment_id`; ime/avatar autora je snapshot.
    const { data, error } = await this.db
      .from('article_comments')
      .insert({
        article_id: articleUuid,
        user_id: asUuid(comment.userId),
        author_name: comment.author,
        author_avatar: comment.authorAvatar ?? null,
        content: comment.content,
        parent_comment_id: asUuid(comment.parentId),
      })
      .select('*')
      .single();
    if (error) throw error;
    return this.mapComment(data);
  }

  async listAllComments(limit = 100) {
    const { data, error } = await this.db
      .from('article_comments')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.mapComment(row));
  }

  async deleteComment(id: string) {
    const uuid = asUuid(id);
    if (!uuid) return false;
    const { error } = await this.db
      .from('article_comments')
      .update({ is_deleted: true })
      .eq('id', uuid);
    return !error;
  }

  /** GDPR — `user_id` + soft-obrisani (i oni nose lični identifikator). */
  async listCommentsByUser(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const { data, error } = await this.db.from('article_comments').select('*').eq('user_id', uuid);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.mapComment(row));
  }

  /** GDPR — `user_id` → NULL; ime/avatar autora se uklanjaju, sadržaj ostaje anoniman. */
  async anonymizeCommentsByUser(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return 0;
    const { data, error } = await this.db
      .from('article_comments')
      .update({
        user_id: null,
        author_name: 'obrisani-nalog',
        author_avatar: null,
        is_deleted: true,
      })
      .eq('user_id', uuid)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }
  async create(article: ArticleRecord) {
    /**
     * 2.13.0 — nove kolone (`source_url`, `news_source`, `event_id`) postoje tek
     * posle `schema-2.13.0-news-sources.sql`. Ako migracija još nije puštena,
     * PostgREST vraća PGRST204 — tada upisujemo bez njih, da uvoz ne pukne.
     */
    const base: Record<string, unknown> = {
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      content: article.content,
      cover_image: article.coverImage,
      author_id: asUuid(article.authorId),
      category: article.category,
      tags: article.tags,
      status: article.status,
      is_featured: article.isFeatured,
      views: article.views,
      published_at: article.publishedAt,
    };
    const extended: Record<string, unknown> = { ...base };
    if (article.sourceUrl) extended.source_url = article.sourceUrl;
    if (article.newsSource) extended.news_source = article.newsSource;
    if (article.eventId) extended.event_id = article.eventId;

    let { data, error } = await this.db.from('articles').insert(extended).select('*').single();
    if (error && ['PGRST204', '42703'].includes((error as { code?: string }).code ?? '')) {
      ({ data, error } = await this.db.from('articles').insert(base).select('*').single());
    }
    if (error) throw error;
    return this.map(data);
  }

  /** 2.13.0 — sve vesti istog događaja, najnovija prva (stranica događaja). */
  async findByEvent(eventId: string, limit = 30): Promise<ArticleRecord[]> {
    const { data, error } = await this.db
      .from('articles')
      .select('*')
      .eq('event_id', eventId)
      .order('published_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return Promise.all((data ?? []).map((row: any) => this.withAuthor(this.map(row))));
  }
  async update(id: string, patch: Partial<ArticleRecord>) {
    const row: any = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.slug !== undefined) row.slug = patch.slug;
    if (patch.excerpt !== undefined) row.excerpt = patch.excerpt;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.coverImage !== undefined) row.cover_image = patch.coverImage;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.isFeatured !== undefined) row.is_featured = patch.isFeatured;
    if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
    const { data, error } = await this.db.from('articles').update(row).eq('id', id).select('*').single();
    if (error) throw error;
    return this.map(data);
  }
  async remove(id: string) {
    const { error } = await this.db.from('articles').delete().eq('id', id);
    return !error;
  }
  async incrementViews(id: string) {
    const { error } = await this.db.rpc('increment_article_views', { p_article_id: id });
    if (!error) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data } = await this.db.from('articles').select('views').eq('id', id).maybeSingle();
      if (!data) return;
      const next = (data.views ?? 0) + 1;
      const { error: updateError } = await this.db
        .from('articles')
        .update({ views: next })
        .eq('id', id)
        .eq('views', data.views ?? 0);
      if (!updateError) return;
    }
  }
  async findByAuthor(authorId: string, limit = 50) {
    const uuid = asUuid(authorId);
    if (!uuid) return [];
    const { data, error } = await this.db
      .from('articles')
      .select('*')
      .eq('author_id', uuid)
      .order('published_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return Promise.all((data ?? []).map((row) => this.withAuthor(this.map(row))));
  }
}

class SupabaseForumRepo implements ForumRepo {
  private categoryIds = new Map<string, string>();

  constructor(private db: SupabaseClient) {}

  /** Mapira subforum slug (ili naziv) na forum_categories.id. */
  private async resolveCategoryId(subforum: string): Promise<string | null> {
    const cached = this.categoryIds.get(subforum);
    if (cached) return cached;
    const { data } = await this.db.from('forum_categories').select('id, slug, name');
    (data ?? []).forEach((row: any) => {
      if (row.slug) this.categoryIds.set(row.slug, row.id);
      if (row.name) this.categoryIds.set(row.name, row.id);
    });
    return this.categoryIds.get(subforum) ?? this.categoryIds.get(SUBFORUM_NAMES[subforum] ?? '') ?? null;
  }
  private userNames = new Map<string, string>();

  /** Schema nema author_name — ime se dohvata iz users tabele (keširano). */
  private async resolveUserNames(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id && !this.userNames.has(id));
    if (!missing.length) return;
    const { data } = await this.db.from('users').select('id, username').in('id', missing);
    (data ?? []).forEach((user: any) => this.userNames.set(user.id, user.username));
    missing.forEach((id) => { if (!this.userNames.has(id)) this.userNames.set(id, ''); });
  }

  /** `subforum` se koristi kao slug ako postoji, inače naziv kategorije. */
  private async resolveCategorySlugs(ids: string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids)].filter(Boolean);
    const map = new Map<string, string>();
    if (!wanted.length) return map;
    const { data } = await this.db.from('forum_categories').select('id, slug, name');
    (data ?? []).forEach((row: any) => {
      if (!wanted.includes(row.id)) return;
      const name = row.name ?? '';
      const slug = row.slug
        ?? Object.entries(SUBFORUM_NAMES).find(([, categoryName]) => categoryName === name)?.[0]
        ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      map.set(row.id, slug);
    });
    return map;
  }

  private mapThread(row: any, categorySlug?: string, authorName?: string): ThreadRecord {
    return {
      id: row.id,
      subforum: categorySlug ?? row.subforum ?? row.category_slug ?? '',
      title: row.title,
      content: row.content,
      author: authorName ?? row.author_name ?? this.userNames.get(row.author_id) ?? '',
      authorId: row.author_id ?? '',
      tags: row.tags ?? [],
      isPinned: row.is_pinned ?? false,
      isLocked: row.is_locked ?? false,
      isSpoiler: row.is_spoiler ?? false,
      isEdited: row.is_edited ?? undefined,
      isDeleted: row.is_deleted ?? undefined,
      karma: row.karma ?? 0,
      views: row.views ?? 0,
      replies: row.reply_count ?? 0,
      // F-3 — bez migracije kolona ne postoji, pa je vrednost `undefined`.
      dealId: row.deal_id ?? null,
      // Kolona može da ne postoji dok se ne pusti migracija — tada je `null`.
      acceptedReplyId: row.accepted_reply_id ?? null,
      createdAt: row.created_at,
      lastReplyAt: row.last_reply_at ?? row.created_at,
    };
  }
  private mapReply(row: any, authorName?: string): ReplyRecord {
    return {
      id: row.id,
      threadId: row.thread_id,
      parentId: row.parent_reply_id ?? null,
      author: authorName ?? row.author_name ?? this.userNames.get(row.author_id) ?? '',
      authorId: row.author_id ?? '',
      content: row.content,
      karma: row.karma ?? 0,
      isSpoiler: row.is_spoiler ?? false,
      isEdited: row.is_edited ?? undefined,
      isDeleted: row.is_deleted ?? undefined,
      createdAt: row.created_at,
    };
  }
  async listThreads(filter?: {
    subforum?: string;
    sort?: 'hot' | 'new' | 'top';
    search?: string;
    unsolved?: boolean;
    limit?: number;
    offset?: number;
    cursorId?: string;
    countOnly?: boolean;
  }) {
    let q = this.db.from('forum_threads').select('*');
    // Soft-deleted teme se ne prikazuju u listama (samo moderatori ih vide u adminu).
    q = q.eq('is_deleted', false);
    if (filter?.subforum) {
      const categoryId = await this.resolveCategoryId(filter.subforum);
      if (!categoryId) return [];
      q = q.eq('category_id', categoryId);
    }
    // 6.x — „Nerešeno“: teme bez prihvaćenog odgovora.
    if (filter?.unsolved) q = q.is('accepted_reply_id', null);
    if (filter?.search) {
      // PostgREST `.or()` je sirovi filter izraz: korisnički unos sa `,` `(` `)`
      // ili `.` mogao je da ubaci dodatne uslove. Zato se unos escape-uje po
      // PostgREST gramatici (dvostruki navodnici + backslash) i koristi se
      // eksplicitni operator `*` (bez `*` PostgREST `%` tretira kao escape).
      const term = escapePostgrestValue(filter.search.replace(/[%_\\]/g, '\\$&'));
      q = q.or(`title.ilike.*${term}*,content.ilike.*${term}*`);
    }
    const sort = filter?.sort ?? 'hot';
    if (sort === 'new') q = q.order('created_at', { ascending: false });
    else if (sort === 'top') q = q.order('karma', { ascending: false });
    else q = q.order('is_pinned', { ascending: false }).order('karma', { ascending: false });
    // F-18 — limit/range u SQL-u (ranije: cela tabela pa slice u memoriji).
    if (filter?.offset) q = q.range(filter.offset, filter.offset + (filter.limit ?? 100) - 1);
    else if (filter?.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    await this.resolveUserNames(rows.map((r) => r.author_id));
    const slugs = await this.resolveCategorySlugs(rows.map((r) => r.category_id));
    return rows.map((r) => this.mapThread(r, slugs.get(r.category_id)));
  }

  /** F-18 — COUNT u SQL-u (head: true); ranije se brojao `listThreads().length`. */
  async countThreads(filter?: { subforum?: string; search?: string; authorId?: string; unsolved?: boolean }): Promise<number> {
    let q = this.db.from('forum_threads').select('id', { count: 'exact', head: true }).eq('is_deleted', false);
    if (filter?.unsolved) q = q.is('accepted_reply_id', null);
    if (filter?.subforum) {
      const categoryId = await this.resolveCategoryId(filter.subforum);
      if (!categoryId) return 0;
      q = q.eq('category_id', categoryId);
    }
    if (filter?.authorId) {
      const uuid = asUuid(filter.authorId);
      if (!uuid) return 0;
      q = q.eq('author_id', uuid);
    }
    if (filter?.search) {
      const term = escapePostgrestValue(filter.search.replace(/[%_\\]/g, '\\$&'));
      q = q.or(`title.ilike.*${term}*,content.ilike.*${term}*`);
    }
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * B-10 — offset keyset kursora u SQL-u.
   * PostgREST ne podržava `LIMIT 1 OFFSET n`, ali COUNT redova koji su
   * „pre“ kursora po ISTOM sortu (sa `id` kao tie-breaker-om u JS-u i ovde
   * namerno zanemarenim — isti red se nikad ne pojavljuje dvaput) daje pravi
   * offset bez učitavanja prvih 200 redova.
   * Vraća `null` ako kursor ne postoji (tada je i strana prazna).
   */
  async threadCursorOffset(
    filter: { subforum?: string; sort?: 'hot' | 'new' | 'top'; search?: string },
    cursorId: string,
  ): Promise<number | null> {
    const sort = filter.sort ?? 'hot';
    const { data: cursorRow, error: cursorError } = await this.db
      .from('forum_threads')
      .select('id, created_at, karma, is_pinned')
      .eq('id', cursorId)
      .eq('is_deleted', false)
      .maybeSingle();
    if (cursorError) throw cursorError;
    if (!cursorRow) return null;

    const baseQuery = () => {
      let q = this.db.from('forum_threads').select('id', { count: 'exact', head: true }).eq('is_deleted', false);
      if (filter.search) {
        const term = escapePostgrestValue(filter.search.replace(/[%_\\]/g, '\\$&'));
        q = q.or(`title.ilike.*${term}*,content.ilike.*${term}*`);
      }
      return q;
    };

    let categoryId: string | null = null;
    if (filter.subforum) {
      categoryId = await this.resolveCategoryId(filter.subforum);
      if (!categoryId) return null;
    }
    const scoped = () => (categoryId ? baseQuery().eq('category_id', categoryId) : baseQuery());

    if (sort === 'hot') {
      // PINOVANE uvek prve (i međusobno po karmi), pa ostale po karmi.
      const k = cursorRow.karma ?? 0;
      if (cursorRow.is_pinned === true) {
        const [before, rest] = await Promise.all([
          scoped().eq('is_pinned', true).gt('karma', k),
          scoped().eq('is_pinned', true).eq('karma', k).neq('id', cursorId),
        ]);
        if (before.error) throw before.error;
        if (rest.error) throw rest.error;
        // Pinovane pre kursora (+1 sam kursor) — nepinovane su uvek POSLE svih pinovanih.
        return (before.count ?? 0) + (rest.count ?? 0) + 1;
      }
      const [pinnedCount, before] = await Promise.all([
        scoped().eq('is_pinned', true),
        scoped().eq('is_pinned', false).gt('karma', k),
      ]);
      if (pinnedCount.error) throw pinnedCount.error;
      if (before.error) throw before.error;
      return (pinnedCount.count ?? 0) + (before.count ?? 0) + 1;
    }

    const column = sort === 'new' ? 'created_at' : 'karma';
    const value = sort === 'new' ? cursorRow.created_at : cursorRow.karma ?? 0;
    const { count, error } = await scoped().gt(column, value);
    if (error) throw error;
    // `new` sort po created_at (jedinstven po redu), `top` po karmi — offset je
    // broj redova striktno ispred kursora, plus 1 za sam kursor.
    return (count ?? 0) + 1;
  }

  /** F-18 — SUM pregleda u bazi (RPC `sum_thread_views`). */
  async sumViews(): Promise<number> {
    const { data, error } = await this.db.rpc('sum_thread_views');
    if (!error && typeof data === 'number') return data;
    const { data: rows } = await this.db.from('forum_threads').select('views');
    return (rows ?? []).reduce((sum: number, row: any) => sum + Number(row.views ?? 0), 0);
  }
  async findThread(id: string) {
    if (!asUuid(id)) return null; // legacy ID-jevi ('101') nisu UUID
    // Soft-deleted teme ostaju čitljive (`isDeleted`), pa ruta odlučuje ko ih
    // sme videti (autor/moderator) — ranije je brisanje bilo nevidljivo hard delete.
    const { data } = await this.db.from('forum_threads').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    await this.resolveUserNames([data.author_id]);
    const slugs = await this.resolveCategorySlugs([data.category_id]);
    return this.mapThread(data, slugs.get(data.category_id));
  }

  /** F-7b — batch dohvat tema za admin analitiku (IN upit). */
  async findThreadsByIds(ids: string[]): Promise<ThreadRecord[]> {
    const uuids = [...new Set(ids)].filter((id) => asUuid(id));
    if (!uuids.length) return [];
    const { data, error } = await this.db.from('forum_threads').select('*').in('id', uuids);
    if (error) throw error;
    if (!data?.length) return [];
    await this.resolveUserNames([...new Set(data.map((row: any) => row.author_id))]);
    const slugs = await this.resolveCategorySlugs([...new Set(data.map((row: any) => row.category_id))]);
    return data.map((row: any) => this.mapThread(row, slugs.get(row.category_id)));
  }
  async createThread(thread: ThreadRecord) {
    const categoryId = await this.resolveCategoryId(thread.subforum);
    const { data, error } = await this.db
      .from('forum_threads')
      .insert({
        category_id: categoryId,
        title: thread.title,
        content: thread.content,
        author_id: asUuid(thread.authorId),
        tags: thread.tags,
        is_spoiler: thread.isSpoiler,
      })
      .select('*')
      .single();
    if (error) throw error;
    return this.mapThread(data, thread.subforum, thread.author);
  }
  async updateThread(id: string, patch: Partial<ThreadRecord>) {
    const row: any = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.isPinned !== undefined) row.is_pinned = patch.isPinned;
    if (patch.isLocked !== undefined) row.is_locked = patch.isLocked;
    if (patch.isSpoiler !== undefined) row.is_spoiler = patch.isSpoiler;
    if (patch.isEdited !== undefined) row.is_edited = patch.isEdited;
    if (patch.isDeleted !== undefined) row.is_deleted = patch.isDeleted;
    if (patch.views !== undefined) row.views = patch.views;
    if (patch.karma !== undefined) row.karma = patch.karma;
    if (patch.replies !== undefined) row.reply_count = patch.replies;
    if (patch.lastReplyAt !== undefined) row.last_reply_at = patch.lastReplyAt;
    // 2.11.0 — prihvaćen odgovor (kolonu dodaje `schema-2.11.0-dm-accepted.sql`)
    if (patch.acceptedReplyId !== undefined) row.accepted_reply_id = asUuid(patch.acceptedReplyId);
    const { data, error } = await this.db.from('forum_threads').update(row).eq('id', id).select('*').single();
    if (error) throw error;
    const slugs = await this.resolveCategorySlugs([data.category_id]);
    const categorySlug = slugs.get(data.category_id);
    return this.mapThread(data, categorySlug, this.userNames.get(data.author_id) ?? '');
  }
  async removeThread(id: string) {
    const { error } = await this.db.from('forum_threads').delete().eq('id', id);
    return !error;
  }
  async listReplies(threadId: string) {
    const { data, error } = await this.db
      .from('forum_replies')
      .select('*')
      .eq('thread_id', threadId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    await this.resolveUserNames((data ?? []).map((r) => r.author_id));
    return (data ?? []).map((r) => this.mapReply(r));
  }
  async createReply(reply: ReplyRecord) {
    const { data, error } = await this.db
      .from('forum_replies')
      .insert({
        thread_id: reply.threadId,
        parent_reply_id: asUuid(reply.parentId),
        author_id: asUuid(reply.authorId),
        content: reply.content,
        is_spoiler: reply.isSpoiler,
      })
      .select('*')
      .single();
    if (error) throw error;
    // reply_count drži trigger `trg_forum_replies_count` (`server/schema-ALL.sql`)
    return this.mapReply(data, reply.author);
  }
  async removeReply(id: string) {
    const { error } = await this.db.from('forum_replies').delete().eq('id', id);
    return !error;
  }
  async updateReply(id: string, patch: Partial<ReplyRecord>) {
    const row: any = {};
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.isSpoiler !== undefined) row.is_spoiler = patch.isSpoiler;
    if (patch.isEdited !== undefined) row.is_edited = patch.isEdited;
    if (patch.isDeleted !== undefined) row.is_deleted = patch.isDeleted;
    const { data, error } = await this.db.from('forum_replies').update(row).eq('id', id).select('*').single();
    if (error) throw error;
    return this.mapReply(data);
  }
  async vote(userId: string, target: string, type: 'up' | 'down' | null) {
    // F-17 — jedan RPC u transakciji: upsert/delete glasa + delta karme.
    // Ranije je čitav tok bio read-modify-write bez transakcije (dupliranje
    // karme pri paralelnim zahtevima). RPC `cast_forum_vote` iz `server/schema-ALL.sql`
    // radi sve atomično pod `SELECT ... FOR UPDATE` i vraća {changed, delta, karma}.
    const thread0 = await this.findThread(target);
    const reply0 = thread0 ? null : await this.findReply(target);
    if (!thread0 && !reply0) return { karma: 0 };

    const uuid = asUuid(userId);
    if (uuid) {
      const { data, error } = await this.db.rpc('cast_forum_vote', {
        p_user_id: uuid,
        p_thread_id: thread0 ? target : null,
        p_reply_id: reply0 ? target : null,
        p_vote_type: type,
      });
      if (!error && data) {
        return {
          karma: Number((data as any).karma ?? 0),
          changed: Boolean((data as any).changed),
          delta: Number((data as any).delta ?? 0),
        } as any;
      }
      if (error && error.code !== 'PGRST202') {
        // 42883 / druga greška u funkciji — ne pada tiho na nebezbedan fallback.
        logger.warn({ err: error }, 'cast_forum_vote_failed');
      }
    }

    return this.voteFallback(userId, target, type, thread0, reply0);
  }

  /** Fallback dok schema-2.5.3 nije puštena: uslovni upisi + UNIQUE constraint. */
  private async voteFallback(
    userId: string,
    target: string,
    type: 'up' | 'down' | null,
    thread: ThreadRecord | null,
    reply: ReplyRecord | null,
  ) {
    const targetColumn = thread ? 'thread_id' : 'reply_id';
    const rpcName = thread ? 'apply_thread_karma' : 'apply_reply_karma';
    const rpcIdName = thread ? 'p_thread_id' : 'p_reply_id';
    const { data: existing, error: lookupError } = await this.db
      .from('forum_votes')
      .select('*')
      .eq('user_id', userId)
      .eq(targetColumn, target)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const baseline = thread ? thread.karma : reply!.karma;
    let delta = 0;

    if (existing) {
      delta += existing.vote_type === 'up' ? -1 : 1;
      const { error } = await this.db.from('forum_votes').delete().eq('id', existing.id);
      if (error) throw error;
    }

    if (type) {
      const { error } = await this.db.from('forum_votes').insert({
        user_id: userId,
        thread_id: thread ? target : null,
        reply_id: reply ? target : null,
        vote_type: type,
      });
      // 23505 = istovremeni zahtev je već upisao glas → bez druge promene karme.
      if (error && error.code === '23505') {
        delta = 0;
      } else if (error) {
        throw error;
      } else {
        delta += type === 'up' ? 1 : -1;
      }
    }

    if (delta === 0) {
      const current = thread ? await this.findThread(target) : await this.findReply(target);
      return { karma: current?.karma ?? baseline, changed: false, delta: 0 } as any;
    }

    let applied = false;
    if (asUuid(target)) {
      const { error } = await this.db.rpc(rpcName, { [rpcIdName]: target, p_delta: delta });
      applied = !error;
    }
    if (!applied) {
      // Uslovni update (eq na pročitanu karmu) — ne prepisuje tuđi upis.
      if (thread) {
        const { error } = await this.db
          .from('forum_threads')
          .update({ karma: baseline + delta })
          .eq('id', target)
          .eq('karma', baseline);
        if (error) throw error;
      } else {
        const { error } = await this.db
          .from('forum_replies')
          .update({ karma: baseline + delta })
          .eq('id', target)
          .eq('karma', baseline);
        if (error) throw error;
      }
    }

    const result = thread ? await this.findThread(target) : await this.findReply(target);
    return { karma: result?.karma ?? baseline, changed: true, delta } as any;
  }

  async listCategories() {
    // Schema 2.4.4: brojanje u jednom SQL upitu (bez skeniranja svih tema).
    const stats = await this.db.rpc('forum_category_stats');
    if (!stats.error && Array.isArray(stats.data) && stats.data.length) {
      return stats.data.map((row: any) => ({
        id: row.slug,
        slug: row.slug,
        name: row.name,
        description: row.description ?? '',
        icon: row.icon ?? '💬',
        color: row.color ?? undefined,
        threads: Number(row.thread_count ?? 0),
        posts: Number(row.post_count ?? 0),
      }));
    }

    const [{ data: rows, error }, threads] = await Promise.all([
      this.db.from('forum_categories').select('id, slug, name, description, icon, color').eq('is_active', true).order('sort_order'),
      this.listThreads(),
    ]);

    // Tabela nije popunjena → dokumentovani defaulti (nikad korisnički unos)
    if (error || !rows?.length) {
      const stats = new Map<string, { threads: number; posts: number }>();
      threads.forEach((thread) => {
        const entry = stats.get(thread.subforum) ?? { threads: 0, posts: 0 };
        entry.threads += 1;
        entry.posts += 1 + (thread.replies || 0);
        stats.set(thread.subforum, entry);
      });
      return MEMORY_CATEGORIES.map((category) => ({ ...category, ...(stats.get(category.slug) ?? { threads: 0, posts: 0 }) }));
    }

    return rows.map((row: any) => {
      const slug = row.slug
        ?? Object.entries(SUBFORUM_NAMES).find(([, name]) => name === row.name)?.[0]
        ?? String(row.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const related = threads.filter((thread) => thread.subforum === slug);
      return {
        id: slug,
        slug,
        name: row.name,
        description: row.description ?? '',
        icon: row.icon ?? '💬',
        color: row.color ?? undefined,
        threads: related.length,
        posts: related.reduce((sum, thread) => sum + 1 + (thread.replies || 0), 0),
      };
    });
  }

  async categoryExists(slug: string) {
    const categories = await this.listCategories();
    return categories.some((category) => category.slug === slug);
  }

  async upsertCategory(category: SubforumRecord) {
    const { data: existing } = await this.db
      .from('forum_categories')
      .select('id, slug')
      .eq('slug', category.slug)
      .maybeSingle();
    const row: any = {
      slug: category.slug,
      name: category.name,
      description: category.description ?? '',
      icon: category.icon ?? '💬',
      color: category.color ?? null,
      is_active: true,
    };
    if (!existing) {
      // Novi red: max(sort_order)+1 — novi subforumi se dodaju na kraj liste.
      const { data: last } = await this.db
        .from('forum_categories')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      row.sort_order = Number(last?.sort_order ?? 0) + 1;
    }
    const { data, error } = existing
      ? await this.db.from('forum_categories').update(row).eq('id', existing.id).select('*').single()
      : await this.db.from('forum_categories').insert(row).select('*').single();
    if (error) throw error;
    // Keš kategorija je zastareo posle upisa — očisti (i `categoryIds`, i slugovi).
    this.categoryIds.clear();
    return {
      id: data.slug,
      slug: data.slug,
      name: data.name,
      description: data.description ?? '',
      icon: data.icon ?? '💬',
      color: data.color ?? undefined,
    };
  }

  async deleteCategory(slug: string) {
    // Soft-delete: `is_active=false` — postojeće teme ostaju vezane za kategoriju.
    const { data, error } = await this.db
      .from('forum_categories')
      .update({ is_active: false })
      .eq('slug', slug)
      .select('id');
    if (error) throw error;
    this.categoryIds.clear();
    return (data?.length ?? 0) > 0;
  }

  async listThreadsByAuthor(authorId: string, username: string, limit = 100) {
    const uuid = asUuid(authorId);
    let q = this.db.from('forum_threads').select('*').order('created_at', { ascending: false }).limit(limit);
    // Upit ide direktno po author_id (indeks idx_forum_threads_author_created)
    q = uuid ? q.eq('author_id', uuid) : q.is('author_id', null);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []).filter((row) => !uuid || row.author_id === uuid);
    await this.resolveUserNames(rows.map((r) => r.author_id));
    const slugs = await this.resolveCategorySlugs(rows.map((r) => r.category_id));
    const mapped = rows.map((r) => this.mapThread(r, slugs.get(r.category_id)));
    // Fallback po imenu za legacy seed redove bez author_id
    return mapped.filter((thread) => thread.authorId || thread.author.toLowerCase() === username.toLowerCase());
  }

  async listRepliesByAuthor(authorId: string, username: string, limit = 100) {
    const uuid = asUuid(authorId);
    let q = this.db
      .from('forum_replies')
      .select('id, thread_id, parent_reply_id, author_id, content, karma, is_spoiler, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    q = uuid ? q.eq('author_id', uuid) : q.is('author_id', null);
    const { data, error } = await q;
    if (error) throw error;
    await this.resolveUserNames((data ?? []).map((r) => r.author_id));
    return (data ?? [])
      .map((r) => this.mapReply(r))
      .filter((reply) => reply.authorId || reply.author.toLowerCase() === username.toLowerCase());
  }

  /** GDPR — bez limita i bez filtera `is_deleted`: soft-obrisan red još nosi autorа. */
  async listAllRepliesByAuthor(authorId: string) {
    const uuid = asUuid(authorId);
    if (!uuid) return [];
    const { data, error } = await this.db.from('forum_replies').select('*').eq('author_id', uuid);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.mapReply(row));
  }

  async incrementViews(id: string) {
    // Atomnični RPC (`server/schema-ALL.sql`). Bez njega: retry-on-conflict fallback.
    const { error } = await this.db.rpc('increment_thread_views', { p_thread_id: id });
    if (!error) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data } = await this.db.from('forum_threads').select('views').eq('id', id).maybeSingle();
      if (!data) return;
      const next = (data.views ?? 0) + 1;
      const { error: updateError } = await this.db
        .from('forum_threads')
        .update({ views: next })
        .eq('id', id)
        .eq('views', data.views ?? 0);
      if (!updateError) return;
    }
  }

  async findReply(id: string) {
    if (!asUuid(id)) return null;
    const { data } = await this.db.from('forum_replies').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    await this.resolveUserNames([data.author_id]);
    return this.mapReply(data);
  }
}

class SupabaseNewsletterRepo implements NewsletterRepo {
  constructor(private db: SupabaseClient) {}

  private map(r: any): NewsletterRecord {
    return {
      id: r.id,
      email: r.email,
      isActive: r.is_active,
      subscribedAt: r.subscribed_at,
      confirmedAt: r.confirmed_at ?? null,
      confirmedIp: r.confirmed_ip ?? null,
      confirmedUserAgent: r.confirmed_user_agent ?? null,
      unsubscribedAt: r.unsubscribed_at ?? null,
    };
  }

  /**
   * F-07 — upisuje PRETPLATU NA ČEKANJU. `ignoreDuplicates` je namerno:
   * ponovni POST /subscribe ne sme da vrati već potvrđenu pretplatu na pending.
   */
  async subscribe(email: string) {
    const { data, error } = await this.db
      .from('newsletter_subscribers')
      .upsert(
        {
          email,
          is_active: false,
          subscribed_at: new Date().toISOString(),
        },
        { onConflict: 'email', ignoreDuplicates: true },
      )
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (data) return this.map(data);

    const { data: existing, error: findError } = await this.db
      .from('newsletter_subscribers')
      .select('*')
      .ilike('email', email)
      .maybeSingle();
    if (findError) throw findError;
    return this.map(existing ?? { id: null, email, is_active: false, subscribed_at: new Date().toISOString() });
  }

  /** F-07 — aktivacija + dokaz saglasnosti (vreme, IP, UA). */
  async confirm(email: string, proof?: { ip?: string | null; userAgent?: string | null }): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('newsletter_subscribers')
      .update({
        is_active: true,
        confirmed_at: now,
        confirmed_ip: proof?.ip ?? null,
        confirmed_user_agent: proof?.userAgent ?? null,
        unsubscribed_at: null,
      })
      .ilike('email', email)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  async unsubscribe(email: string) {
    const { error } = await this.db
      .from('newsletter_subscribers')
      .update({ is_active: false, unsubscribed_at: new Date().toISOString() })
      .ilike('email', email);
    return !error;
  }
  async findAll() {
    const { data, error } = await this.db.from('newsletter_subscribers').select('*');
    if (error) throw error;
    return (data ?? []).map((r) => this.map(r));
  }

  /** F-18 — COUNT aktivnih pretplatnika (admin metrike). */
  async countActive(): Promise<number> {
    const { count, error } = await this.db
      .from('newsletter_subscribers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    if (error) throw error;
    return count ?? 0;
  }
}

class MemoryNotificationRepo implements NotificationRepo {
  constructor(private store: MemoryStore) {}
  async list(filter: { userId: string; unreadOnly?: boolean; limit?: number; offset?: number }) {
    const all = this.store.notifications
      .filter((n) => n.userId === filter.userId && (!filter.unreadOnly || !n.isRead))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50));
  }
  async countUnread(userId: string) {
    return this.store.notifications.filter((n) => n.userId === userId && !n.isRead).length;
  }
  async create(n: NotificationRecord) {
    this.store.notifications.push(n);
    return n;
  }
  async findById(id: string) {
    return this.store.notifications.find((n) => n.id === id) ?? null;
  }
  async markAsRead(userId: string, ids: string[]) {
    for (const n of this.store.notifications) {
      if (n.userId === userId && ids.includes(n.id)) n.isRead = true;
    }
  }
  async markAllAsRead(userId: string) {
    for (const n of this.store.notifications) {
      if (n.userId === userId) n.isRead = true;
    }
  }
  async delete(id: string) {
    const before = this.store.notifications.length;
    this.store.notifications = this.store.notifications.filter((n) => n.id !== id);
    return this.store.notifications.length < before;
  }
  /** GDPR — sve notifikacije korisnika. */
  async deleteAllForUser(userId: string) {
    const before = this.store.notifications.length;
    this.store.notifications = this.store.notifications.filter((n) => n.userId !== userId);
    return before - this.store.notifications.length;
  }
}

class MemoryReportRepo implements ReportRepo {
  constructor(private store: MemoryStore) {}
  async create(r: ReportRecord) {
    this.store.reports.push(r);
    return r;
  }
  async list(filter: { status?: string; limit?: number; offset?: number }) {
    const all = this.store.reports
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50));
  }
  async count(status?: string) {
    return this.store.reports.filter((r) => !status || r.status === status).length;
  }
  async findById(id: string) {
    return this.store.reports.find((r) => r.id === id) ?? null;
  }
  async findByReporter(reporterId: string, targetType: string, targetId: string) {
    return this.store.reports.filter(
      (r) => r.reporterId === reporterId && r.targetType === targetType && r.targetId === targetId
    );
  }
  async update(id: string, patch: Partial<ReportRecord>) {
    const idx = this.store.reports.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.store.reports[idx] = { ...this.store.reports[idx], ...patch, id };
    return this.store.reports[idx];
  }
}

class SupabaseNotificationRepo implements NotificationRepo {
  constructor(private db: SupabaseClient) {}
  async list(filter: { userId: string; unreadOnly?: boolean; limit?: number; offset?: number }) {
    let query = this.db
      .from('notifications')
      .select('*')
      .eq('user_id', filter.userId)
      .order('created_at', { ascending: false })
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50) - 1);
    if (filter.unreadOnly) query = query.eq('is_read', false);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapNotification);
  }
  async countUnread(userId: string) {
    const { count, error } = await this.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
    return count ?? 0;
  }
  async create(n: NotificationRecord) {
    // `notifications.id` je UUID na serveru baze — prefiksovani `ntf_…` id je
    // obarao insert (`invalid input syntax for type uuid`), pa notifikacije
    // nikad nisu ni stizale. Novi id je UUID, a legacy prefiksovani id se
    // izostavlja i baza dodeljuje svoj (vraćeni red nosi pravi id).
    const { data, error } = await this.db
      .from('notifications')
      .insert({
        id: asUuid(n.id) ? n.id : undefined,
        user_id: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link ?? null,
        is_read: n.isRead,
        actor_id: n.actorId ?? null,
        metadata: n.metadata ?? {},
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapNotification(data);
  }
  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data } = await this.db.from('notifications').select('*').eq('id', id).maybeSingle();
    return data ? mapNotification(data) : null;
  }
  async markAsRead(userId: string, ids: string[]) {
    const uuidIds = ids.filter(asUuid);
    if (!uuidIds.length) return;
    await this.db.from('notifications').update({ is_read: true }).eq('user_id', userId).in('id', uuidIds);
  }
  async markAllAsRead(userId: string) {
    await this.db.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
  }
  async delete(id: string) {
    const { error } = await this.db.from('notifications').delete().eq('id', id);
    return !error;
  }
  async deleteAllForUser(userId: string) {
    const user = asUuid(userId);
    if (!user) return 0;
    const { error, count } = await this.db
      .from('notifications')
      .delete({ count: 'exact' })
      .eq('user_id', user);
    if (error) throw error;
    return count ?? 0;
  }
}

class SupabaseReportRepo implements ReportRepo {
  constructor(private db: SupabaseClient) {}
  async create(r: ReportRecord) {
    const { data, error } = await this.db
      .from('reports')
      .insert({
        id: r.id,
        target_type: r.targetType,
        target_id: r.targetId,
        reporter_id: r.reporterId,
        reason: r.reason,
        status: r.status,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapReport(data);
  }
  async list(filter: { status?: string; limit?: number; offset?: number }) {
    let query = this.db
      .from('reports')      .select('*')
      .order('created_at', { ascending: false })
      .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50) - 1);
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapReport);
  }
  async count(status?: string) {
    let query = this.db.from('reports').select('id', { count: 'exact', head: true });
    if (status) query = query.eq('status', status);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }
  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data } = await this.db.from('reports').select('*').eq('id', id).maybeSingle();
    return data ? mapReport(data) : null;
  }
  async findByReporter(reporterId: string, targetType: string, targetId: string) {
    const { data } = await this.db
      .from('reports')
      .select('*')
      .eq('reporter_id', reporterId)
      .eq('target_type', targetType)
      .eq('target_id', targetId);
    return (data ?? []).map(mapReport);
  }
  async update(id: string, patch: Partial<ReportRecord>) {
    const { data, error } = await this.db
      .from('reports')
      .update({
        status: patch.status,
        resolved_by: patch.resolvedBy,
        resolved_at: patch.resolvedAt,
        resolution_note: patch.resolutionNote,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapReport(data);
  }
}

function mapNotification(r: any): NotificationRecord {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title ?? '',
    message: r.message ?? '',
    link: r.link ?? undefined,
    isRead: r.is_read,
    actorId: r.actor_id ?? null,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}

class MemoryQuestRepo implements QuestRepo {
  /** Definicije kvestova — u Supabase-u dolaze iz `quests` tabele. */
  static readonly DEFS: Array<Omit<QuestRecord, 'progress' | 'completed' | 'completedAt'>> = [
    { id: 'welcome', code: 'welcome', title: 'Welcome to Nexus', description: 'Popunite profil (bio i avatar)', xpReward: 25, targetCount: 1 },
    { id: 'social_butterfly', code: 'social_butterfly', title: 'Social Butterfly', description: 'Povežite 3 gejming naloga', xpReward: 50, targetCount: 3 },
    { id: 'first_discussion', code: 'first_discussion', title: 'First Discussion', description: 'Kreirajte prvu temu', xpReward: 20, targetCount: 1 },
    { id: 'voice_of_reason', code: 'voice_of_reason', title: 'Voice of Reason', description: 'Odgovorite u 10 različitih tema', xpReward: 100, targetCount: 10 },
  ];

  constructor(private store: MemoryStore) {}

  async listForUser(userId: string): Promise<QuestRecord[]> {
    return MemoryQuestRepo.DEFS.map((quest) => {
      const state = this.store.questProgress.get(`${userId}:${quest.code}`);
      return {
        ...quest,
        progress: state?.progress ?? 0,
        completed: state?.completed ?? false,
        completedAt: state?.completedAt ?? null,
      };
    });
  }

  async advance(userId: string, code: string, amount = 1): Promise<QuestAdvanceResult | null> {
    const quest = MemoryQuestRepo.DEFS.find((q) => q.code === code);
    if (!quest) return null;

    const key = `${userId}:${code}`;
    const state = this.store.questProgress.get(key) ?? { progress: 0, completed: false };
    const alreadyCompleted = state.completed;
    const progress = Math.min(state.progress + amount, quest.targetCount);
    const completed = alreadyCompleted || progress >= quest.targetCount;

    this.store.questProgress.set(key, {
      progress,
      completed,
      completedAt: completed ? state.completedAt ?? new Date().toISOString() : undefined,
    });

    return { code, progress, completed, alreadyCompleted };
  }
}

class SupabaseQuestRepo implements QuestRepo {
  constructor(private db: SupabaseClient) {}

  async listForUser(userId: string): Promise<QuestRecord[]> {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const [{ data: quests, error }, { data: progress }] = await Promise.all([
      this.db.from('quests').select('id, code, title, description, xp_reward, target_count').eq('is_active', true),
      this.db.from('user_quests').select('quest_id, progress, completed, completed_at').eq('user_id', uuid),
    ]);
    if (error) throw error;

    const byQuest = new Map((progress ?? []).map((row: any) => [row.quest_id, row]));
    return (quests ?? []).map((q: any) => {
      const state: any = byQuest.get(q.id);
      return {
        id: q.id,
        code: q.code,
        title: q.title,
        description: q.description ?? '',
        xpReward: q.xp_reward ?? 0,
        targetCount: q.target_count ?? 1,
        progress: state?.progress ?? 0,
        completed: state?.completed ?? false,
        completedAt: state?.completed_at ?? null,
      };
    });
  }

  async advance(userId: string, code: string, amount = 1): Promise<QuestAdvanceResult | null> {
    const uuid = asUuid(userId);
    if (!uuid) return null;

    // Atomica u bazi (schema-2.4.4 `advance_quest`); ako RPC ne postoji,
    // fallback je read-modify-write koji je dovoljan za jednu instancu.
    const { data, error } = await this.db.rpc('advance_quest', {
      p_user_id: uuid,
      p_code: code,
      p_amount: amount,
    });
    if (!error && Array.isArray(data) && data[0]) {
      const row: any = data[0];
      const quest = MemoryQuestRepo.DEFS.find((q) => q.code === code);
      const alreadyCompleted = Boolean(quest && row.completed && row.progress >= quest.targetCount && row.progress - amount >= quest.targetCount);
      return { code, progress: row.progress, completed: row.completed, alreadyCompleted };
    }

    const { data: quest } = await this.db
      .from('quests')
      .select('id, target_count')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle();
    if (!quest) return null;

    const { data: existing } = await this.db
      .from('user_quests')
      .select('progress, completed')
      .eq('user_id', uuid)
      .eq('quest_id', quest.id)
      .maybeSingle();

    const alreadyCompleted = existing?.completed ?? false;
    const progress = Math.min((existing?.progress ?? 0) + amount, quest.target_count ?? 1);
    const completed = alreadyCompleted || progress >= (quest.target_count ?? 1);

    await this.db.from('user_quests').upsert(
      {
        user_id: uuid,
        quest_id: quest.id,
        progress,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,quest_id' },
    );

    return { code, progress, completed, alreadyCompleted };
  }
}

class MemoryBookmarkRepo implements BookmarkRepo {
  constructor(private store: MemoryStore) {}

  async add(userId: string, kind: 'article' | 'thread', targetId: string) {
    const exists = this.store.bookmarks.some((b) => b.userId === userId && b.target === targetId && b.kind === kind);
    if (!exists) this.store.bookmarks.push({ userId, target: targetId, kind });
  }
  async remove(userId: string, kind: 'article' | 'thread', targetId: string) {
    this.store.bookmarks = this.store.bookmarks.filter(
      (b) => !(b.userId === userId && b.target === targetId && b.kind === kind),
    );
  }
  async list(userId: string, kind?: 'article' | 'thread') {
    return this.store.bookmarks
      .filter((b) => b.userId === userId && (!kind || b.kind === kind))
      .map((b) => ({ kind: b.kind, targetId: b.target, createdAt: new Date().toISOString() }));
  }
  async isBookmarked(userId: string, kind: 'article' | 'thread', targetId: string) {
    return this.store.bookmarks.some((b) => b.userId === userId && b.target === targetId && b.kind === kind);
  }
  /** GDPR — svi sačuvani članci/teme korisnika. */
  async removeAllForUser(userId: string) {
    const before = this.store.bookmarks.length;
    this.store.bookmarks = this.store.bookmarks.filter((b) => b.userId !== userId);
    return before - this.store.bookmarks.length;
  }
}

// =====================
// DM — Supabase implementacija (2.11.0)
// =====================
class SupabaseDmRepo implements DmRepo {
  constructor(private db: SupabaseClient) {}

  /** Isti redosled kao SQL `CHECK (user_low < user_high)` — par mora biti kanonski. */
  private pair(a: string, b: string): [string, string] {
    return a <= b ? [a, b] : [b, a];
  }

  private mapConversation(row: any): DmConversationRecord {
    return {
      id: row.id,
      userLow: row.user_low,
      userHigh: row.user_high,
      lastMessageAt: row.last_message_at ?? null,
      createdAt: row.created_at,
    };
  }

  private mapMessage(row: any): DirectMessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      content: row.content,
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
    };
  }

  async findOrCreateConversation(userA: string, userB: string) {
    const [low, high] = this.pair(userA, userB);
    const { data: existing, error: findError } = await this.db
      .from('dm_conversations')
      .select('*')
      .eq('user_low', low)
      .eq('user_high', high)
      .maybeSingle();
    if (findError) throw findError;
    if (existing) return this.mapConversation(existing);

    // Upsert u jednu naredbu: paralelna dva prva poruka ne prave duplikat
    // (UNIQUE par) — `ignoreDuplicates` vraća postojeći red bez greške.
    const { data, error } = await this.db
      .from('dm_conversations')
      .upsert(
        { user_low: low, user_high: high },
        { onConflict: 'user_low,user_high', ignoreDuplicates: false },
      )
      .select('*')
      .single();
    if (error) throw error;
    return this.mapConversation(data);
  }

  async findConversation(id: string) {
    const uuid = asUuid(id);
    if (!uuid) return null;
    const { data, error } = await this.db.from('dm_conversations').select('*').eq('id', uuid).maybeSingle();
    if (error) throw error;
    return data ? this.mapConversation(data) : null;
  }

  async listConversations(userId: string): Promise<DmConversationView[]> {
    const uuid = asUuid(userId);
    if (!uuid) return [];

    const { data, error } = await this.db
      .from('dm_conversations')
      .select('*')
      .or(`user_low.eq.${uuid},user_high.eq.${uuid}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100);
    if (error) throw error;

    const conversations = (data ?? []).map((row: any) => this.mapConversation(row));
    if (conversations.length === 0) return [];

    const partnerIds = [...new Set(conversations.map((c) => (c.userLow === userId ? c.userHigh : c.userLow)))];
    const { data: partners } = await this.db
      .from('users')
      .select('id, username, avatar')
      .in('id', partnerIds);
    const partnerById = new Map((partners ?? []).map((u: any) => [u.id, u]));

    // Poslednja poruka + nepročitane: jedan upit po razgovoru je prihvatljiv
    // (lista je ograničena na 100), a izbegava N+1 nad podacima za koje
    // Supabase ne daje GROUP BY kroz REST.
    return Promise.all(
      conversations.map(async (conversation) => {
        const { data: lastRows } = await this.db
          .from('direct_messages')
          .select('*')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(1);
        const last = lastRows?.[0] ? this.mapMessage(lastRows[0]) : null;

        const partnerId = conversation.userLow === userId ? conversation.userHigh : conversation.userLow;
        const partner = partnerById.get(partnerId);
        const { count } = await this.db
          .from('direct_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conversation.id)
          .neq('sender_id', uuid)
          .is('read_at', null);

        return {
          id: conversation.id,
          partnerId,
          partnerUsername: partner?.username ?? '',
          partnerAvatar: partner?.avatar ?? '',
          lastMessage: last?.content ?? null,
          lastMessageAt: last?.createdAt ?? conversation.lastMessageAt,
          lastMessageFromMe: last ? last.senderId === userId : false,
          unreadCount: count ?? 0,
        };
      }),
    );
  }

  async listMessages(conversationId: string, opts: { limit?: number; before?: string } = {}) {
    const uuid = asUuid(conversationId);
    if (!uuid) return [];
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

    let query = this.db
      .from('direct_messages')
      .select('*')
      .eq('conversation_id', uuid)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.before) query = query.lt('created_at', opts.before);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row: any) => this.mapMessage(row)).reverse();
  }

  async createMessage(input: { conversationId: string; senderId: string; content: string }) {
    const conversationId = asUuid(input.conversationId);
    const senderId = asUuid(input.senderId);
    if (!conversationId || !senderId) throw new Error('DM zahteva validan razgovor i pošiljaoca.');

    const { data, error } = await this.db
      .from('direct_messages')
      .insert({ conversation_id: conversationId, sender_id: senderId, content: input.content })
      .select('*')
      .single();
    if (error) throw error;

    await this.db
      .from('dm_conversations')
      .update({ last_message_at: data.created_at })
      .eq('id', conversationId);

    return this.mapMessage(data);
  }

  async markRead(conversationId: string, readerId: string) {
    const uuid = asUuid(conversationId);
    const reader = asUuid(readerId);
    if (!uuid || !reader) return 0;
    const { data, error } = await this.db
      .from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', uuid)
      .neq('sender_id', reader)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async countUnread(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return 0;
    const { data: conversations, error } = await this.db
      .from('dm_conversations')
      .select('id')
      .or(`user_low.eq.${uuid},user_high.eq.${uuid}`);
    if (error) throw error;
    const ids = (conversations ?? []).map((c: any) => c.id);
    if (ids.length === 0) return 0;

    const { count } = await this.db
      .from('direct_messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', ids)
      .neq('sender_id', uuid)
      .is('read_at', null);
    return count ?? 0;
  }

  async isParticipant(conversationId: string, userId: string) {
    const conversation = await this.findConversation(conversationId);
    return Boolean(conversation && (conversation.userLow === userId || conversation.userHigh === userId));
  }

  async deleteAllForUser(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return 0;
    const { data: conversations } = await this.db
      .from('dm_conversations')
      .select('id')
      .or(`user_low.eq.${uuid},user_high.eq.${uuid}`);
    const ids = (conversations ?? []).map((c: any) => c.id);
    if (ids.length === 0) return 0;

    const { data: removed, error } = await this.db
      .from('direct_messages')
      .delete({ count: 'exact' })
      .in('conversation_id', ids)
      .select('id');
    // Brisanje razgovora kaskadno briše i poruke (`ON DELETE CASCADE`).
    await this.db.from('dm_conversations').delete().in('id', ids);
    if (error) throw error;
    return removed?.length ?? 0;
  }
}

/**
 * 2.12.0 — praćenje korisnika (`user_follows`).
 * Par je UNIQUE u bazi; ovde je sve idempotentno (`upsert`/`ignoreDuplicates`).
 * Nedostajuća tabela (pre migracije) ne obara rute — čita se kao „prazno“.
 */
class SupabaseFollowRepo implements FollowRepo {
  constructor(private db: SupabaseClient) {}

  async follow(followerId: string, followingId: string): Promise<boolean> {
    const follower = asUuid(followerId);
    const following = asUuid(followingId);
    if (!follower || !following || follower === following) return false;

    // Najpre provera postojanja (jer upsert bez `ignoreDuplicates` baca na duplikatu,
    // a sa njim ne vraća da li je red nov) — nova veza vraća `true` za notifikaciju.
    const { data: existing } = await this.db
      .from('user_follows')
      .select('follower_id')
      .eq('follower_id', follower)
      .eq('following_id', following)
      .maybeSingle();
    if (existing) return false;

    const { error } = await this.db
      .from('user_follows')
      .upsert({ follower_id: follower, following_id: following }, { onConflict: 'follower_id,following_id' });
    if (error) throw error;
    return true;
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    const follower = asUuid(followerId);
    const following = asUuid(followingId);
    if (!follower || !following) return;
    const { error } = await this.db
      .from('user_follows')
      .delete()
      .eq('follower_id', follower)
      .eq('following_id', following);
    if (error) throw error;
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follower = asUuid(followerId);
    const following = asUuid(followingId);
    if (!follower || !following) return false;
    const { data, error } = await this.db
      .from('user_follows')
      .select('follower_id')
      .eq('follower_id', follower)
      .eq('following_id', following)
      .maybeSingle();
    if (error) {
      logger.debug({ err: error }, 'user_follows_table_missing');
      return false;
    }
    return Boolean(data);
  }

  private async rows(column: 'follower_id' | 'following_id', userId: string): Promise<string[]> {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const { data, error } = await this.db
      .from('user_follows')
      .select(column)
      .eq(column, uuid)
      .order('created_at', { ascending: false });
    if (error) {
      logger.debug({ err: error }, 'user_follows_table_missing');
      return [];
    }
    return (data ?? []).map((row: any) => row[column]);
  }

  async followingIds(followerId: string): Promise<string[]> {
    return this.rows('follower_id', followerId);
  }

  async followerIds(userId: string): Promise<string[]> {
    return this.rows('following_id', userId);
  }

  async counts(userId: string): Promise<{ followers: number; following: number }> {
    const uuid = asUuid(userId);
    if (!uuid) return { followers: 0, following: 0 };
    const [followers, following] = await Promise.all([
      this.db
        .from('user_follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', uuid),
      this.db
        .from('user_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', uuid),
    ]);
    return {
      followers: followers.count ?? 0,
      following: following.count ?? 0,
    };
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const uuid = asUuid(userId);
    if (!uuid) return 0;
    const { data, error } = await this.db
      .from('user_follows')
      .delete()
      .or(`follower_id.eq.${uuid},following_id.eq.${uuid}`)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }
}

class SupabaseBookmarkRepo implements BookmarkRepo {
  constructor(private db: SupabaseClient) {}

  private table(kind: 'article' | 'thread') {
    return kind === 'article' ? 'article_bookmarks' : 'forum_bookmarks';
  }
  private idColumn(kind: 'article' | 'thread') {
    return kind === 'article' ? 'article_id' : 'thread_id';
  }

  async add(userId: string, kind: 'article' | 'thread', targetId: string) {
    const user = asUuid(userId);
    const target = asUuid(targetId);
    if (!user || !target) return;
    const { error } = await this.db
      .from(this.table(kind))
      .upsert({ user_id: user, [this.idColumn(kind)]: target }, { onConflict: `user_id,${this.idColumn(kind)}` });
    if (error) throw error;
  }
  async remove(userId: string, kind: 'article' | 'thread', targetId: string) {
    const user = asUuid(userId);
    const target = asUuid(targetId);
    if (!user || !target) return;
    const { error } = await this.db
      .from(this.table(kind))
      .delete()
      .eq('user_id', user)
      .eq(this.idColumn(kind), target);
    if (error) throw error;
  }
  async list(userId: string, kind?: 'article' | 'thread') {
    const user = asUuid(userId);
    if (!user) return [];
    const kinds: Array<'article' | 'thread'> = kind ? [kind] : ['article', 'thread'];
    const results = await Promise.all(
      kinds.map(async (k) => {
        const { data, error } = await this.db
          .from(this.table(k))
          .select(`${this.idColumn(k)}, created_at`)
          .eq('user_id', user)
          .order('created_at', { ascending: false });
        if (error) {
          logger.debug({ err: error, kind: k }, 'bookmarks_table_missing');
          return [] as BookmarkRecord[];
        }
        return (data ?? []).map((row: any) => ({
          kind: k,
          targetId: row[this.idColumn(k)],
          createdAt: row.created_at,
        }));
      }),
    );
    return results.flat();
  }
  async isBookmarked(userId: string, kind: 'article' | 'thread', targetId: string) {
    const user = asUuid(userId);
    const target = asUuid(targetId);
    if (!user || !target) return false;
    const { data } = await this.db
      .from(this.table(kind))
      .select('id')
      .eq('user_id', user)
      .eq(this.idColumn(kind), target)
      .maybeSingle();
    return Boolean(data);
  }

  async removeAllForUser(userId: string) {
    const user = asUuid(userId);
    if (!user) return 0;
    let removed = 0;
    for (const kind of ['article', 'thread'] as const) {
      const { error, count } = await this.db
        .from(this.table(kind))
        .delete({ count: 'exact' })
        .eq('user_id', user);
      // Nedostajuća tabela ne sme da prekine brisanje naloga.
      if (!error) removed += count ?? 0;
    }
    return removed;
  }
}

class MemoryBlockRepo implements BlockRepo {
  constructor(private store: MemoryStore) {}
  async block(blockerId: string, blockedId: string) {
    const set = this.store.blocks.get(blockerId) ?? new Set<string>();
    set.add(blockedId);
    this.store.blocks.set(blockerId, set);
  }
  async unblock(blockerId: string, blockedId: string) {
    this.store.blocks.get(blockerId)?.delete(blockedId);
  }
  async list(blockerId: string) {
    return [...(this.store.blocks.get(blockerId) ?? new Set<string>())];
  }
  async blockedIds(blockerId: string) {
    return new Set(await this.list(blockerId));
  }
}

class SupabaseBlockRepo implements BlockRepo {
  constructor(private db: SupabaseClient) {}
  async block(blockerId: string, blockedId: string) {
    const blocker = asUuid(blockerId);
    const blocked = asUuid(blockedId);
    if (!blocker || !blocked || blocker === blocked) return;
    const { error } = await this.db
      .from('user_blocks')
      .upsert({ blocker_id: blocker, blocked_id: blocked }, { onConflict: 'blocker_id,blocked_id' });
    if (error) throw error;
  }
  async unblock(blockerId: string, blockedId: string) {
    const blocker = asUuid(blockerId);
    const blocked = asUuid(blockedId);
    if (!blocker || !blocked) return;
    const { error } = await this.db
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blocker)
      .eq('blocked_id', blocked);
    if (error) throw error;
  }
  async list(blockerId: string) {
    const blocker = asUuid(blockerId);
    if (!blocker) return [];
    const { data, error } = await this.db.from('user_blocks').select('blocked_id').eq('blocker_id', blocker);
    if (error) {
      // Tabela pre migracije 2.4.3 — ponašaj se kao da nema blokova.
      logger.debug({ err: error }, 'user_blocks_table_missing');
      return [];
    }
    return (data ?? []).map((row: any) => row.blocked_id);
  }
  async blockedIds(blockerId: string) {
    return new Set(await this.list(blockerId));
  }
}

class MemorySubscriptionRepo implements SubscriptionRepo {
  constructor(private store: MemoryStore) {}
  async follow(userId: string, threadId: string, emailOnReply = false) {
    const set = this.store.subscriptions.get(userId) ?? new Set<string>();
    set.add(threadId);
    this.store.subscriptions.set(userId, set);
    const key = `${userId}:${threadId}`;
    if (emailOnReply) this.store.subscriptionEmail.add(key);
    else this.store.subscriptionEmail.delete(key);
  }
  async unfollow(userId: string, threadId: string) {
    this.store.subscriptions.get(userId)?.delete(threadId);
    this.store.subscriptionEmail.delete(`${userId}:${threadId}`);
  }
  async isEmailOnReply(userId: string, threadId: string) {
    return this.store.subscriptionEmail.has(`${userId}:${threadId}`);
  }
  async setEmailOnReply(userId: string, threadId: string, enabled: boolean) {
    if (!this.store.subscriptions.get(userId)?.has(threadId)) return false;
    const key = `${userId}:${threadId}`;
    if (enabled) this.store.subscriptionEmail.add(key);
    else this.store.subscriptionEmail.delete(key);
    return true;
  }
  async listThreadIds(userId: string) {
    return [...(this.store.subscriptions.get(userId) ?? new Set<string>())];
  }
  async isFollowing(userId: string, threadId: string) {
    return this.store.subscriptions.get(userId)?.has(threadId) ?? false;
  }
  async followers(threadId: string) {
    const result: string[] = [];
    for (const [userId, threads] of this.store.subscriptions) {
      if (threads.has(threadId)) result.push(userId);
    }
    return result;
  }
  async emailFollowers(threadId: string) {
    return (await this.followers(threadId)).filter((userId) =>
      this.store.subscriptionEmail.has(`${userId}:${threadId}`),
    );
  }
}

class SupabaseSubscriptionRepo implements SubscriptionRepo {
  constructor(private db: SupabaseClient) {}
  async follow(userId: string, threadId: string, emailOnReply = false) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return;
    const row = emailOnReply
      ? { user_id: user, thread_id: thread, email_on_reply: true }
      : { user_id: user, thread_id: thread, email_on_reply: false };
    const { error } = await this.db
      .from('thread_subscriptions')
      .upsert(row, { onConflict: 'user_id,thread_id' });
    if (error) {
      // Kolona `email_on_reply` ne postoji dok `schema-ALL.sql` nije ponovo pušten:
      // praćenje (i otpraćenje) mora da radi i bez nje, samo bez mejla.
      // Prvi `upsert` je NULL-safe: novi red nije upisan, pa se upisuje bez kolone.
      logger.debug({ err: error }, 'thread_subscription_email_column_missing');
      const retry = await this.db
        .from('thread_subscriptions')
        .upsert({ user_id: user, thread_id: thread }, { onConflict: 'user_id,thread_id' });
      if (retry.error) throw retry.error;
    }
  }
  async isEmailOnReply(userId: string, threadId: string) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return false;
    const { data, error } = await this.db
      .from('thread_subscriptions')
      .select('email_on_reply')
      .eq('user_id', user)
      .eq('thread_id', thread)
      .maybeSingle();
    if (error) {
      logger.debug({ err: error }, 'thread_subscription_email_column_missing');
      return false;
    }
    return data?.email_on_reply === true;
  }
  async setEmailOnReply(userId: string, threadId: string, enabled: boolean) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return false;
    const { error } = await this.db
      .from('thread_subscriptions')
      .update({ email_on_reply: enabled })
      .eq('user_id', user)
      .eq('thread_id', thread);
    if (error) {
      // Stara baza: nema šta da se menja — korisniku se kaže „mejl nije uključen“,
      // a praćenje i dalje važi.
      logger.debug({ err: error }, 'thread_subscription_email_column_missing');
      return false;
    }
    return true;
  }
  async emailFollowers(threadId: string) {
    const thread = asUuid(threadId);
    if (!thread) return [];
    const { data, error } = await this.db
      .from('thread_subscriptions')
      .select('user_id')
      .eq('thread_id', thread)
      .eq('email_on_reply', true);
    if (error) {
      logger.debug({ err: error }, 'thread_subscription_email_column_missing');
      return [];
    }
    return (data ?? []).map((row: any) => row.user_id);
  }
  async unfollow(userId: string, threadId: string) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return;
    const { error } = await this.db
      .from('thread_subscriptions')
      .delete()
      .eq('user_id', user)
      .eq('thread_id', thread);
    if (error) throw error;
  }
  async listThreadIds(userId: string) {
    const user = asUuid(userId);
    if (!user) return [];
    const { data, error } = await this.db
      .from('thread_subscriptions')
      .select('thread_id')
      .eq('user_id', user);
    if (error) {
      logger.debug({ err: error }, 'thread_subscriptions_table_missing');
      return [];
    }
    return (data ?? []).map((row: any) => row.thread_id);
  }
  async isFollowing(userId: string, threadId: string) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return false;
    const { data } = await this.db
      .from('thread_subscriptions')
      .select('id')
      .eq('user_id', user)
      .eq('thread_id', thread)
      .maybeSingle();
    return Boolean(data);
  }
  async followers(threadId: string) {
    const thread = asUuid(threadId);
    if (!thread) return [];
    // Greška se propagira — ranije je `[]` značilo „tema nema pratilaca“ i
    // notifikacije su tiho nestajale kada tabela/baza zaškripi.
    const { data, error } = await this.db
      .from('thread_subscriptions')
      .select('user_id')
      .eq('thread_id', thread);
    if (error) throw error;
    return (data ?? []).map((row: any) => row.user_id);
  }
}

/** F-15 — trusted uređaji u Supabase-u; bez tabele vraća „nije trusted“ (bezbedna strana). */
class SupabaseTrustedDeviceRepo implements TrustedDeviceRepo {
  constructor(private db: SupabaseClient) {}
  async isTrusted(userId: string, deviceId: string, tokenHash: string, userAgent?: string | null) {
    const user = asUuid(userId);
    if (!user) return false;
    const { data, error } = await this.db
      .from('trusted_devices')
      .select('device_id, token_hash, expires_at')
      .eq('user_id', user)
      .eq('device_id', deviceId)
      .maybeSingle();
    if (error) {
      logger.debug({ err: error }, 'trusted_devices_table_missing');
      return false;
    }
    if (!data || data.token_hash !== tokenHash) return false;
    const now = Date.now();
    if (new Date(data.expires_at).getTime() <= now) return false;

    // Klizni rok: uspešna prijava produžava „zapamti ovaj uređaj“ na još 30 dana.
    const { error: touchError } = await this.db
      .from('trusted_devices')
      .update({
        last_used_at: new Date(now).toISOString(),
        expires_at: new Date(now + TRUSTED_DEVICE_TTL_MS).toISOString(),
        ...(userAgent ? { user_agent: userAgent.slice(0, 300) } : {}),
      })
      .eq('user_id', user)
      .eq('device_id', deviceId);
    if (touchError) logger.debug({ err: touchError }, 'trusted_device_touch_failed');
    return true;
  }
  async save(input: { userId: string; deviceId: string; tokenHash: string; userAgent?: string | null; expiresAt: string }) {
    const user = asUuid(input.userId);
    if (!user) throw new Error('Neispravan korisnik za trusted device.');
    const { error } = await this.db.from('trusted_devices').upsert(
      {
        user_id: user,
        device_id: input.deviceId,
        token_hash: input.tokenHash,
        user_agent: input.userAgent?.slice(0, 300) ?? null,
        expires_at: input.expiresAt,
      },
      { onConflict: 'user_id,device_id' },
    );
    if (error) throw error;
  }
  async list(userId: string) {
    const user = asUuid(userId);
    if (!user) return [];
    const { data, error } = await this.db
      .from('trusted_devices')
      .select('id, device_id, user_agent, created_at, expires_at, last_used_at')
      .eq('user_id', user)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) {
      logger.debug({ err: error }, 'trusted_devices_table_missing');
      return [];
    }
    return (data ?? []).map((row: any) => ({
      id: row.id,
      deviceId: row.device_id,
      userAgent: row.user_agent ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at ?? null,
    }));
  }
  async deleteByUser(userId: string) {
    const user = asUuid(userId);
    if (!user) return 0;
    const { data, error } = await this.db.from('trusted_devices').delete().eq('user_id', user).select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
  async deleteOne(userId: string, deviceId: string) {
    const user = asUuid(userId);
    if (!user) return false;
    const { data, error } = await this.db
      .from('trusted_devices')
      .delete()
      .eq('user_id', user)
      .eq('device_id', deviceId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }
}

class MemoryBanRepo implements BanRepo {
  constructor(private store: MemoryStore) {}
  async ban(record: BanRecord) {
    this.store.bans.set(record.userId, record);
  }
  async lift(userId: string) {
    this.store.bans.delete(userId);
  }
  async findActive(userId: string) {
    const record = this.store.bans.get(userId);
    if (!record) return null;
    if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
      this.store.bans.delete(userId);
      return null;
    }
    return record;
  }
  async expireOverdue() {
    const expired: string[] = [];
    for (const [userId, record] of this.store.bans) {
      if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
        expired.push(userId);
        this.store.bans.delete(userId);
      }
    }
    return expired;
  }
}

/** F-10 — upozorenje moderatora (korak PRE bana). */
export interface WarningRecord {
  id: string;
  userId: string;
  reason: string;
  targetType: string | null;
  targetId: string | null;
  issuedBy: string | null;
  expiresAt: string | null;
  acknowledgedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

export interface WarningRepo {
  /** Sva upozorenja korisnika, najnovija prva. */
  list(userId: string): Promise<WarningRecord[]>;
  /** Aktivna (nije opozvano i nije isteklo) — za baner i pravilo „3 = ban“. */
  listActive(userId: string): Promise<WarningRecord[]>;
  create(warning: WarningRecord): Promise<WarningRecord>;
  acknowledge(userId: string, id: string): Promise<WarningRecord | null>;
  revoke(id: string, revokedBy: string): Promise<WarningRecord | null>;
}

const isWarningActive = (warning: WarningRecord, now = Date.now()) =>
  !warning.revokedAt && (!warning.expiresAt || new Date(warning.expiresAt).getTime() > now);

class MemoryWarningRepo implements WarningRepo {
  private warnings: WarningRecord[] = [];
  async list(userId: string) {
    return this.warnings
      .filter((warning) => warning.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async listActive(userId: string) {
    return (await this.list(userId)).filter((warning) => isWarningActive(warning));
  }
  async create(warning: WarningRecord) {
    this.warnings.push(warning);
    return warning;
  }
  async acknowledge(userId: string, id: string) {
    const warning = this.warnings.find((item) => item.id === id && item.userId === userId);
    if (!warning) return null;
    warning.acknowledgedAt = warning.acknowledgedAt ?? new Date().toISOString();
    return warning;
  }
  async revoke(id: string, revokedBy: string) {
    const warning = this.warnings.find((item) => item.id === id);
    if (!warning) return null;
    warning.revokedAt = new Date().toISOString();
    warning.revokedBy = revokedBy;
    return warning;
  }
}

function mapWarningRow(row: any): WarningRecord {
  return {
    id: row.id,
    userId: row.user_id,
    reason: row.reason,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    issuedBy: row.issued_by ?? null,
    expiresAt: row.expires_at ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokedBy: row.revoked_by ?? null,
    createdAt: row.created_at,
  };
}

class SupabaseWarningRepo implements WarningRepo {
  constructor(private db: SupabaseClient) {}
  async list(userId: string) {
    if (!asUuid(userId)) return [];
    const { data, error } = await this.db
      .from('user_warnings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map(mapWarningRow);
  }
  async listActive(userId: string) {
    return (await this.list(userId)).filter((warning) => isWarningActive(warning));
  }
  async create(warning: WarningRecord) {
    const { data, error } = await this.db
      .from('user_warnings')
      .insert({
        user_id: warning.userId,
        issued_by: warning.issuedBy,
        reason: warning.reason,
        target_type: warning.targetType,
        target_id: warning.targetId,
        expires_at: warning.expiresAt,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapWarningRow(data);
  }
  async acknowledge(userId: string, id: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db
      .from('user_warnings')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('acknowledged_at', null)
      .select('*')
      .maybeSingle();
    if (error || !data) return null;
    return mapWarningRow(data);
  }
  async revoke(id: string, revokedBy: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db
      .from('user_warnings')
      .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error || !data) return null;
    return mapWarningRow(data);
  }
}

class SupabaseBanRepo implements BanRepo {
  constructor(private db: SupabaseClient) {}
  async ban(record: BanRecord) {
    const userId = asUuid(record.userId);
    if (!userId) return;
    const { error } = await this.db.from('bans').upsert(
      {
        user_id: userId,
        banned_by: asUuid(record.bannedBy ?? null),
        reason: record.reason,
        expires_at: record.expiresAt,
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      logger.debug({ err: error }, 'bans_table_missing');
      throw error;
    }
  }
  async lift(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return;
    await this.db.from('bans').delete().eq('user_id', uuid);
  }
  async findActive(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return null;
    // Greška se PROPAGIRA (nema fail-open): pozivaoci razlikuju `null`
    // (nema bana) od „ne mogu da proverim“ (tabela nedostaje / baza je pala).
    const { data, error } = await this.db.from('bans').select('*').eq('user_id', uuid).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
    return {
      userId: data.user_id,
      reason: data.reason,
      expiresAt: data.expires_at ?? null,
      bannedBy: data.banned_by ?? null,
      createdAt: data.created_at,
    };
  }
  async expireOverdue() {
    const { data, error } = await this.db
      .from('bans')
      .select('user_id')
      .not('expires_at', 'is', null)
      .lte('expires_at', new Date().toISOString());
    if (error || !data?.length) return [];
    const ids = data.map((row: any) => row.user_id);
    await this.db.from('bans').delete().in('user_id', ids);
    return ids;
  }
}

// =====================
// F-32 — SESIJE (HttpOnly refresh, rotacija)
// =====================
class MemorySessionRepo implements RefreshSessionRepo {
  /** B-01 — disk u razvoju (vidi `memoryPersistenceEnabled`), da detekcija krađe preživi restart. */
  private readonly persist: boolean;
  private persistErrorLogged = false;

  constructor(private store: MemoryStore) {
    this.persist = memoryPersistenceEnabled();
    // Restart u razvoju: servo prethodne sesije pre prvog zahteva.
    if (this.persist) this.hydrate();
  }

  private filePath(): string {
    const dir = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), '.data');
    return path.join(dir, 'sessions.json');
  }

  private hydrate(): void {
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf8');
      const rows = JSON.parse(raw) as Array<RefreshSessionRecord & { tokenHash: string }>;
      if (Array.isArray(rows)) this.store.sessions = rows.filter((r) => r && r.tokenHash && r.id);
    } catch {
      // Nema fajla ili je oštećen — krećemo sa praznim setom (bezbedno).
    }
  }

  /** Atomski upis celog seta sesija; greška ne sme da obori rotaciju u RAM-u. */
  private flush(): void {
    if (!this.persist) return;
    try {
      const file = this.filePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.store.sessions), 'utf8');
      fs.renameSync(tmp, file);
    } catch (error) {
      if (!this.persistErrorLogged) {
        this.persistErrorLogged = true;
        logger.warn({ err: error }, 'session_persist_failed');
      }
    }
  }

  async create(record: RefreshSessionRecord, tokenHash: string) {
    this.store.sessions.push({ ...record, tokenHash });
    this.flush();
  }

  async findByTokenHash(tokenHash: string) {
    const row = this.store.sessions.find((s) => s.tokenHash === tokenHash);
    return row ? { ...row } : null;
  }

  async rotate(oldId: string, next: RefreshSessionRecord, tokenHash: string) {
    const old = this.store.sessions.find((s) => s.id === oldId);
    // Uslovna rotacija: već iskorišćen token ne sme dvaput da proizvede sesiju.
    if (!old || old.rotatedAt || old.revokedAt) throw new Error('refresh_already_rotated');
    old.rotatedAt = new Date().toISOString();
    old.lastUsedAt = old.rotatedAt;
    this.store.sessions.push({ ...next, tokenHash });
    this.flush();
  }

  async revoke(id: string, reason: string) {
    const row = this.store.sessions.find((s) => s.id === id);
    if (row && !row.revokedAt) {
      row.revokedAt = new Date().toISOString();
      row.revokedReason = reason;
      this.flush();
    }
  }

  async revokeFamily(familyId: string, reason: string) {
    const at = new Date().toISOString();
    for (const row of this.store.sessions) {
      if (row.familyId === familyId && !row.revokedAt) {
        row.revokedAt = at;
        row.revokedReason = reason;
      }
    }
    this.flush();
  }

  async revokeAllForUser(userId: string, reason: string) {
    const at = new Date().toISOString();
    for (const row of this.store.sessions) {
      if (row.userId === userId && !row.revokedAt) {
        row.revokedAt = at;
        row.revokedReason = reason;
      }
    }
    this.flush();
  }

  /**
   * 5.1 — po jedna (najsvežija) živa sesija po porodici. Rotacija ostavlja stare
   * redove sa `rotatedAt`, ali porodica je jedna; glava je red koji nije ni
   * rotiran ni opozvan niti istekao.
   */
  async listActiveForUser(userId: string) {
    const now = Date.now();
    const byFamily = new Map<string, RefreshSessionRecord & { tokenHash: string }>();
    for (const row of this.store.sessions) {
      if (row.userId !== userId) continue;
      if (row.revokedAt || row.rotatedAt) continue;
      if (new Date(row.expiresAt).getTime() <= now) continue;
      const existing = byFamily.get(row.familyId);
      if (!existing || new Date(row.createdAt) > new Date(existing.createdAt)) {
        byFamily.set(row.familyId, row);
      }
    }
    return [...byFamily.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((row) => ({ ...row }));
  }

  async revokeFamilyForUser(userId: string, familyId: string, reason: string) {
    let found = false;
    const at = new Date().toISOString();
    for (const row of this.store.sessions) {
      if (row.userId === userId && row.familyId === familyId) {
        found = true;
        if (!row.revokedAt) {
          row.revokedAt = at;
          row.revokedReason = reason;
        }
      }
    }
    if (found) this.flush();
    return found;
  }

  async deleteExpired(now: string) {
    const before = this.store.sessions.length;
    this.store.sessions = this.store.sessions.filter((s) => new Date(s.expiresAt).getTime() > new Date(now).getTime());
    if (before !== this.store.sessions.length) this.flush();
    return before - this.store.sessions.length;
  }
}

class SupabaseSessionRepo implements RefreshSessionRepo {
  constructor(private db: SupabaseClient) {}

  private map(row: any): RefreshSessionRecord {
    return {
      id: row.id,
      userId: row.user_id,
      familyId: row.family_id,
      expiresAt: row.expires_at,
      userAgent: row.user_agent ?? null,
      ip: row.ip ?? null,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? null,
      rotatedAt: row.rotated_at ?? null,
      revokedAt: row.revoked_at ?? null,
      revokedReason: row.revoked_reason ?? null,
    };
  }

  private row(record: RefreshSessionRecord, tokenHash: string) {
    return {
      id: record.id,
      user_id: asUuid(record.userId),
      family_id: record.familyId,
      token_hash: tokenHash,
      expires_at: record.expiresAt,
      user_agent: record.userAgent,
      ip: record.ip,
      created_at: record.createdAt,
    };
  }

  async create(record: RefreshSessionRecord, tokenHash: string) {
    const { error } = await this.db.from('auth_sessions').insert(this.row(record, tokenHash));
    if (error) throw error;
  }

  async findByTokenHash(tokenHash: string) {
    const { data, error } = await this.db
      .from('auth_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  async rotate(oldId: string, next: RefreshSessionRecord, tokenHash: string) {
    const now = new Date().toISOString();
    // Uslovni update: samo neiskorišćen i neopozvan red može da se rotira.
    const { data, error } = await this.db
      .from('auth_sessions')
      .update({ rotated_at: now, last_used_at: now })
      .eq('id', oldId)
      .is('rotated_at', null)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('refresh_already_rotated');

    const { error: insertError } = await this.db.from('auth_sessions').insert(this.row(next, tokenHash));
    if (insertError) throw insertError;
  }

  async revoke(id: string, reason: string) {
    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('id', id)
      .is('revoked_at', null);
    if (error) throw error;
  }

  async revokeFamily(familyId: string, reason: string) {
    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('family_id', familyId)
      .is('revoked_at', null);
    if (error) throw error;
  }

  async revokeAllForUser(userId: string, reason: string) {
    const uuid = asUuid(userId);
    if (!uuid) return;
    const { error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('user_id', uuid)
      .is('revoked_at', null);
    if (error) throw error;
  }

  /** 5.1 — žive sesije (nije rotirana/opozvana/istekla), filtrirane po porodici u JS-u. */
  async listActiveForUser(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('auth_sessions')
      .select('*')
      .eq('user_id', uuid)
      .is('revoked_at', null)
      .is('rotated_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const seen = new Set<string>();
    const rows: Array<RefreshSessionRecord & { tokenHash: string }> = [];
    for (const row of data ?? []) {
      if (seen.has(row.family_id)) continue;
      seen.add(row.family_id);
      rows.push({ ...this.map(row), tokenHash: row.token_hash });
    }
    return rows;
  }

  async revokeFamilyForUser(userId: string, familyId: string, reason: string) {
    const uuid = asUuid(userId);
    if (!uuid) return false;
    const { data, error } = await this.db
      .from('auth_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq('user_id', uuid)
      .eq('family_id', familyId)
      .select('id');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async deleteExpired(now: string) {
    const { data, error } = await this.db
      .from('auth_sessions')
      .delete()
      .lt('expires_at', now)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }
}

// =====================
// F-34 — OAUTH IDENTITETI
// =====================
class MemoryOAuthRepo implements OAuthRepo {
  constructor(private store: MemoryStore) {}

  async findByProvider(provider: string, providerUserId: string) {
    return (
      this.store.oauth.find((row) => row.provider === provider && row.providerUserId === providerUserId) ?? null
    );
  }

  async listForUser(userId: string) {
    return this.store.oauth.filter((row) => row.userId === userId);
  }

  async link(record: OAuthIdentityRecord) {
    this.store.oauth = this.store.oauth.filter(
      (row) => !(row.provider === record.provider && row.providerUserId === record.providerUserId),
    );
    this.store.oauth.push({ ...record });
  }

  async unlink(userId: string, provider: string) {
    const before = this.store.oauth.length;
    this.store.oauth = this.store.oauth.filter((row) => !(row.userId === userId && row.provider === provider));
    return this.store.oauth.length < before;
  }

  async touch(provider: string, providerUserId: string) {
    const row = this.store.oauth.find(
      (entry) => entry.provider === provider && entry.providerUserId === providerUserId,
    );
    if (row) row.lastLoginAt = new Date().toISOString();
  }
}

class SupabaseOAuthRepo implements OAuthRepo {
  constructor(private db: SupabaseClient) {}

  private map(row: any): OAuthIdentityRecord {
    return {
      provider: row.provider,
      providerUserId: row.provider_user_id,
      providerUsername: row.provider_username ?? null,
      userId: row.user_id,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
    };
  }

  async findByProvider(provider: string, providerUserId: string) {
    const { data, error } = await this.db
      .from('oauth_accounts')
      .select('*')
      .eq('provider', provider)
      .eq('provider_user_id', providerUserId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.map(data) : null;
  }

  async listForUser(userId: string) {
    const uuid = asUuid(userId);
    if (!uuid) return [];
    const { data, error } = await this.db.from('oauth_accounts').select('*').eq('user_id', uuid);
    if (error) throw error;
    return (data ?? []).map((row: any) => this.map(row));
  }

  async link(record: OAuthIdentityRecord) {
    const uuid = asUuid(record.userId);
    if (!uuid) return;
    const { error } = await this.db.from('oauth_accounts').upsert(
      {
        user_id: uuid,
        provider: record.provider,
        provider_user_id: record.providerUserId,
        provider_username: record.providerUsername,
        last_login_at: record.lastLoginAt ?? new Date().toISOString(),
      },
      { onConflict: 'provider,provider_user_id' },
    );
    if (error) throw error;
  }

  async unlink(userId: string, provider: string) {
    const uuid = asUuid(userId);
    if (!uuid) return false;
    const { data, error } = await this.db
      .from('oauth_accounts')
      .delete()
      .eq('user_id', uuid)
      .eq('provider', provider)
      .select('id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async touch(provider: string, providerUserId: string) {
    const { error } = await this.db
      .from('oauth_accounts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('provider', provider)
      .eq('provider_user_id', providerUserId);
    if (error) throw error;
  }
}

function mapReport(r: any): ReportRecord {
  return {
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reporterId: r.reporter_id,
    reason: r.reason,
    status: r.status,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolutionNote: r.resolution_note ?? null,
    createdAt: r.created_at,
  };
}

// =====================
// 2.6.0 — DEALS (Supabase)
// =====================

/** Kolone koje se čitaju umesto `select('*')` — deterministički shape za `mapDealRow`. */
const DEAL_COLUMNS = [
  'id', 'author_id', 'game_id', 'title', 'url', 'proof_url', 'price', 'original_price',
  'discount_pct', 'currency', 'store', 'platform', 'description', 'expires_at', 'status',
  'is_verified', 'score', 'created_at', 'updated_at',
].join(', ');

function mapGameRow(row: any): GameRecord {
  return {
    id: row.id,
    slug: row.slug ?? '',
    title: row.title ?? '',
    coverUrl: row.cover_url ?? null,
    releaseDate: row.release_date ?? null,
    igdbId: typeof row.igdb_id === 'number' ? row.igdb_id : null,
    createdAt: row.created_at,
  };
}

function mapDealRow(row: any): DealRecord {
  const price = Number(row.price ?? 0);
  const originalPrice = Number(row.original_price ?? 0);
  return {
    id: row.id,
    authorId: row.author_id,
    author: '',
    gameId: row.game_id ?? null,
    gameSlug: null,
    gameTitle: null,
    gameCover: null,
    title: row.title,
    url: row.url,
    proofUrl: row.proof_url ?? null,
    price,
    originalPrice,
    // Pre schema-2.6.0 nema generated kolone — isti izraz računamo i ovde.
    discountPct: typeof row.discount_pct === 'number' ? row.discount_pct : computeDiscountPct(price, originalPrice),
    currency: row.currency ?? 'EUR',
    store: row.store ?? '',
    platform: row.platform ?? 'pc',
    description: row.description ?? null,
    expiresAt: row.expires_at ?? null,
    status: row.status ?? 'active',
    isVerified: row.is_verified ?? false,
    score: row.score ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

class SupabaseGameRepo implements GameRepo {
  constructor(private db: SupabaseClient) {}

  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db.from('games').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapGameRow(data) : null;
  }

  async findBySlug(slug: string) {
    const { data, error } = await this.db.from('games').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data ? mapGameRow(data) : null;
  }

  async search(query: string, limit = 10) {
    const term = String(query ?? '').trim();
    let q = this.db.from('games').select('*').order('title', { ascending: true }).limit(Math.min(limit, 50));
    if (term) {
      // PostgREST: vrednost se escape-uje pre `ilike` (wildcards iz unosa nisu pattern).
      q = q.ilike('title', `%${term.replace(/[%_\\]/g, '\\$&')}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapGameRow);
  }

  async upsert(game: Omit<GameRecord, 'id' | 'createdAt'> & { id?: string }) {
    const existing = await this.findBySlug(game.slug);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.coverUrl && game.coverUrl) patch.cover_url = game.coverUrl;
      if (!existing.releaseDate && game.releaseDate) patch.release_date = game.releaseDate;
      if (existing.igdbId == null && game.igdbId != null) patch.igdb_id = game.igdbId;
      if (!Object.keys(patch).length) return existing;
      const { data, error } = await this.db.from('games').update(patch).eq('id', existing.id).select('*').single();
      if (error) throw error;
      return mapGameRow(data);
    }

    const { data, error } = await this.db
      .from('games')
      .insert({
        slug: game.slug,
        title: game.title,
        cover_url: game.coverUrl ?? null,
        release_date: game.releaseDate ?? null,
        igdb_id: game.igdbId ?? null,
      })
      .select('*')
      .single();
    if (error) {
      // Paralelni upis iste igre (UNIQUE slug) — vrati postojeću umesto 500.
      if (/duplicate key/i.test(error.message)) {
        const raced = await this.findBySlug(game.slug);
        if (raced) return raced;
      }
      throw error;
    }
    return mapGameRow(data);
  }

  async setCover(id: string, coverUrl: string) {
    if (!asUuid(id)) {
      // Memory ID (bez uuid-a) u Supabase režimu ne postoji.
      return null;
    }
    const { data, error } = await this.db
      .from('games')
      .update({ cover_url: coverUrl })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapGameRow(data) : null;
  }

  async listWithDeals(limit = 50) {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('deals')
      .select('game_id')
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .not('game_id', 'is', null)
      .limit(5000);
    if (error) throw error;

    const counts = new Map<string, number>();
    (data ?? []).forEach((row: any) => counts.set(row.game_id, (counts.get(row.game_id) ?? 0) + 1));
    const ids = [...counts.keys()].filter(asUuid);
    if (!ids.length) return [];

    const { data: games, error: gamesError } = await this.db.from('games').select('*').in('id', ids);
    if (gamesError) throw gamesError;
    return (games ?? [])
      .map((row: any) => ({ ...mapGameRow(row), activeDeals: counts.get(row.id) ?? 0 }))
      .sort((a, b) => b.activeDeals - a.activeDeals || a.title.localeCompare(b.title))
      .slice(0, limit);
  }
}

/** Red `game_guides` → `GuideRecord` (snake_case → camelCase). */
function mapGuideRow(row: any): GuideRecord {
  return {
    id: row.id,
    gameId: row.game_id,
    authorId: row.author_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? null,
    content: row.content ?? '',
    category: row.category,
    score: row.score ?? 0,
    viewsCount: row.views_count ?? 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 2.8.0 — community vodiči (Supabase). */
class SupabaseGuideRepo implements GuideRepo {
  constructor(private db: SupabaseClient) {}

  async listByGame(
    gameId: string,
    options: { category?: string; sort?: 'top' | 'newest'; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(options.limit ?? 24, 50);
    const offset = Math.max(options.offset ?? 0, 0);
    if (!asUuid(gameId)) return { guides: [], total: 0 };

    let query = this.db
      .from('game_guides')
      .select('*', { count: 'exact' })
      .eq('game_id', gameId)
      .eq('status', 'published')
      .limit(limit)
      .range(offset, offset + limit - 1);
    if (options.category) query = query.eq('category', options.category);
    if (options.sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('score', { ascending: false }).order('created_at', { ascending: false });
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { guides: (data ?? []).map(mapGuideRow), total: count ?? data?.length ?? 0 };
  }

  async findBySlug(slug: string) {
    const { data, error } = await this.db.from('game_guides').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data ? mapGuideRow(data) : null;
  }

  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db.from('game_guides').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapGuideRow(data) : null;
  }

  async slugExists(slug: string) {
    const { data, error } = await this.db.from('game_guides').select('id').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async create(guide: GuideRecord) {
    const { data, error } = await this.db
      .from('game_guides')
      .insert({
        id: asUuid(guide.id) ? guide.id : undefined,
        game_id: guide.gameId,
        author_id: guide.authorId,
        slug: guide.slug,
        title: guide.title,
        summary: guide.summary,
        content: guide.content,
        category: guide.category,
        status: guide.status,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapGuideRow(data);
  }

  async incrementViews(id: string) {
    if (!asUuid(id)) return;
    // RPC `increment_guide_views` (migracija 24) — jedan UPDATE, bez čitanja reda.
    const { error } = await this.db.rpc('increment_guide_views', { p_guide_id: id });
    if (error) throw error;
  }

  async vote(
    userId: string,
    guideId: string,
    type: 'up' | 'down' | null,
  ) {
    if (!asUuid(guideId) || !asUuid(userId)) {
      return { changed: false, delta: 0, score: 0, myVote: null };
    }
    const { data, error } = await this.db.rpc('cast_guide_vote', {
      p_user_id: userId,
      p_guide_id: guideId,
      p_vote_type: type ?? 'null',
    });
    if (error) throw error;
    const result = data as { changed: boolean; delta: number; score: number };
    let myVote: 'up' | 'down' | null = type;
    // Kad je otkaz glasa (`null`), novi glas je uvek NULL.
    if (!type) myVote = null;
    return { changed: result.changed, delta: result.delta, score: result.score, myVote };
  }

  async myVote(userId: string | undefined, guideId: string) {
    if (!userId || !asUuid(guideId)) return null;
    const { data, error } = await this.db
      .from('guide_votes')
      .select('vote_type')
      .eq('user_id', userId)
      .eq('guide_id', guideId)
      .maybeSingle();
    if (error) throw error;
    return (data?.vote_type as 'up' | 'down') ?? null;
  }
}

// =====================
// F-7b — DNEVNA STATISTIKA PREGLEDA (`daily_views`, migracija 25-2.9.0)
// =====================
class SupabaseDailyViewsRepo implements DailyViewsRepo {
  constructor(private db: SupabaseClient) {}

  async sumByDay(from: string, to: string): Promise<Record<string, number>> {
    // Agregacija u bazi: GROUP BY view_date (indeks idx_daily_views_date).
    const { data, error } = await this.db
      .from('daily_views')
      .select('view_date, views')
      .gte('view_date', from)
      .lte('view_date', to);
    if (error) throw error;
    const byDay: Record<string, number> = {};
    for (const row of data ?? []) {
      const day = String(row.view_date).slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + Number(row.views ?? 0);
    }
    return byDay;
  }

  async topEntities(from: string, to: string, limit: number): Promise<DailyViewEntityRef[]> {
    // Grupisanje po entitetu u aplikaciji (limit redova je mali); po datumu indeksiran pristup.
    const { data, error } = await this.db
      .from('daily_views')
      .select('entity_type, entity_id, views')
      .gte('view_date', from)
      .lte('view_date', to);
    if (error) throw error;
    const perEntity = new Map<string, number>();
    for (const row of data ?? []) {
      const key = `${row.entity_type}:${row.entity_id}`;
      perEntity.set(key, (perEntity.get(key) ?? 0) + Number(row.views ?? 0));
    }
    return [...perEntity.entries()]
      .map(([key, views]) => {
        const [entityType, entityId] = key.split(':') as ['article' | 'thread', string];
        return { entityType, entityId, views };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);
  }
}

/** #5 — GG guestbook (tabele `profile_guestbook`, migracija #25). */
class SupabaseGuestbookRepo implements GuestbookRepo {
  constructor(private db: SupabaseClient) {}

  async list(profileUserId: string, limit = 50): Promise<GuestbookEntryRecord[]> {
    // Poruke sa `left join`om na autora (jedan upit, bez N+1 oblika).
    const { data, error } = await this.db
      .from('profile_guestbook')
      .select('id, profile_user_id, author_user_id, message, created_at, users!profile_guestbook_author_user_id_fkey(username, avatar)')
      .eq('profile_user_id', profileUserId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      profileUserId: row.profile_user_id,
      authorUserId: row.author_user_id,
      author: row.users?.username ?? '',
      authorAvatar: row.users?.avatar ?? undefined,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  async upsert(entry: GuestbookEntryRecord): Promise<GuestbookEntryRecord> {
    // UNIQUE(profile_user_id, author_user_id) — jedan upsert, bez race kondicije.
    const { data, error } = await this.db
      .from('profile_guestbook')
      .upsert({
        profile_user_id: entry.profileUserId,
        author_user_id: entry.authorUserId,
        message: entry.message,
      })
      .select('id, profile_user_id, author_user_id, message, created_at')
      .single();
    if (error) throw error;
    return {
      ...entry,
      id: data.id,
      message: data.message,
      createdAt: data.created_at,
    };
  }

  async remove(profileUserId: string, authorUserId: string): Promise<boolean> {
    const { error, count } = await this.db
      .from('profile_guestbook')
      .delete({ count: 'exact' })
      .eq('profile_user_id', profileUserId)
      .eq('author_user_id', authorUserId);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async listByAuthor(authorUserId: string): Promise<GuestbookEntryRecord[]> {
    const uuid = asUuid(authorUserId);
    if (!uuid) return [];
    const { data, error } = await this.db
      .from('profile_guestbook')
      .select('*')
      .eq('author_user_id', uuid);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      profileUserId: row.profile_user_id,
      authorUserId: row.author_user_id,
      author: '',
      message: row.message ?? '',
      createdAt: row.created_at,
    }));
  }

  async removeAllByAuthor(authorUserId: string): Promise<number> {
    const uuid = asUuid(authorUserId);
    if (!uuid) return 0;
    const { error, count } = await this.db
      .from('profile_guestbook')
      .delete({ count: 'exact' })
      .eq('author_user_id', uuid);
    if (error) throw error;
    return count ?? 0;
  }
}

// =====================
// 2.8.0 — GUIDES (pomoćni RPC za pregled, idempotentno dopunjen u migraciji)
// =====================

class SupabaseDealRepo implements DealRepo {
  private userCache = new Map<string, { username: string; avatar: string; role: string; isVerified?: boolean }>();
  private gameCache = new Map<string, { slug: string; title: string; coverUrl: string | null }>();

  constructor(private db: SupabaseClient) {}

  /**
   * Hydrate: baza nema join u `deals` — dohvati autore i igre u dva upita.
   * `myVote` ide jednim upitom za sve deal-ove prijavljenog korisnika.
   */
  private async hydrate(rows: any[], viewerId?: string): Promise<DealRecord[]> {
    const deals = rows.map(mapDealRow);
    if (!deals.length) return deals;

    const authorIds = [...new Set(deals.map((deal) => deal.authorId).filter(asUuid))];
    const gameIds = [...new Set(deals.map((deal) => deal.gameId).filter((id): id is string => Boolean(id && asUuid(id))))];
    const dealIds = deals.map((deal) => deal.id).filter(asUuid);

    const [authors, games, votes] = await Promise.all([
      authorIds.length
        ? this.db.from('users').select('id, username, avatar_url, role, is_verified').in('id', authorIds)
        : Promise.resolve({ data: [] as any[] }),
      gameIds.length
        ? this.db.from('games').select('id, slug, title, cover_url').in('id', gameIds)
        : Promise.resolve({ data: [] as any[] }),
      viewerId && asUuid(viewerId) && dealIds.length
        ? this.db.from('deal_votes').select('deal_id, vote_type').eq('user_id', viewerId).in('deal_id', dealIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const authorMap = new Map<string, { username: string; avatar: string; role: string; isVerified?: boolean }>();
    (authors.data ?? []).forEach((row: any) => {
      const entry = { username: row.username ?? '', avatar: row.avatar_url ?? '', role: row.role ?? 'member', isVerified: row.is_verified === true };
      this.userCache.set(row.id, entry);
      authorMap.set(row.id, entry);
    });
    const gameMap = new Map<string, { slug: string; title: string; coverUrl: string | null }>();
    (games.data ?? []).forEach((row: any) => {
      const entry = { slug: row.slug ?? '', title: row.title ?? '', coverUrl: row.cover_url ?? null };
      this.gameCache.set(row.id, entry);
      gameMap.set(row.id, entry);
    });
    const voteMap = new Map<string, 'up' | 'down'>();
    (votes.data ?? []).forEach((row: any) => voteMap.set(row.deal_id, row.vote_type));

    // F-9 — „Kupio sam“ u jednom upitu; bez migracije tabela ne postoji, pa
    // greška ovde NE sme da obori listu deal-ova (samo brojevi ostaju 0).
    const claimMap = new Map<string, number>();
    const claimedSet = new Set<string>();
    if (dealIds.length) {
      const { data: claims } = await this.db.from('deal_claims').select('deal_id, user_id').in('deal_id', dealIds);
      for (const row of (claims ?? []) as any[]) {
        claimMap.set(row.deal_id, (claimMap.get(row.deal_id) ?? 0) + 1);
        if (viewerId && row.user_id === viewerId) claimedSet.add(row.deal_id);
      }
    }

    return deals.map((deal) => {
      const author = authorMap.get(deal.authorId) ?? this.userCache.get(deal.authorId);
      const game = deal.gameId ? gameMap.get(deal.gameId) ?? this.gameCache.get(deal.gameId) : null;
      return {
        ...deal,
        author: author?.username ?? '',
        authorAvatar: author?.avatar || undefined,
        authorRole: author?.role,
        authorVerified: author?.isVerified === true,
        gameSlug: game?.slug ?? null,
        gameTitle: game?.title ?? null,
        gameCover: game?.coverUrl ?? null,
        myVote: viewerId ? voteMap.get(deal.id) ?? null : undefined,
        claimCount: claimMap.get(deal.id) ?? 0,
        myClaim: viewerId ? claimedSet.has(deal.id) : undefined,
      };
    });
  }

  async list(filter: DealFilter, viewerId?: string) {
    let q = this.db.from('deals').select(DEAL_COLUMNS, { count: 'exact' });

    if (filter.status) {
      q = q.eq('status', filter.status);
    } else if (filter.includeExpired) {
      q = q.neq('status', 'removed');
    } else {
      // Aktivno = status active I (nema roka ILI rok je u budućnosti).
      q = q.eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    }

    if (filter.authorId) q = q.eq('author_id', filter.authorId);
    if (filter.gameId) q = q.eq('game_id', filter.gameId);
    if (filter.gameSlug) {
      const { data: game } = await this.db.from('games').select('id').eq('slug', filter.gameSlug).maybeSingle();
      q = q.eq('game_id', game?.id ?? '00000000-0000-0000-0000-000000000000');
    }
    if (filter.store) q = q.ilike('store', filter.store.replace(/[%_\\]/g, '\\$&'));
    if (filter.platform) q = q.eq('platform', filter.platform.toLowerCase());
    if (typeof filter.minPrice === 'number') q = q.gte('price', filter.minPrice);
    if (typeof filter.maxPrice === 'number') q = q.lte('price', filter.maxPrice);
    if (typeof filter.minDiscount === 'number') q = q.gte('discount_pct', filter.minDiscount);

    if (filter.expiringSoon) {
      const in72h = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      q = q.not('expires_at', 'is', null).lte('expires_at', in72h);
    }

    if (filter.search) {
      // Naslov i prodavnica — PostgREST `.or` sa separatorski escape-ovanim unosom.
      const term = escapePostgrestValue(filter.search.replace(/[%_\\]/g, '\\$&'));
      q = q.or(`title.ilike.*${term}*,store.ilike.*${term}*`);
    }

    switch (filter.sort ?? 'newest') {
      case 'top':
        q = q.order('score', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'discount':
        q = q.order('discount_pct', { ascending: false }).order('score', { ascending: false });
        break;
      case 'expiring':
        q = q.order('expires_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        break;
      default:
        q = q.order('created_at', { ascending: false });
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    q = q.range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;
    return { deals: await this.hydrate(data ?? [], viewerId), total: count ?? 0 };
  }

  async findById(id: string, viewerId?: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db.from('deals').select(DEAL_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [deal] = await this.hydrate([data], viewerId);
    return deal ?? null;
  }

  async create(deal: DealRecord) {
    const { data, error } = await this.db
      .from('deals')
      .insert({
        author_id: deal.authorId,
        game_id: deal.gameId,
        title: deal.title,
        url: deal.url,
        proof_url: deal.proofUrl,
        price: deal.price,
        original_price: deal.originalPrice,
        currency: deal.currency,
        store: deal.store,
        platform: deal.platform,
        description: deal.description,
        expires_at: deal.expiresAt,
        status: deal.status,
        score: deal.score ?? 0,
      })
      .select(DEAL_COLUMNS)
      .single();
    if (error) throw error;
    const [created] = await this.hydrate([data], deal.authorId);
    return created ?? mapDealRow(data);
  }

  async update(id: string, patch: Partial<DealRecord>) {
    if (!asUuid(id)) return null;
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.url !== undefined) row.url = patch.url;
    if (patch.proofUrl !== undefined) row.proof_url = patch.proofUrl;
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.originalPrice !== undefined) row.original_price = patch.originalPrice;
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (patch.store !== undefined) row.store = patch.store;
    if (patch.platform !== undefined) row.platform = patch.platform;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
    if (patch.gameId !== undefined) row.game_id = patch.gameId;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.isVerified !== undefined) row.is_verified = patch.isVerified;

    // `discount_pct` je generated kolona — NIKAD se ne piše iz aplikacije.
    const { data, error } = await this.db.from('deals').update(row).eq('id', id).select(DEAL_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [updated] = await this.hydrate([data]);
    return updated ?? mapDealRow(data);
  }

  async remove(id: string) {
    if (!asUuid(id)) return false;
    const { error } = await this.db
      .from('deals')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  async vote(userId: string, dealId: string, type: DealVote): Promise<DealStatusResult> {
    if (!asUuid(userId) || !asUuid(dealId)) return { changed: false, delta: 0, score: 0 };

    // Atomičan RPC iz schema-2.6.0 (lock deal + upsert/delete glasa + score).
    const { data, error } = await this.db.rpc('cast_deal_vote', {
      p_user_id: userId,
      p_deal_id: dealId,
      p_vote_type: type,
    });
    if (!error && data) {
      return {
        changed: Boolean((data as any).changed),
        delta: Number((data as any).delta ?? 0),
        score: Number((data as any).score ?? 0),
      };
    }
    if (error && error.code !== 'PGRST202') {
      logger.warn({ err: error }, 'cast_deal_vote_failed');
    }

    // Fallback: uslovni upisi pod UNIQUE (deal_id, user_id) i ponovni čitanje score-a.
    const { data: existing, error: lookupError } = await this.db
      .from('deal_votes')
      .select('id, vote_type')
      .eq('user_id', userId)
      .eq('deal_id', dealId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const { data: dealRow, error: dealError } = await this.db.from('deals').select('score').eq('id', dealId).maybeSingle();
    if (dealError) throw dealError;
    if (!dealRow) return { changed: false, delta: 0, score: 0 };

    let delta = 0;
    if (existing) {
      delta -= existing.vote_type === 'up' ? 1 : -1;
      const { error: deleteError } = await this.db.from('deal_votes').delete().eq('id', existing.id);
      if (deleteError) throw deleteError;
    }
    if (type) {
      const { error: insertError } = await this.db
        .from('deal_votes')
        .insert({ deal_id: dealId, user_id: userId, vote_type: type });
      if (insertError) throw insertError;
      delta += type === 'up' ? 1 : -1;
    }

    const nextScore = Number(dealRow.score ?? 0) + delta;
    if (delta !== 0) {
      await this.db.from('deals').update({ score: nextScore }).eq('id', dealId);
    }
    return { changed: delta !== 0, delta, score: nextScore };
  }

  async expireOverdue(now = new Date().toISOString()) {
    const { data, error } = await this.db
      .from('deals')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .not('expires_at', 'is', null)
      .lte('expires_at', now)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async countActive() {
    const { count, error } = await this.db
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (error) throw error;
    return count ?? 0;
  }

  // F-9 — `deal_claims` ima UNIQUE (deal_id, user_id), pa je ponovni klik no-op.
  async claim(userId: string, dealId: string) {
    if (!asUuid(userId) || !asUuid(dealId)) return { claimed: false, count: 0 };
    const { error } = await this.db
      .from('deal_claims')
      .upsert({ deal_id: dealId, user_id: userId }, { onConflict: 'deal_id,user_id', ignoreDuplicates: true });
    // Bez migracije (42P01) oznaka se ne dobija — ruta javlja 503, a ne laže.
    if (error) return { claimed: false, count: await this.claimsFor(dealId) };
    return { claimed: true, count: await this.claimsFor(dealId) };
  }

  async unclaim(userId: string, dealId: string) {
    if (!asUuid(userId) || !asUuid(dealId)) return { claimed: false, count: 0 };
    const { error } = await this.db.from('deal_claims').delete().eq('deal_id', dealId).eq('user_id', userId);
    if (error) return { claimed: false, count: await this.claimsFor(dealId) };
    return { claimed: false, count: await this.claimsFor(dealId) };
  }

  private async claimsFor(dealId: string) {
    const { count, error } = await this.db
      .from('deal_claims')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', dealId);
    if (error) return 0;
    return count ?? 0;
  }

  async claimCounts(dealIds: string[]) {
    const ids = dealIds.filter(asUuid);
    const counts = new Map<string, number>();
    if (!ids.length) return counts;
    const { data, error } = await this.db.from('deal_claims').select('deal_id').in('deal_id', ids);
    if (error) return counts;
    for (const row of (data ?? []) as any[]) {
      counts.set(row.deal_id, (counts.get(row.deal_id) ?? 0) + 1);
    }
    return counts;
  }
}

function mapWatchRow(row: any): WatchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id ?? null,
    gameTitle: row.game_title ?? '',
    gameSlug: row.game_slug ?? null,
    targetPrice: Number(row.target_price ?? 0),
    currency: row.currency ?? 'EUR',
    createdAt: row.created_at,
    notifiedAt: row.notified_at ?? null,
  };
}

class SupabaseWatchRepo implements WatchRepo {
  constructor(private db: SupabaseClient) {}

  async list(userId: string) {
    if (!asUuid(userId)) return [];
    const { data, error } = await this.db
      .from('deal_watches')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map(mapWatchRow);
  }

  async findByGame(userId: string, gameId: string) {
    if (!asUuid(userId) || !asUuid(gameId)) return null;
    const { data, error } = await this.db
      .from('deal_watches')
      .select('*')
      .eq('user_id', userId)
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) return null;
    return data ? mapWatchRow(data) : null;
  }

  async findById(id: string) {
    if (!asUuid(id)) return null;
    const { data, error } = await this.db.from('deal_watches').select('*').eq('id', id).maybeSingle();
    if (error) return null;
    return data ? mapWatchRow(data) : null;
  }

  async create(watch: WatchRecord) {
    const { data, error } = await this.db
      .from('deal_watches')
      .insert({
        user_id: watch.userId,
        game_id: watch.gameId,
        game_title: watch.gameTitle,
        game_slug: watch.gameSlug,
        target_price: watch.targetPrice,
        currency: watch.currency,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapWatchRow(data);
  }

  async update(id: string, patch: Partial<WatchRecord>) {
    const row: Record<string, unknown> = {};
    if (patch.targetPrice !== undefined) row.target_price = patch.targetPrice;
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (patch.notifiedAt !== undefined) row.notified_at = patch.notifiedAt;
    if (!Object.keys(row).length) return this.findById(id);
    const { data, error } = await this.db.from('deal_watches').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? mapWatchRow(data) : null;
  }

  async remove(userId: string, id: string) {
    if (!asUuid(id)) return false;
    const { error } = await this.db.from('deal_watches').delete().eq('id', id).eq('user_id', userId);
    return !error;
  }

  async listByGame(gameId: string) {
    if (!asUuid(gameId)) return [];
    const { data, error } = await this.db.from('deal_watches').select('*').eq('game_id', gameId);
    if (error) return [];
    return (data ?? []).map(mapWatchRow);
  }
}

// =====================
// Bootstrap: izaberi data layer
// =====================
const memory = new MemoryStore();

const isRealSupabaseConfigured = Boolean(
  process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_KEY &&
    !isUnsetValue(process.env.SUPABASE_URL) &&
    !isUnsetValue(process.env.SUPABASE_SERVICE_KEY) &&
    !process.env.SUPABASE_URL.includes('your-project') &&
    process.env.SUPABASE_SERVICE_KEY !== 'your-service-key' &&
    process.env.SUPABASE_SERVICE_KEY.length > 20
);

let dataLayer: DataLayer;

// Testovi uvijek rade na memoriji: `server/.env` (development) može imati prave
// Supabase ključe dode, a testovi ne smeju da pišu u produkcionu bazu.
const forceMemory = process.env.NODE_ENV === 'test' && process.env.ALLOW_SUPABASE_IN_TESTS !== '1';

if (isRealSupabaseConfigured && !forceMemory) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });
  dataLayer = {
    kind: 'supabase',
    client: db,
    users: new SupabaseUserRepo(db),
    articles: new SupabaseArticleRepo(db),
    forum: new SupabaseForumRepo(db),
    newsletter: new SupabaseNewsletterRepo(db),
    notifications: new SupabaseNotificationRepo(db),
    reports: new SupabaseReportRepo(db),
    quests: new SupabaseQuestRepo(db),
    bookmarks: new SupabaseBookmarkRepo(db),
    blocks: new SupabaseBlockRepo(db),
    subscriptions: new SupabaseSubscriptionRepo(db),
    bans: new SupabaseBanRepo(db),
    warnings: new SupabaseWarningRepo(db),
    sessions: new SupabaseSessionRepo(db),
    oauth: new SupabaseOAuthRepo(db),
    games: new SupabaseGameRepo(db),
    deals: new SupabaseDealRepo(db),
    watches: new SupabaseWatchRepo(db),
    trustedDevices: new SupabaseTrustedDeviceRepo(db),
    guides: new SupabaseGuideRepo(db),
    dailyViews: new SupabaseDailyViewsRepo(db),
    guestbook: new SupabaseGuestbookRepo(db),
    dm: new SupabaseDmRepo(db),
    follows: new SupabaseFollowRepo(db),
  };
  logger.info(`Data layer: Supabase (${process.env.SUPABASE_URL})`);
} else {
  dataLayer = {
    kind: 'memory',
    users: new MemoryUserRepo(memory),
    articles: new MemoryArticleRepo(memory),
    forum: new MemoryForumRepo(memory),
    newsletter: new MemoryNewsletterRepo(memory),
    notifications: new MemoryNotificationRepo(memory),
    reports: new MemoryReportRepo(memory),
    quests: new MemoryQuestRepo(memory),
    bookmarks: new MemoryBookmarkRepo(memory),
    blocks: new MemoryBlockRepo(memory),
    subscriptions: new MemorySubscriptionRepo(memory),
    bans: new MemoryBanRepo(memory),
    warnings: new MemoryWarningRepo(),
    sessions: new MemorySessionRepo(memory),
    oauth: new MemoryOAuthRepo(memory),
    games: new MemoryGameRepo(memory),
    deals: new MemoryDealRepo(memory),
    watches: new MemoryWatchRepo(memory),
    trustedDevices: new MemoryTrustedDeviceRepo(memory),
    guides: new MemoryGuideRepo(memory),
    dailyViews: new MemoryDailyViewsRepo(),
    guestbook: new MemoryGuestbookRepo(memory),
    dm: new MemoryDmRepo(memory),
    follows: new MemoryFollowRepo(memory),
  };
  logger.warn('Data layer: in-memory demo (uneti važeći SUPABASE_SERVICE_KEY za prelazak na oblak)');
}

export const db = dataLayer;
