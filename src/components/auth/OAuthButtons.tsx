import type { ReactElement, CSSProperties } from 'react';
import { api } from '../../lib/api';

/**
 * F-34 — „Prijavi se preko Discorda/Steama/Google-a“.
 * Puna navigacija (ne fetch) — server izdaje redirect i postavlja state cookie-less
 * potpisani token, pa tok preživljava i blokiranje popup-ova.
 */
const PROVIDERS: Record<string, { label: string; accent: string; icon: ReactElement }> = {
  discord: {
    label: 'Discord',
    accent: '#5865F2',
    icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
        <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3c-.21.375-.455.88-.623 1.282a18.27 18.27 0 0 0-5.618 0A12.6 12.6 0 0 0 8.56 3a19.74 19.74 0 0 0-4.885 1.369C.553 8.94-.3 13.386.094 17.77a19.9 19.9 0 0 0 6.03 3.06c.474-.65.9-1.34 1.266-2.065a12.9 12.9 0 0 1-1.995-.965c.168-.123.331-.25.49-.381a14.2 14.2 0 0 0 12.23 0c.16.132.323.26.49.38a13 13 0 0 1-2 1.0c.367.725.79 1.415 1.265 2.066a19.86 19.86 0 0 0 6.031-3.06c.46-5.086-.77-9.49-3.554-13.401ZM8.02 15.09c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.18 1.094 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.18 1.094 2.157 2.42 0 1.333-.947 2.418-2.157 2.418Z" />
      </svg>
    ),
  },
  steam: {
    label: 'Steam',
    accent: '#66c0f4',
    icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
        <path d="M11.98 2C6.5 2 2.01 6.2 1.5 11.55l5.36 2.22a2.9 2.9 0 0 1 1.64-.5h.14l2.38-3.45v-.05a3.87 3.87 0 1 1 3.87 3.87h-.09l-3.4 2.43v.12a2.9 2.9 0 0 1-5.76.53L2 15.05A10 10 0 1 0 11.98 2Zm-4.6 15.13 1.23.51a2.18 2.18 0 0 0 2.84-1.16 2.18 2.18 0 0 0-1.16-2.84l-1.28-.53a2.9 2.9 0 0 1 1.14 4.02Zm11.54-8.2a2.58 2.58 0 1 0-5.16 0 2.58 2.58 0 0 0 5.16 0Zm-4.51 0a1.94 1.94 0 1 1 3.87 0 1.94 1.94 0 0 1-3.87 0Z" />
      </svg>
    ),
  },
  google: {
    label: 'Google',
    accent: '#ea4335',
    icon: (
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.81Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3a7.22 7.22 0 0 1-10.75-3.8H1.28v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.32 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.28a12 12 0 0 0 0 10.8l4.04-3.11Z" />
        <path fill="#EA4335" d="M12 4.77c1.77 0 3.36.61 4.6 1.8l3.43-3.43A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.04 3.11A7.2 7.2 0 0 1 12 4.77Z" />
      </svg>
    ),
  },
};

export function OAuthButtons({
  providers,
  mode,
  redirect,
  highlight,
}: {
  providers: string[];
  /** `link` = povezivanje sa tekućim nalogom (iz profila). */
  mode?: 'login' | 'link';
  redirect?: string;
  /** 5.5 — poslednji korišćen provajder (dobija naglasak „prošli put ovako“). */
  highlight?: string;
}) {
  const available = providers.filter((provider) => PROVIDERS[provider]);
  if (!available.length) return null;

  return (
    <div className="auth-oauth">
      <div className="auth-oauth-divider">
        <span>ili {mode === 'link' ? 'poveži' : 'nastavi'} preko</span>
      </div>
      <div className="auth-oauth-grid">
        {available.map((provider, index) => {
          const meta = PROVIDERS[provider];
          return (
            <a
              key={provider}
              className={`auth-oauth-btn ${highlight === provider ? 'is-last-used' : ''}`}
              href={api.auth.oauthStartUrl(provider, { mode, redirect })}
              style={{ '--oauth-accent': meta.accent, '--oauth-i': index } as CSSProperties}
              aria-label={`${mode === 'link' ? 'Poveži' : 'Prijavi se preko'} ${meta.label}${highlight === provider ? ' (poslednji put korišćeno)' : ''}`}
            >
              {meta.icon}
              <span>{meta.label}</span>
              {highlight === provider && <em className="auth-oauth-last">prošli put</em>}
            </a>
          );
        })}
      </div>
    </div>
  );
}
