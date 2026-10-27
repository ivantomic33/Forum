import { getSharedValue, setSharedValue } from './sharedStore.js';
import { logger } from './logger.js';

/**
 * PODEŠAVANJA SAJTA (announcement banner, registracija, maintenance, forum i sl.)
 * ------------------------------------------------------------------
 * Ranije su živela u `let currentSettings` promenljivoj modulu `routes/admin.ts`.
 * To je radilo samo sa JEDNOM API instancom: restart je vraćao podrazumevana
 * podešavanja, a druga instanca nije videla promenu.
 *
 * Sada je izvor istine `site_meta` (isti deljeni ključ–vrednost koji koriste
 * digest i throttle mejlova):
 *
 *  - `memory` režim → `Map` (testovi, lokalno bez Supabase-a),
 *  - `supabase` režim → tabela `site_meta`, dakle preživljava restart i deli se
 *    između instanci,
 *  - nedostajuća tabela ne ruši zahtev — upis pada tiho uz jednokratno upozorenje
 *    (`sharedStore`), a odgovor i dalje sadrži nova podešavanja.
 *
 * `loadSiteSettings()` NIKAD ne baca grešku; `currentSettings` je keš za
 * sinhroni `getPublicSiteSettings()` koji zovu `routes/auth.ts` i `routes/oauth.ts`.
 */

export const SITE_SETTINGS_KEY = 'site_settings';

export type AnnouncementTone = 'info' | 'warning' | 'danger';

export interface SiteSettings {
  announcement: {
    active: boolean;
    message: string;
    tone: AnnouncementTone;
    link?: string;
  };
  registrationOpen: boolean;
  maintenanceMode: boolean;
  /** Moderacija sadržaja — sve mora da prođe kroz odobrenje pre objave. */
  requireContentApproval: boolean;
  /** Poruka koja se vidi dok tema/komentar čeka odobrenje. */
  pendingNotice: string;
  /** Zatvori pravljenje novih tema (samo odgovori). */
  disableNewThreads: boolean;
  /** Zatvori odgovaranje u temama (samo čitanje). */
  readOnlyForum: boolean;
  /** Registracija dozvoljena SAMO sa ovih email domena (prazno = svi). */
  allowedEmailDomains: string[];
  /** Registracija BLOKIRANA za ove email domene (blocklist ima prednost). */
  blockedEmailDomains: string[];
  /** Maksimalna dužina potpisa u znakovima (0 = potpisi isključeni). */
  signatureMaxLength: number;
  /** Maksimalan broj slika/priloga u jednom postu (0 = bez priloga). */
  attachmentsPerPost: number;
  /** Maksimalan broj otvorenih DM razgovora po korisniku (0 = DM isključen). */
  dmMaxThreadsPerUser: number;
  /** Maksimalan broj tema koje korisnik može otvoriti po danu (0 = bez limita). */
  threadsPerDay: number;
  /** Maksimalan broj odgovora po korisniku po danu (0 = bez limita). */
  postsPerDay: number;
  /** Najmanji XP potreban za otvaranje nove teme (0 = svi mogu). */
  minXpToPost: number;
  /** Poruka koja se vidi na ekranu za održavanje. */
  maintenanceMessage: string;
  /** Potpuno isključenje privatnih poruka (DM). */
  dmDisabled: boolean;
  /** Default SEO meta title (prazno = iz koda). */
  seoMetaTitle: string;
  /** Default SEO meta description (prazno = iz koda). */
  seoMetaDescription: string;
  /** Default OG slika (URL). */
  seoOgImage: string;
  /** Google Analytics / Plausible ID (prazno = ne ubacuje se skripta). */
  analyticsId: string;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  announcement: { active: false, message: '', tone: 'info', link: '' },
  registrationOpen: true,
  maintenanceMode: false,
  requireContentApproval: false,
  pendingNotice: 'Vaš doprinos čeka odobrenje administratora.',
  disableNewThreads: false,
  readOnlyForum: false,
  allowedEmailDomains: [],
  blockedEmailDomains: [],
  signatureMaxLength: 200,
  attachmentsPerPost: 4,
  dmMaxThreadsPerUser: 25,
  threadsPerDay: 0,
  postsPerDay: 0,
  minXpToPost: 0,
  /** Poruka na ekranu za održavanje. */
  maintenanceMessage: 'Portal je trenutno u režimu održavanja. Vratite se uskoro!',
  dmDisabled: false,
  seoMetaTitle: '',
  seoMetaDescription: '',
  seoOgImage: '',
  analyticsId: '',
};

