/**
 * CLOUDFLARE TURNSTILE (F-35)
 * ---------------------------
 * Besplatna, neinvazivna bot zaštita na register / login / forgot-password
 * (i na 2FA koraku prijave, jer je to i dalje pokušaj lozinke).
 *
 * - Bez `TURNSTILE_SECRET_KEY` middleware je no-op (lokalni razvoj).
 * - `TURNSTILE_ENFORCE=1` uključuje proveru i van produkcije (za testiranje).
 * - Cloudflare test secret `1x00…AA` uvek prolazi — integracija radi bez naloga.
 * - Ako Cloudflare ne odgovori, zahtev se ODBIJA (fail-closed): „ne možemo da
 *   proverimo“ ne sme da znači „pusti bota“.
 */
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { turnstileRequired, turnstileSecret } from '../lib/authConfig.js';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Ekstrahuje token iz tela zahteva. Klijent šalje `cf-turnstile-response`. */
export const turnstileToken = (req: Request): string => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const value = body['cf-turnstile-response'] ?? body.captchaToken;
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * Vraća `true` samo kada je token potvrđen od strane Cloudflare-a.
 * Izlaže se radi testova i ponovne upotrebe (npr. u OAuth toku).
 */
export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; errorCodes?: string[] }> {
  if (!turnstileRequired()) return { ok: true };
  if (!token) return { ok: false, errorCodes: ['missing-input-response'] };

  try {
    const form = new URLSearchParams({ secret: turnstileSecret(), response: token });
    if (ip) form.set('remoteip', ip);

    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[] };
    return { ok: data.success === true, errorCodes: data['error-codes'] };
  } catch (error) {
    logger.error({ err: error }, 'turnstile_verify_failed');
    return { ok: false, errorCodes: ['internal-error'] };
  }
}

export async function turnstileMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!turnstileRequired()) return next();

  const result = await verifyTurnstile(turnstileToken(req), req.ip);
  if (result.ok) return next();

  req.log?.warn({ codes: result.errorCodes, path: req.path }, 'turnstile_rejected');
  res.status(400).json({
    error: 'Potvrdite da niste robot i pokušajte ponovo.',
    code: 'CAPTCHA_FAILED',
  });
}
