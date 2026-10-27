/**
 * F-7 — PWA / WEB PUSH na klijentu
 * --------------------------------
 *  - `registerServiceWorker()` — registruje `public/sw.js` (offline skela + kućište).
 *  - `pushSupported()` / `getPushStatus()` / `subscribePush()` / `unsubscribePush()` —
 *    pretplata na push za odgovor/citat.
 *
 * Namerno bez biblioteke (`workbox`, `vite-plugin-pwa`): jedini posao je
 * registracija i `pushManager.subscribe` sa VAPID javnim ključem.
 *
 * VAPID javni ključ dolazi sa servera (`GET /api/push/public-key`), pa se env
 * menja bez ponovnog build-a frontenda. Bez ključa UI prikazuje „nije
 * podešeno“ umesto greške u konzoli.
 */

const SW_URL = '/sw.js';

/** Prevod `base64url` VAPID ključa u `Uint8Array` (oblik koji traži `subscribe`). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  // U dev-u Vite servira module (SW bi keširao `/src/...` iz `localhost`);
  // registrujemo ga samo za build/preview i produkciju.
  if (import.meta.env.DEV) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    return registration;
  } catch {
    // SW nije dostupan (npr. hosting bez https) — aplikacija i dalje radi.
    return null;
  }
}

export type PushStatus = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied' | 'subscribed';

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  let key: string | null = null;
  try {
    const response = await fetch('/api/push/public-key', { credentials: 'same-origin' });
    if (!response.ok) return 'unconfigured';
    const body = await response.json();
    key = body?.publicKey ?? null;
  } catch {
    return 'unconfigured';
  }
  if (!key) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (subscription) return 'subscribed';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}

/**
 * Traži dozvolu, pretplaćuje na push i **šalje pretplatu serveru**.
 * Vraća status posle pokušaja (UI prikazuje toast prema njemu).
 */
export async function subscribePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const keyResponse = await fetch('/api/push/public-key', { credentials: 'same-origin' });
  const { publicKey } = await keyResponse.json().catch(() => ({ publicKey: null }));
  if (!publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) {
    // Server odbio (npr. migracija nije puštena) — poništavamo lokalnu pretplatu
    // da stanje UI-ja ne laže da su notifikacije uključene.
    await subscription.unsubscribe().catch(() => undefined);
    return 'default';
  }
  return 'subscribed';
}

export async function unsubscribePush(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return 'default';
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
  return 'default';
}
