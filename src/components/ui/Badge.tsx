import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral' | 'featured';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Prikazuje tačkicu u boji tona. */
  dot?: boolean;
  className?: string;
  title?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  primary: 'ui-badge-primary',
  secondary: 'ui-badge-secondary',
  success: 'ui-badge-success',
  warning: 'ui-badge-warning',
  error: 'ui-badge-error',
  neutral: 'ui-badge-neutral',
  featured: 'ui-badge-featured',
};

const DOT_CLASS: Record<BadgeTone, string> = {
  primary: 'bg-[var(--color-primary)]',
  secondary: 'bg-[var(--color-secondary)]',
  success: 'bg-[var(--color-community)]',
  warning: 'bg-[var(--color-deal)]',
  error: 'bg-[var(--color-tertiary)]',
  neutral: 'bg-[var(--color-text-tertiary)]',
  featured: 'bg-[var(--color-on-solid)]',
};

export function Badge({ children, tone = 'primary', dot, className, title }: BadgeProps) {
  return (
    <span className={cn('ui-badge', TONE_CLASS[tone], className)} title={title}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASS[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Mapira kategoriju članka na ton badge-a (stabilno kroz ceo portal). */
export function categoryTone(category?: string): BadgeTone {
  const value = (category ?? '').toLowerCase();
  if (!value) return 'neutral';
  /* VIOLET — opšte vijesti i recenzije (primarni sadržaj portala) */
  if (value.includes('vesti') || value.includes('news')) return 'primary';
  if (value.includes('recenz') || value.includes('review')) return 'primary';
  /* CYAN — liste i hardver (PC/Gaming zona) */
  if (value.includes('liste') || value.includes('lista') || value.includes('list')) return 'secondary';
  if (value.includes('hardware') || value.includes('hardver') || value === 'pc' || value.startsWith('pc ')) return 'secondary';
  /* AMBER — esport (deals zona) */
  if (value.includes('esport')) return 'warning';
  /* ROSE — konzole */
  if (value.includes('playstation') || value.includes('xbox') || value.includes('nintendo') || value.includes('konzol')) return 'error';
  /* NEUTRAL — najave i sve ostalo */
  return 'neutral';
}
