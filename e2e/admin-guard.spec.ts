import { expect, test } from '@playwright/test';
import { login } from './support/helpers';

/**
 * N-05 — admin guard: gost i običan član ne vide panel; admin vidi dashboard.
 */
test('admin guard: gost se preusmerava na prijavu', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('dialog').or(page.locator('form'))).toHaveCount(1);
});

test('admin guard: admin vidi dashboard sa brojem pending prijava (B-13)', async ({ page }) => {
  await login(page);

  const stats = page.waitForResponse((res) => res.url().includes('/api/admin/stats'));
  await page.goto('/admin');
  const response = await stats;
  const body = await response.json();

  // B-13 — `pendingCount` postoji i predstavlja SAMO nerazrešene prijave.
  expect(response.status()).toBe(200);
  expect(typeof body.pendingCount).toBe('number');
  expect(body.pendingCount).toBeGreaterThanOrEqual(0);
  expect(body.pendingCount).toBeLessThanOrEqual(body.totalUsers);

  await expect(page.getByRole('heading', { name: /Admin|Kontrolna tabla|Dashboard/i }).first()).toBeVisible({
    timeout: 20_000,
  });
});
