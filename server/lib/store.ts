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
  mutedUntil?: string | null;
  status: 'online' | 'away' | 'offline';
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
  status: 'draft' | 'published' | 'archived';
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
  type: 'reply' | 'mention' | 'upvote' | 'badge_earned' | 'quest_completed' | 'system';
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

/** Koliko XP-a je potrebno za sledeći nivo (rastuća kriva). */
export const xpForLevel = (level: number): number => Math.round(500 * Math.pow(level, 1.35));

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
  articles: ArticleRecord[] = [];
  threads: ThreadRecord[] = [];
  replies: ReplyRecord[] = [];
  newsletter: NewsletterRecord[] = [];
  votes: { userId: string; target: string; type: 'up' | 'down' }[] = [];
  bookmarks: { userId: string; target: string; kind: 'article' | 'thread' }[] = [];
  articleComments: ArticleCommentRecord[] = [];
  /** F-12 — set `${userId}:${articleId}:${type}` kao UNIQUE constraint. */
  articleReactionKeys: Set<string> = new Set();
  notifications: NotificationRecord[] = [];
  reports: ReportRecord[] = [];
  questProgress: Map<string, { progress: number; completed: boolean; completedAt?: string }> = new Map();
  blocks: Map<string, Set<string>> = new Map();
  subscriptions: Map<string, Set<string>> = new Map();
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
}

// =====================
// Supabase adapter
// ===================
export interface DataLayer {
  kind: 'supabase' | 'memory';
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
  /** F-32 — HttpOnly refresh sesije (rotacija). */
  sessions: RefreshSessionRepo;
  /** F-34 — OAuth identiteti (Discord/Google/Steam). */
  oauth: OAuthRepo;
  /** 2.6.0 — igre i popusti („Gde je najjeftiniji…"). */
  games: GameRepo;
  deals: DealRepo;
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
  findByUsername(username: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<UserRecord>;
  update(id: string, patch: Partial<UserRecord>): Promise<UserRecord | null>;
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

export interface ArticleRepo {  findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string }): Promise<ArticleRecord[]>;
  findById(id: string): Promise<ArticleRecord | null>;
  findBySlug(slug: string): Promise<ArticleRecord | null>;
  create(article: ArticleRecord): Promise<ArticleRecord>;
  update(id: string, patch: Partial<ArticleRecord>): Promise<ArticleRecord | null>;
  remove(id: string): Promise<boolean>;
  /** Pregledi — atomični inkrement (SQL UPDATE ... + 1). */
  incrementViews(id: string): Promise<void>;
  /** Direktan upit po autoru — bez skeniranja svih članaka. */
  findByAuthor(authorId: string, limit?: number): Promise<ArticleRecord[]>;
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
  /** F-18 — SUM pregleda u SQL-u (RPC `sum_thread_views`). */
  sumViews(): Promise<number>;
  findThread(id: string): Promise<ThreadRecord | null>;
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
  /** Teme jednog autora (bez skeniranja svih tema). */
  listThreadsByAuthor(authorId: string, username: string, limit?: number): Promise<ThreadRecord[]>;
  /** Odgovori jednog autora (bez skeniranja svih tema). */
  listRepliesByAuthor(authorId: string, username: string, limit?: number): Promise<ReplyRecord[]>;
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
}

export interface BlockRepo {
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  list(blockerId: string): Promise<string[]>;
  /** ID-jevi koje je korisnik blokirao — za filtriranje sadržaja. */
  blockedIds(blockerId: string): Promise<Set<string>>;
}

