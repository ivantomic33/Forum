import DOMPurify from 'dompurify';
import { useMemo } from 'react';

/**
 * Centralizovana HTML sanitizacija (DOMPurify).
 *
 * Koristi se za SAV HTML sadržaj koji nije napisan od strane samog koda,
 * pre svega za rich-text sadržaj iz Admin CMS-a (članci) i za bilo koji
 * eksterni/korisnički HTML koji se renderuje kroz dangerouslySetInnerHTML.
 *
 * Princip odbrane (defense in depth):
 *   1. Backend `xss` middleware — sanitizuje input pre čuvanja u bazu.
 *   2. DOMPurify ovde — poslednja linija odbrane pre renderovanja u DOM.
 *
 * Whitelist pristup: dozvoljavamo samo bezbedne formatare i SVE atribute
 * (npr. class, href, src, alt, target) brišemo skripte, event handlere
 * (onclick, onerror...), javascript: URI-jeve, <iframe>, <object>, <embed> itd.
 */

const ALLOWED_TAGS = [
  // Tekst i formatiranje
  'p', 'br', 'hr', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Liste
  'ul', 'ol', 'li',
  // Citati i blokovi
  'blockquote', 'pre', 'code',
  // Linkovi i slike
  'a', 'img',
  // Tabele
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const ALLOWED_ATTR = [
  // Opšti
  'class', 'title', 'alt', 'width', 'height',
  // Linkovi (target se dodaje programski ispod)
  'href',
  // Slike
  'src', 'srcset', 'loading', 'referrerpolicy',
  // Tabele
  'colspan', 'rowspan',
];

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Blokiraj sve URI šeme osim http(s), mailto i relativnih putanja
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    // Ukloni komentar čvorove (<!-- ... -->)
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

/**
 * Konfiguracija koja automatski dodaje target="_blank" i rel="noopener noreferrer"
 * na sve linkove — sprečava tab-nabbing napade.
 */
export function sanitizeHtmlSafeLinks(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    ADD_ATTR: ['target', 'rel'],
  });
}

/**
 * Hook za React komponente — memoizovana sanitizacija.
 * Koristiti kao: const clean = useSanitizedHtml(dirtyHtml);
 */
/**
 * Uklanja prazne pasuse koji su se pojavili između escape-ovanih blokova.
 * ("<p></p>" iz Markdown pripreme inače pravi dupli razmak u tekstu.)
 */
function compactEmptyParagraphs(html: string): string {
  return html.replace(/(<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)/gi, '');
}

/**
 * Hook za React komponente — memoizovana sanitizacija.
 * Prazni pasusi se sklanjaju pre renderovanja.
 */
export function useSanitizedHtml(dirty: string | null | undefined): string {
  return useMemo(() => compactEmptyParagraphs(sanitizeHtml(dirty ?? '')), [dirty]);
}

