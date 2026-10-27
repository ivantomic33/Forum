import { expect, test } from '@playwright/test';
import { dismissCookieConsent } from './support/helpers';

/**
 * 2.6.2 / F-13 — pretraga: navbar drawer (`/search?q=`) i Command Palette
 * (⌘K / Ctrl+K, `role="listbox"`). Seed sadrži članak o GTA 6, temu
 * „Da li vredi kupiti RTX 5080“ i deal-ove (Elden Ring, Cyberpunk…).
 */

test('pretraga: navbar unos vodi na stranicu rezultata sa hitovima', async ({ page }) => {
  await dismissCookieConsent(page);
  await page.goto('/');

  // Drawer se otvara preko ikone (`aria-controls="navbar-search"`).
  await page.getByRole('button', { name: 'Pretraga' }).click();
  const input = page.locator('#navbar-search input');
  await expect(input).toBeVisible();
  await input.fill('RTX 5080');
  await input.press('Enter');

  await expect(page).toHaveURL(/\/search\?q=RTX%205080/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('RTX 5080');
  await expect(page.getByText(/Da li vredi kupiti RTX 5080/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Nema rezultata/i)).toHaveCount(0);
});

test('pretraga: tabovi (filteri) skopiraju rezultate po tipu', async ({ page }) => {
  await page.goto('/search?q=RTX 5080');

  await expect(page.getByRole('tab', { name: /Sve/i })).toBeVisible({ timeout: 20_000 });
  // Tab „Forum“ postavlja `type=threads` u URL-u — server filtrira.
  await page.getByRole('tab', { name: /Forum/i }).click();
  await expect(page).toHaveURL(/type=threads/);
  await expect(page.getByText(/Da li vredi kupiti RTX 5080/i).first()).toBeVisible();

  // Tab „Članci“ u istom upitu ne sme da pokaže temu.
  await page.getByRole('tab', { name: /Članci/i }).click();
  await expect(page).toHaveURL(/type=articles/);
  await expect(page.getByText(/Da li vredi kupiti RTX 5080/i)).toHaveCount(0);
});

test('pretraga: prazan rezultat prikazuje „Nema rezultata“', async ({ page }) => {
  const term = `zzq-${Date.now()}-nema-ga`;
  await page.goto(`/search?q=${encodeURIComponent(term)}`);

  await expect(page.getByText(/Nema rezultata/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(new RegExp(`Ništa nije pronađeno za „${term}`))).toBeVisible();
});

test('pretraga: Command Palette (Ctrl+K) — tastatura bira rezultat i Enter navigira', async ({ page }) => {
  await dismissCookieConsent(page);
  await page.goto('/');

  // Čekaj da se app hydrate-uje (lazy chunkovi) pre keyboard shortcut-a.
  await expect(page.getByRole('button', { name: 'Pretraga' })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Globalna pretraga' });
  await expect(palette).toBeVisible();

  const input = palette.getByRole('textbox', { name: 'Pretraga' });
  await input.fill('Elden Ring');

  // Debounce: server poziv ide tek posle 2+ znaka; listbox se puni rezultatima.
  const results = page.getByRole('listbox', { name: 'Rezultati pretrage' });
  await expect(results).toBeVisible({ timeout: 20_000 });
  const options = results.getByRole('option');
  const count = await options.count();
  expect(count).toBeGreaterThan(0);

  // ArrowDown pomera aktivni red (aria-selected), Enter otvara cilj.
  await input.press('ArrowDown');
  const second = (await options.count()) > 1 ? options.nth(1) : options.first();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');

  // Overlay se zatvara i navigacija je na stvarnu rutu sadržaja.
  await expect(palette).toBeHidden();
  await expect(page).not.toHaveURL(/\/$/);
  await expect(page).toHaveURL(/\/(article|thread|deal|games)\//);
});
