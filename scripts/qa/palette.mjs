/**
 * QA za F-13 (⌘K paleta + pretraga odgovora) i F-3 (deal → tema).
 *
 *   node <skill>/browser.mjs http://localhost:5176/ --script scripts/qa/palette.mjs
 *
 * API ide kroz Vite proxy (`/api`), pa nije potreban poseban port.
 */
const APP = 'http://localhost:5176';

export default async function run(page) {
  const result = {};
  await page.waitForFunction(() => document.querySelector('#root')?.textContent?.includes('NEXUS'), null, { timeout: 20000 });

  // 1. Ctrl+K otvara overlay
  await page.keyboard.press('Control+K');
  const dialog = page.locator('[role="dialog"][aria-label="Globalna pretraga"]');
  result.paletteOpened = await dialog.count();
  result.scopeTabs = await page.locator('[role="tab"]').allInnerTexts();

  // 2. Kucanje daje rezultate (baza je seedovana)
  const input = dialog.locator('input[aria-label="Pretraga"]');
  await input.fill('igra');
  await page.waitForTimeout(2500);
  result.hitRows = await page.locator('#palette-results [role="option"]').count();
  result.firstHit = result.hitRows > 0 ? (await page.locator('#palette-results [role="option"]').first().innerText()).split('\n')[0] : null;

  // 3. API ugovor za odgovore
  const replies = await page.request.get(`${APP}/api/search?q=igra&type=replies&limit=5`);
  result.repliesStatus = replies.status();
  const body = await replies.json().catch(() => null);
  result.repliesTypes = Array.isArray(body?.hits) ? [...new Set(body.hits.map((hit) => hit.type))] : null;

  // 4. Escape zatvara
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  result.paletteClosed = await dialog.count();

  // 5. Deal stranica: dugme „Diskutuj o popustu“ (ako postoji deal)
  const deals = await page.request.get(`${APP}/api/deals?limit=1`);
  const dealId = (await deals.json().catch(() => null))?.deals?.[0]?.id ?? null;
  result.dealId = dealId;
  if (dealId) {
    await page.goto(`${APP}/deals/${dealId}`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    result.discussButton = await page.getByRole('button', { name: 'Diskutuj o popustu' }).count();
  }

  return result;
}
