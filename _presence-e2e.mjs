// E2E: prijava -> heartbeat -> zeleni prsten u UI-ju (2.6.1)
export default async function run(page, ui) {
  await page.goto('http://localhost:5173/login');
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });

  await page.fill('input[type="email"], input[autocomplete="username"]', 'presence.e2e@nexus.local');
  await page.fill('input[type="password"]', 'Presence#2026');

  // `page.getByRole` postoji samo u `@playwright/test`; ovaj skript dobija čist `page`.
  const submit = page.locator('button.auth-submit, button[type="submit"]').last();
  await submit.click();
  await page.waitForTimeout(4000);

  const afterLogin = await page.evaluate(() => ({
    url: location.pathname,
    navbarRing: Boolean(document.querySelector('header img.is-online, nav img.is-online')),
  }));

  // Heartbeat mora da prođe kroz sesiju.
  const heartbeat = await page.evaluate(async () => {
    const csrf = (document.cookie.match(/nx_csrf=([^;]+)/) || [])[1];
    const res = await fetch('/api/auth/heartbeat', {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });

  await page.goto('http://localhost:5173/profile/presence_e2e');
  await page.waitForSelector('#profile-name', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const profile = await page.evaluate(() => {
    const img = document.querySelector('.profile-avatar-frame img');
    const style = img ? getComputedStyle(img) : null;
    return {
      ring: Boolean(img && img.classList.contains('is-online')),
      title: img?.getAttribute('title'),
      boxShadow: style?.boxShadow,
      pill: document.querySelector('.online-pill')?.textContent ?? null,
    };
  });

  await page.screenshot({ path: 'C:/Users/Tomicc/Desktop/Forum/_presence-e2e.png', clip: { x: 0, y: 0, width: 1280, height: 520 } });
  return { afterLogin, heartbeat, profile };
}
