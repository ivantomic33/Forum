import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import AuthShell from '../components/auth/AuthShell';

type ConfirmState = 'loading' | 'success' | 'invalid';

/**
 * /newsletter/confirm?token=… — potvrda double opt-in pretplate.
 * GET /api/newsletter/confirm?token=… (token stiže u linku iz mejla).
 */
export default function NewsletterConfirmPage() {
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();

  const [state, setState] = useState<ConfirmState>(() => (token ? 'loading' : 'invalid'));
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    api.auth.newsletter
      .confirm(token)
      .then(() => setState('success'))
      .catch(() => setState('invalid'));
  }, [token]);

  if (state === 'loading') {
    return (
      <AuthShell
        title="Potvrda newsletter pretplate"
        description="Potvrđujemo vašu NEXUS newsletter pretplatu."
      >
        <div className="auth-loading" role="status" aria-live="polite">
          <Loader2 size={16} />
          Potvrđujemo pretplatu…
        </div>
      </AuthShell>
    );
  }

  if (state === 'success') {
    return (
      <AuthShell
        title="Pretplata je potvrđena"
        description="Newsletter je ugašen — mejl se šalje samo za verifikaciju adrese i reset lozinke."
        success={
          <>
            <span className="auth-result-heading">
              <CheckCircle2 size={16} />
              Pretplata je zabeležena
            </span>
            <span>Newsletter mejlovi se ne šalju — sve novosti stižu u aplikaciji.</span>
          </>
        }
        footer={
          <>
            <Link to="/" className="auth-text-link">Nazad na početnu</Link>
          </>
        }
      />
    );
  }

  return (
    <AuthShell
      title="Link nije važeći"
      description="Link za potvrdu pretplate je istekao ili je neispravan."
      footer={
        <>
          <Link to="/" className="auth-text-link">Nazad na početnu</Link>
        </>
      }
    >
      <div className="auth-result" role="alert">
        <span className="auth-result-heading">
          <ShieldAlert size={16} />
          Pretplata nije potvrđena
        </span>
        <span>Pretplatite se ponovo sa naslovne strane — poslaćemo novi link.</span>
      </div>
    </AuthShell>
  );
}
