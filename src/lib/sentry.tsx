/**
 * SENTRY — FRONTEND (2.4.4 / 2.6.2)
 * ---------------------------------
 * Bez `VITE_SENTRY_DSN` modul je inertan — `@sentry/react` se ne inicijalizuje
 * i nema mrežnih poziva. Sa DSN-om se inicijalizuje **pre** prvog rendera
 * (`main.tsx`), a `AppErrorBoundary` prijavljuje greške rendera i hvata ih da
 * korisnik vidi poruku umesto belog ekrana.
 *
 * Privatnost: bez sesijskog replay-a i bez `sendDefaultPii`; `beforeSend`
 * uklanja URL query string (može sadržati `?token=` sa verifikacije/reseta).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';

const dsn = (import.meta.env.VITE_SENTRY_DSN ?? '').trim();

export const errorTrackingConfigured = Boolean(dsn);

export function initErrorTracking(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    beforeSend(event) {
      // `?token=...` (verifikacija, reset lozinke) ne sme u Sentry.
      if (event.request?.url) {
        event.request.url = String(event.request.url).split('?')[0];
      }
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

/**
 * Reset prijave u Sentry-ju — samo javni `id` (bez email-a/username-a), da se
 * greške jednog korisnika mogu povezati bez otkrivanja identiteta.
 */
export function setErrorTrackingUser(userId: string | null): void {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

interface BoundaryState {
  hasError: boolean;
}

/**
 * Globalni graničnik grešaka. Prijavljuje grešku u Sentry i prikazuje
 * jednostavan fallback sa dugmetom za osvežavanje.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (dsn) {
      Sentry.withScope((scope) => {
        scope.setExtra('componentStack', info.componentStack);
        Sentry.captureException(error);
      });
    }
    // Pino na serveru ne vidi greške rendera — ostaje bar konzola.
    console.error('[ui] render error', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-white/10 bg-surface-1 p-6 text-center">
          <h1 className="text-lg font-semibold text-white">Nešto je pošlo naopako</h1>
          <p className="mt-2 text-sm text-white/60">
            Greška je prijavljena. Osveži stranicu — ako se ponovi, javi nam se.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Osveži stranicu
          </button>
        </div>
      </div>
    );
  }
}