/** Lista dozvoljenih email domena — sadrži samo validne domene, max 20. */
function normalizeDomainList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const domain = item.trim().toLowerCase().replace(/^@/, '').replace(/^.*@/, '');
    // Grubo: bar jedno slovo/broj, tačka, TLD od 2+ znaka.
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      seen.add(domain);
    }
    if (seen.size >= 20) break;
  }
  return [...seen];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalizuje bilo šta što stigne (iz baze, sa rute ili iz keša) u validan
 * `SiteSettings`. Nepoznata polja se odbacuju, tipovi se prisiljavaju — rotacija
 * oblika u `site_meta` (stari ključevi, ručni upis) ne sme da sruši `/auth/register`.
 */
export function normalizeSiteSettings(input: unknown): SiteSettings {
  // `unknown` je stvarni ulaz (JSON iz baze ili `req.body`) — sve se proverava
  // pre upotrebe, pa se rezultat eksplicitno tipizira.
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const announcement = (
    raw.announcement && typeof raw.announcement === 'object' ? raw.announcement : {}
  ) as Record<string, unknown>;
  const tone = announcement.tone;

  return {
    announcement: {
      active: announcement.active === true,
      message: typeof announcement.message === 'string' ? announcement.message.slice(0, 300) : '',
      tone: tone === 'warning' || tone === 'danger' ? tone : 'info',
      link: typeof announcement.link === 'string' ? announcement.link.slice(0, 200) : '',
    },
    registrationOpen: raw.registrationOpen !== false,
    maintenanceMode: raw.maintenanceMode === true,
    requireContentApproval: raw.requireContentApproval === true,
    pendingNotice:
      typeof raw.pendingNotice === 'string'
        ? raw.pendingNotice.slice(0, 200) || DEFAULT_SITE_SETTINGS.pendingNotice
        : DEFAULT_SITE_SETTINGS.pendingNotice,
    disableNewThreads: raw.disableNewThreads === true,
    readOnlyForum: raw.readOnlyForum === true,
    allowedEmailDomains: normalizeDomainList(raw.allowedEmailDomains),
    blockedEmailDomains: normalizeDomainList(raw.blockedEmailDomains),
    signatureMaxLength: clampInt(raw.signatureMaxLength, 0, 500, DEFAULT_SITE_SETTINGS.signatureMaxLength),
    attachmentsPerPost: clampInt(raw.attachmentsPerPost, 0, 20, DEFAULT_SITE_SETTINGS.attachmentsPerPost),
    dmMaxThreadsPerUser: clampInt(raw.dmMaxThreadsPerUser, 0, 200, DEFAULT_SITE_SETTINGS.dmMaxThreadsPerUser),
    threadsPerDay: clampInt(raw.threadsPerDay, 0, 100, DEFAULT_SITE_SETTINGS.threadsPerDay),
    postsPerDay: clampInt(raw.postsPerDay, 0, 500, DEFAULT_SITE_SETTINGS.postsPerDay),
    minXpToPost: clampInt(raw.minXpToPost, 0, 10_000, DEFAULT_SITE_SETTINGS.minXpToPost),
    maintenanceMessage:
      typeof raw.maintenanceMessage === 'string' && raw.maintenanceMessage.trim()
        ? raw.maintenanceMessage.slice(0, 300)
        : DEFAULT_SITE_SETTINGS.maintenanceMessage,
    dmDisabled: raw.dmDisabled === true,
    seoMetaTitle: typeof raw.seoMetaTitle === 'string' ? raw.seoMetaTitle.slice(0, 120) : '',
    seoMetaDescription: typeof raw.seoMetaDescription === 'string' ? raw.seoMetaDescription.slice(0, 200) : '',
    seoOgImage: typeof raw.seoOgImage === 'string' ? raw.seoOgImage.slice(0, 300) : '',
    analyticsId: /^[A-Za-z0-9_-]{0,40}$/.test(String(raw.analyticsId ?? '')) ? String(raw.analyticsId ?? '') : '',
  };
}

/** Keš za sinhrone pozivaoce. Popunjava se na startu i posle svakog upisa. */
let currentSettings: SiteSettings = { ...DEFAULT_SITE_SETTINGS };

/** Sinhroni pristup (rute koje ne mogu da čekaju bazu). */
export function getPublicSiteSettings(): SiteSettings {
  return currentSettings;
}

/**
 * Učitaj iz `site_meta` u keš. Zove se pri startu servera (pre nego što primi
 * saobraćaj) i posle svakog upisa. Greška baze se loguje, keš ostaje kakav jeste.
 */
export async function loadSiteSettings(): Promise<SiteSettings> {
  try {
    const stored = await getSharedValue<unknown>(SITE_SETTINGS_KEY);
    if (stored !== null && stored !== undefined) {
      currentSettings = normalizeSiteSettings(stored);
    }
  } catch (err) {
    logger.warn({ err }, 'site_settings_load_failed');
  }
  return currentSettings;
}

