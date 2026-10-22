import { describe, expect, it } from 'vitest';
import { captureError, errorTrackingEnabled, flushErrorTracking, initErrorTracking } from '../lib/sentry.js';

/**
 * SENTRY (2.4.4 → povezan u 2.6.2)
 * --------------------------------
 * Modul ne sme da obori server kada DSN nije postavljen: `initErrorTracking`
 * je no-op, `captureError` ide samo u Pino log, `flush` se vraća odmah.
 * Sa DSN-om i `NODE_ENV=test` SDK se inicijalizuje ali je `enabled: false`,
 * pa testovi nikad ne šalju događaje u pravi Sentry projekat.
 */
describe('sentry — inertan bez DSN-a', () => {
  const savedDsn = process.env.SENTRY_DSN;

  it('bez DSN-a ništa se ne inicijalizuje i nijedan poziv ne baca', async () => {
    delete process.env.SENTRY_DSN;
    expect(() => initErrorTracking()).not.toThrow();
    expect(errorTrackingEnabled()).toBe(false);
    expect(() => captureError(new Error('boom'), { requestId: 'req_1' })).not.toThrow();
    await expect(flushErrorTracking(50)).resolves.toBeUndefined();
    process.env.SENTRY_DSN = savedDsn;
  });

  it('captureError prima i ne-Error vrednosti (odbijen promise kao string)', () => {
    expect(() => captureError('string greška')).not.toThrow();
    expect(() => captureError(undefined)).not.toThrow();
  });
});
