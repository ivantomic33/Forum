/**
 * SENTRY — JAVA SCRIPT ERROR TRACKING (2.4.4 / 2.6.2 / N-06)
 * --------------------------------------------------------
 * Umesto `@sentry/react` (~460 kB sa Replay/Router/Feedback integracijama),
 * browser šalje envelope direktno na Sentry Store endpoint
 * (`/api/<project>/envelope/`). Ovaj modul nema zavisnosti — sav SDK ostaje
 * van bundle-a.
 *
 * Ostaje sve što je bitno:
 *  - bez `VITE_SENTRY_DSN` modul je inertan (nema mrežnih poziva),
 *  - greške idu sa `event_id`, `release`, `environment`, tipom, porukom i
 *    kratkim stack-om (browser šalje i ceo stack preko globalnih handlera),
 *  - URL je samo origin + path — `?token=` sa verifikacije/reseta nikad ne
 *    odlazi ka Sentry-ju,
 *  - korisnik se šalje samo kao javni `id` (bez email-a i IP-a),
 *  - `AppErrorBoundary` prijavljuje i greške rendera.
 *
 * Privatnost: bez sesijskog replay-a, bez `sendDefaultPii`, bez breadcrumb-a.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

const dsn = (import.meta.env.VITE_SENTRY_DSN ?? '').trim();
const release = import.meta.env.VITE_SENTRY_RELEASE || undefined;

export const errorTrackingConfigured = Boolean(dsn);

/** DSN (`https://<key>@<host>/<projectId>`) → Store endpoint. */
function parseDsn(value: string) {
  try {
    const url = new URL(value);
    const projectPath = url.pathname.replace(/\/+$/, '');
    if (!url.username || !projectPath || projectPath === '/') return null;
    return {
      endpoint: `${url.protocol}//${url.host}${projectPath}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

const target = dsn ? parseDsn(dsn) : null;

/** Prijavljeni korisnik — samo javni `id`. */
let userId: string | null = null;

/** Duplikati (isti tip + poruka + mesto) unutar minut ne odlaze ponovo. */
const seen = new Map<string, number>();
const DEDUPE_MS = 60_000;

function newEventId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Bez query stringa — tu mogu biti `?token=` sa verifikacije/reseta lozinke. */
function safeUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
}

interface CapturedError {
  error: Error;
  /** `ErrorInfo.componentStack` iz React graničnika. */
  componentStack?: string | null;
}

/**
 * Slanje jednog događaja. Best-effort: greška u Sentry-ju nikad ne sme da
 * obori aplikaciju. `sendBeacon` preživljava reload koji sledi posle greške.
 */
function send({ error, componentStack }: CapturedError): void {
  if (!target || typeof window === 'undefined') return;

  const fingerprint = `${error.name}:${error.message}:${error.stack?.split('\n')[1] ?? ''}`;
  const now = Date.now();
  const last = seen.get(fingerprint);
  if (last && now - last < DEDUPE_MS) return;
  for (const [key, at] of seen) if (now - at > DEDUPE_MS) seen.delete(key);
  seen.set(fingerprint, now);

  const eventId = newEventId();
  const timestamp = new Date(now).toISOString();
  const url = safeUrl();

  const event = {
    event_id: eventId,
    timestamp,
    platform: 'javascript',
    level: 'error',
    release,
    environment: import.meta.env.MODE,
    logger: 'nexus-frontend',
    message: error.message,
    transaction: window.location.pathname,
    ...(userId ? { user: { id: userId } } : {}),
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          ...(componentStack
            ? { mechanism: { type: 'react-error-boundary', handled: true } }
            : { mechanism: { type: 'generic', handled: false } }),
        },
      ],
    },
    extra: {
      url,
      stack: error.stack ? error.stack.split('\n').slice(0, 8).join('\n') : null,
      ...(componentStack ? { componentStack } : {}),
    },
    // Bez query stringa, cookies-a i korisničkih podataka.
    request: { url, headers: { 'User-Agent': navigator.userAgent.slice(0, 200) } },
  };

  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn }),
    JSON.stringify({ type: 'event', length: 0 }),
    JSON.stringify(event),
  ].join('\n');

  const storeUrl = `${target.endpoint}?sentry_key=${encodeURIComponent(target.publicKey)}&sentry_version=7&sentry_client=nexus-web/2.6.2`;
  try {
    const body = new Blob([envelope], { type: 'application/x-sentry-envelope' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(storeUrl, body))) {
      void fetch(storeUrl, { method: 'POST', body, keepalive: true, mode: 'cors' }).catch(() => undefined);
    }
  } catch {
    // Sentry nedostupan — greška je već u konzoli.
  }
}

/**
 * N-06 — bez SDK-a nema šta da se inicijalizuje; funkcija ostaje (poziva je
 * `main.tsx` pre prvog rendera) i kači globalne handlere za greške koje React
 * graničnik ne vidi (async, moduli, van rendera).
 */
export function initErrorTracking(): void {
  if (!target) return;
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Script error');
    send({ error });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send({ error: reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unhandled rejection') });
  });
}

/**
 * Reset prijave u Sentry-ju — samo javni `id` (bez email-a/username-a), da se
 * greške jednog korisnika mogu povezati bez otkrivanja identiteta.
 */
export function setErrorTrackingUser(id: string | null): void {
  if (!target) return;
  userId = id;
}

interface BoundaryState {
  hasError: boolean;
  /** Poruka greške — vidljiva u fallback-u (i u QA skriptama koje čitaju DOM). */
  message?: string;
}

/**
 * Globalni graničnik grešaka. Prijavljuje grešku u Sentry i prikazuje
 * jednostavan fallback sa dugmetom za osvežavanje.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): BoundaryState {
    // Stack preživi i kada graničnik zameni celu stranicu. Bez ovoga QA skripte
    // (koje čitaju samo `console`) vide grešku bez poruke, a nema ni naslova
    // koji bi je otkrio — zato se poruka upisuje i u `document.title`.
    (window as unknown as { __nexusLastError?: unknown }).__nexusLastError = { message: error?.message, stack: error?.stack };
    try {
      document.title = 'ERR: ' + String(error?.message ?? error);
    } catch {
      /* naslov nije kritičan */
    }
    console.error('[ui] render error', error);
    return { hasError: true, message: String(error?.message ?? error) };
  }

  /** Vezano polje: `render` ne prima lambda handle bez `bind`/arrow polja. */
  private reload = () => {
    window.location.reload();
  };

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Pino na serveru ne vidi greške rendera — ostaje bar konzola.
    console.error('[ui] render error', error);
    // QA: skripte koje hvataju `console.error` ne vide `Error` objekat (samo
    // tekst), pa se stack ostavlja i na `window` — čitljivo iz browser-alata.
    (window as unknown as { __nexusLastError?: unknown }).__nexusLastError = {
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    };
    // QA skripte hvataju SAMO `console` tekst; bez ovoga stack izgleda kao
    // „greška bez poruke“. Ograničeno da ne zatrpa konzolu.
    console.error('[ui] render error\n' + String(error?.stack ?? error).slice(0, 1500));
    send({ error, componentStack: info.componentStack });
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
          {import.meta.env?.DEV && this.state.message && (
            <p className="mt-2 break-words font-mono text-xs text-rose-300/80">{this.state.message}</p>
          )}
          <button
            type="button"
            onClick={this.reload}
            className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Osveži stranicu
          </button>
        </div>
      </div>
    );
  }
}
