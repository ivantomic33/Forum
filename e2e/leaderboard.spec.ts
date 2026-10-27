import { expect, test } from '@playwright/test';
import { collectApiFailures } from './support/helpers';

/**
 * N-07 — rang-lista kao gost: skelet iz glavnog chunk-a, pa leni podijum i
 * lista iz `/api/users/leaderboard/top`. Server sortira ceo skup pre sečenja na
 * `limit`, pa test proverava i red po karmi i red po nivou (XP).
 */
test('rang-lista: gost vidi podijum i listu, oba sortiranja rade', async ({ page }) => {
  const failures = await collectApiFailures(page);

  const response = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === '/api/users/leaderboard/top' && url.searchParams.get('sort') === 'karma';
  });
  await page.goto('/leaderboard');
  expect((await response).status()).toBe(200);

  // Skelet drži `<h1>` do prvog podatka; posle njega ostaje tačno jedan (nema
  // duplog naslova za crawler ni za čitače ekrana).
  const heading = page.getByRole('heading', { level: 1, name: 'Rang-lista zajednice' });
  await expect(heading.first()).toBeVisible();
  await expect(heading).toHaveCount(1);

  // Top 3 iz seed-a (`server/lib/seed.ts`) — pojedinačni `aria-label` dolazi iz
  // `PodiumCard`, pa ne zavisi od virtuelizovane liste ispod.
  await expect(page.getByRole('link', { name: /nexus_admin, 1\. mesto/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /NeuroGamer, 2\. mesto/ })).toBeVisible();

  // Lista je virtuelizovana; red nosi `aria-label` „<rang>. mesto: <korisnik>“.
  await expect(page.locator('a.leader-row').first()).toBeVisible();

  // „Po nivou (XP)“ šalje `sort=level` na server (ranije se sortiralo lokalno).
  const levelResponse = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === '/api/users/leaderboard/top' && url.searchParams.get('sort') === 'level';
  });
  await page.getByRole('tab', { name: /Po nivou/ }).click();
  const level = await levelResponse;
  expect(level.status()).toBe(200);
  await expect(page.getByRole('tab', { name: /Po nivou/ })).toHaveAttribute('aria-selected', 'true');

  // Odgovor servera mora biti u redu po XP-u (level → xp) — ranije se na klijentu
  // sortiralo samo `level → xp` nad 50 najboljih po karmi.
  const payload = (await level.json()) as {
    users: Array<{ username: string; level: number; xp: number }>;
  };
  const expected = [...payload.users]
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .map((u) => u.username);
  expect(payload.users.map((u) => u.username)).toEqual(expected);

  // UI mora da prikaže isti redosled (promena taba ne sme da ostavi stari render).
  // Podijum je u DOM-u kao [2., 1., 3.] (vizuelni raspored), pa se naslovi rangiraju po `aria-label`.
  const podium = page.locator('a[href^="/profile/"][aria-label*=", "][aria-label$="mesto"]');
  await expect(podium).toHaveCount(3);
  const labels = await podium.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label') ?? ''));
  const rankOf = (label: string) => Number(/^(\d+)\.\s*mesto$/.exec(label.split(', ').pop() ?? '')?.[1] ?? 0);
  const byRank = [...labels].sort((a, b) => rankOf(a) - rankOf(b));
  expect(byRank).toEqual(expected.slice(0, 3).map((username, index) => `${username}, ${index + 1}. mesto`));

  expect(failures, `Neuspeli API pozivi: ${failures.join(', ')}`).toEqual([]);
});
