import { z } from 'zod';
// B25 — prevodi poruka za najčešća polja (deljeni modul, iste poruke vidi klijent).
import { ZOD_FIELD_MESSAGES } from '../../contracts/index.js';

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
  subject: z.string().trim().min(3, 'Naslov mejla je prekratak').max(140, 'Naslov mejla je predugačak'),
  /** A/B test naslova: druga polovina pretplatnika dobija ovaj umesto `subject`. */
  subjectB: z.string().trim().min(3, 'Naslov B je prekratak').max(140, 'Naslov B je predugačak').optional(),
  content: z.string().trim().min(10, 'Sadržaj mejla je prekratak').max(50_000, 'Sadržaj mejla je predugačak'),
  segment: z.enum(['active', 'pending', 'unsubscribed', 'all']).optional(),
  testEmail: z.string().trim().max(254).email('Unesite ispravnu email adresu').optional(),
  /** ISO datum — kampanja se šalje u prvom minutu posle ovog trenutka (±10 s). */
  scheduledAt: z.string().datetime({ offset: true, message: 'Datum zakazivanja nije ispravan' }).optional(),
});

/** Zakazivanje: isto kao kampanja, bez `testEmail` (test ide odmah, nikad u red). */
export const newsletterScheduleSchema = newsletterCampaignSchema.omit({ testEmail: true });

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
  /** F-15 — „zapamti ovaj uređaj 30 dana“ (cookie `nx_trust`). */
  trustDevice: z.boolean().optional(),
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

export const createArticleSchemaBase = z.object({
  // B25 — svaka šema nosi svoju srpsku poruku (nema oslanjanja na engleski Zod default).
  title: z.string().trim().min(LIMITS.articleTitle.min, 'Naslov je prekratak').max(LIMITS.articleTitle.max, 'Naslov je predugačak'),
  content: z.string().trim().min(LIMITS.articleContent.min, 'Sadržaj je prekratak').max(LIMITS.articleContent.max, 'Sadržaj je predugačak'),
  excerpt: z.string().trim().max(LIMITS.excerpt.max, 'Kratak opis je predugačak').optional(),
  category: z.string().trim().min(2, 'Kategorija je prekratka').max(50, 'Kategorija je predugačka').optional(),
  tags: tagsSchema,
  // Prazan string = „nema slike“ (forma u adminu šalje `''`); u bazu ide default.
  coverImage: httpsUrl.or(z.literal('')).optional(),
  status: z.enum(['draft', 'published', 'scheduled', 'archived']).optional(),
  /**
   * 2.10.0 — zakazani trenutak objave (ISO 8601 UTC, klijent šalje `toISOString()`).
   * Obavezno i mora biti u budućnosti kad je `status='scheduled'` (refine dole).
   */
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  isFeatured: z.boolean().optional(),
  reviewScorecard: reviewScorecardSchema.nullable().optional(),
});

/**
 * 2.10.0 — validacija zakazivanja: `scheduledFor` mora biti u budućnosti
 * (minimum 5 minuta, da slučajno „sad“ ne prođe kroz tajmer ciklus).
 * Kad je `status='published'`, `scheduledFor` se ignoriše (server ga briše).
 */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

export const createArticleSchema = createArticleSchemaBase.superRefine((data, ctx) => {
  if (data.status === 'scheduled') {
    if (!data.scheduledFor) {
      ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Zakazani članak zahteva datum objave.' });
    } else if (new Date(data.scheduledFor).getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledFor'],
        message: 'Zakazano vreme mora biti najmanje 5 minuta u budućnosti.',
      });
    }
  }
});

export const updateArticleSchema = createArticleSchemaBase.superRefine((data, ctx) => {
  // Ista pravila kao create — samo kada klijent šalje status/scheduledFor.
  if (data.status === 'scheduled') {
    if (!data.scheduledFor) {
      ctx.addIssue({ code: 'custom', path: ['scheduledFor'], message: 'Zakazani članak zahteva datum objave.' });
    } else if (new Date(data.scheduledFor).getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledFor'],
        message: 'Zakazano vreme mora biti najmanje 5 minuta u budućnosti.',
      });
    }
  }
});

/**
 * 2.12.0 — uvoz vesti iz n8n-a (RSS bot).
 *
 * Isti oblik kao `createArticleSchema`, uz `sourceUrl` (link na originalnu vest)
 * koji služi za deduplikaciju: isti `sourceUrl` se nikad ne uvozi dvaput, a isti
 * naslov unutar 24h ne pravi duplikat. Polja za statuse/zakazivanje nema — bot
 * uvek objavljuje odmah.
 */
