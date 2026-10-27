import { expect, type Page } from '@playwright/test';

/**
 * N-05 — zajednički koraci za smoke testove.
 * Seed (`server/lib/seed.ts`) garantuje ove naloge u E2E bazi.
 */
export const ADMIN = { email: 'admin@nexusgaming.com', password: 'NexusDemo2026!', username: 'nexus_admin' };

/** Mobilni bar (`lg:hidden`) ima FAB — na malom ekranu ga CookieConsent može prekriti. */
export async function dismissCookieConsent(page: Page) {
  const reject = page.getByRole('button', { name: /Odbij|Samo neophodn|Only necessary/i });
  if (await reject.count()) await reject.first().click();
}

/** Prijava preko UI-ja; čeka da sesija stigne u store (avatar u navbaru). */
export async function login(page: Page, user = ADMIN) {
  await page.goto('/login');
  await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[type=password]').fill(user.password);
  await page.locator('button[type=submit]').first().click();
  // Desktop avatar (dugme sa aria-expanded) je jedini pouzdan marker prijave —
  // profil-linkovi u meniju su na mobilnom skriveni (`lg:hidden` / dropdown).
  await expect(
    page.locator('nav button[aria-haspopup="menu"]').filter({ hasText: user.username }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

/** Da li je korisnik prijavljen (bez zavisnosti od viewport-a). */
export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await page.locator('nav button[aria-haspopup="menu"]').count()) > 0;
}

/** Gost: nijedan auth zahtev ne sme da padne (N-01) i nema `/auth/me`. */
export async function collectApiFailures(page: Page) {
  const failures: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    if (response.status() >= 400) failures.push(`${response.status()} ${new URL(url).pathname}`);
  });
  return failures;
}
