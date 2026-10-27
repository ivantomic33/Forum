import { defineConfig } from 'vitest/config';

/**
 * B22 / N10 — test konfiguracija.
 *
 * `setupFiles` postavlja `NODE_ENV=test`, `BCRYPT_COST=4` i `CONTRACT_CHECK=1`
 * pre nego što ijedan test učita modul (env se čita pri importu). Bez ovoga je
 * bcrypt cost 12 trošio vreme u CI-ju, a neusklađenost odgovora sa `contracts/`
 * nije imala gde da se primeti.
 */
export default defineConfig({
  test: {
    /**
     * 2.13.5 — i testovi zajedničkih skripti (`scripts/*.mjs`). Pravila vesti su
     * deljena između uvoza i backfill-a, pa njihovo ponašanje mora da bude
     * pokriveno isto kao serverske rute.
     */
    include: ['tests/**/*.test.ts', '../scripts/tests/**/*.test.mjs'],
    setupFiles: ['tests/setup.ts'],
    // Integracioni testovi dele in-memory bazu i env — serijski, kao i E2E.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
