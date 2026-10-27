/**
 * PRISUSTVO — POKRETAČ (N-06)
 * ---------------------------
 * `Layout` ne sme statički da uvozi `presenceStore` (on uvlači Realtime SDK i
 * React Query u glavni chunk). Ovde se isti posao obavlja preko lenog
 * `import()`, pa mrežni deo prisustva putuje u zaseban chunk.
 *
 * Između prvog rendera i učitavanja chunka nema prisustva — `load()` pokreće
 * kanal čim stigne. Bez Supabase konfiguracije `subscribeRealtime` vraća `null`
 * i radi samo REST rezerva. Odjava pre učitavanja ne ostavlja aktivan kanal.
 */
import { queryClient } from '../lib/queryClient';

type PresenceModule = typeof import('./presenceStore');

let pending: Promise<PresenceModule> | null = null;
/** `true` kada je `startPresence` već zatražen — `load()` ga tada pokreće. */
let started = false;

function load() {
  if (!pending) {
    pending = import('./presenceStore').then((module) => {
      if (started) module.startPresence(queryClient);
      return module;
    });
  }
  return pending;
}

/**
 * Pokreće praćenje prisustva (idempotentno). Poziva se jednom, iz `Layout`-a.
 */
export function startPresenceDeferred(): void {
  if (started) return;
  started = true;
  void load();
}

/**
 * N-01 — stanje prijave se promenilo: gost nema otkucaje, a prijavljeni
 * korisnik ih dobija odmah (bez čekanja 25s).
 */
export function syncPresenceWithAuthDeferred(): void {
  if (!started) return;
  void load().then((module) => module.syncPresenceWithAuth());
}

/** Zaustavlja kanal (unmount cele aplikacije u testovima/dev-u). */
export function stopPresenceDeferred(): void {
  const wasStarted = started;
  started = false;
  if (!wasStarted) return;
  void load().then((module) => module.stopPresence());
}
