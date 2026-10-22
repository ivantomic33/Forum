import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import AuthShell from '../components/auth/AuthShell';

type VerifyState = 'checking' | 'consuming' | 'success' | 'invalid' | 'error';

/**
 * /verify?token=… — verifikacija email adrese (POST /api/auth/verify-email).
 * Prvo se token proveri (`GET /auth/verify-email/:token`) da bi se razlikovalo
 * „link je istekao“ od „link je već iskorišćen“, pa se tek onda troši klikom.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();

  const [state, setState] = useState<VerifyState>(() => (token ? 'checking' : 'invalid'));
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  /**
   * React 19 StrictMode u razvoju pokreće `useEffect` dvaput. Bez ove zaštite
   * drugi poziv je trošio već iskorišćen token i prikazivao grešku iako je
   * verifikacija uspela. `started` čuva i peek i consume u istom ref-u.
   */
  const consumed = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    api.auth
      .peekVerifyEmail(token)
      .then((result) => setState(result.valid ? 'consuming' : 'invalid'))
      .catch(() => setState('error'));
  }, [token]);

  useEffect(() => {
    if (state !== 'consuming' || consumed.current) return;
    consumed.current = true;
    api.auth
      .verifyEmail(token)
      .then(() => setState('success'))
      .catch((err: any) => {
        setMessage(err?.message ?? null);
        setState('error');
      });
  }, [state, token]);

  const confirmingManually = () => {
    setMessage(null);
    consumed.current = false;
    setState('consuming');
  };

  if (state === 'checking' || state === 'consuming') {
    return (
      <AuthShell
        title="Verifikacija email adrese"
        description="Ovaj link važi 24 sata i može se iskoristiti samo jednom."
      >
        <div className="auth-loading" role="status" aria-live="polite">
          <Loader2 size={16} />
          {state === 'checking' ? 'Proveravamo link…' : 'Verifikujemo email adresu…'}
        </div>
      </AuthShell>
    );
  }

  if (state === 'success') {
    return (
      <AuthShell
        title="Email adresa je potvrđena"
        description="Nalog je sada verifikovan — sve funkcije zajednice su otključane."
        success={
          <span className="auth-result-heading">
            <CheckCircle2 size={16} />
            Uspešno verifikovano
          </span>
        }
        footer={
          <>
            <Link to="/" className="auth-text-link">Nazad na početnu</Link>
          </>
        }
      />
    );
  }

  if (state === 'invalid') {
    return (
      <AuthShell
        title="Link nije važeći"
        description="Link za verifikaciju je istekao ili je već iskorišćen. Prijavite se da biste zatražili novi."
        footer={
          <>
            <Link to="/login" className="auth-text-link">Prijavite se</Link>
          </>
        }
      >
        <div className="auth-result" role="alert">
          <span className="auth-result-heading">
            <ShieldAlert size={16} />
            Token nije prihvaćen
          </span>
          <span>Novi link za verifikaciju može se poslati iz podešavanja naloga.</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Verifikacija nije uspela"
      description="Došlo je do greške pri potvrdi email adrese."
      error={message ?? 'Pokušajte ponovo za nekoliko minuta.'}
      footer={
        <>
          <Link to="/login" className="auth-text-link">Nazad na prijavu</Link>
        </>
      }
    >
      <div className="auth-result" role="alert">
        <span className="auth-result-heading">
          <AlertCircle size={16} />
          Greška pri verifikaciji
        </span>
        <span>Proverite internet vezu ili pokušajte da potvrdite ponovo.</span>
      </div>

      <div className="auth-actions">
        <button type="button" className="auth-submit" onClick={confirmingManually}>
          <MailCheck size={16} />
          <span>Pokušaj ponovo</span>
        </button>
      </div>
    </AuthShell>
  );
}
