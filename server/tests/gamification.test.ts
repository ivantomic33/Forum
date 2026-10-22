import { describe, expect, it } from 'vitest';
import { levelFromXp, DAILY_XP_CAP } from '../lib/gamification.js';
import { xpForLevel } from '../lib/store.js';

describe('xpForLevel', () => {
  it('raste sa nivoom', () => {
    expect(xpForLevel(2)).toBeGreaterThan(xpForLevel(1));
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(5));
  });
});

describe('levelFromXp', () => {
  it('nivo 1 za 0 XP-a', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('ne prelazi nivo dok XP nije dovoljan', () => {
    // xpForLevel(level) = prag za ulazak u taj nivo
    const needed = xpForLevel(2);
    expect(levelFromXp(needed - 1)).toBe(1);
    expect(levelFromXp(needed)).toBe(2);
  });

  it('monotono raste', () => {
    let previous = 0;
    for (let xp = 0; xp <= 20_000; xp += 500) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('DAILY_XP_CAP', () => {
  it('je pozitivan dnevni budžet', () => {
    expect(DAILY_XP_CAP).toBeGreaterThan(0);
  });
});
