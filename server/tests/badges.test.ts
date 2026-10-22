import { describe, expect, it } from 'vitest';
import { evaluateBadges, levelFromXp } from '../lib/gamification.js';
import { xpForLevel } from '../lib/store.js';

describe('evaluateBadges', () => {
  it('dodeljuje first_post samo na stvarnu objavu', () => {
    expect(evaluateBadges({ badges: [] }, { reason: 'thread', xp: 20, karma: 0 })).toContain('first_post');
    expect(evaluateBadges({ badges: [] }, { reason: 'account_connected', xp: 25, karma: 0 })).not.toContain('first_post');
  });

  it('ne dodeljuje isti bedž dvaput', () => {
    const result = evaluateBadges({ badges: ['first_post'] }, { reason: 'thread', xp: 100, karma: 0 });
    expect(result).not.toContain('first_post');
  });

  it('dodeljuje contributor na 10 tema', () => {
    const result = evaluateBadges({ badges: [] }, { reason: 'thread', threadCount: 10, xp: 200, karma: 0 });
    expect(result).toContain('contributor');
  });

  it('dodeljuje influencer na 4 povezana naloga', () => {
    const result = evaluateBadges({ badges: [] }, { reason: 'account_connected', connectedCount: 4, xp: 100, karma: 0 });
    expect(result).toContain('influencer');
  });

  it('veteran ide na 5.000 XP (isto kao SQL opis), ne na 30 dana', () => {
    expect(evaluateBadges({ badges: [] }, { reason: 'thread', xp: 4999, karma: 0 })).not.toContain('veteran');
    expect(evaluateBadges({ badges: [] }, { reason: 'thread', xp: 5000, karma: 0 })).toContain('veteran');
  });

  it('founder i legend se ne dodeljuju automatski', () => {
    const result = evaluateBadges(
      { badges: [] },
      { reason: 'thread', xp: 100_000, karma: 100_000, threadCount: 500, replyCount: 500, connectedCount: 6 },
    );
    expect(result).not.toContain('founder');
    expect(result).not.toContain('legend');
  });
});

describe('nivo i XP — konzistentnost', () => {
  it('levelFromXp je inverz praga xpForLevel', () => {
    for (let level = 1; level <= 12; level += 1) {
      const threshold = xpForLevel(level);
      expect(levelFromXp(threshold)).toBe(level);
      expect(levelFromXp(threshold - 1)).toBe(Math.max(1, level - 1));
    }
  });
});
