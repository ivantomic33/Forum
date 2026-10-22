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
}

export function Card({ variant = 'default', interactive, flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'ui-card',
        variant === 'static' && 'ui-card-static',
        variant === 'elevated' && 'ui-card-elevated',
        interactive && 'ui-card-interactive',
        flush && '!p-0 overflow-hidden',
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
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/[0.07] pb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-white">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-white/55">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
