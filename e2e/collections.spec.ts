import { expect, test, type Page } from '@playwright/test';
import { login } from './support/helpers';

/**
 * F-5 — kolekcije (`/collections`, `/collections/:slug`).
 *
 * Test entiteti nose `E2E lista` prefiks i timestamp, pa se seed ne dira.
 * Seed NE kreira kolekcije, pa gost-test koristi javnu listu koju ostavi
 * test #1 (svi testovi dele istu in-memory bazu, workers: 1).
 */
const STAMP = Date.now();
const GAME = "Baldur's Gate 3";

async function createList(page: Page, title: string) {
  await login(page);
  await page.goto('/collections');
  await page.getByRole('button', { name: /Napravi listu/i }).click();
  await page.locator('#collection-title').fill(title);
  await page.getByRole('button', { name: /^Napravi$/i }).click();
  // Nakon kreiranja UI navigira na `/collections/:slug`; naslov je u `<h1>`.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title, { timeout: 20_000 });
}

async function deleteList(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Obriši listu/i }).click();
  // onSuccess radi full reload na `/collections`.
  await expect(page).toHaveURL(/\/collections\/?$/, { timeout: 10_000 });
}

test('kolekcije: korisnik kreira javnu listu i dodaje igru', async ({ page }) => {
  const title = `E2E javna lista ${STAMP}`;
  await createList(page, title);

  // Dodavanje stavke — owner ima „Dodaj igru“.
  await page.getByRole('button', { name: /Dodaj igru/i }).click();
  await page.locator('#collection-game').fill(GAME);
  await page.locator('#collection-note').fill('E2E test stavka');
  await page.getByRole('button', { name: /^Dodaj$/i }).click();

  await expect(page.getByText(/Igra je dodata na listu/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(GAME).first()).toBeVisible();
  await expect(page.getByText(/Lista · 1 igar/i).first()).toBeVisible();

  // Lista ostaje javna (bez brisanja) — koristi je gost-test ispod.
});

test('kolekcije: vlasnik briše stavku sa liste i briše listu', async ({ page }) => {
  const title = `E2E lista za brisanje ${STAMP}`;
  await createList(page, title);

  await page.getByRole('button', { name: /Dodaj igru/i }).click();
  await page.locator('#collection-game').fill(GAME);
  await page.getByRole('button', { name: /^Dodaj$/i }).click();
  await expect(page.getByText(GAME).first()).toBeVisible({ timeout: 10_000 });

  // Uklanjanje stavke — pristupačno ime dugmeta (`aria-label`).
  await page.getByRole('button', { name: new RegExp(`Ukloni ${GAME} sa liste`) }).click();
  await expect(page.getByText(GAME).first()).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(/Lista je još prazna/i)).toBeVisible();

  await deleteList(page);
});

test('kolekcije: gost vidi javne liste, bez vlasničkih alatki', async ({ page }) => {
  // Gost ne može da kreira listu — CTA vodi na prijavu.
  await page.goto('/collections');
  await page.getByRole('button', { name: /Napravi listu/i }).click();
  await expect(page).toHaveURL(/\/login/);

  // Javna lista iz testa #1 je vidljiva na pregledu i otvara se bez prijave.
  await page.goto('/collections');
  const link = page.getByRole('link', { name: /Otvori listu/i }).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(page).toHaveURL(/\/collections\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Gost nema vlasničke alatke (Dodaj/Obriši) i ne može glasati (disabled).
  await expect(page.getByRole('button', { name: /Dodaj igru/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Obriši listu/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /glasova/i })).toBeDisabled();
});

test('kolekcije: pretraga filtrira liste po naslovu', async ({ page }) => {
  const title = `E2E filter lista ${STAMP}`;
  await createList(page, title);
  await page.goto('/collections');

  const search = page.locator('#collections-search');
  await search.fill(title);
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /E2E javna lista/ })).toHaveCount(0);

  // Čišćenje.
  await page.getByRole('link', { name: /Otvori listu/i }).first().click();
  await expect(page.getByRole('button', { name: /Obriši listu/i })).toBeVisible({ timeout: 10_000 });
  await deleteList(page);
});
