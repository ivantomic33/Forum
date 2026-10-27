import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  QrCode,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { SettingsSection, SettingsDivider } from './SettingsSection';

/**
 * F-33 — Sigurnost naloga u podešavanjima profila.
 *
 * Tok uključivanja:
 *  1. `/2fa/setup` → QR kod (data URL) + tajna za ručni unos;
 *  2. korisnik skenira i unosi prvi kod → `/2fa/enable`;
 *  3. server vraća 10 recovery kodova — prikazuju se SAMO jednom.
 * Isključivanje traži lozinku i važeći kod.
 */
type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; lockedUntil: string | null };

/** F-15 — zapamćeni uređaj (bez hash-eva). */
type TrustedDevice = {
  id: string;
  deviceId: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

/** `Chrome · Windows` iz User-Agent-a — dovoljno da korisnik prepozna uređaj. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Nepoznat uređaj';
  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
      : /OPR\//.test(userAgent) ? 'Opera'
        : /Firefox\//.test(userAgent) ? 'Firefox'
          : /Chrome\//.test(userAgent) ? 'Chrome'
            : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(userAgent) ? 'Windows'
      : /iPhone|iPad/.test(userAgent) ? 'iOS'
        : /Android/.test(userAgent) ? 'Android'
          : /Mac OS X/.test(userAgent) ? 'macOS'
            : /Linux/.test(userAgent) ? 'Linux' : 'Nepoznat OS';
  return `${browser} · ${os}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ui-btn br-secondary ui-btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error('Kopiranje nije uspelo — označite tekst ručno.');
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Kopirano' : label}
    </button>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-200">
        <AlertTriangle size={14} /> Sačuvajte ove kodove sada — više se neće prikazati.
      </p>
      <p className="text-xs leading-relaxed text-white/60">
        Svaki kod se može iskoristiti samo jednom, ako izgubite pristup autentifikacionoj aplikaciji.
      </p>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[12px] text-white/85">
        {codes.map((code) => (
          <span key={code} className="rounded bg-black/30 px-2 py-1 tracking-wide">
            {code}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join('\n')} label="Kopiraj sve" />
        <button
          type="button"
          className="ui-btn br-secondary ui-btn-sm"
          onClick={() => {
            const blob = new Blob([`NEXUS recovery kodovi\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'nexus-recovery-kodovi.txt';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Preuzmi .txt
        </button>
        <button type="button" className="ui-btn br-primary ui-btn-sm" onClick={onDone}>
          Sačuvao sam kodove
        </button>
      </div>
    </div>
  );
}

export function AccountSecuritySection() {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'setup' | 'enable' | 'disable' | 'recovery' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Uključivanje
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);

  // Isključivanje
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // F-15 — trusted uređaji
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [ttlDays, setTtlDays] = useState(30);
  const [devicesBusy, setDevicesBusy] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const res = await api.auth.twoFactor.devices();
      setDevices(res.devices);
      setCurrentDeviceId(res.currentDeviceId);
      setTtlDays(res.ttlDays || 30);
    } catch {
      // Tabela još ne postoji (`schema-ALL.sql` nije pušten) — sekcija se skriva.
      setDevices([]);
    }
  }, []);

  const forgetDevice = async (deviceId: string) => {
    setDevicesBusy(true);
    try {
      await api.auth.twoFactor.forgetDevice(deviceId);
      setDevices((list) => list.filter((device) => device.deviceId !== deviceId));
      toast.success('Uređaj više neće preskakati 2FA.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Uređaj nije mogao da se ukloni.');
    } finally {
      setDevicesBusy(false);
    }
  };

  const forgetAllDevices = async () => {
    setDevicesBusy(true);
    try {
      const res = await api.auth.twoFactor.forgetAllDevices();
      setDevices([]);
      toast.success(res.removed > 0 ? `Zaboravljeno uređaja: ${res.removed}.` : 'Nema zapamćenih uređaja.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Uređaji nisu mogli da se uklone.');
    } finally {
      setDevicesBusy(false);
    }
  };

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.auth.twoFactor.status());
    } catch (err: any) {
      setError(err?.message ?? 'Status 2FA nije dostupan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    void loadDevices();
  }, [loadStatus, loadDevices]);

  const beginSetup = async () => {
    setError(null);
    setBusy('setup');
    try {
      const res = await api.auth.twoFactor.setup();
      setSetup({ secret: res.secret, qrCode: res.qrCode });
      setConfirmCode('');
    } catch (err: any) {
      setError(err?.message ?? 'Generisanje QR koda nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  const enable = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy('enable');
    try {
      const res = await api.auth.twoFactor.enable(confirmCode.trim());
      setNewRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setConfirmCode('');
      await loadStatus();
      toast.success('Dvofaktorska autentifikacija je uključena.');
    } catch (err: any) {
      setError(err?.message ?? 'Uključivanje nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  const disable = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy('disable');
    try {
      await api.auth.twoFactor.disable(disablePassword, disableCode.trim());
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      setNewRecoveryCodes(null);
      await loadStatus();
      toast.success('2FA je isključena.');
    } catch (err: any) {
      setError(err?.message ?? 'Isključivanje nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy('recovery');
    try {
      const res = await api.auth.twoFactor.regenerateRecoveryCodes(disablePassword);
      setNewRecoveryCodes(res.recoveryCodes);
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } catch (err: any) {
      setError(err?.message ?? 'Generisanje kodova nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection
      icon={<ShieldCheck />}
      title="Dvofaktorska autentifikacija (2FA)"
      description="Uz lozinku se traži i jednokratni kod iz autentifikacione aplikacije. Preporučeno za moderatore i administratore."
      badge={
        !loading && status ? (
          <span
            className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-white/50'
              }`}
          >
            {status.enabled ? 'Uključena' : 'Isključena'}
          </span>
        ) : undefined
      }
    >

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-xs text-white/50">
          <Loader2 size={13} className="animate-spin" /> Učitavanje…
        </p>
      )}

      {/* ---------- Recovery kodovi (svež set) ---------- */}
      {newRecoveryCodes && <RecoveryCodes codes={newRecoveryCodes} onDone={() => setNewRecoveryCodes(null)} />}

      {/* ---------- Uključivanje ---------- */}
      {!loading && status && !status.enabled && !setup && (
        <button
          type="button"
          className="ui-btn br-primary ui-btn-sm"
          onClick={beginSetup}
          disabled={busy !== null}
        >
          {busy === 'setup' ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
          Uključi 2FA
        </button>
      )}

      {setup && (
        <form onSubmit={enable} className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3">
          <div className="flex flex-col gap-4 sm:flex-row">
            <img
              src={setup.qrCode}
              alt="QR kod za autentifikacionu aplikaciju"
              width={160}
              height={160}
              className="h-40 w-40 flex-shrink-0 self-center rounded-md bg-white p-1.5"
            />
            <div className="space-y-2 text-xs text-white/60">
              <p className="flex items-center gap-2 font-semibold text-white/85">
                <Smartphone size={14} /> 1. Skenirajte QR kod
              </p>
              <p>2. Unesite 6-cifreni kod koji aplikacija prikaže.</p>
              <p className="flex items-center gap-2 pt-1 font-semibold text-white/85">
                <KeyRound size={14} /> Ne možete da skenirate?
              </p>
              <p className="break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/75">
                {setup.secret}
              </p>
              <CopyButton value={setup.secret} label="Kopiraj tajnu" />
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-white/70">Kod iz aplikacije</span>
            <input
              type="text"
              value={confirmCode}
              onChange={(event) => setConfirmCode(event.target.value)}
              placeholder="123 456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              className="ui-field max-w-40 font-mono tracking-widest"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="ui-btn br-primary ui-btn-sm" disabled={busy !== null}>
              {busy === 'enable' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Potvrdi i uključi
            </button>
            <button
              type="button"
              className="ui-btn br-secondary ui-btn-sm"
              onClick={() => {
                setSetup(null);
                setConfirmCode('');
                setError(null);
              }}
            >
              Otkaži
            </button>
          </div>
        </form>
      )}

      {/* ---------- Uključena: status + upravljanje ---------- */}
      {!loading && status?.enabled && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <p className="text-xs text-white/55">
            Preostalih recovery kodova: <strong className="text-white/85">{status.recoveryCodesLeft}</strong>
            {status.enabledAt && ` · uključena ${new Date(status.enabledAt).toLocaleDateString('sr-RS')}`}
          </p>
          {status.recoveryCodesLeft <= 2 && (
            <p className="text-xs text-amber-300">Obnovite recovery kodove pre nego što ostanete bez njih.</p>
          )}

          {!disableOpen ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-btn br-secondary ui-btn-sm"
                onClick={() => setDisableOpen(true)}
              >
                <KeyRound size={14} /> Obnovi recovery kodove
              </button>
              <button
                type="button"
                className="ui-btn br-secondary ui-btn-sm text-red-300"
                onClick={() => setDisableOpen(true)}
              >
                <ShieldOff size={14} /> Isključi 2FA
              </button>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-white/60">
                Potvrdite lozinkom. Za obnavljanje kodova dovoljna je lozinka; za isključivanje je potreban i
                6-cifreni kod (ili recovery kod).
              </p>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">Lozinka</span>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                  autoComplete="current-password"
                  className="ui-field max-w-64"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-white/70">Kod iz aplikacije (samo za isključivanje)</span>
                <input
                  type="text"
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value)}
                  placeholder="123 456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="ui-field max-w-40 font-mono tracking-widest"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ui-btn br-secondary ui-btn-sm"
                  disabled={busy !== null || !disablePassword}
                  onClick={regenerate}
                >
                  {busy === 'recovery' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  Obnovi kodove
                </button>
                <button
                  type="button"
                  className="ui-btn br-secondary ui-btn-sm text-red-300"
                  disabled={busy !== null || !disablePassword || !disableCode}
                  onClick={disable}
                >
                  {busy === 'disable' ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                  Isključi 2FA
                </button>
                <button
                  type="button"
                  className="ui-btn br-secondary ui-btn-sm"
                  onClick={() => {
                    setDisableOpen(false);
                    setDisablePassword('');
                    setDisableCode('');
                    setError(null);
                  }}
                >
                  Otkaži
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- F-15 — zapamćeni uređaji ---------- */}
      {!loading && status?.enabled && (
        <>
          <SettingsDivider />
          <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold text-white/80">
                <MonitorSmartphone size={14} /> {t('security.trustedDevicesCount', { count: devices.length })}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t('security.trustedDevicesHint', { days: ttlDays })}
              </p>
            </div>
            {devices.length > 0 && (
              <button
                type="button"
                className="ui-btn br-ghost ui-btn-sm text-red-300"
                disabled={devicesBusy}
                onClick={forgetAllDevices}
              >
                {devicesBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Zaboravi sve
              </button>
            )}
          </div>

          {devices.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('security.noTrustedDevices')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {devices.map((device) => (
                <li
                  key={device.deviceId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border-white/5 bg-white/[0.03] px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white/85">
                      {describeDevice(device.userAgent)}
                      {device.deviceId === currentDeviceId && (
                        <span className="ml-2 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                          {t('security.thisDevice')}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      {t('security.lastLogin')}: {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleDateString('sr-Latn-RS') : '—'}
                      {' · '}{t('security.validUntil')}: {new Date(device.expiresAt).toLocaleDateString('sr-Latn-RS')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ui-btn br-ghost ui-btn-sm"
                    disabled={devicesBusy}
                    onClick={() => forgetDevice(device.deviceId)}
                    aria-label={`Zaboravi uređaj ${describeDevice(device.userAgent)}`}
                  >
                    <Trash2 size={13} /> {t('security.forgetDevice')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
      )}
    </SettingsSection>
  );
}
