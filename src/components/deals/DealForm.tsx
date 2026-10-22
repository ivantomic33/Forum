import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gamepad2, Link2, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Game, type IgdbGame } from '../../lib/api';
import { Button, ImageUpload, Modal } from '../ui';
import { CURRENCY_OPTIONS, PLATFORM_OPTIONS, STORE_OPTIONS, formatPrice } from './dealUtils';

interface DealFormProps {
  open: boolean;
  onClose: () => void;
  /** Kada je zadato, igra je fiksirana (Game Page → „Objavi deal“). */
  presetGame?: Pick<Game, 'id' | 'slug' | 'title' | 'coverUrl' | 'releaseDate' | 'igdbId'> | null;
  invalidateKeys?: string[][];
}

const EMPTY = {
  title: '',
  url: '',
  price: '',
  originalPrice: '',
  currency: 'EUR',
  store: 'Steam',
  platform: 'pc',
  description: '',
  expiresAt: '',
  proofUrl: '',
};

const toNumber = (value: string): number => {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  return normalized === '' ? NaN : Number(normalized);
};

/** `datetime-local` → ISO (bez vremenske zone korisnika nema smisla, pa koristimo lokalno vreme). */
const localToIso = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Forma za objavu deal-a.
 *
 * Env: `VITE_IGDB_ENABLED=1` uključuje IGDB pretragu; bez toga pretraga ide
 * kroz lokalni katalog (`/api/games/search`). Server uvek bezbedno vraća
 * praznu IGDB listu ako ključevi nisu postavljeni — forma radi u oba slučaja.
 */
