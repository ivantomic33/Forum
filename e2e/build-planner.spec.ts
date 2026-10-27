import { expect, test, type Page } from '@playwright/test';
import { login } from './support/helpers';

/**
 * F-11 — Build Planner (`/build-planner`, `/build/:shareId`).
 *
 * Katalog komponenti u E2E bazi je inicijalno prazan (EmptyState), pa test
 * sam kreira komponente kroz staff API (`POST /api/builds/catalog`) sa
 * `E2E-` prefiksom — automatsko čišćenje nije potrebno jer katalog samo raste,
 * a buildovi se dele preko javnog linka (bez side-efekata na ostale testove).
 */

const CPU_NAME = 'E2E CPU Ryzen 7';
const GPU_NAME = 'E2E GPU RTX 5070';
const CPU_PRICE = 32000;
const GPU_PRICE = 64000;
const TOTAL = CPU_PRICE + GPU_PRICE;

async function seedCatalog(page: Page) {
  /** Staff API poziv iz browser konteksta — session cookie-ji + CSRF (O-04). */
  const seed = (component: { category: string; name: string; price: number }) =>
    page.evaluate(async (body) => {
      const csrf = document.cookie
        .split('; ')
        .find((row) => row.startsWith('nx_csrf='))
        ?.split('=')[1];
      const response = await fetch('/api/builds/catalog', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ ...body, store: 'E2E Prodavnica' }),
      });
      return response.status;
    }, component);

  await page.goto('/build-planner');
  expect(await seed({ category: 'cpu', name: CPU_NAME, price: CPU_PRICE })).toBe(201);
  expect(await seed({ category: 'gpu', name: GPU_NAME, price: GPU_PRICE })).toBe(201);
  await page.reload();
}

test('build planner: izbor komponenti sabira ukupnu cenu', async ({ page }) => {
  await login(page);
  await seedCatalog(page);

  // Select opcije nose „naziv — spec · cena (prodavnica)“, pa biramo po indeksu
  // (prvi ne-prazan `<option>` u kategoriji je naša E2E komponenta).
  await page.locator('#build-cpu').selectOption({ index: 1 });
  const gpuSelect = page.locator('#build-gpu');
  await gpuSelect.selectOption({ index: 1 });

  // Ukupno = zbir cena; obavezni delovi još nedostaju.
  await expect(page.getByText('Ukupno').locator('..')).toContainText(`${TOTAL.toLocaleString('sr-Latn-RS')} RSD`, { timeout: 10_000 });
  await expect(page.getByText(/Nedostaje:/i)).toBeVisible();
  await expect(page.getByText(/Konfiguracija je kompletna/i)).toHaveCount(0);
});

test('build planner: čuvanje daje javni deljivi link (/build/:shareId)', async ({ page }) => {
  await login(page);
  await seedCatalog(page);

  const cpuSelect = page.locator('#build-cpu');
  await cpuSelect.selectOption({ index: 1 });
  await page.locator('#build-gpu').selectOption({ index: 1 });
  await page.locator('#build-title').fill(`E2E build ${Date.now()}`);
  await page.getByRole('button', { name: /Sačuvaj i podeli/i }).click();

  await expect(page.getByText(/Build je sačuvan/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Sačuvano/i)).toBeVisible();

  // Link vodi na javni prikaz i radi i bez prijave (novi kontekst).
  const link = page.getByRole('link', { name: /\/build\//i }).first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/build\/.+/);
  await expect(link).toBeVisible();

  const guest = await page.context().browser()?.newContext();
  if (guest) {
    const guestPage = await guest.newPage();
    await guestPage.goto(href!);
    await expect(guestPage.getByRole('heading', { level: 1 })).toContainText(/E2E build/i);
    await expect(guestPage.getByText(/kompletna konfiguracija|nedostaju obavezni delovi/i)).toBeVisible();
    await guest.close();
  }
});

test('build planner: reset konfiguracije vraća prazno stanje', async ({ page }) => {
  await login(page);
  await seedCatalog(page);

  await page.locator('#build-cpu').selectOption({ index: 1 });
  await expect(page.getByText('Ukupno').locator('..')).toContainText(`${CPU_PRICE.toLocaleString('sr-Latn-RS')} RSD`, { timeout: 10_000 });

  // „ukloni“ resetuje kategoriju; suma pada na 0 (0 RSD, arapski razdvojnik grupa) i sidebar se prazni.
  await page.getByRole('button', { name: /ukloni/i }).first().click();
  await expect(page.getByText(/Još ništa nije izabrano/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Ukupno').locator('..')).toContainText(/0\s?RSD/);
  await expect(page.getByRole('button', { name: /Sačuvaj i podeli/i })).toBeDisabled();
});
