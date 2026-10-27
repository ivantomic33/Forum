import { expect, test } from '@playwright/test';
import { ADMIN, login } from './support/helpers';

/**
 * F-32 — admin panel (`/admin`): guard na ruti + upravljanje korisnicima.
 *
 * Guard za gosta je već u `admin-guard.spec.ts`; ovde je scenario za običnog
 * ulogovanog člana (seed: `user_hwgeek`, članka lozinka = admin lozinka u E2E
 * režimu) i admin mutacija (ban/unban kroz tab „Korisnici“).
 */
const MEMBER = { email: 'hwgeek@nexusgaming.com', password: 'NexusDemo2026!', username: 'HardwareGeek' };

test('admin: običan član ne vidi panel — redirect sa login poreklom', async ({ page }) => {
  await login(page, MEMBER);
  await page.goto('/admin');

  // Guard (`isStaff`) vraća na login ili početnu; admin kostur se nikad ne vidi.
  await expect(page).not.toHaveURL(/\/admin/);
  await expect(page.getByRole('heading', { name: /Kontrolna tabla|Upravljanje korisnicima/i })).toHaveCount(0);
});

test('admin: admin otvara tab Korisnici i banuje pa odbanuje člana', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: /Admin|Kontrolna tabla|Dashboard/i }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Tab „Korisnici“ učitava tabelu (`GET /api/admin/users` → lista članova).
  await page.getByRole('button', { name: /Korisnici/i }).first().click();
  const memberRow = page.locator('div.rounded-md.border', { hasText: MEMBER.username }).first();
  await expect(memberRow).toBeVisible({ timeout: 20_000 });

  // Ban — razlog mora imati bar 3 karaktera (modal sa textarea i „Potvrdi ban“).
  await memberRow.getByRole('button', { name: /Banuj/i }).click();
  const reasonBox = page.getByPlaceholder(/Spam, govor mržnje/i);
  await expect(reasonBox).toBeVisible();
  await reasonBox.fill('E2E test ban');
  await page.getByRole('button', { name: /Potvrdi ban/i }).last().click();

  await expect(page.getByText(/je banovan/i)).toBeVisible({ timeout: 10_000 });
  await expect(memberRow.getByText(/BANOVAN/i)).toBeVisible();

  // Odban — vraća status i invalidira listu.
  await memberRow.getByRole('button', { name: /Odbanuj/i }).click();
  await expect(page.getByText(/je odbanovan/i)).toBeVisible({ timeout: 10_000 });
  await expect(memberRow.getByText(/BANOVAN/i)).toHaveCount(0);
});
