/**
 * NEXUS CONTRACTS — jedan izvor istine za oblik API podataka
 * -----------------------------------------------------------
 * N10: rute (`server/routes/*`) i frontend (`src/lib/api.ts`, stranice) ranije
 * su imali paralelne, ručno pisane tipove (`any[]`, `request<{ articles: any[] }>`),
 * pa promena polja na serveru nije pomerila TypeScript na klijentu.
 *
 * Zod šeme su već postojale u `server/lib/schemas.ts` — one validiraju **ulaz**
 * (ID-evi, `:username` parametri, query stringovi). Ovaj modul je njihov
 * produžetak: iz njih izvodi tipove (`z.infer`), a iz podataka koji izlaze iz
 * ruta izvodi export šeme. Obe strane uvoze ISTI modul:
 *
 *   server  →  import { threadResponseSchema, articleResponseSchema } from '../../contracts/index.js'
 *   klijent →  import type { Article, Thread } from '../../contracts/index'
 *
 * Modul je namerno **bez Node/DOM zavisnosti** (samo `zod`), pa ga Vite bundle-uje
 * bez problema, a server ga pokreće kao ESM (`moduleResolution: node` uz `../..`
 * putanju). Zato nije `const enum`, nema `import.meta` i nema `fs`.
 *
 * Pravilo: sva nova polja koja ruta vraća idu u ovaj modul, nikad u lokalni `any`.
 */

// JEDINA zavisnost modula je `zod`. Node ESM razrešava bare oznaku iz `contracts/`
// (nema 'node_modules' između), pa iz `server/node_modules` — server i frontend
// instaliraju ISTU verziju, a `server/tsconfig.json` mapira `zod` u `paths`.
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Zajednički osnovni tipovi                                          */
/* ------------------------------------------------------------------ */

