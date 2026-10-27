import { create } from 'zustand';
import { api, clearSessionFlag, hasSessionHint, markSessionFlag, setSessionLostHandler, setSessionRefreshedHandler } from '../lib/api';
import type { OwnerUser } from '../../contracts/index';
import { setErrorTrackingUser } from '../lib/sentry';
import { queryClient } from '../lib/queryClient';

/**
 * N-02 — jedan `/auth/me` po pokretanju aplikacije.
 * Layout, OAuth callback i bilo koji drugi pozivalac dele isti `fetchQuery`
 * (`['me']`), pa React Query dedupira zahteve i kešira korisnika.
 */
export const ME_QUERY_KEY = ['me'] as const;

/** N-02 — tekuća inicijalizacija; paralelni pozivaoci čekaju isti zahtev. */
let initInFlight: Promise<void> | null = null;

/**
 * N10 — ulogovan korisnik = `OwnerUser` iz `contracts/` (istvo polje koje server
 * šalje za `/auth/me`). `verifiedPlatforms` je opcioni deo koji vraćaju samo rute
 * za povezivanje naloga.
 */
export type User = OwnerUser & { verifiedPlatforms?: string[] };

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * N-02 — nezavisan od `isLoading`: `isLoading` je već `false` za gosta (jedan
   * cache pogled), dok `isLoadingUser` znači „korisnik se još učitava“.
   */
  isLoadingUser: boolean;
  /** Naznaka da je korisnik kliknuo „Zapamti me“ (samo UI; sesija je u cookie-ju). */
  rememberMe: boolean;
  login: (user: User, rememberMe?: boolean) => void;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  /** N-02 — idempotentno: paralelni pozivaoci dele isti `/auth/me`. */
  initSession: () => Promise<void>;
  /** Sesija je nepovratno izgubljena (refresh odbijen) — očisti lokalno stanje. */
  clearSession: () => void;
}

/**
 * F-32 — JWT/refresh više nisu u Web Storage-u (XSS ih je mogao ukrasti).
 * Sesiju drži isključivo server u `HttpOnly` cookie-ju; ovde se pamti samo
 * stanje UI-ja i korisnički objekat.
 *
 * N-01 — gost ne proizvodi nikakav auth saobraćaj: bez `nx_sid`/`nx_csrf`
 * cookie-ja (i bez traga sesije u tabu) `initSession()` se završava bez
 * `/auth/me` i bez `/auth/refresh`. Prijavljeni se identifikuje jednim
 * `/auth/me`-om, a ako je access token istekao, `/auth/refresh` ga obnavlja
 * i (`onSessionRefreshed`) popunjava store.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  // Dok se `initSession` ne završi, aplikacija ne sme da prikaže „Prijavi se“.
  isLoading: true,
  isLoadingUser: true,
  rememberMe: false,

  login: (user, rememberMe = true) => {
    setErrorTrackingUser(user.id);
    // Sledeći tab/refresh sme da pita `/auth/me` — sesija je sada stvarna.
    markSessionFlag();
    queryClient.setQueryData(ME_QUERY_KEY, user);
    set({ user, isAuthenticated: true, isLoading: false, isLoadingUser: false, rememberMe });
  },

  logout: async () => {
    try {
      // Server briše HttpOnly cookie-je i opoziva refresh sesiju.
      await api.auth.logout();
    } catch {
      // Ignoriši grešku na mreži — lokalno stanje se svejedno čisti.
    } finally {
      setErrorTrackingUser(null);
      clearSessionFlag();
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      set({ user: null, isAuthenticated: false, isLoading: false, isLoadingUser: false, rememberMe: false });
    }
  },

  updateUser: (updates) =>
    set((state) => {
      const user = state.user ? { ...state.user, ...updates } : null;
      if (user) queryClient.setQueryData(ME_QUERY_KEY, user);
      return { user };
    }),

  initSession: async () => {
    // N-02 — guard: Layout i OAuth callback mogu da traže inicijalizaciju
    // istovremeno; drugi poziv čeka isti `/auth/me` umesto da ga ponovi.
    if (initInFlight) return initInFlight;
    if (!get().isLoading) return;

    initInFlight = (async () => {
      // N-01/N-02 — gost: bez `nx_sid`/`nx_csrf` cookie-ja i bez traga sesije u
      // tabu nema mrežnog poziva. Prijavljeni: TAČNO JEDAN `/auth/me`, deljen
      // kroz React Query (`['me']`), pa je `isLoading` za Layout i za admin guard.
      if (!hasSessionHint()) {
        set({ user: null, isAuthenticated: false, isLoading: false, isLoadingUser: false });
        return;
      }

      markSessionFlag();
      try {
        // Cookie je jedini izvor istine: ako je access istekao, `request` tiho
        // radi refresh (koji i sam vraća korisnika kroz `onSessionRefreshed`).
        const user = await queryClient.fetchQuery({
          queryKey: ME_QUERY_KEY,
          queryFn: async () => (await api.auth.me()).user as User,
          staleTime: 60_000,
        });
        setErrorTrackingUser(user.id);
        set({ user, isAuthenticated: true, isLoading: false, isLoadingUser: false });
      } catch {
        // Sesija je odbijena — `api` već briše zastareli CSRF cookie i flag.
        setErrorTrackingUser(null);
        set({ user: null, isAuthenticated: false, isLoading: false, isLoadingUser: false });
      }
    })();

    return initInFlight;
  },

  clearSession: () => {
    setErrorTrackingUser(null);
    clearSessionFlag();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    set({ user: null, isAuthenticated: false, isLoading: false, isLoadingUser: false, rememberMe: false });
  },
}));

/**
 * Mreža: kada `/auth/refresh` odbije sesiju, UI mora da izađe iz „prijavljen“
 * stanja (npr. odjava sa drugog uređaja, reset lozinke, istekla sesija).
 */
setSessionLostHandler(() => useAuthStore.getState().clearSession());

/**
 * N-01 — `/auth/refresh` vraća i korisnika, pa tihi refresh u `api` klijentu
 * uloguje korisnika bez dodatnog `/auth/me` (npr. stranica otvorena u novom
 * tabu gde sessionStorage flag još ne postoji, a cookie je živ).
 */
setSessionRefreshedHandler((user) => {
  const id = (user as User | undefined)?.id;
  if (!id) return;
  const state = useAuthStore.getState();
  if (state.isAuthenticated && state.user?.id === id) return;
  markSessionFlag();
  queryClient.setQueryData(ME_QUERY_KEY, user);
  setErrorTrackingUser(id);
  state.login(user as User, state.rememberMe);
});