export interface SubscriptionRepo {
  follow(userId: string, threadId: string): Promise<void>;
  unfollow(userId: string, threadId: string): Promise<void>;
  listThreadIds(userId: string): Promise<string[]>;
  isFollowing(userId: string, threadId: string): Promise<boolean>;
  /** ID-jevi korisnika koji prate temu — za notifikacije o novim odgovorima. */
  followers(threadId: string): Promise<string[]>;
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
    this.store.users[idx] = { ...this.store.users[idx], ...patch, id };
    return this.store.users[idx];
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
  async findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string }) {
    let list = [...this.store.articles];
    if (filter?.category) list = list.filter((a) => a.category === filter.category);
    if (filter?.status) list = list.filter((a) => a.status === filter.status);
    if (filter?.featured !== undefined) list = list.filter((a) => a.isFeatured === filter.featured);
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

  async count(filter?: { status?: string }) {
    return this.store.articles.filter((a) => !filter?.status || a.status === filter.status).length;
  }

  /** F-18 — SUM pregleda (memory: u memoriji, jer nema SQL agregacije). */
  async sumViews() {
    return this.store.articles.reduce((sum, a) => sum + (a.views || 0), 0);
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
  async listThreads(filter?: {
    subforum?: string;
    sort?: 'hot' | 'new' | 'top';
    search?: string;
    limit?: number;
    offset?: number;
    cursorId?: string;
    countOnly?: boolean;
  }) {
    // Soft-deleted teme se ne prikazuju u listama (isto kao Supabase adapter).
    let list = this.store.threads.filter((t) => !t.isDeleted);
    if (filter?.subforum) list = list.filter((t) => t.subforum === filter.subforum);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q));
    }
    const sort = filter?.sort ?? 'hot';
    if (sort === 'new') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'top') list.sort((a, b) => b.karma - a.karma);
    else list.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.karma - a.karma);
    return list;
  }
  async findThread(id: string) { return this.store.threads.find((t) => t.id === id) ?? null; }
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
      level: row.level ?? 1,
      xp: row.xp ?? 0,
      xpNeeded: xpForLevel(row.level ?? 1),
      karma: row.karma ?? 0,
      badges: Array.isArray(row.badges) ? row.badges : extras.badges ?? [],
      connectedAccounts: row.connected_accounts ?? extras.connectedAccounts ?? {},
      isVerified: row.is_verified ?? false,
      isBanned: row.is_banned ?? false,
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
        level: user.level,
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
    if (patch.level !== undefined) row.level = patch.level;
    if (patch.xp !== undefined) row.xp = patch.xp;
    // Napomena: xpNeeded NIJE kolona u bazi — izvodi se iz `xpForLevel(level)`.
    if (patch.karma !== undefined) row.karma = patch.karma;
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
    };
  }
  async findAll(filter?: { category?: string; status?: string; featured?: boolean; search?: string }) {
    let q = this.db.from('articles').select('*');
    if (filter?.category) q = q.eq('category', filter.category);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.featured !== undefined) q = q.eq('is_featured', filter.featured);
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
  async create(article: ArticleRecord) {
    const { data, error } = await this.db
      .from('articles')
      .insert({
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
      })
      .select('*')
      .single();
    if (error) throw error;
    return this.map(data);
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
  async countThreads(filter?: { subforum?: string; search?: string; authorId?: string }): Promise<number> {
    let q = this.db.from('forum_threads').select('id', { count: 'exact', head: true }).eq('is_deleted', false);
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
    const { data, error } = await this.db
      .from('notifications')
      .insert({
        id: n.id,
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
  async follow(userId: string, threadId: string) {
    const set = this.store.subscriptions.get(userId) ?? new Set<string>();
    set.add(threadId);
    this.store.subscriptions.set(userId, set);
  }
  async unfollow(userId: string, threadId: string) {
    this.store.subscriptions.get(userId)?.delete(threadId);
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
}

class SupabaseSubscriptionRepo implements SubscriptionRepo {
  constructor(private db: SupabaseClient) {}
  async follow(userId: string, threadId: string) {
    const user = asUuid(userId);
    const thread = asUuid(threadId);
    if (!user || !thread) return;
    const { error } = await this.db
      .from('thread_subscriptions')
      .upsert({ user_id: user, thread_id: thread }, { onConflict: 'user_id,thread_id' });
    if (error) throw error;
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

if (isRealSupabaseConfigured) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });
  dataLayer = {
    kind: 'supabase',
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
    sessions: new SupabaseSessionRepo(db),
    oauth: new SupabaseOAuthRepo(db),
    games: new SupabaseGameRepo(db),
    deals: new SupabaseDealRepo(db),
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
    sessions: new MemorySessionRepo(memory),
    oauth: new MemoryOAuthRepo(memory),
    games: new MemoryGameRepo(memory),
    deals: new MemoryDealRepo(memory),
  };
  logger.warn('Data layer: in-memory demo (uneti važeći SUPABASE_SERVICE_KEY za prelazak na oblak)');
}

export const db = dataLayer;