export const userRoleSchema = z.enum(['admin', 'dev', 'moderator', 'member']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const presenceStatusSchema = z.enum(['online', 'away', 'offline']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const articleStatusSchema = z.enum(['draft', 'published', 'scheduled', 'archived']);
export type ArticleStatus = z.infer<typeof articleStatusSchema>;

/**
 * 2.10.0 — zakazani trenutak objave (`status='scheduled'`). ISO 8601 UTC.
 * `MIN_SCHEDULE_LEAD_MS` na serveru traži ≥5 min u budućnosti.
 */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

export const dealStatusSchema = z.enum(['active', 'expired', 'removed']);
export type DealStatus = z.infer<typeof dealStatusSchema>;

export const reportStatusSchema = z.enum(['pending', 'reviewing', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportTargetTypeSchema = z.enum(['thread', 'reply', 'article', 'comment', 'user', 'deal']);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const voteDirectionSchema = z.enum(['up', 'down']);
export type VoteDirection = z.infer<typeof voteDirectionSchema>;

export const notificationTypeSchema = z.enum([
  'reply',
  'mention',
  'upvote',
  'badge_earned',
  'quest_completed',
  'system',
  /** F-10 — upozorenje moderatora. */
  'warning',
  /** F-2 — dnevni loop (streak / nivo). */
  'streak',
  /** F-2 — prelazak na sledeći nivo („stigao si do novog nivoa“). */
  'level_up',
  /** F-4 — praćena cena je pala ispod praga. */
  'price_alert',
  /** #5 — nekó je ostavio GG na tvom profilu (guestbook). */
  'guestbook',
  /** 2.11.0 — nova privatna poruka (DM). */
  'dm',
  /** 2.12.0 — novi pratilac (follow). */
  'user_follow',
  /** 3.0.0 — verifikacioni bot: dobrodošlica / potvrda / podsetnik. */
  'verification',
  /** 3.0.0 — korisnik je postao ili prestao da bude staff (admin/moderator). */
  'staff',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Zod šema za ID entiteta (`thr_…`, `art_…`, UUID ili slug) — ista kao `idParamSchema`. */
export const idSchema = z.string().min(1).max(64);

/**
 * Datumi iz baze dolaze kao ISO string. Neke starije rute (seed, migracije)
 * vraćaju `null` ili odsutan ključ, pa je šema tolerantna — ali tip je i dalje
 * `string`, ne `any`.
 */
const isoDate = z.string();
const isoDateOptional = z.string().nullable().optional();

/* ------------------------------------------------------------------ */
/* Korisnici                                                          */
/* ------------------------------------------------------------------ */

/** Javni profil — `server/lib/userShape.ts` `PublicUser` + `status`/`isOnline` iz ruta. */
export const publicUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  avatar: z.string(),
  bio: z.string(),
  role: userRoleSchema,
  level: z.number(),
  xp: z.number(),
  /** Apsolutni prag sledećeg nivoa (stari ugovor — novi kod koristi `xpForNext`). */
  xpNeeded: z.number(),
  /** XP unutar tekućeg nivoa (brojilac XP trake). */
  xpIntoLevel: z.number(),
  /** Koliko XP-a tekući nivo traži ukupno (imenilac XP trake). */
  xpForNext: z.number(),
  /** Koliko još treba do sledećeg nivoa. */
  xpRemaining: z.number(),
  /** Progres unutar nivoa, 0–100. */
  levelProgress: z.number(),
  karma: z.number(),
  /** 6.x — reputacija: koliko puta je autor teme prihvatio tvoj odgovor. */
  solvedAnswers: z.number().optional(),
  badges: z.array(z.string()),
  connectedAccounts: z.record(z.string(), z.string()),
  isVerified: z.boolean(),
  status: presenceStatusSchema,
  isOnline: z.boolean().optional(),
  /** #4 — preset cover-a profila (null/odustvo = podrazumevani violet). */
  coverPreset: z.string().nullable().optional(),
  createdAt: isoDate,
  /** #2 — brojači za mini-progress zaključanih bedževa (samo GET /:username). */
  stats: z
    .object({
      threads: z.number(),
      replies: z.number(),
    })
    .optional(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Vlasnik naloga (`/auth/me`, login) — javna polja + privatna polja svog naloga. */
export const ownerUserSchema = publicUserSchema.extend({
  email: z.string(),
  isBanned: z.boolean(),
  mutedUntil: isoDateOptional,
  termsVersion: z.string().nullable().optional(),
  termsAcceptedAt: isoDateOptional,
});
export type OwnerUser = z.infer<typeof ownerUserSchema>;

/** Bedž sa datumom dodele (`user_badges.awarded_at`; `null` = nepoznat). */
export const userBadgeAwardSchema = z.object({ code: z.string(), awardedAt: isoDateOptional });
export type UserBadgeAward = z.infer<typeof userBadgeAwardSchema>;

/** #5 — GG poruka na profilu (guestbook). */
export const guestbookEntrySchema = z.object({
  id: z.string(),
  profileUserId: z.string(),
  authorUserId: z.string(),
  author: z.string(),
  authorAvatar: z.string().optional(),
  message: z.string(),
  createdAt: isoDateOptional,
});
export type GuestbookEntry = z.infer<typeof guestbookEntrySchema>;

export const guestbookResponseSchema = z.object({
  entries: z.array(guestbookEntrySchema),
});
export type GuestbookResponse = z.infer<typeof guestbookResponseSchema>;

export const connectedAccountDateSchema = z.object({
  platform: z.string(),
  connectedAt: isoDateOptional,
});
export type ConnectedAccountDate = z.infer<typeof connectedAccountDateSchema>;

/* ------------------------------------------------------------------ */
/* Privatne poruke (DM) — 2.11.0                                      */
/* ------------------------------------------------------------------ */

export const dmConversationSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  partnerUsername: z.string(),
  partnerAvatar: z.string(),
  lastMessage: z.string().nullable(),
  lastMessageAt: isoDateOptional,
  lastMessageFromMe: z.boolean(),
  unreadCount: z.number(),
});
export type DmConversation = z.infer<typeof dmConversationSchema>;

export const dmListResponseSchema = z.object({
  conversations: z.array(dmConversationSchema),
  unreadCount: z.number(),
});
export type DmListResponse = z.infer<typeof dmListResponseSchema>;

export const dmMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  content: z.string(),
  readAt: isoDateOptional,
  createdAt: isoDate,
});
export type DmMessage = z.infer<typeof dmMessageSchema>;

export const dmThreadResponseSchema = z.object({
  conversation: z.object({
    id: z.string(),
    partnerId: z.string(),
    partnerUsername: z.string(),
    partnerAvatar: z.string(),
  }),
  messages: z.array(dmMessageSchema),
  hasMore: z.boolean(),
});
export type DmThreadResponse = z.infer<typeof dmThreadResponseSchema>;

/* ------------------------------------------------------------------ */
/* Praćenje korisnika (follow) — 2.12.0                               */
/* ------------------------------------------------------------------ */

export const userFollowStatusSchema = z.object({
  following: z.boolean(),
  followers: z.number(),
  followingCount: z.number(),
});
export type UserFollowStatus = z.infer<typeof userFollowStatusSchema>;

export const userActivitySchema = z.object({
  id: z.string(),
  /** 6.x — `reply` i `solved` (prihvaćen odgovor) dopunjeni u timeline-u. */
  type: z.enum(['thread', 'reply', 'solved', 'badge', 'account']),
  text: z.string(),
  date: isoDateOptional,
});
export type UserActivity = z.infer<typeof userActivitySchema>;

export const questSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  xpReward: z.number(),
  targetCount: z.number(),
  progress: z.number(),
  completed: z.boolean(),
  completedAt: isoDateOptional,
});
export type Quest = z.infer<typeof questSchema>;

export const userLeaderboardResponseSchema = z.object({
  users: z.array(publicUserSchema),
  total: z.number(),
  sort: z.enum(['karma', 'level']),
});
export type UserLeaderboardResponse = z.infer<typeof userLeaderboardResponseSchema>;

/** `GET /api/users` (admin) — pun oblik naloga sa email-om i ban statusom. */
export const ownerUserListResponseSchema = z.object({
  users: z.array(ownerUserSchema),
  total: z.number(),
});
export type OwnerUserListResponse = z.infer<typeof ownerUserListResponseSchema>;

export const questListResponseSchema = z.object({
  quests: z.array(questSchema),
  completed: z.number(),
  total: z.number(),
});
export type QuestListResponse = z.infer<typeof questListResponseSchema>;

export const userActivityResponseSchema = z.object({ activities: z.array(userActivitySchema) });
export type UserActivityResponse = z.infer<typeof userActivityResponseSchema>;

export const blockedUserSchema = z.object({
  id: idSchema,
  username: z.string(),
  avatar: z.string(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

/* ------------------------------------------------------------------ */
/* Članci                                                             */
/* ------------------------------------------------------------------ */

export const reviewScorecardSchema = z.object({
  score: z.number().optional(),
  verdict: z.string().optional(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
});
export type ReviewScorecard = z.infer<typeof reviewScorecardSchema>;

export const articleSchema = z.object({
  id: idSchema,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  coverImage: z.string(),
  authorId: z.string(),
  author: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  status: articleStatusSchema,
  isFeatured: z.boolean(),
  views: z.number(),
  reviewScorecard: reviewScorecardSchema.nullable().optional(),
  /** `{ like, gg, hype, fire, mind_blown }` */
  reactions: z.record(z.string(), z.number()),
  publishedAt: isoDateOptional,
  createdAt: isoDate,
  updatedAt: isoDate,
  /** 2.13.0 — izvor vesti (RSS uvoz); `null` za ručno pisane članke. */
  sourceUrl: z.string().nullable().optional(),
  newsSource: z.string().nullable().optional(),
  /** 2.13.0 — grupa događaja: ista vrednost za vesti o istom događaju. */
  eventId: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  whyItMatters: z.string().nullable().optional(),
});
export type Article = z.infer<typeof articleSchema>;

/** Polja koja klijent šalje pri kreiranju/izmeni članka (`createArticleSchema`). */
export const articleInputSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  coverImage: z.string().optional(),
  status: articleStatusSchema.optional(),
  /** 2.10.0 — zakazani trenutak objave (ISO UTC); klijent šalje `toISOString()`. */
  scheduledFor: z.string().optional(),
  isFeatured: z.boolean().optional(),
  reviewScorecard: reviewScorecardSchema.nullable().optional(),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const articleCommentSchema = z.object({
  id: idSchema,
  articleId: z.string(),
  userId: z.string(),
  author: z.string(),
  authorAvatar: z.string().optional(),
  authorVerified: z.boolean().optional(),
  content: z.string(),
  parentId: z.string().nullable(),
  isEdited: z.boolean(),
  isDeleted: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ArticleComment = z.infer<typeof articleCommentSchema>;

export const articleListResponseSchema = z.object({
  articles: z.array(articleSchema),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  hasMore: z.boolean().optional(),
});
export type ArticleListResponse = z.infer<typeof articleListResponseSchema>;

export const articleResponseSchema = articleSchema;
export const articleCommentsResponseSchema = z.object({
  comments: z.array(articleCommentSchema),
  total: z.number(),
});
export type ArticleCommentsResponse = z.infer<typeof articleCommentsResponseSchema>;

/** Breaking-news traka (`GET /api/articles/ticker`). */
export const tickerItemSchema = z.object({
  id: idSchema,
  label: z.string(),
  href: z.string(),
  kind: z.enum(['article', 'thread']),
});
export type TickerItem = z.infer<typeof tickerItemSchema>;

export const articleReactionTypeSchema = z.enum(['like', 'gg', 'hype', 'fire', 'mind_blown']);
export type ArticleReactionType = z.infer<typeof articleReactionTypeSchema>;

/** `POST /api/articles/:id/reactions` — brojači posle reakcije + da li je nova. */
export const articleReactionsResponseSchema = z.object({
  reactions: z.record(z.string(), z.number()),
  added: z.boolean(),
});
export type ArticleReactionsResponse = z.infer<typeof articleReactionsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Forum                                                              */
/* ------------------------------------------------------------------ */

export const subforumSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  /** Broj tema / odgovora iz `forum_category_stats()` (fallback: nema polja). */
  threads: z.number().optional(),
  posts: z.number().optional(),
});
export type Subforum = z.infer<typeof subforumSchema>;

export const threadSortSchema = z.enum(['hot', 'new', 'top']);
export type ThreadSort = z.infer<typeof threadSortSchema>;

export const threadSchema = z.object({
  id: idSchema,
  subforum: z.string(),
  title: z.string(),
  content: z.string(),
  author: z.string(),
  authorId: z.string(),
  authorRole: z.string().nullable().optional(),
  authorLevel: z.number().nullable().optional(),
  authorVerified: z.boolean().optional(),
  authorOnline: z.boolean().optional(),
  authorStatus: presenceStatusSchema.optional(),
  authorAvatar: z.string().optional(),
  /** 6.x — tema ima prihvaćen odgovor (značka „Rešeno“ u listi). */
  solved: z.boolean().optional(),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  isLocked: z.boolean(),
  isSpoiler: z.boolean(),
  isEdited: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  karma: z.number(),
  views: z.number(),
  replies: z.number(),
  /** 2.6.6 (F-3) — deal iz kojeg je tema otvorena („Diskutuj o ovom popustu“). */
  dealId: z.string().nullable().optional(),
  /**
   * 2.11.0 — „prihvaćen odgovor“ (accepted answer). `null`/odsutan = tema nema
   * rešenje. `ThreadPage` spušta ovu vrednost do konkretne kartice odgovora.
   */
  acceptedReplyId: z.string().nullable().optional(),
  /** Kartica deal-a uz temu (samo u detalju teme). */
  linkedDeal: z
    .object({
      id: z.string(),
      title: z.string(),
      store: z.string(),
      price: z.number(),
      originalPrice: z.number(),
      currency: z.string(),
      discountPct: z.number(),
      url: z.string(),
      gameCover: z.string().nullable().optional(),
      expiresAt: isoDate.nullable().optional(),
      status: z.string().optional(),
    })
    .nullable()
    .optional(),
  createdAt: isoDate,
  lastReplyAt: isoDate,
});
export type Thread = z.infer<typeof threadSchema>;

export const replySchema = z.object({
  id: idSchema,
  threadId: z.string(),
  parentId: z.string().nullable(),
  author: z.string(),
  authorId: z.string(),
  authorRole: z.string().nullable().optional(),
  authorLevel: z.number().nullable().optional(),
  authorVerified: z.boolean().optional(),
  authorOnline: z.boolean().optional(),
  authorAvatar: z.string().optional(),
  content: z.string(),
  karma: z.number(),
  isSpoiler: z.boolean(),
  isEdited: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  createdAt: isoDate,
});
export type Reply = z.infer<typeof replySchema>;

/**
 * B25 — poruke za najčešća polja (ključ je `path[0]` issue-a), na srpskom. Zod4 bez eksplicitnog `message` vraća
 * engleski („Too small: expected string…“), pa je odgovor API-ja mešao srpski i
 * engleski. Prevod je vezan za ŠEMU (ne dira globalni locale) i mora ovde — u
 * `contracts/` — jer iste poruke prikazuje i klijent pre nego što stigne do servera.
 *
 * `server/lib/schemas.ts` koristi isti objekat kroz `zodIssueMessage()`.
 */
export const ZOD_FIELD_MESSAGES: Record<string, Record<string, string>> = {
  title: {
    too_small: 'Naslov je prekratak.',
    too_big: 'Naslov je predugačak.',
    invalid_type: 'Naslov je obavezan.',
  },
  content: {
    too_small: 'Sadržaj je prekratak.',
    too_big: 'Sadržaj je predugačak.',
    invalid_type: 'Sadržaj je obavezan.',
  },
  email: {
    invalid_format: 'Unesite ispravnu email adresu.',
    too_big: 'Email adresa je predugačka.',
    invalid_type: 'Email adresa je obavezna.',
  },
  username: {
    too_small: 'Korisničko ime mora imati najmanje 3 karaktera.',
    too_big: 'Korisničko ime može imati najviše 25 karaktera.',
    invalid_format: 'Dozvoljena su slova, brojevi, tačka, crta i donja crta.',
  },
  password: {
    too_small: 'Lozinka mora imati najmanje 8 karaktera.',
    too_big: 'Lozinka je predugačka.',
  },
};

/** Rezultat ankete (ugrađen u `GET /api/forum/threads/:id` i `…/poll/vote`). */
export const pollResultSchema = z.object({
  question: z.string(),
  options: z.array(
    z.object({
      index: z.number(),
      label: z.string(),
      votes: z.number(),
      percent: z.number(),
    }),
  ),
  totalVotes: z.number(),
  myVote: z.number().nullable(),
});
export type PollResult = z.infer<typeof pollResultSchema>;

/** Telo odgovora `GET /api/forum/threads/:id` — ista polja čita ThreadPage. */
export const threadDetailResponseSchema = z.object({
  thread: threadSchema,
  replies: z.array(replySchema),
  poll: pollResultSchema.nullable(),
});
export type ThreadDetailResponse = z.infer<typeof threadDetailResponseSchema>;

/** 2.6.6 — `POST /api/forum/:subforum/threads`: tema + XP/bedževi iz istog poziva. */
export const threadCreateResponseSchema = threadSchema.extend({
  poll: z
    .object({ question: z.string(), options: z.array(z.string()) })
    .nullable()
    .optional(),
  awarded: z
    .object({
      xp: z.number(),
      levelUp: z.boolean(),
      newBadges: z.array(z.unknown()),
    })
    .nullable()
    .optional(),
});
export type ThreadCreateResponse = z.infer<typeof threadCreateResponseSchema>;

export const threadListResponseSchema = z.object({
  threads: z.array(threadSchema),
  total: z.number(),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullable(),
});
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;

export const replyListResponseSchema = z.object({
  replies: z.array(replySchema),
  total: z.number(),
});
export type ReplyListResponse = z.infer<typeof replyListResponseSchema>;

export const categoriesResponseSchema = z.object({ categories: z.array(subforumSchema) });
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

/** `GET /api/users/:username/saved` — sačuvani članci + teme. */
export const userSavedResponseSchema = z.object({
  savedArticles: z.array(articleSchema),
  savedThreads: z.array(threadSchema),
});
export type UserSavedResponse = z.infer<typeof userSavedResponseSchema>;

/* ------------------------------------------------------------------ */
/* Deals & igre                                                       */
/* ------------------------------------------------------------------ */

export const dealSchema = z.object({
  id: idSchema,
  authorId: z.string(),
  author: z.string(),
  authorAvatar: z.string().optional(),
  authorRole: z.string().optional(),
  authorVerified: z.boolean().optional(),
  gameId: z.string().nullable(),
  gameSlug: z.string().nullable(),
  gameTitle: z.string().nullable(),
  gameCover: z.string().nullable(),
  title: z.string(),
  url: z.string(),
  proofUrl: z.string().nullable(),
  price: z.number(),
  originalPrice: z.number(),
  discountPct: z.number(),
  currency: z.string(),
  store: z.string(),
  platform: z.string(),
  description: z.string().nullable(),
  expiresAt: isoDateOptional,
  status: dealStatusSchema,
  isVerified: z.boolean(),
  score: z.number(),
  createdAt: isoDate,
  updatedAt: isoDate,
  myVote: voteDirectionSchema.nullable().optional(),
  /** F-9 — „Kupio sam“: koliko ljudi je potvrdilo kupovinu preko ovog deal-a. */
  claimCount: z.number().optional(),
  /** F-9 — da li je prijavljeni već označio „Kupio sam“ (gost: nema polja). */
  myClaim: z.boolean().optional(),
});
export type Deal = z.infer<typeof dealSchema>;

export const dealSortSchema = z.enum(['newest', 'top', 'discount', 'expiring']);
export type DealSort = z.infer<typeof dealSortSchema>;

export const dealQuerySchema = z.object({
  sort: dealSortSchema.optional(),
  game: z.string().optional(),
  gameSlug: z.string().optional(),
  store: z.string().optional(),
  platform: z.string().optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  minDiscount: z.number().optional(),
  search: z.string().optional(),
  expiringSoon: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type DealQuery = z.infer<typeof dealQuerySchema>;

export const dealListResponseSchema = z.object({
  deals: z.array(dealSchema),
  total: z.number(),
  hasMore: z.boolean(),
  sort: dealSortSchema.optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type DealListResponse = z.infer<typeof dealListResponseSchema>;

/**
 * F-1 — „Danas u gamingu“: jedan poziv (`GET /api/deals/daily`) vraća tri bloka
 * početne. Vesti zadržavaju pun `articleSchema` (kartica traži sliku/autora), a
 * „najživlje teme“ su podskup `threadSchema`-a — samo ono što lista prikazuje.
 */
export const homeThreadSchema = threadSchema.pick({
  id: true,
  subforum: true,
  title: true,
  replies: true,
  views: true,
  karma: true,
  lastReplyAt: true,
  isPinned: true,
});
export type HomeThread = z.infer<typeof homeThreadSchema>;

/* ------------------------------------------------------------------ */
/* F-4 / F-5 / F-2 / F-10 — novi ugovori (2.7.0)                      */
/* ------------------------------------------------------------------ */

/** F-4 — praćenje cene igre („obavesti me kada padne ispod…“). */
export const priceWatchSchema = z.object({
  id: z.string(),
  userId: z.string(),
  gameId: z.string().nullable(),
  gameTitle: z.string(),
  gameSlug: z.string().nullable(),
  targetPrice: z.number(),
  currency: z.string(),
  createdAt: isoDate,
  notifiedAt: isoDate.nullable(),
});
export type PriceWatch = z.infer<typeof priceWatchSchema>;

/** F-5 — jedna igra u korisničkoj listi. */
export const collectionItemSchema = z.object({
  id: z.string(),
  gameId: z.string().nullable(),
  gameTitle: z.string(),
  gameSlug: z.string().nullable(),
  gameCover: z.string().nullable(),
  note: z.string().nullable(),
  position: z.number(),
});
export type CollectionItem = z.infer<typeof collectionItemSchema>;

/** F-5 — korisnička lista igara (`/collections/:slug`, javna SEO stranica). */
export const gameCollectionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  score: z.number(),
  authorId: z.string(),
  author: z.string(),
  authorAvatar: z.string().nullable().optional(),
  items: z.array(collectionItemSchema),
  myVote: voteDirectionSchema.nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type GameCollection = z.infer<typeof gameCollectionSchema>;

/** F-2 — dnevni loop na profilu: streak, današnji XP i kvest dana. */
export const dailyLoopResponseSchema = z.object({
  /** Poslednjih 7 dana, od najstarijeg do danas (ISO datum `YYYY-MM-DD`). */
  days: z.array(z.object({ date: z.string(), active: z.boolean() })),
  streak: z.number(),
  bestStreak: z.number(),
  /** Da li je danas već zarađen bonus za prvi post. */
  firstPostToday: z.boolean(),
  /** 5.3 — da li je dnevni login bonus već uzet (prijava se računa kao aktivnost). */
  firstLoginToday: z.boolean().optional(),
  xpToday: z.number(),
  quest: z
    .object({
      code: z.string(),
      title: z.string(),
      progress: z.number(),
      target: z.number(),
      completed: z.boolean(),
    })
    .nullable(),
});
export type DailyLoopResponse = z.infer<typeof dailyLoopResponseSchema>;

/** F-10 — upozorenje moderatora pre bana. */
export const userWarningSchema = z.object({
  id: z.string(),
  userId: z.string(),
  reason: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  issuedBy: z.string().nullable(),
  issuedByName: z.string().nullable().optional(),
  expiresAt: isoDate.nullable(),
  acknowledgedAt: isoDate.nullable(),
  revokedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type UserWarning = z.infer<typeof userWarningSchema>;

export const warningListResponseSchema = z.object({
  warnings: z.array(userWarningSchema),
  activeCount: z.number(),
});
export type WarningListResponse = z.infer<typeof warningListResponseSchema>;

export const dailyFeedResponseSchema = z.object({
  /** 3 najvažnije vesti (svaka iz druge kategorije, ako ih ima). */
  articles: z.array(articleSchema),
  /** 2 najbolja popusta koja još važe. */
  deals: z.array(dealSchema),
  /** 2 najživlje teme (po ukupnoj aktivnosti). */
  threads: z.array(homeThreadSchema),
});
export type DailyFeedResponse = z.infer<typeof dailyFeedResponseSchema>;

export const dealDetailResponseSchema = z.object({ deal: dealSchema });

export const gameSchema = z.object({
  id: idSchema,
  slug: z.string(),
  title: z.string(),
  coverUrl: z.string().nullable(),
  releaseDate: isoDateOptional,
  igdbId: z.number().nullable(),
  activeDeals: z.number().optional(),
});
export type Game = z.infer<typeof gameSchema>;

// =====================================================================
// 2.8.0 — GAME GUIDES (community vodiči)
// =====================================================================

export const GUIDE_CATEGORIES = ['walkthrough', 'builds', 'achievements', 'tips', 'general'] as const;

export const guideSchema = z.object({
  id: idSchema,
  gameSlug: z.string().nullable(),
  gameTitle: z.string().nullable(),
  authorId: idSchema,
  author: z.string(),
  authorAvatar: z.string().nullable(),
  authorRole: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  content: z.string(),
  category: z.enum(GUIDE_CATEGORIES),
  score: z.number(),
  viewsCount: z.number(),
  status: z.enum(['published', 'draft', 'archived']),
  createdAt: isoDate,
  updatedAt: isoDate,
  myVote: z.enum(['up', 'down']).nullable(),
});
export type Guide = z.infer<typeof guideSchema>;

export const guidesListResponseSchema = z.object({
  guides: z.array(guideSchema),
  total: z.number(),
  game: z.object({ slug: z.string(), title: z.string() }),
});
export type GuidesListResponse = z.infer<typeof guidesListResponseSchema>;

export const guideDetailResponseSchema = z.object({ guide: guideSchema });
export type GuideDetailResponse = z.infer<typeof guideDetailResponseSchema>;

export const guideVoteResponseSchema = z.object({
  changed: z.boolean(),
  delta: z.number(),
  score: z.number(),
  myVote: z.enum(['up', 'down']).nullable(),
});
export type GuideVoteResponse = z.infer<typeof guideVoteResponseSchema>;

export const igdbGameSchema = z.object({
  igdbId: z.number(),
  name: z.string(),
  slug: z.string(),
  coverUrl: z.string().nullable(),
  releaseDate: isoDateOptional,
});
export type IgdbGame = z.infer<typeof igdbGameSchema>;

export const gameDetailResponseSchema = z.object({
  game: gameSchema,
  deals: z.array(dealSchema),
  total: z.number(),
});
export type GameDetailResponse = z.infer<typeof gameDetailResponseSchema>;

/* ------------------------------------------------------------------ */
/* Notifikacije, prijave, pretplata                                   */
/* ------------------------------------------------------------------ */

export const notificationSchema = z.object({
  id: idSchema,
  userId: z.string(),
  type: notificationTypeSchema,
  title: z.string(),
  message: z.string(),
  link: z.string().optional(),
  isRead: z.boolean(),
  actorId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDate,
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const reportSchema = z.object({
  id: idSchema,
  targetType: reportTargetTypeSchema,
  targetId: z.string(),
  reporterId: z.string(),
  reason: z.string(),
  status: reportStatusSchema,
  resolvedBy: z.string().nullable().optional(),
  resolvedAt: isoDateOptional,
  resolutionNote: z.string().nullable().optional(),
  createdAt: isoDate,
});
export type Report = z.infer<typeof reportSchema>;

/** `PATCH /api/reports/:id` — obrađena prijava. */
export const reportResponseSchema = z.object({
  message: z.string(),
  report: reportSchema,
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

export const reportListResponseSchema = z.object({
  reports: z.array(reportSchema),
  total: z.number(),
  counts: z.record(z.string(), z.number()).optional(),
});
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;

export const subscriberSegmentSchema = z.enum(['active', 'pending', 'unsubscribed', 'all']);
export type SubscriberSegment = z.infer<typeof subscriberSegmentSchema>;

export const subscriberSchema = z.object({
  id: idSchema,
  email: z.string(),
  isActive: z.boolean(),
  subscribedAt: isoDate,
  confirmedAt: isoDateOptional,
  unsubscribedAt: isoDateOptional,
});
export type Subscriber = z.infer<typeof subscriberSchema>;

export const subscriberListResponseSchema = z.object({
  subscribers: z.array(subscriberSchema),
  total: z.number(),
  counts: z.object({ all: z.number(), active: z.number(), pending: z.number(), unsubscribed: z.number() }),
  segment: z.string(),
  hasMore: z.boolean(),
});
export type SubscriberListResponse = z.infer<typeof subscriberListResponseSchema>;

/* ------------------------------------------------------------------ */
/* Admin                                                              */
/* ------------------------------------------------------------------ */

export const adminSettingsSchema = z.object({
  announcement: z.object({
    active: z.boolean(),
    message: z.string(),
    tone: z.enum(['info', 'warning', 'danger']),
    link: z.string().optional(),
  }),
  registrationOpen: z.boolean(),
  maintenanceMode: z.boolean(),
  requireContentApproval: z.boolean(),
  pendingNotice: z.string(),
  disableNewThreads: z.boolean(),
  readOnlyForum: z.boolean(),
  allowedEmailDomains: z.array(z.string()),
  blockedEmailDomains: z.array(z.string()),
  signatureMaxLength: z.number().int().min(0).max(500),
  attachmentsPerPost: z.number().int().min(0).max(20),
  dmMaxThreadsPerUser: z.number().int().min(0).max(200),
  threadsPerDay: z.number().int().min(0).max(100),
  postsPerDay: z.number().int().min(0).max(500),
  minXpToPost: z.number().int().min(0).max(10_000),
  maintenanceMessage: z.string(),
  dmDisabled: z.boolean(),
  seoMetaTitle: z.string(),
  seoMetaDescription: z.string(),
  seoOgImage: z.string(),
  analyticsId: z.string(),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

/** `GET /api/admin/health` — dijagnostika za admin panel (bez ključeva). */
export const adminHealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  node: z.string(),
  uptimeSeconds: z.number(),
  memory: z.object({ rssMb: z.number(), heapMb: z.number() }),
  db: z.object({
    mode: z.enum(['supabase', 'memory']),
    ok: z.boolean(),
    latencyMs: z.number(),
    siteMeta: z.boolean(),
  }),
  storage: z.object({ configured: z.boolean(), bucket: z.string() }),
  email: z.object({
    provider: z.enum(['resend', 'brevo']).nullable(),
    configured: z.boolean(),
    /** 6.x — mejl je samo transakcioni (verifikacija + reset), ne notifikacije. */
    purpose: z.literal('transactional_only').optional(),
    notificationsEnabled: z.boolean().optional(),
    allowedTypes: z.array(z.string()).optional(),
  }),
  /** 6.x — stanje kanala notifikacija (inbox je uvek aktivan). */
  notifications: z
    .object({
      inbox: z.boolean(),
      realtime: z.boolean(),
      push: z.boolean(),
      quietHoursSupported: z.boolean(),
    })
    .optional(),
  steamSync: z.object({ enabled: z.boolean() }),
});
export type AdminHealth = z.infer<typeof adminHealthSchema>;

export const adminSettingsResponseSchema = z.object({ settings: adminSettingsSchema });

/** `GET /api/admin/settings/public` — samo deo podešavanja koji vidi posetilac. */
export const publicAdminSettingsSchema = adminSettingsSchema.pick({
  announcement: true,
  registrationOpen: true,
  maintenanceMode: true,
  maintenanceMessage: true,
  disableNewThreads: true,
  readOnlyForum: true,
  requireContentApproval: true,
  pendingNotice: true,
  dmDisabled: true,
});
export type PublicAdminSettings = z.infer<typeof publicAdminSettingsSchema>;

/** Red iz `audit_log` — `from`/`to` su slobodni JSON (rola, ban, bedž). */
export const auditEntrySchema = z.object({
  id: idSchema,
  actorId: z.string(),
  actorUsername: z.string().optional(),
  targetId: z.string(),
  targetUsername: z.string().optional(),
  action: z.enum([
    'role_change',
    'ban',
    'unban',
    'badge_awarded',
    /** Admin XP korekcija (`POST /api/admin/users/:id/adjust-xp`, ± u `to.xp`). */
    'xp_adjusted',
    'comment_deleted',
    // F-10 — moderacija tema i upozorenja.
    'thread_delete',
    'thread_restore',
    'warning_issue',
    'warning_revoke',
  ]),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  at: isoDate,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditLogResponseSchema = z.object({ entries: z.array(auditEntrySchema) });
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

export const adminStatsSchema = z.object({
  totalUsers: z.number(),
  totalArticles: z.number(),
  publishedArticles: z.number().optional(),
  totalThreads: z.number(),
  totalSubscribers: z.number(),
  totalViews: z.number(),
  moderators: z.number(),
  pendingCount: z.number().optional(),
  // F-7b — analitički podaci za grafikone (opciono: null u demo režimu)
  analytics: z
    .object({
      overview: z.object({
        periodViews: z.number(),
        viewsGrowth: z.number(),
      }),
      viewsOverTime: z.array(z.object({ date: z.string(), views: z.number() })),
      topArticles: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          slug: z.string().nullable().optional(),
          kind: z.enum(['article', 'thread']),
          views: z.number(),
          author: z.string().nullable().optional(),
        }),
      ),
      retentionOrEngagement: z.array(
        z.object({ category: z.string(), views: z.number(), percentage: z.number() }),
      ),
    })
    .nullable()
    .optional(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

export const mediaItemSchema = z.object({
  path: z.string(),
  name: z.string(),
  url: z.string(),
  size: z.number().nullable(),
  createdAt: isoDateOptional,
  kind: z.string().nullable(),
  ownerId: z.string().nullable(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaItemsResponseSchema = z.object({
  configured: z.boolean(),
  items: z.array(mediaItemSchema),
});
export type MediaItemsResponse = z.infer<typeof mediaItemsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Pretraga                                                           */
/* ------------------------------------------------------------------ */

export const searchScopeSchema = z.enum(['all', 'articles', 'threads', 'replies', 'deals']);
export type SearchScope = z.infer<typeof searchScopeSchema>;

export const searchHitTypeSchema = z.enum(['article', 'thread', 'reply', 'deal']);
export type SearchHitType = z.infer<typeof searchHitTypeSchema>;

export const searchHitSchema = z.object({
  type: searchHitTypeSchema,
  id: idSchema,
  title: z.string(),
  snippet: z.string(),
  href: z.string(),
  meta: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  extra: z.string().nullable().optional(),
  /** Kolekcija / lista (`/collections/…`) — za brzi skok iz ⌘K. */
  collection: z.string().nullable().optional(),
  createdAt: isoDate,
  rank: z.number(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

/* ------------------------------------------------------------------ */
/* Meta / zajednički odgovori                                         */
/* ------------------------------------------------------------------ */

export const uploadResultSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
});
export type UploadResult = z.infer<typeof uploadResultSchema>;

/** Uniforman odgovor greške (centralni `errorHandler`). */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Ulazne šeme koje deli klijent (query parametri)                    */
/* ------------------------------------------------------------------ */

/** `GET /api/articles` — filteri liste (ruta ih čita iz `req.query`). */
export const articleListQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  featured: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ArticleListQuery = z.infer<typeof articleListQuerySchema>;

/** `GET /api/forum/:subforum/threads` — sortiranje i cursor paginacija. */
export const threadListQuerySchema = z.object({
  sort: threadSortSchema.optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().nullable().optional(),
});
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;
