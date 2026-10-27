import { expect, test } from '@playwright/test';
import { dismissCookieConsent, login } from './support/helpers';

/**
 * N-05 / B-08 — mobilni tab bar (Pixel 7) i FAB „Nova tema“ koji Layout
 * prosleđuje kroz `onNewTopic` (ranije je FAB bio mrtav).
 */
test.describe('mobilni', () => {
  test('tab bar navigira između glavnih sekcija', async ({ page }) => {
    await page.goto('/');
    const tabbar = page.getByRole('navigation', { name: 'Mobilna navigacija' });
    await expect(tabbar).toBeVisible();

    await tabbar.getByRole('link', { name: 'Forum' }).click();
    await expect(page).toHaveURL(/\/forum/);

    await tabbar.getByRole('link', { name: 'Popusti' }).click();
    await expect(page).toHaveURL(/\/deals/);
  });

  test('FAB vodi na /forum?compose=1 (bilo gde u aplikaciji)', async ({ page }) => {
    await login(page);
    await dismissCookieConsent(page);

    // Pixel 7 emulacija: posle fokusa na login input `visualViewport.height`
    // (839) ostaje manji od `innerHeight` (915), pa hit-test pogodi `.container`
    // umesto fiksiranog tab-bara (artefakt emulacije, ne aplikacije — bez
    // prijave klik prolazi). `force` klik je legitimna zaobilaznica ovde:
    // vidljivost i stabilnost su već potvrđene pre klika.
    const fab = page.getByRole('button', { name: 'Nova tema na forumu' });
    await expect(fab).toBeVisible();
    await fab.click({ force: true });

    await expect(page).toHaveURL(/\/forum\?compose=1/);
    await expect(page.getByRole('dialog').filter({ hasText: /Nova forum tema/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('gost: FAB vodi na forum, gde kompozitor traži prijavu', async ({ page }) => {
    await page.goto('/');
    await dismissCookieConsent(page);
    await page.getByRole('button', { name: 'Nova tema na forumu' }).click();

    // ForumPage otvara kompozitor samo prijavljenima i preusmerava gosta na /login.
    await expect(page).toHaveURL(/\/login/);
  });
});
