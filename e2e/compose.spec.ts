import { expect, test } from '@playwright/test';
import { login } from './support/helpers';

/**
 * N-05 / B-08 — „Nova tema“ kroz URL kontrakt `?compose=1` (isti put koji
 * koristi mobilni FAB iz Layout-a) i uspešno objavljivanje teme.
 */
test('nova tema: /forum?compose=1 otvara kompozitor i tema se objavljuje', async ({ page }) => {
  await login(page);

  await page.goto('/forum?compose=1');
  const dialog = page.getByRole('dialog').filter({ hasText: 'Nova forum tema' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  // Parametar se uklanja iz URL-a — osvežavanje ne otvara prazan kompozitor.
  await expect(page).toHaveURL(/\/forum(\?|$)/);
  await expect(page).not.toHaveURL(/compose=1/);

  const title = `E2E tema ${Date.now()}`;
  await page.locator('#thread-title').fill(title);
  await page.locator('#thread-content').fill('Automatski test — slobodno obrišite ovu temu.');
  const created = page.waitForResponse(
    (res) => /\/api\/forum\/[^/]+\/threads$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Objavi temu/i }).click();
  expect((await created).status()).toBe(201);

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  // Nova tema je na vrhu liste (sort „Hot“ je default; idemo na tab „Novo“).
  await page.getByRole('tab', { name: 'Novo' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 20_000 });
});
