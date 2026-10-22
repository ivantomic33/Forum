import { describe, expect, it } from 'vitest';
import { assertPublicHost, checkExternalUrl, fetchOfferPreview, parseOfferHtml } from '../lib/deals.js';

/**
 * DEALS 2.6.2 — čitanje ponude sa prodavnice
 * ------------------------------------------
 * Dva sloja:
 *  1. `parseOfferHtml` — čist parser (bez mreže, bezbedno za test),
 *  2. `fetchOfferPreview` — SSRF zaštita (DNS rešava pre zahteva, redirect
 *     se ne prati) sa injektovanim `lookup`/`fetch` (nema pravog DNS-a).
 */

const STEAM_HTML = `
<!doctype html><html><head>
  <title>Hogwarts Legacy na Steamu</title>
  <meta property="og:title" content="Hogwarts Legacy">
  <meta content="https://cdn.cloudflare.steamstatic.com/steam/apps/990080/header.jpg" property="og:image">
  <meta property="product:price:amount" content="29,99">
  <meta property="product:price:currency" content="eur">
</head><body><script>var g_rgAppsCurrent = {"price":"59.99"};</script></body></html>`;

describe('parseOfferHtml', () => {
  it('uzima og:title, og:image (i obrnut redosled atributa), cenu i valutu', () => {
    const parsed = parseOfferHtml(STEAM_HTML, 'https://store.steampowered.com/app/990080/');
    expect(parsed.title).toBe('Hogwarts Legacy');
    expect(parsed.imageUrl).toBe('https://cdn.cloudflare.steamstatic.com/steam/apps/990080/header.jpg');
    // Decimalni zarez se normalizuje; `product:price` ima prioritet nad JSON-om.
    expect(parsed.price).toBe(29.99);
    expect(parsed.currency).toBe('EUR');
    expect(parsed.store).toBe('store.steampowered.com');
  });

  it('dekodira entitete u naslovu i pada na <title>', () => {
    const parsed = parseOfferHtml('<title>Tom &amp; Jerry — 50%</title>', 'https://example.com/x');
    expect(parsed.title).toBe('Tom & Jerry — 50%');
    expect(parsed.price).toBeNull();
  });

  it('odbija http:// sliku (samo https ulazi u dokaz)', () => {
    const parsed = parseOfferHtml('<meta property="og:image" content="http://cdn.example.com/a.png">', 'https://example.com');
    expect(parsed.imageUrl).toBeNull();
  });

  it('ne prihvata valutu koja nije ISO 4217', () => {
    const parsed = parseOfferHtml('<meta property="product:price:currency" content="din">', 'https://example.com');
    expect(parsed.currency).toBeNull();
  });
});

describe('SSRF zaštita (2.6.2)', () => {
  it('odbija linkove ka privatnim adresama i metadata servisu', async () => {
    expect(checkExternalUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(checkExternalUrl('https://localhost:4000/admin').ok).toBe(false);
    expect(checkExternalUrl('https://metadata.google.internal/').ok).toBe(false);

    const preview = await fetchOfferPreview('https://127.0.0.1/ponuda');
    expect(preview.error).toBeTruthy();
    expect(preview.title).toBeNull();
  });

  it('odbija domen koji se rešava na privatnu IP (DNS rebinding)', async () => {
    await expect(
      assertPublicHost('evil.example', async () => [{ address: '10.0.0.5', family: 4 }]),
    ).rejects.toThrow();
    await expect(
      assertPublicHost('evil.example', async () => [{ address: '93.184.216.34', family: 4 }]),
    ).resolves.toBeUndefined();
  });

  it('ne prati redirect i ne čita odgovor koji nije HTML', async () => {
    const redirect = await fetchOfferPreview('https://shop.example/p', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: (async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } })) as typeof fetch,
    });
    expect(redirect.error).toMatch(/preusmerava/);

    const json = await fetchOfferPreview('https://shop.example/p', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: (async () =>
        new Response('{"price":1}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    expect(json.error).toMatch(/HTML/);
  });

  it('uspešno parsira ponudu (injektovan fetch, bez mreže)', async () => {
    const preview = await fetchOfferPreview('https://store.steampowered.com/app/990080/', {
      lookup: async () => [{ address: '23.45.67.89', family: 4 }],
      fetch: (async () =>
        new Response(STEAM_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch,
    });
    expect(preview.error).toBeUndefined();
    expect(preview.title).toBe('Hogwarts Legacy');
    expect(preview.price).toBe(29.99);
  });
});
