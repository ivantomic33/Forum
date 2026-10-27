import { expect, test } from '@playwright/test';
import { collectApiFailures } from './support/helpers';

/**
 * N-05 / N-01 — gost na početnoj: sadržaj iz seed-a se prikazuje, a auth
 * saobraćaja nema (bez `/auth/me`, bez refresh-a, bez heartbeat-a).
 */
test('gost: početna prikazuje sadržaj bez ijednog neuspelog API poziva', async ({ page }) => {
  const failures = await collectApiFailures(page);

  await page.goto('/');
  await expect(page.locator('nav').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /NEXUS/i }).first()).toBeVisible();

  // Seed: 8 članaka — bar jedan naslov i link ka članku moraju da postoje.
  await expect(page.locator('a[href^="/article/"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Phantom Liberty|RTX 5090|Elden Ring/i).first()).toBeVisible();

  // Gost ne pravi auth saobraćaj.
  const authCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/')) authCalls.push(new URL(request.url()).pathname);
  });
  await page.goto('/forum');
  await page.waitForTimeout(1500);

  expect(failures, `Neuspeli API pozivi: ${failures.join(', ')}`).toEqual([]);
  expect(authCalls.filter((path) => path !== '/api/auth/config')).toEqual([]);
});
