import { useEffect, useState } from 'react';
import { Moon, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { api, type NotificationPrefs, type QuietHours } from '../../lib/api';
import { Button } from '../ui';
import { SettingsSection, SettingsDivider } from './SettingsSection';

/**
 * 6.x — TIŠI SATI + TIPOVI ZA KOJE SE NE ZVONI.
 *
 * Menja SAMO web push (zvuk na uređaju). Notifikacija i dalje ulazi u inbox i
 * zvonce u aplikaciji — zato nema straha da ćeš nešto propustiti. Vremenski
 * opseg je po lokalnom vremenu korisnika: browser šalje offset u minutima, pa
 * server ne mora da zna u kojoj si zoni.
 */

const TYPE_LABELS: Record<string, string> = {
  reply: 'Odgovori u mojim temama',
  mention: 'Pominjanja',
  upvote: 'Glasovi i prihvaćeni odgovori',
  dm: 'Privatne poruke',
  guestbook: 'Gostionica profila',
  badge_earned: 'Bedževi',
  level_up: 'Novi nivo',
  quest_completed: 'Kvestovi',
  streak: 'Niz prijava (streak)',
  price_alert: 'Pad cene',
  warning: 'Upozorenja i moderacija',
  staff: 'Obaveštenja tima',
  verification: 'Verifikacija naloga',
  system: 'Sistemska obaveštenja',
};

const labelFor = (type: string) => TYPE_LABELS[type] ?? type;

/** Offset browsera u minutima (isto što server očekuje). */
const localOffset = () => -new Date().getTimezoneOffset();

export function QuietHoursSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('22:00');
  const [to, setTo] = useState('07:00');

  useEffect(() => {
    let cancelled = false;
    api.notifications
      .prefs()
      .then((data) => {
        if (cancelled) return;
        setPrefs(data);
        if (data.quietHours) {
          setFrom(data.quietHours.from);
          setTo(data.quietHours.to);
        }
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

  const save = async (patch: { quietHours?: QuietHours | null; pushMuted?: string[] }) => {
    if (!prefs || busy) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...patch } as NotificationPrefs);
    setBusy(true);
    try {
      const updated = await api.notifications.updatePrefs(patch);
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      toast.error('Promena nije sačuvana. Pokušaj ponovo.');
    } finally {
      setBusy(false);
    }
  };

  const toggleQuiet = () => {
    if (!prefs) return;
    if (prefs.quietHours) void save({ quietHours: null });
    else void save({ quietHours: { from, to, tzOffsetMinutes: localOffset() } });
  };

  const applyTimes = () => {
    void save({ quietHours: { from, to, tzOffsetMinutes: localOffset() } });
  };

  const toggleMuted = (type: string) => {
    if (!prefs) return;
    const pushMuted = prefs.pushMuted.includes(type)
      ? prefs.pushMuted.filter((value) => value !== type)
      : [...prefs.pushMuted, type];
    void save({ pushMuted });
  };

  if (loading) {
    return (
      <SettingsSection icon={<Moon size={14} aria-hidden="true" />} title="Tiši sati" description="Učitavanje podešavanja…">
        <div className="h-16 animate-pulse rounded-md bg-[var(--color-surface-3)]" aria-hidden="true" />
      </SettingsSection>
    );
  }
  if (!prefs) return null;

  const quietOn = Boolean(prefs.quietHours);
  const types = prefs.availableTypes ?? Object.keys(TYPE_LABELS);

  return (
    <SettingsSection
      icon={<Moon size={14} aria-hidden="true" />}
      title="Tiši sati"
      description="Ne zvoni na uređaju u izabranom periodu. Notifikacije i dalje stižu u aplikaciju — ovde se isključuje samo zvuk (push)."
      badge={
        <span className="text-micro whitespace-nowrap text-[var(--color-text-tertiary)]">
          {quietOn ? `${prefs.quietHours!.from}–${prefs.quietHours!.to}` : 'Isključeno'}
        </span>
      }
    >
      {!prefs.pushConfigured && (
        <p className="mb-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-micro text-[var(--color-text-secondary)]">
          Web push trenutno nije podešen na serveru — podešavanja važe čim push proradi.
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-meta font-medium text-[var(--color-text-primary)]">Ne skreći mi pažnju noću</p>
          <p className="text-micro mt-0.5">
            {quietOn
              ? `Push se ne šalje između ${prefs.quietHours!.from} i ${prefs.quietHours!.to} (tvoje lokalno vreme).`
              : 'Uključi da uređaj ne zvoni noću — sve ostaje u zvoncu i inbox-u.'}
          </p>
        </div>
        <Button size="sm" variant={quietOn ? 'ghost' : 'secondary'} loading={busy} onClick={toggleQuiet}>
          {quietOn ? 'Isključi' : 'Uključi'}
        </Button>
      </div>

      {quietOn && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-meta text-[var(--color-text-secondary)]">
            Od
            <input
              type="time"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-meta"
            />
          </label>
          <label className="flex items-center gap-1.5 text-meta text-[var(--color-text-secondary)]">
            do
            <input
              type="time"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-meta"
            />
          </label>
          <Button size="sm" variant="ghost" loading={busy} onClick={applyTimes}>
            Sačuvaj vreme
          </Button>
        </div>
      )}

      <SettingsDivider />

      <fieldset disabled={busy}>
        <legend className="text-micro mb-2 flex items-center gap-1.5 font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
          <VolumeX size={12} aria-hidden="true" />
          Ne zvoni za
        </legend>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {types.map((type) => {
            const id = `push-mute-${type}`;
            const checked = prefs.pushMuted.includes(type);
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
    </SettingsSection>
  );
}
