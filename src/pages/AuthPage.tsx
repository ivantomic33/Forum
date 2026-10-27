import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Eye,
  EyeOff,
  Fingerprint,
  Gamepad2,
  KeyRound,
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
import { useT } from '../lib/i18n';
import { useAuthStore } from '../store/authStore';
import { isPasswordValid, passwordError, getPasswordChecks } from '../lib/passwordRules';
import PasswordRequirements from '../components/PasswordRequirements';
import TermsModal from '../components/TermsModal';
import { CaptchaBox, useAuthConfig } from '../components/auth/Turnstile';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { safeNextPath } from '../lib/navigation';
import { TerminalCheckbox } from '../components/auth/TerminalCheckbox';
import { TerminalResponse } from '../components/auth/TerminalResponse';
import {
  lastLoginHint,
  loadAuthPreferences,
  providerLabel,
  rememberLastLogin,
  saveAuthPreferences,
} from '../lib/authPreferences';
import { describeAuthError, type AuthErrorAction } from '../lib/authErrors';
import { describePasskeyError, login2faWithPasskey, loginWithPasskey, passkeysSupported } from '../lib/passkeys';
import type { LoginMethod } from '../lib/authPreferences';

type AuthMode = 'login' | 'register';

/**
 * 5.0 TERMINAL — „boot“ linija koja se otkuca na aside panelu kad se strana
 * učita (mono, caret blink). Čisto dekorativno (aria-hidden na kontejneru).
 */
const BOOT_LINE = '$ nexus --init community ... OK';
const BOOT_MS_PER_CHAR = 28;

/**
 * 5.2 VISUAL — ASCII baner koji se pojavi (fade-in) kada boot linija završi.
 * Dva reda mini-block fonta; `white-space: pre` čuva poravnanje kolona.
 */
const BOOT_ASCII = ['█▄░█ █▀▀ █▀█ █ █ █▀█', '█░▀█ ██▄ █▄█ █▄█ ██▄'];

/**
 * 5.3 VISUAL — „sistem log“ linije ispod ASCII banera. Pojavljuju se uz
 * stagger (CSS animation-delay po `--log-i`). Čisto dekorativno.
 */
const BOOT_LOG = [
{ ok: '✓', label: 'modul: forum', value: 'online' },
{ ok: '✓', label: 'modul: deals', value: 'online' },
{ ok: '✓', label: 'zajednica', value: '1.284 aktivno' },
];

/**
 * 5.4 VISUAL — boot komanda po modu: panel „razlikuje“ prijavu od registracije.
 * Isti mehanizam tipkanja, samo druga komanda.
 */
const BOOT_BY_MODE: Record<AuthMode, string> = {
  login: '$ nexus --auth session ... OK',
  register: '$ nexus --init community ... OK',
};

/**
 * 5.0 TERMINAL — MOTD (message of the day): jedan mono red na dnu forme,
 * bira se nasumično po učitavanju strane (stabilan kroz sesiju forme).
 */
const MOTD_LINES = [
  '// gg danas: 42 nove teme na forumu',
  '// danas 3 nova popusta u deals sekciji',
  '// rang lista se osvezava na svakih 15 min',
  '// savet: koristi 2FA za dodatnu sigurnost',
  '// server: eu-central · ping ~23ms',
];

/** Prednosti prikazane na levom branding panelu (isključivo vizuelno). */
const PERKS = [
  { icon: MessageSquare, title: 'Komentari i diskusije', text: 'Učestvuj u temama i razmeni mišljenje sa gejmerima.' },
  { icon: Gamepad2, title: 'Prilagođen gejming profil', text: 'Sačuvaj vesti, prati omiljene igre i svoj napredak.' },
  { icon: BadgeCheck, title: 'Nivoi i reputacija', text: 'Skupljaj poene, osvajaj značke i penji se na rang listi.' },
] as const;

