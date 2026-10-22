import { afterEach, describe, expect, it } from 'vitest';
import { parseTrustProxy, positiveInt, devTokensExposed } from '../lib/env.js';

/**
 * F-05: `trust proxy` mora biti `false` kada nije konfigurisan, inače se
 * X-Forwarded-For prihvata bez proxy-ja i rate limit se zaobilazi.
 */
describe('parseTrustProxy', () => {
  it('bez vrednosti → false (XFF se ne prihvata)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
  });

  it('eksplicitno isključivanje', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('off')).toBe(false);
  });

  it('broj hopova', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('lista IP adresa / CIDR opsega', () => {
    expect(parseTrustProxy('10.0.0.1,10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(parseTrustProxy('10.0.0.0/8 fc00::/7')).toEqual(['10.0.0.0/8', 'fc00::/7']);
  });

  it('`true` ostaje boolean (nikad NaN)', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(Number.isNaN(Number('true'))).toBe(true); // ranije se ovako dobijalo NaN
  });
});

describe('positiveInt', () => {
  it('neispravna vrednost pada na fallback', () => {
    expect(positiveInt(undefined, 10)).toBe(10);
    expect(positiveInt('abc', 10)).toBe(10);
    expect(positiveInt('-5', 10)).toBe(10);
    expect(positiveInt('0', 10)).toBe(10);
    expect(positiveInt('1.5', 10)).toBe(10);
  });

  it('ispravna vrednost se poštuje', () => {
    expect(positiveInt('25', 10)).toBe(25);
  });
});

/**
 * F-02: tokeni se smeju vratiti u API odgovoru samo u lokalnom razvoju sa
 * eksplicitnim opt-in-om — staging ili zaboravljen NODE_ENV nije dovoljno.
 */
describe('devTokensExposed', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, DEV_EXPOSE_TOKENS: process.env.DEV_EXPOSE_TOKENS };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    if (original.DEV_EXPOSE_TOKENS === undefined) delete process.env.DEV_EXPOSE_TOKENS;
    else process.env.DEV_EXPOSE_TOKENS = original.DEV_EXPOSE_TOKENS;
  });

  it('development + DEV_EXPOSE_TOKENS=1 → true', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_EXPOSE_TOKENS = '1';
    expect(devTokensExposed()).toBe(true);
  });

  it('bez DEV_EXPOSE_TOKENS → false', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_EXPOSE_TOKENS;
    expect(devTokensExposed()).toBe(false);
  });

  it('staging → false čak i uz DEV_EXPOSE_TOKENS=1', () => {
    process.env.NODE_ENV = 'staging';
    process.env.DEV_EXPOSE_TOKENS = '1';
    expect(devTokensExposed()).toBe(false);
  });

  it('NODE_ENV nedefinisan → false', () => {
    delete process.env.NODE_ENV;
    process.env.DEV_EXPOSE_TOKENS = '1';
    expect(devTokensExposed()).toBe(false);
  });
});
