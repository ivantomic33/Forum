import { expect, test } from '@playwright/test';

/**
 * N-05 — /deals: seed ima 3 deal-a u 3 igre; kartice se prikazuju bez greške.
 */
test('deals: lista prikazuje seed popuste', async ({ page }) => {
  await page.goto('/deals');

  await expect(page.getByText(/Elden Ring/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Cyberpunk 2077/i).first()).toBeVisible();
  await expect(page.getByText(/God of War/i).first()).toBeVisible();
  await expect(page.getByText(/Greška|Nema popusta/i)).toHaveCount(0);

  // Detalj prvog deal-a se otvara (Game Page / Deal Page).
  await page.locator('a[href^="/deals/"]').first().click();
  await expect(page).toHaveURL(/\/deals\/.+/);
  await expect(page.getByText(/Greška pri učitavanju|Nije pronađen/i)).toHaveCount(0);
});