/**
 * Periodično osvežavanje keša (60 s): promena upisana direktno u bazu ili sa
 * Druge instance API-ja postaje vidljiva bez restarta. Jeftino — jedan upit.
 */
export function startSiteSettingsRefresher(): void {
  const timer = setInterval(() => void loadSiteSettings(), 60_000);
  timer.unref?.();
}

/**
 * Spoji parcijalna podešavanja sa trenutnim stanjem, upiši u `site_meta` i
 * osveži keš. Vrednost koja se upisuje je ona koju ruta vraća klijentu — nema
 * `read-modify-write` preko mreže (čitanje i upis su u ovom procesu).
 */
export async function updateSiteSettings(patch: unknown): Promise<SiteSettings> {
  const raw = (patch ?? {}) as Record<string, unknown>;
  const merged: SiteSettings = { ...currentSettings };

  if (raw.announcement !== undefined) {
    merged.announcement = normalizeSiteSettings({
      announcement: raw.announcement as Partial<SiteSettings['announcement']>,
    }).announcement;
  }
  if (raw.registrationOpen !== undefined) merged.registrationOpen = Boolean(raw.registrationOpen);
  if (raw.maintenanceMode !== undefined) merged.maintenanceMode = Boolean(raw.maintenanceMode);
  if (raw.requireContentApproval !== undefined) merged.requireContentApproval = Boolean(raw.requireContentApproval);
  if (raw.pendingNotice !== undefined) {
    merged.pendingNotice = normalizeSiteSettings({ pendingNotice: raw.pendingNotice }).pendingNotice;
  }
  if (raw.disableNewThreads !== undefined) merged.disableNewThreads = Boolean(raw.disableNewThreads);
  if (raw.readOnlyForum !== undefined) merged.readOnlyForum = Boolean(raw.readOnlyForum);
  if (raw.allowedEmailDomains !== undefined) {
    merged.allowedEmailDomains = normalizeDomainList(raw.allowedEmailDomains);
  }
  if (raw.blockedEmailDomains !== undefined) {
    merged.blockedEmailDomains = normalizeDomainList(raw.blockedEmailDomains);
  }
  if (raw.signatureMaxLength !== undefined) {
    merged.signatureMaxLength = clampInt(raw.signatureMaxLength, 0, 500, merged.signatureMaxLength);
  }
  if (raw.attachmentsPerPost !== undefined) {
    merged.attachmentsPerPost = clampInt(raw.attachmentsPerPost, 0, 20, merged.attachmentsPerPost);
  }
  if (raw.dmMaxThreadsPerUser !== undefined) {
    merged.dmMaxThreadsPerUser = clampInt(raw.dmMaxThreadsPerUser, 0, 200, merged.dmMaxThreadsPerUser);
  }
  if (raw.threadsPerDay !== undefined) {
    merged.threadsPerDay = clampInt(raw.threadsPerDay, 0, 100, merged.threadsPerDay);
  }
  if (raw.postsPerDay !== undefined) {
    merged.postsPerDay = clampInt(raw.postsPerDay, 0, 500, merged.postsPerDay);
  }
  if (raw.minXpToPost !== undefined) {
    merged.minXpToPost = clampInt(raw.minXpToPost, 0, 10_000, merged.minXpToPost);
  }
  if (raw.maintenanceMessage !== undefined) {
    merged.maintenanceMessage = normalizeSiteSettings({ maintenanceMessage: raw.maintenanceMessage }).maintenanceMessage;
  }
  if (raw.dmDisabled !== undefined) merged.dmDisabled = Boolean(raw.dmDisabled);
  if (raw.seoMetaTitle !== undefined) {
    merged.seoMetaTitle = normalizeSiteSettings({ seoMetaTitle: raw.seoMetaTitle }).seoMetaTitle;
  }
  if (raw.seoMetaDescription !== undefined) {
    merged.seoMetaDescription = normalizeSiteSettings({ seoMetaDescription: raw.seoMetaDescription }).seoMetaDescription;
  }
  if (raw.seoOgImage !== undefined) {
    merged.seoOgImage = normalizeSiteSettings({ seoOgImage: raw.seoOgImage }).seoOgImage;
  }
  if (raw.analyticsId !== undefined) {
    merged.analyticsId = normalizeSiteSettings({ analyticsId: raw.analyticsId }).analyticsId;
  }

  currentSettings = normalizeSiteSettings(merged);
  await setSharedValue(SITE_SETTINGS_KEY, currentSettings);
  return currentSettings;
}

/** Za testove — vraća podrazumevana podešavanja u keš (ne dira bazu). */
export function resetSiteSettingsCache(): void {
  currentSettings = { ...DEFAULT_SITE_SETTINGS };
}
