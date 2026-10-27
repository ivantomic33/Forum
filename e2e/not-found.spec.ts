import { expect, test } from '@playwright/test';

/** N-05 — nepostojeća ruta prikazuje 404 stranicu sa putem nazad. */
test('404: nepoznata ruta prikazuje NotFound sa linkom ka početnoj', async ({ page }) => {
  const response = await page.goto('/ova-stranica-ne-postoji');
  // SPA fallback servira index.html (200), a React Router prikazuje 404 sadržaj.
  expect([200, 404]).toContain(response?.status() ?? 200);

  await expect(page.getByText(/404/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/nije pronađena|ne postoji|Not Found/i).first()).toBeVisible();

  await page.getByRole('link', { name: /početn|Nazad|Home/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
});
