import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Loader2, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import AuthShell from '../components/auth/AuthShell';
import TermsModal from '../components/TermsModal';

/**
 * F-34 — dovršavanje OAuth registracije.
 *
 * Server ne pravi nalog „u ime“ korisnika: Steam ne daje email, a Discord/Google
 * email može biti zauzet. Zato callback vraća `signupTicket` i predloženo ime,
 * a korisnik ovde bira korisničko ime i prihvata uslove (F-21).
 */
export default function OAuthCompleteSignupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const ticket = params.get('ticket') ?? '';
  const suggested = params.get('suggested') ?? '';
  const provider = params.get('provider') ?? '';
  const email = params.get('email') ?? '';

  const [username, setUsername] = useState(suggested);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const providerLabel = useMemo(
    () => ({ discord: 'Discord', google: 'Google', steam: 'Steam' })[provider] ?? 'provajder',
    [provider],
  );

  // Provera dostupnosti imena dok korisnik kuca (isto kao na registracionoj formi).
  useEffect(() => {
    const value = username.trim();
    if (value.length < 3) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      api.auth
        .checkUsername(value)
        .then((res) => setAvailable(res.available))
        .catch(() => setAvailable(null))
        .finally(() => setChecking(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [username]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!acceptedTerms) {
      setError('Morate prihvatiti uslove korišćenja i politiku privatnosti.');
      return;
    }
    if (!ageConfirmed) {
      setError('Potvrdite da imate najmanje 15 godina.');
      return;
    }
    if (available === false) {
      setError('Korisničko ime je već zauzeto.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.auth.oauthCompleteSignup({
        ticket,
        username: username.trim(),
        acceptedTerms,
        ageConfirmed,
      });
      login(response.user, true);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registracija nije uspela. Pokušajte ponovo.');
    } finally {
      setLoading(false);
    }
  };

  if (!ticket) {
    return (
      <AuthShell
        title="Registracija je istekla"
        description="Izaberite ponovo način registracije."
        footer={<Link to="/register" className="auth-text-link">Nazad na registraciju</Link>}
      >
        <div className="auth-error" role="alert">
          <AlertCircle size={16} />
          <span>Link za dovršavanje registracije nije validan ili je istekao.</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-backdrop-image" />
        <div className="auth-backdrop-shade" />
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
      </div>

      <AuthShell
        title="Još samo korak"
        description={
          <>
            Potvrđen si preko <strong>{providerLabel}</strong>
            {email ? ` (${email})` : ''}. Izaberi korisničko ime za NEXUS.
          </>
        }
        footer={
          <>
            Već imaš nalog? <Link to="/login" className="auth-text-link">Prijavi se</Link>
          </>
        }
      >
        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Korisničko ime</span>
            <span className="auth-input-wrap">
              <UserRound size={15} />
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="NexusGamer"
                autoComplete="username"
                minLength={3}
                maxLength={25}
                required
              />
            </span>
            {available === false && <span className="auth-field-hint is-bad">Korisničko ime je već zauzeto.</span>}
            {available === true && <span className="auth-field-hint is-ok">Korisničko ime je slobodno.</span>}
            {checking && <span className="auth-field-hint">Proveravamo dostupnost…</span>}
          </label>

          <label className="auth-remember auth-terms">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onClick={(event) => {
                event.preventDefault();
                setTermsModalOpen(true);
              }}
              onChange={(event) => {
                if (!event.target.checked) setAcceptedTerms(false);
              }}
            />
            <span>
              Slažem se sa <Link to="/terms" className="auth-text-link">uslovima korišćenja</Link> i{' '}
              <Link to="/privacy" className="auth-text-link">politikom privatnosti</Link>.
            </span>
          </label>

          <label className="auth-remember auth-terms">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(event) => setAgeConfirmed(event.target.checked)}
            />
            <span>Imam najmanje 15 godina ili imam saglasnost roditelja/staratelja.</span>
          </label>

          <button
            className={`auth-submit ${loading ? 'is-loading' : ''}`}
            type="submit"
            disabled={loading || !acceptedTerms || !ageConfirmed}
          >
            {loading ? <Loader2 size={16} className="auth-submit-spinner" /> : null}
            <span>{loading ? 'Kreiramo nalog...' : 'Završi registraciju'}</span>
            {!loading && <ArrowRight size={16} />}
          </button>

          <p className="auth-field-hint">
            <Check size={12} aria-hidden="true" /> Nalog nema lozinku — prijavljivaćeš se preko {providerLabel}-a
            dok ne postaviš lozinku u podešavanjima.
          </p>
        </form>
      </AuthShell>

      <TermsModal
        open={termsModalOpen}
        onAccept={() => {
          setAcceptedTerms(true);
          setTermsModalOpen(false);
        }}
        onClose={() => setTermsModalOpen(false)}
      />
    </div>
  );
}
