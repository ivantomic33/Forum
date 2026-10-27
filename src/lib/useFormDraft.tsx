/**
 * F-EDIT2 — AUTOSAVE DRAFTOVA FORUM FORMA (localStorage)
 * ------------------------------------------------------
 * Običan forumaš gubi sav tekst ako slučajno zatvori tab ili osveži stranicu
 * (admin članci imaju status u bazi — ovo je klijentski autosave za ostale).
 *
 * Obrazac (konvencija projekta: ključevi sa prefiksom `nexus-`):
 *   - `nexus_forum_draft_new_thread`      — nova tema (ForumPage composer)
 *   - `nexus_forum_draft_reply_{threadId}`— odgovor na temu (ThreadPage)
 *
 * Ponašanje:
 *  - DEBOUNCE 800 ms od poslednjeg kucaanja — nema upisa na svaki taster;
 *  - sva polja prazna → ključ se BRIŠE (bez „praznih“ zapisa u storage-u);
 *  - restore je eksplicitan (banner „Vrati sadržaj / Odbaci“), ne auto-popunjavanje —
 *    korisnik koji je hteo praznu formu ne biva iznenađen starim tekstom;
 *  - `clear()` OBAVEZNO posle uspešnog submit-a (200/201);
 *  - try/catch oko svakog localStorage poziva (privatni režim / QuotaExceededError);
 *  - `beforeunload` upozorenje SAMO dok postoji nesačuvan tekst (i samo u browseru);
 *  - TTL (default 7 dana) — stari draftovi se sami tretiraju kao nepostojeći.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CloudUpload } from 'lucide-react';

export type DraftStatus = 'idle' | 'saving' | 'saved';

interface DraftEnvelope {
  values: Record<string, unknown>;
  updatedAt: number;
}

const DEBOUNCE_MS = 800;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Sigurnosni omotači — localStorage baca u privatnom režimu i kad je storage pun. */
function readDraft(key: string): DraftEnvelope | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope;
    if (!parsed || typeof parsed !== 'object' || !parsed.values) return null;
    return parsed;
  } catch {
    return null; // oštećen JSON ili zabranjen storage — tretiraj kao „nema drafta“
  }
}

function writeDraft(key: string, envelope: DraftEnvelope): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false; // QuotaExceededError / privatni režim — draft se samo ne čuva
  }
}

function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage nedostupan — ništa za čišćenje */
  }
}

const isEmptyValue = (value: unknown): boolean =>
  value == null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.every(isEmptyValue)) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.values(value ?? {}).every(isEmptyValue));

export interface UseFormDraftOptions {
  /** Draft stariji od ovoga se ignoriše (default 7 dana). */
  ttlMs?: number;
  /** Debounce upisa (default 800 ms). */
  debounceMs?: number;
  /** `beforeunload` upozorenje dok korisnik aktivno piše (default true). */
  warnOnUnload?: boolean;
}

export interface UseFormDraftResult<T extends Record<string, unknown>> {
  /** Sačuvan draft (ili null). `hasDraft` je true samo ako draft još “važi” (TTL). */
  draft: T | null;
  hasDraft: boolean;
  /** Draft je stariji od TTL-a — ponudi „Odbaci“ umesto vraćanja. */
  isStale: boolean;
  updatedAt: number | null;
  status: DraftStatus;
  /** Primeni draft na formu (poziva se iz „Vrati sadržaj“). */
  restore: () => void;
  /** Obriši draft („Odbaci“ ili nakon uspešnog submit-a). */
  clear: () => void;
  /** Da li forma ima bilo šta nesnimljeno (za beforeunload i banner). */
  isDirty: boolean;
}

