import { defineConfig, devices } from '@playwright/test';

/**
 * N-05 — E2E smoke (Playwright).
 *
 * Testovi su samostalni: `e2e/support/server.mjs` podiže API u in-memory režimu
 * (demo seed iz `server/lib/seed.ts`) i Vite sa proxy-jem na taj API. Nema
 * Supabase-a, `.env`-a ni spoljnog harness-a — `npm run e2e` je dovoljno.
 *
 * Portovi su namerno drugačiji od razvojnih (4000/5173), da lokalni `npm run dev`
 * može da radi paralelno sa testovima.
 */
const API_PORT = process.env.E2E_API_PORT ?? '4177';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5199';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Jedan API + jedna baza između testova: serijski rad čuva determinizam.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Testovi ne smeju da posmatraju tuđe greške konzole; `auth` test proverava 401.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      // Mobilni smoke (tab bar/FAB) se izvršava samo u `mobile` projektu.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // `npx` iz konteksta `server/` rešava serverov `tsx` (devDependency);
      // N-11 — E2E API je u `server/e2e/server.ts`, pa `contracts/` i `zod`
      // dolaze iz iste instalacije kao i server (nema drugog lockfile-a).
      command: 'npx tsx e2e/server.ts',
      cwd: 'server',
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        E2E_API_PORT: API_PORT,
        E2E_WEB_PORT: WEB_PORT,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        E2E_API_PORT: API_PORT,
        // Proxy u vite.config.ts `changeOrigin` cilja 4000; za testove ide na E2E_API_PORT.
        VITE_DEV_PROXY_TARGET: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
