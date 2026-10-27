import type { ReactNode } from 'react';

/**
 * #redizajn — zajednički omotač sekcija u "Uredi profil" modalu.
 *
 * Ranije je svaka sekcija (2FA, passkeys, sesije, streak, privatnost) bila
 * samostalna kutija sa svojim stilom — modal je delovao kao gomila kartica.
 * Sada sve sekcije dele isti jezik: nova površina, hairline separator umesto
 * ivice oko svake, ikona u kvadratu + naslov + status pilula desno.
 */
export function SettingsSection({
  icon,
  title,
  description,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  /** Status pilula desno od naslova (npr. "Uključena", "2 uređaja"). */
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative pl-10">
      {/* Ikona u kvadratu — jedini akcent sekcije, levo od naslova */}
      <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-7 text-[var(--color-text-primary)]">{title}</h4>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-tertiary)]">{description}</p>
          )}
        </div>
        {badge}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Separator između sekcija — tanka linija, ne nova kutija. */
export function SettingsDivider() {
  return <hr className="my-5 border-0 border-t border-[var(--color-border-subtle)]" aria-hidden="true" />;
}
