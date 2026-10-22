import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * F-35 — Cloudflare Turnstile widget.
 * Skripta se učitava samo kada je captcha stvarno uključena na serveru, pa
 * lokalni razvoj i klijenti bez mreže nemaju dodatni request.
 *
 * `onVerify` dobija token koji se šalje uz zahtev kao `captchaToken`
 * (server prihvata i `cf-turnstile-response`).
 *
 * B-05 — `CaptchaBox` prima `resetKey`: Turnstile token važi jednokratno, pa se
 * widget mora ponovo renderovati posle neuspešnog zahteva. Bez toga drugi
 * pokušaj (npr. u 2FA koraku) visi na „Sačekajte da se završi provera…“.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-nexus-turnstile]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile_script_failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.nexusTurnstile = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile_script_failed'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Rezultat `useAuthConfig` hook-a: da li je captcha obavezna i koji je site key. */
export interface CaptchaConfig {
  enabled: boolean;
  siteKey: string;
  loading: boolean;
}

/**
 * Učita javnu auth konfiguraciju (Turnstile + OAuth provajderi) jednom po mount-u.
 * Bezbedno je i kada ruta ne postoji (stariji server) — vraća „isključeno“.
 */
export function useAuthConfig(): CaptchaConfig & { oauthProviders: string[] } {
  const [config, setConfig] = useState<CaptchaConfig & { oauthProviders: string[] }>({
    enabled: false,
    siteKey: '',
    loading: true,
    oauthProviders: [],
  });

  useEffect(() => {
    let cancelled = false;
    api.auth
      .config()
      .then((res) => {
        if (cancelled) return;
        setConfig({
          enabled: Boolean(res.turnstile?.enabled),
          siteKey: res.turnstile?.siteKey ?? '',
          loading: false,
          oauthProviders: res.oauthProviders ?? [],
        });
        if (res.turnstile?.enabled && res.turnstile?.siteKey) {
          loadTurnstileScript().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setConfig((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

/** Sam widget. Kada captcha nije uključena, ne renderuje ništa. */
export function TurnstileWidget({
  enabled,
  siteKey,
  onToken,
  resetKey = 0,
}: {
  enabled: boolean;
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Promena vrednosti resetuje widget (posle neuspešnog zahteva). */
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !siteKey) return;
    let disposed = false;

    loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return;
        if (widgetId.current) {
          window.turnstile.remove(widgetId.current);
          widgetId.current = null;
        }
        containerRef.current.innerHTML = '';
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (value: string) => onToken(value),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));

    return () => {
      disposed = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, siteKey, resetKey]);

  if (!enabled || !siteKey) return null;

  return (
    <div className="auth-captcha">
      <div ref={containerRef} />
    </div>
  );
}

/** Zajednički blok: „Zaštićeno Cloudflare Turnstile“ + widget. */
export function CaptchaBox({
  enabled,
  siteKey,
  onToken,
  resetKey = 0,
}: {
  enabled: boolean;
  siteKey: string;
  onToken: (token: string | null) => void;
  /** B-05 — novi ključ = novi widget (posle neuspeha ili prelaska na 2FA korak). */
  resetKey?: number;
}) {
  if (!enabled || !siteKey) return null;

  return (
    <div className="auth-captcha-box">
      <div className="auth-captcha-head">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>Zaštita od botova</span>
      </div>
      <TurnstileWidget enabled={enabled} siteKey={siteKey} onToken={onToken} resetKey={resetKey} />
      <p className="auth-field-hint">Cloudflare Turnstile — provera u pozadini, bez zagonetki.</p>
    </div>
  );
}
