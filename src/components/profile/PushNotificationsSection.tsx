import { useEffect, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { getPushStatus, pushSupported, subscribePush, unsubscribePush, type PushStatus } from '../../lib/push';
import { Button } from '../ui';

/**
 * F-7 — uključivanje web push notifikacija iz podešavanja profila.
 *
 * Dozvola se traži SAMO na klik (nikad pri učitavanju) — browseri blokiraju
 * automatske `Notification.requestPermission`, a i korisnik treba da zna šta
 * prihvata. Stanje dolazi iz `getPushStatus()` (podrška + dozvola + pretplata).
 */
export function PushNotificationsSection() {
  const [status, setStatus] = useState<PushStatus>('unsupported');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushStatus().then(setStatus);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      const next = status === 'subscribed' ? await unsubscribePush() : await subscribePush();
      setStatus(next);
      if (next === 'subscribed') toast.success('Push notifikacije su uključene na ovom uređaju.');
      else if (next === 'denied') toast.error('Notifikacije su blokirane u podešavanjima browsera.');
      else if (next === 'unconfigured') toast.error('Push trenutno nije podešen na serveru.');
      else if (next !== 'unsupported') toast.success('Push notifikacije su isključene.');
    } catch {
      toast.error('Promena nije uspela. Pokušaj ponovo.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'unsupported') {
    return (
      <p className="text-meta">
        Ovaj browser ne podržava push notifikacije. U aplikaciji ćeš i dalje videti sve notifikacije u zvonu.
      </p>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[var(--color-text-muted)]">
          {status === 'subscribed' ? <BellRing size={16} aria-hidden="true" /> : <Smartphone size={16} aria-hidden="true" />}
        </span>
        <div>
          <p className="text-meta font-medium text-[var(--color-text-primary)]">
            Push notifikacije{status === 'subscribed' ? ' — uključene' : ''}
          </p>
          <p className="text-micro mt-0.5">
            {status === 'unconfigured'
              ? 'Server još nije podesio VAPID ključeve (vidi README).'
              : status === 'denied'
                ? 'Blokirane su u podešavanjima browsera — tamo ih ponovo dozvoli.'
                : 'Obaveštenje na uređaju kada dobiješ odgovor, citat ili upozorenje.'}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={status === 'subscribed' ? 'ghost' : 'secondary'}
        loading={busy}
        disabled={status === 'denied' || status === 'unconfigured'}
        onClick={() => void toggle()}
      >
        {status === 'subscribed' ? 'Isključi' : 'Uključi'}
      </Button>
    </div>
  );
}
