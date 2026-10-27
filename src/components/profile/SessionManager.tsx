import { useCallback, useEffect, useState } from 'react';
import { Globe2, Loader2, LogOut, MonitorSmartphone, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

/**
 * 5.1 — Upravljanje aktivnim sesijama (profil → Bezbednost).
 *
 * Server vraća po jedan red po `familyId` (uređaju) — rotacija refresh tokena
 * ostavlja istorijske redove koji nisu žive sesije, pa ih repo filtrira.
 * Tajne se nikad ne šalju: `current` je samo flag za sesiju iz koje je zahtev.
 */
type Session = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
};

/** `Chrome · Windows` iz User-Agent-a — dovoljno da korisnik prepozna uređaj. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Nepoznat uređaj';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Nepoznat OS';
  return `${browser} · ${os}`;
}

const relative = (iso: string | null): string => {
  if (!iso) return 'nepoznato';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'pre trenutak';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `pre ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `pre ${hours} h`;
  return `pre ${Math.floor(hours / 24)} d`;
};

export function SessionManagerSection() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearSession = useAuthStore((state) => state.clearSession);

  const load = useCallback(async () => {
    try {
      const res = await api.auth.sessions();
      setSessions(res.sessions);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Lista sesija nije dostupna.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      const res = await api.auth.revokeSession(id);
      setSessions((list) => list.filter((session) => session.id !== id));
      if (res.current) {
        // Odjavljeni smo i sa ovog uređaja — lokalno stanje mora da se očisti.
        toast.success('Odjavljeni ste sa ovog uređaja.');
        clearSession();
      } else {
        toast.success('Sesija je odjavljena.');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Odjava sesije nije uspela.');
    } finally {
      setBusy(null);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm('Odjaviti se sa svih uređaja, uključujući ovaj?')) return;
    setBusy('all');
    try {
      await api.auth.revokeAllSessions();
      setSessions([]);
      toast.success('Odjavljeni ste sa svih uređaja.');
      clearSession();
    } catch (err: any) {
      toast.error(err?.message ?? 'Odjava sa svih uređaja nije uspela.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection
      icon={<MonitorSmartphone />}
      title="Aktivne sesije"
      description="Uređaji na kojima je nalog prijavljen. Ako neki ne prepoznajete, odjavite ga i promenite lozinku."
      badge={
        sessions.length > 0 ? (
          <button
            type="button"
            className="ui-btn br-ghost ui-btn-sm flex-shrink-0 text-red-300"
            disabled={busy !== null}
            onClick={revokeAll}
          >
            {busy === 'all' ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
            Odjavi sve
          </button>
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

      {!loading && sessions.length === 0 && !error && (
        <p className="text-xs text-white/50">Nema aktivnih sesija.</p>
      )}

      {sessions.length > 0 && (
        <ul className="space-y-1.5">
          {sessions.map((session) => (
            <li
              key={session.id}
              className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${session.current ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/[0.06]' : 'border-white/10 bg-black/20'
                }`}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70">
                {session.current ? <MonitorSmartphone size={15} /> : <Globe2 size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/85">
                  {describeDevice(session.userAgent)}
                  {session.current && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      ovaj uređaj
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-white/45">
                  {session.ip ?? 'nepoznat IP'} · prijava {relative(session.createdAt)} · aktivna{' '}
                  {relative(session.lastUsedAt ?? session.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="ui-btn br-ghost ui-btn-sm"
                disabled={busy !== null}
                onClick={() => revoke(session.id)}
                aria-label="Odjavi ovu sesiju"
              >
                {busy === session.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Odjavi
              </button>
            </li>
          ))}
        </ul>
      )}

      {sessions.length > 1 && (
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-200/80">
          <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
          Vidite uređaj koji ne prepoznajete? Odjavite ga, promenite lozinku i uključite 2FA.
        </p>
      )}
    </SettingsSection>
  );
}
