import { z } from 'zod';

/**
 * ZOD ŠEME ZA API
 * ---------------
 * Jedno mesto za sva ograničenja dužine i formatа. Svaka mutirajuća ruta
 * validira telo/parametre pre nego što dodirne bazu, i vraća 400 sa listom
 * grešaka po polju (`details`).
 */

export const LIMITS = {
  title: { min: 3, max: 150 },
  content: { min: 3, max: 20_000 },
  excerpt: { max: 400 },
  tags: { max: 5, itemMax: 24 },
  bio: { max: 300 },
  platformUsername: { max: 64 },
  articleTitle: { min: 3, max: 150 },
  articleContent: { min: 20, max: 50_000 },
} as const;

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https:\/\/[^\s"'<>]+$/i.test(value), {
    message: 'URL mora počinjati sa https://',
  });

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.tags.itemMax, `Tag može imati najviše ${LIMITS.tags.itemMax} karaktera`);

export const tagsSchema = z
  .array(tagSchema)
  .max(LIMITS.tags.max, `Najviše ${LIMITS.tags.max} tagova`)
  .optional();

/* ---------------------------- AUTH ---------------------------- */

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Korisničko ime mora imati najmanje 3 karaktera')
    .max(25, 'Korisničko ime može imati najviše 25 karaktera')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Dozvoljena su slova, brojevi, tačka, crta i donja crta'),
  email: z.string().trim().max(254).email('Unesite ispravnu email adresu'),
  password: z.string().min(8, 'Lozinka mora imati najmanje 8 karaktera').max(72, 'Lozinka je predugačka'),
  acceptedTerms: z.literal(true, { message: 'Morate prihvatiti uslove korišćenja.' }),
  /** F-21 — eksplicitna potvrda minimalnog uzrasta (15 godina, ZZPL). */
  ageConfirmed: z.literal(true, { message: 'Potvrdite da imate najmanje 15 godina.' }).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email ili korisničko ime je obavezno').max(254),
  password: z.string().min(1, 'Lozinka je obavezna').max(200),
  rememberMe: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().max(254).email('Unesite ispravnu email adresu'),
});

/* ------------------------ NEWSLETTER (2.6.2) ------------------------ */

export const newsletterResendSchema = z.object({
  email: z.string().trim().max(254).email('Unesite ispravnu email adresu'),
});

/**
 * Admin kampanja. `segment` određuje kome ide (podrazumevano samo potvrđeni),
 * `testEmail` šalje JEDAN mejl sebi i ne dira ostatak liste (bezbedno
 * proveravanje sadržaja pre prave kampanje).
 */
export const newsletterCampaignSchema = z.object({
  subject: z.string().trim().min(3).max(140),
  content: z.string().trim().min(10).max(50_000),
  segment: z.enum(['active', 'pending', 'unsubscribed', 'all']).optional(),
  testEmail: z.string().trim().max(254).email('Unesite ispravnu email adresu').optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(8, 'Lozinka mora imati najmanje 8 karaktera').max(72),
});

/* ------------------------ 2FA (F-33) ------------------------ */

/**
 * TOTP kod: 6 cifara (razmaci/crtica se skidaju) ili recovery kod
 * `abcde-fghij` (10 heksadecimalnih karaktera).
 */
export const otpCodeSchema = z
  .string()
  .trim()
  .max(20)
  .transform((value) => value.replace(/[\s-]/g, '').toLowerCase())
  .refine((value) => /^(\d{6}|[0-9a-f]{10})$/.test(value), {
    message: 'Unesite 6-cifreni kod iz aplikacije ili recovery kod.',
  });

/** Drugi korak prijave: kratkotrajni tiket iz `/auth/login` + kod. */
export const mfaLoginSchema = z.object({
  mfaTicket: z.string().min(20).max(2000),
  code: otpCodeSchema,
  rememberMe: z.boolean().optional(),
});

export const totpDisableSchema = z.object({
  password: z.string().min(1, 'Lozinka je obavezna').max(200),
  code: otpCodeSchema,
});

/* -------------------------- ARTICLES -------------------------- */

export const reviewScorecardSchema = z.object({
  score: z.number().min(0).max(10).optional(),
  verdict: z.string().trim().max(500).optional(),
  pros: z.array(z.string().trim().max(150)).max(10).optional(),
  cons: z.array(z.string().trim().max(150)).max(10).optional(),
});

