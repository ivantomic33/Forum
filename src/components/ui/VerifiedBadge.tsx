import { BadgeCheck } from 'lucide-react';
import { cn } from '../ui';

/**
 * VERIFIKACIONA ZNAČKA („štiklica“)
 * ---------------------------------
 * Prikazuje se pored imena člana koji je potvrdio email adresu.
 *
 * Pravila:
 *  - Ikonica je uvek ista (`BadgeCheck`) → prepoznatljiv signal na celom sajtu.
 *  - Boja nije jedini signal: `title` + `aria-label` daju tekstualno značenje.
 *  - Veličine `xs` (u redovima liste), `sm` (kartice, navbar), `md` (profil).
 *  - Ne prikazuje se za `isVerified` koji nije eksplicitno `true` — stariji
 *    API odgovori bez polja ne smeju da izgledaju verifikovano.
 */
export type VerifiedBadgeSize = 'xs' | 'sm' | 'md';

const SIZE: Record<VerifiedBadgeSize, { icon: number; className: string }> = {
  xs: { icon: 11, className: 'h-3.5 w-3.5' },
  sm: { icon: 13, className: 'h-4 w-4' },
  md: { icon: 16, className: 'h-5 w-5' },
};

export const VERIFIED_LABEL = 'Verifikovan nalog — email adresa potvrđena';

export interface VerifiedBadgeProps {
  isVerified?: boolean | null;
  size?: VerifiedBadgeSize;
  className?: string;
  /** Kratki tekst pored ikonice (npr. na profilu). */
  withLabel?: boolean;
}

export function VerifiedBadge({ isVerified, size = 'sm', className, withLabel }: VerifiedBadgeProps) {
  if (isVerified !== true) return null;
  const { icon, className: sizeClass } = SIZE[size];

  if (withLabel) {
    return (
      <span
        className={cn(
          'verified-badge verified-badge--labeled inline-flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100',
          className,
        )}
        title={VERIFIED_LABEL}
      >
        <BadgeCheck size={icon} aria-hidden="true" className="shrink-0 text-cyan-300" />
        Verifikovan
      </span>
    );
  }

  return (
    <span
      className={cn('verified-badge inline-flex shrink-0 items-center', className)}
      title={VERIFIED_LABEL}
      role="img"
      aria-label={VERIFIED_LABEL}
    >
      <BadgeCheck
        size={icon + 3}
        strokeWidth={2.4}
        className={cn(sizeClass, 'verified-badge-icon')}
        aria-hidden="true"
      />
    </span>
  );
}

export interface UserNameProps {
  name: string;
  isVerified?: boolean | null;
  size?: VerifiedBadgeSize;
  className?: string;
  /** Dodatni sadržaj posle imena (npr. role bedž). */
  children?: React.ReactNode;
}

/**
 * Ime + verifikaciona značka u jednom redu.
 * Koristi se svuda gde se prikazuje ime člana, da značka nikad ne „sklizne“.
 */
export function UserName({ name, isVerified, size = 'sm', className, children }: UserNameProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className="truncate">{name}</span>
      <VerifiedBadge isVerified={isVerified} size={size} />
      {children}
    </span>
  );
}
