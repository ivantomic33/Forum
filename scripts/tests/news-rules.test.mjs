import { describe, expect, it } from 'vitest';
import { buildTags, classifyArticle, detectEvent } from '../news-rules.mjs';
import { buildBilingualBody, extractKeySentences, looksSerbian } from '../translate-news.mjs';
import { translateTitleFallback } from '../ai-translate.mjs';

/**
 * 2.13.5 — PRAVILA VESTI (bez mreže i bez baze)
 * ---------------------------------------------
 * Ovi testovi čuvaju ponašanje koje je otkriveno iteracijama na stvarnim
 * vestima (a ne teorijom): „NE“ nije studio, „DMZ“ je Call of Duty, poznata
 * igra pobeđuje platformu, itd.
 */

describe('kategorije', () => {
  const category = (title, extra = {}) =>
    classifyArticle({ title, excerpt: '', content: '', tags: [], ...extra });

  it('prepoznaje nove kategorije iz naslova', () => {
    expect(category('Glasajte za najstrašniju igru svih vremena')).toBe('Zabava');
    expect(category('Istraživači su možda otkrili nauku o zaljubljivanju')).toBe('Nauka');
    expect(category('NVIDIA objavila nove RTX grafičke karte')).toBe('Hardver');
  });

  it('poznata igra ide u „Igre“, ne u „Vesti“', () => {
    expect(category('Dark Messiah dobija rimejk')).toBe('Igre');
    expect(category('Final Fantasy 7 Ever Crisis dobija novi gejmplej')).toBe('Igre');
    expect(category('Ratchet and Clank Rift Apart stiže na PC')).toBe('Igre');
  });

  it('poznata igra pobeđuje platformu („Pokemon Unite na Switchu“ nije Konzole)', () => {
    expect(category('Pokemon Unite na Switchu se gasi')).toBe('Igre');
  });

  it('„NE“ u naslovu nije studio „NE!“ — ne postaje Industrija', () => {
    expect(category('Jednostavno ne možete pobeći – uprkos tome što ne možete igrati')).not.toBe('Industrija');
  });

  it('recenzija i vodič imaju prioritet nad žanrom', () => {
    expect(category('Recenzija: Elden Ring')).toBe('Recenzije');
    expect(category('Vodič za boss u Elden Ringu')).toBe('Vodiči');
  });
});

describe('grupa događaja', () => {
  it('prepoznaje igru i temu', () => {
    expect(detectEvent('Dark Messiah dobija rimejk')).toMatchObject({ id: 'dark-messiah' });
    expect(detectEvent('Call of Duty DMZ mod se vraća')).toMatchObject({ id: 'call-of-duty' });
    expect(detectEvent('Nintendo Direct zakazan za sutra')).toMatchObject({ id: 'nintendo' });
  });

  it('nepoznata tema nema grupu', () => {
    expect(detectEvent('Vreme je lepo danas')).toBeNull();
  });
});

describe('tagovi', () => {
  it('brend iz naslova je prvi tag, generički se prevode', () => {
    const tags = buildTags(['News', 'Games'], 'GTA 6 dobija novi trejler', 'Igre');
    // Brend sa brojem je tačniji od samog imena serijala („GTA 6“ ≠ „GTA“).
    expect(tags[0]).toBe('GTA 6');
    expect(tags).toContain('Vesti');
    expect(tags).not.toContain('News');
  });

  it('nema više od 5 tagova i nijedan preko 24 karaktera', () => {
    const tags = buildTags(['Action Adventure', 'Industry', 'Hardware'], 'Minecraft', 'Igre');
    expect(tags.length).toBeLessThanOrEqual(5);
    expect(tags.every((tag) => tag.length <= 24)).toBe(true);
  });
});

describe('jezik i prenos', () => {
  it('razlikuje srpski od engleskog, i tuđi brend ne vara', () => {
    expect(looksSerbian('Procurio datum izlaska Silent Hill Remakea')).toBe(true);
    expect(looksSerbian('The Wolf Among Us Remastered ne menja mnogo')).toBe(true);
    expect(looksSerbian('Street Fighter V temporarily delisted and online functions turned off')).toBe(false);
  });

  it('dvostruko telo stavlja sažetak gore i označen original ispod', () => {
    const html = buildBilingualBody({
      excerpt: 'Srpski sažetak vesti.',
      original: 'This is the English body of the article.',
      sourceName: 'Polygon',
      link: 'https://example.com/a',
    });
    expect(html).toContain('<strong>Srpski sažetak vesti.</strong>');
    expect(html).toContain('Original (Polygon, engleski)');
    expect(html).toContain('Pročitaj ceo tekst na Polygon');
  });

  it('ključne rečenice preferiraju one sa brojevima i novcem', () => {
    const sentences = extractKeySentences(
      'The studio said nothing new. Sales reached 200 million copies, according to the report. Players are happy with the update.',
    );
    expect(sentences[0]).toContain('200 million');
  });

  it('deterministički prevod naslova ostaje srpski i ima smisla', () => {
    const translated = translateTitleFallback('Xbox lays off 30 workers');
    expect(translated).toContain('otpušta');
    expect(translated).not.toContain('lays off');
  });
});
