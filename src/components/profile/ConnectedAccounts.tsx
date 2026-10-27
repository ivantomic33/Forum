import { useEffect, useState } from 'react';
import { Check, Link2, Loader2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Card, CardHeader } from '../ui';
import { api } from '../../lib/api';
import { GAMING_PLATFORMS } from './constants';

/** Provajderi koji mogu i da se povežu za prijavu (F-34). */
const OAUTH_PROVIDERS: Record<string, { name: string; accent: string }> = {
  discord: { name: 'Discord', accent: '#5865F2' },
  google: { name: 'Google', accent: '#ea4335' },
  steam: { name: 'Steam', accent: '#66c0f4' },
};

/**
 * F-34 — povezani OAuth identiteti (prijava jednim klikom).
 * Za razliku od ručnih "gaming naloga" ispod, ovi su stvarno potvrđeni kod
 * provajdera i mogu se koristiti za prijavu.
 */
function LoginConnections() {
  const [accounts, setAccounts] = useState<Array<{ provider: string; username: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.auth
      .oauthAccounts()
      .then((res) => setAccounts(res.accounts))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const unlink = async (provider: string) => {
    setBusy(provider);
    try {
      await api.auth.oauthUnlink(provider);
      setAccounts((prev) => prev.filter((entry) => entry.provider !== provider));
      toast.success(`${OAUTH_PROVIDERS[provider]?.name ?? provider} je otkačen.`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Otkačivanje nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  const linked = new Set(accounts.map((entry) => entry.provider));

  return (
    <div className="mb-4 space-y-2 rounded-md border border-white/[0.07] bg-black/20 p-3">
      <p className="text-xs font-semibold text-white/80">Prijava preko provajdera</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {Object.entries(OAUTH_PROVIDERS).map(([provider, meta]) => {
          const account = accounts.find((entry) => entry.provider === provider);
          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-2 rounded border border-white/[0.06] px-2.5 py-2"
              style={{ '--tile-accent': meta.accent } as React.CSSProperties}
            >
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white/85">{meta.name}</div>
                <div className="truncate text-[11px] text-white/45">
                  {account ? account.username ?? 'povezano' : 'nije povezano'}
                </div>
              </div>
              {account ? (
                <button
                  type="button"
                  onClick={() => unlink(provider)}
                  disabled={busy === provider}
                  className="account-disconnect-btn rounded p-1.5 text-white/35 transition hover:bg-white/[0.05]"
                  aria-label={`Otkači ${meta.name}`}
                >
                  {busy === provider ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
                </button>
              ) : (
                <a
                  href={api.auth.oauthStartUrl(provider, { mode: 'link' })}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:text-white/80"
                >
                  <Link2 size={12} /> Poveži
                </a>
              )}
            </div>
          );
        })}
      </div>
      {loading && <p className="text-[11px] text-white/40">Učitavanje…</p>}
      {!loading && linked.size === 0 && (
        <p className="text-[11px] text-white/40">Poveži provajder da bi sledeći put mogao da se prijaviš jednim klikom.</p>
      )}
    </div>
  );
}

/** Mreža povezanih gaming platformi sa povezivanjem/otkačinjanjem. */
export function ConnectedAccounts({
  accounts,
  isOwner,
  onConnect,
  onDisconnect,
}: {
  accounts: Record<string, string>;
  isOwner: boolean;
  onConnect: (platformId: string) => void;
  onDisconnect: (platformId: string) => void;
}) {
  const connectedCount = Object.keys(accounts).length;

  return (
    <Card variant="static">
      <CardHeader
        title="Povezane gaming platforme"
        subtitle="Prikaži svoj profil i ID sa omiljenih gejming servisa."
        action={
          <Badge tone="primary">
            {connectedCount} / {GAMING_PLATFORMS.length}
          </Badge>
        }
      />
      {isOwner && <LoginConnections />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {GAMING_PLATFORMS.map((platform) => {
          const value = accounts[platform.id];
          const connected = Boolean(value);
          return (
            <div
              key={platform.id}
              className={`profile-platform-tile flex flex-col justify-between ${connected ? 'is-connected' : ''}`}
              style={{ '--tile-accent': platform.accent } as React.CSSProperties}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="profile-platform-icon">{platform.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-white">{platform.name}</div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{platform.tag}</span>
                  </div>
                </div>
                {connected && isOwner && (
                  <button
                    type="button"
                    onClick={() => onDisconnect(platform.id)}
                    className="account-disconnect-btn rounded p-1.5 text-white/35 transition hover:bg-white/[0.05]"
                    aria-label={`Otkači ${platform.name}`}
                    title={`Otkači ${platform.name}`}
                  >
                    <Unlink size={13} />
                  </button>
                )}
              </div>
              <div className="flex items-center border-t border-white/[0.06] pt-2.5">
                {connected ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <Check size={13} className="flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{value}</span>
                  </span>
                ) : isOwner ? (
                  <button
                    type="button"
                    onClick={() => onConnect(platform.id)}
                    className="account-connect-btn ui-btn br-secondary ui-btn-sm w-full min-h-0 px-2.5 py-1.5 text-xs"
                  >
                    + Poveži nalog
                  </button>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">Nije povezano</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
