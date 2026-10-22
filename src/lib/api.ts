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

export interface ApiError {
  error: string;
}

/** Rezultat ankete (GET /api/forum/threads/:id → poll, POST …/poll/vote). */
export interface PollResult {
  question: string;
  options: Array<{ index: number; label: string; votes: number; percent: number }>;
  totalVotes: number;
  myVote: number | null;
}

/** 2.6.0 — javni oblik deal-a (`GET /api/deals`). */
export interface Deal {
  id: string;
  authorId: string;
  author: string;
  authorAvatar?: string;
  authorRole?: string;
  /** Autor je potvrdio email (verifikaciona značka pored imena). */
  authorVerified?: boolean;
  gameId: string | null;
  gameSlug: string | null;
  gameTitle: string | null;
  gameCover: string | null;
  title: string;
  url: string;
  proofUrl: string | null;
  price: number;
  originalPrice: number;
  discountPct: number;
  currency: string;
  store: string;
  platform: string;
  description: string | null;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'removed';
  isVerified: boolean;
  score: number;
  createdAt: string;
  updatedAt: string;
  myVote?: 'up' | 'down' | null;
}

/** 2.6.0 — igra iz kataloga (Game Page `/games/:slug`). */
export interface Game {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  igdbId: number | null;
  activeDeals?: number;
}

export interface IgdbGame {
  igdbId: number;
  name: string;
  slug: string;
  coverUrl: string | null;
  releaseDate: string | null;
}

export type DealSort = 'newest' | 'top' | 'discount' | 'expiring';

export interface DealQuery {
  sort?: DealSort;
  game?: string;
  gameSlug?: string;
  store?: string;
  platform?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  search?: string;
  expiringSoon?: boolean;
  limit?: number;
  offset?: number;
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
}

/**
 * Jedan zajednički refresh zahtev kada više poziva istovremeno dobije 401.
 * Bez ovoga bi 10 paralelnih zahteva rotiralo refresh token 10 puta — a druga
 * rotacija bi bila prepoznata kao „ponovna upotreba“ i opozvala bi sesiju.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': readCsrfToken() ?? '' },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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

export type SearchScope = 'all' | 'articles' | 'threads' | 'deals';

/** 2.6.2 — jedan rezultat objedinjene pretrage (`GET /api/search`). */
export interface SearchHit {
  type: 'article' | 'thread' | 'deal';
  id: string;
  title: string;
  snippet: string;
  href: string;
  meta?: string | null;
  image?: string | null;
  extra?: string | null;
  createdAt: string;
  rank: number;
}

