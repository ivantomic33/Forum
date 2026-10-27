import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api, type NotificationEmailPrefs } from '../../lib/api';
import { Button } from '../ui';
import { SettingsSection, SettingsDivider } from './SettingsSection';

/**
 * 2.11.0 / 6.0.0 — MEJL KANAL NOTIFIKACIJA (UGAŠEN).
 *
 * Mejl se šalje SAMO za verifikaciju adrese i reset lozinke. Notifikacije
 * (odgovori, pominjanja, DM, upozorenja, bedž, uloga, pad cene…) zvone samo u
 * aplikaciji: zvonce + Realtime + web push — zato ovde nema podešavanja.
 *
 * Server i dalje nudi `EMAIL_NOTIFICATION_TYPES`, ali je set prazan; komponenta
 * se tada ne prikazuje.
 */

/** Nazivi tipova za UI. Nepoznat tip se prikazuje sirovim kodom (ne izmišljamo naziv). */
const TYPE_LABELS: Record<string, string> = {};

const labelFor = (type: string) => TYPE_LABELS[type] ?? type;

export function NotificationEmailSection() {
  const [prefs, setPrefs] = useState<NotificationEmailPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.notifications
      .emailPrefs()
      .then((data) => {
        if (!cancelled) setPrefs(data);
      })
      .catch(() => {
        if (!cancelled) toast.error('Podešavanja notifikacija nisu dostupna.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Optimistički upis uz rollback — server vraća istinu, pa se stanje sravnjuje. */
  const save = async (patch: { enabled?: boolean; muted?: string[] }) => {
    if (!prefs || busy) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch } as NotificationEmailPrefs);
    setBusy(true);
    try {
      const updated = await api.notifications.updateEmailPrefs(patch);
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      toast.error('Promena nije sačuvana. Pokušaj ponovo.');
    } finally {
      setBusy(false);
    }
  };

  const toggleMuted = (type: string) => {
    if (!prefs) return;
    const muted = prefs.muted.includes(type)
      ? prefs.muted.filter((value) => value !== type)
      : [...prefs.muted, type];
    void save({ muted });
  };

  if (loading) {
    return (
      <SettingsSection
        icon={<Mail size={14} aria-hidden="true" />}
        title="Mejl notifikacije"
        description="Učitavanje podešavanja…"
      >
        <div className="h-16 animate-pulse rounded-md bg-[var(--color-surface-3)]" aria-hidden="true" />
      </SettingsSection>
    );
  }

  if (!prefs) return null;

  const types = prefs.availableTypes ?? Object.keys(TYPE_LABELS);
  // Mejl se šalje samo za verifikaciju i reset lozinke — nema šta da se podesi.
  if (!types.length) return null;

  return (
    <SettingsSection
      icon={<Mail size={14} aria-hidden="true" />}
      title="Mejl notifikacije"
      description="Mejl stiže samo za verifikaciju adrese i reset lozinke. Sve ostale notifikacije vide se u aplikaciji."
      badge={
        <span className="text-micro whitespace-nowrap text-[var(--color-text-tertiary)]">
          {prefs.enabled ? 'Uključeno' : 'Isključeno'}
        </span>
      }
    >
      {!prefs.providerConfigured && (
        <p className="mb-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-micro text-[var(--color-text-secondary)]">
          Mejl servis trenutno nije podešen na serveru — notifikacije i dalje stižu u aplikaciju i na push.
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-meta font-medium text-[var(--color-text-primary)]">Mejl samo za verifikaciju i reset lozinke</p>
          <p className="text-micro mt-0.5">
            Notifikacije (odgovori, pominjanja, DM, upozorenja, bedž, pad cene…) stižu isključivo u aplikaciju i na push.
          </p>
        </div>
        <Button
          size="sm"
          variant={prefs.enabled ? 'ghost' : 'secondary'}
          loading={busy}
          onClick={() => void save({ enabled: !prefs.enabled })}
        >
          {prefs.enabled ? 'Isključi' : 'Uključi'}
        </Button>
      </div>

      {prefs.enabled && (
        <>
          <SettingsDivider />
          <fieldset disabled={busy}>
            <legend className="text-micro mb-2 font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Ne šalji mejl za
            </legend>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {types.map((type) => {
                const id = `notify-mute-${type}`;
                const checked = prefs.muted.includes(type);
                return (
                  <li key={type}>
                    <label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-meta text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                        checked={checked}
                        onChange={() => toggleMuted(type)}
                      />
                      <span className={checked ? 'text-[var(--color-text-tertiary)] line-through' : undefined}>
                        {labelFor(type)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </>
      )}
    </SettingsSection>
  );
}
