import * as Sentry from '@sentry/node';
import { logger } from './logger.js';

/**
 * SENTRY — 2.4.4 (SDK povezan u 2.6.2)
 * ------------------------------------
 * Bez `SENTRY_DSN` modul je inertan: `errorTrackingEnabled()` vraća `false`,
 * nema mrežnih poziva, a greške idu samo u Pino log. Sa DSN-om se SDK
 * inicijalizuje jednom (`initErrorTracking`) i `errorHandler` svaku 5xx grešku
 * prijavljuje preko `captureError`.
 *
 * Privatnost: šalje se samo greška, stack i kontekst koji **mi** prosleđujemo
 * (putanja, metoda, `requestId`, userId). Body/cookie/headers zahteva se ne
 * šalju, a `beforeSend` briše i ostatke tokena — nema lozinki u Sentry-ju.
 */

let initialized = false;

/** Da li je error tracking aktivan (DSN postavljen i SDK inicijalizovan). */
export function errorTrackingEnabled(): boolean {
  return initialized;
}

export function initErrorTracking(): void {
  const dsn = (process.env.SENTRY_DSN ?? '').trim();
  if (!dsn) {
    logger.info('Error tracking: disabled (SENTRY_DSN not set)');
    return;
  }
  if (initialized) return;

  const environment = process.env.NODE_ENV ?? 'development';
  // Testovi nikad ne šalju događaje, čak i ako DSN slučajno postoji u env-u.
  const sendInTests = process.env.SENTRY_ENABLE_IN_TESTS === '1';

  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    tracesSampleRate: 0,
    enabled: environment !== 'test' || sendInTests,
    // Hostname se ne šalje; IP/email briše `beforeSend` (vidi ispod).
    includeServerName: false,
    // Fatalnu grešku šalje index.ts (`uncaughtException` → Pino + flush), da ne
    // dupliramo događaj; SDK je i dalje hvata ako se proces ubije pre hendlera.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'OnUncaughtException'),
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        if (event.request.query_string) delete event.request.query_string;
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
  });

  initialized = true;
  logger.info({ environment }, 'Error tracking: Sentry initialized');
}

/** Reportuje grešku; nikad ne baca i nikad ne blokira odgovor. */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!initialized) {
    logger.error({ err: error, ...context }, 'unhandled_error');
    return;
  }

  try {
    Sentry.withScope((scope) => {
      // Samo skalari — nikad ceo `req` (cookie-ji, tokeni, body).
      for (const [key, value] of Object.entries(context)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          scope.setExtra(key, value);
        }
      }
      if (typeof context.requestId === 'string') scope.setTag('request_id', context.requestId);
      if (typeof context.userId === 'string') scope.setUser({ id: context.userId });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
  } catch (err) {
    logger.error({ err, error }, 'sentry_capture_failed');
  }
}

/**
 * Ispražnjava red poruka pre gašenja procesa. Server šalje događaje
 * asinhrono; bez ovoga `SIGTERM` (Render/Railway) odseče poslednje greške.
 */
export async function flushErrorTracking(timeoutMs = 2_000): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // ignore — gašenje ne sme da pukne zbog telemetrije
  }
}
