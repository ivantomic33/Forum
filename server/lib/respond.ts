/**
 * N10 — TIPIZOVANI ODGOVOR RUTE
 * -----------------------------
 * Ruta vraća `respond(res, schema, payload)` umesto `res.json(payload)`.
 * Šema (`contracts/`) je **ugovor sa klijentom**, pa `tsc` pada na SERVERU kada
 * odgovor izgubi polje koje klijent čita — ranije se to videlo tek u browseru:
 *
 *   const article: Article = …;            // isti tip koji klijent uvozi
 *   respond(res, articleResponseSchema, article);   // promena polja = TS greška
 *
 * Validacija se izvršava samo kada je `CONTRACT_CHECK=1` (testovi, CI) — u
 * produkciji bi `safeParse` na svakom odgovoru trošio CPU bez koristi, a
 * `tsc` je taj koji (statički) hvata odstupanja. Čišćenje polja koja ne treba
 * da izađu (`password`, `email` na javnom profilu) i dalje rade `publicUser()`
 * i slične funkcije — šema proverava oblik, ne zamenjuje bezbednosne filtere.
 */

import type { Response } from 'express';
import { z } from 'zod';
import { logger } from './logger.js';

/** Da li se oblik odgovora proverava u runtime-u (test/CI). */
export function contractCheckEnabled(): boolean {
  return process.env.CONTRACT_CHECK === '1';
}

/**
 * Pošalji odgovor i (opciono) proveri ga protiv šeme iz `contracts/`.
 *
 * @param status HTTP status (default 200)
 */
export function respond<T extends z.ZodType>(
  res: Response,
  schema: T,
  payload: z.input<T> | z.output<T>,
  status = 200,
): void {
  if (contractCheckEnabled()) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const route = `${res.req?.method ?? '?'} ${res.req?.originalUrl ?? '?'}`;
      logger.warn(
        { route, contractIssues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`) },
        'response_contract_mismatch',
      );
    }
  }
  res.status(status).json(payload);
}
