import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  EyeOff,
  Gamepad2,
  Loader2,
  LockKeyhole,
  Mail,
  MessageSquare,
  Shield,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { isPasswordValid, passwordError } from '../lib/passwordRules';
import PasswordRequirements from '../components/PasswordRequirements';
import TermsModal from '../components/TermsModal';
import { CaptchaBox, useAuthConfig } from '../components/auth/Turnstile';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { safeNextPath } from '../lib/navigation';

type AuthMode = 'login' | 'register';

/** Prednosti prikazane na levom branding panelu (isključivo vizuelno). */
const PERKS = [
  { icon: MessageSquare, title: 'Komentari i diskusije', text: 'Učestvuj u temama i razmeni mišljenje sa gejmerima.' },
  { icon: Gamepad2, title: 'Prilagođen gejming profil', text: 'Sačuvaj vesti, prati omiljene igre i svoj napredak.' },
  { icon: BadgeCheck, title: 'Nivoi i reputacija', text: 'Skupljaj poene, osvajaj značke i penji se na rang listi.' },
] as const;

export default function AuthPage({ initialMode }: { initialMode: AuthMode }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // F-21 — eksplicitna potvrda uzrasta (min. 15 godina) uz prihvatanje uslova.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ available: boolean; reason: string | null } | null>(null);
  // F-35 — Turnstile token (null kada captcha nije uključena na serveru).
  const authConfig = useAuthConfig();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // B-05 — Turnstile token je jednokratan: svaki neuspeh (i prelazak na 2FA korak)
  // menja ključ da se widget ponovo renderuje u pravoj formi.
  const [captchaKey, setCaptchaKey] = useState(0);
  const resetCaptcha = () => {
    setCaptchaToken(null);
    setCaptchaKey((key) => key + 1);
  };
  // F-33 — 2FA izazov posle tačne lozinke.
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaInfo, setMfaInfo] = useState<{ username: string; recoveryCodesLeft: number } | null>(null);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const isLogin = mode === 'login';
  const requiresCaptcha = authConfig.enabled && authConfig.siteKey.length > 0;

  // Blur pozadine dok je auth overlay otvoren — skrol strane ostaje dozvoljen.
  useEffect(() => {
    document.documentElement.classList.add('auth-overlay-open');
    return () => {
      document.documentElement.classList.remove('auth-overlay-open');
    };
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce = (fn: () => void, delay = 500) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fn, delay);
  };

  // Real-time username availability check (database-backed).
  useEffect(() => {
    if (isLogin || username.trim().length < 3) {
      setUsernameAvailable(null);
      return;
    }
    debounce(() => {
      api.auth
        .checkUsername(username.trim())
        .then((res) => setUsernameAvailable(res.available))
        .catch(() => setUsernameAvailable(null));
    });
  }, [username, isLogin]);

  // Real-time email check: uniqueness + disposable provider detection.
  useEffect(() => {
    const clean = email.trim().toLowerCase();
    if (isLogin || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setEmailStatus(null);
      return;
    }
    debounce(() => {
      api.auth
        .checkEmail(clean)
        .then((res) => setEmailStatus({ available: res.available, reason: res.reason ?? null }))
        .catch(() => setEmailStatus(null));
    });
  }, [email, isLogin]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!isLogin) {
      if (!acceptedTerms) {
        setError('Morate prihvatiti uslove korišćenja i politiku privatnosti da biste se registrovali.');
        return;
      }
      if (!ageConfirmed) {
        setError('Potvrdite da imate najmanje 15 godina.');
        return;
      }
      if (!isPasswordValid(password)) {
        setError(passwordError(password) ?? 'Lozinka ne ispunjava zahteve.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Lozinke se ne poklapaju.');
        return;
      }
      if (usernameAvailable === false) {
        setError('Korisničko ime je već zauzeto.');
        return;
      }
      if (emailStatus && !emailStatus.available) {
        setError(
          emailStatus.reason === 'disposable'
            ? 'Privremene (temp) email adrese nisu dozvoljene. Koristite pravu email adresu.'
            : 'Email adresa je već registrovana.'
        );
        return;
      }
    }

    if (requiresCaptcha && !captchaToken) {
      setError('Sačekajte da se završi provera „nisam robot“ i pokušajte ponovo.');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const response = await api.auth.login({
          email,
          password,
          rememberMe: remember,
          captchaToken,
        });
        if ('requires2fa' in response) {
          // Lozinka je tačna — tražimo kod iz aplikacije (bez izdavanja sesije).
          setMfaTicket(response.mfaTicket);
          setMfaInfo({ username: response.username, recoveryCodesLeft: response.recoveryCodesLeft });
          resetCaptcha();
          setPassword('');
          return;
        }
        login(response.user, remember);
        // B-06 — poštuj `?next=` (guard admina) ili `state.from` (deals/games).
        navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
      } else {
        const response = await api.auth.register({
          username,
          email,
          password,
          acceptedTerms,
          ageConfirmed,
          captchaToken,
        });
        login(response.user, true);
        navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
      }
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Greška pri prijavi.' : 'Greška pri registraciji.'));
      // Turnstile token važi jednokratno — osveži widget posle neuspeha.
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  /** Drugi korak prijave: kod od 6 cifara ili recovery kod. */
  const submitMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mfaTicket) return;
    setError(null);

    if (!mfaCode.replace(/[\s-]/g, '').length) {
      setError('Unesite kod iz autentifikacione aplikacije.');
      return;
    }
    if (requiresCaptcha && !captchaToken) {
      setError('Sačekajte da se završi provera „nisam robot“ i pokušajte ponovo.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.auth.login2fa({ mfaTicket, code: mfaCode, rememberMe: remember, captchaToken });
      login(response.user, remember);
      navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
    } catch (err: any) {
      setError(err.message || 'Kod nije prihvaćen. Pokušajte ponovo.');
      setMfaCode('');
      resetCaptcha();
      if (err?.code === 'MFA_TICKET_INVALID') {
        setMfaTicket(null);
        setMfaInfo(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = () => {
    setMfaTicket(null);
    setMfaInfo(null);
    setMfaCode('');
    setError(null);
    resetCaptcha();
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setUsernameAvailable(null);
    setEmailStatus(null);
    resetCaptcha();
    cancelMfa();
    navigate(nextMode === 'login' ? '/login' : '/register', { replace: true });
  };

  // Checkbox na registraciji NE može se direktno štiklirati — otvara modal sa uslovima.
  const handleTermsCheckboxClick = (event: React.MouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    setTermsModalOpen(true);
  };

  // Dugme "Pročitao sam" unutar modala je jedini način da se checkbox označi.
  const acceptTermsFromModal = () => {
    setAcceptedTerms(true);
    setTermsModalOpen(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-backdrop-image" />
        <div className="auth-backdrop-shade" />
        <div className="auth-orb auth-orb-one" />
        <div className="auth-orb auth-orb-two" />
      </div>

      <div className="auth-shell">
        {/* ---- Leva strana: branding i prednosti (samo desktop) ---- */}
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
                Dobrodošao u zajednicu
              </span>
              <h2>
                Tvoj gejming svet, <span className="gradient-text-animated">na jednom mestu</span>
              </h2>
              <p>
                Vesti, forumi, rang liste i eSports pokrivenost — sve u jednom portalu. Napravi nalog i
                otključaj sve mogućnosti.
              </p>
            </div>

            <ul className="auth-aside-perks">
              {PERKS.map((perk) => (
                <li key={perk.title}>
                  <span className="auth-aside-perk-icon">
                    <perk.icon size={15} />
                  </span>
                  <span className="auth-aside-perk-text">
                    <strong>{perk.title}</strong>
                    <em>{perk.text}</em>
                  </span>
                </li>
              ))}
            </ul>

            <div className="auth-aside-stat">
              <Check size={14} />
              Besplatno, bez skrivenih troškova — uvek.
            </div>
          </div>
        </aside>

        <section className="auth-card" aria-labelledby="auth-title">
        <Link to="/" className="auth-close" aria-label="Nazad na naslovnu">
          <X size={17} />
        </Link>

        <div className="auth-card-scroll">
          <div className="auth-brand-badge">
            <Sparkles size={12} />
            NEXUS GG COMMUNITY PORTAL
          </div>

          <div className="auth-heading">
            <h1 id="auth-title">{isLogin ? 'Dobrodošli nazad' : 'Pridruži se zajednici'}</h1>
            <p>
              {isLogin
                ? 'Prijavite se da biste komentarisali, sačuvali vesti i prilagodili svoj gaming profil.'
                : 'Kreirajte nalog i pridružite se gejming zajednici.'}
            </p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Prijava ili registracija">
            <span className={`auth-tab-pill ${isLogin ? 'is-login' : 'is-register'}`} aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={isLogin}
              className={`auth-tab ${isLogin ? 'is-active' : ''}`}
              onClick={() => switchMode('login')}
            >
              Prijava
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isLogin}
              className={`auth-tab ${!isLogin ? 'is-active' : ''}`}
              onClick={() => switchMode('register')}
            >
              Registracija
            </button>
          </div>

          {error && (
            <div className="auth-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {mfaTicket ? (
            /* F-33 — drugi korak prijave (2FA) */
            <form className="auth-form" onSubmit={submitMfa}>
              <div className="auth-mfa-badge">
                <Shield size={15} aria-hidden="true" />
                Dvofaktorska prijava
              </div>
              <p className="auth-field-hint">
                Unesite 6-cifreni kod iz autentifikacione aplikacije{mfaInfo?.username ? ` za ${mfaInfo.username}` : ''}.
                Možete uneti i jedan od recovery kodova.
              </p>

              <label className="auth-field">
                <span>Kod</span>
                <span className="auth-input-wrap">
                  <Shield size={15} />
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    placeholder="123 456"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    autoFocus
                    maxLength={11}
                    required
                  />
                </span>
                {mfaInfo && mfaInfo.recoveryCodesLeft <= 2 && (
                  <span className="auth-field-hint is-bad">
                    Ostalo vam je još {mfaInfo.recoveryCodesLeft} recovery kodova — obnovite ih u podešavanjima profila.
                  </span>
                )}
              </label>

              <label className="auth-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Zapamti moju prijavu (7 dana)</span>
              </label>

              <CaptchaBox enabled={requiresCaptcha} siteKey={authConfig.siteKey} onToken={setCaptchaToken} resetKey={captchaKey} />

              <button className={`auth-submit ${loading ? 'is-loading' : ''}`} type="submit" disabled={loading}>
                {loading ? <Loader2 size={16} className="auth-submit-spinner" /> : null}
                <span>{loading ? 'Proveravamo kod...' : 'Potvrdi kod'}</span>
                {!loading && <ArrowRight size={16} />}
              </button>

              <button type="button" className="auth-text-link auth-inline-btn" onClick={cancelMfa}>
                Nazad na prijavu
              </button>
            </form>
          ) : (
          <form className="auth-form" onSubmit={submit}>
            {!isLogin && (
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
                {usernameAvailable === false && (
                  <span className="auth-field-hint is-bad">Korisničko ime je već zauzeto.</span>
                )}
                {usernameAvailable === true && (
                  <span className="auth-field-hint is-ok">Korisničko ime je slobodno.</span>
                )}
              </label>
            )}

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
              {!isLogin && emailStatus && !emailStatus.available && (
                <span className="auth-field-hint is-bad">
                  {emailStatus.reason === 'disposable'
                    ? 'Privremene (temp) email adrese nisu dozvoljene.'
                    : emailStatus.reason === 'taken'
                      ? 'Email adresa je već registrovana.'
                      : 'Unesite ispravnu email adresu.'}
                </span>
              )}
            </label>

            <label className="auth-field">
              <span>Lozinka</span>
              <span className="auth-input-wrap">
                <LockKeyhole size={15} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
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
              {!isLogin && <PasswordRequirements password={password} />}
            </label>

            {!isLogin && (
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
              </label>
            )}

            {isLogin ? (
              <div className="auth-options">
                <label className="auth-remember">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span>Zapamti moju prijavu (7 dana)</span>
                </label>
                <Link to="/forgot-password" className="auth-text-link">Zaboravili ste lozinku?</Link>
              </div>
            ) : (
              <label className="auth-remember auth-terms">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onClick={handleTermsCheckboxClick}
                  onChange={(event) => {
                    // Označavanje je moguće samo kroz modal; odklikom ga i dalje skidamo.
                    if (!event.target.checked) setAcceptedTerms(false);
                  }}
                  readOnly={false}
                />
                <span>
                  Slažem se sa <Link to="/terms" className="auth-text-link">uslovima korišćenja</Link> i{' '}
                  <Link to="/privacy" className="auth-text-link">politikom privatnosti</Link> — prihvatam pravila
                  zajednice i pravne uslove NEXUS portala.
                </span>
              </label>
            )}

            {!isLogin && (
              <label className="auth-remember auth-terms">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                />
                <span>Imam najmanje 15 godina ili imam saglasnost roditelja/staratelja.</span>
              </label>
            )}

            <CaptchaBox enabled={requiresCaptcha} siteKey={authConfig.siteKey} onToken={setCaptchaToken} resetKey={captchaKey} />

            <button
              className={`auth-submit ${loading ? 'is-loading' : ''}`}
              type="submit"
              disabled={loading || (!isLogin && (!acceptedTerms || !ageConfirmed))}
            >
              {loading ? <Loader2 size={16} className="auth-submit-spinner" /> : null}
              <span>{loading ? (isLogin ? 'Prijavljivanje...' : 'Kreiranje naloga...') : (isLogin ? 'Prijavi se' : 'Kreiraj nalog')}</span>
              {!loading && <ArrowRight size={16} />}
            </button>

            {!isLogin && !acceptedTerms && (
              <p className="auth-field-hint is-bad">
                Registracija je onemogućena dok ne prihvatite uslove korišćenja i politiku privatnosti.
              </p>
            )}
            {!isLogin && acceptedTerms && !ageConfirmed && (
              <p className="auth-field-hint is-bad">Potvrdite da imate najmanje 15 godina.</p>
            )}
          </form>
          )}

          {/* F-34 — OAuth prijava (Discord/Steam/Google) */}
          {!mfaTicket && (
            <OAuthButtons providers={authConfig.oauthProviders} mode="login" />
          )}

          <p className="auth-switch-note">
            {isLogin ? (
              <>
                Nemate nalog?{' '}
                <button type="button" className="auth-text-link auth-inline-btn" onClick={() => switchMode('register')}>
                  Registrujte se besplatno
                </button>
              </>
            ) : (
              <>
                Već imate nalog?{' '}
                <button type="button" className="auth-text-link auth-inline-btn" onClick={() => switchMode('login')}>
                  Prijavite se
                </button>
              </>
            )}
          </p>

          {isLogin && (
            <p className="auth-admin-note">
              <Shield size={13} />
              Administrator ste?{' '}
              <Link to="/admin" className="auth-admin-link">Prijava za CMS Admin Panel</Link>
            </p>
          )}
        </div>
        </section>
      </div>

      <TermsModal open={termsModalOpen} onAccept={acceptTermsFromModal} onClose={() => setTermsModalOpen(false)} />
    </div>
  );
}
