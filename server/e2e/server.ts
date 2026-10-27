/**
 * N10 + N-11 — E2E API ZA PLAYWRIGHT
 * ----------------------------------
 * `playwright.config.ts` pokreće ovaj fajl sa `tsx` iz foldera `server/`, pa:
 *  - `contracts/` dolazi preko `server/node_modules/contracts` (simlink na koren
 *    `contracts/`, pravi ga `scripts/link-contracts.mjs` u postinstall-u);
 *  - `zod` i ostale zavisnosti se rešavaju iz `server/node_modules` (jedna
 *    instalacija, jedan lockfile — N-11).
 *
 * Namerno `.ts` + dinamički importi: `process.env` se čita pri importu modula
 * (`store.ts`, `authConfig.ts`), pa env blok mora da se izvrši PRE prvog importa.
 *
 * Import ugovora je preko `server/node_modules/contracts` (simlink na koren
 * `contracts/`, pravi ga `scripts/link-contracts.mjs` u postinstall-u): isti
 * modul kao u `server/routes/*` — ugovor se proverava na istom mestu.
 */

export {};

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// In-memory baza: `memory` je eksplicitna oznaka (prazan string ne isključuje Supabase).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'memory';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'memory';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'e2e-only-secret-at-least-32-characters-long!!';
process.env.CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${process.env.E2E_WEB_PORT ?? 5199}`;
process.env.PORT = process.env.E2E_API_PORT || '4177';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
// B22 — E2E registruje naloge; bcrypt cost 12 bi dominirao trajanjem.
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';
// N10 — svaki odgovor rute se proverava protiv šeme iz `contracts/`
// (`server/lib/respond.ts`); neusklađenost ide u log, ne obara test.
process.env.CONTRACT_CHECK = '1';
process.env.SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'NexusDemo2026!';
process.env.SEED_MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD || 'NexusDemo2026!';

// Nazivi bez ekstenzije (+ `.js` za TS-ov ESM): `tsx` rešava oba oblika relativno
// na ovaj fajl (`e2e/`), pa `index` znači `server/index.ts`.
const { createApp } = await import('index.js');
const { db } = await import('lib/store.js');
const { seedInitialData } = await import('lib/seed.js');

if (db.kind !== 'memory') {
  console.error(`[e2e] Očekivana in-memory baza, dobijeno: ${db.kind}`);
  process.exit(1);
}

await seedInitialData(db);

const app = createApp();
app.listen(Number(process.env.PORT), () => {
  console.log(`[e2e] API (${db.kind}) na http://localhost:${process.env.PORT}/api/health`);
});
