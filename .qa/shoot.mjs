export default async function run(page, ui) {
  const outDir = 'C:\\Users\\Tomicc\\Desktop\\Forum\\.qa';
  const waitFor = ['#main-content h1', '#main-content h2', '#main-content form', '.auth-shell'];
  const results = [];

  const pages = [
    ['01-home', '/'],
    ['02-article', '/article/cyberpunk-2077-phantom-liberty-analiza'],
    ['03-forum', '/forum'],
    ['04-forum-pc-gaming', '/forum/pc-gaming'],
    ['05-thread', '/thread/65bd583f-d2d3-48ee-82d3-cf697d8a80fe'],
    ['06-profile', '/profile/TechMaster99'],
    ['07-leaderboard', '/leaderboard'],
    ['08-login', '/login'],
    ['09-register', '/register'],
    ['10-forgot', '/forgot-password'],
    ['11-notifications', '/notifications'],
    ['12-admin', '/admin'],
    ['13-admin-reports', '/admin/reports'],
    ['14-terms', '/terms'],
    ['15-privacy', '/privacy'],
    ['16-rules', '/rules'],
    ['17-notfound', '/this-route-does-not-exist'],
  ];

  for (const [name, path] of pages) {
    await page.goto('http://localhost:4179' + path, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector(waitFor.join(', '), { timeout: 4000 });
    } catch {
      /* stranica bez naslova (npr. auth) — nastavi */
    }
    await page.waitForTimeout(1400);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    const file = `${outDir}\\${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const dims = await page.evaluate(() => ({
      chars: document.body.innerText.length,
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    results.push({ name, path, ...dims, file });
  }

  return results;
}
