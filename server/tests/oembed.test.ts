import { describe, expect, it } from 'vitest';
import { isBlockedHost, extractMeta } from '../routes/oembed.js';

describe('oembed SSRF zaštita — isBlockedHost', () => {
  it('blokira localhost i privatne IPv4 raspone', () => {
    for (const host of [
      'localhost', 'sub.localhost', 'host.local', 'svc.internal',
      '127.0.0.1', '127.8.8.8', '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', // cloud metadata endpoint
      '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });
  it('blokira IPv6 loopback/ULA/link-local', () => {
    for (const host of ['::1', '::', 'fd00::1', 'fe80::1', '[::1]']) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });
  it('dozvoljava javne hostove', () => {
    for (const host of ['example.com', '172.32.0.1', '192.169.0.1', '8.8.8.8', '100.128.0.1']) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });
});

describe('oembed meta ekstrakcija', () => {
  it('izvlači og metapodatke i forsira https sliku', () => {
    const html = `<html><head>
      <title>Stari naslov</title>
      <meta property="og:title" content="Naslov sajta">
      <meta property="og:description" content="Opis">
      <meta property="og:image" content="http://insecure.example.com/img.jpg">
    </head></html>`;
    const meta = extractMeta(html, 'https://example.com/post');
    expect(meta.title).toBe('Naslov sajta');
    expect(meta.description).toBe('Opis');
    expect(meta.image).toBeUndefined(); // http slika se odbacuje
  });
  it('skida kontrolne znakove iz meta vrednosti', () => {
    const meta = extractMeta('<title>a\u0000b</title>', 'https://example.com');
    expect(meta.title).toBe('ab');
  });
});
