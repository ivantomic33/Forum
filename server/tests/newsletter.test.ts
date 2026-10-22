import { describe, expect, it } from 'vitest';
import { parseSegment, sanitizeSubject, subscriberSegment } from '../lib/newsletter.js';
import { newsletterCampaignSchema, newsletterResendSchema } from '../lib/schemas.js';

/**
 * NEWSLETTER (2.6.2) — segmenti i kampanja
 * ----------------------------------------
 * `subscriberSegment` je jedini izvor istine „ko je u kom segmentu“:
 * odjavljeni su UVEK `unsubscribed`, čak i ako `is_active` ostane `true`
 * (stariji zapisi pre nego što je odjava upisivala `unsubscribed_at`).
 */

describe('newsletter segmenti', () => {
  it('odjavljeni imaju prednost nad isActive', () => {
    expect(subscriberSegment({ isActive: true, unsubscribedAt: '2026-10-01T00:00:00Z' })).toBe('unsubscribed');
    expect(subscriberSegment({ isActive: true })).toBe('active');
    expect(subscriberSegment({ isActive: false })).toBe('pending');
    expect(subscriberSegment({ isActive: false, unsubscribedAt: null })).toBe('pending');
  });

  it('nepoznat segment pada na `active` (nikad „svi“ slučajno)', () => {
    expect(parseSegment(undefined)).toBe('active');
    expect(parseSegment('evil')).toBe('active');
    expect(parseSegment('pending')).toBe('pending');
    expect(parseSegment('all')).toBe('all');
  });

  it('subject se čisti od preloma reda (header injection)', () => {
    expect(sanitizeSubject('Naslov\r\nBcc: napadac@example.com')).toBe('Naslov Bcc: napadac@example.com');
    expect(sanitizeSubject('  Nedeljni pregled  ')).toBe('Nedeljni pregled');
  });

  it('šema kampanje prihvata test mejl i odbija neispravan segment', () => {
    const ok = newsletterCampaignSchema.safeParse({
      subject: 'Novi popusti',
      content: '<p>Ove nedelje…</p>',
      segment: 'active',
      testEmail: 'admin@nexus.rs',
    });
    expect(ok.success).toBe(true);

    const bad = newsletterCampaignSchema.safeParse({ subject: 'Novi', content: 'kratko', segment: 'random' });
    expect(bad.success).toBe(false);
  });

  it('resend zahteva ispravnu email adresu', () => {
    expect(newsletterResendSchema.safeParse({ email: 'nije-mejl' }).success).toBe(false);
    expect(newsletterResendSchema.safeParse({ email: 'test@example.com' }).success).toBe(true);
  });
});
