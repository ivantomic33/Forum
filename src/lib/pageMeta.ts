import { useEffect } from 'react';

/**
 * F-19 — SEO meta po ruti za SPA bez SSR-a.
 *
 * `index.html` ima jedan (podrazumevani) naslov i description; ovaj hook ih
 * menja po ruti i upravlja canonical/Open Graph/Twitter/JSON-LD tagovima.
 *
 * Ovo NIJE zamena za prerender/SSR: crawler koji ne izvršava JS vidi samo
 * statički sadržaj iz `index.html` + `sitemap.xml`. Za indeksaciju članaka i
 * tema potreban je prerender (npr. `vite-plugin-prerender` ili React Router SSR);
 * hook priprema podatke koje taj prerender može da koristi.
 */

const SITE_NAME = 'NEXUS Gaming Portal';
const DEFAULT_DESCRIPTION =
  'NEXUS — gejming portal, magazin i interaktivni forum sa reputacijom, karmom i gejmifikovanim profilima.';

export interface PageMetaOptions {
  title: string;
  description?: string;
  /** Relativna putanja (`/article/slug`). Bazni URL dolazi iz `VITE_PUBLIC_URL`. */
  path?: string;
  type?: 'website' | 'article';
  image?: string;
  publishedTime?: string;
  modifiedTime?: string;
  /** JSON-LD (NewsArticle / DiscussionForumPosting / WebSite). */
  jsonLd?: Record<string, unknown>;
  noIndex?: boolean;
}

const publicBase = () =>
  (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ||
  (typeof window !== 'undefined' ? window.location.origin : '');

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function setLink(rel: string, href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

export function usePageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  type = 'website',
  image,
  publishedTime,
  modifiedTime,
  jsonLd,
  noIndex,
}: PageMetaOptions) {
  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
    const url = `${publicBase()}${path ?? ''}`;
    const absoluteImage = image ? (image.startsWith('http') ? image : `${publicBase()}${image}`) : undefined;

    document.title = fullTitle;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow');
    setLink('canonical', url || publicBase());

    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:url', url);
    if (absoluteImage) setMeta('property', 'og:image', absoluteImage);
    if (type === 'article' && publishedTime) setMeta('property', 'article:published_time', publishedTime);
    if (type === 'article' && modifiedTime) setMeta('property', 'article:modified_time', modifiedTime);

    setMeta('name', 'twitter:card', absoluteImage ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', description);
    if (absoluteImage) setMeta('name', 'twitter:image', absoluteImage);

    const scriptId = 'route-json-ld';
    document.getElementById(scriptId)?.remove();
    if (jsonLd) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [title, description, path, type, image, publishedTime, modifiedTime, noIndex, JSON.stringify(jsonLd)]);
}

/** JSON-LD za vest (`NewsArticle`). */
export function newsArticleJsonLd(input: {
  headline: string;
  description: string;
  url: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
  author?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    image: input.image ? [input.image] : undefined,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: { '@type': 'Person', name: input.author ?? SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME },
  };
}

/** JSON-LD za forum temu (`DiscussionForumPosting`). */
export function discussionJsonLd(input: {
  headline: string;
  text: string;
  url: string;
  datePublished?: string;
  author?: string;
  comments?: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: input.headline,
    text: input.text.slice(0, 500),
    url: input.url,
    datePublished: input.datePublished,
    author: { '@type': 'Person', name: input.author ?? 'NEXUS član' },
    interactionStatistic: input.comments
      ? {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: input.comments,
      }
      : undefined,
  };
}
