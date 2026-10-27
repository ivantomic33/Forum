import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

/**
 * StoryCard — tri oblika iste vesti:
 *
 *  - `hero`    — 16:9 slika preko celog pojasa (`hero-band`), tekst na donjem
 *                 sloju: eyebrow (kategorija), H1 max 2 reda, jedan primarni
 *                 CTA „Pročitaj“; visina ≤ 70vh na desktopu;
 *  - `card`    — horizontalna: slika levo ~40%, tekst desno (pojas „Top priče“);
 *  - `compact` — mali red sa sličicom (sidebar / „Najčitanije“).
 *
 * Jedna komponenta = jedan hover jezik (slika 1.02–1.04, naslov u primary-fg).
 */
export type StoryCardVariant = 'hero' | 'card' | 'compact';

export interface StoryCardProps {
  to: string;
  title: string;
  image?: string | null;
  imageAlt?: string;
  /** Eyebrow / kategorija („Vesti“, „Hardver“…). */
  eyebrow?: string;
  excerpt?: string;
  meta?: ReactNode;
  /** Akcije preko slike (bookmark) — moraju biti `relative z-10` iznad overlay-a. */
  overlay?: ReactNode;
  variant?: StoryCardVariant;
  className?: string;
  /** Tek za `hero`: nivo naslova (default `h1`). */
  headingLevel?: 'h1' | 'h2';
}

/** Naslov prestaje da bude link kada je ceo card link — nema ugnježdenih `<a>`. */
const HeadingTag = ({ level, className, children }: { level: 'h1' | 'h2' | 'h3'; className: string; children: ReactNode }) => {
  if (level === 'h1') return <h1 className={className}>{children}</h1>;
  if (level === 'h2') return <h2 className={className}>{children}</h2>;
  return <h3 className={className}>{children}</h3>;
};

/**
 * Boja eyebrow-a prati ZONU kategorije (Neon Editorial):
 *   PC/Hardver → cyan, Popusti/Ponude → amber, konzole → rose,
 *   zajednica/recenzije → emerald, opšte vesti → violet (fallback).
 * Vraća CSS vrednost tokena, pa komponenta ostaje bez hardkodovane boje.
 */
export function storyEyebrowAccent(category?: string | null): string {
  const value = (category ?? '').toLowerCase();
  if (/hardver|hardware|^pc\b|pc gaming/.test(value)) return 'var(--color-secondary)';
  if (/popust|deal|ponud|akcij/.test(value)) return 'var(--color-deal)';
  if (/playstation|xbox|nintendo|konzol/.test(value)) return 'var(--color-tertiary)';
  if (/zajednic|community|forum|recenz|review/.test(value)) return 'var(--color-community)';
  return 'var(--color-primary-fg)';
}

export function StoryCard({
  to,
  title,
  image,
  imageAlt,
  eyebrow,
  excerpt,
  meta,
  overlay,
  variant = 'card',
  className,
  headingLevel = 'h1',
}: StoryCardProps) {
  if (variant === 'hero') {
    return (
      <section className={cn('hero-band', className)} aria-labelledby="featured-title">
        <div className="hero-band-media" aria-hidden="true">
          {image ? <img src={image} alt="" width={1600} height={900} /> : null}
        </div>
        {overlay && <div className="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-8">{overlay}</div>}
        <div className="hero-band-inner">
          <div className="hero-band-content">
            {/* Eyebrow + naslov dele JEDAN link. Meta/Cta su IZVAN njega jer
                sadrže svoj link („Pročitaj“) — ugnježdeni <a> je nevažeći HTML
                i React ga je prikazivao kao razbijenu karticu. */}
            <Link to={to} className="flex flex-col gap-3 no-underline">
              {eyebrow && (
                <span
                  className="eyebrow story-eyebrow"
                  style={{ ['--story-accent' as string]: storyEyebrowAccent(eyebrow) }}
                >
                  {eyebrow}
                </span>
              )}
              <HeadingTag level={headingLevel} className="hero-band-title">
                {title}
              </HeadingTag>
            </Link>
            {excerpt && <p className="hero-band-excerpt">{excerpt}</p>}
            {meta && <div className="hero-band-meta">{meta}</div>}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'compact') {
    return (
      <Link to={to} className={cn('story-compact', className)}>
        <div className="story-compact-media" aria-hidden="true">
          {image ? <img src={image} alt="" loading="lazy" width={160} height={120} /> : <div className="h-full w-full" />}
        </div>
        <div className="min-w-0">
          {eyebrow && (
            <span
              className="story-eyebrow block text-micro"
              style={{ ['--story-accent' as string]: storyEyebrowAccent(eyebrow) }}
            >
              {eyebrow}
            </span>
          )}
          <span className="story-compact-title">{title}</span>
          {meta}
        </div>
      </Link>
    );
  }

  return (
    <Link to={to} className={cn('story-card-row', className)}>
      <div className="story-card-media" aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" width={400} height={300} /> : <div className="h-full w-full" />}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-1.5 py-1">
        {eyebrow && (
          <span
            className="story-eyebrow text-micro"
            style={{ ['--story-accent' as string]: storyEyebrowAccent(eyebrow) }}
          >
            {eyebrow}
          </span>
        )}
        <span className="story-card-title line-clamp-3">{title}</span>
        {meta}
      </div>
    </Link>
  );
}
