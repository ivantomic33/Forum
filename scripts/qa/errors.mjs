export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(msg.type() + ': ' + msg.text().slice(0, 600)));
  page.on('pageerror', (err) => logs.push('pageerror: ' + (err.stack || String(err)).slice(0, 1200)));
  await page.goto('http://localhost:5176/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => (window).__nexusLastError ?? null).catch(() => null);
  return { logs, state };
}