export const createArticleSchema = z.object({
  title: z.string().trim().min(LIMITS.articleTitle.min).max(LIMITS.articleTitle.max),
  content: z.string().trim().min(LIMITS.articleContent.min).max(LIMITS.articleContent.max),
  excerpt: z.string().trim().max(LIMITS.excerpt.max).optional(),
  category: z.string().trim().min(2).max(50).optional(),
  tags: tagsSchema,
  coverImage: httpsUrl.optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  isFeatured: z.boolean().optional(),
  reviewScorecard: reviewScorecardSchema.nullable().optional(),
});

export const updateArticleSchema = createArticleSchema.partial();

/* ---------------------------- FORUM ---------------------------- */

const subforumSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'Nepoznat subforum');

export const pollSchema = z.object({
  question: z.string().trim().min(3).max(200),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
});

export const createThreadSchema = z.object({
  title: z.string().trim().min(LIMITS.title.min, 'Naslov mora imati najmanje 3 karaktera').max(LIMITS.title.max),
  content: z.string().trim().min(LIMITS.content.min).max(LIMITS.content.max),
  tags: tagsSchema,
  isSpoiler: z.boolean().optional(),
  poll: pollSchema.optional().nullable(),
});

export const createReplySchema = z.object({
  content: z.string().trim().min(1, 'Sadržaj odgovora je obavezan').max(LIMITS.content.max),
  parentId: z.string().max(64).optional().nullable(),
  isSpoiler: z.boolean().optional(),
});

/** Izmena sopstvene teme/odgovora — sva polja opciona, ali bar jedno mora doći. */
export const updatePostSchema = z
  .object({
    title: z.string().trim().min(LIMITS.title.min).max(LIMITS.title.max).optional(),
    content: z.string().trim().min(1).max(LIMITS.content.max).optional(),
    tags: tagsSchema,
    isSpoiler: z.boolean().optional(),
    /** Označava soft-delete (sadržaj se briše, red ostaje radi konteksta). */
    deletePost: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nema izmena.' });

export const voteSchema = z.object({
  direction: z.enum(['up', 'down']).nullable(),
});

export const pollVoteSchema = z.object({
  optionIndex: z.number().int().min(0).max(5),
});

export const moderateSchema = z.object({
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  deleteThread: z.boolean().optional(),
});

export const subforumParamSchema = z.object({ subforum: subforumSchema });
export const idParamSchema = z.object({ id: z.string().min(1).max(64) });

/* ---------------------------- USERS ---------------------------- */

export const updateProfileSchema = z.object({
  avatar: httpsUrl.optional(),
  bio: z.string().trim().max(LIMITS.bio.max).optional(),
  status: z.enum(['online', 'away', 'offline']).optional(),
});

export const connectAccountSchema = z.object({
  platform: z.enum(['steam', 'discord', 'youtube', 'twitch', 'epic', 'riot']),
  platformUsername: z
    .string()
    .trim()
    .min(1, 'Korisnički ID / nalog je obavezan')
    .max(LIMITS.platformUsername.max),
});

export const rolePatchSchema = z
  .object({
    // `dev` je kozmetička uloga (značka/okvir) — nema moderatorske dozvole.
    role: z.enum(['admin', 'dev', 'moderator', 'member']).optional(),
    isBanned: z.boolean().optional(),
    /** Obavezno kada je isBanned=true — zašto je korisnik banovan. */
    banReason: z.string().trim().min(3, 'Razlog bana je obavezan').max(500).optional(),
    /** Trajanje bana u danima; null/undefined = trajni ban. */
    banDays: z.number().int().min(1).max(3650).nullable().optional(),
    /** Mute u satima (npr. 1, 6, 24, 72). 0 ili null uklanja mute. */
    muteHours: z.number().int().min(0).max(8760).nullable().optional(),
  })
  .refine((d) => d.isBanned !== true || Boolean(d.banReason), {
    message: 'Razlog bana je obavezan.',
    path: ['banReason'],
  });

/* -------------------------- NEWSLETTER -------------------------- */

export const subscribeSchema = z.object({
  email: z.string().trim().max(254).email('Unesite ispravnu email adresu'),
});

export const unsubscribeSchema = z.object({
  token: z.string().min(16, 'Nevažeći token').max(200),
});

/* --------------------------- HELPERS --------------------------- */

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; details: Array<{ field: string; message: string }> };

/** Bezbedno parsira bilo koju šemu i vraća uniforman rezultat. */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message,
    })),
  };
}
