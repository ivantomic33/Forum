import { useEffect, useState } from 'react';

/**
 * 5.0 TERMINAL — tipkajući odgovor u konzoli (`> proveravam nexusgamer... ✓ SLOBODNO`).
 *
 * Isti mehanizam kao boot linija na levom panelu, ali po komandi: kada se
 * rezultat promeni, cela linija se otkuca brzinom od ~14 ms po znaku. Ne
 * prekucava se ponovo isti rezultat, pa UI ne „treperi“ pri svakom renderu.
 *
 * `role="status"` + `aria-live="polite"`: screen reader dobija KONAČNU poruku
 * (deo za čitače se ne tipka, jer je kucanje čisto vizuelno).
 */
type Tone = 'checking' | 'ok' | 'bad';

export function TerminalResponse({
  command,
  result,
  tone,
}: {
  /** Deo posle `>` koji ostaje miran (npr. `proveravam nexusgamer...`). */
  command: string;
  /** Konačan odgovor; `null` dok se čeka. */
  result: string | null;
  tone: Tone;
}) {
  const [typed, setTyped] = useState(0);
  const text = result ?? '';

  useEffect(() => {
    setTyped(0);
    if (!text) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setTyped(text.length);
      return;
    }
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTyped(index);
      if (index >= text.length) clearInterval(timer);
    }, 14);
    return () => clearInterval(timer);
  }, [text]);

  const done = typed >= text.length;

  return (
    <span className={`auth-term-response is-${tone}`}>
      <span className="auth-term-cmd">{command}</span>{' '}
      <span className="auth-term-result">{text.slice(0, typed)}</span>
      {!done && <span className="auth-boot-caret" aria-hidden="true" />}
      {/* Čitač ekrana: konačna poruka odjednom (bez kucanja). */}
      <span className="sr-only" role="status" aria-live="polite">
        {result ?? ''}
      </span>
    </span>
  );
}
