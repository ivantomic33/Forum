/**
 * F-16 — RSS 2.0 FEED (`/rss.xml`)
 * --------------------------------
 * Pokriva: strukturu RSS 2.0 (channel + atom:link self), spajanje članaka i
 * aktivnih deal-ova sortirano opadajuće, CDATA opis, `<guid isPermaLink>`,
 * `pubDate` u RFC-822 formatu, cache zaglavlja i redirect aliasa `/feed`.
 * Testovi idu kroz `createApp()` (ista aplikacija kao produkcija, in-memory baza).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../index.js';
import { db } from '../lib/store.js';

process.env.JWT_SECRET ||= 'test-secret-for-rss-feed-tests-0123456789';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const app = createApp();
const AUTHOR = 'usr_rss_author';
const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: `art_rss_${Math.random().toString(36).slice(2)}`,
    slug: `rss-${Math.random().toString(36).slice(2)}`,
    title: 'Vest iz feeda',
    excerpt: 'Kratak opis vesti',
    content: '<p>Sadržaj</p>',
    coverImage: null,
    category: 'Vesti',
    tags: [],
    author: 'Redakcija',
    authorId: AUTHOR,
    status: 'published',
    isFeatured: false,
    views: 0,
    reactions: { like: 0, gg: 0, hype: 0, fire: 0, mind_blown: 0 },
    publishedAt: now(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  } as any;
}

function deal(overrides: Record<string, unknown> = {}) {
  const price = Number(overrides.price ?? 10);
  const originalPrice = Number(overrides.originalPrice ?? 20);
  return {
    id: `deal_rss_${Math.random().toString(36).slice(2)}`,
    authorId: AUTHOR,
    author: 'clan',
    gameId: null,
    gameSlug: null,
    gameTitle: 'Test Igra',
    gameCover: null,
    title: 'Popust na igru',
    url: 'https://store.steampowered.com/app/1/',
    proofUrl: null,
    price,
    originalPrice,
    discountPct: Math.round((1 - price / originalPrice) * 100),
    currency: 'EUR',
    store: 'Steam',
    platform: 'PC',
    description: null,
    expiresAt: null,
    status: 'active',
    isVerified: false,
    score: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  } as any;
}

beforeAll(async () => {
  if (!(await db.users.findById(AUTHOR))) {
    await db.users.create({
      id: AUTHOR,
      username: 'rss_author',
      email: 'rss@test.local',
      password: 'x',
      role: 'member',
      avatar: '',
      level: 1,
      xp: 0,
      xpNeeded: 100,
      karma: 0,
      badges: [],
      status: 'offline',
      isVerified: true,
      isBanned: false,
      connectedAccounts: {},
      createdAt: now(),
      lastSeenAt: now(),
    } as any);
  }
  await db.articles.create(article({ publishedAt: hoursAgo(1) }));
  await db.articles.create(article({ status: 'draft', publishedAt: hoursAgo(2) })); // ne sme u feed
  await db.deals.create(deal({ createdAt: hoursAgo(3), updatedAt: hoursAgo(3) }));
  await db.deals.create(deal({ status: 'expired', createdAt: hoursAgo(4), updatedAt: hoursAgo(4) })); // ne sme u feed
});

describe('F-16 — GET /rss.xml', () => {
  it('vraća validan RSS 2.0 XML sa channel meta podacima', async () => {
    const response = await request(app).get('/rss.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/rss+xml');
    expect(response.headers['cache-control']).toContain('max-age=1800');

    const xml = response.text;
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<title>NEXUS Gaming Portal</title>');
    expect(xml).toContain('<language>sr</language>');
    expect(xml).toContain('<lastBuildDate>');
    expect(xml).toMatch(/<atom:link href="[^"]+\/rss\.xml" rel="self" type="application\/rss\+xml" \/>/);
  });

  it('sadrži objavljeni članak i aktivni deal, a NE draft/istekle', async () => {
    const xml = (await request(app).get('/rss.xml')).text;
    expect(xml).toContain('Vest iz feeda');
    expect(xml).toContain('[DEAL] Test Igra');
    // draft članak i expired deal nemaju svoje stavke (samo 1 članak + 1 deal su dodati)
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    expect(itemCount).toBe(2);
  });

  it('stavke imaju guid isPermaLink, pubDate (RFC-822) i CDATA opis', async () => {
    const xml = (await request(app).get('/rss.xml')).text;
    expect(xml).toMatch(/<guid isPermaLink="true">/);
    // RFC-822: `Wed, 22 Oct 2026 17:00:00 GMT`
    expect(xml).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
    expect(xml).toContain('<description><![CDATA[');
    expect(xml).toContain('/article/');
    expect(xml).toContain('/deals/');
  });

  it('sortira stavke opadajuće po datumu (najnovije prve)', async () => {
    const xml = (await request(app).get('/rss.xml')).text;
    const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => new Date(m[1]).getTime());
    expect(dates.length).toBeGreaterThanOrEqual(2);
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });
});

describe('F-16 — aliasi', () => {
  it.each(['/feed', '/feed.xml', '/rss'])('%s redirectuje na /rss.xml', async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/rss.xml');
  });
});
