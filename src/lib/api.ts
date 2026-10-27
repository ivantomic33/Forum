/**
 * NEXUS API CLIENT
 * Typed fetch wrapper za komunikaciju sa Express backendom.
 *
 * F-32 — JWT više ne postoji u `localStorage`: server ga šalje u `HttpOnly`
 * cookie-ju koji JavaScript ne može da pročita. Mutirajući zahtevi nose
 * `X-CSRF-Token` pročitan iz `nx_csrf` cookie-ja (double-submit zaštita).
 */

/**
 * U razvoju Vite proxy prosleđuje `/api` na localhost:4000.
 * U produkciji postavi `VITE_API_URL` (npr. https://api.nexus.rs) ili koristi
 * reverse proxy koji servira `/api` sa istog domena.
 */
const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

/**
 * N10 — OBLIK PODATAKA DOLAZI IZ `contracts/`.
 *
 * Ranije su ovde stajali ručno pisani `interface`-i i `request<{ articles: any[] }>`;
 * promena polja na serveru nije pomerila TypeScript na klijentu. Sada su tipovi
 * `z.infer` iz istog modula koji rute koriste za (tipizovane) odgovore.
 */
export type {
  /** Rezultat ankete (GET /api/forum/threads/:id → poll, POST …/poll/vote). */
  PollResult,
  /** 2.6.0 — javni oblik deal-a (`GET /api/deals`). */
  Deal,
  DealSort,
  DealQuery,
  /** 2.6.0 — igra iz kataloga (Game Page `/games/:slug`). */
  Game,
  IgdbGame,
  Article,
  ArticleInput,
  ArticleComment,
  ArticleListResponse,
  ArticleCommentsResponse,
  TickerItem,
  /** F-1 — „Danas u gamingu“ (`GET /api/deals/daily`). */
  DailyFeedResponse,
  HomeThread,
  /** F-4 — praćenje cene igre. */
  PriceWatch,
  /** F-5 — korisnička lista igara. */
  GameCollection,
  /** F-2 — dnevni loop. */
  DailyLoopResponse,
  /** F-10 — upozorenje moderatora. */
  UserWarning,
  /** F-10 — lista upozorenja + broj aktivnih. */
  WarningListResponse,
  ArticleReactionType,
  Thread,
  Reply,
  ThreadSort,
  ThreadDetailResponse,
  ThreadListResponse,
  Subforum,
  CategoriesResponse,
  Notification,
  NotificationListResponse,
  Report,
  ReportListResponse,
  ReportTargetType,
  PublicUser,
  OwnerUser,
  UserRole,
  PresenceStatus,
  Quest,
  UserActivity,
  UserLeaderboardResponse,
  UserSavedResponse,
  QuestListResponse,
  Subscriber,
  SubscriberListResponse,
  SubscriberSegment,
  AdminSettings,
  AdminStats,
  AuditEntry,
  MediaItem,
  SearchHit,
  SearchScope,
  UploadResult,
} from '../../contracts/index';

import type {
  ApiError as ApiErrorBody,
  PublicAdminSettings,
  Article,
  ArticleComment,
  ArticleCommentsResponse,
  ArticleInput,
  ArticleListResponse,
  ArticleReactionType,
  CategoriesResponse,
  Deal,
  DealQuery,
  DealSort,
  Game,
  IgdbGame,
  MediaItem,
  NotificationListResponse,
  OwnerUser,
  AdminSettings,
  AdminStats,
  AuditEntry,
  Reply,
  ReportTargetType,
  PollResult,
  PublicUser,
  QuestListResponse,
  Report,
  ReportListResponse,
  SearchHit,
  SearchScope,
  SubscriberListResponse,
  ThreadDetailResponse,
  ThreadListResponse,
  TickerItem,
  DailyFeedResponse,
  PriceWatch,
  DailyLoopResponse,
  GameCollection,
  UserWarning,
  WarningListResponse,
  UploadResult,
  UserActivityResponse,
  UserLeaderboardResponse,
  DmConversation,
  DmListResponse,
  DmMessage,
  DmThreadResponse,
  UserFollowStatus,
  UserSavedResponse,
  Thread,
  Guide,
  GuidesListResponse,
  GuideDetailResponse,
  GuideVoteResponse,
  GuestbookEntry,
  GuestbookResponse,
  AdminHealth,
} from '../../contracts/index';

export type ApiError = ApiErrorBody;

/**
 * 2.11.0 — mejl kanal notifikacija (`GET/PUT /api/notifications/email-prefs`).
 * Kanal je ugašen (mejl samo za verifikaciju i reset lozinke), pa je
 * `availableTypes` prazan; ostalo je radi kompatibilnosti odgovora.
 */
/** 6.x — tiši sati (lokalno vreme korisnika, uz offset iz browsera). */
export interface QuietHours {
  from: string;
  to: string;
  tzOffsetMinutes: number;
}

/** 6.x — `GET/PUT /api/notifications/prefs`. */
export interface NotificationPrefs {
  quietHours: QuietHours | null;
  pushMuted: string[];
  /** Tipovi koje korisnik može da isključi za push (zvonce uvek radi). */
  availableTypes?: string[];
  pushConfigured?: boolean;
}

export interface NotificationEmailPrefs {
  enabled: boolean;
  muted: string[];
  /** `false` kada server nema RESEND/BREVO ključ — UI prikazuje napomenu. */
  providerConfigured: boolean;
  availableTypes?: string[];
}

/* ------------------------- F-11 — BUILD UI TIPOVI -------------------------
 * Server vraća `part.component` + `qty`/`subtotal`; ovo je oblik koji UI
 * stvarno dobija (runtime validacija je u ruti, ovde je tip za `tsc`).
 */
export interface BuildComponent {
  id: string;
  category: 'cpu' | 'gpu' | 'motherboard' | 'ram' | 'storage' | 'psu' | 'case' | 'cooler' | 'monitor' | 'peripheral';
  name: string;
  brand: string | null;
  spec: string | null;
  price: number;
  currency: string;
  store: string;
  url: string | null;
  imageUrl?: string | null;
}

export interface SharedBuild {
  id: string;
  shareId: string;
  title: string;
  isPublic: boolean;
  createdAt: string;
  total: number;
  missing: string[];
  complete: boolean;
  parts: { component: BuildComponent; qty: number; subtotal: number }[];
}


/** CSRF token iz čitljivog (ne HttpOnly) cookie-ja `nx_csrf`. */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)nx_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * B-04 — briše zastareli `nx_csrf` cookie na klijentu.
 * CSRF cookie živi koliko i refresh token (do 7 dana), a access token samo 15 min.
 * Kada sesija „tiho“ padne, stari CSRF token bi ostao i sledeći mutirajući
 * zahtev bi dobio 403 umesto 401 (pogrešna poruka u UI-ju).
 */
