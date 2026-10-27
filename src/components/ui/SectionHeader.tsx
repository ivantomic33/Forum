import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from './cn';

/**
 * SectionHeader — eyebrow + H2 + opcioni „Vidi sve“ link.
 *
 * Jedan izvor za zaglavlja sekcija (početna, popusti, forum): eyebrow je
 * UPPERCASE violet 11 px, H2 je 28 px Inter Tight 700, link je miran dok se ne
 * pređe mišem. Bez okvira i bez senke — razdvajanje radi tipografija.
 */
export interface SectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  /** Naslov sekcije je `h2` po defaultu; hero unutar sekcije može da traži `h1`. */
  as?: 'h1' | 'h2';
  id?: string;
  /** Link „Vidi sve“ (interna ruta). */
  moreHref?: string;
  moreLabel?: string;
  /** Dodatni sadržaj desno (tabs, broj rezultata…). */
  action?: ReactNode;
  /**
   * Boja zone sekcije (Neon Editorial): color token kao CSS vrednost, npr.
   * `'var(--color-community)'`. Crta 3px vertikalni rail uz naslov i boji
   * eyebrow. Bez vrednosti → eyebrow ostaje violet (default).
   */
  accent?: string;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  as: Heading = 'h2',
  id,
  moreHref,
  moreLabel = 'Vidi sve',
  action,
  accent,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('section-head', className)} style={accent ? { ['--section-accent' as string]: accent } : undefined}>
      <div className="section-head-main">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <Heading id={id} className={Heading === 'h1' ? 'text-hero' : 'section-title'}>
          {title}
        </Heading>
      </div>
      {(moreHref || action) && (
        <div className="flex items-center gap-2">
          {action}
          {moreHref && (
            <Link to={moreHref} className="section-link">
              {moreLabel}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
