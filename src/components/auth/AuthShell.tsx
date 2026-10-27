import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Gamepad2, Loader2, Sparkles, X } from 'lucide-react';

/**
 * Zajednički okvir za auth podstranice (F-03): forgot/reset lozinke, verifikacija
 * email-a i potvrda newsletter-a. Nasleđuje vizuelne primitive `AuthPage`-a, ali
 * bez login/register tabova.
 */
export interface AuthShellProps {
  title: string;
  description: ReactNode;
  /** Forma ili sadržaj; nepotrebno kada je prikazan `success` blok. */
  children?: ReactNode;
  error?: string | null;
  success?: ReactNode;
  footer?: ReactNode;
}

export default function AuthShell({ title, description, children, error, success, footer }: AuthShellProps) {
  return (
    <div className="auth-screen">
      {/* U-12 — ista deterministička CSS pozadina kao AuthPage (nema mrežnog zahteva) */}
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-backdrop-image" />
      </div>

      <div className="auth-shell auth-shell-single">
        <aside className="auth-aside" aria-hidden="true">
          <div className="auth-aside-inner">
            <Link to="/" className="auth-aside-brand" tabIndex={-1}>
              <span className="auth-aside-logo">
                <Gamepad2 size={20} />
              </span>
              <span className="auth-aside-brand-text">
                <strong>NEXUS</strong>
                <em>GG COMMUNITY</em>
              </span>
            </Link>

            <div className="auth-aside-copy">
              <span className="auth-aside-eyebrow">
                <Sparkles size={12} />
                Bezbednost naloga
              </span>
              <h2>
                Tvoj nalog, <span className="gradient-text-animated">pod tvojom kontrolom</span>
              </h2>
              <p>Linkovi za verifikaciju i reset važe ograničeno vreme i mogu se iskoristiti samo jednom.</p>
            </div>
          </div>
        </aside>

        <section className="auth-card" aria-labelledby="auth-subpage-title">
          <Link to="/login" className="auth-close" aria-label="Nazad na prijavu">
            <X size={17} />
          </Link>

          <div className="auth-card-scroll">
            <div className="auth-brand-badge">
              <Sparkles size={12} />
              NEXUS GG COMMUNITY PORTAL
            </div>

            <div className="auth-heading">
              <h1 id="auth-subpage-title">{title}</h1>
              <p>{description}</p>
            </div>

            {error && (
              <div className="auth-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {success ? (
              <div className="auth-result" role="status" aria-live="polite">
                {success}
              </div>
            ) : (
              children
            )}

            {footer && <p className="auth-switch-note">{footer}</p>}

            <p className="auth-switch-note">
              <Link to="/login" className="auth-text-link auth-inline-link">
                <ArrowLeft size={13} />
                Nazad na prijavu
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Spinner dugme — konzistentno sa `auth-submit` u AuthPage-u. */
export function SubmitButton({ loading, icon, children }: { loading: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <button className={`auth-submit ${loading ? 'is-loading' : ''}`} type="submit" disabled={loading}>
      {loading ? <Loader2 size={16} className="auth-submit-spinner" /> : icon}
      <span>{children}</span>
    </button>
  );
}
