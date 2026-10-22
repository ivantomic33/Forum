import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, MailCheck } from 'lucide-react';
import { api } from '../lib/api';
import AuthShell, { SubmitButton } from '../components/auth/AuthShell';
import { CaptchaBox, useAuthConfig } from '../components/auth/Turnstile';

/**
 * /forgot-password — zahtev za reset lozinke.
 * Server uvek vraća istu poruku (bez enumeracije naloga). `resetToken` postoji
 * samo u lokalnom razvoju uz `DEV_EXPOSE_TOKENS=1`, za ručno testiranje.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  // F-35 — reset lozinke je najčešća meta spam-botova (slanje mejlova).
  const authConfig = useAuthConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const requiresCaptcha = authConfig.enabled && authConfig.siteKey.length > 0;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (requiresCaptcha && !captchaToken) {
      setError('Sačekajte da se završi provera „nisam robot“ i pokušajte ponovo.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.auth.forgotPassword(email.trim(), captchaToken);
      setDevToken(response.resetToken ?? null);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Zahtev nije uspeo. Pokušajte ponovo.');
      setCaptchaToken(null);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Proverite email"
        description="Ako nalog sa tom adresom postoji, poslali smo vam link za reset lozinke. Link važi 30 minuta."
        success={
          <>
            <span className="auth-result-heading">
              <CheckCircle2 size={16} />
              Zahtev je poslat
            </span>
            <span>
              Niste dobili mejl? Proverite spam folder ili{' '}
              <Link to="/forgot-password" className="auth-text-link">pokušajte ponovo</Link>.
            </span>
            {devToken && (
              <>
                <span>Razvojni režim — token za direktan reset:</span>
                <Link className="auth-dev-token" to={`/reset?token=${encodeURIComponent(devToken)}`}>
                  {devToken}
                </Link>
              </>
            )}
          </>
        }
      />
    );
  }

  return (
    <AuthShell
      title="Zaboravljena lozinka"
      description="Unesite email adresu naloga i poslaćemo vam link za postavljanje nove lozinke."
      error={error}
      footer={
        <>
          Setili ste se lozinke? <Link to="/login" className="auth-text-link">Prijavite se</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="auth-field">
          <span>Email adresa</span>
          <span className="auth-input-wrap">
            <Mail size={15} />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vas.email@example.com"
              autoComplete="email"
              required
            />
          </span>
        </label>

        <CaptchaBox enabled={requiresCaptcha} siteKey={authConfig.siteKey} onToken={setCaptchaToken} />

        <SubmitButton loading={loading} icon={<MailCheck size={16} />}>
          {loading ? 'Slanje…' : 'Pošalji link za reset'}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
