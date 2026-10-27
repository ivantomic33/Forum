import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsSection } from './SettingsSection';
import {
  describePasskeyError,
  passkeysApi,
  passkeysSupported,
  platformAuthenticatorAvailable,
  registerPasskey,
  type PasskeySummary,
} from '../../lib/passkeys';

/**
 * 5.2 — Passkeys u profilu (Bezbednost).
 *
 * Registracija je dva koraka: server izda `challenge`, autentifikator napravi
 * par ključeva, server verifikuje i sačuva SAMO javni ključ. Privatni ključ
 * ostaje u Touch ID / Windows Hello / telefonu.
 */
export function PasskeysSection() {
  const [supported, setSupported] = useState(() => passkeysSupported());
  const [platform, setPlatform] = useState(false);
  const [items, setItems] = useState<PasskeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await passkeysApi.list();
      setItems(res.data?.passkeys ?? []);
      setError(null);
    } catch (err: any) {
      // Tabela nije puštena (503) — sekcija se prikaže sa uputstvom, ne puca strana.
      setError(err?.message ?? 'Passkeys nisu dostupni.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void platformAuthenticatorAvailable().then(setPlatform);
    if (!passkeysSupported()) setSupported(false);
  }, [load]);

  const add = async () => {
    setBusy('add');
    setError(null);
    try {
      const created = await registerPasskey(name.trim() || 'Passkey');
      setItems((list) => [created, ...list]);
      setName('');
      toast.success('Passkey je dodat — sledeći put se prijavljujete dodirom/prstom.');
    } catch (err: any) {
      const message = err?.name ? describePasskeyError(err) : err?.message ?? 'Dodavanje passkey-a nije uspelo.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Obrisati ovaj passkey? Ako ga izgubite, sledeći put se prijavite lozinkom.')) return;
    setBusy(id);
    try {
      await passkeysApi.remove(id);
      setItems((list) => list.filter((item) => item.id !== id));
      toast.success('Passkey je obrisan.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Brisanje passkey-a nije uspelo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection
      icon={<Fingerprint />}
      title="Passkeys (prijava bez lozinke)"
      description="Prijava dodirom ili PIN-om uređaja umesto lozinke. Ključ ostaje na uređaju, pa ga phishing ne može ukrasti."
      badge={
        items.length > 0 ? (
          <span className="flex-shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            {items.length} {items.length === 1 ? 'uređaj' : 'uređaja'}
          </span>
        ) : undefined
      }
    >

      {!supported && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
          Ovaj browser ne podržava passkey. Otvorite NEXUS u novijem Chrome/Edge/Safari-ju ili na telefonu.
        </p>
      )}

      {supported && platform && (
        <p className="flex items-center gap-2 text-[11px] text-white/45">
          <ShieldCheck size={12} /> Uređaj ima ugrađen autentifikator (Touch ID / Windows Hello).
        </p>
      )}

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

      {!loading && items.length === 0 && supported && (
        <p className="text-xs text-white/50">Još nemate nijedan passkey.</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/70">
                <KeyRound size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white/85">{item.name}</p>
                <p className="mt-0.5 text-[11px] text-white/45">
                  dodat {new Date(item.createdAt).toLocaleDateString('sr-RS')}
                  {item.lastUsedAt ? ` · korišćen ${new Date(item.lastUsedAt).toLocaleDateString('sr-RS')}` : ' · još nije korišćen'}
                </p>
              </div>
              <button
                type="button"
                className="ui-btn br-ghost ui-btn-sm text-red-300"
                disabled={busy !== null}
                onClick={() => remove(item.id)}
                aria-label={`Obriši passkey ${item.name}`}
              >
                {busy === item.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Obriši
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Naziv (npr. Telefon, Laptop)"
            maxLength={60}
            className="ui-field max-w-[220px] text-xs"
          />
          <button type="submit" className="ui-btn br-primary ui-btn-sm" disabled={busy !== null}>
            {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Dodaj passkey
          </button>
        </form>
      )}
    </SettingsSection>
  );
}