export const ingestArticleSchema = z.object({
  title: z.string().trim().min(LIMITS.articleTitle.min, 'Naslov je prekratak').max(LIMITS.articleTitle.max, 'Naslov je predugačak'),
  content: z.string().trim().min(LIMITS.articleContent.min, 'Sadržaj je prekratak').max(LIMITS.articleContent.max, 'Sadržaj je predugačak'),
  excerpt: z.string().trim().max(LIMITS.excerpt.max, 'Kratak opis je predugačak').optional(),
  category: z.string().trim().min(2, 'Kategorija je prekratka').max(50, 'Kategorija je predugačka').optional(),
  tags: tagsSchema,
  coverImage: httpsUrl.or(z.literal('')).optional(),
  /**
   * 2.12.0 — stvarni trenutak objave na izvoru (`datePublished` sa stranice).
   * Opciono; server ga prihvata samo ako nije u budućnosti (inače `now`).
   */
  publishedAt: z.string().datetime({ offset: true }).optional(),
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => /^https:\/\/[^\s"'<>]+$/i.test(value), {
      message: 'sourceUrl mora biti https link na originalnu vest',
    }),
  authorName: z.string().trim().max(80, 'Ime izvora je predugačko').optional(),
  isFeatured: z.boolean().optional(),
  /** 2.13.0 — grupa događaja (`gta-6`, `xbox`…) — ista za vesti o istom događaju. */
  eventId: z.string().trim().max(120).regex(/^[a-z0-9-]+$/i, 'eventId sme imati samo slova, brojeve i crtice').optional(),
  eventTitle: z.string().trim().max(120).optional(),
  /** 2.13.0 — ime izvora za prikaz („Izvor: Polygon“); `authorName` je isto polje. */
  newsSource: z.string().trim().max(80).optional(),
  /** 2.13.0 — kratka rečenica „zašto je bitno“ (jedna, bez više redova). */
  whyItMatters: z.string().trim().max(280).optional(),
});

/* ---------------------------- FORUM ---------------------------- */

const subforumSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'Nepoznat subforum');

export const pollSchema = z.object({
  question: z.string().trim().min(3, 'Pitanje ankete je prekratko').max(200, 'Pitanje ankete je predugačko'),
  options: z
    .array(z.string().trim().min(1, 'Opcija ankete ne može biti prazna').max(120, 'Opcija ankete je predugačka'))
    .min(2, 'Anketa mora imati najmanje 2 opcije')
    .max(6, 'Anketa može imati najviše 6 opcija'),
});

export const createThreadSchema = z.object({
  title: z
    .string()
    .trim()
    .min(LIMITS.title.min, 'Naslov mora imati najmanje 3 karaktera')
    .max(LIMITS.title.max, 'Naslov može imati najviše 150 karaktera'),
  content: z
    .string()
    .trim()
    .min(LIMITS.content.min, 'Sadržaj teme je prekratak')
    .max(LIMITS.content.max, 'Sadržaj teme je predugačak'),
  tags: tagsSchema,
  isSpoiler: z.boolean().optional(),
  poll: pollSchema.optional().nullable(),
  /**
   * F-3 — „Diskutuj o ovom popustu“: tema se veže za deal, a kartica deal-a
   * se prikazuje na vrhu teme. Server proverava da deal postoji i nije uklonjen.
   */
  dealId: z.string().trim().min(1).max(64).optional().nullable(),
});

export const createReplySchema = z.object({
  content: z.string().trim().min(1, 'Sadržaj odgovora je obavezan').max(LIMITS.content.max),
  parentId: z.string().max(64).optional().nullable(),
  isSpoiler: z.boolean().optional(),
});

/** F-7.1 #8 — praćenje teme sa opcijom mejla na novi odgovor. */
export const followThreadSchema = z.object({
  email: z.boolean().optional(),
});

