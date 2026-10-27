/** QA: namerno baci grešku u HomeMagazine i vrati stack iz graničnika. */
export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(msg.type() + ': ' + msg.text().slice(0, 900)));
  page.on('pageerror', (err) => logs.push('pageerror: ' + (err.stack || String(err)).slice(0, 1400)));
  await page.addInitScript(() => {
    window.__NEXUS_PROBE_THROW = true;
  });
  await page.goto('http://localhost:5176/', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => window.__nexusLastError ?? null).catch(() => null);
  return { state, logs };
}