export interface UploadResult {
  url: string;
  width: number;
  height: number;
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
async function uploadRequest<T>(path: string, file: File, retry = true): Promise<T> {
  const form = new FormData();
  form.append('file', file);
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
      return uploadRequest<T>(path, file, false);
    }
    if (res.status === 401) dropLocalSession();
    throw new Error((data as ApiError)?.error || `Upload nije uspeo (${res.status})`);
  }
  return data as T;
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

    // Access token je istekao (15 min) — tiho obnovi sesiju i ponovi TAČNO jednom.
    // `NO_SESSION`/`SESSION_EXPIRED` posle refresh-a znače da je sesija gotova.
    if (res.status === 401 && retry && !path.startsWith('/auth/refresh') && !path.startsWith('/auth/login')) {
      if (await refreshSession()) {
        return request<T>(path, options, false);
      }
      dropLocalSession();
    }

    if (res.status === 401 && (code === 'SESSION_REVOKED' || code === 'REFRESH_REUSED')) {
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
      request<{ user: any; csrfToken: string; verificationRequired?: boolean; verificationToken?: string }>(
        '/auth/register',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    /**
     * Prijava: ili vraća ulogovanog korisnika (sesija je u cookie-ju),
     * ili 2FA izazov (`requires2fa` + `mfaTicket`) koji se rešava sa `login2fa`.
     */
    login: (payload: { email: string; password: string; rememberMe?: boolean; captchaToken?: string | null }) =>
      request<
        | { user: any; csrfToken: string; rememberMe?: boolean }
        | { requires2fa: true; mfaTicket: string; username: string; avatar?: string; recoveryCodesLeft: number }
      >('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    login2fa: (payload: { mfaTicket: string; code: string; rememberMe?: boolean; captchaToken?: string | null }) =>
      request<{ user: any; csrfToken: string; recoveryCodeUsed?: boolean; recoveryCodesLeft?: number }>(
        '/auth/2fa/login',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    twoFactor: {
      status: () =>
        request<{ enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; lockedUntil: string | null }>(
          '/auth/2fa/status',
        ),
      setup: () => request<{ secret: string; otpauthUri: string; qrCode: string }>('/auth/2fa/setup', { method: 'POST' }),
      enable: (code: string) =>
        request<{ enabled: boolean; recoveryCodes: string[]; user: any }>('/auth/2fa/enable', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      disable: (password: string, code: string) =>
        request<{ enabled: boolean; user: any }>('/auth/2fa/disable', {
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
      request<{ user: any; csrfToken: string }>('/auth/oauth/complete-signup', {
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
    me: () => request<{ user: any }>('/auth/me'),
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
    image: (kind: 'avatar' | 'cover' | 'proof' | 'article', file: File) =>
      uploadRequest<UploadResult>(`/uploads/${kind}`, file),
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
      return request<{ articles: any[]; total: number; hasMore?: boolean; limit?: number; offset?: number }>(`/articles${qs}`);
    },
    ticker: () =>
      request<{ items: Array<{ id: string; label: string; href: string; kind: 'article' | 'thread' }> }>('/articles/ticker'),
    saved: (ids: string[]) =>
      request<{ articles: any[] }>('/articles/saved', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    get: (idOrSlug: string) => request<any>(`/articles/${idOrSlug}`),
    bookmark: (id: string) => request<{ bookmarked: boolean }>(`/articles/${id}/bookmark`, { method: 'POST' }),
    unbookmark: (id: string) => request<{ bookmarked: boolean }>(`/articles/${id}/bookmark`, { method: 'DELETE' }),
    bookmarks: () => request<{ articles: any[] }>('/articles/bookmarks/mine'),
    comments: (id: string) => request<{ comments: any[]; total: number }>(`/articles/${id}/comments`),
    addComment: (id: string, content: string, parentId?: string) =>
      request<any>(`/articles/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parentId: parentId ?? null }),
      }),
    react: (id: string, type: 'like' | 'gg' | 'hype' | 'fire' | 'mind_blown') =>
      request<{ reactions: Record<string, number> }>(`/articles/${id}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    create: (data: any) =>
      request<any>('/articles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      request<any>(`/articles/${id}`, {
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
    categories: () => request<{ categories: any[] }>('/forum/categories'),
    /**
     * Cursor paginacija: `nextCursor` je ID poslednje teme; `null` = nema više.
     * Ranije je frontend uvek dobijao prvih 100 tema i ignorisao `nextCursor`.
     */
    listThreads: (
      subforum = 'all',
      sort = 'hot',
      search?: string,
      options?: { limit?: number; cursor?: string | null },
    ) => {
      const q = new URLSearchParams({ sort });
      if (search) q.set('search', search);
      if (options?.limit) q.set('limit', String(options.limit));
      if (options?.cursor) q.set('cursor', options.cursor);
      return request<{ threads: any[]; total: number; nextCursor: string | null }>(
        `/forum/${subforum}/threads?${q.toString()}`,
      );
    },
    searchThreads: (search: string, sort = 'hot', options?: { limit?: number; cursor?: string | null }) => {
      const q = new URLSearchParams({ sort, search });
      if (options?.limit) q.set('limit', String(options.limit));
      if (options?.cursor) q.set('cursor', options.cursor);
      return request<{ threads: any[]; total: number; nextCursor: string | null }>(
        `/forum/all/threads?${q.toString()}`,
      );
    },
    getThread: (id: string) =>
      request<{ thread: any; replies: any[]; poll: PollResult | null }>(`/forum/threads/${id}`),
    createThread: (
      subforum: string,
      payload: {
        title: string;
        content: string;
        tags?: string[];
        isSpoiler?: boolean;
        poll?: { question: string; options: string[] } | null;
      },
    ) =>
      request<any>(`/forum/${subforum}/threads`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    votePoll: (threadId: string, optionIndex: number) =>
      request<PollResult>(`/forum/threads/${threadId}/poll/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionIndex }),
      }),
    createReply: (threadId: string, payload: { content: string; parentId?: string | null; isSpoiler?: boolean }) =>
      request<any>(`/forum/threads/${threadId}/comments`, {
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
      request<any>(`/forum/threads/${id}/moderate`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    updateThread: (id: string, payload: { title?: string; content?: string; tags?: string[]; isSpoiler?: boolean }) =>
      request<any>(`/forum/threads/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteThread: (id: string) => request<{ message: string }>(`/forum/threads/${id}`, { method: 'DELETE' }),
    updateReply: (id: string, payload: { content?: string; isSpoiler?: boolean }) =>
      request<any>(`/forum/replies/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteReply: (id: string) => request<{ message: string }>(`/forum/replies/${id}`, { method: 'DELETE' }),
    bookmarkThread: (id: string) =>
      request<{ bookmarked: boolean }>(`/forum/threads/${id}/bookmark`, { method: 'POST' }),
    unbookmarkThread: (id: string) =>
      request<{ bookmarked: boolean }>(`/forum/threads/${id}/bookmark`, { method: 'DELETE' }),
    followThread: (id: string) => request<{ following: boolean }>(`/forum/threads/${id}/follow`, { method: 'POST' }),
    unfollowThread: (id: string) => request<{ following: boolean }>(`/forum/threads/${id}/follow`, { method: 'DELETE' }),
    isFollowingThread: (id: string) => request<{ following: boolean }>(`/forum/threads/${id}/follow`),
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

  // === NOTIFICATIONS ===
  notifications: {
    list: (options?: { unreadOnly?: boolean; limit?: number }) => {
      const q = new URLSearchParams();
      if (options?.unreadOnly) q.set('unreadOnly', 'true');
      if (options?.limit) q.set('limit', String(options.limit));
      return request<{ notifications: any[]; unreadCount: number }>(`/notifications?${q.toString()}`);
    },
    markRead: (notificationIds?: string[]) =>
      request<{ message: string }>('/notifications/read', {
        method: 'PATCH',
        body: JSON.stringify(notificationIds ? { notificationIds } : {}),
      }),
    remove: (id: string) => request<{ message: string }>(`/notifications/${id}`, { method: 'DELETE' }),
    unreadCount: () => request<{ unreadCount: number }>('/notifications/unread-count'),
  },

  // === REPORTS ===
  reports: {
    create: (payload: { targetType: 'thread' | 'reply' | 'article' | 'comment' | 'user' | 'deal'; targetId: string; reason: string }) =>
      request<any>('/reports', { method: 'POST', body: JSON.stringify(payload) }),
    list: (status?: string) =>
      request<{ reports: any[]; total: number }>(`/reports${status ? `?status=${status}` : ''}`),
    resolve: (id: string, payload: { status: 'resolved' | 'dismissed'; resolutionNote?: string }) =>
      request<any>(`/reports/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  },

  // === USERS ===
  users: {
    /** Javni profil — server ne vraća email/isBanned. */
    get: (username: string) => request<any>(`/users/${encodeURIComponent(username)}`),
    getUserThreads: (username: string) => request<{ threads: any[]; total: number }>(`/users/${username}/threads`),
    getUserReplies: (username: string) => request<{ replies: any[]; total: number }>(`/users/${username}/replies`),
    getUserActivity: (username: string) => request<{ activities: any[] }>(`/users/${username}/activity`),
    getSaved: (username: string) =>
      request<{ savedArticles: any[]; savedThreads: any[] }>(`/users/${username}/saved`),
    getQuests: (username: string) =>
      request<{ quests: any[]; completed: number; total: number }>(`/users/${username}/quests`),
    updateProfile: (data: { avatar?: string; bio?: string; status?: string }) =>
      request<any>('/users/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    connectAccount: (platform: string, platformUsername: string) =>
      request<{
        connectedAccounts: Record<string, string>;
        verifiedPlatforms?: string[];
        verified?: boolean;
        user: any;
        message: string;
        awarded: { xp: number; newBadges: string[] } | null;
      }>('/users/accounts/connect', {
        method: 'POST',
        body: JSON.stringify({ platform, platformUsername }),
      }),
    disconnectAccount: (platform: string) =>
      request<{ connectedAccounts: Record<string, string>; user: any }>(`/users/accounts/${platform}`, {
        method: 'DELETE',
      }),
    leaderboard: (limit = 50, sort: 'karma' | 'level' = 'karma') =>
      request<{ users: any[]; total?: number; sort?: 'karma' | 'level' }>(
        `/users/leaderboard/top?limit=${limit}&sort=${sort}`,
      ),
    listAll: () => request<{ users: any[]; total: number }>('/users'),
    setRole: (id: string, role?: string, isBanned?: boolean, banReason?: string, banDays?: number | null, muteHours?: number | null) =>
      request<any>(`/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, isBanned, banReason, banDays, muteHours }),
      }),
  },

  // === NEWSLETTER ===
  newsletter: {
    subscribe: (email: string) =>
      request<{ message: string; subscriber: any }>('/newsletter/subscribe', {
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
      return request<{
        subscribers: any[];
        total: number;
        counts: { all: number; active: number; pending: number; unsubscribed: number };
        segment: string;
        hasMore: boolean;
      }>(`/newsletter/subscribers${qs ? `?${qs}` : ''}`);
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
    stats: () =>
      request<{
        totalUsers: number;
        totalArticles: number;
        publishedArticles?: number;
        totalThreads: number;
        totalSubscribers: number;
        totalViews: number;
        moderators: number;
      }>('/admin/stats'),
    auditLog: (limit = 50) =>
      request<{
        entries: Array<{
          id: string;
          actorId: string;
          actorUsername?: string;
          targetId: string;
          targetUsername?: string;
          action: 'role_change' | 'ban' | 'unban' | 'badge_awarded' | 'comment_deleted';
          from?: any;
          to?: any;
          at: string;
        }>;
      }>(`/admin/audit-log?limit=${limit}`),
    getSettings: () =>
      request<{
        settings: {
          announcement: {
            active: boolean;
            message: string;
            tone: 'info' | 'warning' | 'danger';
            link?: string;
          };
          registrationOpen: boolean;
          maintenanceMode: boolean;
        };
      }>('/admin/settings'),
    getPublicSettings: () =>
      request<{
        settings: {
          announcement: {
            active: boolean;
            message: string;
            tone: 'info' | 'warning' | 'danger';
            link?: string;
          };
          registrationOpen: boolean;
          maintenanceMode: boolean;
        };
      }>('/admin/settings/public'),
    updateSettings: (payload: {
      announcement?: {
        active: boolean;
        message: string;
        tone: 'info' | 'warning' | 'danger';
        link?: string;
      };
      registrationOpen?: boolean;
      maintenanceMode?: boolean;
    }) =>
      request<{ message: string; settings: any }>('/admin/settings', {
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
    }) =>
      request<{ message: string; sentCount?: number; failed?: number; test?: boolean }>('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    awardUser: (userId: string, payload: { badgeCode?: string; xpBonus?: number }) =>
      request<{ message: string }>(`/admin/users/${userId}/award`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    listComments: (limit = 50) =>
      request<{ comments: any[] }>(`/admin/comments?limit=${limit}`),
    deleteComment: (id: string) =>
      request<{ message: string }>(`/admin/comments/${id}`, {
        method: 'DELETE',
      }),
  },
};
