/**
 * F-20 — sigurnosna zaglavlja za statički frontend (Vite dev/preview).
 * Ekvivalentna zaglavlja za hosting su u `public/_headers` (Netlify/Cloudflare Pages).
 */
const API_URL = (process.env.VITE_API_URL ?? '').replace(/\/$/, '');
const apiOrigin = API_URL ? new URL(API_URL).origin : '';

function buildCsp({ dev = false } = {}) {
  const connect = ["'self'", apiOrigin, 'https://*.supabase.co'].filter(Boolean);
  return [
    "default-src 'self'",
    // Bez `unsafe-inline`/`unsafe-eval` za skripte. Dev/preview dodaje SAMO jedan
    // hash — za inline React Refresh preamble koji Vite ubacuje u `index.html`
    // (stabilan string, bez korisničkog sadržaja). Bez njega Vite dev ne radi.
    dev ? "script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='" : "script-src 'self'",
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
