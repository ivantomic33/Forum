import { create } from 'zustand';
import { api, setSessionLostHandler } from '../lib/api';
import { setErrorTrackingUser } from '../lib/sentry';

export interface User {
  id: string;
  username: string;
  email: string;
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
  isVerified?: boolean;
  status?: 'online' | 'away' | 'offline';
  /** 2.6.1 — server potvrdio aktivnu sesiju (`heartbeat`, TTL 90s). */
  isOnline?: boolean;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Naznaka da je korisnik kliknuo „Zapamti me“ (samo UI; sesija je u cookie-ju). */
  rememberMe: boolean;
  login: (user: User, rememberMe?: boolean) => void;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  initSession: () => Promise<void>;
  /** Sesija je nepovratno izgubljena (refresh odbijen) — očisti lokalno stanje. */
  clearSession: () => void;
}

/**
 * F-32 — JWT/refresh više nisu u Web Storage-u (XSS ih je mogao ukrasti).
 * Sesiju drži isključivo server u `HttpOnly` cookie-ju; ovde se pamti samo
 * stanje UI-ja i korisnički objekat.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  // Dok se `initSession` ne završi, aplikacija ne sme da prikaže „Prijavi se“.
  isLoading: true,
  rememberMe: false,

  login: (user, rememberMe = true) => {
    setErrorTrackingUser(user.id);
    set({ user, isAuthenticated: true, isLoading: false, rememberMe });
  },

  logout: async () => {
    try {
      // Server briše HttpOnly cookie-je i opoziva refresh sesiju.
      await api.auth.logout();
    } catch {
      // Ignoriši grešku na mreži — lokalno stanje se svejedno čisti.
    } finally {
      setErrorTrackingUser(null);
      set({ user: null, isAuthenticated: false, isLoading: false, rememberMe: false });
    }
  },

  updateUser: (updates) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),

  initSession: async () => {
    try {
      // Cookie je jedini izvor istine: ako je access istekao, `request` tiho radi refresh.
      const res = await api.auth.me();
      setErrorTrackingUser(res.user.id);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
    } catch {
      setErrorTrackingUser(null);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearSession: () => {
    setErrorTrackingUser(null);
    set({ user: null, isAuthenticated: false, isLoading: false, rememberMe: false });
  },
}));

/**
 * Mreža: kada `/auth/refresh` odbije sesiju, UI mora da izađe iz „prijavljen“
 * stanja (npr. odjava sa drugog uređaja, reset lozinke, istekla sesija).
 */
setSessionLostHandler(() => useAuthStore.getState().clearSession());
