import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

/**
 * 5.2 — TRAJNI BANNER „POTVRDI EMAIL“.
 *
 * Registracija odmah izdaje sesiju (`verificationRequired`), pa je ranije
 * jedina opomena bio jednokratni ekran posle registracije — lako se propusti.
 * Ovaj banner stoji dok nalog nije verifikovan i nudi ponovno slanje (server
 * ima cooldown od 30 s, pa dugme ne može da bude spam mašina).
 *
 * Sakriven je na auth stranama (tamo je već kontekst) i ne blokira UI.
 */
const DISMISS_KEY = 'nexus.verifyBanner.dismissedAt';
/** Ponovo prikaži posle 12h — „ne danas“ nije „nikad“. */
const DISMISS_TTL_MS = 12 * 60 * 60 * 1000;

export function EmailVerificationBanner() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const updateUser = useAuthStore((state) => state.updateUser);

  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setHidden(Boolean(at) && Date.now() - at < DISMISS_TTL_MS);
    } catch {
      setHidden(false);
    }
  }, []);

  if (!isAuthenticated || !user || hidden) return null;
  // `isVerified` je u `OwnerUser`; stariji keš možda nema polje — tada ne smetamo.
  if (user.isVerified !== false) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Bez storage-a banner se vraća na sledećem reload-u — prihvatljivo.
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.auth.resendVerification();
      setSent(true);
    } catch (err: any) {
      if (err?.code === 'ALREADY_VERIFIED') {
        updateUser({ isVerified: true });
        return;
      }
      setError(err?.message ?? 'Slanje nije uspelo. Pokušajte ponovo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verify-banner" role="status" aria-live="polite">
      <Mail size={15} className="verify-banner-icon" />
      <div className="verify-banner-text">
        {sent ? (
          <span>
            <CheckCircle2 size={13} /> Poslali smo novi link na <strong>{user.email}</strong>. Proverite i spam
            folder.
          </span>
        ) : (
          <span>
            Potvrdite email adresu (<strong>{user.email}</strong>) da biste mogli da pišete teme, odgovore i
            privatne poruke. Poruka bota sa uputstvom je u vašim notifikacijama.
          </span>
        )}
        {error && <span className="verify-banner-error">{error}</span>}
      </div>
      {!sent && (
        <button type="button" className="verify-banner-btn" onClick={resend} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          Pošalji link
        </button>
      )}
      <button type="button" className="verify-banner-close" onClick={dismiss} aria-label="Sakrij obaveštenje">
        <X size={14} />
      </button>
    </div>
  );
}
