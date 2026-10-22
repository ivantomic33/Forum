import type { ErrorRequestHandler, RequestHandler } from 'express';
import { captureError, errorTrackingEnabled } from './sentry.js';

/**
 * GREŠKE ZA KLIJENT
 * ------------------
 * U produkciji se klijentu nikad ne vraća `err.message` (može sadržati SQL
 * detalje, imena tabela/kolona). Vraća se generička poruka + `requestId`
 * koji postoji i u logu, pa se problem prati po njemu.
 *
 * `AppError` je za očekivane greške (404, 403, 400, 409...) — njihova poruka
 * je namerno pisana za korisnika i bezbedna je u svim okruženjima.
 */

export class AppError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Ruta nije pronađena' });
};

/** Centralni error handler — mora biti registrovan poslednji. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id;
  const logger = (req as any).log;
  const status = err instanceof AppError ? err.status : Number(err?.status) || 500;

  if (status >= 500) {
    logger?.error({ err, requestId }, 'unhandled_error');
  } else {
    logger?.warn({ err: { message: err?.message, status }, requestId }, 'handled_error');
  }

  // Sentry: samo neočekivane (5xx) greške. Kontrolisani kontekst — nikad body,
  // cookie-ji ni tokeni; isti `requestId` postoji u logu i u Sentry događaju.
  if (status >= 500) {
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (errorTrackingEnabled()) {
      captureError(err, {
        requestId,
        method: req.method,
        path,
        userId: (req as any).user?.id,
        status,
      });
    }
  }

  const body: Record<string, unknown> = {
    error: err instanceof AppError ? err.message : undefined,
    requestId,
  };

  if (err instanceof AppError && err.details) body.details = err.details;

  // JSON parse greške iz express.json (413/400) — bezbedne su i u produkciji
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Zahtev je prevelik.', requestId });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Neispravan JSON u zahtevu.', requestId });
  }

  if (isProduction()) {
    body.error = body.error ?? 'Interna greška servera. Pokušajte ponovo kasnije.';
  } else {
    body.error = body.error ?? err?.message ?? 'Interna greška servera';
    if (err?.stack) body.stack = String(err.stack).split('\n').slice(0, 8);
  }

  res.status(status).json(body);
};

/** Async wrapper — hvata odbijene promise i prosleđuje ih error handleru. */
export const asyncHandler =
  <T extends RequestHandler>(handler: T): RequestHandler =>
    (req, res, next) =>
      Promise.resolve(handler(req, res, next)).catch(next);
