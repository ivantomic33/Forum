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
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  success: 'bg-[#10b981]',
  warning: 'bg-[#f59e0b]',
  error: 'bg-[#ef4444]',
  neutral: 'bg-white/50',
  featured: 'bg-white',
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
  if (value.includes('hardware') || value.includes('hardver')) return 'secondary';
  if (value.includes('recenz') || value.includes('review')) return 'primary';
  if (value.includes('playstation') || value.includes('xbox') || value.includes('nintendo')) return 'error';
  if (value.includes('esport')) return 'warning';
  return 'neutral';
}
