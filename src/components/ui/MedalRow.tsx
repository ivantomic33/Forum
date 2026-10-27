import { getBadge } from '../../lib/badges';
import { BadgeIcon } from './BadgeChip';
import { cn } from './cn';

/**
 * MedalRow — badževi kao duguljaste pilule (ikona + ime), ne krugovi.
 *
 * Svaka pilula nosi ikonicu 13 px + ime; opis daje native tooltip (`title`)
 * i `aria-label`, pa red ostaje čitljiv na čitaču ekrana. Višak se sažima
 * u „+N“ koji takođe nosi tooltip.
 */
export function MedalRow({ badges, className }: { badges: string[]; className?: string }) {
  const known = badges.filter((id) => Boolean(getBadge(id)));
  const shown = known.slice(0, 6);
  const rest = known.length - shown.length;

  if (!known.length) return null;

  return (
    <ul className={cn('medal-row', className)} aria-label="Bedževi">
      {shown.map((id, index) => {
        const badge = getBadge(id)!;
        return (
          <li
            key={id}
            /** Prve tri medalje nose rang boje (zlato/srebro/bronza) — isti tokeni kao podijum. */
            className={cn('medal', index === 0 && 'medal-rank-1', index === 1 && 'medal-rank-2', index === 2 && 'medal-rank-3')}
            title={`${badge.name} — ${badge.desc}`}
            aria-label={`${badge.name}: ${badge.desc}`}
          >
            <BadgeIcon name={badge.icon} size={11} />
            <span className="medal-name">{badge.name}</span>
          </li>
        );
      })}
      {rest > 0 && (
        <li className="medal medal-more" title={`Još ${rest} bedževa`} aria-label={`Još ${rest} bedževa`}>
          +{rest}
        </li>
      )}
    </ul>
  );
}
