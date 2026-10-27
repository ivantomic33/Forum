import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Card — vizuelni kontejner sa tri nivoa elevacije.
 * `interactive` dodaje hover glow/translate (samo za klikabilne kartice).
 */
export type CardVariant = 'default' | 'static' | 'elevated';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
  /** Uklanja default padding (npr. kada kartica ima sliku do ivice). */
  flush?: boolean;
  /** Mala kartica u mreži (stat pločice) — 14 px padding, spec za ≤ 640 px. */
  compact?: boolean;
}

export function Card({ variant = 'default', interactive, flush, compact, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'ui-card',
        variant === 'static' && 'ui-card-static',
        variant === 'elevated' && 'ui-card-elevated',
        interactive && 'ui-card-interactive',
        flush && '!p-0 overflow-hidden',
        compact && 'ui-card-compact',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold text-[var(--color-text-primary)]">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-[var(--text-meta)] leading-[var(--text-meta-line)] text-[var(--color-text-secondary)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