export function clearCsrfCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = 'nx_csrf=; Max-Age=0; path=/; SameSite=Lax';
  clearSessionFlag();
}

/**
 * N-01 — gost nema šta da pita server: bez `nx_sid` (javni marker sesije koji
 * postavlja server), `nx_csrf` ili traga sesije u tabu `/auth/me` i
 * `/auth/refresh` su garantovani 401, pa se preskaču.
 *
 * Kompromis: marker može da preživi opozvanu refresh sesiju (npr. odjava sa
 * drugog uređaja). Prvi zahtev tada dobije 401, `request()` uradi refresh,
 * refresh odbije sesiju i klijent je očisti — to je JEDAN neminovan 401, ne 25.
 * Gost bez marker-a ne pravi nijedan.
 */
const SESSION_FLAG_KEY = 'nx_session';

/** `nx_sid` — javni marker sesije (bez tajni), postavlja ga `setSessionCookies`. */
export function readSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|;\s*)nx_sid=/.test(document.cookie);
}

export function readSessionFlag(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSessionFlag(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG_KEY, '1');
  } catch {
    // Privatni režim bez storage-a — cookie je i dalje izvor istine.
  }
}

export function clearSessionFlag(): void {
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // ignore
  }
}

/** Postoji li u ovom tabu ikakav trag sesije (CSRF cookie ili flag). */
export function hasSessionHint(): boolean {
  return Boolean(readCsrfToken()) || readSessionFlag() || readSessionCookie();
}

/**
 * Jedan zajednički refresh zahtev kada više poziva istovremeno dobije 401.
 * Bez ovoga bi 10 paralelnih zahteva rotiralo refresh token 10 puta — a druga
 * rotacija bi bila prepoznata kao „ponovna upotreba“ i opozvala bi sesiju.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  // N-01 — bez ikakvog traga sesije refresh bi uvek vratio 401; nemoj ni da ga zoveš.
  if (!hasSessionHint()) return Promise.resolve(false);
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': readCsrfToken() ?? '' },
    })
      .then(async (res) => {
        if (!res.ok) return false;
        // N-01 — `refresh` već vraća korisnika: nema potrebe za zasebnim `/auth/me`.
        const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
        if (data?.user) onSessionRefreshed?.(data.user);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Poziva se kada request dobije odgovor refresh-a koji nosi korisnika (N-01). */
let onSessionRefreshed: ((user: unknown) => void) | null = null;
export function setSessionRefreshedHandler(handler: ((user: unknown) => void) | null) {
  onSessionRefreshed = handler;
}

/** Poziva se kada sesija definitivno više ne postoji (refresh je odbijen). */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

/** Gubi sesiju na klijentu: skini CSRF cookie i obavesti store (redosled je bitan). */
function dropLocalSession(): void {
  clearCsrfCookie();
  onSessionLost?.();
}

/**
 * Slike iz eksternih izvora koje su u članku same po sebi bezbedne: naš
 * Storage bucket i IGDB. `ArticleImage` u Tiptap-u prima samo ove — nikakav
 * proizvoljni host (i dalje može da se doda URL, ali editor ga obara).
 */
export function isTrustedImageUrl(url: string): boolean {
  return /\/storage\/v1\/object\/public\//.test(url) || /^https:\/\/images\.igdb\.com\//i.test(url);
}

/**
 * Multipart upload (2.6.2). Ne postavlja `Content-Type` — browser dodaje
 * `multipart/form-data; boundary=…`. CSRF ide kao i za ostale mutacije.
 */
async function uploadRequest<T>(path: string, file: File | Blob, fileName?: string, retry = true): Promise<T> {
  const form = new FormData();
  // Sečena slika je `Blob` iz canvas-a — ime joj dajemo da server dobije ispravan
  // nastavak (`.webp`), inače bi `File.name` bio prazan.
  form.append('file', file, fileName ?? (file instanceof File ? file.name : 'slika.webp'));
  const csrf = readCsrfToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    headers: csrf ? { 'X-CSRF-Token': csrf } : {},
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && retry && (await refreshSession())) {
      return uploadRequest<T>(path, file, fileName, false);
    }
    if (res.status === 401) dropLocalSession();
    throw new Error((data as ApiError)?.error || `Upload nije uspeo (${res.status})`);
  }
  return data as T;
}

/**
 * 5.2 — samo za WebAuthn rute: status i detalji se čitaju bez bacanja.
 * Passkey tok mora sam da preskoči tiho obnavljanje sesije (nema je) i da
 * razlikuje „nema sesije“ (401) od „nema passkey-a“ (404).
 */
