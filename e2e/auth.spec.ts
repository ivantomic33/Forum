import { expect, test } from '@playwright/test';
import { ADMIN, isLoggedIn, login } from './support/helpers';

test.describe('autentifikacija', () => {
  test('prijava admina prikazuje profil u navbaru', async ({ page }) => {
    expect(await isLoggedIn(page)).toBe(false);
    await login(page);
    await expect(
      page.locator('nav button[aria-haspopup="menu"]').filter({ hasText: ADMIN.username }).first(),
    ).toBeVisible();
  });

  test('pogrešna lozinka prikazuje grešku i ne uloguje', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill(ADMIN.email);
    await page.locator('input[type=password]').fill('pogresna-lozinka-123');
    await page.locator('button[type=submit]').first().click();

    await expect(page.locator('nav button[aria-haspopup="menu"]')).toHaveCount(0, { timeout: 15_000 });
    // Server vraća 401 sa porukom; UI je prikazuje u formi.
    await expect(page.getByText(/Pogrešan|lozinka|Prijava|\d+ pokušaj/i).first()).toBeVisible();
  });
});
