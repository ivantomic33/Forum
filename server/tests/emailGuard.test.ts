import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendEmail, sendNotificationEmail, sendVerificationEmail, sendPasswordResetEmail } from '../lib/email.js';

/**
 * POSLEDNJA BARIJERA: `sendEmail` šalje SAMO verifikaciju adrese i reset lozinke.
 *
 * Bilo koji drugi mejl (notifikacija, newsletter, digest, alert…) se odbija pre
 * provajdera, pa čak i ako neki poziv slučajno ostane u kodu — korisnik ne dobija
 * mejl. Test presreće Resend/Brevo pozive, pa se vidi i KOJI bi mejl otišao.
 */
describe('email — samo verifikacija i reset lozinke', () => {
  const original = { RESEND_API_KEY: process.env.RESEND_API_KEY, BREVO_API_KEY: process.env.BREVO_API_KEY };
  let sent: Array<{ to: string; subject: string }> = [];
  let restoreFetch: (() => void) | null = null;

  beforeEach(() => {
    sent = [];
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.BREVO_API_KEY;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.resend.com') || url.includes('api.brevo.com')) {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    for (const key of ['RESEND_API_KEY', 'BREVO_API_KEY'] as const) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('generički mejl notifikacije (bedž) se ne šalje', async () => {
    const ok = await sendNotificationEmail('user@example.com', {
      title: 'Nova značka: Veteran 🏅',
      message: 'Administracija ti je dodelila značku.',
      path: '/profile?tab=badges',
    });
    expect(ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('mejl bez eksplicitne vrste se odbija', async () => {
    const ok = await sendEmail({ to: 'user@example.com', subject: 'Bilo šta', html: '<p>x</p>' });
    expect(ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('verifikacija i reset lozinke PROLAZE', async () => {
    expect(await sendVerificationEmail('user@example.com', 'User', 'tok-1')).toBe(true);
    expect(await sendPasswordResetEmail('user@example.com', 'User', 'tok-2')).toBe(true);
    // Resend prima `to` kao listu.
    expect(sent.map((mail) => (mail.to as unknown as string[])[0])).toEqual(['user@example.com', 'user@example.com']);
    expect(sent[0].subject).toContain('Potvrdite');
    expect(sent[1].subject).toContain('reset lozinke');
  });
});
