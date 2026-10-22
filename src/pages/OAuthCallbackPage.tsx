import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import AuthShell from '../components/auth/AuthShell';

/**
 * F-34 — povratak sa OAuth provajdera.
 *
 * Server je već postavio HttpOnly cookie sesiju (uspeh) ili je vratio stabilan
 * kod greške. Ovde samo osvežavamo stanje korisnika i preusmeravamo dalje.
 */
const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Prijava je otkazana.',
  link_cancelled: 'Povezivanje naloga je otkazano.',
  invalid_state: 'Zahtev za prijavu je istekao ili nije validan. Pokušajte ponovo.',
  provider_disabled: 'Prijava preko izabranog provajdera trenutno nije dostupna.',
  provider_error: 'Provajder nije mogao da potvrdi prijavu. Pokušajte ponovo ili koristite email i lozinku.',
  link_requires_login: 'Morate biti prijavljeni da biste povezali nalog.',
  already_linked_elsewhere: 'Ovaj provajderski nalog je već povezan sa drugim NEXUS nalogom.',
  account_suspended: 'Vaš nalog je suspendovan. Obratite se podršci.',
  account_not_found: 'Povezani nalog više ne postoji.',
  registration_closed: 'Registracija novih naloga je trenutno onemogućena.',
};

export default function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initSession = useAuthStore((state) => state.initSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Steka open redirect — prihvatamo samo interne putanje (server to već radi).
    const next = params.get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const errorCode = params.get('error');

    if (errorCode) {
      setError(ERROR_MESSAGES[errorCode] ?? 'Prijava nije uspela. Pokušajte ponovo.');
      return;
    }

    if (params.get('ok') === '1') {
      // Cookie je već tu; `initSession` učitava korisnika preko `/auth/me`.
      initSession().then(() => navigate(safeNext, { replace: true }));
      return;
    }

    navigate('/login', { replace: true });
  }, [params, navigate, initSession]);

  if (error) {
    return (
      <AuthShell
        title="Prijava nije uspela"
        description="Pokušajte ponovo ili se prijavite email adresom i lozinkom."
        error={error}
        footer={
          <>
            <Link to="/login" className="auth-text-link">Nazad na prijavu</Link>
          </>
        }
      >
        <div className="auth-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Prijava u toku" description="Potvrđujemo prijavu sa provajderom…">
      <div className="auth-error" role="status" style={{ borderColor: 'rgba(52, 211, 153, 0.35)' }}>
        <CheckCircle2 size={16} />
        <span>Uspešno — preusmeravamo vas…</span>
      </div>
    </AuthShell>
  );
}
