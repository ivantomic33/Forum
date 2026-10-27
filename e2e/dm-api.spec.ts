import { expect, test } from '@playwright/test';
import { ADMIN, login } from './support/helpers';

/**
 * 2.11.0 — privatne poruke (DM). API-nivo test.
 *
 * Frontend za `/messages` u ovom trenutku ne postoji, pa se ugovor proverava
 * kroz `page.evaluate(fetch)` iz prijavljenog konteksta (session cookie-ji +
 * CSRF token, isto kao `build-planner.spec.ts`). Time se hvataju regresije u
 * rutama koje bi inače bile nepokrivene.
 *
 * Seed: `HardwareGeek` (`hwgeek@nexusgaming.com`).
 */
const MEMBER_USERNAME = 'HardwareGeek';

test('dm: razgovor, poruka, nepročitano i označavanje pročitanim', async ({ page }) => {
  await login(page);

  const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
    page.evaluate(
      async ({ path, method, body }) => {
        const csrf = document.cookie
          .split('; ')
          .find((row) => row.startsWith('nx_csrf='))
          ?.split('=')[1];
        const response = await fetch(`/api${path}`, {
          method: method ?? 'GET',
          credentials: 'include',
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(method && method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json().catch(() => ({}));
        return { status: response.status, data };
      },
      { path, method: init.method, body: init.body },
    );

  // Nepoznat korisnik → 404 (ne otkriva postojanje naloga).
  const missing = await api('/dm/send', { method: 'POST', body: { toUsername: 'nema-ovakav', content: 'cao' } });
  expect(missing.status).toBe(404);

  // Razgovor sa sobom → 400.
  const self = await api('/dm/send', {
    method: 'POST',
    body: { toUsername: ADMIN.username, content: 'cao ja' },
  });
  expect(self.status).toBe(400);

  // Poruka članu — pravi razgovor (ili ga nalazi).
  const sent = await api('/dm/send', {
    method: 'POST',
    body: { toUsername: MEMBER_USERNAME, content: `E2E DM ${Date.now()}` },
  });
  expect(sent.status).toBe(201);
  expect(sent.data.conversationId).toBeTruthy();
  expect(sent.data.message?.content).toContain('E2E DM');

  const conversationId = sent.data.conversationId as string;

  // Lista razgovora sadrži ovaj razgovor.
  const list = await api('/dm');
  expect(list.status).toBe(200);
  expect(list.data.conversations?.some((c: any) => c.id === conversationId)).toBe(true);

  // Poruke razgovora (hronološki, najstarija prva).
  const messages = await api(`/dm/${conversationId}`);
  expect(messages.status).toBe(200);
  expect(messages.data.messages?.length).toBeGreaterThan(0);
  expect(messages.data.conversation?.partnerUsername).toBe(MEMBER_USERNAME);

  // Nepostojeći razgovor → 404, ne 403 (ne odajemo da postoji).
  const unknown = await api('/dm/00000000-0000-0000-0000-000000000000');
  expect(unknown.status).toBe(404);

  // Gost ne vidi DM.
  const guest = await page.context().browser()?.newContext();
  if (guest) {
    const guestPage = await guest.newPage();
    await guestPage.goto('/login');
    const guestStatus = await guestPage.evaluate(async () => {
      const response = await fetch('/api/dm');
      return response.status;
    });
    expect(guestStatus).toBe(401);
    await guest.close();
  }
});

test('dm: prazna poruka je odbijena sa 400', async ({ page }) => {
  await login(page);

  const status = await page.evaluate(async (username) => {
    const csrf = document.cookie
      .split('; ')
      .find((row) => row.startsWith('nx_csrf='))
      ?.split('=')[1];
    const response = await fetch('/api/dm/send', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ toUsername: username, content: '   ' }),
    });
    return response.status;
  }, MEMBER_USERNAME);

  expect(status).toBe(400);
});