export async function authRequest<T = any>(
  path: string,
  options: RequestInit & { skipRetry?: boolean } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const { skipRetry: _skip, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const csrf = readCsrfToken();
  const headers: Record<string, string> = {
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
    ...(method !== 'GET' && method !== 'HEAD' && csrf ? { 'X-CSRF-Token': csrf } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const csrf = readCsrfToken();
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
    ...(method !== 'GET' && method !== 'HEAD' && csrf ? { 'X-CSRF-Token': csrf } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data && (data as ApiError).error) || `Greška (${res.status})`;
    const code = (data as any)?.code;

    // B-04 — zastareli CSRF cookie uz nevažeću sesiju vraća 403. Pokušaj osvežavanje
    // (jednom) da bi korisnik dobio 401/novi CSRF token, umesto pogrešne poruke.
    if (res.status === 403 && code === 'CSRF_FAILED' && retry && !path.startsWith('/auth/refresh')) {
      if (await refreshSession()) {
        return request<T>(path, options, false);
      }
      dropLocalSession();
    }

    // N-04 — server je eksplicitno poništio sesiju („odjavi se svuda“, ban,
    // reset lozinke). Refresh bi samo rotirao token koji je već mrtav, pa se
    // sesija čisti odmah — promena važi u sledećem zahtevu, ne za 15 min.
    const sessionRevoked = res.headers.get('X-Session-Revoked') === '1' || code === 'SESSION_REVOKED';
    if (res.status === 401 && (sessionRevoked || code === 'REFRESH_REUSED')) {
      dropLocalSession();
    }

    // Access token je istekao (15 min) — tiho obnovi sesiju i ponovi TAČNO jednom.
    // `NO_SESSION`/`SESSION_EXPIRED` posle refresh-a znače da je sesija gotova.
    if (
      res.status === 401 &&
      retry &&
      !sessionRevoked &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/login')
    ) {
      if (await refreshSession()) {
        return request<T>(path, options, false);
      }
      dropLocalSession();
    }

    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = res.status;
    error.code = code;
    throw error;
  }

  return data as T;
}

export const api = {
  // === AUTH ===
  auth: {
    /** Javna konfiguracija (Turnstile, dostupni OAuth provajderi). */
    config: () =>
      request<{
        turnstile: { enabled: boolean; siteKey: string };
        oauthProviders: Array<'discord' | 'google' | 'steam'>;
        twoFactorAvailable: boolean;
      }>('/auth/config'),
    register: (payload: {
      username: string;
      email: string;
      password: string;
      acceptedTerms: boolean;
      ageConfirmed: boolean;
      captchaToken?: string | null;
    }) =>
      request<{ user: OwnerUser; csrfToken: string; verificationRequired?: boolean; verificationToken?: string }>(
        '/auth/register',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    /**
     * Prijava: ili vraća ulogovanog korisnika (sesija je u cookie-ju),
     * ili 2FA izazov (`requires2fa` + `mfaTicket`) koji se rešava sa `login2fa`.
     */
    login: (payload: {
      email: string;
      password: string;
      rememberMe?: boolean;
      captchaToken?: string | null;
      /** F-15 — proveri trusted uređaj (cookie `nx_trust`) pre 2FA koraka. */
      trustDevice?: boolean;
    }) =>
      request<
        | {
            user: OwnerUser;
            csrfToken: string;
            rememberMe?: boolean;
            trustedDevice?: boolean;
            /** 5.3 — dnevni login bonus (streak), samo ako je prvi put danas. */
            loginBonus?: { xp: number; streak: number } | null;
            loginStreak?: number;
          }
        | {
            requires2fa: true;
            mfaTicket: string;
            username: string;
            avatar?: string;
            recoveryCodesLeft: number;
            /** 5.2 — opcije za passkey kao drugi faktor. */
            passkeyOptions?: Record<string, unknown> | null;
          }
      >('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    login2fa: (payload: {
      mfaTicket: string;
      code: string;
      rememberMe?: boolean;
      captchaToken?: string | null;
      /** F-15 — „zapamti ovaj uređaj 30 dana“. */
      trustDevice?: boolean;
    }) =>
      request<{
        user: OwnerUser;
        csrfToken: string;
        trustedDevice?: boolean;
        recoveryCodeUsed?: boolean;
        recoveryCodesLeft?: number;
        loginBonus?: { xp: number; streak: number } | null;
      }>(
        '/auth/2fa/login',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    twoFactor: {
      /** F-15 — zapamćeni uređaji (bez hash-eva). */
      devices: () =>
        request<{
          devices: Array<{ id: string; deviceId: string; userAgent: string | null; createdAt: string; expiresAt: string; lastUsedAt: string | null }>;
          currentDeviceId: string | null;
          ttlDays: number;
        }>('/auth/2fa/devices'),
      forgetDevice: (deviceId: string) =>
        request<{ removed: boolean }>(`/auth/2fa/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
      forgetAllDevices: () => request<{ removed: number }>('/auth/2fa/devices', { method: 'DELETE' }),
      status: () =>
        request<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; lockedUntil: string | null }>(
          '/auth/2fa/status',
        ),
      setup: () => request<{ secret: string; otpauthUri: string; qrCode: string }>('/auth/2fa/setup', { method: 'POST' }),
      enable: (code: string) =>
        request<{ enabled: boolean; recoveryCodes: string[]; user: OwnerUser }>('/auth/2fa/enable', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      disable: (password: string, code: string) =>
        request<{ enabled: boolean; user: OwnerUser }>('/auth/2fa/disable', {
          method: 'POST',
          body: JSON.stringify({ password, code }),
        }),
      regenerateRecoveryCodes: (password: string) =>
        request<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
          method: 'POST',
          body: JSON.stringify({ password }),
        }),
    },
    /**
     * OAuth: puna navigacija na server (redirect na Discord/Google/Steam).
     * `mode: 'link'` povezuje provajder sa TEKUĆIM nalogom.
     */
    oauthStartUrl: (provider: string, options?: { mode?: 'login' | 'link'; redirect?: string }) => {
      const params = new URLSearchParams();
      if (options?.mode === 'link') params.set('mode', 'link');
      if (options?.redirect) params.set('redirect', options.redirect);
      const qs = params.toString();
      return `${API_BASE}/auth/oauth/${encodeURIComponent(provider)}${qs ? `?${qs}` : ''}`;
    },
    oauthAccounts: () =>
      request<{ accounts: Array<{ provider: string; username: string | null; linkedAt: string | null }> }>(
        '/auth/oauth/accounts',
      ),
    oauthUnlink: (provider: string) =>
      request<{ message: string; connectedAccounts: Record<string, string> }>(
        `/auth/oauth/accounts/${encodeURIComponent(provider)}`,
        { method: 'DELETE' },
      ),
    oauthCompleteSignup: (payload: {
      ticket: string;
      username: string;
      acceptedTerms: boolean;
      ageConfirmed: boolean;
    }) =>
      request<{ user: OwnerUser; csrfToken: string }>('/auth/oauth/complete-signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    checkUsername: (username: string) =>
      request<{ available: boolean }>(
        `/auth/check-username?username=${encodeURIComponent(username)}`
      ),
    checkEmail: (email: string) =>
      request<{ available: boolean; reason: 'invalid' | 'taken' | 'disposable' | null }>(
        `/auth/check-email?email=${encodeURIComponent(email)}`
      ),
    /**
     * N-01 — `silent` preskače tiho obnavljanje: gost (nema `nx_csrf` ni flag)
     * ne sme da izazove `/auth/me` → `/auth/refresh` → 401.
     */
    me: (options?: { silent?: boolean }) =>
      request<{ user: OwnerUser }>('/auth/me', {}, options?.silent ? false : true),
    /** 5.2 — da li je korisnik aktivan (za banner „verifikuj email“). */
    verificationStatus: () =>
      request<{ isVerified: boolean; email: string }>('/auth/verification-status'),
    /** 2.6.1 — „Online sada“: server beleži prisustvo (TTL 90s). */
    heartbeat: (status: 'online' | 'away' = 'online') =>
      request<{ isOnline: boolean; status?: string; at: string }>('/auth/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    forgotPassword: (email: string, captchaToken?: string | null) =>
      request<{ message: string; resetToken?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email, captchaToken }),
      }),
    resetPassword: (token: string, password: string) =>
      request<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
    verifyEmail: (token: string) =>
      request<{ message: string; isVerified: boolean }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    peekVerifyEmail: (token: string) =>
      request<{ valid: boolean }>(`/auth/verify-email/${encodeURIComponent(token)}`),
    newsletter: {
      confirm: (token: string) =>
        request<{ message: string; unsubscribeToken?: string }>(
          `/newsletter/confirm?token=${encodeURIComponent(token)}`
        ),
    },
    // F-06 — „odjavi sve uređaje osim ovog“ (server izdaje svež cookie)
    logoutAll: () => request<{ message: string; csrfToken: string }>('/auth/logout-all', { method: 'POST' }),
    /** 5.1 — aktivne sesije (jedan red po uređaju, bez tajni). */
    sessions: () =>
      request<{
        sessions: Array<{
          id: string;
          userAgent: string | null;
          ip: string | null;
          createdAt: string;
          lastUsedAt: string | null;
          expiresAt: string;
          current: boolean;
        }>;
        count: number;
      }>('/auth/sessions'),
    /** 5.1 — odjava jedne sesije; `current: true` znači da je i ovaj uređaj odjavljen. */
    revokeSession: (id: string) =>
      request<{ revoked: boolean; current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** 5.1 — odjava sa svih uređaja (uključujući ovaj). */
    revokeAllSessions: () => request<{ revoked: boolean; all: boolean }>('/auth/sessions', { method: 'DELETE' }),
    /** 5.1 — pošalji ponovo verifikacioni mejl (30 s cooldown na serveru). */
    resendVerification: () =>
      request<{ message: string; sent: boolean }>('/auth/resend-verification', { method: 'POST' }),
    // F-09 — GDPR/ZZPL izvoz sopstvenih podataka
    exportData: () => request<Record<string, unknown>>('/users/me/export'),
    // F-09 — brisanje naloga (anonimizacija sadržaja + uklanjanje ličnih podataka)
    deleteAccount: () =>
      request<{ message: string }>('/users/me', { method: 'DELETE' }),
    logout: () =>
      request<{ message: string }>('/auth/logout', {
        method: 'POST',
      }),
  },

  // === PRESENCE (2.6.1) ===
  presence: {
    /** Početno stanje bez Realtime WebSocket-a (proxy koji ga ne propušta). */
    online: () =>
      request<{ online: string[]; statuses?: Record<string, 'online' | 'away'> }>('/presence'),
  },

  // === SEARCH (2.6.2) ===
  search: {
    all: (q: string, type: SearchScope = 'all', limit = 10) =>
      request<{
        query: string;
        type: SearchScope;
        hits: SearchHit[];
        total: number;
        /** 2.6.2 — „da li ste mislili“ (samo kad nema pogodaka). */
        suggestion?: string | null;
        tsConfig?: string;
      }>(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`),
  },

  // === UPLOADS (2.6.2 — Supabase Storage) ===
  uploads: {
    /**
     * Multipart upload — NAMERNO ne ide kroz `request()`: ona postavlja
     * `Content-Type: application/json`, a browser mora sam da doda boundary.
     * CSRF zaglavlje ostaje (double-submit).
     */
    image: (kind: 'avatar' | 'cover' | 'proof' | 'article', file: File | Blob, fileName?: string) =>
      uploadRequest<UploadResult>(`/uploads/${kind}`, file, fileName),
  },

  // === ARTICLES ===
  articles: {
    list: (params?: { category?: string; search?: string; featured?: boolean; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.category) q.set('category', params.category);
      if (params?.search) q.set('search', params.search);
      if (params?.featured !== undefined) q.set('featured', String(params.featured));
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString() ? `?${q.toString()}` : '';
      return request<ArticleListResponse>(`/articles${qs}`);
    },
    ticker: () =>
      request<{ items: Array<{ id: string; label: string; href: string; kind: 'article' | 'thread' }> }>('/articles/ticker'),
    saved: (ids: string[]) =>
      request<ArticleListResponse>('/articles/saved', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    get: (idOrSlug: string) => request<Article>(`/articles/${idOrSlug}`),
    /**
     * 2.13.0 — vremenska linija jednog događaja („Priča se razvija“).
     * 2.13.2 — `summary` je 2–3 rečenice sažetka događaja iz naslova i opisa.
     */
    byEvent: (eventId: string) =>
      request<ArticleListResponse & { eventTitle?: string; summary?: string; timeline?: Array<{ date: string; label: string }> }>(
        `/articles/event/${encodeURIComponent(eventId)}`,
      ),
    bookmark: (id: string) => request<{ bookmarked: boolean }>(`/articles/${id}/bookmark`, { method: 'POST' }),
    unbookmark: (id: string) => request<{ bookmarked: boolean }>(`/articles/${id}/bookmark`, { method: 'DELETE' }),
    bookmarks: () => request<ArticleListResponse>('/articles/bookmarks/mine'),
    comments: (id: string) => request<ArticleCommentsResponse>(`/articles/${id}/comments`),
    addComment: (id: string, content: string, parentId?: string) =>
      request<ArticleComment>(`/articles/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parentId: parentId ?? null }),
      }),
    react: (id: string, type: ArticleReactionType) =>
      request<{ reactions: Record<string, number> }>(`/articles/${id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    create: (data: ArticleInput) =>
      request<Article>('/articles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: ArticleInput) =>
      request<Article>(`/articles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ message: string }>(`/articles/${id}`, {
        method: 'DELETE',
      }),
  },

  // === FORUM ===
  forum: {
    categories: () => request<CategoriesResponse>('/forum/categories'),
    /**
     * Cursor paginacija: `nextCursor` je ID poslednje teme; `null` = nema više.
     * Ranije je frontend uvek dobijao prvih 100 tema i ignorisao `nextCursor`.
     */
    listThreads: (
      subforum = 'all',
      sort = 'hot',
      search?: string,
      options?: { limit?: number; cursor?: string | null; unsolved?: boolean },
    ) => {
      const q = new URLSearchParams({ sort });
      if (search) q.set('search', search);
      if (options?.limit) q.set('limit', String(options.limit));
      if (options?.cursor) q.set('cursor', options.cursor);
      // 6.x — „Nerešeno“: samo teme bez prihvaćenog odgovora.
      if (options?.unsolved) q.set('solved', 'no');
      return request<ThreadListResponse>(`/forum/${subforum}/threads?${q.toString()}`);
    },
    searchThreads: (
      search: string,
      sort = 'hot',
      options?: { limit?: number; cursor?: string | null; unsolved?: boolean },
    ) => {
      const q = new URLSearchParams({ sort, search });
      if (options?.limit) q.set('limit', String(options.limit));
      if (options?.cursor) q.set('cursor', options.cursor);
      if (options?.unsolved) q.set('solved', 'no');
      return request<ThreadListResponse>(`/forum/all/threads?${q.toString()}`);
    },
    getThread: (id: string) => request<ThreadDetailResponse>(`/forum/threads/${id}`),
    createThread: (
      subforum: string,
      payload: {
        title: string;
        content: string;
        tags?: string[];
        isSpoiler?: boolean;
        poll?: { question: string; options: string[] } | null;
        /** F-3 — tema otvorena iz deal-a („Diskutuj o ovom popustu“). */
        dealId?: string | null;
      },
    ) =>
      /** 8 — `awarded` nosi i `levelUp` (za konfete na profilu/forumu). */
      request<Thread & { awarded?: { xp: number; levelUp: boolean; newBadges: string[] } | null }>(
        `/forum/${subforum}/threads`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      ),
    votePoll: (threadId: string, optionIndex: number) =>
      request<PollResult>(`/forum/threads/${threadId}/poll/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionIndex }),
      }),
    createReply: (threadId: string, payload: { content: string; parentId?: string | null; isSpoiler?: boolean }) =>
      request<Reply>(`/forum/threads/${threadId}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    voteThread: (id: string, direction: 'up' | 'down' | null) =>
      request<{ karma: number }>(`/forum/threads/${id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ direction }),
      }),
    voteReply: (id: string, direction: 'up' | 'down' | null) =>
      request<{ karma: number }>(`/forum/replies/${id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ direction }),
      }),
    moderate: (id: string, payload: { isPinned?: boolean; isLocked?: boolean; deleteThread?: boolean }) =>
      request<Thread>(`/forum/threads/${id}/moderate`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    updateThread: (id: string, payload: { title?: string; content?: string; tags?: string[]; isSpoiler?: boolean }) =>
      request<Thread>(`/forum/threads/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteThread: (id: string) => request<{ message: string }>(`/forum/threads/${id}`, { method: 'DELETE' }),
    updateReply: (id: string, payload: { content?: string; isSpoiler?: boolean }) =>
      request<Reply>(`/forum/replies/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteReply: (id: string) => request<{ message: string }>(`/forum/replies/${id}`, { method: 'DELETE' }),
    /**
     * 2.11.0 — „prihvaćen odgovor“. Samo autor teme (ili staff); `'none'` odznačava.
     * Server vraća i `awardedXp` (25 samo pri PRVOM prihvatanju u temi).
     */
    acceptAnswer: (threadId: string, replyId: string | 'none') =>
      request<{ message: string; acceptedReplyId: string | null; awardedXp?: number }>(
        `/forum/threads/${threadId}/accept/${replyId}`,
        { method: 'PATCH' },
      ),
    bookmarkThread: (id: string) =>
      request<{ bookmarked: boolean }>(`/forum/threads/${id}/bookmark`, { method: 'POST' }),
    unbookmarkThread: (id: string) =>
      request<{ bookmarked: boolean }>(`/forum/threads/${id}/bookmark`, { method: 'DELETE' }),
    // F-7.1 #8 — `email: true` uključuje i mejl na novi odgovor (1 mejl / 15 min po temi).
    followThread: (id: string, options?: { email?: boolean }) =>
      request<{ following: boolean; email?: boolean }>(`/forum/threads/${id}/follow`, {
        method: 'POST',
        body: JSON.stringify({ email: options?.email === true }),
      }),
    unfollowThread: (id: string) => request<{ following: boolean }>(`/forum/threads/${id}/follow`, { method: 'DELETE' }),
    isFollowingThread: (id: string) =>
      request<{ following: boolean; email?: boolean }>(`/forum/threads/${id}/follow`),
  },

  // === DEALS (2.6.0) ===
  deals: {
    list: (params: DealQuery = {}) => {
      const q = new URLSearchParams();
      if (params.sort) q.set('sort', params.sort);
      if (params.game) q.set('game', params.game);
      if (params.gameSlug) q.set('gameSlug', params.gameSlug);
      if (params.store) q.set('store', params.store);
      if (params.platform) q.set('platform', params.platform);
      if (params.minPrice !== undefined) q.set('minPrice', String(params.minPrice));
      if (params.maxPrice !== undefined) q.set('maxPrice', String(params.maxPrice));
      if (params.minDiscount !== undefined) q.set('minDiscount', String(params.minDiscount));
      if (params.search) q.set('search', params.search);
      if (params.expiringSoon) q.set('expiringSoon', 'true');
      if (params.limit) q.set('limit', String(params.limit));
      if (params.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<{ deals: Deal[]; total: number; hasMore: boolean; sort: DealSort; limit: number; offset: number }>(
        `/deals${qs ? `?${qs}` : ''}`,
      );
    },
    /** F-1 — jedan poziv za blok „Danas u gamingu“ na početnoj (3 vesti + 2 deal-a + 2 teme). */
    daily: (excludeArticleId?: string) =>
      request<DailyFeedResponse>(
        `/deals/daily${excludeArticleId ? `?exclude=${encodeURIComponent(excludeArticleId)}` : ''}`,
      ),
    mine: () => request<{ deals: Deal[]; total: number }>('/deals/mine'),
    /** 2.6.2 — meta podaci ponude sa prodavnice (naslov, `og:image`, cena). */
    preview: (url: string) =>
      request<{
        url: string;
        title: string | null;
        imageUrl: string | null;
        price: number | null;
        currency: string | null;
        store: string | null;
        error?: string;
      }>(`/deals/preview?url=${encodeURIComponent(url)}`),
    get: (id: string) => request<{ deal: Deal }>(`/deals/${encodeURIComponent(id)}`),
    create: (payload: {
      title: string;
      url: string;
      proofUrl?: string | null;
      price: number;
      originalPrice: number;
      currency?: string;
      store: string;
      platform?: string;
      description?: string | null;
      expiresAt?: string | null;
      gameId?: string | null;
      gameTitle?: string | null;
      igdbGame?: IgdbGame | null;
    }) => request<{ deal: Deal }>('/deals', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: Record<string, unknown>) =>
      request<{ deal: Deal }>(`/deals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    remove: (id: string) =>
      request<{ message: string }>(`/deals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    vote: (id: string, direction: 'up' | 'down' | null) =>
      request<{ changed: boolean; delta: number; score: number; myVote: 'up' | 'down' | null }>(
        `/deals/${encodeURIComponent(id)}/vote`,
        { method: 'POST', body: JSON.stringify({ direction }) },
      ),
    /** F-9 — „Kupio sam“ (idempotentno). */
    claim: (id: string) =>
      request<{ claimed: boolean; count: number }>(`/deals/${encodeURIComponent(id)}/claim`, { method: 'POST' }),
    unclaim: (id: string) =>
      request<{ claimed: boolean; count: number }>(`/deals/${encodeURIComponent(id)}/claim`, { method: 'DELETE' }),
    /** F-4 — praćenje cene igre (price alert). */
    watches: () => request<{ watches: PriceWatch[] }>('/deals/watch'),
    watch: (payload: { gameId?: string; gameSlug?: string; gameTitle?: string; targetPrice: number; currency?: string }) =>
      request<{ watch: PriceWatch; updated: boolean }>('/deals/watch', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    unwatch: (id: string) =>
      request<{ removed: boolean }>(`/deals/watch/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  // === GAMES (2.6.0) ===
  games: {
    list: (limit = 24) => request<{ games: Game[] }>(`/games?limit=${limit}`),
    search: (query: string) =>
      request<{ games: Game[] }>(`/games/search?q=${encodeURIComponent(query)}`),
    igdbSearch: (query: string) =>
      request<{ games: IgdbGame[]; configured: boolean }>(`/games/igdb?q=${encodeURIComponent(query)}`),
    get: (slug: string) =>
      request<{ game: Game; deals: Deal[]; total: number }>(`/games/${encodeURIComponent(slug)}`),
    /** 2.6.2 — staff: postavi cover (URL iz `uploads.image('cover', …)`). */
    setCover: (slug: string, coverUrl: string) =>
      request<{ game: Game }>(`/games/${encodeURIComponent(slug)}/cover`, {
        method: 'PATCH',
        body: JSON.stringify({ coverUrl }),
      }),
  },

  // === GUIDES (2.8.0) — community vodiči po igri ===
  guides: {
    /** Lista za Game Page sekciju „Vodiči“ (filter kategorija + sort). */
    listForGame: (gameSlug: string, options: { category?: string; sort?: 'top' | 'newest'; limit?: number; offset?: number } = {}) => {
      const q = new URLSearchParams();
      if (options.category) q.set('category', options.category);
      if (options.sort) q.set('sort', options.sort);
      if (options.limit) q.set('limit', String(options.limit));
      if (options.offset) q.set('offset', String(options.offset));
      const qs = q.toString();
      return request<GuidesListResponse>(
        `/games/${encodeURIComponent(gameSlug)}/guides${qs ? `?${qs}` : ''}`,
      );
    },
    get: (gameSlug: string, guideSlug: string) =>
      request<GuideDetailResponse>(
        `/games/${encodeURIComponent(gameSlug)}/guides/${encodeURIComponent(guideSlug)}`,
      ),
    create: (gameSlug: string, data: { title: string; summary?: string; content: string; category: string; status?: 'published' | 'draft' }) =>
      request<GuideDetailResponse>(`/games/${encodeURIComponent(gameSlug)}/guides`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    vote: (guideId: string, vote: 'up' | 'down' | null) =>
      request<GuideVoteResponse>(`/guides/${encodeURIComponent(guideId)}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote: vote ?? 'null' }),
      }),
  },

  // === COLLECTIONS (F-5) ===
  collections: {
    list: (options: { limit?: number; offset?: number; search?: string } = {}) => {
      const q = new URLSearchParams();
      if (options.limit) q.set('limit', String(options.limit));
      if (options.offset) q.set('offset', String(options.offset));
      if (options.search) q.set('search', options.search);
      const qs = q.toString();
      return request<{ collections: GameCollection[]; total: number; hasMore: boolean }>(
        `/collections${qs ? `?${qs}` : ''}`,
      );
    },
    byUser: (username: string) =>
      request<{ collections: GameCollection[] }>(`/collections/user/${encodeURIComponent(username)}`),
    get: (slug: string) =>
      request<{ collection: GameCollection }>(`/collections/${encodeURIComponent(slug)}`),
    create: (payload: { title: string; description?: string | null; isPublic?: boolean }) =>
      request<{ collection: GameCollection }>('/collections', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: { title?: string; description?: string | null; isPublic?: boolean }) =>
      request<{ collection: GameCollection }>(`/collections/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    remove: (id: string) =>
      request<{ removed: boolean }>(`/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    addItem: (id: string, payload: { gameId?: string | null; gameSlug?: string | null; gameTitle: string; gameCover?: string | null; note?: string | null }) =>
      request<{ item: unknown; collection: GameCollection | null }>(`/collections/${encodeURIComponent(id)}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    removeItem: (id: string, itemId: string) =>
      request<{ removed: boolean; collection: GameCollection | null }>(
        `/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
        { method: 'DELETE' },
      ),
    vote: (id: string, direction: 'up' | 'down' | null) =>
      request<{ score: number; myVote: 'up' | 'down' | null }>(`/collections/${encodeURIComponent(id)}/vote`, {
        method: 'POST',
        body: JSON.stringify({ direction }),
      }),
  },

  // === BUILDS (F-11) ===
  builds: {
    catalog: (category?: string) =>
      request<{ components: BuildComponent[]; categories: { id: string; label: string; required: boolean }[] }>(
        `/builds/catalog${category ? `?category=${encodeURIComponent(category)}` : ''}`,
      ),
    createComponent: (payload: Record<string, unknown>) =>
      request<{ component: BuildComponent }>('/builds/catalog', { method: 'POST', body: JSON.stringify(payload) }),
    updateComponent: (id: string, payload: Record<string, unknown>) =>
      request<{ component: BuildComponent }>(`/builds/catalog/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    removeComponent: (id: string) =>
      request<{ removed: boolean }>(`/builds/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    get: (shareId: string) =>
      request<{ build: SharedBuild }>(`/builds/${encodeURIComponent(shareId)}`),
    mine: () => request<{ builds: SharedBuild[] }>('/builds/mine'),
    create: (payload: { title: string; items: { componentId: string; qty?: number }[]; isPublic?: boolean }) =>
      request<{ build: SharedBuild }>('/builds', { method: 'POST', body: JSON.stringify(payload) }),
    remove: (id: string) =>
      request<{ removed: boolean }>(`/builds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  // === NOTIFICATIONS ===
  notifications: {
    list: (options?: { unreadOnly?: boolean; limit?: number }) => {
      const q = new URLSearchParams();
      if (options?.unreadOnly) q.set('unreadOnly', 'true');
      if (options?.limit) q.set('limit', String(options.limit));
      return request<NotificationListResponse>(`/notifications?${q.toString()}`);
    },
    markRead: (notificationIds?: string[]) =>
      request<{ message: string }>('/notifications/read', {
        method: 'PATCH',
        body: JSON.stringify(notificationIds ? { notificationIds } : {}),
      }),
    remove: (id: string) => request<{ message: string }>(`/notifications/${id}`, { method: 'DELETE' }),
    unreadCount: () => request<{ unreadCount: number }>('/notifications/unread-count'),

    // 2.11.0 — mejl kanal: koje notifikacije stižu i na mejl (throttle 1/5 min).
    emailPrefs: () => request<NotificationEmailPrefs>('/notifications/email-prefs'),
    updateEmailPrefs: (payload: { enabled?: boolean; muted?: string[] }) =>
      request<NotificationEmailPrefs>('/notifications/email-prefs', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    // 6.x — tiši sati + tipovi za koje se ne zvoni (push). Inbox ostaje uvek.
    prefs: () => request<NotificationPrefs>('/notifications/prefs'),
    updatePrefs: (payload: { quietHours?: QuietHours | null; pushMuted?: string[] }) =>
      request<NotificationPrefs>('/notifications/prefs', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
  },

  // === REPORTS ===
  reports: {
    create: (payload: { targetType: ReportTargetType; targetId: string; reason: string }) =>
      request<Report>(`/reports`, { method: 'POST', body: JSON.stringify(payload) }),
    list: (status?: string) =>
      request<ReportListResponse>(`/reports${status ? `?status=${status}` : ''}`),
    resolve: (id: string, payload: { status: 'resolved' | 'dismissed'; resolutionNote?: string }) =>
      request<Report>(`/reports/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  },

  // === USERS ===
  users: {
    /** Javni profil — server ne vraća email/isBanned. */
    get: (username: string) => request<PublicUser>(`/users/${encodeURIComponent(username)}`),
    getUserThreads: (username: string) => request<ThreadListResponse>(`/users/${username}/threads`),
    getUserReplies: (username: string) => request<{ replies: Reply[]; total: number }>(`/users/${username}/replies`),
    getUserActivity: (username: string) => request<UserActivityResponse>(`/users/${username}/activity`),
    getSaved: (username: string) => request<UserSavedResponse>(`/users/${username}/saved`),
    getQuests: (username: string) => request<QuestListResponse>(`/users/${username}/quests`),
    updateProfile: (data: { avatar?: string; bio?: string; status?: string; coverPreset?: string }) =>
      request<OwnerUser>('/users/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    connectAccount: (platform: string, platformUsername: string) =>
      request<{
        connectedAccounts: Record<string, string>;
        verifiedPlatforms?: string[];
        verified?: boolean;
        user: OwnerUser | null;
        message: string;
        awarded: { xp: number; levelUp?: boolean; newBadges: string[] } | null;
      }>('/users/accounts/connect', {
        method: 'POST',
        body: JSON.stringify({ platform, platformUsername }),
      }),
    disconnectAccount: (platform: string) =>
      request<{ connectedAccounts: Record<string, string>; user: OwnerUser | null }>(`/users/accounts/${platform}`, {
        method: 'DELETE',
      }),
    leaderboard: (limit = 50, sort: 'karma' | 'level' = 'karma') =>
      request<UserLeaderboardResponse>(`/users/leaderboard/top?limit=${limit}&sort=${sort}`),
    /** F-2 — streak, XP dana i dnevni kvest (profil vlasnika). */
    daily: () => request<DailyLoopResponse>('/users/me/daily'),
    /** #5 — GG guestbook na profilu. */
    guestbook: (username: string) => request<GuestbookResponse>(`/users/${encodeURIComponent(username)}/guestbook`),
    signGuestbook: (username: string, message: string) =>
      request<GuestbookEntry>(`/users/${encodeURIComponent(username)}/guestbook`, {
        method: 'PUT',
        body: JSON.stringify({ message }),
      }),
    unsignedGuestbook: (username: string) =>
      request<{ ok: boolean }>(`/users/${encodeURIComponent(username)}/guestbook`, { method: 'DELETE' }),
    /** F-10 — upozorenja korisnika (staff ili vlasnik). */
    warnings: (id: string) => request<WarningListResponse>(`/users/${id}/warnings`),
    warn: (id: string, payload: { reason: string; targetType?: string | null; targetId?: string | null; expiresInDays?: number | null }) =>
      request<{ warning: UserWarning; activeCount: number; suggestBan: boolean }>(`/users/${id}/warnings`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    acknowledgeWarning: (userId: string, warningId: string) =>
      request<{ warning: UserWarning }>(`/users/${userId}/warnings/${warningId}/acknowledge`, { method: 'POST' }),
    revokeWarning: (userId: string, warningId: string) =>
      request<{ warning: UserWarning }>(`/users/${userId}/warnings/${warningId}`, { method: 'DELETE' }),
    listAll: () => request<{ users: OwnerUser[]; total: number }>('/users'),
    setRole: (id: string, role?: string, isBanned?: boolean, banReason?: string, banDays?: number | null, muteHours?: number | null) =>
      request<OwnerUser>(`/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, isBanned, banReason, banDays, muteHours }),
      }),
    /** 2.12.0 — praćenje korisnika (`user_follows`). */
    followStatus: (username: string) =>
      request<UserFollowStatus>(`/users/${encodeURIComponent(username)}/follow`),
    follow: (username: string) =>
      request<UserFollowStatus>(`/users/${encodeURIComponent(username)}/follow`, { method: 'POST' }),
    unfollow: (username: string) =>
      request<UserFollowStatus>(`/users/${encodeURIComponent(username)}/follow`, { method: 'DELETE' }),
    followingThreads: () =>
      request<ThreadListResponse>('/users/me/following/threads'),
  },

  // === DM (privatne poruke) — 2.11.0 ===
  dm: {
    list: () => request<DmListResponse>('/dm'),
    unreadCount: () => request<{ unreadCount: number }>('/dm/unread-count'),
    /** Pronađi ili napravi razgovor sa korisnikom. */
    open: (username: string) =>
      request<{ conversation: DmConversation }>('/dm', {
        method: 'POST',
        body: JSON.stringify({ username }),
      }),
    thread: (conversationId: string, before?: string) =>
      request<DmThreadResponse>(
        `/dm/${encodeURIComponent(conversationId)}${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      ),
    sendToConversation: (conversationId: string, content: string) =>
      request<{ message: DmMessage }>(`/dm/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    send: (payload: { toUsername?: string; conversationId?: string; content: string }) =>
      request<{ conversationId: string; message: DmMessage }>('/dm/send', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  // === NEWSLETTER ===
  newsletter: {
    subscribe: (email: string) =>
      request<{ message: string; subscriber: PublicUser }>('/newsletter/subscribe', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    subscribers: (params: { segment?: 'active' | 'pending' | 'unsubscribed' | 'all'; search?: string; limit?: number; offset?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.segment) q.set('segment', params.segment);
      if (params.search) q.set('search', params.search);
      if (params.limit) q.set('limit', String(params.limit));
      if (params.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      return request<SubscriberListResponse>(`/newsletter/subscribers${qs ? `?${qs}` : ''}`);
    },
    /** 2.6.2 — ponovo pošalji potvrdu pretplate (admin). */
    resend: (email: string) =>
      request<{ message: string; sent: boolean }>('/newsletter/resend', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
  },

  // === ADMIN ===
  admin: {
    /** 2.6.2 — da li je Supabase Storage podešen (server ne izlaže ključeve). */
    media: () =>
      request<{ configured: boolean; bucket: string; maxUploadMb: number }>('/admin/media'),
    /** 2.6.3 — medijska galerija (lista uploadovanih slika). */
    mediaItems: (limit = 60) =>
      request<{ configured: boolean; items: MediaItem[] }>(`/admin/media/items?limit=${limit}`),
    deleteMedia: (path: string) =>
      request<{ message: string }>(`/admin/media/items?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    /**
     * 2.13.2 — izvori vesti: koliko vesti po izvoru (RSS), po kategoriji i
     * koliko ih je uvezeno u poslednjih 7 dana. Za karticu u admin panelu.
     */
    newsSources: () =>
      request<{
        total: number;
        bySource: Record<string, { total: number; lastAt: string | null; last7d?: number }>;
        byCategory: Record<string, number>;
        recent: Array<{ title: string; newsSource: string | null; publishedAt: string | null; hasImage: boolean; length: number }>;
      }>('/admin/news/sources'),
    /** B-13 — `pendingCount` su PRIJAVE SA STATUSOM `pending` (ne i rešene). */
    stats: (range: '7d' | '30d' | '90d' = '7d') =>
      request<AdminStats>(`/admin/stats?range=${range}`),
    auditLog: (limit = 50) => request<{ entries: AuditEntry[] }>(`/admin/audit-log?limit=${limit}`),
    /** 2.13.2 — pregled nedeljnog digest-a (bez slanja): 5 najčitanijih vesti. */
    newsDigest: (days = 7) =>
      request<{
        days: number;
        total: number;
        subject: string;
        items: Array<{ slug: string; title: string; excerpt: string; category: string; views: number; newsSource: string | null; publishedAt: string | null }>;
        html: string;
      }>(`/admin/news/digest?days=${days}`),
    getSettings: () => request<{ settings: AdminSettings }>('/admin/settings'),
    getPublicSettings: () => request<{ settings: PublicAdminSettings }>('/admin/settings/public'),
    updateSettings: (payload: Partial<AdminSettings>) =>
      request<{ message: string; settings: AdminSettings }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    broadcast: (payload: {
      subject: string;
      content: string;
      /** 2.6.2 — segment; `unsubscribed` server odbija (nikad se ne kontaktiraju). */
      segment?: 'active' | 'pending' | 'all';
      /** `testEmail` šalje jedan mejl i ne dira listu. */
      testEmail?: string;
      /** A/B test: polovina liste dobija ovaj naslov (deterministički po adresi). */
      subjectB?: string;
      /** ISO datum u budućnosti → kampanja ide u red umesto odmah. */
      scheduledAt?: string;
    }) =>
      request<{
        message: string;
        sentCount?: number;
        failed?: number;
        test?: boolean;
        abTest?: { subjectA: string; subjectB: string; sentA: number; sentB: number };
        scheduled?: { id: string; scheduledAt: string };
      }>('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    /** Red zakazanih kampanja (najbliža prva). */
    scheduledCampaigns: () =>
      request<{
        campaigns: Array<{
          id: string;
          subject: string;
          subjectB: string | null;
          segment: string;
          scheduledAt: string;
          status: 'scheduled' | 'sent' | 'failed' | 'missed';
          sentCount?: number;
          failed?: number;
          error?: string;
        }>;
      }>('/admin/newsletter/scheduled'),
    cancelScheduledCampaign: (id: string) =>
      request<{ message: string; cancelled: boolean }>(`/admin/newsletter/scheduled/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    awardUser: (userId: string, payload: { badgeCode?: string; xpBonus?: number; reason?: string }) =>
      request<{ message: string }>(`/admin/users/${userId}/award`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    adjustXp: (userId: string, payload: { amount: number; reason: string }) =>
      request<{ message: string; user?: OwnerUser }>(`/admin/users/${userId}/adjust-xp`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    bulkUsers: (payload: { ids: string[]; action: 'ban' | 'unban' | 'mute'; days?: number; reason?: string; muteHours?: number }) =>
      request<{ message: string; results: Array<{ id: string; ok: boolean; error?: string }> }>('/admin/users/bulk', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    listCategories: () =>
      request<{ categories: Array<{ id: string; slug: string; name: string; description: string; icon: string; color?: string; threads?: number; posts?: number }> }>('/admin/categories'),
    saveCategory: (payload: { slug: string; name: string; description?: string; icon?: string; color?: string }) =>
      request<{ message: string; category: { slug: string; name: string } }>('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    deleteCategory: (slug: string) =>
      request<{ message: string }>(`/admin/categories/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      }),
    rateLimits: () =>
      request<{
        limits: Array<{ name: string; label: string; window: string; max: number }>;
        note: string;
      }>('/admin/rate-limits'),
    ipBans: () =>
      request<{
        bans: Array<{ ip: string; reason: string; bannedBy: string; expiresAt: string | null; createdAt: string }>;
      }>('/admin/ip-bans'),
    addIpBan: (ip: string, reason: string) =>
      request<{ message: string; ban: { ip: string; reason: string } }>('/admin/ip-bans', {
        method: 'POST',
        body: JSON.stringify({ ip, reason }),
      }),
    removeIpBan: (ip: string) =>
      request<{ message: string }>(`/admin/ip-bans/${encodeURIComponent(ip)}`, {
        method: 'DELETE',
      }),
    exportCsvUrl: (dataset: 'users' | 'subscribers' | 'reports' | 'audit') => `/admin/export/${dataset}`,
    health: () => request<AdminHealth>('/admin/health'),
    listComments: (limit = 50) =>
      request<{ comments: ArticleComment[] }>(`/admin/comments?limit=${limit}`),
    deleteComment: (id: string) =>
      request<{ message: string }>(`/admin/comments/${id}`, {
        method: 'DELETE',
      }),
  },
};
