import { toast } from 'sonner';

/**
 * 6.x — IN-APP „PROBUDNO“ OBAVEŠTENJE.
 *
 * Realtime je ranije samo osvežavao zvonce — ako nisi gledao u ugao, nova
 * notifikacija je „prošla tiho“. Sada se pojavi kratki toast sa naslovom i
 * „Otvori“ koji vodi na `link` iz notifikacije.
 *
 * GRUPISANJE: isti tip + isti link u 30 sekundi ne pravi novi toast, nego
 * podiže brojač („Ana i 4 druga su glasali“ → „3 nove aktivnosti u temi“).
 * Bez ovoga bi živa tema pojeла ekran sa 20 toastова.
 *
 * Tiši sati: toast pripada aplikaciji (nema zvuka), pa se prikazuje uvek dok
 * je tab otvoren — server tiše sate primenjuje samo na push.
 */

type ToastEntry = { at: number; count: number; key: string };

const recent = new Map<string, ToastEntry>();
const GROUP_WINDOW_MS = 30_000;
const MAX_TRACKED = 50;

export interface ToastNotification {
  id?: string;
  type?: string;
  title?: string;
  message?: string;
  link?: string | null;
}

/** Naziv grupe po tipu — kratko, da naslov ostane čitljiv i kada se grupiše. */
const GROUP_LABEL: Record<string, string> = {
  reply: 'novi odgovor',
  mention: 'pominjanje',
  upvote: 'glas',
  dm: 'privatna poruka',
  guestbook: 'upis u gostionicu',
  badge_earned: 'nova značka',
  quest_completed: 'završen kvet',
  level_up: 'novi nivo',
  price_alert: 'pad cene',
  warning: 'upozorenje',
  staff: 'obaveštenje tima',
  verification: 'verifikacija',
  system: 'obaveštenje',
};

function prune(now: number) {
  if (recent.size <= MAX_TRACKED) return;
  for (const [key, entry] of recent) {
    if (now - entry.at > GROUP_WINDOW_MS) recent.delete(key);
  }
}

/**
 * Prikaži toast za notifikaciju. Nikad ne baca i ne blokira pozivaoca —
 * ako toast iz bilo kog razloga padne, zvonce i inbox su već osveženi.
 */
export function notifyUser(notification: ToastNotification) {
  try {
    const type = notification.type ?? 'system';
    const label = GROUP_LABEL[type] ?? 'obaveštenje';
    // Grupa = tip + ciljna strana (dva odgovora u istoj temi = jedna poruka,
    // odgovori u dve različite teme = dve poruke).
    const key = `${type}:${notification.link ?? ''}`;
    const now = Date.now();
    const previous = recent.get(key);

    if (previous && now - previous.at < GROUP_WINDOW_MS) {
      previous.count += 1;
      previous.at = now;
      // Toast sa istim `id` se ne duplira — sadržaj se menja u mestu.
      toast(`Nove aktivnosti (${previous.count} × ${label})`, {
        id: `notif:${key}`,
        description: notification.link ? 'Klikni da otvoriš' : undefined,
        duration: 6000,
        action: notification.link
          ? {
            label: 'Otvori',
            onClick: () => openLink(notification.link!),
          }
          : undefined,
      });
      return;
    }

    recent.set(key, { at: now, count: 1, key });
    prune(now);

    toast(notification.title ?? `Nova ${label}`, {
      id: `notif:${key}`,
      description: notification.message?.slice(0, 140),
      duration: 6000,
      action: notification.link
        ? {
          label: 'Otvori',
          onClick: () => openLink(notification.link!),
        }
        : undefined,
    });
  } catch {
    // Toast je dodatak — nikad ne obara Realtime handler.
  }
}

/** Navigacija iz toast-a: React Router `navigate` je dostupan samo unutar komponente, pa se koristi history API. */
function openLink(link: string) {
  try {
    window.history.pushState({}, '', link);
    // Router sluša `popstate`; `pushState` sam ne emituje događaj.
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    window.location.assign(link);
  }
}

/** Za testove: očisti grupisanje između scenarija. */
export function __resetNotificationToasts() {
  recent.clear();
}