export default function AuthPage({ initialMode }: { initialMode: AuthMode }) {
  const t = useT();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // 5.4 — izbor „zapamti me“ preživljava reload; gost ga ne nasleđuje ako ga nikad nije menjao.
  const [prefs, setPrefs] = useState(() => loadAuthPreferences());
  const [remember, setRemember] = useState(prefs.rememberMe);
  // 5.5 — poslednji uspešan način prijave (npr. Discord) za pametne hintove.
  const [lastLogin, setLastLogin] = useState(() => loadAuthPreferences().lastLogin);
  // 5.1 — podrška za passkey (samo ako browser ima WebAuthn).
  const passkeyAvailable = passkeysSupported();
  // 5.2 — „zapamti ovaj uređaj“ u 2FA koraku (server već podržava `trustDevice`).
  const [trustDevice, setTrustDevice] = useState(true);
  // 5.3 — akcija za grešku (OAuth-only nalog, rate limit, ban) umesto samo teksta.
  const [errorAction, setErrorAction] = useState<AuthErrorAction | null>(null);
  // F-01 — Caps Lock upozorenje na polju lozinke.
  const [capsLock, setCapsLock] = useState(false);
  // 5.3 — povezani provajderi iz konfiguracije za grešku „koristi OAuth“.
  const [oauthProvidersList, setOauthProvidersList] = useState<string[]>([]);
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

  /** 5.4 — pamti izbor „zapamti me“ (browser, ne server). */
  const toggleRemember = (value: boolean) => {
    setRemember(value);
    const next = { ...prefs, rememberMe: value };
    setPrefs(next);
    saveAuthPreferences(next);
  };
  // F-33 — 2FA izazov posle tačne lozinke.
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaInfo, setMfaInfo] = useState<{ username: string; recoveryCodesLeft: number; passkeyOptions?: Record<string, any> } | null>(null);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const isLogin = mode === 'login';
  const requiresCaptcha = authConfig.enabled && authConfig.siteKey.length > 0;

  useEffect(() => {
    setOauthProvidersList(authConfig.oauthProviders ?? []);
  }, [authConfig.oauthProviders]);

  /*
   * 5.0 TERMINAL — snaga lozinke kao ASCII progress bar.
   * Prazno: [░░] STANJE: ---  ·  slabo: [███░░░] SLABO  ·  jako: [██████] JAKO.
   * Dužina je TACNO 10 blokova (10 `█` + preostali `░`), pa se bar ne pomera
   * dok korisnik kuca. Boja dolazi iz `data-level` u CSS-u.
   */
  const checks = isLogin ? [] : getPasswordChecks(password);
  const okCount = checks.filter((check) => check.ok).length;
  const filled = password.length === 0 ? 0 : Math.round((okCount / Math.max(checks.length, 1)) * 10);
  const strengthBar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  const strengthLabel =
    password.length === 0 ? 'STANJE: ---' : filled <= 3 ? 'SLABO' : filled <= 7 ? 'DOBRO' : 'JAKO';
  const strengthLevel = password.length === 0 ? 'empty' : filled <= 3 ? 'weak' : filled <= 7 ? 'good' : 'strong';

  // Blur pozadine dok je auth overlay otvoren — skrol strane ostaje dozvoljen.
  useEffect(() => {
    document.documentElement.classList.add('auth-overlay-open');
    return () => {
      document.documentElement.classList.remove('auth-overlay-open');
    };
  }, []);

  // 5.0 TERMINAL — tipkajuća boot linija (staje na kraj, kursor treperi u CSS-u).
  // 5.4 VISUAL — komanda zavisi od moda (prijava/registracija); promena moda
  // resetuje tipkanje i boot se „ponovo otkuca“ sa novom komandom.
  const bootLine = BOOT_BY_MODE[mode];
  const [bootCount, setBootCount] = useState(0);
  useEffect(() => {
    setBootCount(0);
  }, [mode]);
  useEffect(() => {
    if (bootCount >= bootLine.length) return;
    const timer = setTimeout(() => setBootCount((count) => count + 1), BOOT_MS_PER_CHAR);
    return () => clearTimeout(timer);
  }, [bootCount, bootLine]);

  // 5.4 VISUAL — kucajući sat u title baru boot prozora (realno vreme, 1s tick).
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('sr-RS', { hour12: false }));
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date().toLocaleTimeString('sr-RS', { hour12: false })), 1000);
    return () => clearInterval(timer);
  }, []);

  // 5.5 VISUAL — broj aktivnih članova u log liniji „živi“: ±1 random na 8–15s.
  const [memberCount, setMemberCount] = useState(1284);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setMemberCount((count) => count + (Math.random() < 0.5 ? -1 : 1));
      timer = setTimeout(tick, 8000 + Math.random() * 7000);
    };
    timer = setTimeout(tick, 9000);
    return () => clearTimeout(timer);
  }, []);

  // 5.0 TERMINAL — MOTD red (jedan nasumičan po mountu).
  const [motd] = useState(() => MOTD_LINES[Math.floor(Math.random() * MOTD_LINES.length)]);

  /*
   * 5.2 VISUAL — boot linija je gotova: caret ostaje upaljen („trag“) i na
   * panel se, uz fade-in, ispiše ASCII baner. Čisto dekorativno.
   */
  const bootDone = bootCount >= bootLine.length;

  /*
   * 5.2 VISUAL — progress header registracije: koliko koraka forme je popunjeno.
   * Šest tačaka: korisničko ime, email, lozinka, potvrda, uslovi, uzrast.
   * Vizuelna nagrada za napredak — bez ikakve logike validacije (ona postoji).
   */
  const regStepsDone = [
    username.trim().length >= 3,
    email.includes('@') && email.includes('.'),
    password.length >= 8,
    confirmPassword.length > 0 && confirmPassword === password,
    acceptedTerms,
    ageConfirmed,
  ].filter(Boolean).length;
  const regStepsTotal = 6;
  const regBar = `${'█'.repeat(regStepsDone)}${'░'.repeat(Math.max(regStepsTotal - regStepsDone, 0))}`;

  /* 5.2 VISUAL — uspešna registracija: dugme na trenutak pokaže `exit 0`. */
  const [registeredOk, setRegisteredOk] = useState(false);

  /* 5.4 VISUAL — glitch flash na formi kad greška padne (kratko, samo dekorativno). */
  const [glitchOn, setGlitchOn] = useState(false);

  /*
   * 5.6 VISUAL — uspeh overlay: full-screen „terminal potvrda" pre redirect-a.
   *   login       → `✓ sesija uspostavljena` (1.1s)
   *   registracija → `provisioning` sa ASCII barom (1.6s)
   * Redovi se otkrivaju jedan po jedan (CSS stagger preko --line-i).
   */
  const [sessionOverlay, setSessionOverlay] = useState<{ lines: string[]; kind: 'session' | 'provisioning' } | null>(null);

  /* 5.7 VISUAL — smooth prelaz login ↔ register: forma blaga fade-out/in. */
  const [switching, setSwitching] = useState(false);

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

  /** 5.5 — beleži način prijave i prikaže dobitak XP-a iz streak-a. */
  const afterLogin = (method: LoginMethod, bonus: { xp: number; streak: number } | null) => {
    const next = rememberLastLogin(method, undefined);
    setLastLogin(next);
    if (bonus && bonus.xp > 0) {
      // Kratko obaveštenje pre navigacije; toast sistem preživi route change.
      import('sonner')
        .then(({ toast }) => toast.success(`Dobrodošli nazad! +${bonus.xp} XP (streak ${bonus.streak} dana)`))
        .catch(() => {});
    }
  };

  /** 5.2 — prijava passkey-om (bez lozinke i bez email-a). */
  const submitPasskey = async () => {
    setError(null);
    setErrorAction(null);
    setLoading(true);
    try {
      const response = await loginWithPasskey();
      login(response.user as any, remember);
      afterLogin('passkey', null);
      navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
    } catch (err: any) {
      const info = describeAuthError(err, 'Prijava passkey-om nije uspela.');
      const message = err?.name ? describePasskeyError(err) : info.message;
      setError(message);
      setErrorAction(info.action);
    } finally {
      setLoading(false);
    }
  };

  /** 5.2 — passkey kao drugi faktor u 2FA koraku (umesto koda). */
  const submitMfaPasskey = async () => {
    if (!mfaTicket || !mfaInfo?.passkeyOptions) return;
    setError(null);
    setLoading(true);
    try {
      const response = await login2faWithPasskey(mfaTicket, mfaInfo.passkeyOptions);
      login(response.user as any, remember);
      afterLogin('passkey', null);
      navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
    } catch (err: any) {
      setError(err?.name ? describePasskeyError(err) : err?.message ?? 'Prijava passkey-om nije uspela.');
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setErrorAction(null);

    if (!isLogin) {
      if (!acceptedTerms) {
        setError(t('auth.termsRequired'));
        return;
      }
      if (!ageConfirmed) {
        setError(t('auth.ageConfirm'));
        return;
      }
      if (!isPasswordValid(password)) {
        setError(passwordError(password) ?? t('auth.passwordWeak'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('auth.passwordsMismatch'));
        return;
      }
      if (usernameAvailable === false) {
        setError(t('auth.usernameTaken'));
        return;
      }
      if (emailStatus && !emailStatus.available) {
        setError(
          emailStatus.reason === 'disposable'
            ? 'Privremene (temp) email adrese nisu dozvoljene. Koristite pravu email adresu.'
            : t('auth.emailTaken')
        );
        return;
      }
    }

    if (requiresCaptcha && !captchaToken) {
      setError(t('auth.captchaWait'));
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
          trustDevice,
        });
        if ('requires2fa' in response) {
          // Lozinka je tačna — tražimo kod iz aplikacije (bez izdavanja sesije).
          setMfaTicket(response.mfaTicket);
          setMfaInfo({
            username: response.username,
            recoveryCodesLeft: response.recoveryCodesLeft,
            passkeyOptions: (response as any).passkeyOptions ?? undefined,
          });
          resetCaptcha();
          setPassword('');
          return;
        }
        login(response.user, remember);
        afterLogin('password', response.loginBonus ?? null);
        // 5.6 VISUAL — „session start“ overlay: terminal potvrda pre redirect-a.
        setSessionOverlay({
          lines: ['✓ login potvrđen', '✓ sesija uspostavljena', '$ redirecting ...'],
          kind: 'session',
        });
        await new Promise((resolve) => setTimeout(resolve, 1100));
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
        rememberLastLogin('password', response.user.username);
        // 5.6 VISUAL — „provisioning“ overlay: profil se pravi u terminal stilu.
        setSessionOverlay({
          lines: [
            '✓ nalog kreiran',
            '$ provisioning profile...',
            '[██████████████] 100%',
            '✓ nalog spreman',
          ],
          kind: 'provisioning',
        });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
      }
    } catch (err: any) {
      const info = describeAuthError(err, isLogin ? t('auth.loginFailed') : t('auth.registerFailed'));
      setError(info.message);
      setErrorAction(info.action);
      // 5.4 VISUAL — kratki glitch flash forme kad greška padne (CSS keyframe).
      setGlitchOn(true);
      window.setTimeout(() => setGlitchOn(false), 320);
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
      setError(t('auth.captchaWait'));
      return;
    }

    setLoading(true);
    try {
      const response = await api.auth.login2fa({
        mfaTicket,
        code: mfaCode,
        rememberMe: remember,
        captchaToken,
        trustDevice,
      });
      login(response.user, remember);
      afterLogin('password', (response as any).loginBonus ?? null);
      navigate(safeNextPath(searchParams.get('next') ?? (location.state as any)?.from), { replace: true });
    } catch (err: any) {
      const info = describeAuthError(err, t('auth.totpInvalid'));
      setError(info.message);
      setErrorAction(info.action);
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
    if (nextMode === mode) return;
    // 5.7 VISUAL — smooth tranzicija: forma fade-out (200ms), sadržaj se menja,
    // pa fade-in. CSS animacija se okida preko data-switch atributa na kartici.
    setSwitching(true);
    window.setTimeout(() => {
      setMode(nextMode);
      setError(null);
      setPassword('');
      setConfirmPassword('');
      setUsernameAvailable(null);
      setEmailStatus(null);
      resetCaptcha();
      cancelMfa();
      setSwitching(false);
      navigate(nextMode === 'login' ? '/login' : '/register', { replace: true });
    }, 200);
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
        {/* 5.2 VISUAL — zvezdice na pozadini forme: čisto dekorativni plutajuci
            delići (CSS keyframes, bez JS-a). aria-hidden na roditelju već važi. */}
        <div className="auth-stars">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ '--star-i': i } as React.CSSProperties} />
          ))}
        </div>
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

            {/* 5.0 TERMINAL — boot linija kao pravi prozor:
                title-bar `nexus@auth:~` + tri tačkice + tipkajuća komanda. */}
            <div className="auth-boot" aria-hidden="true">
              <div className="auth-boot-bar">
                <span className="auth-boot-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="auth-boot-title">nexus@auth:~</span>
                {/* 5.4 VISUAL — kucajući sat desno u title baru. */}
                <span className="auth-boot-clock" aria-hidden="true">{clock}</span>
              </div>
              <div className="auth-boot-body">
                <span className="auth-boot-text">{bootLine.slice(0, bootCount)}</span>
                {/* Caret ostaje upaljen i posle gotove linije — „trag“ u konzoli. */}
                <span className="auth-boot-caret" data-done={bootDone ? 'true' : 'false'} />
              </div>
              {bootDone && (
                <div className="auth-boot-ascii">
                  {BOOT_ASCII.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              )}

              {/* 5.3 VISUAL — „sistem log“: redovi se pojave jedan po jedan posle
                  boot linije (CSS animation-delay, bez JS). Čisto dekorativno. */}
              {bootDone && (
                <div className="auth-boot-log" aria-hidden="true">
                  {BOOT_LOG.map((log, index) => (
                    <span key={log.label} className="auth-log-line" style={{ '--log-i': index } as React.CSSProperties}>
                      <em>{log.ok}</em> {log.label}{' '}
                      <strong data-tick={log.label === 'zajednica' ? 'true' : undefined}>
                        {log.label === 'zajednica' ? memberCount.toLocaleString('sr-RS') : log.value}
                      </strong>
                      {log.label === 'zajednica' && ' aktivno'}
                    </span>
                  ))}
                </div>
              )}
            </div>

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

        {/* 5.0 TERMINAL — version tag u uglu panela (muted, mono, ne smeta formi).
            5.2 VISUAL — OPEN COMMUNITY dobija live tačkicu (signal "sistem aktuelan"). */}
        <div className="auth-version-corner">
          <span>v5.0.0</span>
          <span>·</span>
          <span>BUILD 2026.10</span>
          <span>·</span>
          <span className="auth-open-badge">
            <i className="auth-open-dot" aria-hidden="true" />
            OPEN COMMUNITY
          </span>
        </div>

        <div className={`auth-card-scroll ${switching ? 'is-switching' : ''}`}>
          <div className="auth-brand-badge">
            <span className="auth-badge-dot" aria-hidden="true" />
            <Sparkles size={12} />
            NEXUS GG COMMUNITY PORTAL
          </div>

          {/* 5.2 VISUAL — progress header forme: koliko je koraka popunjeno.
              Registracija ima 6 koraka; prijava nema (bar se ne prikazuje). */}
          {!isLogin && !mfaTicket && (
            <div className="auth-progress" aria-hidden="true">
              <span className="auth-progress-label">korak {regStepsDone}/{regStepsTotal}</span>
              <span className="auth-progress-bar">[{regBar}]</span>
            </div>
          )}

          <div className="auth-heading">
            <h1 id="auth-title">{isLogin ? 'Dobrodošli nazad' : 'Pridruži se zajednici'}</h1>
            <p>
              {isLogin
                ? t('auth.sideLoginHint')
                : t('auth.sideRegisterHint')}
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
            <div className="auth-error" role="alert" aria-live="assertive" data-code={errorAction?.kind ?? 'message'}>
              {/* 5.0 TERMINAL — mono prefiks `error:` pa poruka; ikona ostaje za skeniranje */}
              {errorAction?.kind === 'banned' ? <Shield size={16} /> : errorAction?.kind === 'rate-limited' ? <Clock size={16} /> : <AlertCircle size={16} />}
              <div className="auth-error-body">
                <span>{error}</span>
                {/* 5.3 — konkretna radnja umesto istog teksta za sve greške */}
                {errorAction?.kind === 'banned' && errorAction.reason && (
                  <span className="auth-error-sub">Razlog: {errorAction.reason}</span>
                )}
                {errorAction?.kind === 'use-oauth' && oauthProvidersList.length > 0 && (
                  <span className="auth-error-actions">
                    {oauthProvidersList
                      .filter((provider) => !errorAction.provider || provider === errorAction.provider)
                      .map((provider) => (
                        <a key={provider} className="auth-text-link" href={api.auth.oauthStartUrl(provider)}>
                          Nastavi preko {providerLabel(provider)}
                        </a>
                      ))}
                  </span>
                )}
                {errorAction?.kind === 'rate-limited' && (
                  <span className="auth-error-sub">
                    Sačekajte{errorAction.retryAfter ? ` ${errorAction.retryAfter} s` : ' nekoliko minuta'} pa pokušajte ponovo.
                  </span>
                )}
                {errorAction?.kind === 'no-account' && isLogin && email.trim() && (
                  <span className="auth-error-actions">
                    <button
                      type="button"
                      className="auth-text-link auth-inline-btn"
                      onClick={() => {
                        switchMode('register');
                      }}
                    >
                      Nemate nalog? Napravite ga sa ovom adresom
                    </button>
                  </span>
                )}
                {errorAction?.kind === 'mfa-expired' && (
                  <span className="auth-error-sub">Unesite lozinku ponovo za novi kod.</span>
                )}
              </div>
            </div>
          )}

          {mfaTicket ? (
            /* F-33 — drugi korak prijave (2FA) */
            <form className={`auth-form ${glitchOn ? 'is-glitch' : ''}`} onSubmit={submitMfa}>
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

              {mfaInfo?.passkeyOptions && passkeyAvailable && (
                <button
                  type="button"
                  className="auth-passkey"
                  disabled={loading}
                  onClick={() => void submitMfaPasskey()}
                >
                  <Fingerprint size={16} />
                  <span>Potvrdi passkey-om (dodir / PIN)</span>
                </button>
              )}

              <TerminalCheckbox checked={remember} onChange={toggleRemember} label="Zapamti moju prijavu (7 dana)" />

              {/* 5.2 — server podržava `trustDevice`, forma ga sada i šalje. */}
              <TerminalCheckbox
                checked={trustDevice}
                onChange={setTrustDevice}
                label="Zapamti ovaj uređaj 30 dana (ne traži kod)"
              />

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
          <form className={`auth-form ${glitchOn ? 'is-glitch' : ''}`} onSubmit={submit}>
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
                {/* 5.0 TERMINAL — odgovor se otkuca kao komandna linija */}
                {username.trim().length >= 3 && (
                  <TerminalResponse
                    command={`> proveravam ${username.trim()}...`}
                    result={
                      usernameAvailable === true
                        ? '✓ SLOBODNO'
                        : usernameAvailable === false
                          ? '✗ ZAUZETO'
                          : null
                    }
                    tone={usernameAvailable === true ? 'ok' : usernameAvailable === false ? 'bad' : 'checking'}
                  />
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
                  autoComplete={isLogin ? 'username' : 'email'}
                  autoFocus={isLogin}
                  required
                />
              </span>
              {/* 5.4 — nova adresa na prijavi: ponudi registraciju umesto slepe greške */}
              {isLogin && errorAction?.kind === 'no-account' && email.trim() && (
                <span className="auth-field-hint">
                  Nema naloga sa ovom adresom?{' '}
                  <button type="button" className="auth-text-link auth-inline-btn" onClick={() => switchMode('register')}>
                    Registrujte se
                  </button>
                </span>
              )}
              {!isLogin && emailStatus && !emailStatus.available && (
                <span className="auth-field-hint is-bad">
                  {emailStatus.reason === 'disposable'
                    ? 'Privremene (temp) email adrese nisu dozvoljene.'
                    : emailStatus.reason === 'taken'
                      ? t('auth.emailTaken')
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
                  placeholder={isLogin ? 'Vaša lozinka' : 'Najmanje 8 karaktera'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  minLength={8}
                  required
                  onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
                  onKeyDown={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
                />
                <button
                  type="button"
                  className="auth-input-action"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
              {capsLock && (
                <span className="auth-field-hint is-warn auth-term-warn">
                  <AlertTriangle size={12} /> [WARN] Caps Lock je uključen.
                </span>
              )}
              {!isLogin && (
                <div className="auth-strength" data-level={strengthLevel} aria-live="polite">
                  <span className="auth-strength-bar" aria-hidden="true">
                    [{strengthBar}]
                  </span>
                  <span className="auth-strength-label">
                    {strengthLabel}
                    {password.length > 0 && <span className="auth-strength-count"> {okCount}/{checks.length}</span>}
                  </span>
                </div>
              )}
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
                <TerminalCheckbox checked={remember} onChange={toggleRemember} label="Zapamti moju prijavu (7 dana)" />
                <Link to="/forgot-password" className="auth-text-link">Zaboravili ste lozinku?</Link>
              </div>
            ) : (
              <TerminalCheckbox
                className="auth-terms-check"
                checked={acceptedTerms}
                onClick={handleTermsCheckboxClick}
                onChange={(checked) => {
                  // Označavanje je moguće samo kroz modal; odklikom ga i dalje skidamo.
                  if (!checked) setAcceptedTerms(false);
                }}
                label={
                  <>
                    Slažem se sa <Link to="/terms" className="auth-text-link">uslovima korišćenja</Link> i{' '}
                    <Link to="/privacy" className="auth-text-link">politikom privatnosti</Link> — prihvatam pravila
                    zajednice i pravne uslove NEXUS portala.
                  </>
                }
              />
            )}

            {!isLogin && (
              <TerminalCheckbox
                className="auth-terms-check"
                checked={ageConfirmed}
                onChange={setAgeConfirmed}
                label="Imam najmanje 15 godina ili imam saglasnost roditelja/staratelja."
              />
            )}

            <CaptchaBox enabled={requiresCaptcha} siteKey={authConfig.siteKey} onToken={setCaptchaToken} resetKey={captchaKey} />

            <button
              className={`auth-submit ${loading ? 'is-loading' : ''} ${registeredOk ? 'is-success' : ''} ${!isLogin && strengthLevel === 'strong' ? 'is-strong' : ''}`}
              type="submit"
              disabled={registeredOk || loading || (!isLogin && (!acceptedTerms || !ageConfirmed))}
            >
              {loading ? <Loader2 size={16} className="auth-submit-spinner" /> : null}
              <span>
                {registeredOk
                  ? '$ kreiraj-nalog ... exit 0 ✓'
                  : loading
                    ? 'izvrsavam...'
                    : isLogin
                      ? '$ prijava --auth'
                      : '$ kreiraj-nalog'}
              </span>
              {!loading && !registeredOk && <ArrowRight size={16} />}
            </button>

            {/* 5.2 — passkey: prijava bez lozinke (samo prijava, ne registracija) */}
            {isLogin && passkeyAvailable && (
              <button type="button" className="auth-passkey" disabled={loading} onClick={() => void submitPasskey()}>
                <Fingerprint size={16} />
                <span>Prijavi se passkey-om</span>
              </button>
            )}

            {/* 5.5 — podsetnik na poslednji način prijave */}
            {isLogin && lastLoginHint(prefs) && (
              <p className="auth-field-hint">
                <KeyRound size={12} /> {lastLoginHint(prefs)}
              </p>
            )}

            {/* 5.0 TERMINAL — blokirana radnja kao `[ERR]` linija, ne „crveni hint“ */}
            {!isLogin && !acceptedTerms && (
              <p className="auth-term-line is-err" role="status">
                <span className="auth-term-tag">ERR</span>
                potvrdite uslove korišćenja
              </p>
            )}
            {!isLogin && acceptedTerms && !ageConfirmed && (
              <p className="auth-term-line is-err" role="status">
                <span className="auth-term-tag">ERR</span>
                potvrdite da imate 15+ godina
              </p>
            )}
            {!isLogin && acceptedTerms && ageConfirmed && (
              <p className="auth-term-line is-ok" role="status">
                <span className="auth-term-tag">OK</span>
                spremno za kreiranje naloga
              </p>
            )}
          </form>
          )}

          {/* F-34 — OAuth prijava (Discord/Steam/Google). 5.5 — ako je poslednja
              prijava bila preko provajdera, on ide prvi i dobija naglasak. */}
          {!mfaTicket && (
            <OAuthButtons
              providers={
                isLogin &&
                lastLogin &&
                ['discord', 'google', 'steam'].includes(lastLogin.method) &&
                authConfig.oauthProviders.includes(lastLogin.method as 'discord' | 'google' | 'steam')
                  ? [
                      lastLogin.method as 'discord' | 'google' | 'steam',
                      ...authConfig.oauthProviders.filter((provider) => provider !== lastLogin.method),
                    ]
                  : authConfig.oauthProviders
              }
              mode="login"
              highlight={
                isLogin && lastLogin && ['discord', 'google', 'steam'].includes(lastLogin.method)
                  ? (lastLogin.method as 'discord' | 'google' | 'steam')
                  : undefined
              }
            />
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

          {/* 5.0 TERMINAL — MOTD: jedan mono red, bira se nasumično po sesiji */}
          <p className="auth-motd" aria-hidden="true">{motd}</p>
        </div>
        </section>
      </div>

      <TermsModal open={termsModalOpen} onAccept={acceptTermsFromModal} onClose={() => setTermsModalOpen(false)} />

      {/* 5.6 VISUAL — uspeh overlay: full-screen terminal potvrda pre redirect-a.
          Redovi se otkrivaju stagger (CSS), caret treperi na poslednjoj liniji.
          Čisto dekorativno (aria-hidden) — redirect obavlja navigacija posle delay-a. */}
      {sessionOverlay && (
        <div className={`auth-session-overlay is-${sessionOverlay.kind}`} aria-hidden="true">
          <div className="auth-session-box">
            <div className="auth-session-bar">
              <span className="auth-boot-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="auth-boot-title">nexus@auth:~</span>
              <span className="auth-boot-clock">{clock}</span>
            </div>
            <div className="auth-session-body">
              {sessionOverlay.lines.map((line, index) => (
                <span key={line} className="auth-session-line" style={{ '--line-i': index } as React.CSSProperties}>
                  {line}
                </span>
              ))}
              <span className="auth-session-caret" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