export function useFormDraft<T extends Record<string, unknown>>(
  key: string,
  /** Trenutne vrednosti forme — hook ih debounced snima. */
  values: T,
  /** Poziva se nakon `restore()` da komponenta postavi stateove (setteri). */
  onRestore: (values: T) => void,
  options: UseFormDraftOptions = {},
): UseFormDraftResult<T> {
  const { ttlMs = DEFAULT_TTL_MS, debounceMs = DEBOUNCE_MS, warnOnUnload = true } = options;

  const [stored, setStored] = useState<DraftEnvelope | null>(() =>
    typeof window === 'undefined' ? null : readDraft(key),
  );
  const [status, setStatus] = useState<DraftStatus>('idle');
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // Ključ se može promeniti (npr. navigacija na drugu temu) — ponovo učitaj.
  useEffect(() => {
    setStored(readDraft(key));
    setStatus('idle');
  }, [key]);

  // Debounced upis. Prazan sadržaj → briši ključ.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const empty = Object.values(values).every(isEmptyValue);
    if (empty) {
      // Ne diramo stored (restore source) — samo fizički ključ.
      removeDraft(key);
      setStored(null);
      setStatus('idle');
      return;
    }
    setStatus('saving');
    const timer = window.setTimeout(() => {
      const ok = writeDraft(key, { values, updatedAt: Date.now() });
      if (ok) {
        setStored({ values, updatedAt: Date.now() });
        setStatus('saved');
      } else {
        setStatus('idle');
      }
    }, debounceMs);
    return () => window.clearTimeout(timer);
    // `values` je novi objekat na svakom renderu roditelja — poredimo sadržaj:
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(values), debounceMs]);

  const clear = useCallback(() => {
    removeDraft(key);
    setStored(null);
    setStatus('idle');
  }, [key]);

  const draft = useMemo(() => (stored ? (stored.values as T) : null), [stored]);

  const isStale = Boolean(stored && Date.now() - stored.updatedAt > ttlMs);
  const hasDraft = Boolean(stored) && !isStale;
  const isDirty = !Object.values(values).every(isEmptyValue);

  // Upozori pri zatvaranju taba SAMO dok korisnik aktivno piše (nesačuvane izmene).
  useEffect(() => {
    if (typeof window === 'undefined' || !warnOnUnload) return;
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, warnOnUnload]);

  const restore = useCallback(() => {
    if (!stored) return;
    onRestoreRef.current(stored.values as T);
  }, [stored]);

  return {
    draft,
    hasDraft,
    isStale,
    updatedAt: stored?.updatedAt ?? null,
    status,
    restore,
    clear,
    isDirty,
  };
}

/** Minimalistički indikator statusa autosave-a (uz submit dugme ili ispod forme). */
export function DraftStatusIndicator({ status }: { status: DraftStatus }) {
  if (status === 'idle') return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/35"
      role="status"
      aria-live="polite"
    >
      {status === 'saving' ? (
        <>
          <CloudUpload size={12} className="animate-pulse" aria-hidden="true" />
          Čuva se…
        </>
      ) : (
        <>
          <Check size={12} aria-hidden="true" />
          Draft sačuvan lokalno
        </>
      )}
    </span>
  );
}

/** Nenametljiv banner „Pronađen je nesačuvani draft“ (iznad forme). */
export function DraftRecoveryBanner({
  updatedAt,
  isStale,
  onRestore,
  onDiscard,
}: {
  updatedAt: number | null;
  isStale: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const when = updatedAt
    ? new Date(updatedAt).toLocaleString('sr-Latn-RS', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2 text-xs text-cyan-100/90">
      <span>
        Pronađen je nesačuvani draft{when ? ` (${when})` : ''}{isStale ? ' — stariji od 7 dana' : ''}.
      </span>
      <span className="flex items-center gap-2">
        {!isStale && (
          <button
            type="button"
            onClick={onRestore}
            className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
          >
            Vrati sadržaj
          </button>
        )}
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md px-2.5 py-1 font-semibold text-white/50 transition hover:text-white/80"
        >
          Odbaci
        </button>
      </span>
    </div>
  );
}
