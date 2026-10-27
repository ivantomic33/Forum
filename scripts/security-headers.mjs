import { themeScriptHash } from './theme-script-hash.mjs';

const API_URL = (process.env.VITE_API_URL ?? '').replace(/\/$/, '');
const apiOrigin = API_URL ? new URL(API_URL).origin : '';
/**
 * N-06 — error tracking i dalje ide ka Sentry-ju (browser envelope), pa domen
 * mora biti u `connect-src`. `sendBeacon`/`fetch` poštuju CSP.
 */
const sentryDsn = (process.env.VITE_SENTRY_DSN ?? '').trim();
const sentryOrigin = (() => {
  if (!sentryDsn) return '';
  try {
    return new URL(sentryDsn).origin;
  } catch {
    return '';
  }
})();

function buildCsp({ dev = false } = {}) {
  const connect = ["'self'", apiOrigin, sentryOrigin, 'https://*.supabase.co'].filter(Boolean);
  return [
    "default-src 'self'",
    // Bez `unsafe-inline`/`unsafe-eval` za skripte. Dva su dozvoljena inline
    // skripta, oba sa hash-om iz `index.html`:
    //  1. tema pre prvog paint-a (U-08) — hash se računa, ne prepisuje ručno;
    //  2. React Refresh preamble (samo dev/preview).
    // Ranije je hash teme nedostajao, pa se dev stranica učitavala prazna (CSP
    // je tiho blokirao skript, bez ikakve greške u UI-ju).
    `script-src 'self' ${themeScriptHash()}` + (dev ? " 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='" : ''),
    // Tailwind/React ubacuju inline stilove (style atribut) — ostaje dok se ne uvede nonce.
    "style-src 'self' 'unsafe-inline'",
    // F-23 — fontovi su self-hostovani (@fontsource), pa nema Google Fonts domena.
    "font-src 'self' data:",
    "img-src 'self' data: https: blob:",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function securityHeaders({ https = false, dev = false } = {}) {
  return {
    'Content-Security-Policy': buildCsp({ dev }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload' } : {}),
  };
}

/** Vite plugin koji dodaje zaglavlja na dev/preview server. */
export function securityHeadersPlugin(options = {}) {
  const apply = (_req, res, next) => {
    for (const [name, value] of Object.entries(securityHeaders({ ...options, dev: true }))) {
      res.setHeader(name, value);
    }
    next();
  };

  return {
    name: 'nexus-security-headers',
    configureServer(server) {
      server.middlewares.use(apply);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apply);
    },
  };
}
