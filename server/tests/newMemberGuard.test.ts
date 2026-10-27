import { beforeEach, describe, expect, it } from 'vitest';
import { flagForReview, isNewMember, NEW_MEMBER_POSTS, suspiciousSignals } from '../lib/newMemberGuard.js';
import { db } from '../lib/store.js';

/**
 * 6.x — ANTI-SPAM ZA NOVE ČLANOVE.
 *
 * Pravilo: sumnjiva objava se NE blokira — samo uđe u moderacioni red
 * (`reports`, `pending`). Testovi pokrivaju heuristiku i deduplikaciju prijave.
 */

process.env.JWT_SECRET ||= 'test-secret-for-new-member-guard';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

describe('suspiciousSignals', () => {
  it('čist, normalan prvi post nema signala', () => {
    expect(suspiciousSignals({ content: '<p>Koju grafičku do 300 evra preporučujete za 1440p?</p>' })).toEqual([]);
  });

  it('dva ili više linka = sumnja', () => {
    const signals = suspiciousSignals({
      content: '<p>Pogledajte https://a.example.com i https://b.example.com za najbolje cene</p>',
    });
    expect(signals.some((item) => item.includes('linka'))).toBe(true);
  });

  it('kratka poruka sa linkom = sumnja', () => {
    expect(suspiciousSignals({ content: 'kupi https://spam.example.com' }).length).toBeGreaterThan(0);
  });

  it('većina teksta velikim slovima = sumnja', () => {
    expect(
      suspiciousSignals({ content: 'NOVA PONUDA ZA SVE IGRE DANAS SAMO OVDE ODMAH KLIKNI I UZMI' }).length,
    ).toBeGreaterThan(0);
  });

  it('ista poruka kao prethodna = sumnja', () => {
    const body = '<p>Ovo je ista poruka koja je već poslata ranije pre pet minuta</p>';
    expect(suspiciousSignals({ content: body, recentContents: [body] }).length).toBeGreaterThan(0);
  });
});

describe.skipIf(db.kind !== 'memory')('flagForReview', () => {
  const AUTHOR = 'spam_member';
  const TARGET = 'thr_spam_1';

  beforeEach(() => {
    // Svaki test dobija svež cilj da deduplikacija ne bi uticala na drugi.
  });

  it('sumnjiva objava ulazi u red za pregled sa razlogom', async () => {
    const created = await flagForReview({
      authorId: AUTHOR,
      targetType: 'thread',
      targetId: TARGET,
      signals: ['2 linka u objavi'],
    });
    expect(created).toBe(true);

    const reports = await db.reports.findByReporter(AUTHOR, 'thread', TARGET);
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe('pending');
    expect(reports[0].reason).toContain('[auto]');
    expect(reports[0].reason).toContain('2 linka');
  });

  it('ne pravi drugu prijavu za isti sadržaj (idempotentno)', async () => {
    const again = await flagForReview({
      authorId: AUTHOR,
      targetType: 'thread',
      targetId: TARGET,
      signals: ['2 linka u objavi'],
    });
    expect(again).toBe(false);
    expect(await db.reports.findByReporter(AUTHOR, 'thread', TARGET)).toHaveLength(1);
  });

  it('bez signala se ništa ne prijavljuje', async () => {
    expect(await flagForReview({ authorId: AUTHOR, targetType: 'reply', targetId: 'rep_x', signals: [] })).toBe(false);
  });

  it('znamenka limita je 5 objava', () => {
    expect(NEW_MEMBER_POSTS).toBe(5);
  });
});

describe.skipIf(db.kind !== 'memory')('isNewMember', () => {
  it('novi nalog bez objava se smatra novim', async () => {
    expect(await isNewMember('brand_new_user', 'brand_new_user')).toBe(true);
  });
});
