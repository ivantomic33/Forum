import { parseMediaUrl, type ParsedMedia } from './mediaEmbeds';

/**
 * EMBEDIFY — standalone URL u zasebnom pasusu -> MediaEmbed (F-7)
 * ---------------------------------------------------------------
 * Ulaz: DOMPurify-sanitizovan HTML. Svaki `<p>` koji sadrži SAMO jedan link
 * (standalone URL na svom redu) zamenjujemo MediaEmbed komponentom.
 * Linkovi unutar pasusa sa drugim tekstom ostaju obični `<a>` — tok čitanja
 * se ne lomi.
 *
 * Bezbednost: embed se umeće POSLE sanitizacije, programski, iz whitelist
 * parsera — korisnički `<iframe>`/`<script>` i dalje ne mogu da prođu
 * (sanitize.ts ih stripuje, DOMPurify ih briše).
 */

export type Segment = { type: 'html'; html: string } | { type: 'embed'; media: ParsedMedia };

/** Pasus koji sadrži isključivo jedan <a> link (opciono trailing tačka/razmak). */
const STANDALONE_P = /^<p>\s*<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*[^<]*\s*<\/a>\s*\.?\s*<\/p>$/i;
/** Cap: max embed-ova po sadržaju (DoS/performanse — tema sa 50 videa ne sme da ubi stranicu). */
const MAX_EMBEDS = 10;

export function embedifyHtml(html: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let embedCount = 0;
  const regex = /<p>[\s\S]*?<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null && embedCount < MAX_EMBEDS) {
    const para = match[0];
    const hrefMatch = para.match(STANDALONE_P);
    if (!hrefMatch) continue;
    const media = parseMediaUrl(hrefMatch[1]);
    if (!media) continue;

    if (match.index > lastIndex) {
      segments.push({ type: 'html', html: html.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'embed', media });
    embedCount++;
    lastIndex = match.index + para.length;
  }
  if (lastIndex < html.length) segments.push({ type: 'html', html: html.slice(lastIndex) });
  return segments.length ? segments : [{ type: 'html', html }];
}

export function hasEmbeds(segments: Segment[]): boolean {
  return segments.some((segment) => segment.type === 'embed');
}
