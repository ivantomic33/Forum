import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../lib/store.js';
import { foldSrpski, sanitizeTsQuery, searchAll, stemSrpski, suggestFor } from '../lib/search.js';

/**
 * 2.6.2 — LEKSIKALNI SLOJ (normalizacija + koren + sugestija)
 * ----------------------------------------------------------
/**
 * 2.6.2 — LEKSIKALNI SLOJ (normalizacija + koren + sugestija)
 * ----------------------------------------------------------
 * JS i SQL (`fold_srpski`/`stem_srpski` u `server/schema-ALL.sql`, sekcija 2.6.2)
 * MORAJU davati iste lekseme, inače `tsquery` ne pogađa GIN indeks. Ovi
 * testovi zaključavaju ugovor na JS strani; mapa u SQL-u je ista.
 */
describe('foldSrpski — dijakritika, ćirilica, interpunkcija', () => {
  it('č/ć/š/ž/đ padaju na ASCII', () => {
    expect(foldSrpski('članci')).toBe('clanci');
    expect(foldSrpski('ČLANCI')).toBe('clanci');
    expect(foldSrpski('Šuma')).toBe('suma');
    expect(foldSrpski('Život')).toBe('zivot');
    expect(foldSrpski('Đorđe')).toBe('djordje');
    expect(foldSrpski('ćao')).toBe('cao');
  });

  it('ćirilica se transliterira u latinicu', () => {
    expect(foldSrpski('игра')).toBe('igra');
    expect(foldSrpski('ЉУБАВ')).toBe('ljubav');
    expect(foldSrpski('Њива')).toBe('njiva');
    expect(foldSrpski('Џем')).toBe('dzem');
    // Ćirilična i latinična reč daju ISTU normalizaciju.
    expect(foldSrpski('игра')).toBe(foldSrpski('igra'));
  });

  it('interpunkcija je granica reči, razmaci se sažimaju', () => {
    expect(foldSrpski('  Hogwarts: Legacy!  ')).toBe('hogwarts legacy');
    expect(foldSrpski('gde-je-popust?')).toBe('gde je popust');
    expect(foldSrpski('')).toBe('');
  });
});

describe('stemSrpski — padeži dele koren', () => {
  it('„igrama“ → koren „igr“; prekratke reči se ne seku', () => {
    expect(stemSrpski('igrama')).toBe('igr');
    // Kratke reči (< 5 znakova) ostaju cele — sečenje bi dalo besmislen koren („sa“).
    expect(stemSrpski('igra')).toBe('igra');
    expect(stemSrpski('sata')).toBe('sata');
  });

  it('„popust / popusta / popustima“ → isti koren', () => {
    // „popustima“ (9) → „ima“ ostavlja 6 ≥ 3 → „popust“.
    expect(stemSrpski('popust')).toBe('popust');
    expect(stemSrpski('popusta')).toBe('popust');
    expect(stemSrpski('popustima')).toBe('popust');
  });

  it('kratke reči se ne seku („sata“ nije „sa“)', () => {
    expect(stemSrpski('sata')).toBe('sata');
    expect(stemSrpski('tem')).toBe('tem');
  });

  it('ne vraća koren kraći od 3 znaka', () => {
    // Svaki oblik koji se sekne ostavlja bar 3 znaka.
    expect(stemSrpski('igrama').length).toBeGreaterThanOrEqual(3);
    expect(stemSrpski('kola')).toBe('kola');
  });
});

describe('sanitizeTsQuery — bez operatora iz korisničkog unosa', () => {
  it('uklanja & | ! ( ) : * i navodnike', () => {
    expect(sanitizeTsQuery('igre & "legacy" | !(dlc):*')).toBe('igre legacy dlc');
  });

  it('svodi na normalizovane reči, bez tokena kraćih od 2 znaka', () => {
    expect(sanitizeTsQuery('Šuma a Đorđe')).toBe('suma djordje');
  });
});

describe('suggestFor — „da li ste mislili“ (fallback bez RPC-a)', () => {
  const SUFFIX2 = Date.now().toString(36);
  let authorId = '';

  beforeAll(async () => {
    const now = new Date().toISOString();
    const author = await db.users.create({
      id: `usr_suggest_${SUFFIX2}`,
      username: `suggest_${SUFFIX2}`,
      email: `suggest_${SUFFIX2}@example.com`,
      password: 'x',
      avatar: '',
      role: 'member',
      level: 1,
      xp: 0,
      xpNeeded: 100,
      karma: 0,
      badges: [],
      connectedAccounts: {},
      isVerified: true,
      isBanned: false,
      status: 'offline',
      createdAt: now,
      lastSeenAt: now,
    });
    authorId = author.id;

    await db.articles.create({
      id: `art_suggest_${SUFFIX2}`,
      slug: `wiedzmin-${SUFFIX2}`,
      title: `Wiedźmin 3 — recenzija ${SUFFIX2}`,
      excerpt: 'RPG',
      content: '<p>Geralt</p>',
      coverImage: '',
      authorId,
      author: author.username,
      category: 'recenzije',
      tags: [],
      status: 'published',
      isFeatured: false,
      views: 0,
      reactions: {},
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('za prazan rezultat predlaže reč iz naslova', async () => {
    // Upit sa greškom u kucanju ne postoji u sadržaju, pa `hits` prazan.
    const result = await searchAll({ q: 'wiedzmn', type: 'articles' });
    expect(result.hits).toHaveLength(0);
    expect(result.suggestion).toBeTruthy();
    expect(result.suggestion!.startsWith('wiedz')).toBe(true);
  });

  it('kada ima pogodaka, sugestija se ne računa', async () => {
    const result = await searchAll({ q: 'wiedźmin', type: 'articles' });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.suggestion).toBeNull();
  });

  it('prekratak upit nikad nema sugestiju (300 znakova se ne pretražuje)', async () => {
    expect(await suggestFor('ab')).toBeNull();
  });
});
