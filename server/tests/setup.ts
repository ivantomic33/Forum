/**
 * B22 — VITEST SETUP
 * ------------------
 * `NODE_ENV=test` je Vitest-ov default, ali se ne postavlja ako je ljuska
 * eksplicitno prosledila `NODE_ENV=development`. Ovde se osigurava pre nego
 * što se učita ijedan modul:
 *
 *  - `BCRYPT_COST=4`        → `vitest run` ne troši ~250 ms po hash-u (cost 12);
 *  - `CONTRACT_CHECK=1`     → svaki odgovor rute se proverava protiv šeme iz
 *    `contracts/` (`server/lib/respond.ts`), pa „promena polja servera“ pada
 *    u testu, a ne u browseru klijenta (N10).
 *
 * Ne dira `SUPABASE_URL` ni `JWT_SECRET` — to ostaje odgovornost svakog testa
 * (in-memory režim se uključuje eksplicitno sa `SUPABASE_URL=memory`).
 */
export default function setup() {
  process.env.NODE_ENV ??= 'test';
  process.env.BCRYPT_COST ??= '4';
  process.env.CONTRACT_CHECK ??= '1';
}
