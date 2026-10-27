import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * StatTile — „gaming kartica“ metrika: broj u mono 28 px + labela 12 px
 * UPPERCASE. Četiri komada u nizu: Nivo, XP, Karma, Postovi.
 */
export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Kratak kontekst ispod broja („+45 danas“). */
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, hint, icon, className }: StatTileProps) {
  return (
    <div className={cn('stat-tile', className)}>
      <span className="stat-tile-label flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="stat-tile-value">{value}</span>
      {hint && <span className="text-micro text-[var(--color-text-tertiary)]">{hint}</span>}
    </div>
  );
}
