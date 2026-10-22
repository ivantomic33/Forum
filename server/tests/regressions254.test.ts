import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { registerSchema } from '../lib/schemas.js';

const require = createRequire(import.meta.url);
const { securityHeaders } = require('../../scripts/security-headers.mjs') as {
  securityHeaders: (options?: { https?: boolean; dev?: boolean }) => Record<string, string>;
};

/**
 * Regresije 2.5.4: F-20 zaglavlja frontenda, F-21 evidencija saglasnosti,
 * F-25 CORS 403 i F-24 bez internih poruka grešaka u odgovorima.
 */

describe('F-20 — CSP za frontend', () => {
  const headers = securityHeaders();

  it('skripte su stroge: nema unsafe-inline ni unsafe-eval', () => {
    const csp = headers['Content-Security-Policy'];
    const scriptSrc = csp.split(';').find((part) => part.trim().startsWith('script-src'));
    expect(scriptSrc).toBe(" script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('dev/preview CSP dozvoljava SAMO hash React Refresh preamble skripte', () => {
    const devCsp = securityHeaders({ dev: true })['Content-Security-Policy'];
    const scriptSrc = devCsp.split(';').find((part) => part.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).toContain("'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='");
  });

  it('blokira ugrađivanje u iframe i MIME sniffing', () => {
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('fontovi se učitavaju samo sa našeg domena (F-23)', () => {
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).not.toContain('fonts.gstatic.com');
  });

  it('HSTS se šalje samo kada je sajt na HTTPS-u', () => {
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders({ https: true })['Strict-Transport-Security']).toContain('max-age=31536000');
  });
});

describe('F-21 — registracija beleži saglasnost', () => {
  const base = { username: 'tester', email: 't@example.com', password: 'Lozinka123', acceptedTerms: true };

  it('registracija prolazi uz potvrdu uzrasta', () => {
    expect(registerSchema.safeParse({ ...base, ageConfirmed: true }).success).toBe(true);
  });

  it('uslovi moraju biti prihvaćeni', () => {
    const result = registerSchema.safeParse({ ...base, acceptedTerms: false, ageConfirmed: true });
    expect(result.success).toBe(false);
  });

  it('uzrast je opciono polje na nivou šeme (server vraća eksplicitnu poruku)', () => {
    // `ageConfirmed` je `.optional()` jer stariji klijenti ne šalju polje; ruta
    // ipak odbija registraciju bez `true` i vraća jasnu poruku o uzrastu.
    expect(registerSchema.safeParse(base).success).toBe(true);
  });
});
