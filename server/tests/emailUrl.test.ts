import { afterEach, describe, expect, it } from 'vitest';
import { appUrl } from '../lib/email.js';

/**
 * F-15 — linkovi u mejlovima moraju koristiti JEDAN domen.
 * Ranije je `CLIENT_URL=https://a,https://b` davalo `https://a,https://b/verify?...`.
 */
describe('appUrl (F-15)', () => {
  const original = {
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    CLIENT_URL: process.env.CLIENT_URL,
  };

  afterEach(() => {
    for (const key of ['PUBLIC_APP_URL', 'CLIENT_URL'] as const) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('PUBLIC_APP_URL ima prioritet nad listom CLIENT_URL', () => {
    process.env.PUBLIC_APP_URL = 'https://app.nexus.rs';
    process.env.CLIENT_URL = 'https://nexus.rs,https://www.nexus.rs';
    expect(appUrl()).toBe('https://app.nexus.rs');
  });

  it('lista CLIENT_URL se svodi na PRVI domen', () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.CLIENT_URL = 'https://nexus.rs,https://www.nexus.rs';
    expect(appUrl()).toBe('https://nexus.rs');
  });

  it('skida završni slash', () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.CLIENT_URL = 'https://nexus.rs/';
    expect(appUrl()).toBe('https://nexus.rs');
  });
});
