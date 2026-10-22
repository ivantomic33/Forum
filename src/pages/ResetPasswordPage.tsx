import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, LockKeyhole, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { isPasswordValid, passwordError } from '../lib/passwordRules';
import PasswordRequirements from '../components/PasswordRequirements';
import AuthShell, { SubmitButton } from '../components/auth/AuthShell';

/**
 * /reset?token=… — postavljanje nove lozinke (POST /api/auth/reset-password).
 * Bez tokena stranica prikazuje uputstvo za novi link.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = (params.get('token') ?? '').trim();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordsMatch = useMemo(() => password.length > 0 && password === confirmPassword, [password, confirmPassword]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!isPasswordValid(password)) {
      setError(passwordError(password) ?? 'Lozinka ne ispunjava zahteve.');
      return;
    }
    if (!passwordsMatch) {
      setError('Lozinke se ne poklapaju.');
      return;
    }

    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Promena lozinke nije uspela. Pokušajte ponovo.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell
        title="Nevažeći link"
        description="Link za reset lozinke nije ispravan ili je nepotpun."
        footer={
          <>
            <Link to="/forgot-password" className="auth-text-link">Zatražite novi link</Link>
          </>
        }
      >
        <div className="auth-result" role="alert">
          <span className="auth-result-heading">
            <ShieldAlert size={16} />
            Nedostaje token
          </span>
          <span>Otvorite link iz mejla u celini ili zatražite novi.</span>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell
        title="Lozinka je promenjena"
        description="Možete se prijaviti novom lozinkom."
        success={
          <span className="auth-result-heading">
            <CheckCircle2 size={16} />
            Sve je spremno
          </span>
        }
        footer={
          <button type="button" className="auth-text-link auth-inline-btn" onClick={() => navigate('/login')}>
            Idi na prijavu
          </button>
        }
      />
    );
  }

  return (
    <AuthShell
      title="Nova lozinka"
      description="Postavite novu lozinku za svoj NEXUS nalog."
      error={error}
      footer={
        <>
          Ovaj link je istekao? <Link to="/forgot-password" className="auth-text-link">Zatražite novi</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="auth-field">
          <span>Nova lozinka</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={15} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <button
              type="button"
              className="auth-input-action"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Sakrij lozinku' : 'Prikaži lozinku'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
          <PasswordRequirements password={password} />
        </label>

        <label className="auth-field">
          <span>Potvrdite lozinku</span>
          <span className="auth-input-wrap">
            <LockKeyhole size={15} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Ponovite lozinku"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </span>
          {confirmPassword.length > 0 && (
            <span className={`auth-field-hint ${passwordsMatch ? 'is-ok' : 'is-bad'}`}>
              {passwordsMatch ? 'Lozinke se poklapaju.' : 'Lozinke se ne poklapaju.'}
            </span>
          )}
        </label>

        <SubmitButton loading={loading}>{loading ? 'Menjanje lozinke…' : 'Postavi novu lozinku'}</SubmitButton>
      </form>
    </AuthShell>
  );
}