export function DealForm({ open, onClose, presetGame, invalidateKeys = [['deals']] }: DealFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [gameQuery, setGameQuery] = useState('');
  const [selectedGame, setSelectedGame] = useState<{ id?: string; title: string; slug: string; igdb?: IgdbGame } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const igdbEnabled = import.meta.env.VITE_IGDB_ENABLED === '1';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(EMPTY);
    setGameQuery('');
    setSelectedGame(
      presetGame ? { id: presetGame.id, title: presetGame.title, slug: presetGame.slug } : null,
    );
  }, [open, presetGame]);

  const debouncedQuery = useDebounce(gameQuery, 350);

  const gamesQuery = useQuery({
    queryKey: ['games', 'search', debouncedQuery, igdbEnabled],
    queryFn: async () => {
      if (debouncedQuery.trim().length < 2) return [] as Array<{ kind: 'local'; game: Game } | { kind: 'igdb'; game: IgdbGame }>;
      const local = await api.games.search(debouncedQuery).catch(() => ({ games: [] as Game[] }));
      const items: Array<{ kind: 'local'; game: Game } | { kind: 'igdb'; game: IgdbGame }> = local.games.map((game) => ({ kind: 'local', game }));
      const localSlugs = new Set(local.games.map((game) => game.slug));
      if (igdbEnabled) {
        const igdb = await api.games.igdbSearch(debouncedQuery).catch(() => ({ games: [] as IgdbGame[], configured: false }));
        igdb.games.forEach((game) => {
          if (!localSlugs.has(game.slug)) items.push({ kind: 'igdb', game });
        });
      }
      return items.slice(0, 8);
    },
    enabled: open && debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
  });

  const discount = useMemo(() => {
    const price = toNumber(form.price);
    const original = toNumber(form.originalPrice);
    if (!Number.isFinite(price) || !Number.isFinite(original) || original <= 0 || price >= original) return null;
    return Math.round((1 - price / original) * 100);
  }, [form.price, form.originalPrice]);

  const mutation = useMutation({
    mutationFn: () =>
      api.deals.create({
        title: form.title.trim(),
        url: form.url.trim(),
        proofUrl: form.proofUrl.trim() || null,
        price: toNumber(form.price),
        originalPrice: toNumber(form.originalPrice),
        currency: form.currency,
        store: form.store,
        platform: form.platform,
        description: form.description.trim() || null,
        expiresAt: localToIso(form.expiresAt),
        gameId: selectedGame?.id ?? null,
        // Nova igra (IGDB ili ručni unos) se upisuje u katalog preko `igdbGame`.
        // Postojeća igra iz kataloga ima `id` i `gameTitle` joj nije potreban.
        gameTitle: selectedGame && !selectedGame.id ? selectedGame.title : null,
        igdbGame: selectedGame?.igdb ?? null,
      }),
    onSuccess: () => {
      toast.success('Deal je objavljen!');
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      queryClient.invalidateQueries({ queryKey: ['games'] });
      onClose();
    },
    onError: (err: any) => {
      const message = err?.message || 'Deal nije objavljen.';
      setError(message);
      toast.error(message);
    },
  });

  /** 2.6.2 — upload u Supabase Storage; vraća javni URL, ne base64. */
  const handleProofUrl = (url: string) => {
    setForm((prev) => ({ ...prev, proofUrl: url }));
  };

  /**
   * 2.6.2 — „Osveži iz prodavnice“: server pročita stranicu ponude i vrati
   * naslov, `og:image` (koji postaje dokaz) i cenu ako je struktuirana.
   * Cene ostaju ručne — ovo je predlog koji korisnik može da ispravi.
   */
  const [refreshing, setRefreshing] = useState(false);
  const refreshFromStore = async () => {
    const url = form.url.trim();
    if (!url || refreshing) {
      toast.error('Prvo unesi link na prodavnicu.');
      return;
    }
    setRefreshing(true);
    try {
      const preview = await api.deals.preview(url);
      if (preview.error) {
        toast.error(preview.error);
        return;
      }
      setForm((prev) => ({
        ...prev,
        title: prev.title.trim() || preview.title || prev.title,
        proofUrl: prev.proofUrl.trim() || preview.imageUrl || prev.proofUrl,
        price: prev.price || (preview.price != null ? String(preview.price) : prev.price),
        currency: preview.currency ?? prev.currency,
        store: prev.store || preview.store || prev.store,
      }));
      toast.success('Podaci sa prodavnice su učitani — proverite cene.');
    } catch (err: any) {
      toast.error(err?.message || 'Prodavnica nije mogla da se pročita.');
    } finally {
      setRefreshing(false);
    }
  };

  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Objavi deal"
      description="Podeli popust sa zajednicom — link, cene i dokaz pomažu da deal bude prihvaćen."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Otkaži
          </Button>
          <Button
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            loading={mutation.isPending}
            leftIcon={<Sparkles size={14} />}
          >
            Objavi deal
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-white/70">Naslov deal-a *</span>
          <input
            value={form.title}
            onChange={set('title')}
            maxLength={160}
            required
            placeholder="npr. Elden Ring: Shadow of the Erdtree — kompletno izdanje"
            className="ui-field"
          />
        </label>

        {/* Igra — povezivanje sa Game Page */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-white/70">Igra (povezuje deal sa Game Page)</span>
          {selectedGame ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-white">
                <Gamepad2 size={14} className="shrink-0 text-cyan-300" aria-hidden="true" />
                <span className="truncate">{selectedGame.title}</span>
                {selectedGame.igdb && (
                  <span className="rounded border border-white/10 px-1 font-mono text-[9px] uppercase text-white/50">IGDB</span>
                )}
              </span>
              {!presetGame && (
                <button
                  type="button"
                  onClick={() => setSelectedGame(null)}
                  className="ui-icon-btn !h-7 !w-7"
                  aria-label="Ukloni igru"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} aria-hidden="true" />
              <input
                value={gameQuery}
                onChange={(event) => setGameQuery(event.target.value)}
                placeholder={igdbEnabled ? 'Pretraži igre (katalog + IGDB)…' : 'Pretraži igre u katalogu…'}
                className="ui-field !pl-9"
                aria-label="Pretraga igre"
              />
              {gamesQuery.isFetching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" aria-hidden="true" />
              )}
              {debouncedQuery.trim().length >= 2 && !gamesQuery.isFetching && (
                <ul className="ui-card-elevated absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto !rounded-lg !p-1">
                  {(gamesQuery.data ?? []).length === 0 && (
                    <li className="px-3 py-2 text-xs text-white/45">
                      Nema rezultata. Deal možete objaviti i bez igre.
                    </li>
                  )}
                  {(gamesQuery.data ?? []).map((item) =>
                    item.kind === 'local' ? (
                      <li key={`local-${item.game.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGame({ id: item.game.id, title: item.game.title, slug: item.game.slug });
                            setGameQuery('');
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-white/85 transition hover:bg-white/[0.05]"
                        >
                          <Gamepad2 size={13} className="text-cyan-300" aria-hidden="true" />
                          {item.game.title}
                        </button>
                      </li>
                    ) : (
                      <li key={`igdb-${item.game.igdbId}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGame({ title: item.game.name, slug: item.game.slug, igdb: item.game });
                            setGameQuery('');
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-white/85 transition hover:bg-white/[0.05]"
                        >
                          {item.game.coverUrl ? (
                            <img src={item.game.coverUrl} alt="" className="h-7 w-5 rounded object-cover" />
                          ) : (
                            <Gamepad2 size={13} className="text-violet-300" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{item.game.name}</span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-violet-300/80">IGDB</span>
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between gap-2 text-xs font-medium text-white/70">
            Link na prodavnicu *
            <button
              type="button"
              onClick={() => void refreshFromStore()}
              disabled={refreshing || !form.url.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-normal text-cyan-200 transition hover:border-cyan-400/40 disabled:opacity-40"
            >
              {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Osveži iz prodavnice
            </button>
          </span>
          <div className="relative">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} aria-hidden="true" />
            <input
              value={form.url}
              onChange={set('url')}
              type="url"
              required
              placeholder="https://store.steampowered.com/app/…"
              className="ui-field !pl-9"
            />
          </div>
        </label>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Cena *</span>
            <input value={form.price} onChange={set('price')} inputMode="decimal" required placeholder="29.99" className="ui-field" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Originalna *</span>
            <input
              value={form.originalPrice}
              onChange={set('originalPrice')}
              inputMode="decimal"
              required
              placeholder="59.99"
              className="ui-field"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Valuta</span>
            <select value={form.currency} onChange={set('currency')} className="ui-field">
              {CURRENCY_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end pb-1">
            <span
              className={`w-full rounded-lg border px-2 py-2 text-center font-mono text-sm font-bold tabular-nums ${
                discount === null
                  ? 'border-white/10 text-white/30'
                  : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
              }`}
              aria-live="polite"
            >
              {discount === null ? '—' : `-${discount}%`}
            </span>
          </div>
        </div>

        {discount !== null && (
          <p className="text-[11px] text-white/45">
            Ušteda: {formatPrice(toNumber(form.originalPrice) - toNumber(form.price), form.currency)} po ovom deal-u.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Prodavnica *</span>
            <select value={form.store} onChange={set('store')} className="ui-field">
              {STORE_OPTIONS.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Platforma</span>
            <select value={form.platform} onChange={set('platform')} className="ui-field">
              {PLATFORM_OPTIONS.map((platform) => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-white/70">Prestaje (opciono)</span>
          <input value={form.expiresAt} onChange={set('expiresAt')} type="datetime-local" className="ui-field" />
          <span className="text-[11px] text-white/40">Ako ostavite prazno, deal nema rok. „Ističe uskoro“ se prikazuje za poslednja 3 dana.</span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-white/70">Dokaz — URL slike (opciono)</span>
          <input value={form.proofUrl} onChange={set('proofUrl')} type="url" placeholder="https://…/screenshot.png" className="ui-field" />
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            {/* 2.6.2 — screenshot ide u Supabase Storage; stari data: URL se i dalje
                prikaže (legacy draft), ali se ne šalje kad je Storage podešen. */}
            <ImageUpload kind="proof" compact onUploaded={handleProofUrl} />
            {form.proofUrl.startsWith('data:image') && (
              <span className="text-[11px] text-amber-300">Stari data URL — otpremi sliku ponovo da bi se sačuvala.</span>
            )}
            {form.proofUrl && !form.proofUrl.startsWith('data:image') && (
              <span className="text-[11px] text-emerald-300">Slika je spremna.</span>
            )}
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-white/70">Opis (opciono)</span>
          <textarea
            value={form.description}
            onChange={set('description')}
            rows={3}
            maxLength={2000}
            placeholder="Uslovi akcije, verzija igre, region, DRM…"
            className="ui-field resize-none"
          />
        </label>
      </form>
    </Modal>
  );
}

/** Mali debounce hook (bez dodatne zavisnosti). */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
