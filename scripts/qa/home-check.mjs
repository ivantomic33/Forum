/** QA: proveri render bez probe-a (posle sklanjanja PROBE iz HomeMagazine). */
export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(msg.type() + ': ' + msg.text().slice(0, 600)));
  page.on('pageerror', (err) => logs.push('pageerror: ' + (err.stack || String(err)).slice(0, 1400)));
  await page.goto('http://localhost:5176/', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const root = await page.locator('#root').innerText().catch(() => '');
  return { chars: root.length, start: root.slice(0, 160), logs };
}
