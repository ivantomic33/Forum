import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Button — jedina komponenta za dugmiće u aplikaciji.
 * Varijante: primary (violet), secondary (glass), ghost, danger.
 * VelicÌŒine: sm, md, lg. `block` za punu širinu.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Simplifikovan loading state — onemogućava klik i prikazuje spinner. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  asChildClassName?: never;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'br-primary',
  secondary: 'br-secondary',
  ghost: 'br-ghost',
  danger: 'br-danger',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'br-sm',
  md: 'br-md',
  lg: 'br-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('ui-btn', VARIANT_CLASS[variant], SIZE_CLASS[size], block && 'w-full', loading && 'is-loading', className)}
      {...rest}
    >
      {loading ? <span className="ui-btn-spinner" aria-hidden="true" /> : leftIcon}
      <span className="ui-btn-label">{children}</span>
      {!loading && rightIcon}
    </button>
  );
});

/** Link koji izgleda kao dugme — koristi se u CTA redovima. */
export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cn('ui-btn', VARIANT_CLASS[variant], SIZE_CLASS[size], extra);
}
