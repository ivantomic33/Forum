import xss from 'xss';

/**
 * SANITIZACIJA
 * -------------
 * Dve funkcije, namerno razdvojene:
 *
 *  - `sanitizeRichText` — za HTML sadržaj (članci, forumi). Dozvoljava TipTap
 *    izlaz: p, br, strong, em, u, s, a, ul, ol, li, code, pre, blockquote,
 *    naslove, `img` (samo https URL-ovi) i `span` bez atributa.
 *  - `sanitizeText` — za kratka plain-text polja (naslovi, tagovi, imena).
 *    Escapeuje HTML entitete da `<` nikad ne stigne do baze kao tag, i NEMA
 *    dvostruko escapovanje (`&lt;` ostaje `&lt;`).
 */

/** Dozvoljavamo samo http(s) linkove — blokira javascript:, data: i sl. */
const isHttpUrl = (value: string): boolean => /^https?:\/\/[^\s'"<>]+$/i.test(value.trim());
const isHttpsUrl = (value: string): boolean => /^https:\/\/[^\s'"<>]+$/i.test(value.trim());

const whiteList: Record<string, string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  del: [],
  a: ['href', 'title'],
  ul: [],
  ol: [],
  li: [],
  code: ['class'],
  pre: ['class'],
  blockquote: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  img: ['src', 'alt', 'title', 'width', 'height'],
  span: [],
};

/** Sanitizacija HTML sadržaja (članci, teme, odgovori). */
export const sanitizeRichText = (input: unknown): string => {
  const value = String(input ?? '');
  if (!value) return '';

  return xss(value, {
    whiteList,
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed'],
    onTagAttr: (tag, name, value) => {
      if (name === 'href' || name === 'src') {
        const url = value.trim();
        const allowed = tag === 'img' ? isHttpsUrl(url) : isHttpUrl(url);
        if (!allowed) return '';
        if (tag === 'a' && name === 'href') {
          return `href="${value}" rel="noopener noreferrer" target="_blank"`;
        }
      }
      return undefined;
    },
  });
};

/**
 * Plain-text sanitizacija za kratka polja (naslovi, tagovi, imena).
 *
 * **Ne escapuje se pri upisu u bazu** — React već escapuje tekst pri prikazu,
 * pa bi `&lt;` u bazi izašlo kao dvostruki `&lt;` na ekranu (#16).
 * Umesto toga se uklanjaju kontrolni karakteri i sve što liči na markup.
 */
export const sanitizeText = (input: unknown): string =>
  String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '') // skini tagove: <script>, <img ...>
    .replace(/[<>]/g, '')
    .trim();

/** Escapovanje za prikaz u ne-React kontekstu (mejl, HTML string). */
export const escapeForHtml = (input: string): string =>
  input
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Legacy alias — istorijski se koristio za HTML sadržaj. */
export const sanitizeInput = sanitizeRichText;

export const sanitizeObject = <T extends Record<string, any>>(obj: T): T => {
  const sanitized = { ...obj };
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeRichText(sanitized[key]) as any;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key]);
    }
  }

  return sanitized;
};
