import { describe, expect, it } from 'vitest';
import { levelFromXp, DAILY_XP_CAP } from '../lib/gamification.js';
import { levelProgress, levelRange, xpForLevel } from '../lib/store.js';
import { publicUser } from '../lib/userShape.js';

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

describe('levelRange / levelProgress', () => {
  it('nivo 1 počinje na 0, a završava na pragu nivoa 2', () => {
    const range = levelRange(1);
    expect(range.start).toBe(0);
    expect(range.end).toBe(xpForLevel(2));
    expect(range.size).toBe(xpForLevel(2));
  });

  it('progres meri XP unutar nivoa, a ne ukupan XP', () => {
    const { start, size } = levelRange(5);
    const progress = levelProgress(start + Math.floor(size / 2));
    expect(progress.level).toBe(5);
    expect(progress.into).toBe(Math.floor(size / 2));
    expect(progress.needed).toBe(size);
    expect(progress.ratio).toBeCloseTo(0.5, 2);
  });

  it('na samom pragu prelazi na sledeći nivo sa 0%', () => {
    const progress = levelProgress(xpForLevel(6));
    expect(progress.level).toBe(6);
    expect(progress.into).toBe(0);
    expect(progress.remaining).toBe(progress.needed);
  });

  it('clampuje negativan i preveliki XP', () => {
    expect(levelProgress(-50).level).toBe(1);
    expect(levelProgress(-50).into).toBe(0);
    const progress = levelProgress(xpForLevel(6) + 10_000_000);
    expect(progress.into).toBeLessThanOrEqual(progress.needed);
  });

  it('nivo iz izračunatog XP-a se poklapa sa levelFromXp', () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(levelProgress(xpForLevel(level)).level).toBe(level);
    }
  });
});

describe('publicUser — XP ugovor', () => {
  const base = {
    id: 'u1',
    username: 'tester',
    email: 't@example.com',
    avatar: '',
    bio: '',
    role: 'member' as const,
    // Namerno NETAČNE keš kolone — profil mora da izvede nivo iz XP-a.
    level: 1,
    xp: xpForLevel(3) + 10,
    xpNeeded: 0,
    karma: 0,
    badges: [],
    connectedAccounts: {},
    isVerified: false,
    isBanned: false,
    status: 'offline' as const,
    createdAt: new Date(0).toISOString(),
  };

  it('izvodi nivo, prag i napredak iz XP-a', () => {
    const user = publicUser(base as never);
    expect(user.level).toBe(3);
    expect(user.xpNeeded).toBe(xpForLevel(4));
    expect(user.xpIntoLevel).toBe(10);
    expect(user.xpForNext).toBe(xpForLevel(4) - xpForLevel(3));
    expect(user.xpRemaining).toBe(user.xpForNext - user.xpIntoLevel);
    expect(user.levelProgress).toBeGreaterThanOrEqual(0);
    expect(user.levelProgress).toBeLessThanOrEqual(100);
  });
});

describe('DAILY_XP_CAP', () => {
  it('je pozitivan dnevni budžet', () => {
    expect(DAILY_XP_CAP).toBeGreaterThan(0);
  });
});
