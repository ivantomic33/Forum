import { expect, test } from '@playwright/test';
import { login } from './support/helpers';

/**
 * N-05 — glas na temu (`POST /api/forum/threads/:id/vote`).
 * Gost: klik ne pravi zahtev, već prikazuje uputstvo za prijavu.
 * Prijavljeni: `aria-pressed` se menja i nema toast greške.
 */
const THREAD_LINK = /Da li vredi kupiti RTX 5080/i;

async function openSeededThread(page: import('@playwright/test').Page) {
  await page.goto('/forum?sort=hot');
  const link = page.getByRole('link', { name: THREAD_LINK }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('.vote-btn').first()).toBeVisible({ timeout: 20_000 });
}

test('glas: gost ne glasa (samo uputstvo za prijavu)', async ({ page }) => {
  const votes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/vote')) votes.push(request.url());
  });

  await openSeededThread(page);
  await page.getByTitle('Upvote').click();

  await expect(page.getByText(/Prijavi se/i).first()).toBeVisible();
  expect(votes, 'Gost ne sme da pošalje glas').toEqual([]);
  await expect(page.getByTitle('Upvote')).toHaveAttribute('aria-pressed', 'false');
});

test('glas: prijavljeni korisnik menja glas', async ({ page }) => {
  await login(page);
  await openSeededThread(page);

  const upvote = page.getByTitle('Upvote');
  const karma = page.locator('.vote-count').first();
  const before = await karma.innerText();

  const response = page.waitForResponse(
    (res) => res.url().includes('/vote') && res.request().method() === 'POST',
  );
  await upvote.click();
  const res = await response;

  expect(res.status()).toBe(200);
  await expect(upvote).toHaveAttribute('aria-pressed', 'true');
  // Server vraća novu karmu; UI je prikazuje (vrednost se menja za 1).
  await expect(karma).not.toHaveText(before, { timeout: 10_000 });
  await expect(page.getByText(/Glas nije zabeležen/i)).toHaveCount(0);
});
