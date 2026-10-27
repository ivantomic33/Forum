/**
 * i18n — SKELA `sr` + `en`
 * -----------------------
 * Cilj nije prepisivanje celog sajta preko noći (stotine stringova u JSX-u), nego
 * jedan sloj koji novi kod može da koristi odmah, a stari postepeno:
 *
 *   const t = useT();
 *   <h2>{t('thread.followEmailOn')}</h2>
 *
 * Pravila:
 *  - ključ je `oblast.kljuc` (tačka = hijerarhija), vrednost je string ili broj;
 *  - `en` mora imati SVE ključeve iz `sr` — test `server/tests/i18n.test.ts` pada
 *    ako neki nedostaje (prevod koji tiho pokazuje srpski je gori od neprevoda);
 *  - `{ime}` se zamenjuje parametrima: `t('thread.followEmailOn', { count: 3 })`;
 *  - izbor jezika: `localStorage['nexus.locale']` → `navigator.language` → `sr`.
 *    `sr` je default jer je portal na srpskom i postojeći saobraćaj je srpski.
 *  - jezik je reaktivan preko `useSyncExternalStore` (izmena u jednoj komponenti
 *    menja ceo sajt bez reload-a).
 */

import { useSyncExternalStore } from 'react';

export const LOCALES = ['sr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'sr';
const STORAGE_KEY = 'nexus.locale';

/** Srpski je izvor istine za ključeve; `en` je prevod. */
export const messages = {
  sr: {
    'common.loading': 'Učitavanje…',
    'common.cancel': 'Otkaži',
    'common.save': 'Sačuvaj',
    'common.remove': 'Ukloni',
    'common.close': 'Zatvori',
    'common.delete': 'Obriši',
    'common.edit': 'Izmeni',
    'common.confirm': 'Potvrdi',
    'common.retry': 'Pokušaj ponovo',
    'common.back': 'Nazad',
    'common.share': 'Podeli',
    'common.report': 'Prijavi',
    'common.error': 'Došlo je do greške.',
    'common.search': 'Pretraga',
    'common.saving': 'Čuvanje…',
    'common.sending': 'Slanje…',
    'common.loadingMore': 'Učitavam još…',
    'common.copied': 'Link je kopiran!',
    'common.copyFailed': 'Kopiranje nije uspelo.',
    'nav.home': 'Sve vesti',
    'nav.forum': 'Forum',
    'nav.deals': 'Popusti',
    'nav.pcGaming': 'PC Gaming',
    'nav.consoles': 'Konzole',
    'nav.esports': 'Esports',
    'nav.hardware': 'Hardver',
    'nav.leaderboard': 'Rang lista',
    'nav.community': 'Zajednica',
    'nav.topMembers': 'Top članovi',
    'nav.sections': 'Rubrike',
    'nav.language': 'Jezik',
    'nav.myProfile': 'Moj profil',
    'nav.quests': 'Kvestovi i bedževi',
    'nav.moderation': 'Moderacioni red',
    'nav.adminPanel': 'Admin panel',
    'nav.logout': 'Odjavi se',
    'nav.login': 'Prijava',
    'nav.register': 'Registruj se',
    'nav.menuOpen': 'Otvori meni',
    'nav.menuClose': 'Zatvori meni',
    'nav.searchPlaceholder': 'Pretraži članke, forum i popuste…',
    'nav.searchLabel': 'Pretraga foruma',
    'nav.dealsNew': '{count} nova popusta',
    'thread.follow': 'Prati temu',
    'thread.following': 'Pratite',
    'thread.unfollow': 'Otprati temu',
    'thread.followEmailOn': 'Mejl',
    'thread.followEmailOff': 'Mejl isključen',
    'thread.followEmailHint': 'Mejl o novim odgovorima više se ne šalje — notifikacije stižu u aplikaciji.',
    'thread.emailUnsubscribed': 'Notifikacije o odgovorima stižu u aplikaciji.',
    'auth.trustDevice': 'Zapamti ovaj uređaj 30 dana (ne traži kod sledeći put)',
    'auth.remember': 'Zapamti moju prijavu (7 dana)',
    'auth.sideLoginHint': 'Prijavite se da biste komentarisali, sačuvali vesti i prilagodili svoj gaming profil.',
    'auth.sideRegisterHint': 'Kreirajte nalog i pridružite se gejming zajednici.',
    'auth.termsRequired': 'Morate prihvatiti uslove korišćenja i politiku privatnosti da biste se registrovali.',
    'auth.passwordsMismatch': 'Lozinke se ne poklapaju.',
    'auth.usernameTaken': 'Korisničko ime je već zauzeto.',
    'auth.usernameFree': 'Korisničko ime je slobodno.',
    'auth.emailTaken': 'Email adresa je već registrovana.',
    'auth.captchaWait': 'Sačekajte da se završi provera „nisam robot“ i pokušajte ponovo.',
    'auth.loginFailed': 'Greška pri prijavi.',
    'auth.registerFailed': 'Greška pri registraciji.',
    'auth.totpInvalid': 'Kod nije prihvaćen. Pokušajte ponovo.',
    'auth.passwordWeak': 'Lozinka ne ispunjava zahteve.',
    'auth.hidePassword': 'Sakrij lozinku',
    'auth.showPassword': 'Prikaži lozinku',
    'auth.forgotPassword': 'Zaboravili ste lozinku?',
    'auth.ageConfirm': 'Potvrdite da imate najmanje 15 godina.',
    'security.trustedDevices': 'Zapamćeni uređaji',
    'security.trustedDevicesCount': 'Zapamćeni uređaji ({count})',
    'security.trustedDevicesHint':
      'Na ovim uređajima prijava ne traži kod do {days} dana od poslednje prijave. Ukraden telefon ili laptop uklonite odmah.',
    'security.forgetAll': 'Zaboravi sve',
    'security.forgetDevice': 'Ukloni',
    'security.noTrustedDevices': 'Nema zapamćenih uređaja — kod se traži pri svakoj prijavi.',
    'security.lastLogin': 'Poslednja prijava',
    'security.validUntil': 'Važi do',
    'security.thisDevice': 'ovaj uređaj',
    'crop.title': 'Iseci sliku',
    'crop.hint': 'Prevuci sliku da kadriraš, pa podesi zumiranje. Izlaz do {max}px.',
    'crop.confirm': 'Iseci i otpremi',
    'crop.progress': 'Sečem…',
    'crop.zoom': 'Zumiranje slike',
    'crop.reset': 'Vrati sliku na početnu poziciju',
    'lightbox.open': 'Pregled slike',
    'lightbox.close': 'Zatvori pregled slike',
    'lightbox.prev': 'Prethodna slika',
    'lightbox.next': 'Sledeća slika',
    'lightbox.zoomIn': 'Uvećaj',
    'lightbox.zoomOut': 'Normalna veličina',
    'lightbox.zoomHint': 'Uvećaj (skrol ili dupli klik)',
    'lightbox.openOriginal': 'Otvori original u novom tabu',
    'lightbox.unavailable': 'Slika nije dostupna.',
    'newsletter.schedule': 'Zakaži za (opciono)',
    'newsletter.subjectB': 'Naslov B (A/B test, opciono)',
    'newsletter.scheduleCta': 'Zakaži kampanju',
    'newsletter.sendCta': 'Pošalji pretplatnicima',
    'newsletter.scheduled': 'Zakazane kampanje',
    'newsletter.statusSent': 'poslato ({count})',
    'newsletter.statusScheduled': 'zakazano',
    'newsletter.statusFailed': 'neuspešno',
    'newsletter.statusMissed': 'propušteno',
    'reports.reportTarget': 'Prijavi',
    'reports.title': 'Prijavi sadržaj',
    'reports.submitted': 'Prijava je poslata. Hvala!',
    'reports.subtitle': 'Moderator će pregledati prijavu. Zloupotreba prijava može dovesti do sankcija.',
    'reports.reason': 'Razlog',
    'reports.note': 'Dodatno objašnjenje (opciono)',
    'reports.notePlaceholder': 'Kratko opišite problem…',
    'reports.send': 'Pošalji prijavu',
    'reports.minReason': 'Razlog mora imati najmanje 10 karaktera.',
    'reports.failed': 'Prijava nije poslata. Pokušajte ponovo.',
    'reports.reasonSpam': 'Spam / reklamiranje',
    'reports.reasonHarassment': 'Uznemiravanje / govor mržnje',
    'reports.reasonOffTopic': 'Potpuno van teme',
    'reports.reasonIllegal': 'Nezakonit sadržaj',
    'reports.reasonSpoiler': 'Nenajavljen spojler',
    'reports.reasonOther': 'Drugo',
    'reports.tooltip': 'Prijavi sadržaj moderatorima',
    'guides.sectionTitle': 'Vodiči',
    'guides.writeCta': 'Napiši vodič',
    'guides.empty': 'Još nema vodiča za ovu igru',
    'guides.emptyHint': 'Budi prvi — napiši walkthrough, build ili savet i pomozi ostalim igračima.',
    'guides.sortTop': 'Najbolji',
    'guides.sortNewest': 'Najnoviji',
    'guides.allCategories': 'Sve kategorije',
    'guides.categoryWalkthrough': 'Walkthrough',
    'guides.categoryBuilds': 'Builds',
    'guides.categoryAchievements': 'Dostignuća',
    'guides.categoryTips': 'Tips & Tricks',
    'guides.categoryGeneral': 'Opšti',
    'guides.published': 'Vodič je objavljen!',
    'guides.views': '{count} pregleda',
    'guides.yourGuide': 'Tvoj vodič',
    'guides.helpful': 'Da li ti je ovaj vodič pomogao?',
    'guides.voteUp': 'Glasaj za vodič',
    'guides.voteDown': 'Glasaj protiv vodiča',
    'guides.newTitle': 'Novi vodič — {game}',
    'guides.share': 'Podeli znanje sa zajednicom.',
    'guides.titleLabel': 'Naslov (10–160 znakova)',
    'guides.titlePlaceholder': 'npr. Kako preći misiju X bez gubitka saveznika',
    'guides.categoryLabel': 'Kategorija',
    'guides.summaryLabel': 'Kratak opis (opciono, do 300 znakova — ide u meta description)',
    'guides.contentLabel': 'Sadržaj (najmanje 200 znakova)',
    'guides.contentPlaceholder': 'Detaljno opiši postupak, build ili savet…',
    'guides.publishCta': 'Objavi vodič',
    'guides.publishFailed': 'Objavljivanje vodiča nije uspelo.',
    'auth.loginRequiredVote': 'Prijavi se da bi glasao.',
    'guides.notAvailable': 'Vodič nije dostupan.',
    'guides.notFound': 'Vodič nije pronađen',
    'guides.notFoundHint': 'Vodič je možda obrisan ili link nije tačan.',
    'guides.loading': 'Učitavanje vodiča…',
    'games.notFound': 'Igra nije pronađena',
    'games.notFoundHint': 'Ova igra još nema stranicu na NEXUS-u.',
    'games.allDeals': '← Svi popusti',
    'games.dealsSection': 'Aktivni deals za ovu igru',
    'games.dealsEmpty': 'Trenutno nema aktivnih popusta',
    'games.dealsEmptyHint': 'Pronašao si akciju? Podeli je i pomozite drugima da kupe jeftinije.',
    'games.dealCta': 'Objavi deal za ovu igru',
    'games.communityDeals': 'Svi dealovi u zajednici',
    'games.activeDeals': '{count, plural, one {# aktivan deal} few {# aktivna deal-a} other {# aktivnih deal-ova}}',
    'games.bestPrice': 'Najniže: {price}',
    'games.coverAdd': 'Dodaj cover',
    'games.coverReplace': 'Zameni cover',
    'games.coverUploading': 'Otpremam…',
    'games.coverUpdated': 'Cover je ažuriran.',
    'games.coverFailed': 'Cover nije sačuvan.',
    'games.breadcrumbDeals': 'Popusti',
    'games.breadcrumbGames': 'Igre',
    'auth.loginTitle': 'Prijava',
    'auth.registerTitle': 'Registracija',
    'common.aria': 'Pristupačnost',
  },
  en: {
    'common.loading': 'Loading…',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.remove': 'Remove',
    'common.close': 'Close',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.confirm': 'Confirm',
    'common.retry': 'Try again',
    'common.back': 'Back',
    'common.share': 'Share',
    'common.report': 'Report',
    'common.error': 'Something went wrong.',
    'common.search': 'Search',
    'common.saving': 'Saving…',
    'common.sending': 'Sending…',
    'common.loadingMore': 'Loading more…',
    'common.copied': 'Link copied!',
    'common.copyFailed': 'Copy failed.',
    'nav.home': 'All news',
    'nav.forum': 'Forum',
    'nav.deals': 'Deals',
    'nav.pcGaming': 'PC Gaming',
    'nav.consoles': 'Consoles',
    'nav.esports': 'Esports',
    'nav.hardware': 'Hardware',
    'nav.leaderboard': 'Leaderboard',
    'nav.community': 'Community',
    'nav.topMembers': 'Top members',
    'nav.sections': 'Sections',
    'nav.language': 'Language',
    'nav.myProfile': 'My profile',
    'nav.quests': 'Quests & badges',
    'nav.moderation': 'Moderation queue',
    'nav.adminPanel': 'Admin panel',
    'nav.logout': 'Sign out',
    'nav.login': 'Sign in',
    'nav.register': 'Register',
    'nav.menuOpen': 'Open menu',
    'nav.menuClose': 'Close menu',
    'nav.searchPlaceholder': 'Search articles, forum and deals…',
    'nav.searchLabel': 'Forum search',
    'nav.dealsNew': '{count} new deals',
    'thread.follow': 'Follow thread',
    'thread.following': 'Following',
    'thread.unfollow': 'Unfollow thread',
    'thread.followEmailOn': 'Email',
    'thread.followEmailOff': 'Email off',
    'thread.followEmailHint': 'Email on new replies is no longer sent — notifications arrive in the app.',
    'thread.emailUnsubscribed': 'Reply notifications arrive in the app.',
    'auth.trustDevice': 'Remember this device for 30 days (skip the code next time)',
    'auth.remember': 'Keep me signed in (7 days)',
    'auth.sideLoginHint': 'Sign in to comment, save articles and customize your gaming profile.',
    'auth.sideRegisterHint': 'Create an account and join the gaming community.',
    'auth.termsRequired': 'You must accept the terms of use and privacy policy to register.',
    'auth.passwordsMismatch': 'Passwords do not match.',
    'auth.usernameTaken': 'Username is already taken.',
    'auth.usernameFree': 'Username is available.',
    'auth.emailTaken': 'Email address is already registered.',
    'auth.captchaWait': 'Wait for the captcha to finish and try again.',
    'auth.loginFailed': 'Sign-in failed.',
    'auth.registerFailed': 'Registration failed.',
    'auth.totpInvalid': 'Code rejected. Please try again.',
    'auth.passwordWeak': 'Password does not meet the requirements.',
    'auth.hidePassword': 'Hide password',
    'auth.showPassword': 'Show password',
    'auth.forgotPassword': 'Forgot your password?',
    'auth.ageConfirm': 'Confirm that you are at least 15 years old.',
    'security.trustedDevices': 'Remembered devices',
    'security.trustedDevicesCount': 'Remembered devices ({count})',
    'security.trustedDevicesHint':
      'Signing in on these devices skips the code for {days} days after the last sign-in. Remove a lost phone or laptop immediately.',
    'security.forgetAll': 'Forget all',
    'security.forgetDevice': 'Remove',
    'security.noTrustedDevices': 'No remembered devices — the code is required on every sign-in.',
    'security.lastLogin': 'Last sign-in',
    'security.validUntil': 'Valid until',
    'security.thisDevice': 'this device',
    'crop.title': 'Crop image',
    'crop.hint': 'Drag to frame the image, then adjust the zoom. Output up to {max}px.',
    'crop.confirm': 'Crop and upload',
    'crop.progress': 'Cropping…',
    'crop.zoom': 'Image zoom',
    'crop.reset': 'Reset image position',
    'lightbox.open': 'Image preview',
    'lightbox.close': 'Close image preview',
    'lightbox.prev': 'Previous image',
    'lightbox.next': 'Next image',
    'lightbox.zoomIn': 'Zoom in',
    'lightbox.zoomOut': 'Actual size',
    'lightbox.zoomHint': 'Zoom in (scroll or double-click)',
    'lightbox.openOriginal': 'Open original in a new tab',
    'lightbox.unavailable': 'Image unavailable.',
    'newsletter.schedule': 'Schedule for (optional)',
    'newsletter.subjectB': 'Subject B (A/B test, optional)',
    'newsletter.scheduleCta': 'Schedule campaign',
    'newsletter.sendCta': 'Send to subscribers',
    'newsletter.scheduled': 'Scheduled campaigns',
    'newsletter.statusSent': 'sent ({count})',
    'newsletter.statusScheduled': 'scheduled',
    'newsletter.statusFailed': 'failed',
    'newsletter.statusMissed': 'missed',
    'reports.reportTarget': 'Report',
    'reports.title': 'Report content',
    'reports.submitted': 'Report submitted. Thank you!',
    'reports.subtitle': 'A moderator will review the report. Abuse of reports can lead to sanctions.',
    'reports.reason': 'Reason',
    'reports.note': 'Additional explanation (optional)',
    'reports.notePlaceholder': 'Briefly describe the problem…',
    'reports.send': 'Send report',
    'reports.minReason': 'The reason must be at least 10 characters.',
    'reports.failed': 'Report not sent. Please try again.',
    'reports.reasonSpam': 'Spam / advertising',
    'reports.reasonHarassment': 'Harassment / hate speech',
    'reports.reasonOffTopic': 'Completely off topic',
    'reports.reasonIllegal': 'Illegal content',
    'reports.reasonSpoiler': 'Unmarked spoiler',
    'reports.reasonOther': 'Other',
    'reports.tooltip': 'Report content to moderators',
    'guides.sectionTitle': 'Guides',
    'guides.writeCta': 'Write a guide',
    'guides.empty': 'No guides for this game yet',
    'guides.emptyHint': 'Be the first — write a walkthrough, build or tip and help other players.',
    'guides.sortTop': 'Best',
    'guides.sortNewest': 'Newest',
    'guides.allCategories': 'All categories',
    'guides.categoryWalkthrough': 'Walkthrough',
    'guides.categoryBuilds': 'Builds',
    'guides.categoryAchievements': 'Achievements',
    'guides.categoryTips': 'Tips & Tricks',
    'guides.categoryGeneral': 'General',
    'guides.published': 'Guide published!',
    'guides.views': '{count} views',
    'guides.yourGuide': 'Your guide',
    'guides.helpful': 'Did this guide help you?',
    'guides.voteUp': 'Upvote guide',
    'guides.voteDown': 'Downvote guide',
    'guides.newTitle': 'New guide — {game}',
    'guides.share': 'Share your knowledge with the community.',
    'guides.titleLabel': 'Title (10–160 characters)',
    'guides.titlePlaceholder': 'e.g. How to beat mission X without losing allies',
    'guides.categoryLabel': 'Category',
    'guides.summaryLabel': 'Short summary (optional, up to 300 characters — used as meta description)',
    'guides.contentLabel': 'Content (at least 200 characters)',
    'guides.contentPlaceholder': 'Describe the walkthrough, build or tip in detail…',
    'guides.publishCta': 'Publish guide',
    'guides.publishFailed': 'Publishing the guide failed.',
    'auth.loginRequiredVote': 'Sign in to vote.',
    'guides.notAvailable': 'Guide unavailable.',
    'guides.notFound': 'Guide not found',
    'guides.notFoundHint': 'The guide may have been deleted or the link is incorrect.',
    'guides.loading': 'Loading guide…',
    'games.notFound': 'Game not found',
    'games.notFoundHint': 'This game does not have a NEXUS page yet.',
    'games.allDeals': '← All deals',
    'games.dealsSection': 'Active deals for this game',
    'games.dealsEmpty': 'No active deals right now',
    'games.dealsEmptyHint': 'Found an offer? Share it and help others buy cheaper.',
    'games.dealCta': 'Post a deal for this game',
    'games.communityDeals': 'All community deals',
    'games.activeDeals': '{count, plural, one {# active deal} few {# active deals} other {# active deals}}',
    'games.bestPrice': 'Best: {price}',
    'games.coverAdd': 'Add cover',
    'games.coverReplace': 'Replace cover',
    'games.coverUploading': 'Uploading…',
    'games.coverUpdated': 'Cover updated.',
    'games.coverFailed': 'Cover not saved.',
    'games.breadcrumbDeals': 'Deals',
    'games.breadcrumbGames': 'Games',
    'auth.loginTitle': 'Sign in',
    'auth.registerTitle': 'Register',
    'common.aria': 'Accessibility',
  },
} as const;

export type MessageKey = keyof (typeof messages)['sr'];
export type TParams = Record<string, string | number>;

/* ----------------------------- state ----------------------------- */

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** Jezik iz `localStorage` → `navigator.language` → `sr`. */
export function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // privatni režim / blokiran storage — nije greška
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  if (nav?.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

export function initLocale(): Locale {
  if (typeof window !== 'undefined') current = detectLocale();
  applyDocumentLang(current);
  return current;
}

function applyDocumentLang(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'sr' ? 'sr-Latn-RS' : 'en';
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === current) return;
  current = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage nedostupan — jezik važi do reload-a
  }
  applyDocumentLang(locale);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ----------------------------- translate ----------------------------- */

const interpolate = (template: string, params?: TParams) =>
  params
    ? template.replace(/\{(\w+)\}/g, (match, key) => (params[key] !== undefined ? String(params[key]) : match))
    : template;

/**
 * Prevod jednog ključa. Nepoznat ključ se vraća kao sam ključ (vidljivo u UI-ju,
 * ali nikad `undefined`), a nedostajući prevod pada na `sr` — nikad na prazan string.
 */
export function translate(locale: Locale, key: MessageKey, params?: TParams): string {
  const dict = messages[locale] as Record<string, string>;
  const fallback = messages[DEFAULT_LOCALE] as Record<string, string>;
  return interpolate(dict[key] ?? fallback[key] ?? key, params);
}

export function t(key: MessageKey, params?: TParams): string {
  return translate(current, key, params);
}

/** Reaktivni `t` — komponenta se ponovo renderuje kada se jezik promeni. */
export function useT() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);
  return (key: MessageKey, params?: TParams) => translate(locale, key, params);
}

/** Za formate datuma/broja (`sr-Latn-RS`, `en-US`). */
export const localeTag = (locale: Locale = current) => (locale === 'sr' ? 'sr-Latn-RS' : 'en-US');