/** Izmena sopstvene teme/odgovora — sva polja opciona, ali bar jedno mora doći. */
export const updatePostSchema = z
  .object({
    title: z.string().trim().min(LIMITS.title.min, 'Naslov mora imati najmanje 3 karaktera').max(LIMITS.title.max, 'Naslov može imati najviše 150 karaktera').optional(),
    content: z.string().trim().min(1, 'Sadržaj je obavezan').max(LIMITS.content.max, 'Sadržaj je predugačak').optional(),
    tags: tagsSchema,
    isSpoiler: z.boolean().optional(),
    /** Označava soft-delete (sadržaj se briše, red ostaje radi konteksta). */
    deletePost: z.boolean().optional(),
    /** 6.x — razlog uklanjanja; moderator ga šalje autoru u inbox. */
    reason: z.string().trim().min(3).max(300).optional(),
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
  /** F-10 — vraćanje soft-deleted teme (suprotno od `deleteThread`, ne može oba). */
  restoreThread: z.boolean().optional(),
  /**
   * 6.x — razlog uklanjanja; ide autoru u in-app notifikaciju („zašto mi je
   * nestao post“ bez mejla). Opciono — bez razloga se šalje uopšteno obaveštenje.
   */
  reason: z.string().trim().min(3, 'Razlog mora imati najmanje 3 karaktera.').max(300).optional(),
}).refine((body) => !(body.deleteThread && body.restoreThread), {
  message: 'Tema ne može istovremeno biti obrisana i vraćena.',
  path: ['restoreThread'],
});

export const subforumParamSchema = z.object({ subforum: subforumSchema });
export const idParamSchema = z.object({ id: z.string().min(1).max(64) });

/* ---------------------------- USERS ---------------------------- */

export const updateProfileSchema = z.object({
  avatar: httpsUrl.optional(),
  bio: z.string().trim().max(LIMITS.bio.max).optional(),
  status: z.enum(['online', 'away', 'offline']).optional(),
  /** #4 — preset cover-a (pozadine profila); prazan string = reset na podrazumevani. */
  coverPreset: z.enum(['violet', 'emerald', 'amber', 'rose', 'cyan', '']).optional(),
});

/** #5 — GG poruka na profilu (max 200 znakova, jedan po autoru). */
export const guestbookUpsertSchema = z.object({
  message: z.string().trim().min(1, 'GG poruka je obavezna').max(200, 'GG poruka je preduga (max 200)'),
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
  return { success: false, details: zodDetails(result.error) };
}

/**
 * B25 — jedno mesto gde Zod greška postaje poruka za klijenta.
 *
 * Zod4 za `z.string().min(3)` bez `message` OPREMA issue poruku na engleskom
 * („Too small: expected string to have >=3 characters“), pa je odgovor API-ja
 * mešao srpski i engleski („Validation failed“). Da nijedna šema ne mora da
 * ponavlja prevod, ovde se engleski opis zamenjuje srpskim — osim kada issue
 * već nosi našu `message` (tada se ne dira).
 *
 * Bez `zod` `locales()` podešavanja: `locales()` menja GLOBALNO en/de/sr mapiranje
 * i lako pokvari poruke testova i drugih šema. Ovde je prevod izolovan.
 */
const ZOD_MESSAGES: Record<string, string> = {
  invalid_type: 'Neispravan tip podatka.',
  too_small: 'Vrednost je prekratka.',
  too_big: 'Vrednost je predugačka.',
  invalid_format: 'Neispravan format.',
  invalid_value: 'Neispravna vrednost.',
  not_multiple_of: 'Neispravna vrednost.',
  unrecognized_keys: 'Nepoznato polje.',
  invalid_union: 'Neispravna vrednost.',
  invalid_key: 'Neispravan ključ.',
  invalid_element: 'Neispravna vrednost u listi.',
  custom: 'Neispravna vrednost.',
};

const ENGLISH_DEFAULT = /^[A-Z][a-z]/;

/** Poruka jednog Zod issue-a — srpski, i kada šema nema eksplicitni `message`. */
export function zodIssueMessage(issue: z.core.$ZodIssue): string {
  if (issue.message.startsWith('Invalid input')) return 'Neispravna vrednost.';
  // Zod4: kad nema `message`, poruka je generisan engleski opis.
  if (ENGLISH_DEFAULT.test(issue.message)) {
    const field = String(issue.path[0] ?? '');
    return ZOD_FIELD_MESSAGES[field]?.[issue.code] ?? ZOD_MESSAGES[issue.code] ?? 'Neispravna vrednost.';
  }
  return issue.message;
}

/** Issu-evi u obliku koji rute i klijent poznaju (`{ field, message }`). */
export function zodDetails(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: zodIssueMessage(issue),
  }));
}
